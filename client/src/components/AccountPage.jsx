import { useEffect, useState } from 'react'
import { api } from '../api'
import { Avatar } from './TechnicianProfile'
export default function AccountPage({ token, editing = false, onNavigate, onUpdated }) {
  const [account,setAccount]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false), [notice,setNotice]=useState(''), [retry,setRetry]=useState(0)
  useEffect(() => {
    let active=true
    api('/account',{token}).then(data=>{if(active){setAccount(data);setError('')}}).catch(e=>{if(active)setError(e.message)})
    return()=>{active=false}
  },[token,retry])
  async function save(e) {
    e.preventDefault();const form=new FormData(e.currentTarget)
    setBusy(true);setError('')
    try {const updated=await api('/account',{token,method:'PATCH',body:{fname:form.get('fname'),lname:form.get('lname'),phone:form.get('phone')}});setAccount(updated);onUpdated(updated);setNotice('Your account details have been updated.');onNavigate('account')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="panel personal-account"><p className="eyebrow">YOUR PERSONAL INFORMATION</p><h1>{editing?'Account Settings':'My Account'}</h1>{error && <div className="field-error" role="alert">{error}<button onClick={()=>setRetry(v=>v+1)}>Retry loading account</button></div>}{notice && <p role="status" className="notice">{notice}</p>}{!account ? !error && <div className="loading-state" role="status"><span className="spinner"/>Loading your account...</div> : <><div className="personal-account-header"><Avatar user={account}/><div><h2>{account.fname} {account.lname}</h2><span className="badge">{account.role}</span></div></div>{editing ? <form onSubmit={save} key={account.fname+account.lname+(account.phone||'')}><fieldset disabled={busy}><legend>Edit personal details</legend><div className="row"><label>First name<input name="fname" required maxLength={100} defaultValue={account.fname} autoComplete="given-name"/></label><label>Last name<input name="lname" required maxLength={100} defaultValue={account.lname} autoComplete="family-name"/></label></div><label>Phone number (optional)<input name="phone" type="tel" maxLength={30} defaultValue={account.phone||''} autoComplete="tel" placeholder="e.g. +63 9xx xxx xxxx"/></label><label>Email address<input value={account.email} readOnly type="email"/></label><small className="muted">Email and account role are read-only. Password changes and email verification are not available in this release.</small></fieldset><div className="actions"><button type="button" disabled={busy} onClick={()=>onNavigate('account')}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving...':'Save account changes'}</button></div></form> : <><dl><dt>Email</dt><dd>{account.email}</dd><dt>Account role</dt><dd>{account.role}</dd><dt>Phone number</dt><dd>{account.phone||'Not added'}</dd><dt>Member since</dt><dd>{new Date(account.createdAt).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'long',day:'numeric'})}</dd></dl><button className="primary" onClick={()=>onNavigate('account-settings')}>Edit Account</button></>}{account.role==='Technician'&&<div className="notice account-profile-note"><strong>Your public profile is separate.</strong><p>Biography, services, specializations, service areas, ratings and availability belong to your marketplace profile.</p><button onClick={()=>onNavigate('profile')}>View My Public Profile</button></div>}</>}</section>
}
