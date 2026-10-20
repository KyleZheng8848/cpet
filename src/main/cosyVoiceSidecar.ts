/**
 * CosyVoice 本机侧车：启停 Python HTTP 服务、健康检查、模型下载。
 */
import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  DEFAULT_COSYVOICE_MODEL,
  DEFAULT_COSYVOICE_PORT,
  DEFAULT_COSYVOICE_PROMPT_TEXT,
  normalizeCosyvoiceModel,
  normalizeCosyvoicePort,
  type CosyVoiceInstallResult,
  type CosyVoiceStatus
} from '../shared/tts'
import { normalizeQuickChatSettings } from '../shared/quickChat'
import { getSettings, updateSettings } from './store'
import { ensureDefaultVoiceFromRepo, listTtsVoices } from './ttsVoices'

const COSYVOICE_GIT = 'https://github.com/FunAudioLLM/CosyVoice.git'

let child: ChildProcess | null = null
let starting: Promise<void> | null = null
let installing: Promise<CosyVoiceInstallResult> | null = null
let installPhase: string | undefined
let lastError: string | undefined

function resourcePath(...parts: string[]): string {
  const base = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, '../../resources')
  return join(base, ...parts)
}

function serverScript(): string {
  return resourcePath('cosyvoice', 'cpet_cosyvoice_server.py')
}

function modelsCacheRoot(): string {
  const d = join(app.getPath('userData'), 'cosyvoice', 'models')
  mkdirSync(d, { recursive: true })
  return d
}

function sanitizeModelKey(model: string): string {
  return model.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'model'
}

/** 若已是本地目录则直接用；否则落在 userData 缓存下。 */
export function resolveModelDir(modelRaw?: string): string {
  const model = normalizeCosyvoiceModel(modelRaw)
  if (existsSync(model) && statSync(model).isDirectory()) return model
  const cached = join(modelsCacheRoot(), sanitizeModelKey(model))
  if (existsSync(cached) && hasModelFiles(cached)) return cached
  // ModelScope snapshot_download 常落在 cache/<org>/<name>/
  const nested = findNestedModelDir(cached)
  if (nested) return nested
  return cached
}

function hasModelFiles(dir: string): boolean {
  try {
    const names = readdirSync(dir)
    return names.some((n) => /cosyvoice|llm|flow|hift|campplus|speech_tokenizer/i.test(n))
  } catch {
    return false
  }
}

function findNestedModelDir(root: string): string | null {
  if (!existsSync(root)) return null
  if (hasModelFiles(root)) return root
  try {
    for (const name of readdirSync(root)) {
      const p = join(root, name)
      if (!statSync(p).isDirectory()) continue
      if (hasModelFiles(p)) return p
      const deeper = findNestedModelDir(p)
      if (deeper) return deeper
    }
  } catch {
    /* ignore */
  }
  return null
}

function qcSettings() {
  return normalizeQuickChatSettings(getSettings().quickChat)
}

/** CPET 专用 CosyVoice venv（与系统 / conda 隔离）。 */
function managedVenvDir(): string {
  return join(app.getPath('userData'), 'cosyvoice', 'venv')
}

function managedPythonPath(): string {
  return process.platform === 'win32'
    ? join(managedVenvDir(), 'Scripts', 'python.exe')
    : join(managedVenvDir(), 'bin', 'python')
}

function isPlaceholderPython(raw: string): boolean {
  return /^(python3?|py)$/i.test(raw.trim())
}

function customPythonOverride(): string | undefined {
  const custom = qcSettings().cosyvoicePython?.trim()
  if (!custom || isPlaceholderPython(custom)) return undefined
  try {
    if (resolve(custom) === resolve(managedPythonPath())) return undefined
  } catch {
    /* ignore */
  }
  return custom
}

function whichCmd(bin: string): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const r = spawnSync(cmd, [bin], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const line = (r.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean)
  return line || null
}

