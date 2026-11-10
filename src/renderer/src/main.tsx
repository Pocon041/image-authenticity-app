import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initializeTheme } from './theme'
import './styles.css'
import './tokens.css'
import './workbench.css'
import './history-appearance.css'
import './desktop-shell.css'

initializeTheme()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
