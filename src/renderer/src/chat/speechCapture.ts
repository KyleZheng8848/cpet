/** 渲染进程采音 → int16 PCM，供主进程推给听写助手。 */

export type SpeechCapture = {
  stop: () => void
}

function floatToInt16Base64(input: Float32Array): string {
  const bytes = new Uint8Array(input.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 开始采音；每帧 PCM 通过 onPcm 送出。 */
export async function startSpeechCapture(
  onPcm: (payload: { base64: string; sampleRate: number }) => void
): Promise<SpeechCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1
    }
  })
  const ctx = new AudioContext()
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      // ignore
    }
  }
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    onPcm({
      base64: floatToInt16Base64(input),
      sampleRate: ctx.sampleRate
    })
  }
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(ctx.destination)

  let stopped = false
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      try {
        processor.disconnect()
        source.disconnect()
        mute.disconnect()
      } catch {
        // ignore
      }
      for (const t of stream.getTracks()) t.stop()
      void ctx.close().catch(() => undefined)
    }
  }
}