/** 创建 venv 用的宿主机 Python（优先 3.11/3.12，避免 3.13 轮子不全）。 */
function discoverBootstrapPython(): string | null {
  const names =
    process.platform === 'win32'
      ? ['python3.11', 'python3.12', 'python3.10', 'python3', 'python', 'py']
      : ['python3.11', 'python3.12', 'python3.10', 'python3']
  for (const name of names) {
    const hit = whichCmd(name)
    if (hit) return hit
  }
  return null
}

/**
 * 运行侧车 / pip 用的解释器：
 * - 设置里填了绝对路径 → 尊重（高级覆盖）
 * - 否则优先专用 venv；尚未创建时临时回退 PATH 上的 python3（不打断旧环境）
 */
function pythonBin(): string {
  const override = customPythonOverride()
  if (override) return override
  const managed = managedPythonPath()
  if (existsSync(managed)) return managed
  return whichCmd('python3') || discoverBootstrapPython() || 'python3'
}

function usingManagedEnv(): boolean {
  return !customPythonOverride() && existsSync(managedPythonPath())
}

async function ensureManagedVenv(): Promise<{ ok: true; python: string } | { ok: false; error: string }> {
  if (customPythonOverride()) {
    return { ok: true, python: customPythonOverride()! }
  }
  const py = managedPythonPath()
  if (existsSync(py)) {
    const check = await runCmd(py, ['-c', 'import sys; print(sys.version)'], { timeoutMs: 30_000 })
    if (check.code === 0) return { ok: true, python: py }
  }

  const bootstrap = discoverBootstrapPython()
  if (!bootstrap) {
    return {
      ok: false,
      error: '找不到 Python 3。请安装 Python 3.10–3.12（推荐 3.11），或在高级设置里指定解释器路径。'
    }
  }

  mkdirSync(dirname(managedVenvDir()), { recursive: true })
  installPhase = `创建专用环境（基于 ${bootstrap}，不改系统包）…`
  const created = await runCmd(bootstrap, ['-m', 'venv', managedVenvDir()], {
    timeoutMs: 180_000
  })
  if (created.code !== 0 || !existsSync(py)) {
    return {
      ok: false,
      error: `无法创建专用 venv：${(created.stderr || created.stdout).trim().slice(0, 280) || bootstrap}`
    }
  }

  installPhase = '升级专用环境 pip…'
  await runCmd(py, ['-m', 'pip', 'install', '-U', 'pip', 'setuptools', 'wheel'], {
    timeoutMs: 300_000
  })
  return { ok: true, python: py }
}

async function installSidecarRequirements(py: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const req = resourcePath('cosyvoice', 'requirements-sidecar.txt')
  if (!existsSync(req)) {
    return { ok: false, error: `缺少依赖清单：${req}` }
  }
  installPhase = '向专用环境安装 CosyVoice 依赖（含 PyTorch，体积较大）…'
  await runCmd(py, ['-m', 'pip', 'install', 'setuptools>=70,<81', 'wheel'], {
    timeoutMs: 180_000
  })
  // whisper 旧包在隔离构建里缺 pkg_resources；与 setuptools 同环境装
  const pip = await runCmd(
    py,
    ['-m', 'pip', 'install', '--no-build-isolation', '-r', req],
    { timeoutMs: 1_200_000 }
  )
  if (pip.code !== 0) {
    return {
      ok: false,
      error: `专用环境依赖安装失败：${(pip.stderr || pip.stdout).trim().slice(0, 360)}`
    }
  }
  // Numba / CosyVoice 对 NumPy 上限敏感，再钉一次
  installPhase = '对齐专用环境 NumPy…'
  await runCmd(py, ['-m', 'pip', 'install', 'numpy>=1.26.4,<2.2'], { timeoutMs: 300_000 })
  return { ok: true }
}

function cosyRoot(): string {
  return (qcSettings().cosyvoiceRoot || '').trim()
}

