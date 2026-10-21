import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import './App.css'
import './profile.css'
import './operations.css'
import './account-messages.css'
import { TechnicianProfile, TechnicianCard } from './components/TechnicianProfile'
import ProfileEditor from './components/ProfileEditor'
import AccountMenu from './components/AccountMenu'
import AccountPage from './components/AccountPage'
import MessagesPage from './components/MessagesPage'
import SchedulingPanel from './components/SchedulingPanel'
import FinalPriceEditor from './components/FinalPriceEditor'
import RepairRequestCard from './components/RepairRequestCard'
import PaymentPanel from './components/PaymentPanel'
import AdminDashboard from './components/AdminDashboard'
import PasswordRecovery from './components/PasswordRecovery'
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const label = value => value.replaceAll('_', ' ').toLowerCase()
const fields = form => Object.fromEntries(new FormData(form))
function Input({ name, title, type = 'text', ...props }) { return <label>{title}<input name={name} type={type} required {...props} /></label> }
function App() {
  const bookingKey = useRef(null)
  const [token, setToken] = useState(() => sessionStorage.getItem('fixit-token') || '')
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(location.pathname.endsWith('/forgot-password') ? 'forgot-password' : new URLSearchParams(location.search).has('login') ? 'auth' : new URLSearchParams(location.search).has('payment') ? 'repairs' : 'browse')
  const [categories, setCategories] = useState([])
  const [techs, setTechs] = useState([])
  const [repairs, setRepairs] = useState([])
  const [repairsLoading, setRepairsLoading] = useState(true)
  const [cities, setCities] = useState([])
  const [locationsState, setLocationsState] = useState('loading')
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [conversationTarget, setConversationTarget] = useState(null)
  const [register, setRegister] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [listingLoading, setListingLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState({ category: '', city: '' })
  async function run(fn) { setBusy(true); setError(''); setNotice(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  async function loadRepairs() { const data = await api('/repairs', { token }); setRepairs(data); setDetail(old => old ? data.find(r => r.id === old.id) || old : null) }
  async function loadCities() { setLocationsState('loading'); try { setCities(await api('/locations')); setLocationsState('ready') } catch { setLocationsState('error') } }
  useEffect(() => { api('/categories').then(setCategories).catch(e => setError(e.message)); api('/locations').then(data => { setCities(data); setLocationsState('ready') }).catch(() => setLocationsState('error')) }, [])
  useEffect(() => {
    if (page !== 'browse') return
    let current = true
    api(`/technicians?${new URLSearchParams({ ...filter, city: cities.find(c => c.name === filter.city)?.alias || filter.city })}&limit=50`).then(d => { if (current) setTechs(d.technicians) }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setListingLoading(false) })
    return () => { current = false }
  }, [filter, revision, page, cities])
  useEffect(() => { document.getElementById('main-content')?.focus() }, [page])
  useEffect(() => { if (error) document.getElementById('app-error')?.focus() }, [error])
  useEffect(() => {
    if (!token) return
    let active = true
    const controller = new AbortController()
    api('/auth/me', { token, signal: controller.signal }).then(data => { if (active) setUser(data) }).catch(e => { if (active) { setError(e.message); setToken(''); sessionStorage.removeItem('fixit-token') } })
    return () => { active = false; controller.abort() }
  }, [token])
  useEffect(() => {
    if (!user || user.role === 'Administrator') return
    let active = true, timer
    const controller = new AbortController()
    async function update() {
      try {
        const records = await api('/repairs', { token, signal: controller.signal })
        if (active) { setRepairs(records); setDetail(old => records.find(r => r.id === (old?.id || new URLSearchParams(location.search).get('repair'))) || null) }
      } catch (e) { if (active) setError(e.message) }
      finally { if (active) { setRepairsLoading(false); timer = setTimeout(update, 10000) } }
    }
    update()
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [user, token, revision])
  useEffect(() => {
    function expired() { sessionStorage.removeItem('fixit-token'); setToken(''); setUser(null); setProfile(null); setProfileLoading(true); setRepairsLoading(true); setDetail(null); setConversationTarget(null); setRepairs([]); setPage('auth'); setNotice('Your session expired or account access changed. Please sign in again.') }
    window.addEventListener('fixit:session-expired', expired)
    return () => window.removeEventListener('fixit:session-expired', expired)
  }, [])
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
  async function action(r, actionName, finalCost) { if (['cancel','reject','failed','confirm'].includes(actionName) && !window.confirm({ cancel: 'Cancel this repair request?', reject: 'Reject this repair request?', failed: 'Close this repair as unsuccessful? The customer will owe no service fee.', confirm: 'Confirm that the repair was successful and accept the displayed final service fee?' }[actionName])) return; await api(`/repairs/${r.id}/action`, { token, method: 'POST', body: { action: actionName, finalCost, ...(actionName === 'confirm' ? { priceVersion: r.priceVersion } : {}) } }); await loadRepairs() }
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
  function signOut() { window.history.replaceState(null,'',window.location.pathname); bookingKey.current = null; sessionStorage.removeItem('fixit-token'); setToken(''); setUser(null); setProfile(null); setProfileLoading(true); setRepairsLoading(true); setSelected(null); setRepairs([]); setDetail(null); setConversationTarget(null); setError(''); setNotice('You have signed out.'); setPage('browse') }
  function openMessages(repair) { setConversationTarget(repair); setPage('messages') }
  function viewRepair(repair) { setDetail(repair); setPage('repairs') }
  const emptyProfile = { user, specialties: [], serviceAreas: [], yearsExperience: 0, isAvailable: false, rating: { averageRating: null, reviewCount: 0 }, completedRepairs: 0, reviews: [] }
  return <div>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="app-header"><a className="brand" href="#" onClick={() => setPage('browse')}>Fix<span>IT</span><small>COMPUTER REPAIR</small></a><nav aria-label="Main navigation"><button aria-current={page === 'browse' ? 'page' : undefined} onClick={() => setPage('browse')}>Find a technician</button>{user && user.role !== 'Administrator' && <><button aria-current={page === 'repairs' ? 'page' : undefined} onClick={() => setPage('repairs')}>My Repairs</button><button aria-current={page === 'messages' ? 'page' : undefined} onClick={() => setPage('messages')}>Messages</button></>}{user?.role === 'Administrator' && <button aria-current={page === 'admin' ? 'page' : undefined} onClick={() => setPage('admin')}>Dashboard</button>}</nav>{user ? <AccountMenu user={user} onNavigate={setPage} onSignOut={signOut}/> : <button className="primary" onClick={() => setPage('auth')}>Sign in / Join</button>}</header>
    <main id="main-content" tabIndex={-1} aria-busy={busy}>
      {new URLSearchParams(location.search).has('payment') && page === 'repairs' && <div className="notice" role="status">You returned from sandbox checkout. The return URL does not confirm payment. Select your repair to verify the latest status with PayMongo.</div>}
      {token && !user && <div className="loading-state" role="status"><span className="spinner"/>Restoring your session...</div>}
      {busy && <div className="working-indicator" role="status"><span className="spinner"/>Working on your request...</div>}
      {error && <div className="alert" role="alert" id="app-error" tabIndex={-1}>{error}<button onClick={() => setError('')}>Dismiss</button></div>}{notice && <div className="notice" role="status">{notice}</div>}
      {page === 'browse' && <><section className="hero"><div><p className="eyebrow">LOCAL EXPERTS. REAL SOLUTIONS.</p><h1>Your computer.<br/>Back to its best.</h1><p>Find a technician, book a repair, and follow every step.<br/>Pay only when your repair succeeds.</p><a href="#technicians" className="cta">Find your technician ↗</a></div><div className="promise"><span>✓</span><h2>No Fix, No Pay</h2><p>Unsuccessful repair? Your service fee is ₱0. Confirm a successful repair before paying securely through PayMongo test checkout.</p><div className="steps">01 &nbsp; Choose an expert<br/>02 &nbsp; Agree on a schedule<br/>03 &nbsp; Get back up and running</div></div></section><section id="technicians"><div className="section-head"><div><p className="eyebrow">THE RIGHT HELP, NEAR YOU</p><h2>Meet your next technician</h2></div><span>{techs.length} available experts</span></div><div className="filters"><label>Specialty<select value={filter.category} onChange={e => { setListingLoading(true); setFilter({ ...filter, category: e.target.value }) }}><option value="">All repair categories</option>{categories.map(c => <option key={c.id}>{c.name}</option>)}</select></label><label>City<input list="cities" placeholder="All cities" value={filter.city} onChange={e => { setListingLoading(true); setFilter({ ...filter, city: e.target.value }) }}/></label><datalist id="cities">{cities.map(c => <option key={c.code} value={c.alias || c.name}/>)}</datalist></div><div className="location-help">{locationsState === 'loading' ? <small role="status">Loading Philippine city suggestions...</small> : locationsState === 'error' ? <small>City suggestions are unavailable. Type your city manually. <button className="text-button" onClick={loadCities}>Retry suggestions</button></small> : <small>City suggestions supplied by the Philippine PSGC public API.</small>}</div><div className="marketplace-results" aria-busy={listingLoading}>{listingLoading && <div className="loading-state" role="status"><span className="spinner"/>Finding technicians...</div>}<div className="grid">{techs.map(t => <TechnicianCard key={t.id} technician={t} disabled={busy} onOpen={() => run(async () => { const d = await api(`/technicians/${t.id}`); setSelected(d.technician); bookingKey.current = crypto.randomUUID(); setPage('request') })}/>)}</div>{!listingLoading && !techs.length && <div className="empty"><h3>No technicians match your search</h3><p>Try another city or specialization to find the right help.</p><button onClick={() => { setListingLoading(true); setFilter({ category: '', city: '' }) }}>Clear filters</button></div>}</div></section></>}
      {page === 'auth' && <section className="panel narrow"><p className="eyebrow">WELCOME TO FIXIT</p><h1>{register ? 'Create your account' : 'Welcome back'}</h1><form onSubmit={authenticate}>{register && <><Input name="fname" title="First name" maxLength={100}/><Input name="lname" title="Last name" maxLength={100}/><label>I am a<select name="role"><option>Customer</option><option>Technician</option></select></label></>}<Input name="email" title="Email" type="email" autoComplete="email"/><Input name="password" title="Password" type="password" minLength={8} maxLength={72} autoComplete={register ? 'new-password' : 'current-password'}/>{!register && <a href="/forgot-password" onClick={e => { e.preventDefault(); setError(''); setNotice(''); setPage('forgot-password') }}>Forgot Password?</a>}<button className="primary" disabled={busy}>{register ? 'Create account' : 'Sign in'}</button></form><button onClick={() => setRegister(!register)}>{register ? 'Already registered? Sign in' : 'New here? Create an account'}</button></section>}
      {page === 'forgot-password' && <PasswordRecovery onLogin={() => { setRegister(false); setPage('auth') }}/>}
      {page === 'request' && selected && <div className="profile-page"><button className="text-button" onClick={() => setPage('browse')}>Back to technicians</button><TechnicianProfile key={`${selected.id}-${selected.updatedAt}-${selected.rating?.reviewCount}`} profile={selected} owner={user?.id === selected.user?.id} busy={busy} onEdit={() => setPage('profile-edit')} onRequest={() => { document.getElementById('repair-request')?.scrollIntoView({ behavior: 'smooth' }); document.getElementById('request-title')?.focus({ preventScroll: true }) }}/><section className="panel booking-panel" id="repair-request"><p className="eyebrow">BOOK YOUR REPAIR</p><h2 id="request-title" tabIndex={-1}>Request a repair</h2>{!user ? <button className="primary" onClick={() => setPage('auth')}>Sign in to request</button> : user.role !== 'Customer' ? <p>Repair requests are available to customer accounts.</p> : !selected.isAvailable ? <p>This technician is currently unavailable. Browse other technicians or check back later.</p> : <form onSubmit={e => { e.preventDefault(); const body = fields(e.currentTarget); run(async () => { await api('/repairs', { token, method: 'POST', body: { ...body, requestId: bookingKey.current || (bookingKey.current = crypto.randomUUID()), technicianProfileId: selected.id } }); await loadRepairs(); bookingKey.current = null; setPage('repairs'); setNotice('Request sent. Your technician will respond here.') }) }}><Input name="title" title="What needs fixing?" maxLength={120}/><label>Category<select name="repairCategoryId" required><option value="">Choose category</option>{selected.specialties?.map(s => <option key={s.categoryId} value={s.categoryId}>{s.name}</option>)}</select></label><div className="row"><Input name="deviceType" title="Device type" placeholder="Laptop, desktop, printer"/><Input name="deviceModel" title="Device model" required={false}/></div><label>Describe the problem<textarea name="description" required maxLength={2000}/></label><Input name="serviceAddress" title="Full service address" maxLength={500}/><p className="notice">No payment upfront. Unsuccessful repairs carry no service fee.</p><button className="primary" disabled={busy}>Send repair request</button></form>}</section></div>}
      {page === 'repairs' && user && <section><div className="section-head"><div><p className="eyebrow">YOUR REPAIR DESK</p><h1>My repairs</h1></div><button onClick={() => run(loadRepairs)}>Refresh</button></div><div className="repair-layout"><div>{repairs.map(r => <RepairRequestCard key={r.id} repair={r} user={user} selected={detail?.id === r.id} onDetails={() => setDetail(r)} onMessage={() => openMessages(r)}/>)}{repairsLoading ? <div className="loading-state" role="status"><span className="spinner"/>Loading your repairs...</div> : !repairs.length && <div className="empty"><h3>No repair requests yet</h3><p>{user.role === 'Technician' ? 'Publish your profile and customers can request your services.' : 'Find a technician to get your first repair started.'}</p></div>}</div>{detail ? <Repair key={detail.id} r={detail} user={user} token={token} busy={busy} run={run} action={action} refresh={loadRepairs} notify={setNotice} onReview={refreshRatings} onMessage={openMessages}/> : <div className="empty">Select a repair to see its schedule, progress, payment, and messages.</div>}</div></section>}
      {['account','account-settings'].includes(page) && user && <AccountPage token={token} editing={page === 'account-settings'} onNavigate={setPage} onUpdated={updated => { setUser(updated); setRevision(v => v + 1) }}/>}
      {page === 'messages' && user && ['Customer','Technician'].includes(user.role) && <MessagesPage key={conversationTarget?.id || 'inbox'} user={user} token={token} initialRepair={conversationTarget} onViewRepair={viewRepair}/>}
      {page === 'profile' && user?.role === 'Technician' && <div className="profile-page"><div className="profile-page-heading"><p className="eyebrow">YOUR PUBLIC PROFILE</p><p>This is how customers see your expertise, services, and feedback.</p></div>{profileLoading ? <div className="loading-state" role="status"><span className="spinner"/>Loading your profile...</div> : profileError ? <div className="empty" role="alert"><h2>Your profile could not be loaded</h2><p>{profileError}</p><button onClick={() => setRevision(old => old + 1)}>Try again</button></div> : <TechnicianProfile key={`${profile?.id}-${profile?.updatedAt}-${profile?.rating?.reviewCount}`} profile={profile || emptyProfile} owner onEdit={() => setPage('profile-edit')}/>}</div>}
      {page === 'profile-edit' && user?.role === 'Technician' && <ProfileEditor key={profile?.updatedAt || 'new'} profile={profile} categories={categories} cities={cities} locationsState={locationsState} onRetryLocations={loadCities} busy={busy} onCancel={() => setPage('profile')} onSave={saveProfile}/>}
      {page === 'admin' && user?.role === 'Administrator' && <AdminDashboard token={token}/>}
    </main><footer><strong>FixIT</strong><span>Local expertise. Clear progress. No Fix, No Pay.</span><small>Payments run in test mode.</small></footer>
  </div>
}
function Repair({ r, user, token, busy, run, action, refresh, onReview, onMessage }) {
  const customer = user.id === r.customerId
  const post = (path, body) => api(`/repairs/${r.id}${path}`, { token, method: 'POST', body })
  return <article className="panel repair-detail"><span className="badge">{label(r.status)}</span><p className="status-explainer">{{ PENDING: 'Waiting for the technician to respond.', ACCEPTED: 'Your technician accepted. Agree on a schedule below.', IN_PROGRESS: 'Your technician is working on the repair.', AWAITING_CUSTOMER_CONFIRMATION: 'The technician reports success. Check the repair and confirm the final fee.', COMPLETED: 'The customer confirmed a successful repair. Payment and review are available.', FAILED: 'Repair was unsuccessful. No service fee is due.', REJECTED: 'This technician declined the request. You can book another expert.', CANCELLED: 'This repair request was cancelled.' }[r.status]}</p><h2>{r.title}</h2><p>{r.description}</p><dl><dt>Device</dt><dd>{r.deviceType} {r.deviceModel}</dd><dt>Customer</dt><dd>{r.customer.fname} {r.customer.lname}</dd><dt>Technician</dt><dd>{r.technicianProfile?.user.fname} {r.technicianProfile?.user.lname}</dd><dt>Service address</dt><dd>{r.serviceAddress}</dd><dt>Final fee</dt><dd>{r.status === 'FAILED' ? '₱0 · No Fix, No Pay' : r.finalCost == null ? 'Confirmed after diagnosis' : money(r.finalCost)}</dd></dl><div className="actions">{!customer && r.status === 'PENDING' && ['accept','reject'].map(a => <button key={a} disabled={busy} onClick={() => run(() => action(r,a))}>{a}</button>)}{customer && ['PENDING','ACCEPTED'].includes(r.status) && <button disabled={busy} onClick={() => run(() => action(r,'cancel'))}>Cancel request</button>}{!customer && r.status === 'ACCEPTED' && <button disabled={busy} onClick={() => run(() => action(r,'start'))}>Start repair</button>}{!customer && r.status === 'IN_PROGRESS' && <button disabled={busy} onClick={() => run(() => action(r,'failed'))}>Mark unsuccessful · No charge</button>}{customer && r.status === 'AWAITING_CUSTOMER_CONFIRMATION' && <button className="primary" disabled={busy} onClick={() => run(() => action(r,'confirm'))}>Confirm successful repair · {money(r.finalCost)}</button>}</div>
    {!customer && r.status === 'IN_PROGRESS' && <form onSubmit={e => { e.preventDefault(); const b = fields(e.currentTarget); run(() => action(r,'finish',Number(b.finalCost))) }}><Input title="Final service fee (PHP)" name="finalCost" type="number" min="0" max="99999999.99" step="0.01"/><button disabled={busy}>Submit successful repair for confirmation</button></form>}
    <SchedulingPanel repair={r} user={user} token={token} refresh={refresh}/>
    <FinalPriceEditor repair={r} user={user} token={token} refresh={refresh}/>
    {customer && r.status === 'COMPLETED' && r.outcome === 'SUCCESSFUL' && Number(r.finalCost) > 0 && <PaymentPanel key={r.payment?.providerCheckoutId || r.id} repair={r} token={token} refresh={refresh}/>}
    {customer && r.status === 'COMPLETED' && r.outcome === 'SUCCESSFUL' && !r.review && <form onSubmit={e => { e.preventDefault(); const b = fields(e.currentTarget); run(async () => { await post('/reviews', { rating: Number(b.rating), comment: b.comment }); await refresh(); await onReview(r.technicianProfileId) }) }}><h3>Review your technician</h3><label>Rating<select name="rating">{[5,4,3,2,1].map(n => <option key={n} value={n}>{n} stars</option>)}</select></label><label>Your experience<textarea name="comment" required maxLength={2000}/></label><button disabled={busy}>Publish review</button></form>}{r.review && <blockquote>{r.review.rating} ★ — {r.review.comment}</blockquote>}
    <div className="repair-message-shortcut"><h3>Need to coordinate?</h3><p>Keep your repair conversation in the dedicated Messages page.</p><button className="primary" onClick={() => onMessage(r)}>{customer ? 'Message Technician' : 'Message Customer'}</button></div>
  </article>
}
export default App
