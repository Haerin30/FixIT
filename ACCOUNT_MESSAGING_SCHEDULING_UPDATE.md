# Account, messaging, scheduling and final-price update

Branch: `feature/account-messages-scheduling-pricing`, based on `e8b8d73`. No push or merge performed.

## Changes

- Circular initials avatar for all roles, with role-specific account links, full name/email/role, outside-click dismissal, Escape, arrow/Home/End keyboard navigation and focus handling. Signing out clears the token, account/profile/repair/conversation state and stale checkout return parameters.
- **My Account** and **Account Settings** use authenticated owner-only endpoints. First/last name and phone are editable. Email, role and password hashes cannot be changed through these endpoints. Public technician details remain on **My Public Profile**, with its separate editor.
- **Messages** is a dedicated customer/technician navigation tab. It lists authorized repair conversations, including repairs with no messages, and shows participant identity, repair title/status, last-message preview/time and selection. Conversations are paginated and refreshed automatically.
- Repair cards are semantic articles with independent **View Details** and **Message Technician/Customer** buttons. Repair details no longer contain embedded chat; the message shortcut selects that exact repair. The inbox provides **View Repair Details**, and mobile navigation provides **Back to Conversations**.
- Existing ChatPanel polling, persistence, privacy, retry identifiers, timestamps, offline/error handling and auto-scroll are reused. Conversation metadata is refreshed every five seconds; messages are checked about every four seconds.
- Only the assigned technician can propose schedules by default. A technician may explicitly delegate scheduling to that repair's customer. While delegated, the customer proposes and the technician responds. Revoke delegation before switching back to technician proposals.
- Pending proposals must be confirmed/rejected before changing authority. Confirmed schedules block delegation changes and new proposals. Existing schedules and historical records are preserved. Self-confirmation, unrelated participants and past proposals are rejected server-side.
- Date errors distinguish missing values, invalid formats/calendar dates, past start times, end-before-start and visits over 24 hours. Inputs and displayed visit times explicitly use Philippine time (UTC+08:00), independent of the device timezone. Failed submissions retain entered values.
- The assigned technician may correct the final fee while awaiting customer confirmation. After customer approval but before checkout, a correction reopens confirmation and invalidates the old approval. Price corrections and approvals are audited; the customer must submit the currently displayed price revision.
- Pricing, customer approval, scheduling and payment checkout share per-repair PostgreSQL advisory locks and fresh reads. Checkout reads the latest approved amount after obtaining the lock. Concurrent or stale price approvals cannot silently authorize a different amount.

## Important pricing boundary

The request ended at **“If checkout already exists … I”**. Pending clarification, the conservative implemented rule is: **any existing Payment record blocks a final-price correction**, including failed, cancelled or expired checkout records. No active checkout amount is modified, no transaction is deleted, and no replacement fee is silently applied. Supporting a different correction workflow after an expired checkout requires the missing business instructions.

## Additive database migration

Applied `20261016010000_scheduling_authority_price_revision`:

```sql
ALTER TABLE "RepairRequest"
ADD COLUMN "customerCanProposeSchedule" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priceVersion" INTEGER NOT NULL DEFAULT 0;
```

Existing records receive safe defaults. Existing users, profiles, repairs, confirmed schedules, reviews, messages and payments are preserved. No reset, destructive SQL or forced schema push was used. Prisma remains version 6.19.3.

For another checkout of this branch, run from `server/`:

```powershell
npx --no-install prisma migrate deploy
npx --no-install prisma generate
```

Restart Express after generating the client if the server is running. Do not run migrations from the repository root using an uninstalled Prisma CLI.

## New and changed APIs

| Endpoint | Rule |
| --- | --- |
| `GET /api/account` | Returns only the current user's personal account details. |
| `PATCH /api/account` | Allows `fname`, `lname`, `phone`; rejects other fields, including email/role/password hashes. |
| `GET /api/conversations?page=1` | Customer/technician only; ownership-filtered repair conversation summaries, 30 per page. |
| `GET /api/repairs/:id` | Full repair details for its customer/assigned technician only. |
| `PATCH /api/repairs/:id/scheduling-permission` | Assigned technician; boolean `customerCanProposeSchedule`; accepted repair without an unresolved/confirmed schedule. |
| `POST /api/repairs/:id/schedules` | Technician by default, delegated customer only when enabled. ISO timestamps must include a timezone. |
| `POST /api/repairs/:id/schedules/:scheduleId/respond` | The other participant; rejects own/stale/conflicting confirmations. |
| `PATCH /api/repairs/:id/final-price` | Assigned technician; numeric `finalCost` and current integer `priceVersion`; no payment record may exist. |
| `POST /api/repairs/:id/action` with `confirm` | Now requires the current integer `priceVersion`. Stale/missing revision returns 409 and requires refreshing. |

