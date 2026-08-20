# Five-minute demo script

This script is timed to **5:00 exactly**. Record at 1080p, keep the browser at a readable zoom, and start from a reset state. Do not show an API key or claim that simulated actions touched real customers or payments.

## Before recording

1. Run `npm ci`, then `npm run check`.
2. Start `npm run dev` and open the printed local URL.
3. Click **Reset demo** if the state has been changed.
4. Close notifications and hide bookmarks or personal browser data.
5. Keep `docs/ARCHITECTURE.md` open for the final architecture shot.

## 0:00–0:30 — Hook

**Screen:** dashboard overview.

**Say:**

“This is RecoverLoop: recover revenue without retry spam. A failed payment does not always mean ‘retry.’ The provider may be down, success may arrive late, the customer may need to authenticate, or a risk control may require us to stop. RecoverLoop turns those messy signals into a safe, explainable next action. Everything you see is simulated; no real customer is contacted and no payment is moved.”

## 0:30–1:05 — Business signal

**Screen:** metric cards and baseline comparison.

**Say:**

“The control plane shows revenue at risk, recovered and incremental value, recovery rate, median time, and contacts avoided. The comparison is an illustrative synthetic scenario, not a production claim. The product objective is the important part: incremental recovered revenue with fewer unnecessary contacts, rather than maximising attempts.”

## 1:05–1:50 — One decision receipt

**Action:** open the expired-instrument case, click **Re-plan with guardrails**, and show its explanation, rejected actions, planner source, decision version, and approval state.

**Say:**

“This expired-card case is not retried because that cannot repair the instrument. Re-plan calls the server planner; with no key it visibly takes the deterministic fallback, and with a key it uses constrained AI. Either result is revalidated against current policy, persisted, and given a new approval version. AI cannot override consent, incidents, risk, contact caps, or approval.”

## 1:50–2:10 — Duplicate webhook

**Action:** in Reliability Lab, run **Duplicate webhook**.

**Say:**

“Payment webhooks can be delivered more than once. Replaying the same event produces an idempotent receipt, not a second recovery action. That protects both the customer and the merchant.”

## 2:10–2:35 — Out-of-order success

**Action:** run **Success arrives late** and point to the updated case and audit timeline.

**Say:**

“Delivery order is not guaranteed. Here, success arrives after a failure plan already exists. Confirmed success wins: the case becomes recovered and stale outreach is cancelled. We never infer payment state from arrival order.”

## 2:35–3:00 — AI outage

**Action:** run **AI provider offline** and point to planner health and planner mode.

**Say:**

“Now the AI planner fails. Policy stays online and the planner switches to deterministic fallback. This is intentional AI judgment: the model improves contextual ranking and copy, but it is not a safety dependency and never owns the state machine.”

## 3:00–3:25 — Provider timeout

**Action:** run **Provider timeout** and show the circuit-breaker/audit response.

**Say:**

“A messaging timeout is ambiguous. RecoverLoop records an unknown outcome and contains the dependency instead of blindly sending again. In production, the command is reconciled by idempotency key before any retry.”

## 3:25–3:50 — Incident resolution

**Action:** show the incident-suppressed UPI case, then run **UPI rail restored**.

**Say:**

“This UPI case was suppressed because the failure matched an active provider incident. On resolution, RecoverLoop re-evaluates the current case instead of blaming the customer. Recovery resumes from verified state and current policy.”

## 3:50–4:20 — Audit proof

**Screen:** audit stream and case timeline.

**Say:**

“Every drill leaves a decision receipt: what arrived, which policy fired, what was proposed, what was rejected, and how the dependency behaved. Stored action receipts are SHA-256 hash-linked for tamper evidence. That makes missing or changed application records detectable during verification; it does not claim immutable storage or external attestation.”

## 4:20–4:45 — Architecture

**Screen:** architecture Mermaid diagram in `docs/ARCHITECTURE.md` or the README.

**Say:**

“The stack is React 19 and TypeScript on Vinext with a Cloudflare Worker-compatible runtime, D1 and Drizzle persistence, and a callable OpenAI Responses API planner. The same re-plan workflow falls back deterministically, so the demo remains reliable without external services.”

## 4:45–5:00 — Close

**Screen:** return to the dashboard overview.

**Say:**

“RecoverLoop does not recover revenue by trying harder. It recovers intelligently, abstains when needed, and proves what it did. Recover revenue without retry spam.”