function port(): number {
  return normalizeCosyvoicePort(qcSettings().cosyvoicePort)
}

function baseUrl(): string {
  return `http://127.0.0.1:${port()}`
}

export function defaultPromptWav(root?: string): string | null {
  const r = (root || cosyRoot()).trim()
  if (!r) return null
  const candidates = [
    join(r, 'asset', 'zero_shot_prompt.wav'),
    join(r, 'assets', 'zero_shot_prompt.wav'),
    join(r, 'example', 'zero_shot_prompt.wav')
  ]
  return candidates.find((p) => existsSync(p)) || null
}

async function fetchHealth(
  timeoutMs = 2500
): Promise<{ ok: boolean; ready: boolean; error?: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl()}/health`, { signal: ctl.signal })
    if (!res.ok) return { ok: false, ready: false, error: `HTTP ${res.status}` }
    const body = (await res.json()) as { ok?: boolean; ready?: boolean; error?: string }
    return {
      ok: body.ok !== false,
      ready: !!body.ready,
      error: body.error || undefined
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, ready: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

function stopChild(): void {
  if (!child) return
  const c = child
  child = null
  try {
    c.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      if (!c.killed) c.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 2000)
}

export function stopCosyVoiceSidecar(): void {
  starting = null
  stopChild()
}

/**
 * 确保专用 venv 存在且关键包可导入；缺依赖则装进 venv（不碰系统 Python）。
 * 试听 / 朗读前调用，避免「模型就绪但 No module named hyperpyyaml」。
 */
async function ensureCosyRuntimePrepared(): Promise<void> {
  if (customPythonOverride()) return
  const env = await ensureManagedVenv()
  if (!env.ok) throw new Error(env.error)
  const check = await runCmd(
    env.python,
    [
      '-c',
      'import hyperpyyaml, torch, modelscope, whisper, hydra, wget; print("ok")'
    ],
    { timeoutMs: 90_000 }
  )
  if (check.code === 0) return
  const deps = await installSidecarRequirements(env.python)
  if (!deps.ok) throw new Error(deps.error)
}

async function waitReady(maxMs = 180_000): Promise<void> {
  const start = Date.now()
  let sawListening = false
  while (Date.now() - start < maxMs) {
    if (!child || child.killed) {
      throw new Error(lastError || 'CosyVoice 侧车进程已退出')
    }
    const h = await fetchHealth(2000)
    if (h.ok && h.ready) return
    if (h.ok) {
      sawListening = true
      // 端口已监听但模型加载失败：不会自愈，立刻抛错（避免试听卡 180s）
      if (h.error) {
        lastError = h.error
        throw new Error(h.error)
      }
    } else if (sawListening && h.error) {
      lastError = h.error
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error(lastError || 'CosyVoice 模型加载超时')
}

async function spawnSidecar(): Promise<void> {
  const root = cosyRoot()
  if (!root || !existsSync(root)) {
    throw new Error('请先在设置里填写 CosyVoice 仓库根目录')
  }
  const script = serverScript()
  if (!existsSync(script)) {
    throw new Error(`侧车脚本缺失：${script}`)
  }
  const modelDir = resolveModelDir(qcSettings().cosyvoiceModel)
  if (!existsSync(modelDir) || !hasModelFiles(modelDir)) {
    throw new Error('模型尚未准备。请先点「准备模型」下载 CosyVoice-300M')
  }

  stopChild()
  lastError = undefined
  const env = {
    ...process.env,
    CPET_COSYVOICE_ROOT: root,
    CPET_COSYVOICE_MODEL: modelDir,
    CPET_COSYVOICE_PORT: String(port())
  }
  const bin = pythonBin()
  const c = spawn(bin, [script, '--cosy-root', root, '--model-dir', modelDir, '--port', String(port())], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child = c
  c.stdout?.on('data', (buf: Buffer) => {
    const line = buf.toString('utf8').trim()
    if (line) console.log('[cosyvoice]', line)
  })
  c.stderr?.on('data', (buf: Buffer) => {
    const line = buf.toString('utf8').trim()
    if (line) {
      console.warn('[cosyvoice]', line)
      if (/error|traceback|failed/i.test(line)) lastError = line.slice(0, 240)
    }
  })
  c.on('exit', (code, signal) => {
    if (child === c) child = null
    if (code && code !== 0) {
      lastError = lastError || `侧车退出 code=${code} signal=${signal || ''}`
    }
  })
  c.on('error', (err) => {
    lastError = err.message
    if (child === c) child = null
  })
  await waitReady()
}

/** 确保侧车就绪（已在跑则复用）。 */
export async function ensureCosyVoiceReady(): Promise<void> {
  const h = await fetchHealth()
  if (h.ok && h.ready) return
  // 侧车起来了但缺依赖：杀掉，装进专用 venv 再拉
  if (h.ok && h.error && /No module named|ModuleNotFoundError/i.test(h.error)) {
    stopChild()
    lastError = h.error
  }
  if (starting) {
    await starting
    return
  }
  starting = (async () => {
    await ensureCosyRuntimePrepared()
    await spawnSidecar()
  })().finally(() => {
    starting = null
  })
  await starting
}

function bundledRepoPath(): string {
  const d = join(app.getPath('userData'), 'cosyvoice', 'CosyVoice')
  mkdirSync(join(app.getPath('userData'), 'cosyvoice'), { recursive: true })
  return d
}

function looksLikeCosyRepo(root: string): boolean {
  if (!root || !existsSync(root)) return false
  return (
    existsSync(join(root, 'cosyvoice')) ||
    existsSync(join(root, 'requirements.txt')) ||
    existsSync(join(root, 'asset', 'zero_shot_prompt.wav'))
  )
}

function runCmd(
  bin: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, {
      cwd: opts?.cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        c.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      reject(new Error(`命令超时：${bin} ${args.join(' ')}`))
    }, opts?.timeoutMs ?? 600_000)
    c.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    c.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    c.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    c.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export async function getCosyVoiceStatus(): Promise<CosyVoiceStatus> {
  const root = cosyRoot() || (looksLikeCosyRepo(bundledRepoPath()) ? bundledRepoPath() : '')
  const model = normalizeCosyvoiceModel(qcSettings().cosyvoiceModel)
  const modelDir = resolveModelDir(model)
  const installed = looksLikeCosyRepo(root)
  const modelOk = existsSync(modelDir) && !!hasModelFiles(modelDir)
  const voices = listTtsVoices().map((v) => ({ id: v.id, name: v.name }))
  let running = false
  let ready = false
  let error = lastError
  const h = await fetchHealth()
  if (h.ok) {
    running = true
    ready = h.ready
    if (h.error) error = h.error
  } else if (child && !child.killed) {
    running = true
  }
  const py = pythonBin()
  const managed = usingManagedEnv()
  return {
    installed,
    modelReady: modelOk,
    ready: ready && modelOk,
    running,
    installPhase,
    python: py,
    managedEnv: managed,
    venvDir: existsSync(managedVenvDir()) ? managedVenvDir() : undefined,
    cosyRoot: root || undefined,
    modelDir: modelOk ? modelDir : undefined,
    port: port() || DEFAULT_COSYVOICE_PORT,
    error:
      installPhase ||
      error ||
      (!installed
        ? '尚未安装 CosyVoice（开启 TTS 后会自动安装）'
        : !modelOk
          ? '模型未下载'
          : undefined),
    voices
  }
}

/**
 * 开启 TTS 时调用：克隆 CosyVoice 仓库 + 下载 CosyVoice-300M，并写入设置路径。
 */
export async function installCosyVoice(): Promise<CosyVoiceInstallResult> {
  if (installing) return installing
  installing = doInstallCosyVoice().finally(() => {
    installing = null
    installPhase = undefined
  })
  return installing
}

async function doInstallCosyVoice(): Promise<CosyVoiceInstallResult> {
  let root = cosyRoot()
  if (!looksLikeCosyRepo(root)) {
    root = bundledRepoPath()
  }

  try {
    // 先建专用 venv：后续 pip / 模型下载 / 侧车都只走这里（除非用户覆盖了 Python）
    const env = await ensureManagedVenv()
    if (!env.ok) return env
    const bin = env.python

    if (!looksLikeCosyRepo(root)) {
      installPhase = '正在克隆 CosyVoice 仓库…'
      if (existsSync(root)) {
        // 残缺目录：挪走再拉
        const bak = `${root}.bak-${Date.now()}`
        try {
          const { renameSync } = await import('node:fs')
          renameSync(root, bak)
        } catch {
          /* ignore */
        }
      }
      mkdirSync(join(app.getPath('userData'), 'cosyvoice'), { recursive: true })
      const clone = await runCmd(
        'git',
        ['clone', '--depth', '1', '--recurse-submodules', COSYVOICE_GIT, root],
        { timeoutMs: 600_000 }
      )
      if (clone.code !== 0 || !looksLikeCosyRepo(root)) {
        return {
          ok: false,
          error: `克隆失败：${(clone.stderr || clone.stdout).trim().slice(0, 280) || '请确认已安装 git 且可访问 GitHub'}`
        }
      }
    }

    // 浅克隆常漏掉 Matcha-TTS；已有仓库也补一次子模块
    const matchaInit = join(root, 'third_party', 'Matcha-TTS', 'matcha', '__init__.py')
    if (!existsSync(matchaInit) && existsSync(join(root, '.gitmodules'))) {
      installPhase = '拉取 CosyVoice 子模块（Matcha-TTS）…'
      const sub = await runCmd(
        'git',
        ['submodule', 'update', '--init', '--recursive', '--depth', '1'],
        { cwd: root, timeoutMs: 600_000 }
      )
      if (sub.code !== 0 || !existsSync(matchaInit)) {
        return {
          ok: false,
          error: `子模块未就绪（缺少 Matcha-TTS）：${(sub.stderr || sub.stdout).trim().slice(0, 280) || '请检查 git 网络'}`
        }
      }
    }

    // 只持久化仓库路径；不改 tts 开关（预设默认 off，由用户在设置里显式开启）
    const qc = {
      ...qcSettings(),
      cosyvoiceRoot: root,
      cosyvoiceModel: DEFAULT_COSYVOICE_MODEL,
      cosyvoicePython: customPythonOverride()
    }
    updateSettings({ quickChat: qc })

    const deps = await installSidecarRequirements(bin)
    if (!deps.ok) return deps

    installPhase = '下载 CosyVoice-300M 模型（较大，请耐心等待）…'
    const prep = await prepareCosyVoiceModel()
    if (!prep.ok) return prep

    const voice = ensureDefaultVoiceFromRepo(root)
    if (voice && !qcSettings().ttsVoiceId) {
      updateSettings({
        quickChat: { ...qcSettings(), ttsVoiceId: voice.id }
      })
    }

    installPhase = '检查 CosyVoice 运行依赖…'
    const importCheck = await runCmd(
      bin,
      [
        '-c',
        `import sys; sys.path.insert(0, ${JSON.stringify(root)}); sys.path.insert(0, ${JSON.stringify(join(root, 'third_party', 'Matcha-TTS'))}); import matcha; import cosyvoice; print("ok")`
      ],
      { timeoutMs: 60_000 }
    )
    let warning: string | undefined
    if (importCheck.code !== 0) {
      warning = `专用环境已创建，但导入 CosyVoice 仍失败：${(importCheck.stderr || importCheck.stdout).trim().slice(0, 240) || '请点「继续安装」重试'}`
    } else if (usingManagedEnv()) {
      warning = `依赖已装入专用环境：${managedVenvDir()}（不会改你的系统/conda 包）`
    }

    lastError = undefined
    return { ok: true, cosyRoot: root, modelDir: prep.modelDir, warning }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    lastError = msg
    return { ok: false, error: msg }
  }
}

/**
 * 用 ModelScope 拉模型到 userData（需本机已装 modelscope，一般随 CosyVoice 依赖）。
 */
export async function prepareCosyVoiceModel(): Promise<
  { ok: true; modelDir: string } | { ok: false; error: string }
> {
  const root = cosyRoot()
  if (!root || !existsSync(root)) {
    return { ok: false, error: '请先填写 CosyVoice 仓库根目录' }
  }
  const modelId = normalizeCosyvoiceModel(qcSettings().cosyvoiceModel) || DEFAULT_COSYVOICE_MODEL
  const dest = join(modelsCacheRoot(), sanitizeModelKey(modelId))
  mkdirSync(dest, { recursive: true })
  if (hasModelFiles(dest) || findNestedModelDir(dest)) {
    return { ok: true, modelDir: resolveModelDir(modelId) }
  }

  const bin = pythonBin()
  const py = `
