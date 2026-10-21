import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { captureResetEntry } from '../src/password-reset-entry.js'

test('reset fragment is removed from history and previous authentication is cleared', () => {
  const dom = new JSDOM('', { url: `https://fixit.example/reset-password#token=${'a'.repeat(64)}` })
  dom.window.sessionStorage.setItem('fixit-token', 'old-session')
  assert.equal(captureResetEntry(dom.window), 'a'.repeat(64))
  assert.equal(dom.window.location.href, 'https://fixit.example/reset-password')
  assert.equal(dom.window.sessionStorage.getItem('fixit-token'), null)
  dom.window.close()
})

test('login navigation, generic request, validation, show/hide, loading and successful reset', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/?login=1' })
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'FormData', 'sessionStorage', 'location', 'IS_REACT_ACT_ENVIRONMENT']
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] })
  const originalFetch = globalThis.fetch
  let calls = [], release
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') { calls.push({ url, body: JSON.parse(options.body) }); if (release !== undefined) await new Promise(resolve => { release = resolve }) }
    return { ok: true, json: async () => ({ data: [] }) }
  }
  const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(() => root.unmount()); await vite.close(); dom.window.close(); globalThis.fetch = originalFetch
    for (const [name, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]
  })
  const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
  const click = element => act(() => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })))
  const submit = () => act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await act(async () => root.render(React.createElement(App)))
  const forgot = [...document.querySelectorAll('a')].find(a => a.textContent === 'Forgot Password?')
  assert.ok(forgot); await click(forgot)
  assert.equal(document.querySelector('h1').textContent, 'Forgot Password?')
  document.querySelector('[name="email"]').value = 'OWNER@EXAMPLE.INVALID'
  await submit()
  assert.equal(calls[0].body.email, 'owner@example.invalid')
  assert.match(document.body.textContent, /If an account exists with that email/)
  await click([...document.querySelectorAll('a')].find(a => a.textContent === 'Back to Login'))
  assert.equal(document.querySelector('h1').textContent, 'Welcome back')
  const { default: Recovery } = await vite.ssrLoadModule('/src/components/PasswordRecovery.jsx')
  let login = false
  await act(() => root.render(React.createElement(Recovery, { resetToken: 'a'.repeat(64), onLogin: () => { login = true } })))
  const fill = (password, confirmPassword) => { document.querySelector('[name="password"]').value = password; document.querySelector('[name="confirmPassword"]').value = confirmPassword }
  fill('new-password', 'mismatch'); await submit(); assert.match(document.body.textContent, /Passwords do not match/)
  fill('😀'.repeat(19), '😀'.repeat(19)); await submit(); assert.match(document.body.textContent, /no more than 72/)
  assert.equal(calls.length, 1)
  await click([...document.querySelectorAll('button')].find(b => b.textContent === 'Show Password'))
  assert.equal(document.querySelector('[name="password"]').type, 'text')
  fill('new-password', 'new-password'); release = null; await submit()
  assert.equal(document.querySelector('button.primary').disabled, true)
  await act(async () => release())
  assert.equal(calls[1].body.token, 'a'.repeat(64))
  assert.match(document.body.textContent, /Password updated successfully\./)
  await click(document.querySelector('a')); assert.equal(login, true)
})
