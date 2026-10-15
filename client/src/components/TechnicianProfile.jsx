import { useState } from 'react'
import { api } from '../api'

export function Icon({ name, size = 20, ...props }) {
  const paths = {
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    edit: 'm16 3 5 5-12 12-6 1 1-6Z M14 5l5 5',
    check: 'm5 12 4 4L19 6',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    tool: 'm14 7 3 3 4-4a7 7 0 0 1-9 9l-6 6-3-3 6-6a7 7 0 0 1 9-9Z',
    clock: 'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.check}/></svg>
}

export function Avatar({ user, large = false }) {
  const initials = `${user?.fname?.[0] || ''}${user?.lname?.[0] || ''}`
  return <div className={`avatar ${large ? 'avatar-large' : ''}`} aria-hidden="true">{initials || 'IT'}</div>
}

export function Rating({ average, count, compact = false, showCount = true }) {
  const rated = count > 0 && Number.isFinite(Number(average))
  const value = rated ? Number(average) : 0
  return <div className={`rating ${compact ? 'rating-compact' : ''}`}>
    <span className="stars" role="img" aria-label={rated ? `${value.toFixed(1)} out of 5 stars` : 'Not yet rated'}>
      <span aria-hidden="true">★★★★★</span><span className="stars-filled" style={{ width: `${value / 5 * 100}%` }} aria-hidden="true">★★★★★</span>
    </span>
    {rated ? <span><strong>{value.toFixed(1)}</strong>{showCount ? <span className="muted"> · {count} {count === 1 ? 'review' : 'reviews'}</span> : <span className="muted"> / 5</span>}</span> : <span className="muted">No reviews yet</span>}
  </div>
}

export function TechnicianCard({ technician: t, onOpen, disabled }) {
  return <article className="card technician-card">
    <div className="card-top"><Avatar user={t.user}/><span className="badge"><span className="status-dot"/>Available</span></div>
    <h3>{t.user.fname} {t.user.lname}</h3>
    <p className="card-specialty">{t.specialties.map(s => s.name).join(' · ') || 'Computer repair technician'}</p>
    <Rating average={t.rating?.averageRating} count={t.rating?.reviewCount || 0} compact/>
    <p className="card-bio">{t.bio || 'This technician is ready to help. View their profile to explore available services.'}</p>
    <div className="tags">{t.specialties.slice(0, 3).map(s => <span key={s.categoryId}>{s.name}</span>)}</div>
    <div className="card-location"><Icon name="pin" size={17}/><span>{t.serviceAreas.map(a => a.city).join(' · ') || 'Ask about service coverage'}</span></div>
    <div className="card-facts"><span>{t.yearsExperience} years experience</span><span>{t.completedRepairs || 0} completed repairs</span></div>
    <button className="primary" onClick={onOpen} disabled={disabled} aria-label={`View profile of ${t.user.fname} ${t.user.lname}`}>View profile <Icon name="arrow" size={17}/></button>
  </article>
}

export function TechnicianProfile({ profile: t, owner = false, onEdit, onRequest, busy = false }) {
  const [feed, setFeed] = useState({ reviews: t.reviews || [], pagination: t.reviewPagination || { page: 1, totalPages: 1 } })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const name = `${t.user.fname} ${t.user.lname}`
  async function moreReviews() {
    setLoading(true); setError('')
    try {
      const next = await api(`/technicians/${t.id}/reviews?page=${feed.pagination.page + 1}`)
      setFeed(old => ({ reviews: [...old.reviews, ...next.reviews.filter(r => !old.reviews.some(existing => existing.id === r.id))], pagination: next.pagination }))
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  return <article className="technician-profile">
    <section className="profile-header" aria-labelledby="profile-name">
      <div className="profile-cover"><span>FIXIT / TECHNICIAN PROFILE</span><Icon name="tool" size={72}/></div>
      <div className="profile-intro"><Avatar user={t.user} large/><div className="profile-identity"><span className={`badge ${!t.isAvailable ? 'badge-neutral' : ''}`}><span className="status-dot"/>{t.isAvailable ? 'Available for repairs' : 'Currently unavailable'}</span><h1 id="profile-name">{name}</h1><p className="profile-specialization">{t.specialties.map(s => s.name).join(' · ') || 'Computer repair technician'}</p><p className="profile-location"><Icon name="pin" size={18}/>{t.serviceAreas.map(a => `${a.city}, ${a.province}`).join(' · ') || 'Service area not added yet'}</p><Rating average={t.rating?.averageRating} count={t.rating?.reviewCount || 0}/></div><div className="profile-actions">{owner ? <button className="primary" onClick={onEdit}><Icon name="edit" size={18}/>Edit Profile</button> : onRequest && <button className="primary" disabled={busy || !t.isAvailable || !t.specialties.length} onClick={onRequest}>Request a repair <Icon name="arrow" size={18}/></button>}</div></div>
      {owner && !t.isAvailable && <p className="profile-owner-note">Your profile is paused. Use Edit Profile to update your services and availability before receiving requests.</p>}
      <nav className="profile-nav" aria-label="Profile sections"><a href="#profile-about">Overview</a><a href="#profile-services">Specializations & services</a><a href="#profile-reviews">Customer reviews <span>{t.rating?.reviewCount || 0}</span></a></nav>
    </section>
    <div className="profile-stats" aria-label="Technician statistics"><div><span>Average rating</span><strong>{t.rating?.reviewCount ? <>{Number(t.rating.averageRating).toFixed(1)}<small> / 5</small></> : '—'}</strong><small>{t.rating?.reviewCount ? 'From verified repair customers' : 'No reviews yet'}</small></div><div><span>Customer reviews</span><strong>{t.rating?.reviewCount || 0}</strong><small>Real customer feedback</small></div><div><span>Completed repairs</span><strong>{t.completedRepairs || 0}</strong><small>Successfully completed</small></div><div><span>Experience</span><strong>{t.yearsExperience}<small> years</small></strong><small>In computer repair</small></div></div>
    <div className="profile-columns"><div><section className="profile-section" id="profile-about"><p className="eyebrow">GET TO KNOW YOUR TECHNICIAN</p><h2>About me</h2><p className="preserve-text">{t.bio || (owner ? 'Introduce yourself to customers. Add your background and approach to repair in Edit Profile.' : 'This technician has not added a biography yet.')}</p></section><section className="profile-section" id="profile-services"><h2>Specializations & services</h2><p>Areas of expertise</p><div className="skill-grid">{t.specialties.map(s => <div key={s.categoryId}><Icon name="tool"/><span>{s.name}</span></div>)}</div>{!t.specialties.length && <p className="empty-inline">No specializations added yet.</p>}<h3>How I can help</h3><p className="preserve-text">{t.serviceDescription || 'Service details have not been added yet.'}</p></section></div><aside className="profile-section service-summary"><h3>At a glance</h3><div><Icon name="pin"/><span><strong>Service areas</strong>{t.serviceAreas.length ? t.serviceAreas.map((a, i) => <span key={`${a.city}-${a.province}-${i}`}>{a.city}, {a.province}</span>) : <span>Not specified yet</span>}</span></div><div><Icon name="clock"/><span><strong>Scheduling</strong>Agree on a visit time together after your request is accepted.</span></div><div><Icon name="check"/><span><strong>No Fix, No Pay</strong>Unsuccessful repairs have no service fee.</span></div></aside></div>
    <section className="profile-section" id="profile-reviews"><div className="section-head"><div><p className="eyebrow">FROM THE PEOPLE THEY HAVE HELPED</p><h2>Customer reviews</h2></div><Rating average={t.rating?.averageRating} count={t.rating?.reviewCount || 0}/></div><p className="muted">Feedback from customers with successfully completed repairs.</p>{feed.reviews.length ? <div className="review-list">{feed.reviews.map(r => <article className="review-card" key={r.id}><div className="review-heading"><div className="review-author"><div className="review-avatar" aria-hidden="true">{r.customerName?.[0] || 'C'}</div><div><h3>{r.customerName}</h3><span className="verified-label"><Icon name="check" size={14}/>Completed repair</span></div></div><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div><Rating average={r.rating} count={1} compact showCount={false}/><p className="preserve-text">{r.comment}</p></article>)}</div> : <div className="reviews-empty"><span aria-hidden="true">☆</span><h3>No reviews yet</h3><p>Once a customer completes a successful repair, their feedback will appear here.</p></div>}{error && <p role="alert" className="field-error">{error}</p>}{feed.pagination.page < feed.pagination.totalPages && <button onClick={moreReviews} disabled={loading}>{loading ? 'Loading reviews…' : 'Load more reviews'}</button>}</section>
  </article>
}
