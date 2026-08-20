# Submission pack

Copy the sections below into the application form. Replace only the two link placeholders after publishing the repository and video.

## Project name / title

**RecoverLoop — Incident-Aware Revenue Recovery**

## Project objectives — What does it solve?

RecoverLoop helps subscription and payments teams recover failed revenue without blind retries or customer spam. It combines payment state, failure type, provider incidents, consent, contact history, customer context, and risk policy to recommend the safest next action. Deterministic gates suppress outreach during outages, stop work after late success, deduplicate webhook replays, respect risk blocks, and require approval where appropriate. Its callable AI planner is limited to ranking policy-allowed strategies, explaining recommendations, and drafting respectful copy; each result is revalidated, persisted, and bound to a decision version. A zero-key deterministic fallback keeps the same workflow usable during an AI outage. The result is an auditable recovery control plane focused on incremental revenue and customer trust, not retry volume. This submission uses synthetic data and simulated provider actions only.

## GitHub repository URL

`<GITHUB_REPOSITORY_URL>`

## Five-minute pitch video link

`<PITCH_VIDEO_URL>`

Use the exact recording plan in [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

## Build challenges & technical obstacles

The hardest problem was not generating a recovery message; it was making every recommendation safe under duplicated, delayed, and contradictory events. A naïve failure queue can contact a customer after payment succeeded, retry during a provider outage, or repeat an action when a provider timed out. RecoverLoop addresses this with explicit state precedence, idempotent event handling, incident-aware suppression, bounded contact policy, and an “unknown outcome” state that requires reconciliation before retry. A second challenge was using AI without making it a control-plane dependency. The planner sends only minimised signals and policy-allowed actions, validates structured output, then rechecks the latest case version and policy before persistence. Missing keys, timeouts, and invalid output switch to deterministic fallback. The Reliability Lab makes each failure path reproducible. These were controlled incident drills with simulated data—not claims about a real 2 AM production incident.

## One-line pitch

RecoverLoop is the incident-aware control plane that turns failed payments into safe, explainable next actions—without retry spam.

## Thirty-second pitch

Every failed payment is not the customer's fault. RecoverLoop correlates failures with provider health, resolves duplicated and out-of-order events, applies hard policy, and then uses constrained AI only where judgment helps: ranking an allowed strategy, explaining it, and drafting respectful outreach. When AI or a provider fails, deterministic fallback and circuit breakers preserve safety. Every outcome has a decision receipt. The result is recovery designed around incremental revenue and customer trust.

## Technical summary

- Vinext, React 19, and TypeScript
- Cloudflare Worker-compatible runtime
- Cloudflare D1 and Drizzle persistence path
- Callable, tested OpenAI Responses API planner using `gpt-5.4-mini`, with policy revalidation and versioned persistence
- Zero-key deterministic demo and fallback
- Reliability drills for duplication, reordering, AI outage, provider timeout, and incident resolution
- Automated lint, build, and test commands

## Architecture link

`docs/ARCHITECTURE.md` in the repository.

## Truthful disclosure

All names, payment cases, amounts, incidents, performance metrics, recovery rates, and outcomes are simulated. The project does not connect to Razorpay, process real payment credentials, charge customers, or send real messages. Razorpay documentation informs the production design; Razorpay does not sponsor or endorse this submission.

## Repository readiness checklist

- [x] `npm ci` succeeds from a clean clone.
- [x] `npm run lint` succeeds.
- [x] `npm run typecheck` succeeds.
- [x] `npm run build` succeeds.
- [x] `npm test` succeeds.
- [x] `npm run check` succeeds as the one-command verification gate.
- [x] `npm run dev` opens the dashboard with no credentials.
- [x] Every Reliability Lab scenario is covered by the deterministic domain suite.
- [x] `.env.example` contains placeholders only.
- [x] No `.env.local`, API key, webhook secret, or personal data is committed.
- [ ] GitHub URL replaces the placeholder above.
- [ ] Public five-minute video URL replaces the placeholder above.
- [ ] Video begins from reset state and ends within five minutes.
- [ ] README screenshots or links match the final UI.
