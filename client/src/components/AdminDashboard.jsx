import { useEffect, useState } from 'react'
import { api } from '../api'
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const statusLabel = status => status.replaceAll('_', ' ').toLowerCase()
export default function AdminDashboard({ token }) {
  const [tab, setTab] = useState('users')
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('')
  const [active, setActive] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  const [inspection, setInspection] = useState(null)
  useEffect(() => { let current = true; api('/admin/summary', { token }).then(d => { if (current) setSummary(d) }).catch(e => { if (current) setError(e.message) }); return () => { current = false } }, [token, version])
  useEffect(() => {
    let current = true
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page, ...(query ? { q: query } : {}), ...(tab === 'technicians' ? { role: 'Technician' } : role ? { role } : {}), ...(active ? { active } : {}), ...(status ? { status } : {}) })
        const endpoint = ['users','technicians'].includes(tab) ? 'users' : tab
        const result = await api(`/admin/${endpoint}?${params}`, { token })
        if (current) { setData(result); setError('') }
      } catch (e) { if (current) setError(e.message) } finally { if (current) setLoading(false) }
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [token, tab, query, role, active, status, page, version])
  function chooseTab(next) { setTab(next); setPage(1); setStatus(''); setData(null); setLoading(true); setInspection(null) }
  function filter(setter, value) { setter(value); setPage(1); setLoading(true) }
  async function moderate(user) {
    const next = !user.isActive
    if (!window.confirm(`${next ? 'Activate' : 'Deactivate'} ${user.fname} ${user.lname}? ${next ? 'They will be able to sign in again.' : 'Their active sessions will be blocked. Existing repairs and payments will be preserved.'}`)) return
    setBusy(true); setError(''); setNotice('')
    try { await api(`/admin/users/${user.id}/active`, { token, method: 'PATCH', body: { isActive: next } }); setVersion(v => v+1); setNotice(`Account ${next ? 'activated' : 'deactivated'}. History has been preserved.`) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function inspect(id) { setBusy(true); setError(''); try { setInspection(await api(`/admin/technicians/${id}`, { token })) } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const rows = data?.users || data?.repairs || data?.payments || []
  return <section className="admin-dashboard"><div className="section-head"><div><p className="eyebrow">MARKETPLACE OPERATIONS</p><h1>Administrator dashboard</h1><p>Monitor repairs and payments, inspect profiles, and manage account access.</p></div><button onClick={() => { setLoading(true); setVersion(v => v+1) }} disabled={busy}>Refresh data</button></div>{summary && <div className="profile-stats">{[['Accounts',summary.users],['Technicians',summary.technicians],['Repair requests',summary.repairs],['Verified sandbox payments',money(summary.paidTotal)]].map(([title,value]) => <div key={title}><span>{title}</span><strong>{value}</strong></div>)}</div>}<nav className="dashboard-tabs" aria-label="Administrator sections">{['users','technicians','repairs','payments'].map(name => <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => chooseTab(name)}>{name}</button>)}</nav>{error && <p role="alert" className="field-error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}<div className="filters">{['users','technicians'].includes(tab) ? <><label>Search accounts<input type="search" value={query} onChange={e => filter(setQuery,e.target.value)} placeholder="Name or email" maxLength={100}/></label>{tab === 'users' && <label>Role<select value={role} onChange={e => filter(setRole,e.target.value)}><option value="">All roles</option>{['Customer','Technician','Administrator'].map(r => <option key={r}>{r}</option>)}</select></label>}<label>Account status<select value={active} onChange={e => filter(setActive,e.target.value)}><option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></select></label></> : <label>Status<select value={status} onChange={e => filter(setStatus,e.target.value)}><option value="">All statuses</option>{(tab === 'repairs' ? ['PENDING','ACCEPTED','REJECTED','CANCELLED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION','COMPLETED','FAILED'] : ['PENDING','PAID','FAILED','REFUNDED']).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>}</div>{loading && <div className="loading-state" role="status"><span className="spinner"/>Loading {tab}...</div>}{inspection && <section className="panel admin-inspection"><div className="section-head"><h2>{inspection.user.fname} {inspection.user.lname}</h2><button onClick={() => setInspection(null)}>Close inspection</button></div><span className="badge">{inspection.user.isActive ? 'Active account' : 'Inactive account'} / {inspection.isAvailable ? 'Available' : 'Paused'}</span><p>{inspection.bio || 'No biography provided.'}</p><p>{inspection.serviceDescription}</p><div className="tags">{inspection.specialties.map(s => <span key={s.id}>{s.repairCategory.name}</span>)}</div><p>{inspection.serviceAreas.map(a => `${a.serviceArea.city}, ${a.serviceArea.province}`).join(' / ')}</p><p>{inspection.yearsExperience} years experience · {inspection._count.repairRequests} repair requests · {inspection._count.reviews} stored reviews</p></section>}<div className="table-scroll" role="region" aria-label={`${tab} directory`} tabIndex={0}><table><thead><tr>{(['users','technicians'].includes(tab) ? ['Account','Role','Status','Actions'] : tab === 'repairs' ? ['Repair','Customer / Technician','Progress','Fee / Payment'] : ['Repair / Customer','Amount','Payment status','Provider reference']).map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{['users','technicians'].includes(tab) ? <><td><strong>{row.fname} {row.lname}</strong><small>{row.email}</small></td><td>{row.role.name}</td><td><span className={`badge ${!row.isActive ? 'badge-neutral' : ''}`}>{row.isActive ? 'Active' : 'Inactive'}</span></td><td><div className="actions">{row.technicianProfile && <button disabled={busy} onClick={() => inspect(row.technicianProfile.id)}>Inspect profile</button>}{row.role.name !== 'Administrator' && <button disabled={busy} onClick={() => moderate(row)}>{row.isActive ? 'Deactivate' : 'Activate'}</button>}</div></td></> : tab === 'repairs' ? <><td><strong>{row.title}</strong><small>{new Date(row.createdAt).toLocaleDateString()}</small></td><td>{row.customer.fname} {row.customer.lname}<small>{row.technicianProfile ? `${row.technicianProfile.user.fname} ${row.technicianProfile.user.lname}` : 'No technician assigned'}</small></td><td><span className="badge">{statusLabel(row.status)}</span></td><td>{row.finalCost == null ? 'Not finalized' : money(row.finalCost)}<small>{row.payment?.status || 'No checkout'}</small></td></> : <><td><strong>{row.repairRequest.title}</strong><small>{row.repairRequest.customer.fname} {row.repairRequest.customer.lname}</small></td><td>{money(row.amount)}</td><td><span className="badge">{row.status}</span><small>{row.paidAt ? new Date(row.paidAt).toLocaleString() : 'No verified payment yet'}</small></td><td><small>{row.providerCheckoutId || 'Not created'}</small><small>{row.providerPaymentId || 'No payment ID'}</small></td></>}</tr>)}</tbody></table>{!loading && !rows.length && <div className="empty">No {tab} match these filters.</div>}</div><div className="pagination"><button disabled={loading || page <= 1} onClick={() => { setPage(p => p-1); setLoading(true) }}>Previous</button><span>Page {page} of {Math.max(1,data?.pagination?.totalPages || 0)} · {data?.pagination?.total || 0} records</span><button disabled={loading || page >= (data?.pagination?.totalPages || 0)} onClick={() => { setPage(p => p+1); setLoading(true) }}>Next</button></div><p className="muted">Payment statuses are read-only. Account moderation never deletes transaction, repair, or review history.</p></section>
}
