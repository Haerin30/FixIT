import { useRef, useState } from 'react'
import { api } from '../api'

export default function PasswordRecovery({ resetToken, onLogin }) {
  const resetting = resetToken !== undefined
  const token = useRef(resetToken || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [show, setShow] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    setError('')
    if (resetting) {
      if ([...data.password].length < 8 || new TextEncoder().encode(data.password).length > 72) {
        setError('Password must have at least 8 characters and no more than 72 UTF-8 bytes.'); return
      }
      if (data.password !== data.confirmPassword) { setError('Passwords do not match.'); return }
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()) || data.email.trim().length > 254) {
      setError('Please provide a valid email address.'); return
    }
    setBusy(true)
    try {
      await api(resetting ? '/auth/reset-password' : '/auth/forgot-password', {
        method: 'POST', body: resetting ? { ...data, token: token.current } : { email: data.email.trim().toLowerCase() },
      })
      token.current = ''; form.reset(); setSuccess(true)
      if (resetting) sessionStorage.removeItem('fixit-token')
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <section className="panel narrow" aria-labelledby="recovery-title">
    <p className="eyebrow">FIXIT · ACCOUNT RECOVERY</p>
    <h1 id="recovery-title">{resetting ? 'Reset Password' : 'Forgot Password?'}</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {success ? <p role="status">{resetting ? 'Password updated successfully.' : "If an account exists with that email, we'll send a password reset link."}</p> : resetting && !resetToken ? <p role="alert">This reset link is invalid. Please return to Login and request a new link.</p> : <form onSubmit={submit} aria-busy={busy}>
      {resetting ? <>
        <p id="password-help">Use at least 8 characters and no more than 72 UTF-8 bytes. Some characters use more than one byte.</p>
        <label>New Password<input name="password" type={show ? 'text' : 'password'} autoComplete="new-password" required aria-describedby="password-help" /></label>
        <label>Confirm New Password<input name="confirmPassword" type={show ? 'text' : 'password'} autoComplete="new-password" required /></label>
        <button type="button" aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? 'Hide Password' : 'Show Password'}</button>
      </> : <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>}
      <button className="primary" disabled={busy}>{busy ? 'Please wait…' : resetting ? 'Reset Password' : 'Send Reset Link'}</button>
    </form>}
    <a href="/?login=1" onClick={event => { event.preventDefault(); token.current = ''; onLogin() }}>Back to Login</a>
  </section>
}
