const parts = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value)
export function manilaInput(date = new Date()) {
  const p=Object.fromEntries(parts(date).map(p=>[p.type,p.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export function manilaISO(value) {
  if(!value) throw new Error('Select both the start and end date/time.')
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid date and time.')
  const date=new Date(`${value}:00+08:00`)
  if(!Number.isFinite(+date)||manilaInput(date)!==value) throw new Error('Enter a valid calendar date and time.')
  return date.toISOString()
}
export function formatManila(value) {
  return new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
}
