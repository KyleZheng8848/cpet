/**
 * electron-builder afterPack：签名听写 dylib / 助手，与宿主 Identifier 对齐。
 */
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

function signElectron(bin) {
  if (!existsSync(bin)) {
    console.warn('[after-pack-dictation] skip, missing', bin)
    return
  }
  const r = spawnSync(
    'codesign',
    ['--force', '--sign', '-', '--identifier', 'Electron', bin],
    { encoding: 'utf8' }
  )
  if (r.status !== 0) {
    console.error('[after-pack-dictation] codesign failed', bin, r.stderr || r.stdout)
    throw new Error(`codesign failed: ${bin}`)
  }
  console.log('[after-pack-dictation] signed', bin, 'Identifier=Electron')
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  const res = join(app, 'Contents/Resources')
  signElectron(join(res, 'bin/libCpetSpeech.dylib'))
  // 裸助手仅调试用；正式听写走下方 CPET Dictation.app（稳定 com.cpet.speech）
  signElectron(join(res, 'bin/cpet-dictation'))
  // 整包再 ad-hoc 一次，避免助手与宿主签名状态不一致
  const deep = spawnSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', app],
    { encoding: 'utf8' }
  )
  if (deep.status !== 0) {
    console.error('[after-pack-dictation] deep codesign failed', deep.stderr || deep.stdout)
    throw new Error(`deep codesign failed: ${app}`)
  }
  console.log('[after-pack-dictation] deep ad-hoc signed', app)

  // deep 可能改写嵌套助手身份；强制恢复 com.cpet.speech，才能复用「CPET Dictation」开关
  const helperApp = join(res, 'bin/CPET Dictation.app')
  if (existsSync(helperApp)) {
    const helperSign = spawnSync(
      'codesign',
      ['--force', '--sign', '-', '--identifier', 'com.cpet.speech', '--deep', helperApp],
      { encoding: 'utf8' }
    )
    if (helperSign.status !== 0) {
      console.error(
        '[after-pack-dictation] helper re-sign failed',
        helperSign.stderr || helperSign.stdout
      )
      throw new Error('codesign failed: CPET Dictation.app')
    }
    console.log('[after-pack-dictation] signed', helperApp, 'Identifier=com.cpet.speech')
  }
}
