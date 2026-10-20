import { initializeUiLanguage } from '../i18n'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SkinsApp } from './SkinsApp'
import './skins.css'

void initializeUiLanguage().then(() => createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SkinsApp />
  </React.StrictMode>
))
