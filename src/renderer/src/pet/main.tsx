import { initializeUiLanguage } from '../i18n'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Pet } from './Pet'
import '../theme/chatThemes.css'
import './pet.css'

void initializeUiLanguage().then(() => createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Pet />
  </React.StrictMode>
))
