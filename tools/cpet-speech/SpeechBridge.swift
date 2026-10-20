import AVFoundation
import Foundation
import Speech

/// 主进程内加载的听写桥（dylib）。TCC 归因到宿主 Electron/CPET。
/// C ABI:
///   int cpet_speech_live_start(void (*cb)(const char*))
///   int cpet_speech_live_push(const void* pcm, int nbytes, double sampleRate)
///   int cpet_speech_live_stop(void)

public typealias EventCB = @convention(c) (UnsafePointer<CChar>?) -> Void

private final class LiveSession {
  let recognizer: SFSpeechRecognizer
  let cb: EventCB
  let silenceAfterSpeech: TimeInterval = 3.0
  let silenceNoSpeech: TimeInterval = 10.0
  let maxSeconds: TimeInterval = 120

  var committed = ""
  var segmentText = ""
  var heardSpeech = false
  var lastChangeAt = Date()
  let startedAt = Date()
  var stopping = false
  var taskGen = 0
  var audioChunks = 0
  var currentRequest: SFSpeechAudioBufferRecognitionRequest?
  var recognitionTask: SFSpeechRecognitionTask?
  var timer: Timer?

  init(recognizer: SFSpeechRecognizer, cb: EventCB) {
    self.recognizer = recognizer
    self.cb = cb
  }

  func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let line = String(data: data, encoding: .utf8)
    else { return }
    line.withCString { ptr in self.cb(ptr) }
  }

  func joinSpeech(_ prefix: String, _ speech: String) -> String {
    let s = speech.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return prefix }
    if prefix.isEmpty { return s }
    if prefix.last?.isWhitespace == true { return prefix + s }
    let left = prefix.last.map(String.init) ?? ""
    let right = s.first.map(String.init) ?? ""
    let leftAlnum = left.range(of: "[A-Za-z0-9]", options: .regularExpression) != nil
    let rightAlnum = right.range(of: "[A-Za-z0-9]", options: .regularExpression) != nil
    if leftAlnum && rightAlnum { return "\(prefix) \(s)" }
    return prefix + s
  }

  func combinedText() -> String { joinSpeech(committed, segmentText) }

  func emitTranscript(final: Bool = false) {
    emit(["t": final ? "final" : "partial", "text": combinedText()])
  }

  func finish(reason: String) {
    if stopping { return }
    stopping = true
    taskGen += 1
    timer?.invalidate()
    timer = nil
    currentRequest?.endAudio()
    recognitionTask?.cancel()
    currentRequest = nil
    recognitionTask = nil
    let text = combinedText().trimmingCharacters(in: .whitespacesAndNewlines)
    emit(["t": "end", "reason": reason, "text": text, "chunks": audioChunks])
  }

  func commitSegment() {
    let piece = segmentText.trimmingCharacters(in: .whitespacesAndNewlines)
    if !piece.isEmpty {
      committed = joinSpeech(committed, piece)
      segmentText = ""
    }
  }

  func pcmBuffer(fromInt16LE data: Data, sampleRate: Double) -> AVAudioPCMBuffer? {
    let frames = data.count / MemoryLayout<Int16>.size
    guard frames > 0 else { return nil }
    guard let format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: sampleRate,
      channels: 1,
      interleaved: false
    ) else { return nil }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))
    else { return nil }
    buffer.frameLength = AVAudioFrameCount(frames)
    guard let dst = buffer.floatChannelData?[0] else { return nil }
    data.withUnsafeBytes { raw in
      let src = raw.bindMemory(to: Int16.self)
      for i in 0 ..< frames {
        dst[i] = Float(src[i]) / 32768.0
      }
    }
    return buffer
  }

  func startRecognitionTask() {
    if stopping { return }
    taskGen += 1
    let gen = taskGen
    let oldRequest = currentRequest
    let oldTask = recognitionTask

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.taskHint = .dictation
    if #available(macOS 13.0, *) {
      request.addsPunctuation = true
    }
    currentRequest = request

    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self, !self.stopping, gen == self.taskGen else { return }
      if let result {
        let text = result.bestTranscription.formattedString
        if text != self.segmentText {
          self.segmentText = text
          if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.heardSpeech = true
            self.lastChangeAt = Date()
          }
          self.emitTranscript(final: false)
        }
        if result.isFinal {
          self.commitSegment()
          self.emitTranscript(final: true)
          // 续听：下一段
          self.startRecognitionTask()
        }
        return
      }
      if error != nil {
        self.commitSegment()
        self.emitTranscript(final: true)
        self.startRecognitionTask()
      }
    }

    oldRequest?.endAudio()
    oldTask?.cancel()
  }

  func start() {
    startRecognitionTask()
    let t = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
      guard let self, !self.stopping else { return }
      let elapsed = Date().timeIntervalSince(self.startedAt)
      if elapsed >= self.maxSeconds {
        self.finish(reason: "max")
        return
      }
      let quiet = Date().timeIntervalSince(self.lastChangeAt)
      if self.heardSpeech && quiet >= self.silenceAfterSpeech {
        self.finish(reason: "silence")
        return
      }
      if !self.heardSpeech && quiet >= self.silenceNoSpeech {
        self.finish(reason: "nospeech")
      }
    }
    RunLoop.main.add(t, forMode: .common)
    timer = t
    emit(["t": "ready"])
  }

  func push(pcm: Data, sampleRate: Double) {
    if stopping { return }
    guard let buffer = pcmBuffer(fromInt16LE: pcm, sampleRate: sampleRate) else { return }
    audioChunks += 1
    currentRequest?.append(buffer)
    if audioChunks == 1 {
      emit(["t": "status", "message": "audio"])
    }
  }
}