All state changes retain backend ownership/RBAC enforcement. No client-supplied role, email, payment amount or permission flag can bypass these checks.

## Main files

| Files | Purpose |
| --- | --- |
| `client/src/App.jsx` | Integrates account/inbox navigation, independent repair actions, updated confirmation data, separate scheduling/price panels and sign-out cleanup. |
| `client/src/components/AccountMenu.jsx`, `AccountPage.jsx` | Role-aware menu and personal account display/editor. |
| `client/src/components/MessagesPage.jsx` | Dedicated responsive conversation sidebar and chat/detail navigation using the existing ChatPanel. |
| `client/src/components/RepairRequestCard.jsx` | Accessible repair cards without nested interactive controls. |
| `client/src/components/SchedulingPanel.jsx`, `FinalPriceEditor.jsx` | Delegation, specific date errors, explicit Manila times, price correction and reconfirmation UI. |
| `client/src/lib/philippine-time.js`, `client/src/account-messages.css` | Explicit timezone conversion and responsive styling. |
| `server/src/routes/account.js`, `server/src/index.js` | Authenticated account API and route registration. |
| `server/src/routes/marketplace.js`, `server/src/lib/repair-rules.js` | Inbox/detail endpoints, delegation, scheduling validation, price corrections, audits and per-repair locking. |
| `server/src/lib/workflow.js`, `server/src/routes/payments.js` | Revision-bound confirmation and fresh approved-price reads under the checkout lock. |
| Prisma schema and additive migration | Persist scheduling authority and price revisions. |
| New/updated frontend and backend tests, `server/scripts/smoke.js` | Ownership, date validation, delegation, stale approvals, account edits, inbox behavior and payment regression checks. |
| `client/package.json` and lockfile | Add Node-compatible jsdom 29 as a development-only DOM interaction test dependency. Runtime stack is unchanged. |

## Verification

- `npm test`: 23 backend tests pass, including new rule and HTTP tests for account security, inbox privacy, scheduling authority and price revisions.
- `npm --prefix client test`: five tests pass, including DOM interactions for role menus/keyboard focus/outside click, personal account save, independent repair actions, exact-conversation selection/first message/detail navigation, and explicit Manila conversion.
- `npm run lint` and `npm run build`: pass.
- `npm --prefix server run test:integration:paymongo`: passes against PostgreSQL and real PayMongo sandbox. Tests account updates, authorized conversation metadata, default/delegated scheduling, two audited price corrections, stale approval rejection, reconfirmation, checkout amount lock, a real concurrent price-correction/checkout race (only one operation accepted), provider expiration/retry/cancellation, reviews and admin regression behavior. Only uniquely identified generated QA records are cleaned up. No payment is made and no PAID transaction is simulated in Supabase.
- The additive migration was successfully deployed and the Prisma 6 client regenerated. Use `npx --no-install prisma validate` and `migrate status` from `server/` for validation/status.
- No browser surface was available for visual desktop/mobile verification. DOM tests verify interaction logic, but real viewport layout and a complete hosted sandbox payment remain manual checks.

## Walkthrough

1. Sign in as any role and open the top-right initials menu. View My Account; edit name/phone through Account Settings. For technicians, confirm public details remain separate.
2. Customer books a technician. In My Repairs, **Message Technician** opens the exact repair in Messages, even before the first message. Technician uses **Message Customer** for the same request. Use View Repair Details to return.
3. Technician accepts and proposes a Philippine-time visit. Customer confirms/rejects it. Customers cannot propose by default.
4. For a separate accepted request, technician chooses **Let Customer Propose Schedule**. Customer proposes; technician confirms/rejects. Resolve pending proposals before changing delegation.
5. Technician starts a confirmed visit and submits success with a fee. Choose Edit Final Price before customer confirmation and correct the amount. The customer sees the updated fee.
6. Confirm the fee as the customer. Before any checkout, the technician can request another correction: the repair returns to customer confirmation. An old approval/version is rejected.
7. After reconfirming, create a sandbox checkout. Final-price editing is now blocked; existing checkout amounts/history remain untouched.

Run the client/server using the existing root scripts. Keep local secrets in ignored environment files. This branch is local and uncommitted until further instruction; no push or merge was performed.