import sys
try:
    from modelscope import snapshot_download
except Exception as e:
    print("ERR:"+str(e), file=sys.stderr)
    sys.exit(2)
path = snapshot_download(${JSON.stringify(modelId)}, local_dir=${JSON.stringify(dest)})
print(path)
`
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const c = spawn(bin, ['-c', py], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      c.stdout.on('data', (b: Buffer) => {
        stdout += b.toString('utf8')
      })
      c.stderr.on('data', (b: Buffer) => {
        stderr += b.toString('utf8')
      })
      c.on('error', reject)
      c.on('close', (code) => {
        if (code === 0 && stdout.trim()) resolve(stdout.trim().split('\n').pop() || dest)
        else reject(new Error(stderr.trim().slice(0, 400) || `下载失败 code=${code}`))
      })
    })
    const resolved = resolveModelDir(out) || resolveModelDir(modelId)
    if (!hasModelFiles(resolved) && !findNestedModelDir(resolved)) {
      return { ok: false, error: '下载完成但未找到模型文件，请检查 ModelScope 缓存' }
    }
    return { ok: true, modelDir: resolveModelDir(modelId) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `准备模型失败：${msg}（需在 CosyVoice 环境中已安装 modelscope）`
    }
  }
}

function resolveSpeakPrompt(input: {
  promptWav?: string
  promptText?: string
}): { ok: true; promptWav: string; promptText: string } | { ok: false; error: string } {
  const voiceId = qcSettings().ttsVoiceId
  const voice = voiceId ? listTtsVoices().find((v) => v.id === voiceId) : null
  const promptWav =
    input.promptWav || voice?.promptWav || defaultPromptWav() || ''
  const promptText =
    input.promptText || voice?.promptText || DEFAULT_COSYVOICE_PROMPT_TEXT
  if (!promptWav || !existsSync(promptWav)) {
    return {
      ok: false,
      error: '缺少参考音色。请在设置里添加自定义音色，或确保 CosyVoice 仓库含 asset/zero_shot_prompt.wav'
    }
  }
  return { ok: true, promptWav, promptText }
}

/**
 * CosyVoice PCM 流：帧到达即回调，便于边合成边播。
 * 帧格式与侧车 /v1/speak-stream 一致（uint32 BE + pcm16le）。
 */
export async function speakViaCosyVoicePcmStream(
  input: { text: string; promptWav?: string; promptText?: string },
  onFrame: (pcm: Buffer, sampleRate: number) => void
): Promise<{ ok: true; sampleRate: number } | { ok: false; error: string }> {
  try {
    await ensureCosyVoiceReady()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
  const prompt = resolveSpeakPrompt(input)
  if (!prompt.ok) return prompt

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 240_000)
  try {
    const res = await fetch(`${baseUrl()}/v1/speak-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        mode: 'zero_shot',
        promptWav: prompt.promptWav,
        promptText: prompt.promptText
      }),
      signal: ctl.signal
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      let err = `HTTP ${res.status}`
      try {
        const j = JSON.parse(body) as { error?: string }
        if (j.error) err = j.error
      } catch {
        if (body) err = body.replace(/\s+/g, ' ').trim().slice(0, 200)
      }
      // 旧侧车无 stream 接口 → 调用方回退 /v1/speak
      if (res.status === 404) return { ok: false, error: 'STREAM_FALLBACK' }
      return { ok: false, error: `CosyVoice 合成失败：${err}` }
    }

    const sampleRate = Number(res.headers.get('X-Sample-Rate') || 22050) || 22050
    const reader = res.body?.getReader()
    if (!reader) return { ok: false, error: 'CosyVoice 流不可读' }

    let pending = Buffer.alloc(0)
    let frames = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending = Buffer.concat([pending, Buffer.from(value)])
      for (;;) {
        if (pending.length < 4) break
        const len = pending.readUInt32BE(0)
        if (len === 0) {
          return { ok: true, sampleRate }
        }
        if (pending.length < 4 + len) break
        const pcm = pending.subarray(4, 4 + len)
        pending = pending.subarray(4 + len)
        if (pcm.length) {
          frames += 1
          onFrame(Buffer.from(pcm), sampleRate)
        }
      }
    }
    if (!frames) return { ok: false, error: 'CosyVoice 返回空音频' }
    return { ok: true, sampleRate }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/abort/i.test(msg)) return { ok: false, error: 'CosyVoice 合成超时' }
    return { ok: false, error: `CosyVoice 请求失败：${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

export async function speakViaCosyVoice(input: {
  text: string
  promptWav?: string
  promptText?: string
}): Promise<{ ok: true; mime: string; base64: string } | { ok: false; error: string }> {
  try {
    await ensureCosyVoiceReady()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }

  const prompt = resolveSpeakPrompt(input)
  if (!prompt.ok) return prompt

  // 优先走 PCM 流并拼回 wav（首包可被 live 路径更早消费；此处保持点播兼容）
  const chunks: Buffer[] = []
  let sampleRate = 22050
  const streamed = await speakViaCosyVoicePcmStream(input, (pcm, sr) => {
    sampleRate = sr
    chunks.push(pcm)
  })
  if (streamed.ok && chunks.length) {
    const pcm = Buffer.concat(chunks)
    const wav = pcm16ToWav(pcm, sampleRate)
    return { ok: true, mime: 'audio/wav', base64: wav.toString('base64') }
  }
  if (streamed.ok === false && streamed.error !== 'STREAM_FALLBACK') {
    // stream 失败再试整段
  }

  // 单块 ~100 字本机合成常见 30–90s；留足余量避免误杀
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 240_000)
  try {
    const res = await fetch(`${baseUrl()}/v1/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        mode: 'zero_shot',
        promptWav: prompt.promptWav,
        promptText: prompt.promptText
      }),
      signal: ctl.signal
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      let err = `HTTP ${res.status}`
      try {
        const j = JSON.parse(body) as { error?: string }
        if (j.error) err = j.error
      } catch {
        if (body) err = body.replace(/\s+/g, ' ').trim().slice(0, 200)
      }
      return { ok: false, error: `CosyVoice 合成失败：${err}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return { ok: false, error: 'CosyVoice 返回空音频' }
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/wav'
    return { ok: true, mime, base64: buf.toString('base64') }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/abort/i.test(msg)) return { ok: false, error: 'CosyVoice 合成超时' }
    return { ok: false, error: `CosyVoice 请求失败：${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const dataSize = pcm.length
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  pcm.copy(buf, 44)
  return buf
}
