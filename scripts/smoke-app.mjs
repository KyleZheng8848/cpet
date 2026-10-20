/**
 * Whole-app smoke test using the built Electron app and an isolated HOME/userData.
 * A loopback SSE fixture verifies UI → IPC → HTTP, cancellation and persistence.
 * No real provider credentials or user chat data are used. Build first.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const require = createRequire(join(root, 'package.json'))
const electron = require('electron')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

if (typeof electron === 'string') {
  const dir = mkdtempSync(join(tmpdir(), 'cpet-runtime-'))
  const home = join(dir, 'home')
  const userData = join(dir, 'userData')
  const work = join(dir, 'project 多语言 日本語 🐾')
  for (const p of [home, userData, work]) mkdirSync(p, { recursive: true })
  writeFileSync(join(work, '说明 café 日本語.txt'), '中文 café 日本語 🐾', 'utf8')
  const requests = []
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/update.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ version: sourceVersion, assets: [] }))
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    requests.push({ path: req.url, model: body.model, messages: body.messages?.length })
    const prompt = body.messages?.at(-1)?.content || ''
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    if (JSON.stringify(prompt).includes('CANCEL_CHECK')) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '正在等待取消' } }] }) + '\n\n')
      return
    }
    for (const content of ['运行验收', '成功']) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n')
      await wait(50)
    }
    res.end('data: [DONE]\n\n')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    skin: 'violet', uiLanguage: 'zh-CN', cwd: work, setupPromptShown: true, onboardingGoal: 'skipped',
    defaultModelRef: 'runtime-test:test-model', quickChat: { tts: 'off', enabled: false },
    modelProviders: [{ id: 'runtime-test', kind: 'custom', label: '本地验收接口', enabled: true,
      order: 0, apiFormat: 'openai', baseUrl, apiKey: 'test-only',
      models: [{ id: 'test-model', label: '测试模型', enabled: true, order: 0 }] }]
  }))
  const now = Date.now()
  writeFileSync(join(userData, 'chat-store.json'), JSON.stringify({ activeId: 'runtime-chat', conversations: [{
    id: 'runtime-chat', title: '整体可用性验收', kind: 'chat', cwd: work,
    modelRef: 'runtime-test:test-model', messages: [], createdAt: now, updatedAt: now,
    activeThreadId: 'runtime-thread'
  }] }))
  const env = { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'),
    CPET_RUNTIME_DIR: dir, CPET_RUNTIME_WORK: work, CPET_RUNTIME_USER_DATA: userData,
    CPET_RUNTIME_API_URL: baseUrl }
  for (const key of Object.keys(env)) {
    if (/proxy|ELECTRON_RENDERER_URL|CPET_(UPDATE_MANIFEST_URL|RELEASES_URL|SKIN_CATALOG_URL|DOWNLOAD_BASE_URL)/i.test(key)) delete env[key]
  }
  env.CPET_UPDATE_MANIFEST_URL = baseUrl.replace(/\/v1$/, '') + '/update.json'
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [fileURLToPath(import.meta.url)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (c) => { logs += c; process.stdout.write(c) })
  const timer = setTimeout(() => child.kill('SIGTERM'), 100_000)
  const code = await new Promise((resolve) => {
    child.once('error', (error) => {
      console.error('[smoke-app] Electron could not start. Reinstall dependencies for this machine:', error.message)
      resolve(1)
    })
    child.once('exit', (code) => resolve(code ?? 1))
  })
  clearTimeout(timer)
  writeFileSync(join(dir, 'runtime.log'), logs)
  writeFileSync(join(dir, 'requests.json'), JSON.stringify(requests, null, 2))
  server.closeAllConnections()
  server.close()
  console.log('EVIDENCE_DIR=' + dir)
  process.exitCode = code
} else {
  const { app, BrowserWindow } = electron
  const dir = process.env.CPET_RUNTIME_DIR
  const userData = process.env.CPET_RUNTIME_USER_DATA
  const work = process.env.CPET_RUNTIME_WORK
  const report = { checks: [], rendererErrors: [], mainErrors: [], failures: [] }
  const check = (name, ok, details) => {
    report.checks.push({ name, ok: !!ok, details })
    console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(details ?? ''))
    if (!ok) report.failures.push(name)
  }
  process.on('uncaughtException', (e) => { report.mainErrors.push(e.stack); console.error('MAIN_ERROR', e.stack) })
  process.on('unhandledRejection', (e) => { report.mainErrors.push(String(e?.stack || e)); console.error('MAIN_REJECTION', e) })
  app.setName('cursor-pet')
  app.setPath('home', process.env.HOME)
  app.setPath('userData', userData)
  app.getAppPath = () => root
  app.getVersion = () => sourceVersion
  app.on('web-contents-created', (_e, wc) => {
    wc.on('render-process-gone', (_e, details) => report.rendererErrors.push({ type: 'gone', details }))
    wc.on('did-fail-load', (_e, code, text, url) => { if (code !== -3) report.rendererErrors.push({ code, text, url }) })
    wc.on('console-message', (_e, level, message) => {
      if (level >= 3) report.rendererErrors.push({ message, url: wc.getURL() })
    })
  })
  require(join(root, 'out/main/index.js'))
  async function until(fn, ms = 20_000) {
    const end = Date.now() + ms
    while (Date.now() < end) { const result = await fn(); if (result) return result; await wait(150) }
    throw new Error('Timeout waiting for runtime state')
  }
  function clickCode(selector) {
    return `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return false; e.click(); return true })()`
  }
  app.whenReady().then(async () => {
    try {
      const chat = await until(() => BrowserWindow.getAllWindows().find((w) => /\/chat\.html/.test(w.webContents.getURL())))
      const pet = await until(() => BrowserWindow.getAllWindows().find((w) => /\/pet\.html/.test(w.webContents.getURL())))
      const js = (code) => chat.webContents.executeJavaScript(code, true)
      await until(() => js('!!document.querySelector(".chat-root") && !!window.petApi'))
      check('主窗口与 preload 成功挂载', true, await js('({title:document.title, bootError:window.__CPET_BOOT_ERROR||null})'))
      await wait(800)
      check('宠物窗口成功挂载', await pet.webContents.executeJavaScript('!!document.getElementById("root")?.firstElementChild'))
      const initial = await js(`Promise.all([window.petApi.getAppInfo(), window.petApi.getSettings(), window.petApi.getImagePacks(), window.petApi.getAgentStatus()]).then(([info,s,packs,status])=>({info,providers:s.modelProviders.map(p=>p.id),packs:packs.map(p=>({id:p.id,name:p.name})),status:{installed:status.installed,engines:status.engines}}))`)
      check('内置公开引擎目录可读取', initial.providers.includes('cursor') && initial.providers.includes('codex') && initial.providers.includes('claude-code') && initial.providers.includes('opencode'), initial.providers)
      check('已移除的内部引擎不会重新出现', !initial.providers.some((p) => /cfuse|dtcoder|theta|antchat/i.test(p)))
      check('本地内置皮肤可读取', initial.packs.length >= 2, initial.packs)
      await writeFileSync(join(dir, 'main.png'), (await chat.webContents.capturePage()).toPNG())
      await writeFileSync(join(dir, 'pet.png'), (await pet.webContents.capturePage()).toPNG())
      check('新建任务对话框可打开', await js(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('新建任务'));b?.click();return !!b})()`))
      await until(() => js('!!document.querySelector(".new-task-dialog")'))
      check('新建任务表单完整', await js('!!document.querySelector("#new-task-title") && !!document.querySelector(".new-task-kinds")'))
      await js(clickCode('.new-task-close'))
      check('设置入口可操作', await js(clickCode('button[aria-label="设置"]')))
      await until(() => js('!!document.querySelector("#settings-setup")'))
      check('设置页不含内部引擎入口', await js('!/CFuse|DTCoder|Theta|AntChat/.test(document.body.innerText)'))
      await writeFileSync(join(dir, 'settings.png'), (await chat.webContents.capturePage()).toPNG())
      // Return to the chat through the actual navigation IPC.
      chat.webContents.send('window:panel', { panel: 'chat', conversationId: 'runtime-chat' })
      // Query API outcomes independently of navigation state.
      const sources = await js('Promise.all([window.petApi.checkForUpdate(),window.petApi.fetchSkinMarket()]).then(([update,market])=>({update,market:{status:market.status,message:market.message}}))')
      check('本地更新清单能匹配当前源码版本', sources.update.status === 'up-to-date', sources.update)
      check('无市场源时本地皮肤功能保持可用', sources.market.status === 'not-configured', sources.market)
      await js('window.petApi.openSkins()')
      const skins = await until(() => BrowserWindow.getAllWindows().find((w) => /\/skins\.html/.test(w.webContents.getURL())))
      await until(() => skins.webContents.executeJavaScript('!!document.querySelector(".skin-market")'))
      check('独立皮肤窗口正常显示', true)
      await writeFileSync(join(dir, 'skins.png'), (await skins.webContents.capturePage()).toPNG())
      await skins.webContents.executeJavaScript(`(()=>{[...document.querySelectorAll('.skin-market-tabs button')].find(b=>b.textContent.includes('市场'))?.click()})()`)
      await wait(500)
      check('皮肤市场未配置时有明确提示', await skins.webContents.executeJavaScript('/未配置/.test(document.body.innerText)'))
      chat.webContents.send('window:panel', { panel: 'chat', conversationId: 'runtime-chat' })
      await until(() => js(`!!document.querySelector('textarea[aria-label="消息输入框"]')`))
      await js(`window.__runtimeEvents=[];window.petApi.onAgentEvent(e=>{if(e.conversationId==='runtime-chat')window.__runtimeEvents.push(e)});true`)
      await js(`(()=>{const input=document.querySelector('textarea[aria-label="消息输入框"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'RUNTIME_CHECK');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
      await wait(200)
      await js(clickCode('button[aria-label="发送"]'))
      await until(() => js(`window.__runtimeEvents.some(e=>['done','error'].includes(e.type))`))
      const chatResult = await js(`({events:window.__runtimeEvents,text:window.__runtimeEvents.filter(e=>e.type==='assistant-delta').map(e=>e.text).join('')})`)
      check('真实 UI→IPC→主进程→HTTP→流式回复链路', chatResult.events.at(-1)?.type === 'done' && chatResult.text.includes('运行验收成功'), { text: chatResult.text, events: chatResult.events.map((e) => e.type) })
      await writeFileSync(join(dir, 'chat-reply.png'), (await chat.webContents.capturePage()).toPNG())
      const cancelResult = await js(`new Promise(async(resolve,reject)=>{let stop=()=>{};const types=[];const timer=setTimeout(()=>{stop();reject(new Error('cancel timeout'))},12000);stop=window.petApi.onAgentEvent(e=>{if(e.conversationId!=='cancel-check')return;types.push(e.type);if(e.type==='assistant-delta')void window.petApi.cancel('cancel-check');if(['aborted','done','error'].includes(e.type)){clearTimeout(timer);stop();resolve(types)}});await window.petApi.sendPrompt({conversationId:'cancel-check',prompt:'CANCEL_CHECK',model:'runtime-test:test-model',cwd:${JSON.stringify(work)}})})`)
      check('生成中可取消并收到终态', cancelResult.includes('aborted'), cancelResult)
      const unicode = await js(`window.petApi.readAttachmentText(${JSON.stringify(join(work, '说明 café 日本語.txt'))})`)
      check('非英文路径与 UTF-8 文本附件可读', unicode.ok && unicode.text==='中文 café 日本語 🐾')
      const schedules = await js('window.petApi.getSchedules()')
      check('定时任务存储可读取', Array.isArray(schedules))
      // The chat renderer owns persistence for the test conversation.
      await wait(500)
      const store = JSON.parse(readFileSync(join(userData, 'chat-store.json'), 'utf8'))
      const conv = store.conversations.find((c) => c.id === 'runtime-chat')
      check('回复已落盘', JSON.stringify(conv).includes('运行验收成功'))
      await js(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'草稿 draft 日本語 🐾');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
      await wait(100)
      chat.webContents.send('window:panel', { panel: 'settings' })
      await until(() => js(`!!document.querySelector('#ui-language')`))
      await js(`(()=>{const select=document.querySelector('#ui-language');select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
      const changed = await until(async () => {const lang=await js(`window.petApi.getUiLanguage()`);return lang.locale==='en' && lang})
      await until(() => js(`document.documentElement.lang==='en'`))
      check('英文切换同步聊天窗口', changed.locale==='en' && await js(`document.documentElement.lang==='en'`))
      check('英文切换同步宠物与皮肤窗口', await pet.webContents.executeJavaScript(`document.documentElement.lang==='en'`) && await skins.webContents.executeJavaScript(`document.documentElement.lang==='en'`))
      check('聊天正文不会被语言切换改写', JSON.stringify(await js(`window.petApi.getChatStore()`)).includes('运行验收成功'))
      chat.webContents.send('window:panel', { panel: 'settings' })
      await until(() => js(`!!document.querySelector('#ui-language')`))
      await wait(350)
      await writeFileSync(join(dir, 'settings-en.png'), (await chat.webContents.capturePage()).toPNG())
      const enUi = await js(`({text:document.body.innerText,lang:document.documentElement.lang,selected:document.querySelector('#ui-language')?.value,overflow:document.documentElement.scrollWidth>innerWidth})`)
      writeFileSync(join(dir, 'settings-en.txt'), enUi.text)
      check('英文设置页可用且语言偏好已保存', enUi.selected==='en' && JSON.parse(readFileSync(join(userData,'settings.json'),'utf8')).uiLanguage==='en')
      check('英文设置页面无水平溢出', !enUi.overflow)
      chat.webContents.send('window:panel', { panel: 'chat', conversationId: 'runtime-chat' })
      await until(() => js(`!!document.querySelector('textarea[aria-label="Message input"]')`))
      check('切换语言不丢失未发送草稿', await js(`document.querySelector('textarea').value==='草稿 draft 日本語 🐾'`))
      check('英文对话界面可用且保留原文回复', await js(`document.body.innerText.includes('运行验收成功')`))
      await wait(200)
      await writeFileSync(join(dir, 'chat-en.png'), (await chat.webContents.capturePage()).toPNG())
      chat.webContents.send('window:panel', { panel: 'settings' })
      await until(() => js(`!!document.querySelector('#ui-language')`))
      const automatic = await js(`window.petApi.setUiLanguage('system')`)
      check('跟随系统模式可保存并解析语言', automatic.preference==='system' && ['en','zh-CN'].includes(automatic.locale))
      await js(`window.petApi.setUiLanguage('zh-CN')`)
      await until(() => js(`document.documentElement.lang==='zh-CN'`))
      check('中文切换可恢复且不重置对话', await js(`document.body.innerText.includes('界面语言')`))
      check('渲染进程无错误或崩溃', report.rendererErrors.length === 0, report.rendererErrors)
      check('主进程无未处理异常', report.mainErrors.length === 0, report.mainErrors)
    } catch (error) {
      report.failures.push(String(error.stack || error))
      console.error('RUNTIME_FAIL', error.stack)
    } finally {
      writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2))
      console.log('RUNTIME_REPORT=' + join(dir, 'report.json'))
      const code = report.failures.length ? 1 : 0
      // Invoke application cleanup before forcing process shutdown.
      app.once('will-quit', (event) => { event.preventDefault(); app.exit(code) })
      app.quit()
      setTimeout(() => app.exit(code), 2000).unref()
    }
  })
}
