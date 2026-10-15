import { useEffect, useId, useRef, useState } from 'react'

export default function AccountMenu({ user, onNavigate, onSignOut }) {
  const [open,setOpen] = useState(false)
  const root = useRef(null), trigger = useRef(null), menu = useRef(null), last = useRef(false)
  const menuId = useId()
  const items = [{ label: 'My Account', page: 'account' }, ...(user.role === 'Technician' ? [{ label: 'My Public Profile', page: 'profile' }] : user.role === 'Administrator' ? [{ label: 'Dashboard', page: 'admin' }] : []), { label: 'Account Settings', page: 'account-settings' }]
  useEffect(() => {
    if (!open) return
    const buttons = menu.current?.querySelectorAll('[role="menuitem"]')
    buttons?.[last.current ? buttons.length-1 : 0]?.focus()
    function outside(e) { if (!root.current?.contains(e.target)) setOpen(false) }
    function escape(e) { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    return () => { document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape) }
  },[open])
  function keyboard(e) {
    const buttons = [...menu.current.querySelectorAll('[role="menuitem"]')], index = buttons.indexOf(document.activeElement)
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault()
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
    if (e.key === 'Tab') { setOpen(false); trigger.current?.focus() }
  }
  return <div className="account-menu" ref={root}><button className="account-trigger" ref={trigger} aria-label={`Account menu for ${user.fname} ${user.lname}`} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => { last.current=false; setOpen(v=>!v) }} onKeyDown={e => { if (['ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); last.current=e.key==='ArrowUp'; setOpen(true) } }}>{user.fname?.[0]}{user.lname?.[0]}</button>{open && <div className="account-dropdown" id={menuId}><div className="account-menu-identity"><strong>{user.fname} {user.lname}</strong><span>{user.email}</span><small className="badge">{user.role}</small></div><div role="menu" aria-label="Account actions" ref={menu} onKeyDown={keyboard}>{items.map(item => <button role="menuitem" tabIndex={-1} key={item.page} onClick={() => { setOpen(false); onNavigate(item.page) }}>{item.label}</button>)}<button role="menuitem" tabIndex={-1} className="sign-out-item" onClick={() => { setOpen(false); onSignOut() }}>Sign Out</button></div></div>}</div>
}