private var gSession: LiveSession?
private let gLock = NSLock()

/** 等信号量时泵 RunLoop，避免 requestAuthorization 回调被主线程阻塞饿死。 */
private func waitPumping(_ sem: DispatchSemaphore, seconds: TimeInterval) -> Bool {
  let deadline = Date(timeIntervalSinceNow: seconds)
  while Date() < deadline {
    if sem.wait(timeout: .now()) == .success { return true }
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
  }
  return sem.wait(timeout: .now()) == .success
}

/**
 正式版 Info.plist 已带 NSSpeechRecognitionUsageDescription，可请求系统授权弹窗。
 notDetermined 时调用 requestAuthorization；denied 则提示去系统设置打开。
 */
private func authorizeWithoutBlocking(cb: EventCB) -> Bool {
  "{\"t\":\"authorizing\"}".withCString { ptr in cb(ptr) }

  let current = SFSpeechRecognizer.authorizationStatus()
  if current == .authorized {
    return true
  }
  if current == .denied || current == .restricted {
    "{\"t\":\"error\",\"message\":\"speech authorization denied\"}".withCString { ptr in cb(ptr) }
    return false
  }

  let sem = DispatchSemaphore(value: 0)
  var authStatus = SFSpeechRecognizerAuthorizationStatus.notDetermined
  SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    sem.signal()
  }
  if !waitPumping(sem, seconds: 120) {
    "{\"t\":\"error\",\"message\":\"speech authorization timeout — click Allow on the prompt, or toggle CPET in Speech Recognition settings\"}"
      .withCString { ptr in cb(ptr) }
    return false
  }
  if authStatus == .authorized {
    return true
  }
  if authStatus == .denied || authStatus == .restricted {
    "{\"t\":\"error\",\"message\":\"speech authorization denied\"}".withCString { ptr in cb(ptr) }
  } else {
    // adhoc 重装会产生多个「CPET」条目；开关开的是旧身份时仍会 notDetermined
    "{\"t\":\"error\",\"message\":\"speech authorization not determined — duplicate CPET TCC entries; toggle off all CPET rows then enable the current app\"}"
      .withCString { ptr in cb(ptr) }
  }
  return false
}

private func makeRecognizer() -> SFSpeechRecognizer? {
  let candidates = ["zh-CN", "zh-Hans", "zh_CN", Locale.current.identifier]
  var picked: SFSpeechRecognizer?
  for id in candidates {
    if let r = SFSpeechRecognizer(locale: Locale(identifier: id)) {
      picked = r
      if r.isAvailable { break }
    }
  }
  return picked
}

@_cdecl("cpet_speech_live_start")
public func cpet_speech_live_start(_ cb: EventCB) -> Int32 {
  gLock.lock()
  if let old = gSession {
    gSession = nil
    gLock.unlock()
    old.finish(reason: "restart")
  } else {
    gLock.unlock()
  }

  guard authorizeWithoutBlocking(cb: cb) else { return -1 }
  guard let recognizer = makeRecognizer() else {
    "{\"t\":\"error\",\"message\":\"zh-CN speech recognizer unavailable\"}".withCString { ptr in cb(ptr) }
    return -2
  }

  let session = LiveSession(recognizer: recognizer, cb: cb)
  gLock.lock()
  gSession = session
  gLock.unlock()

  // Timer 挂主 RunLoop；勿在非主线程泵 RunLoop 等待（会闪退）
  if Thread.isMainThread {
    session.start()
  } else {
    DispatchQueue.main.sync { session.start() }
  }
  return 0
}

@_cdecl("cpet_speech_live_push")
public func cpet_speech_live_push(
  _ bytes: UnsafeRawPointer?,
  _ nbytes: Int32,
  _ sampleRate: Double
) -> Int32 {
  guard let bytes, nbytes > 0, sampleRate > 0 else { return -1 }
  let data = Data(bytes: bytes, count: Int(nbytes))
  gLock.lock()
  let session = gSession
  gLock.unlock()
  guard let session else { return -2 }
  if Thread.isMainThread {
    session.push(pcm: data, sampleRate: sampleRate)
  } else {
    DispatchQueue.main.async {
      session.push(pcm: data, sampleRate: sampleRate)
    }
  }
  return 0
}

@_cdecl("cpet_speech_live_stop")
public func cpet_speech_live_stop() -> Int32 {
  gLock.lock()
  let session = gSession
  gSession = nil
  gLock.unlock()
  guard let session else { return 0 }
  if Thread.isMainThread {
    session.finish(reason: "stop")
  } else {
    DispatchQueue.main.async {
      session.finish(reason: "stop")
    }
  }
  return 0
}
