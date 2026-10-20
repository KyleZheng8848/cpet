/**
 * 极小的阿里云 OSS 客户端：签名 + 上传 / 列举 / 删除。
 *
 * 为什么不用 ossutil：发布不该依赖一个「这台机器上恰好装了」的 CLI。
 * 实测本机就没有，CI 里更没有；缺了它发布脚本要么失败要么被跳过，
 * 而跳过的后果是「以为发了、其实没发」。这里只用 node 内置模块，
 * 装完依赖就能发。
 *
 * 密钥只从环境变量 / .env.local 读，绝不写进仓库，也绝不打印。
 */
import { createHmac } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { request } from 'node:https'
import { basename, join } from 'node:path'

/** 读 .env.local（已 gitignore）到 process.env，不覆盖已有值。 */
export function loadEnvLocal(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq <= 0) continue
    const key = s.slice(0, eq).trim()
    let value = s.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

/**
 * 解析发布配置（package.json 的 cpet.* + 环境变量 + .env.local）。
 *
 * 发布脚本和 README 生成器共用这一份：两边各解析一次的话，
 * 只要有一处 bucket / 前缀写岔，就会出现「README 链的地址跟实际上传的地址不是同一个」。
 *
 * @param {string} root 仓库根目录
 * @param {{requireCredentials?:boolean}} opts
 */
