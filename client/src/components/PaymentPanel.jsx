import { useEffect, useState } from 'react'
import { api } from '../api'
const money = v => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(v || 0))
export default function PaymentPanel({ repair, token, refresh }) {
  const [payment, setPayment] = useState(repair.payment)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!repair.payment?.providerCheckoutId || repair.payment.status === 'PAID') return
    let active = true, timer
    async function verify() {
      try { const p = await api(`/payments/${repair.id}/verify`, { token, method: 'POST' }); if (active) { setPayment(p); setError('') } }
      catch (e) { if (active) setError(e.message) }
      finally { if (active) timer = setTimeout(verify, 20000) }
    }
    verify()
    return () => { active = false; clearTimeout(timer) }
  }, [repair.id, repair.payment?.providerCheckoutId, repair.payment?.status, token])
  const state = payment?.checkoutState || (payment?.status === 'REFUNDED' ? 'REFUNDED' : payment?.status === 'PAID' ? 'PAID' : payment?.status === 'FAILED' ? 'FAILED' : payment?.providerCheckoutId ? 'PENDING' : 'NOT_STARTED')
  const descriptions = { REFUNDED: 'This stored payment is refunded. Another charge is not permitted.', NOT_STARTED: 'Your successful repair is confirmed. Open sandbox checkout to pay securely.', PENDING: 'Checkout is open. Payment is pending confirmation from PayMongo.', PAID: 'PayMongo has verified your payment. Thank you.', FAILED: 'A payment attempt failed. You can reopen the same checkout to retry.', EXPIRED: 'Your previous checkout has expired. You can safely create a new checkout.', CANCELLED: 'Your checkout was cancelled and expired at PayMongo. You can start again.' }
  async function perform(action) {
    setBusy(true); setError(''); setMessage('')
    try {
      const d = await api(`/payments/${repair.id}/${action}`, { token, method: 'POST' })
      if (action === 'checkout') {
        if (d.payment) setPayment(d.payment)
        if (d.checkoutUrl) { const u = new URL(d.checkoutUrl); if (u.protocol !== 'https:' || u.hostname !== 'checkout.paymongo.com') throw new Error('Invalid checkout destination'); window.location.assign(u.href); return }
      } else { setPayment(d); setMessage(action === 'cancel' ? 'Checkout cancelled. No payment was marked successful.' : d.status === 'PAID' ? 'Payment verified with PayMongo.' : 'PayMongo status checked.') }
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <section className="payment-panel" aria-labelledby="payment-title"><div className="section-head"><div><p className="eyebrow">SECURE SANDBOX CHECKOUT</p><h3 id="payment-title">Repair payment</h3></div><span className="badge">{state.replaceAll('_', ' ')}</span></div><strong className="payment-amount">{money(repair.finalCost)}</strong><p>{descriptions[state] || 'Verify with PayMongo to see the latest payment status.'}</p><small className="muted">Test mode only. FixIT never receives your card details. Returning from checkout does not mark the repair paid.</small>{error && <p role="alert" className="field-error">{error}</p>}{message && <p role="status" className="notice">{message}</p>}<div className="actions">{!['PAID','REFUNDED'].includes(state) && <button className="primary" disabled={busy} onClick={() => perform('checkout')}>{busy ? 'Contacting PayMongo...' : ['EXPIRED','CANCELLED'].includes(state) ? 'Create new test checkout' : 'Open test checkout'}</button>}{payment?.providerCheckoutId && <button disabled={busy} onClick={() => perform('verify')}>Verify payment</button>}{payment?.providerCheckoutId && !['PAID','REFUNDED','EXPIRED','CANCELLED'].includes(state) && <button disabled={busy} onClick={() => { if (window.confirm('Cancel this unpaid checkout? PayMongo will expire it before a new checkout can be created.')) perform('cancel') }}>Cancel checkout</button>}</div></section>
}
