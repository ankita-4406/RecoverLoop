# Security

RecoverLoop is a local-first product prototype using simulated data. It does not contain payment credentials, configure a live Razorpay source, process card data, send customer messages, or move money.

This document distinguishes demo controls from the work required before a production integration.

The prototype intentionally uses one synthetic workspace. Host it privately for review; a shared or public deployment requires authenticated tenant scoping and rate limits before accepting mutations.

## Trust boundaries

| Boundary | Threat | Control |
| --- | --- | --- |
| Browser to application | Forged or malformed demo action | Narrow action allow-list, same-origin mutation check, bounded JSON body, and server-side transition rules |
| Payment provider to intake | Forged, replayed, or reordered event | Raw-body HMAC validation, event-ID idempotency, and canonical state rules |
| Application to AI | Prompt injection, data leakage, invalid action | Minimise data, treat payload text as data, constrain output, revalidate policy |
| Application to messaging/payment provider | Duplicate or ambiguous command | Idempotency key, transactional receipt, timeout reconciliation, circuit breaker |
| Operator to case | Unauthorised cross-tenant action | Production gate: authenticated session, tenant-scoped authorization, step-up approval |
| Application to D1 | Injection or excess access | D1 prepared statements with bound parameters, typed Drizzle schema, no client-side database access |

## Controls in the demo

- Synthetic records only; no PAN, CVV, UPI PIN, bank credential, real email, or real phone number.
- Integer minor units for money to avoid floating-point ambiguity.
- Small enumerated contracts for case status, recovery action, health state, and Reliability Lab action.
- `application/json` enforcement, strict request-size bounds, an exact `X-RecoverLoop-Action: demo` intent header, same-origin mutation checks, and correlation IDs.
- Security headers on JSON responses, including `no-store`, `nosniff`, frame denial, and a restrictive API content policy.
- The HTML policy blocks external origins, objects, and framing. Vinext hydration currently requires inline bootstrap/style allowances; replace them with nonces or generated hashes before a production rollout.
- Raw-body HMAC-SHA256 verification for the Razorpay webhook route when `RAZORPAY_WEBHOOK_SECRET` is configured.
- Constant-time signature comparison and durable event-ID replay classification.
- Webhook persistence keeps event metadata and a SHA-256 payload hash, not the raw provider body.
- D1 prepared statements with bind parameters and optimistic revision checks.
- Hash-linked audit and provider-event records provide tamper evidence inside the application data model; this is not immutable storage or independent attestation.
- Deterministic policy for incident suppression, risk abstention, and terminal success.
- AI is optional; loss of the model does not disable safety gates.
- Decision source, rejected alternatives, signals, and transitions are visible to the operator.
- Secrets are not committed. `.env.example` contains placeholders only, and local `.env*` files are ignored.
- Outbound payment and messaging connectors are simulated.

## Required before production

### Complete the webhook integration

The demo endpoint already reads bounded raw bytes, verifies HMAC-SHA256 with constant-time comparison, and classifies repeated event IDs. Before live use, add tenant-aware secret lookup, a bounded old/new secret rotation window, full provider-event schema validation, and reconciliation against the provider API.

Razorpay's official guidance requires validating `X-Razorpay-Signature` over the unmodified raw body. See [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/).

### Replay and ordering safety

- Uniquely index `(merchant_id, provider_event_id)` using `x-razorpay-event-id`.
- Return a successful acknowledgement for an already-processed valid event.
- Do not assume delivery order; apply an explicit state-precedence table.
- Use separate idempotency keys for event receipt and outward action.
- Persist an action intent before dispatch and reconcile unknown outcomes.

### Authentication and authorization

- Put the control plane behind organisation SSO and MFA.
- Deny by default; scope every case query and action to the current merchant.
- Separate viewer, recovery operator, risk reviewer, and administrator privileges.
- Require step-up approval for high-value or policy-sensitive actions.
- Revalidate authorization and case version at execution time to prevent stale approval.

### Data protection

- Never store or send PAN, CVV, UPI PIN, issuer authentication data, or gateway secrets through the planner.
- Tokenise customer references and send the model derived features only.
- Encrypt data in transit and at rest; separate development, staging, and production resources.
- Define retention and deletion for raw events, decision receipts, message drafts, and audit logs.
- Redact secrets and direct identifiers from logs. Use correlation IDs instead of payload dumps.

### API and abuse controls

- Require `application/json`, bound body size, and reject unknown fields.
- Apply per-tenant and per-actor rate limits.
- Retain the same-origin protection and add token-based CSRF protection if the production authentication architecture uses cookies across origins or embedded contexts.
- Use restrictive CORS and security headers.
- Set timeouts and circuit breakers for every external dependency.
- Never accept an arbitrary callback URL; use provider allow-lists and controlled connectors.

### AI safety

- Keep `OPENAI_API_KEY` in the platform secret store and server-side only.
- Send no credentials, cardholder data, or unneeded direct identifiers.
- Supply an action allow-list generated by policy.
- Use schema-constrained output and strict validation.
- Re-run current policy after the response to prevent time-of-check/time-of-use drift.
- Record model, prompt-policy version, latency, fallback reason, and output hash without logging sensitive prompt content.
- Pin an evaluated model version for production changes and maintain a rollback path.

## Secret handling

`.env.example` documents names, never values. For local development, use `.env.local`; for a deployed Worker, use the platform's encrypted secret mechanism. `OPENAI_API_KEY` and `RAZORPAY_WEBHOOK_SECRET` are server-only. Never put API keys, Razorpay key secrets, webhook secrets, customer payloads, or copied production tokens in Git history.

If a credential is ever committed, revoke and rotate it; deleting the line from the latest commit is not sufficient.

## Logging policy

Log structured event metadata such as timestamp, correlation ID, tenant-scoped pseudonymous resource ID, event type, policy code, planner source, latency, and outcome. Do not log raw provider payloads, signatures, authorization headers, API keys, message bodies, direct contact details, or sensitive risk signals.

## Security review checklist

- [ ] Threat model updated for the live connectors.
- [ ] Raw-body webhook signature tests include negative and rotation cases.
- [ ] Duplicate, reorder, and timeout integration tests pass.
- [ ] Tenant isolation and role matrix tests pass.
- [ ] Dependency and secret scanning run in CI.
- [ ] Data inventory, retention, and deletion are approved.
- [ ] Model red-team tests cover prompt injection and prohibited actions.
- [ ] Operational alerts and rollback are exercised.
- [ ] Payment, privacy, and communications compliance owners approve launch.

The secure-design posture follows least privilege, input allow-listing, parameterised data access, privacy-safe logging, and fail-closed outward actions. These controls are documented as production requirements where the current simulation cannot prove them.
