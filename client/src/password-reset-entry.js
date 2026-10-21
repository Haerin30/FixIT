// Run once before React mounts (including StrictMode). Never persist a reset token.
export function captureResetEntry(browser) {
  if (!browser.location.pathname.endsWith('/reset-password')) return undefined
  const token = new URLSearchParams(browser.location.hash.slice(1)).get('token') || ''
  browser.history.replaceState(null, '', browser.location.pathname)
  browser.sessionStorage.removeItem('fixit-token')
  return token
}
