import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function ChatPanel({ repairId, user, token }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const pendingId = useRef(null)
  const bottom = useRef(null)
  const scrollOnUpdate = useRef(true)
  const list = useRef(null)
  useEffect(() => {
    let stopped = false, timer, polling = false
    const controller = new AbortController()
    async function poll() {
      if (polling || stopped) return
      polling = true
      try {
        if (!navigator.onLine) throw new Error('You are offline. Your draft is saved here; reconnect to continue.')
        const data = await api(`/repairs/${repairId}/messages`, { token, signal: controller.signal })
        if (!stopped) { setMessages(data); setError(''); setOnline(true) }
      } catch (e) { if (!stopped) { setError(e.message); setOnline(navigator.onLine) } }
      finally { polling = false; if (!stopped) { setLoading(false); timer = setTimeout(poll, 4000) } }
    }
    function reconnect() { setOnline(navigator.onLine); clearTimeout(timer); poll() }
    poll()
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', reconnect)
    return () => { stopped = true; clearTimeout(timer); controller.abort(); window.removeEventListener('online', reconnect); window.removeEventListener('offline', reconnect) }
  }, [repairId, token])
  const lastMessage = messages.at(-1)?.id
  useEffect(() => { if (scrollOnUpdate.current) bottom.current?.scrollIntoView({ block: 'nearest' }) }, [lastMessage])
  async function send(e) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true); setError('')
    try {
      await api(`/repairs/${repairId}/messages`, { token, method: 'POST', body: { body, messageId: pendingId.current || (pendingId.current = crypto.randomUUID()) } })
      pendingId.current = null; setDraft(''); scrollOnUpdate.current = true
      setMessages(await api(`/repairs/${repairId}/messages`, { token }))
    } catch (e) { setError(e.message) } finally { setSending(false) }
  }
  return <section className="chat-panel" aria-labelledby="chat-title"><div className="section-head"><h3 id="chat-title">Repair conversation</h3><span className={`badge ${!online ? 'badge-neutral' : ''}`}>{online ? 'Updates automatically' : 'Offline'}</span></div><p className="form-help">Only you and the other repair participant can see this conversation. Keep your contact details private.</p>{error && <p role="alert" className="field-error">{error} Messages will retry automatically.</p>}<div className="chat-messages" ref={list} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions" onScroll={() => { const el = list.current; scrollOnUpdate.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70 }}>{loading ? <div className="loading-state"><span className="spinner"/>Loading conversation...</div> : !messages.length ? <div className="chat-empty"><h4>Start the conversation</h4><p>Discuss the device issue, visit time, or repair progress here.</p></div> : messages.map(m => <div className={`chat-bubble ${m.senderId === user.id ? 'mine' : ''}`} key={m.id}><div className="chat-meta"><strong>{m.senderId === user.id ? 'You' : `${m.sender.fname} ${m.sender.lname}`}</strong><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><p>{m.body}</p></div>)}<div ref={bottom}/></div><form onSubmit={send} className="chat-compose"><label htmlFor="chat-draft">Message<textarea id="chat-draft" value={draft} onChange={e => { pendingId.current = null; setDraft(e.target.value) }} maxLength={2000} required placeholder="Write a message about this repair..." disabled={sending}/></label><div className="chat-compose-footer"><small className="muted">{draft.length}/2,000 characters</small><button className="primary" disabled={sending || !draft.trim() || !online}>{sending ? 'Sending...' : 'Send message'}</button></div></form><small className="muted">Showing the most recent 100 messages. New messages are checked every 4 seconds.</small></section>
}
