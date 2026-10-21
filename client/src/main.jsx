import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PasswordRecovery from './components/PasswordRecovery.jsx'
import { captureResetEntry } from './password-reset-entry.js'

const resetToken = captureResetEntry(window)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {resetToken === undefined ? <App /> : <main><PasswordRecovery resetToken={resetToken} onLogin={() => window.location.replace('/?login=1')}/></main>}
  </StrictMode>,
)
