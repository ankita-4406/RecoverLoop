# Failure recovery

RecoverLoop treats failure handling as product behavior, not a hidden exception path. The Reliability Lab exposes five deterministic drills that can be repeated during judging.

> [!NOTE]
> No real 2 AM production incident occurred during this project. “What broke at 2 AM” is presented honestly as a controlled incident drill using simulated data.

## Drill matrix

| Drill | Fault injected | Safe response | Invariant demonstrated |
| --- | --- | --- | --- |
| Duplicate webhook | Re-deliver the same provider event ID | Acknowledge and record the replay without another business action | At-most-once business effect |
| Out-of-order success | Deliver success after a failure plan exists | Mark the payment recovered and cancel stale work | Confirmed success supersedes failure |
| AI outage | Make the optional planner unavailable | Degrade planner health and use deterministic fallback | AI is replaceable, policy remains available |
| Provider timeout | Return no definitive messaging result | Treat the result as unknown and stop blind redispatch | Unknown is not failed |
| Incident resolution | Resolve the incident suppressing a case | Re-evaluate the paused case under current policy | Recovery resumes from state, not from guesswork |

Reset restores the synthetic baseline, making the demo repeatable.

## Incident drill narrative

**Alert:** the AI planner and messaging provider are unhealthy while a payment provider is also reporting UPI degradation.

**First response:** keep intake and the operator dashboard available. The hard policy suppresses UPI-related outreach. AI-backed planning moves to deterministic fallback. Messaging timeouts are recorded as unknown rather than failed.

**Containment:** open the circuit breaker for the unhealthy dependency, preserve event receipts, and stop new outward actions that cannot be made idempotently. Already-confirmed payment successes continue to cancel stale work.

**Diagnosis:** use correlation IDs and decision receipts to separate event intake, policy, planning, and dispatch failures. Check provider status and reconcile timeout outcomes at the provider before attempting another command.

**Recovery:** after an incident-resolution signal, re-evaluate suppressed cases against current payment state, consent, contact history, and policy. Close the circuit gradually and observe error/timeout rates.

**Proof:** replay duplicate and out-of-order events. The customer receives neither a duplicate message nor a message for an already-successful payment.

## What a naïve design gets wrong

The initial temptation in a revenue-recovery product is one queue: every failure enters, every item gets retried, and every retry failure triggers a reminder. That design cannot distinguish customer-fixable failures from provider incidents, and it assumes event order is trustworthy.

RecoverLoop instead separates four facts:

1. What event arrived?
2. What is the canonical payment state now?
3. Which actions are permitted now?
4. What happened to the exact action already dispatched?

That separation is the main engineering answer to duplicates, reordering, outages, and ambiguous provider responses.

## Production recovery playbooks

### Duplicate rate spike

- Keep returning timely `2xx` responses for valid events.
- Track replay rate by merchant and event type.
- Deduplicate on merchant plus `x-razorpay-event-id`.
- Do not suppress distinct events that happen to share a payment ID.

### Event lag or reordering

- Derive canonical state from explicit precedence, not arrival order.
- Reconcile high-value ambiguous payments through the provider API.
- Cancel pending actions when a terminal success is confirmed.

### AI latency or outage

- Open the planner circuit after the configured threshold.
- Route eligible cases to deterministic fallback.
- Keep policy-only suppressions and manual-review routing active.
- Never weaken a hard gate to preserve throughput.

### Messaging timeout

- Persist the dispatch key before the outbound call.
- Mark the attempt `unknown`, then query the provider with that key.
- Retry only after reconciliation proves no prior acceptance.
- Keep the contact cap based on attempted and confirmed contacts as policy requires.

### Persistence unavailable

- Continue health reporting if possible.
- Stop new external actions because idempotency cannot be guaranteed.
- Buffer signed events only in an approved durable queue.
- Replay through the normal idempotent intake path after recovery.

## Razorpay alignment

Razorpay documents that webhook duplicates can occur and that event order is not guaranteed. It recommends identifying duplicates with `x-razorpay-event-id`, and validating `X-Razorpay-Signature` against the raw request body. Those are production integration requirements; this repository demonstrates the resulting behavior with synthetic events.

- [Validate and test Razorpay webhooks](https://razorpay.com/docs/webhooks/validate-test/)
- [Set up payment webhooks and delivery behavior](https://razorpay.com/docs/webhooks/setup-edit-payments/)
