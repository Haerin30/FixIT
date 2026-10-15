import { useEffect, useState } from 'react'
import { api } from '../api'
import ChatPanel from './ChatPanel'
import { Avatar } from './TechnicianProfile'
const status = s => s.replaceAll('_',' ').toLowerCase()
export default function MessagesPage({ user, token, initialRepair, onViewRepair }) {
  const [items,setItems]=useState([]),[pages,setPages]=useState(1),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selectedId,setSelectedId]=useState(initialRepair?.id||null),[repair,setRepair]=useState(initialRepair||null),[chatError,setChatError]=useState('')
  useEffect(()=>{
    let active=true,timer
    const controller=new AbortController()
    async function load(){
      try{
        const loaded=await Promise.all(Array.from({length:pages},(_,i)=>api(`/conversations?page=${i+1}`,{token,signal:controller.signal})))
        if(active){setItems(loaded.flatMap(d=>d.conversations));setHasMore(pages<loaded[0].pagination.totalPages);setError('')}
      }catch(e){if(active)setError(e.message)}finally{if(active){setLoading(false);timer=setTimeout(load,5000)}}
    }
    load();return()=>{active=false;clearTimeout(timer);controller.abort()}
  },[token,pages])
  useEffect(()=>{
    if(!selectedId)return
    let active=true
    api(`/repairs/${selectedId}`,{token}).then(data=>{if(active){setRepair(data);setChatError('')}}).catch(e=>{if(active)setChatError(e.message)})
    return()=>{active=false}
  },[selectedId,token])
  useEffect(()=>{ if(selectedId)document.getElementById('message-participant-title')?.focus() },[selectedId,repair?.id])
  const selected=items.find(c=>c.repairId===selectedId)
  const current=repair?.id===selectedId?repair:null
  const participant=selected?.participant||(current?(user.id===current.customerId?current.technicianProfile?.user:current.customer):null)
  const fallback=current&&!selected?{repairId:current.id,title:current.title,status:current.status,participant,lastMessage:null,createdAt:current.createdAt}:null
  const conversations=[...(fallback?[fallback]:[]),...items].sort((a,b)=>new Date(b.lastMessage?.createdAt||b.createdAt)-new Date(a.lastMessage?.createdAt||a.createdAt))
  return <section className="messages-page"><div className="section-head"><div><p className="eyebrow">YOUR REPAIR CONVERSATIONS</p><h1>Messages</h1><p>Coordinate repairs privately with your {user.role==='Technician'?'customers':'technicians'}.</p></div><span className="badge">Updates automatically</span></div><div className={`messages-workspace ${selectedId?'has-selection':''}`}><aside className="conversation-sidebar" aria-label="Repair conversations"><h2>Conversations</h2>{error&&<p className="field-error" role="alert">{error} Retrying automatically.</p>}{loading&&<div className="loading-state" role="status"><span className="spinner"/>Loading conversations...</div>}{!loading&&!conversations.length&&!error&&<div className="empty"><h3>No conversations yet</h3><p>Your repair requests will appear here, even before the first message.</p></div>}<ul>{conversations.map(c=><li key={c.repairId}><button className={`conversation-item ${c.repairId===selectedId?'selected':''}`} aria-current={c.repairId===selectedId?'true':undefined} onClick={()=>{setSelectedId(c.repairId);setChatError('')}}><Avatar user={c.participant}/><span className="conversation-item-copy"><strong>{c.participant?`${c.participant.fname} ${c.participant.lname}`:'Technician not assigned'}</strong><span>{c.title}</span><small className="conversation-preview">{c.lastMessage?`${c.lastMessage.senderId===user.id?'You: ':''}${c.lastMessage.body}`:'No messages yet. Start the conversation.'}</small><span className="conversation-meta"><span className="badge">{status(c.status)}</span>{c.lastMessage&&<time dateTime={c.lastMessage.createdAt}>{new Date(c.lastMessage.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>}</span></span></button></li>)}</ul>{hasMore&&<button disabled={loading} onClick={()=>{setLoading(true);setPages(p=>p+1)}}>Load more conversations</button>}</aside><div className="conversation-detail">{selectedId?<><button className="text-button back-conversations" onClick={()=>{setSelectedId(null);setRepair(null)}}>Back to Conversations</button>{chatError?<p className="field-error" role="alert">{chatError}</p>:<><div className="conversation-header"><Avatar user={participant}/><div><h2 id="message-participant-title" tabIndex={-1}>{participant?`${participant.fname} ${participant.lname}`:'Repair conversation'}</h2><p>{selected?.title||current?.title||'Loading repair...'}</p>{(selected?.status||current?.status)&&<span className="badge">{status(selected?.status||current?.status)}</span>}</div><button disabled={!current} onClick={()=>onViewRepair(current)}>View Repair Details</button></div>{current?<ChatPanel key={selectedId} repairId={selectedId} user={user} token={token}/>:<div className="loading-state" role="status"><span className="spinner"/>Loading this repair...</div>}</>}</>:<div className="conversation-placeholder"><h2>Select a conversation</h2><p>Choose a repair on the left to view messages or start a new conversation.</p></div>}</div></div></section>
}
