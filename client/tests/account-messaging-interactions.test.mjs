import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

test('account menu supports role links, focus, arrows, escape, outside click and sign out; repair actions stay independent',async t=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:5173',pretendToBeVisual:true})
  const names=['window','document','navigator','HTMLElement','Event','FormData','IS_REACT_ACT_ENVIRONMENT']
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]))
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[name]})
  const {createRoot}=await import('react-dom/client')
  const root=createRoot(document.getElementById('root'))
  const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true},appType:'custom'})
  t.after(async()=>{await act(()=>root.unmount());await vite.close();dom.window.close();for(const [name,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]})
  const {default:AccountMenu}=await vite.ssrLoadModule('/src/components/AccountMenu.jsx')
  const {default:RepairRequestCard}=await vite.ssrLoadModule('/src/components/RepairRequestCard.jsx')
  const click=element=>act(()=>element.dispatchEvent(new window.MouseEvent('click',{bubbles:true})))
  const key=(element,value)=>act(()=>element.dispatchEvent(new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true})))
  for(const role of ['Customer','Technician','Administrator']){
    let page=null,signedOut=false
    await act(()=>root.render(React.createElement(AccountMenu,{key:role,user:{fname:'Alex',lname:'User',email:'alex@example.invalid',role},onNavigate:p=>{page=p},onSignOut:()=>{signedOut=true}})))
    const trigger=document.querySelector('[aria-haspopup="menu"]')
    assert.equal(trigger.textContent,'AU');await click(trigger)
    let items=[...document.querySelectorAll('[role="menuitem"]')]
    assert.equal(document.activeElement,items[0]);assert.equal(items[0].textContent,'My Account')
    await key(items[0],'ArrowDown');assert.equal(document.activeElement,items[1])
    await key(items[1],'End');assert.equal(document.activeElement,items.at(-1))
    await key(items.at(-1),'Escape');assert.equal(document.activeElement,trigger);assert.equal(trigger.getAttribute('aria-expanded'),'false')
    await key(trigger,'ArrowUp');items=[...document.querySelectorAll('[role="menuitem"]')];assert.equal(document.activeElement,items.at(-1))
    await act(()=>document.body.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true})));assert.equal(document.querySelector('[role="menu"]'),null)
    await click(trigger);await click(document.querySelector('[role="menuitem"]'));assert.equal(page,'account')
    await click(trigger);items=[...document.querySelectorAll('[role="menuitem"]')]
    if(role==='Technician')assert.ok(items.some(i=>i.textContent==='My Public Profile'))
    if(role==='Administrator')assert.ok(items.some(i=>i.textContent==='Dashboard'))
    await click(items.find(i=>i.textContent==='Account Settings'));assert.equal(page,'account-settings')
    await click(trigger);await click([...document.querySelectorAll('[role="menuitem"]')].find(i=>i.textContent==='Sign Out'));assert.equal(signedOut,true)
  }
  let details=0,messages=0
  const repair={id:'repair',title:'Laptop problem',status:'ACCEPTED',repairCategory:{name:'Laptop Repair'},createdAt:'2026-10-16T00:00:00Z',customerId:'customer',customer:{fname:'Customer',lname:'User'},technicianProfile:{user:{fname:'Technician',lname:'User'}}}
  await act(()=>root.render(React.createElement(RepairRequestCard,{repair,user:{id:'customer'},onDetails:()=>details++,onMessage:()=>messages++})))
  const buttons=[...document.querySelectorAll('button')]
  assert.equal(document.querySelector('button button'),null)
  assert.equal(buttons[1].textContent,'Message Technician')
  await click(buttons[1]);assert.equal(messages,1);assert.equal(details,0)
  await click(buttons[0]);assert.equal(details,1);assert.equal(messages,1)
  const {default:AccountPage}=await vite.ssrLoadModule('/src/components/AccountPage.jsx')
  const originalFetch=globalThis.fetch
  t.after(()=>{globalThis.fetch=originalFetch})
  const account={id:'customer',fname:'Alex',lname:'User',email:'alex@example.invalid',phone:null,role:'Customer',createdAt:'2026-10-16T00:00:00Z'}
  let saved=null,navigated=null,updated=null
  globalThis.fetch=async(url,options={})=>{assert.equal(String(url),'/api/account');if(options.method==='PATCH')saved=JSON.parse(options.body);return{ok:true,json:async()=>({data:{...account,...saved}})}}
  await act(async()=>root.render(React.createElement(AccountPage,{token:'isolated-test-token',editing:true,onNavigate:p=>{navigated=p},onUpdated:a=>{updated=a}})))
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
  assert.equal(document.querySelector('input[readonly]').value,account.email)
  document.querySelector('input[name="fname"]').value='Renamed'
  document.querySelector('input[name="phone"]').value='+63 912 345 6789'
  await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
  assert.deepEqual(saved,{fname:'Renamed',lname:'User',phone:'+63 912 345 6789'})
  assert.equal(updated.fname,'Renamed');assert.equal(navigated,'account')
})

