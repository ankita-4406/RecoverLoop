# Operations

RecoverLoop is designed to be judged locally without external setup and to expose degraded behavior directly in the product.

All operational data and incident states in the demo are simulated.

## Local runbook

Prerequisite: Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Open the URL printed by the development server. The deterministic planner requires no environment variables.

Optional adapter configuration:

```bash
cp .env.example .env.local
```

Add the key locally, never to Git. **Re-plan with guardrails** uses it only on the server; without it, the same workflow persists a deterministic fallback.

## Verification

```bash
npm run check
```

The dependency graph is locked by `package-lock.json`; use `npm ci` for a reproducible install. `npm run check` runs linting, type checking, domain/AI tests, API/D1/security integration tests, a production build, and rendered-output tests. Use `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:api`, `npm run build`, or `npm run test:render` when isolating a failure.

## Runtime configuration

| Setting | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | No | unset | Enables live server-side planning from the guarded re-plan control |
| `OPENAI_MODEL` | No | `gpt-5.4-mini` | Adapter model override |
| `OPENAI_TIMEOUT_MS` | No | `4000` | Adapter deadline before deterministic fallback |
| `RAZORPAY_WEBHOOK_SECRET` | No for dashboard; yes for webhook intake | unset | Verifies `X-Razorpay-Signature` over the raw body |

The Cloudflare D1 `DB` binding is infrastructure configuration, not a secret. Local development uses the project-local Worker emulator, so no remote database needs to be provisioned.

## HTTP surface

| Method and path | Purpose |
| --- | --- |
| `GET /api/state` | Read the current command-center state |
| `POST /api/actions` | Apply one allow-listed case or Reliability Lab action; requires `X-RecoverLoop-Action: demo` |
| `POST /api/plan` | Generate, policy-revalidate, version, and persist one recovery plan |
| `POST /api/webhooks/razorpay` | Validate and record a signed Razorpay-shaped event |

API responses are non-cacheable and include a correlation ID. The demo-intent header prevents accidental generic POSTs but is not authentication. The webhook route is optional for the local dashboard; without a configured webhook secret it fails closed.

## Health model

The UI separates four signals:

- **Ingest:** can the system accept and normalise events?
- **Planner:** is the selected planning path available?
- **Messaging:** can an outward communication be confirmed?
- **Circuit breaker:** are calls to an unhealthy provider being contained?

Planner mode is shown independently as constrained AI or deterministic fallback. A degraded planner is therefore visible without implying the whole recovery system is down.

## Runbooks

### AI planner unavailable

1. Confirm the planner health signal and timeout rate.
2. Keep hard policy and deterministic fallback active.
3. Do not bypass schema validation or expand the allowed action set.
4. Check key configuration, provider status, and rate limits without logging credentials.
5. Restore gradually; compare policy violation and fallback rates before closing the incident.

### Messaging provider timeout

1. Open the circuit breaker at the configured threshold.
2. Mark affected dispatches as unknown.
3. Reconcile by idempotency key with the provider.
4. Retry only when the provider confirms the original command was not accepted.
5. Preserve contact caps across attempts and confirmations.

### Payment-provider incident

1. Correlate by rail, issuer, region, and time window.
2. Suppress customer-blaming outreach and immediate retries.
3. Keep cases visible with the policy reason and next evaluation trigger.
4. On resolution, re-read current payment state before rescheduling.
5. Release work in bounded batches and watch decline/timeout rates.

### Duplicate or reordered events

1. Confirm signature and event identity.
2. Return the stored receipt for an exact replay.
3. Apply state precedence for a distinct, late event.
4. Cancel stale work when success is confirmed.
5. Alert only if replay or reordering rates exceed the established baseline.

### State store unavailable

1. Fail closed for new outward actions; idempotency cannot be guaranteed.
2. Keep health reporting available where possible.
3. Retain signed events only in an approved durable queue.
4. Restore persistence and replay events through normal intake.
5. Reconcile all unknown action outcomes before reopening dispatch.

## Production observability

Use structured, privacy-safe telemetry with a correlation ID spanning event receipt, policy decision, planner attempt, approval, dispatch, and provider reconciliation.

Suggested operational signals:

- webhook validation failures and duplicate ratio;
- event lag and reorder count;
- policy suppressions by reason;
- AI latency, invalid-output rate, and fallback rate;
- approval age and stale-decision rejection;
- provider timeout and unknown-outcome age;
- duplicate or post-success action count;
- recovery amount and contacts per recovery.

Do not log raw webhook bodies, signatures, API keys, direct customer identifiers, or message contents.

## Proposed service targets

These are launch targets, not results measured by the demo.

| Signal | Proposed target |
| --- | --- |
| Valid webhook acknowledgement | p95 under 2 seconds |
| Duplicate business effects | 0 |
| Outward actions after confirmed success | 0 |
| Hard-policy violations | 0 |
| Planner fallback decision | p95 under 500 ms after AI failure is known |
| Unknown provider outcomes | reconciled within 15 minutes |

## Deployment notes

The repository targets a Cloudflare Worker-compatible runtime through Vinext. A hosted environment must supply its D1 binding and secrets through the platform control plane. Provisioning live provider accounts, webhook endpoints, messaging approval, and compliance controls is intentionally outside this simulated submission and is not needed to run or review it locally.

See [Security](SECURITY.md) before connecting any real customer or payment data.
