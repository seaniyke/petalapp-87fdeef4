# The Petal Backend Quality Bible

The standard for every backend **Petal generates**. Backends are not optional extras bolted on when a form needs saving — they are designed with the app.

Version 1.0 — 2026-08-06.

---

## 1. Baseline — every app with a backend

Non-negotiable, regardless of domain:

| Layer | Standard |
|---|---|
| **Auth** | Email + password and at least one social provider. No anonymous sign-up. No auto-confirm unless asked. Password reset works end to end. |
| **Database** | Explicit schema. Every table has a primary key, `created_at`, and an owner/tenant column where rows belong to someone. |
| **Row-level security** | Enabled on every table at creation, with policies written in the same migration. A table without policies is locked, not open. |
| **Grants** | Every new public table receives explicit grants for the roles its policies allow, in the same migration. RLS alone is not access. |
| **Roles** | Stored in a dedicated `user_roles` table, never on the profile/users row. Checked via a security-definer function. Client-side role claims are never trusted. |
| **Validation** | Every input validated server-side with a schema. Client validation is UX, not security. |
| **Errors** | Typed, mapped to friendly messages at the boundary. Internal details never returned to the client. |
| **Logging** | Structured, correlated by request id. Never logs secrets, tokens, or PII. |
| **Rate limiting** | On every mutating and every unauthenticated endpoint. |
| **Secrets** | Server-side only, read at call time, never in client bundles, never echoed. |
| **Monitoring** | Health check, error rate, and latency visible somewhere a human looks. |
| **Deployment** | Migrations are versioned and forward-only. Verified after deploy. |

## 2. Data modelling

- Model the domain, not the screens. Screens change; entities don't.
- Normalize by default; denormalize only with a stated read-path reason.
- Foreign keys with explicit delete behaviour (`cascade` vs `restrict`) chosen deliberately.
- Enums for closed sets, not free strings.
- Money is integer minor units plus a currency code. Never a float.
- Timestamps are UTC with timezone; display converts.
- Soft-delete anything a user could regret deleting.
- Index every foreign key and every column used in a filter or sort.

## 3. Authorization model

- Every query answers "who is allowed to see this row?" at the database, not in application code.
- Ownership policies scope to the authenticated user; tenant policies scope to org membership.
- Public read is opt-in per table, per column intent — never the default.
- Admin/service access is a separate, privileged path, used only after the caller's role is verified through a normal authenticated read.
- Sensitive columns (password hashes, tokens, internal notes, raw payment data) are unreadable by the owning user unless there's a stated reason.

## 4. API surface

- Client-to-server app logic uses typed server functions. Raw HTTP routes exist for webhooks, public APIs, and cron.
- Public endpoints verify the caller inside the handler — signature, shared secret, or token. "Public" means unauthenticated, not unverified.
- Consistent shapes: `{ data }` or `{ error: { code, message } }`.
- Idempotency keys on anything that creates money, messages, or jobs.
- Pagination on every list endpoint. No unbounded selects.
- Versioned contracts for anything an external party consumes.

## 5. Storage

- Buckets are private by default; public buckets are a deliberate decision.
- Access via time-limited signed URLs.
- Uploads validate MIME type and size server-side; filenames are generated, never trusted.
- Ownership path convention (`{userId}/{resource}/{file}`) enforced by policy.

## 6. Background work

- Long or fallible work goes to a queue or scheduled job, never inline in a request.
- Every job is idempotent and retryable with backoff.
- A dead-letter path exists and is observable.
- Scheduled jobs record last-run and last-success timestamps.

## 7. Domain packs

### SaaS
Multi-tenancy from day one (org → membership → role). Subscription state as a first-class table. Usage metering separate from billing. Invitations with expiry. Per-org settings. Audit trail of admin actions. Account deletion that actually deletes.

### Fintech
Append-only audit log for every balance-affecting event. Double-entry ledger; balances derived, never stored as the source of truth. Idempotency on every transfer. Webhook signature verification with replay protection. KYC status as a state machine with document references, never raw documents in the app database. Retries with exponential backoff and a settled/failed terminal state. Explicit permission matrix. Reconciliation job. Nothing about money is eventually consistent by accident.

### Marketplace
Buyer/seller identities with separate onboarding. Listings with inventory and availability constraints enforced at the database. Order state machine with allowed transitions. Escrow or split payments with a payout ledger. Messaging with abuse reporting. Search with filters and pagination. Reviews tied to completed orders only. Dispute records.

### Social / community
Follow graph with efficient fan-out reads. Content moderation flags and a review queue. Blocking that is enforced in queries, not the UI. Notification preferences honoured server-side. Rate limits on posting.

### Booking / scheduling
Availability as intervals with timezone correctness. Overlap prevention enforced by a database constraint, not application logic. Cancellation policy and window. Reminder jobs. Calendar export.

### E-commerce
Product/variant/inventory split. Cart as a server-side entity. Price captured at order time. Tax and shipping as line items. Payment intents with webhook confirmation. Order state machine. Refund records.

### Health / regulated
Minimum necessary data. Field-level encryption for sensitive attributes. Access logging on every read of a sensitive record. Explicit consent records. Data export and deletion paths.

## 8. Security checklist

- [ ] RLS enabled on every table, with policies, in the creating migration
- [ ] Grants present for every new public table
- [ ] Roles in a separate table, checked server-side
- [ ] No secret in any client bundle or log line
- [ ] All input schema-validated server-side
- [ ] Webhooks signature-verified with replay protection
- [ ] Rate limits on unauthenticated and mutating endpoints
- [ ] No user-controlled string interpolated into SQL
- [ ] Redirect targets validated against an allowlist
- [ ] Error responses leak no internals
- [ ] Sensitive tables have no public read policy
- [ ] Privileged/service credentials used only after verifying the caller

## 9. Operational floor

- Health endpoint returning dependency status.
- Structured logs with request correlation and no PII.
- Error rate and latency observable per endpoint.
- Migrations reversible in intent, forward-only in practice, and never destructive without an explicit instruction.
- Seed data ships in the migration when the first screen must show rows — never seeded on page load.
- Backups and a stated recovery expectation for anything holding user data.

---

## 10. Generation checklist

A generated backend is not done until every baseline row in §1 is satisfied, the domain pack for the detected product type is applied, §8 passes, and the frontend's first screen renders real data from it.

*Version 1.0 — 2026-08-06.*