export function resolveOssConfig(root, { requireCredentials = true } = {}) {
  loadEnvLocal(join(root, '.env.local'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const cpet = pkg.cpet ?? {}

  const target = String(process.env.CPET_OSS_TARGET || cpet.ossTarget || '').trim()
  const m = /^oss:\/\/([^/]+)\/?(.*)$/.exec(target)
  if (!m) {
    throw new Error(
      '缺少上传目标。package.json 加 "cpet": { "ossTarget": "oss://<bucket>/<前缀>/" }，或设 CPET_OSS_TARGET。'
    )
  }
  const endpoint = String(process.env.CPET_OSS_ENDPOINT || cpet.ossEndpoint || '').trim()
  if (!endpoint) {
    throw new Error(
      '缺少 OSS endpoint。package.json 加 "cpet": { "ossEndpoint": "oss-cn-hangzhou.aliyuncs.com" }，或设 CPET_OSS_ENDPOINT。'
    )
  }
  const baseUrl = String(process.env.CPET_DOWNLOAD_BASE_URL || cpet.downloadBaseUrl || '').trim()
  if (!baseUrl) throw new Error('缺少 downloadBaseUrl（写进 latest.json 与下载页的地址前缀）。')

  const accessKeyId = String(process.env.OSS_ACCESS_KEY_ID || '').trim()
  const accessKeySecret = String(process.env.OSS_ACCESS_KEY_SECRET || '').trim()
  if (requireCredentials && (!accessKeyId || !accessKeySecret)) {
    throw new Error(
      '缺少 OSS 密钥。写进 .env.local（已 gitignore，不要写进 package.json）：\n' +
        '  OSS_ACCESS_KEY_ID=...\n' +
        '  OSS_ACCESS_KEY_SECRET=...'
    )
  }

  const n = Number.parseInt(String(cpet.keepReleases ?? ''), 10)
  return {
    pkg,
    cpet,
    version: pkg.version,
    bucket: m[1],
    keyPrefix: m[2] ? (m[2].endsWith('/') ? m[2] : `${m[2]}/`) : '',
    endpoint,
    baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    accessKeyId,
    accessKeySecret,
    keep: Number.isFinite(n) && n > 0 ? n : 20
  }
}

/**
 * Content-Type 必须给准：OSS 不猜，传错了浏览器就按错的来。
 * 最容易踩的是 index.html —— 传成 octet-stream 的话，点开下载页
 * 会弹「保存文件」而不是渲染页面。
 */
const MIME = {
  '.dmg': 'application/x-apple-diskimage',
  '.zip': 'application/zip',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.AppImage': 'application/octet-stream',
  '.json': 'application/json',
  '.blockmap': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8'
}

function contentTypeFor(name) {
  const dot = name.lastIndexOf('.')
  return (dot >= 0 && MIME[name.slice(dot)]) || 'application/octet-stream'
}

/**
 * 值得重试的错误：网络抖动和 OSS 自己的临时故障。
 * 签名错、权限不足、文件不存在这类重试一百次也一样，必须立刻抛出来，
 * 否则只是把「配置写错了」拖成「传了十分钟才报错」。
 */
function isTransient(err) {
  const s = `${err?.code ?? ''} ${err?.message ?? ''}`
  return /ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|RequestTimeout|InternalError|ServiceUnavailable|SlowDown|\b5\d\d\b/i.test(
    s
  )
}

/**
 * OSS V1 签名。
 * CanonicalizedResource 只带 bucket/key —— prefix、max-keys 这类查询参数不是
 * 子资源，混进去签名就对不上（错了只会回 403 SignatureDoesNotMatch，很难查）。
 */
function sign({ secret, method, contentMd5 = '', contentType = '', date, ossHeaders = {}, resource }) {
  const canonHeaders = Object.keys(ossHeaders)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => `${k}:${ossHeaders[Object.keys(ossHeaders).find((x) => x.toLowerCase() === k)]}\n`)
    .join('')
  const raw = [method, contentMd5, contentType, date, `${canonHeaders}${resource}`].join('\n')
  return createHmac('sha1', secret).update(raw, 'utf8').digest('base64')
}

export class OssClient {
  /** @param {{bucket:string, endpoint:string, accessKeyId:string, accessKeySecret:string}} cfg */
  constructor(cfg) {
    this.bucket = cfg.bucket
    this.endpoint = cfg.endpoint
    this.ak = cfg.accessKeyId
    this.sk = cfg.accessKeySecret
    this.host = `${cfg.bucket}.${cfg.endpoint}`
    /** 重试回调，用来在长时间上传里让人看见「不是卡死了，是在重试」。 */
    this.onRetry = cfg.onRetry
  }

  /** 对象的公网地址（能不能匿名下载取决于 ACL，见 putFile 的 acl 参数）。 */
  publicUrl(key) {
    return `https://${this.host}/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  #send({ method, key, query = '', headers = {}, body = null, ossHeaders = {} }) {
    const date = new Date().toUTCString()
    const contentType = headers['Content-Type'] || ''
    const resource = `/${this.bucket}/${key}`
    const signature = sign({
      secret: this.sk,
      method,
      contentType,
      date,
      ossHeaders,
      resource
    })
    const path = `/${key.split('/').map(encodeURIComponent).join('/')}${query}`
    const opts = {
      host: this.host,
      method,
      path,
      headers: {
        ...headers,
        ...ossHeaders,
        Date: date,
        Authorization: `OSS ${this.ak}:${signature}`
      }
    }
    return new Promise((resolve, reject) => {
      const req = request(opts, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, text })
          else {
            const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? String(res.statusCode)
            const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? text.slice(0, 200)
            reject(new Error(`OSS ${method} ${key || '/'} 失败：${code} —— ${msg}`))
          }
        })
      })
      req.on('error', reject)
      if (body && typeof body.pipe === 'function') {
        // 读本地文件出错时如果不 reject，这个 Promise 会永远挂着，看起来像上传卡死
        body.on('error', (err) => {
          req.destroy()
          reject(err)
        })
        body.pipe(req)
      } else req.end(body ?? undefined)
    })
  }

  /**
   * 上传本地文件。默认打 public-read：更新检查是匿名 fetch，
   * 传成私有的等于用户点「检查更新」永远 403。
   *
   * 带重试：一个包要传一分多钟，中途被重置一次是常态。不重试的话，
   * 补传 2.4GB 的历史版本会因为第 11 个文件断一次就整轮白跑。
   * 每次重试都要重新开流——用过的 ReadStream 已经读到一半，不能复用。
   */
  async putFile(localPath, key, { acl = 'public-read', onProgress, retries = 4 } = {}) {
    const size = statSync(localPath).size
    const contentType = contentTypeFor(basename(localPath))
    for (let attempt = 1; ; attempt++) {
      const stream = createReadStream(localPath)
      if (onProgress) {
        let sent = 0
        stream.on('data', (c) => {
          sent += c.length
          onProgress(sent, size)
        })
      }
      try {
        await this.#send({
          method: 'PUT',
          key,
          headers: { 'Content-Type': contentType, 'Content-Length': String(size) },
          ossHeaders: acl ? { 'x-oss-object-acl': acl } : {},
          body: stream
        })
        return { size, url: this.publicUrl(key) }
      } catch (err) {
        stream.destroy()
        if (attempt > retries || !isTransient(err)) throw err
        const waitMs = Math.min(2000 * attempt, 10_000)
        this.onRetry?.({ key, attempt, waitMs, error: err })
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }

  /**
   * 服务端复制（不下载再上传）。
   * 用来维护 CPET-latest-*.dmg 这类固定名：174MB 的包重传一遍纯属浪费，
   * 而固定名是 README / 下载页能长期不失效的前提。
   */
  async copy(srcKey, dstKey, { acl = 'public-read' } = {}) {
    await this.#send({
      method: 'PUT',
      key: dstKey,
      ossHeaders: {
        'x-oss-copy-source': `/${this.bucket}/${srcKey}`,
        ...(acl ? { 'x-oss-object-acl': acl } : {})
      }
    })
    return this.publicUrl(dstKey)
  }

  /**
   * 列出某前缀下的对象（自动翻页）。
   * @returns {Promise<Array<{key:string,size:number,lastModified:string}>>}
   */
  async list(prefix) {
    const items = []
    let marker = ''
    for (;;) {
      const query =
        `?prefix=${encodeURIComponent(prefix)}&max-keys=1000` +
        (marker ? `&marker=${encodeURIComponent(marker)}` : '')
      const { text } = await this.#send({ method: 'GET', key: '', query })
      for (const c of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([^<]+)<\/Key>/.exec(c[1])?.[1]
        if (!key) continue
        items.push({
          key,
          size: Number.parseInt(/<Size>(\d+)<\/Size>/.exec(c[1])?.[1] ?? '0', 10),
          lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(c[1])?.[1] ?? ''
        })
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) break
      marker = items[items.length - 1]?.key
      if (!marker) break
    }
    return items
  }

  async remove(key) {
    await this.#send({ method: 'DELETE', key })
  }
}
