# Architecture

RecoverLoop is an incident-aware decision and operations layer around payment recovery. It does not replace a payment gateway and it does not execute financial transactions in this demo.

All records and outcomes shown by the application are simulated.

## Design goals

1. Prefer a correct non-action over a harmful retry.
2. Treat payment events as duplicated, delayed, and potentially out of order.
3. Keep policy deterministic and AI replaceable.
4. Make every action explainable and auditable.
5. Run locally with no credentials or external dependencies.

## System context

```mermaid
flowchart TB
    subgraph External["External systems — simulated in this repository"]
        PG["Payment provider"]
        STATUS["Provider incident feed"]
        MSG["Messaging provider"]
        LLM["OpenAI Responses API — optional"]
    end

    subgraph Edge["Cloudflare Worker runtime"]
        ROUTES["Vinext request and route layer"]
        INGEST["Event intake"]
        RECOVERY["Recovery orchestrator"]
        POLICY["Safety policy"]
        PLAN["Constrained / deterministic planner"]
        ACTION["Action coordinator"]
        AUDIT["Decision receipts"]
    end

    subgraph Experience["Operator experience"]
        UI["React 19 dashboard"]
        LAB["Reliability Lab"]
    end

    subgraph Data["Persistence"]
        D1["Cloudflare D1 · seed-once synthetic state"]
    end

    PG -. "POST /api/webhooks/razorpay" .-> INGEST
    STATUS -. "health event" .-> INGEST
    ROUTES --> INGEST
    INGEST --> RECOVERY
    RECOVERY --> POLICY
    POLICY --> PLAN
    PLAN -. "allowed planning request" .-> LLM
    PLAN --> ACTION
    ACTION -. "approved command" .-> MSG
    RECOVERY --> AUDIT
    ACTION --> AUDIT
    RECOVERY --> D1
    UI -->|"GET /api/state"| ROUTES
    LAB -->|"POST /api/actions"| ROUTES
```

Solid lines represent the implemented product loop. Dashed integrations are production-facing seams; the checked-in demo simulates them and does not send network requests to a payment or messaging provider.

## Request boundaries

| Boundary | Responsibility | Failure posture |
| --- | --- | --- |
| UI | Render state, collect explicit operator intent | Never infers success from optimistic UI |
| Route/API layer | Serve `GET /api/state`, `POST /api/actions`, and `POST /api/webhooks/razorpay` | Require explicit demo intent; reject unknown actions, malformed IDs, oversized bodies, and invalid signatures |
| Recovery engine | Apply transitions and recompute metrics | Preserve terminal success; make repeated events idempotent |
| Policy | Enforce incident, risk, consent, fatigue, and approval rules | Deny or abstain when a safe action is not available |
| Planner adapter | Rank only policy-allowed actions and explain the choice | Tested deterministic fallback on missing key, timeout, or invalid output |
| Action coordinator | Record a simulated action result | Unknown outcome is not equivalent to failure and is not blindly repeated |
| Persistence | Store state and audit records | Fail closed for outward actions if durable state is unavailable |

## Recovery sequence

The production sequence below is the design target. The Reliability Lab injects equivalent synthetic transitions through the application's demo API.

```mermaid
sequenceDiagram
    autonumber
    participant P as Payment provider
    participant I as Event intake
    participant S as State store
    participant R as Recovery engine
    participant H as Incident health
    participant A as Optional AI planner
    participant O as Operator
    participant M as Messaging provider

    P->>I: payment.failed + event ID + signature
    I->>I: Verify signature over raw body
    I->>S: Insert event if event ID is new
    alt duplicate event
        S-->>I: Existing receipt
        I-->>P: 2xx, no duplicate action
    else new event
        I->>R: Evaluate canonical payment state
        R->>H: Correlate rail / issuer incident
        alt incident, risk block, no consent, or contact cap
            R->>S: Suppress or require review + reason
        else recovery action is allowed
            R->>A: Allowed actions + minimised signals
            alt valid response before deadline
                A-->>R: Structured proposal
                R->>R: Revalidate against policy
            else unavailable, late, or invalid
                R->>R: Use deterministic plan
            end
            R->>S: Persist decision receipt
            R-->>O: Request approval when required
            O->>R: Approve exact action
            R->>M: Dispatch with idempotency key
            M-->>R: Accepted, rejected, or unknown
            R->>S: Persist outcome without blind retry
        end
    end

    opt later payment success arrives
        P->>I: payment.captured
        I->>S: Advance canonical state to succeeded
        I->>R: Cancel stale recovery work
        R->>S: Record superseding receipt
    end
```

## State and invariants

The case state is deliberately small: observing, pending approval, scheduled, recovered, suppressed, or manual review. Transitions observe these invariants:

- `recovered` supersedes a prior failure and stops pending recovery work.
- Replaying the same event or command does not repeat its business effect.
- A provider timeout yields an unknown outcome, not permission to issue a second command.
- An active provider incident suppresses customer-blaming outreach.
- A risk block cannot be bypassed through an alternate rail.
- AI output must pass the same policy checks as deterministic output.
- High-impact actions require explicit operator approval.
- Money is represented in integer minor units; display formatting is a UI concern.

## Data shape

A recovery case joins the minimum context needed to make a safe decision:

- payment amount, currency, rail, and normalised failure class;
- pseudonymous customer reference, tenure, segment, locale, and consent;
- contact count, case status, owner, and expected value;
- recommendation, explanation, rejected actions, signals, and timeline;
- planner source (`policy`, `ai`, or `fallback`) and confidence.

The demo seed contains synthetic personas for storytelling. A production planner should receive pseudonymous references and derived features, not raw card data, authentication data, email addresses, or phone numbers.

### Persistence layout

| D1 table | Stored purpose |
| --- | --- |
| `dashboard_state` | Seed-once dashboard state, optimistic revision, state hash, and current audit-chain head |
| `provider_events` | Unique provider event ID, allow-listed event type, payload hash, correlation ID, and chained integrity metadata |
| `audit_records` | Demo action receipt with before/after hashes, correlation ID, and chained integrity metadata |

Schema bootstrap is idempotent at runtime. Mutations use bound D1 statements and optimistic revision checks, so concurrent updates are retried within a small fixed bound. The webhook route stores a SHA-256 payload hash rather than the raw provider payload. Hash links make missing or modified application records detectable during verification; they do not make D1 immutable or provide independent attestation.

## Why this stack

- **Vinext + React 19**: one TypeScript application with server-rendered product UI and route handlers.
- **Cloudflare Worker runtime**: an edge-compatible execution model suitable for fast intake and operator reads.
- **Cloudflare D1 + Drizzle**: SQL persistence with typed schema access and a checked-in deployment migration.
- **OpenAI Responses API, optional**: the guarded re-plan control invokes a tested server-side adapter, then current policy revalidates and versions the result before persistence; zero-key mode uses the same deterministic fallback path.
- **Node test runner + ESLint + TypeScript build**: a compact verification path with fewer moving parts.

“Latest” is not the goal by itself. Versions are locked in `package-lock.json`, the runtime floor is declared in `package.json`, and the demo has no required SaaS dependency.

## Scale path

For production, separate intake from planning with a durable queue, partition idempotency by merchant and provider event ID, and use a transactional outbox for approved commands. Keep raw event retention short, store normalised features separately, and reconcile unknown provider outcomes before retrying. Apply tenant scoping at every query and action boundary.
