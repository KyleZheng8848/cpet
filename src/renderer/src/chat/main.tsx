import { t as uiText } from '@shared/i18n'
import { initializeUiLanguage } from '../i18n'
import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from './Chat'
import './chat.css'

type BootState = { error: Error | null }

/** 首屏挂载失败时露出堆栈，避免只剩 Electron backgroundColor 一片空白。 */
class BootErrorBoundary extends Component<{ children: ReactNode }, BootState> {
  state: BootState = { error: null }

  static getDerivedStateFromError(error: Error): BootState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[chat boot]', error, info.componentStack)
    try {
      ;(window as unknown as { __CPET_BOOT_ERROR?: string }).__CPET_BOOT_ERROR =
        error.stack || String(error)
    } catch {
      /* ignore */
    }
  }

  componentDidMount(): void {
    const hot = (import.meta as { hot?: { on: (ev: string, cb: () => void) => void } }).hot
    hot?.on('vite:afterUpdate', () => {
      if (this.state.error) {
        try {
          delete (window as unknown as { __CPET_BOOT_ERROR?: string }).__CPET_BOOT_ERROR
        } catch {
          /* ignore */
        }
        this.setState({ error: null })
      }
    })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'ui-monospace, monospace', color: '#3b2f1e' }}>
          <h1 style={{ fontSize: 16, margin: '0 0 12px' }}>{uiText("对话窗加载失败")}</h1>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.45 }}>
            {this.state.error.stack || String(this.state.error)}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

void initializeUiLanguage().then(() => createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <Chat />
    </BootErrorBoundary>
  </React.StrictMode>
))
