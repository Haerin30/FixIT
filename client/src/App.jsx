import { useEffect, useState } from 'react'
import { api } from './api'
import './App.css'
import './profile.css'
import { TechnicianProfile, TechnicianCard } from './components/TechnicianProfile'
import ProfileEditor from './components/ProfileEditor'
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const label = value => value.replaceAll('_', ' ').toLowerCase()
const fields = form => Object.fromEntries(new FormData(form))
function Input({ name, title, type = 'text', ...props }) { return <label>{title}<input name={name} type={type} required {...props} /></label> }
function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('fixit-token') || '')
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(new URLSearchParams(location.search).has('payment') ? 'repairs' : 'browse')
  const [categories, setCategories] = useState([])
  const [techs, setTechs] = useState([])
  const [repairs, setRepairs] = useState([])
  const [cities, setCities] = useState([])
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [register, setRegister] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [admin, setAdmin] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [listingLoading, setListingLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState({ category: '', city: '' })
  async function run(fn) { setBusy(true); setError(''); setNotice(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  async function loadRepairs() { const data = await api('/repairs', { token }); setRepairs(data); setDetail(old => old ? data.find(r => r.id === old.id) : null) }
  useEffect(() => { api('/categories').then(setCategories).catch(e => setError(e.message)); api('/locations').then(setCities).catch(() => {}) }, [])
  useEffect(() => {
    if (page !== 'browse') return
    let current = true
    api(`/technicians?${new URLSearchParams(filter)}&limit=50`).then(d => { if (current) setTechs(d.technicians) }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setListingLoading(false) })
    return () => { current = false }
  }, [filter, revision, page])
  useEffect(() => { document.getElementById('main-content')?.focus() }, [page])
  useEffect(() => { if (error) document.getElementById('app-error')?.focus() }, [error])
  useEffect(() => {
    if (!token) return
    api('/auth/me', { token }).then(setUser).catch(e => { setError(e.message); setToken(''); sessionStorage.removeItem('fixit-token') })
  }, [token])
  useEffect(() => {
    if (!user) return
    api('/repairs', { token }).then(setRepairs).catch(e => setError(e.message))
    if (user.role === 'Administrator') api('/admin/summary', { token }).then(setAdmin).catch(e => setError(e.message))
  }, [user, token, revision])
  useEffect(() => {
    if (user?.role !== 'Technician' || page !== 'profile') return
    let current = true
    api('/profile', { token }).then(data => { if (current) { setProfile(data); setProfileError('') } }).catch(e => { if (current) setProfileError(e.message) }).finally(() => { if (current) setProfileLoading(false) })
    return () => { current = false }
  }, [user, token, page, revision])
  useEffect(() => {
    const refresh = () => setRevision(old => old + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  async function authenticate(e) {
    e.preventDefault(); const body = fields(e.currentTarget)
    await run(async () => { const data = await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body }); sessionStorage.setItem('fixit-token', data.token); setToken(data.token); setPage((data.user.role?.name || data.user.role) === 'Technician' ? 'profile' : 'repairs'); setNotice('Welcome to FixIT.') })
  }
  async function action(r, actionName, finalCost) { await api(`/repairs/${r.id}/action`, { token, method: 'POST', body: { action: actionName, finalCost } }); await loadRepairs() }
  async function refreshRatings(id) {
    setRevision(old => old + 1)
    if (selected?.id === id) { const d = await api(`/technicians/${id}`); setSelected(d.technician) }
    setNotice('Your review has been published. The technician rating is now updated.')
  }
  async function saveProfile(body) {
    await run(async () => {
      await api('/technicians/profile', { token, method: profile ? 'PUT' : 'POST', body })
      setProfile(await api('/profile', { token }))
      setRevision(old => old + 1)
      setPage('profile')
      setNotice('Profile updated. Your latest details are now displayed.')
    })
  }
  const emptyProfile = { user, specialties: [], serviceAreas: [], yearsExperience: 0, isAvailable: false, rating: { averageRating: null, reviewCount: 0 }, completedRepairs: 0, reviews: [] }
  return <div>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header><a className="brand" href="#" onClick={() => setPage('browse')}>Fix<span>IT</span><small>COMPUTER REPAIR</small></a><nav aria-label="Main navigation"><button aria-current={page === 'browse' ? 'page' : undefined} onClick={() => setPage('browse')}>Find a technician</button>{user && <><button aria-current={page === 'repairs' ? 'page' : undefined} onClick={() => setPage('repairs')}>My repairs</button>{user.role === 'Technician' && <button aria-current={page.startsWith('profile') ? 'page' : undefined} onClick={() => setPage('profile')}>My profile</button>}{user.role === 'Administrator' && <button onClick={() => setPage('admin')}>Dashboard</button>}</>}{user ? <button onClick={() => { sessionStorage.removeItem('fixit-token'); setToken(''); setUser(null); setProfile(null); setProfileLoading(true); setSelected(null); setRepairs([]); setDetail(null); setPage('browse') }}>Sign out</button> : <button className="primary" onClick={() => setPage('auth')}>Sign in / Join</button>}</nav></header>
    <main id="main-content" tabIndex={-1} aria-busy={busy}>
      {busy && <div className="working-indicator" role="status"><span className="spinner"/>Working on your request...</div>}
      {error && <div className="alert" role="alert" id="app-error" tabIndex={-1}>{error}<button onClick={() => setError('')}>Dismiss</button></div>}{notice && <div className="notice" role="status">{notice}</div>}
      {page === 'browse' && <><section className="hero"><div><p className="eyebrow">LOCAL EXPERTS. REAL SOLUTIONS.</p><h1>Your computer.<br/>Back to its best.</h1><p>Find a technician, book a repair, and follow every step.<br/>Pay only when your repair succeeds.</p><a href="#technicians" className="cta">Find your technician ↗</a></div><div className="promise"><span>✓</span><h2>No Fix, No Pay</h2><p>Unsuccessful repair? Your service fee is ₱0. Confirm a successful repair before paying securely through PayMongo test checkout.</p><div className="steps">01 &nbsp; Choose an expert<br/>02 &nbsp; Agree on a schedule<br/>03 &nbsp; Get back up and running</div></div></section><section id="technicians"><div className="section-head"><div><p className="eyebrow">THE RIGHT HELP, NEAR YOU</p><h2>Meet your next technician</h2></div><span>{techs.length} available experts</span></div><div className="filters"><label>Specialty<select value={filter.category} onChange={e => { setListingLoading(true); setFilter({ ...filter, category: e.target.value }) }}><option value="">All repair categories</option>{categories.map(c => <option key={c.id}>{c.name}</option>)}</select></label><label>City<input list="cities" placeholder="All cities" value={filter.city} onChange={e => { setListingLoading(true); setFilter({ ...filter, city: e.target.value }) }}/></label><datalist id="cities">{cities.map(c => <option key={c.code} value={c.name}/>)}</datalist></div><div className="marketplace-results" aria-busy={listingLoading}>{listingLoading && <div className="loading-state" role="status"><span className="spinner"/>Finding technicians...</div>}<div className="grid">{techs.map(t => <TechnicianCard key={t.id} technician={t} disabled={busy} onOpen={() => run(async () => { const d = await api(`/technicians/${t.id}`); setSelected(d.technician); setPage('request') })}/>)}</div>{!listingLoading && !techs.length && <div className="empty"><h3>No technicians match your search</h3><p>Try another city or specialization to find the right help.</p><button onClick={() => { setListingLoading(true); setFilter({ category: '', city: '' }) }}>Clear filters</button></div>}</div></section></>}
      {page === 'auth' && <section className="panel narrow"><p className="eyebrow">WELCOME TO FIXIT</p><h1>{register ? 'Create your account' : 'Welcome back'}</h1><form onSubmit={authenticate}>{register && <><Input name="fname" title="First name" maxLength={100}/><Input name="lname" title="Last name" maxLength={100}/><label>I am a<select name="role"><option>Customer</option><option>Technician</option></select></label></>}<Input name="email" title="Email" type="email" autoComplete="email"/><Input name="password" title="Password" type="password" minLength={8} maxLength={72} autoComplete={register ? 'new-password' : 'current-password'}/><button className="primary" disabled={busy}>{register ? 'Create account' : 'Sign in'}</button></form><button onClick={() => setRegister(!register)}>{register ? 'Already registered? Sign in' : 'New here? Create an account'}</button></section>}
      {page === 'request' && selected && <div className="profile-page"><button className="text-button" onClick={() => setPage('browse')}>Back to technicians</button><TechnicianProfile key={`${selected.id}-${selected.updatedAt}-${selected.rating?.reviewCount}`} profile={selected} owner={user?.id === selected.user?.id} busy={busy} onEdit={() => setPage('profile-edit')} onRequest={() => { document.getElementById('repair-request')?.scrollIntoView({ behavior: 'smooth' }); document.getElementById('request-title')?.focus({ preventScroll: true }) }}/><section className="panel booking-panel" id="repair-request"><p className="eyebrow">BOOK YOUR REPAIR</p><h2 id="request-title" tabIndex={-1}>Request a repair</h2>{!user ? <button className="primary" onClick={() => setPage('auth')}>Sign in to request</button> : user.role !== 'Customer' ? <p>Repair requests are available to customer accounts.</p> : !selected.isAvailable ? <p>This technician is currently unavailable. Browse other technicians or check back later.</p> : <form onSubmit={e => { e.preventDefault(); const body = fields(e.currentTarget); run(async () => { await api('/repairs', { token, method: 'POST', body: { ...body, technicianProfileId: selected.id } }); await loadRepairs(); setPage('repairs'); setNotice('Request sent. Your technician will respond here.') }) }}><Input name="title" title="What needs fixing?" maxLength={120}/><label>Category<select name="repairCategoryId" required><option value="">Choose category</option>{selected.specialties?.map(s => <option key={s.categoryId} value={s.categoryId}>{s.name}</option>)}</select></label><div className="row"><Input name="deviceType" title="Device type" placeholder="Laptop, desktop, printer"/><Input name="deviceModel" title="Device model" required={false}/></div><label>Describe the problem<textarea name="description" required maxLength={2000}/></label><Input name="serviceAddress" title="Full service address" maxLength={500}/><p className="notice">No payment upfront. Unsuccessful repairs carry no service fee.</p><button className="primary" disabled={busy}>Send repair request</button></form>}</section></div>}
      {page === 'repairs' && user && <section><div className="section-head"><div><p className="eyebrow">YOUR REPAIR DESK</p><h1>My repairs</h1></div><button onClick={() => run(loadRepairs)}>Refresh</button></div><div className="repair-layout"><div>{repairs.map(r => <button className={`repair-item ${detail?.id === r.id ? 'chosen' : ''}`} key={r.id} onClick={() => setDetail(r)}><span className="badge">{label(r.status)}</span><h3>{r.title}</h3><p>{r.repairCategory.name} · {new Date(r.createdAt).toLocaleDateString()}</p></button>)}{!repairs.length && <div className="empty">No repair requests yet.</div>}</div>{detail ? <Repair key={detail.id} r={detail} user={user} token={token} busy={busy} run={run} action={action} refresh={loadRepairs} notify={setNotice} onReview={refreshRatings}/> : <div className="empty">Select a repair to see its schedule, progress, payment, and messages.</div>}</div></section>}
      {page === 'profile' && user?.role === 'Technician' && <div className="profile-page"><div className="profile-page-heading"><p className="eyebrow">YOUR PUBLIC PROFILE</p><p>This is how customers see your expertise, services, and feedback.</p></div>{profileLoading ? <div className="loading-state" role="status"><span className="spinner"/>Loading your profile...</div> : profileError ? <div className="empty" role="alert"><h2>Your profile could not be loaded</h2><p>{profileError}</p><button onClick={() => setRevision(old => old + 1)}>Try again</button></div> : <TechnicianProfile key={`${profile?.id}-${profile?.updatedAt}-${profile?.rating?.reviewCount}`} profile={profile || emptyProfile} owner onEdit={() => setPage('profile-edit')}/>}</div>}
      {page === 'profile-edit' && user?.role === 'Technician' && <ProfileEditor key={profile?.updatedAt || 'new'} profile={profile} categories={categories} cities={cities} busy={busy} onCancel={() => setPage('profile')} onSave={saveProfile}/>}
      {page === 'admin' && admin && <section><h1>Marketplace overview</h1><div className="grid">{[['Accounts',admin.users],['Technicians',admin.technicians],['Repair requests',admin.repairs],['Paid (test)',money(admin.paidTotal)]].map(([k,v]) => <article className="card" key={k}><p>{k}</p><h1>{v}</h1></article>)}</div><h2>Repair status breakdown</h2>{admin.statuses.map(s => <p key={s.status}>{label(s.status)}: {s._count._all}</p>)}</section>}
    </main><footer><strong>FixIT</strong><span>Local expertise. Clear progress. No Fix, No Pay.</span><small>Payments run in test mode.</small></footer>
  </div>
}
function Repair({ r, user, token, busy, run, action, refresh, notify, onReview }) {
  const [messages, setMessages] = useState([])
  const customer = user.id === r.customerId
  useEffect(() => { api(`/repairs/${r.id}/messages`, { token }).then(setMessages).catch(() => {}) }, [r.id, token])
  const post = (path, body) => api(`/repairs/${r.id}${path}`, { token, method: 'POST', body })
  return <article className="panel repair-detail"><span className="badge">{label(r.status)}</span><h2>{r.title}</h2><p>{r.description}</p><dl><dt>Device</dt><dd>{r.deviceType} {r.deviceModel}</dd><dt>Customer</dt><dd>{r.customer.fname} {r.customer.lname}</dd><dt>Technician</dt><dd>{r.technicianProfile?.user.fname} {r.technicianProfile?.user.lname}</dd><dt>Service address</dt><dd>{r.serviceAddress}</dd><dt>Final fee</dt><dd>{r.status === 'FAILED' ? '₱0 · No Fix, No Pay' : r.finalCost == null ? 'Confirmed after diagnosis' : money(r.finalCost)}</dd></dl><div className="actions">{!customer && r.status === 'PENDING' && ['accept','reject'].map(a => <button key={a} disabled={busy} onClick={() => run(() => action(r,a))}>{a}</button>)}{customer && ['PENDING','ACCEPTED'].includes(r.status) && <button disabled={busy} onClick={() => run(() => action(r,'cancel'))}>Cancel request</button>}{!customer && r.status === 'ACCEPTED' && <button disabled={busy} onClick={() => run(() => action(r,'start'))}>Start repair</button>}{!customer && r.status === 'IN_PROGRESS' && <button disabled={busy} onClick={() => run(() => action(r,'failed'))}>Mark unsuccessful · No charge</button>}{customer && r.status === 'AWAITING_CUSTOMER_CONFIRMATION' && <button className="primary" disabled={busy} onClick={() => run(() => action(r,'confirm'))}>Confirm successful repair · {money(r.finalCost)}</button>}</div>
    {!customer && r.status === 'IN_PROGRESS' && <form onSubmit={e => { e.preventDefault(); const b = fields(e.currentTarget); run(() => action(r,'finish',Number(b.finalCost))) }}><Input title="Final service fee (PHP)" name="finalCost" type="number" min="0" max="99999999.99" step="0.01"/><button disabled={busy}>Submit successful repair for confirmation</button></form>}
    <h3>Schedule</h3>{r.schedules.map(s => <div className="schedule" key={s.id}><p>{new Date(s.proposedStart).toLocaleString()} – {new Date(s.proposedEnd).toLocaleTimeString()}</p><span>{label(s.status)}</span>{s.status === 'PROPOSED' && s.proposedById !== user.id && r.status === 'ACCEPTED' && <div className="actions">{['CONFIRMED','REJECTED'].map(status => <button disabled={busy} key={status} onClick={() => run(async () => { await post(`/schedules/${s.id}/respond`, { status }); await refresh() })}>{status === 'CONFIRMED' ? 'Confirm' : 'Reject'}</button>)}</div>}</div>)}{r.status === 'ACCEPTED' && <form onSubmit={e => { e.preventDefault(); const b = fields(e.currentTarget); run(async () => { await post('/schedules', { proposedStart: new Date(b.start).toISOString(), proposedEnd: new Date(b.end).toISOString() }); await refresh() }) }}><div className="row"><Input title="Proposed start" name="start" type="datetime-local"/><Input title="Proposed end" name="end" type="datetime-local"/></div><button disabled={busy}>Propose schedule</button></form>}
    {customer && r.status === 'COMPLETED' && Number(r.finalCost) > 0 && <section><h3>Payment · PayMongo test mode</h3><p>{r.payment?.status === 'PAID' ? `Paid ${money(r.payment.amount)}` : `${money(r.finalCost)} due`}</p>{r.payment?.status !== 'PAID' && <button className="primary" disabled={busy} onClick={() => run(async () => { const d = await api(`/payments/${r.id}/checkout`, { token, method: 'POST' }); if (d.checkoutUrl) { const url = new URL(d.checkoutUrl); if (url.protocol !== 'https:' || !url.hostname.endsWith('.paymongo.com')) throw new Error('Invalid checkout URL'); window.location.assign(url.href) } else await refresh() })}>Open test checkout ↗</button>}{r.payment?.providerCheckoutId && <button disabled={busy} onClick={() => run(async () => { const d = await api(`/payments/${r.id}/verify`, { token, method: 'POST' }); await refresh(); notify(d.status === 'PAID' ? 'Payment verified with PayMongo.' : 'Payment is still pending. Return after completing checkout.') })}>Verify payment</button>}</section>}
    {customer && r.status === 'COMPLETED' && r.outcome === 'SUCCESSFUL' && !r.review && <form onSubmit={e => { e.preventDefault(); const b = fields(e.currentTarget); run(async () => { await post('/reviews', { rating: Number(b.rating), comment: b.comment }); await refresh(); await onReview(r.technicianProfileId) }) }}><h3>Review your technician</h3><label>Rating<select name="rating">{[5,4,3,2,1].map(n => <option key={n} value={n}>{n} stars</option>)}</select></label><label>Your experience<textarea name="comment" required maxLength={2000}/></label><button disabled={busy}>Publish review</button></form>}{r.review && <blockquote>{r.review.rating} ★ — {r.review.comment}</blockquote>}
    <h3>Messages</h3><button onClick={() => run(async () => setMessages(await api(`/repairs/${r.id}/messages`, { token })))}>Refresh messages</button><div className="messages">{messages.map(m => <div className={m.senderId === user.id ? 'mine' : ''} key={m.id}><small>{m.sender.fname} · {new Date(m.createdAt).toLocaleString()}</small><p>{m.body}</p></div>)}{!messages.length && <p>No messages yet. Coordinate your repair here.</p>}</div><form onSubmit={e => { e.preventDefault(); const form = e.currentTarget, b = fields(form); run(async () => { await post('/messages', b); setMessages(await api(`/repairs/${r.id}/messages`, { token })); form.reset() }) }}><label>Message<textarea name="body" maxLength={2000} required/></label><button disabled={busy}>Send message</button></form>
  </article>
}
export default App
