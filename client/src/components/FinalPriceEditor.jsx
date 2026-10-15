import { useState } from 'react'
import { api } from '../api'
const money=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v||0))
export default function FinalPriceEditor({ repair:r, user, token, refresh }) {
  const [editing,setEditing]=useState(false),[amount,setAmount]=useState(''),[version,setVersion]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  if(user.role!=='Technician'||user.id!==r.technicianProfile?.userId||!['AWAITING_CUSTOMER_CONFIRMATION','COMPLETED'].includes(r.status)||r.outcome!=='SUCCESSFUL')return null
  async function save(e){
    e.preventDefault();setError('')
    if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(amount)){setError('Enter a nonnegative PHP amount with at most two decimal places.');return}
    if(r.status==='COMPLETED'&&!window.confirm('This correction will invalidate the customer’s previous approval. The customer must confirm the new amount before checkout. Continue?'))return
    setBusy(true)
    try{await api(`/repairs/${r.id}/final-price`,{token,method:'PATCH',body:{finalCost:Number(amount),priceVersion:version}});await refresh();setEditing(false)}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="final-price-editor"><h3>Submitted final price</h3><strong className="payment-amount">{money(r.finalCost)}</strong><p>{r.status==='COMPLETED'?'The customer has approved this amount. A correction must reopen customer confirmation.':'Waiting for the customer to confirm this amount.'}</p>{r.payment?<p className="notice">A payment or checkout record already exists. The amount is locked to preserve payment history.</p>:editing?<form onSubmit={save}><label>Corrected final price (PHP)<input type="text" inputMode="decimal" value={amount} required onChange={e=>setAmount(e.target.value)} disabled={busy} aria-describedby="price-correction-help"/></label><small id="price-correction-help" className="muted">The correction is recorded. Only the latest price revision can be confirmed by the customer.</small>{error&&<p className="field-error" role="alert">{error}</p>}<div className="actions"><button type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving...':r.status==='COMPLETED'?'Request price reconfirmation':'Save corrected price'}</button></div></form>:<button onClick={()=>{setAmount(Number(r.finalCost).toFixed(2));setVersion(r.priceVersion);setError('');setEditing(true)}}>Edit Final Price</button>}</section>
}
