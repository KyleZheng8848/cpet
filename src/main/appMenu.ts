import type { MenuItemConstructorOptions } from 'electron'
import { t as uiText } from '../shared/i18n'

export function applicationMenuTemplate(
  platform: string,
  onAbout: () => void
): MenuItemConstructorOptions[] {
  const about = { label: uiText('关于 CPET'), click: onAbout }
  const appMenu: MenuItemConstructorOptions = platform === 'darwin'
    ? { label: 'CPET', submenu: [about, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }
    : { label: uiText('关于'), submenu: [about, { role: 'quit' }] }
  return [appMenu, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]
}