test('Philippine datetime conversion is explicit and does not depend on browser timezone',async t=>{
  const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true},appType:'custom'})
  t.after(()=>vite.close())
  const {manilaISO,manilaInput}=await vite.ssrLoadModule('/src/lib/philippine-time.js')
  assert.equal(manilaISO('2026-10-17T09:00'),'2026-10-17T01:00:00.000Z')
  assert.equal(manilaInput(new Date('2026-10-17T01:00:00Z')),'2026-10-17T09:00')
  assert.throws(()=>manilaISO('2026-02-30T09:00'),/calendar/)
  assert.throws(()=>manilaISO(''),/Select both/)
})

test('dedicated inbox opens the exact repair, sends its first message and navigates back to repair details',async t=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:5173',pretendToBeVisual:true})
  const names=['window','document','navigator','HTMLElement','Event','FormData','IS_REACT_ACT_ENVIRONMENT']
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]))
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[name]})
  window.HTMLElement.prototype.scrollIntoView=()=>{}
  const originalFetch=globalThis.fetch
  const repair={id:'repair-exact',title:'Exact repair conversation',status:'ACCEPTED',createdAt:'2026-10-16T00:00:00Z',customerId:'customer',customer:{id:'customer',fname:'Customer',lname:'User'},technicianProfile:{userId:'technician',user:{id:'technician',fname:'Correct',lname:'Technician'}}}
  const messages=[],requests=[]
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);requests.push(path)
    let data
    if(path.startsWith('/api/conversations'))data={conversations:[{repairId:repair.id,title:repair.title,status:repair.status,participant:repair.technicianProfile.user,createdAt:repair.createdAt,lastMessage:null}],pagination:{page:1,totalPages:1,total:1}}
    else if(path.endsWith('/messages')){
      if(options.method==='POST'){const body=JSON.parse(options.body);messages.push({id:body.messageId,senderId:'customer',sender:repair.customer,body:body.body,createdAt:'2026-10-16T00:01:00Z'});data=messages.at(-1)}else data=messages
    }else if(path===`/api/repairs/${repair.id}`)data=repair
    else throw new Error(`Unexpected test endpoint: ${path}`)
    return{ok:true,json:async()=>({data})}
  }
  const{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
  const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true},appType:'custom'})
  t.after(async()=>{await act(()=>root.unmount());await vite.close();globalThis.fetch=originalFetch;dom.window.close();for(const[name,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]})
  const{default:MessagesPage}=await vite.ssrLoadModule('/src/components/MessagesPage.jsx')
  let detail=null
  await act(async()=>root.render(React.createElement(MessagesPage,{user:repair.customer,token:'isolated-test-token',initialRepair:repair,onViewRepair:r=>{detail=r}})))
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))})
  assert.ok(document.body.textContent.includes('Correct Technician'))
  assert.ok(document.body.textContent.includes('Start the conversation'))
  assert.ok(requests.includes(`/api/repairs/${repair.id}/messages`))
  const textarea=document.querySelector('#chat-draft')
  await act(()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'My first message');textarea.dispatchEvent(new window.Event('input',{bubbles:true}))})
  await act(async()=>document.querySelector('.chat-compose').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(messages.length,1)
  assert.equal(messages[0].body,'My first message')
  assert.ok(document.querySelector('[role="log"]').textContent.includes('My first message'))
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='View Repair Details')
  await act(()=>button.dispatchEvent(new window.MouseEvent('click',{bubbles:true})))
  assert.equal(detail.id,repair.id)
  const back=[...document.querySelectorAll('button')].find(b=>b.textContent==='Back to Conversations')
  await act(()=>back.dispatchEvent(new window.MouseEvent('click',{bubbles:true})))
  assert.equal(document.querySelector('.messages-workspace').classList.contains('has-selection'),false)
})
