import { useState } from 'react'
import { api } from '../api'
import { formatManila, manilaInput, manilaISO } from '../lib/philippine-time'
export default function SchedulingPanel({ repair:r, user, token, refresh }) {
  const [start,setStart]=useState(''),[end,setEnd]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const tech=user.role==='Technician'&&user.id===r.technicianProfile?.userId
  const confirmed=r.schedules.some(s=>s.status==='CONFIRMED'),pending=r.schedules.some(s=>s.status==='PROPOSED')
  const responsible=r.customerCanProposeSchedule?'customer':'technician'
  const canPropose=r.status==='ACCEPTED'&&!confirmed&&!pending&&((tech&&!r.customerCanProposeSchedule)||(!tech&&user.id===r.customerId&&r.customerCanProposeSchedule))
  async function perform(fn, message){setBusy(true);setError('');setNotice('');try{await fn();await refresh();setNotice(message)}catch(e){setError(e.message)}finally{setBusy(false)}}
  function propose(e){
    e.preventDefault()
    perform(async()=>{
      const proposedStart=manilaISO(start),proposedEnd=manilaISO(end)
      if(new Date(proposedStart)<=new Date())throw new Error('The start time must be in the future (Philippine time).')
      if(new Date(proposedEnd)<=new Date(proposedStart))throw new Error('The end time must be later than the start time.')
      if(new Date(proposedEnd)-new Date(proposedStart)>86400000)throw new Error('A visit cannot last more than 24 hours.')
      await api(`/repairs/${r.id}/schedules`,{token,method:'POST',body:{proposedStart,proposedEnd}})
      setStart('');setEnd('')
    },'Schedule proposed. The other participant must respond.')
  }
  const explanation=confirmed?'Your confirmed visit is shown below. Scheduling authority is locked to preserve the agreement.':pending?'A proposal is awaiting the other participant’s response. Resolve it before changing scheduling responsibility.':r.status!=='ACCEPTED'?'Schedule proposals become available after the technician accepts the repair.':r.customerCanProposeSchedule?tech?'You asked the customer to propose their preferred time. You will review their proposal.':'Your technician has invited you to propose your preferred visit time.':'The assigned technician is responsible for proposing a visit time. The customer will confirm or reject it.'
  return <section className="scheduling-panel" aria-labelledby="schedule-title"><div className="section-head"><h3 id="schedule-title">Repair schedule</h3><span className="badge">{confirmed?'Confirmed':`Proposed by ${responsible}`}</span></div><p className="status-explainer">{explanation}</p><small className="muted">All dates and times on this panel use Philippine time (Asia/Manila, UTC+08:00), regardless of your device timezone.</small>{error&&<p className="field-error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}{r.schedules.length?r.schedules.map(s=><article className="schedule" key={s.id}><p>{formatManila(s.proposedStart)} – {formatManila(s.proposedEnd)}</p><span className="badge">{s.status.toLowerCase()}</span><small className="muted"> Proposed by {s.proposedById===r.customerId?'customer':'technician'}</small>{s.status==='PROPOSED'&&s.proposedById!==user.id&&r.status==='ACCEPTED'&&<div className="actions">{['CONFIRMED','REJECTED'].map(status=><button className={status==='CONFIRMED'?'primary':''} disabled={busy} key={status} onClick={()=>perform(()=>api(`/repairs/${r.id}/schedules/${s.id}/respond`,{token,method:'POST',body:{status}}),`Schedule ${status.toLowerCase()}.`)}>{status==='CONFIRMED'?'Confirm schedule':'Reject proposal'}</button>)}</div>}</article>):<p className="empty-inline">No schedule has been proposed yet.</p>}{tech&&r.status==='ACCEPTED'&&!confirmed&&!pending&&<button disabled={busy} onClick={()=>perform(()=>api(`/repairs/${r.id}/scheduling-permission`,{token,method:'PATCH',body:{customerCanProposeSchedule:!r.customerCanProposeSchedule}}),r.customerCanProposeSchedule?'Delegation revoked. You can propose a schedule.':'Customer invited to propose a schedule.')}>{r.customerCanProposeSchedule?'Revoke Customer Scheduling Permission':'Let Customer Propose Schedule'}</button>}{canPropose&&<form onSubmit={propose}><h4>Propose schedule</h4><div className="row"><label>Start (Philippine time)<input type="datetime-local" required value={start} min={manilaInput()} onChange={e=>setStart(e.target.value)} disabled={busy}/></label><label>End (Philippine time)<input type="datetime-local" required value={end} min={start||manilaInput()} onChange={e=>setEnd(e.target.value)} disabled={busy}/></label></div><button className="primary" disabled={busy}>{busy?'Submitting...':'Send schedule proposal'}</button></form>}</section>
}
