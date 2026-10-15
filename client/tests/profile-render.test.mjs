import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('shared profile, marketplace card and separate editor render real statistics and accessible states', async t => {
  const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
  t.after(() => vite.close())
  const { TechnicianProfile, TechnicianCard, Rating } = await vite.ssrLoadModule('/src/components/TechnicianProfile.jsx')
  const { default: ProfileEditor } = await vite.ssrLoadModule('/src/components/ProfileEditor.jsx')
  const profile = {
    id: 'profile-test', user: { fname: 'Sample', lname: 'Technician' }, bio: 'Laptop repair specialist',
    yearsExperience: 6, isAvailable: true, serviceDescription: 'SSD and memory upgrades',
    specialties: [{ categoryId: 1, name: 'Laptop Repair' }],
    serviceAreas: [{ city: 'Cebu City', province: 'Cebu' }, { city: 'Mandaue City', province: 'Cebu' }],
    completedRepairs: 12, rating: { averageRating: 4.5, reviewCount: 2 },
    reviews: [{ id: 'test-review', customerName: 'Test Customer', rating: 5, comment: '<script>unsafe()</script>', createdAt: '2026-10-15T00:00:00.000Z' }],
    reviewPagination: { page: 1, totalPages: 2 },
  }
  const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
  const owner = render(TechnicianProfile, { profile, owner: true, onEdit: () => {} })
  const customer = render(TechnicianProfile, { profile, onRequest: () => {} })
  for (const html of [owner, customer]) {
    for (const text of ['Sample Technician', 'Laptop Repair', 'Mandaue City', 'About me', 'Customer reviews', 'Completed repairs', '12', '4.5 out of 5 stars', 'Test Customer', 'Load more reviews']) assert.ok(html.includes(text), `Missing ${text}`)
    assert.ok(!html.includes('<form'), 'Profile display must not be an editing form')
    assert.ok(!html.includes('<script>unsafe()'), 'Feedback must be escaped')
    assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'))
  }
  assert.ok(owner.includes('Edit Profile'))
  assert.ok(!customer.includes('Edit Profile'))
  assert.ok(customer.includes('Request a repair'))
  const empty = render(TechnicianProfile, { profile: { ...profile, rating: { averageRating: null, reviewCount: 0 }, reviews: [], reviewPagination: { page: 1, totalPages: 0 } } })
  assert.ok(empty.includes('No reviews yet'))
  assert.ok(!empty.includes('0.0 out of 5 stars'))
  const card = render(TechnicianCard, { technician: profile, onOpen: () => {} })
  assert.ok(card.includes('4.5 out of 5 stars'))
  assert.ok(card.includes('12 completed repairs'))
  const editor = render(ProfileEditor, { profile, categories: [{ id: 1, name: 'Laptop Repair' }], cities: [], onSave: () => {}, onCancel: () => {} })
  assert.ok(editor.includes('<form'))
  assert.ok(editor.includes('Mandaue City'), 'Editing must preserve multiple existing service areas')
  assert.ok(editor.includes('checked=""'))
  assert.ok(editor.includes('Save changes'))
  assert.ok(!render(Rating, { average: 5, count: 1, showCount: false }).includes('1 review'))
})

test('payment, automatic chat and administrator screens render clear initial and terminal states', async t => {
  const vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
  t.after(() => vite.close())
  const { default: PaymentPanel } = await vite.ssrLoadModule('/src/components/PaymentPanel.jsx')
  const { default: ChatPanel } = await vite.ssrLoadModule('/src/components/ChatPanel.jsx')
  const { default: AdminDashboard } = await vite.ssrLoadModule('/src/components/AdminDashboard.jsx')
  const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
  const pending = render(PaymentPanel, { repair: { id: 'repair', finalCost: 500, payment: null }, token: '', refresh: () => {} })
  assert.ok(pending.includes('Open test checkout'))
  assert.ok(pending.includes('500.00'))
  const paid = render(PaymentPanel, { repair: { id: 'repair', finalCost: 500, payment: { status: 'PAID' } }, token: '', refresh: () => {} })
  assert.ok(paid.includes('PayMongo has verified your payment'))
  assert.ok(!paid.includes('Open test checkout'))
  const cancelled = render(PaymentPanel, { repair: { id: 'repair', finalCost: 500, payment: { status: 'FAILED', checkoutState: 'CANCELLED' } }, token: '', refresh: () => {} })
  assert.ok(cancelled.includes('Create new test checkout'))
  const chat = render(ChatPanel, { repairId: 'repair', user: { id: 'user' }, token: '' })
  assert.ok(chat.includes('Loading conversation'))
  assert.ok(chat.includes('role="log"'))
  assert.ok(chat.includes('2,000 characters'))
  const admin = render(AdminDashboard, { token: '' })
  assert.ok(admin.includes('Administrator dashboard'))
  assert.ok(admin.includes('Payment statuses are read-only'))
  assert.ok(admin.includes('Loading users'))
})
