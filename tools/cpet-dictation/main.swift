import AppKit
import AVFoundation
import Foundation
import Speech

/// CPET macOS 听写助手
/// 用法:
///   cpet-dictation --live
///     从 stdin 读 PCM（由 CPET 采音），流式识别，NDJSON → stdout
///   cpet-dictation <audio-path>
///
/// --live stdin:
///   AUDIO <sampleRate> <base64-int16-mono>\n
///   STOP\n

func die(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
        let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}

func waitPumping(_ sem: DispatchSemaphore, seconds: TimeInterval) -> Bool {
  let deadline = Date(timeIntervalSinceNow: seconds)
  while Date() < deadline {
    if sem.wait(timeout: .now()) == .success { return true }
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
  }
  return sem.wait(timeout: .now()) == .success
}

func authorizeSpeech() {
  // CLI/裸二进制上 requestAuthorization 可能直接 abort；先建 AppKit 上下文
  _ = NSApplication.shared
  let usage = Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") as? String
  emit([
    "t": "authorizing",
    "bundle": Bundle.main.bundlePath,
    "id": Bundle.main.bundleIdentifier ?? "",
    "usage": (usage?.isEmpty == false) ? "ok" : "MISSING"
  ])
  if usage == nil || usage?.isEmpty == true {
    emit(["t": "error", "message": "missing NSSpeechRecognitionUsageDescription in Info.plist"])
    die("missing NSSpeechRecognitionUsageDescription")
  }

  let current = SFSpeechRecognizer.authorizationStatus()
  if current == .authorized { return }
  if current == .denied || current == .restricted {
    emit(["t": "error", "message": "speech authorization denied"])
    die("speech authorization denied")
  }

  // 嵌套在 CPET.app/Contents/Resources 里时，requestAuthorization 常被 TCC 直接 SIGABRT。
  // 未授权则交给宿主进程内桥弹窗；此处不再强行 request。
  emit([
    "t": "error",
    "message":
      "speech authorization not determined — authorize in host CPET (Speech Recognition), then retry"
  ])
  die("speech authorization not determined")
}

func makeRecognizer() -> SFSpeechRecognizer {
  let candidates = ["zh-CN", "zh-Hans", "zh_CN", Locale.current.identifier]
  var picked: SFSpeechRecognizer?
  for id in candidates {
    if let r = SFSpeechRecognizer(locale: Locale(identifier: id)) {
      picked = r
      // isAvailable 可能瞬时为 false；仍优先可用的，否则退回第一个非 nil
      if r.isAvailable { break }
    }
  }
  guard let recognizer = picked else {
    die("zh-CN speech recognizer unavailable")
  }
  // 不再因 isAvailable==false 直接失败：部分系统上该标志抖动，真正识别时再报错
  return recognizer
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

// MARK: - File mode

func runFileMode(path: String) {
  let url = URL(fileURLWithPath: path)
  guard FileManager.default.fileExists(atPath: path) else {
    die("file not found: \(path)")
  }
  authorizeSpeech()
  let recognizer = makeRecognizer()

  let request = SFSpeechURLRecognitionRequest(url: url)
  request.shouldReportPartialResults = true

  let done = DispatchSemaphore(value: 0)
  var transcript = ""
  var failure: String?
  var signaled = false

  func signalDone() {
    if signaled { return }
    signaled = true
    done.signal()
  }

  let task = recognizer.recognitionTask(with: request) { result, error in
    if let result {
      transcript = result.bestTranscription.formattedString
      if result.isFinal { signalDone(); return }
    }
    if let error {
      let ns = error as NSError
      if !transcript.isEmpty, ns.domain == NSURLErrorDomain {
        signalDone()
        return
      }
      failure = error.localizedDescription
      signalDone()
    }
  }
  _ = task

  if !waitPumping(done, seconds: 40) {
    task.cancel()
    let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty {
      print(text)
      exit(0)
    }
    die("speech recognition timeout")
  }

  let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty {
    die(failure ?? "empty transcript")
  }
  print(text)
}

// MARK: - Live mode

/// int16 mono LE → float32 non-interleaved（Speech 可吃；interleaved int16 的 channelData 为 nil）
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

func runLiveMode() {
  authorizeSpeech()
  let recognizer = makeRecognizer()
  emit(["t": "ready"])

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

  func combinedText() -> String {
    joinSpeech(committed, segmentText)
  }

  func emitTranscript(final: Bool = false) {
    emit(["t": final ? "final" : "partial", "text": combinedText()])
  }

  func finish(reason: String) {
    if stopping { return }
    stopping = true
    taskGen += 1
    currentRequest?.endAudio()
    recognitionTask?.cancel()
    currentRequest = nil
    recognitionTask = nil
    let text = combinedText().trimmingCharacters(in: .whitespacesAndNewlines)
    emit(["t": "end", "reason": reason, "text": text, "chunks": audioChunks])
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
    exit(0)
  }

  func commitSegment() {
    let piece = segmentText.trimmingCharacters(in: .whitespacesAndNewlines)
    if !piece.isEmpty {
      committed = joinSpeech(committed, piece)
      segmentText = ""
    }
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

    recognitionTask = recognizer.recognitionTask(with: request) { result, error in
      if stopping || gen != taskGen { return }

      if let result {
        let text = result.bestTranscription.formattedString
        if text != segmentText {
          segmentText = text
          if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            heardSpeech = true
            lastChangeAt = Date()
          }
          emitTranscript(final: false)
        }
        if result.isFinal {
          commitSegment()
          emitTranscript(final: true)
          DispatchQueue.main.async {
            if !stopping && gen == taskGen { startRecognitionTask() }
          }
        }
        return
      }

      if error != nil {
        commitSegment()
        emitTranscript(final: true)
        DispatchQueue.main.async {
          if !stopping && gen == taskGen { startRecognitionTask() }
        }
      }
    }

    oldRequest?.endAudio()
    oldTask?.cancel()
  }

  startRecognitionTask()

  DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty { continue }
      if trimmed.uppercased() == "STOP" {
        DispatchQueue.main.async { finish(reason: "stop") }
        return
      }
      let parts = trimmed.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
      guard parts.count == 3, parts[0].uppercased() == "AUDIO",
            let sr = Double(parts[1]), sr > 0,
            let data = Data(base64Encoded: String(parts[2]))
      else { continue }

      DispatchQueue.main.async {
        if stopping { return }
        guard let buffer = pcmBuffer(fromInt16LE: data, sampleRate: sr) else { return }
        audioChunks += 1
        currentRequest?.append(buffer)
        if audioChunks == 1 {
          emit(["t": "status", "message": "audio"])
        }
      }
    }
    DispatchQueue.main.async {
      if !stopping { finish(reason: "stop") }
    }
  }

  Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
    if stopping { return }
    let elapsed = Date().timeIntervalSince(startedAt)
    if elapsed >= maxSeconds {
      finish(reason: "max")
      return
    }
    let quietText = Date().timeIntervalSince(lastChangeAt)
    if heardSpeech && quietText >= silenceAfterSpeech {
      finish(reason: "silence")
      return
    }
    if !heardSpeech && quietText >= silenceNoSpeech {
      finish(reason: "nospeech")
      return
    }
  }

  RunLoop.main.run()
}

// MARK: - Entry

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty {
  die("usage: cpet-dictation --live | cpet-dictation <audio-path>")
}

if args[0] == "--live" {
  runLiveMode()
} else {
  runFileMode(path: args[0])
}
