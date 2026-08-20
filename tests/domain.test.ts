import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent, PlannerDecision } from "../lib/contracts";

const { applyDemoAction, applyPlannerDecision, MAX_AUDIT_EVENTS } = (await import(
  new URL("../lib/domain.ts", import.meta.url).href
)) as typeof import("../lib/domain");
const { createSeedState } = (await import(
  new URL("../lib/seed.ts", import.meta.url).href
)) as typeof import("../lib/seed");

const NOW = "2026-08-20T15:00:00.000Z";
const LATER = "2026-08-20T15:01:00.000Z";

test("approval is immutable, scoped, and applied at most once", () => {
  const initial = createSeedState();
  const before = structuredClone(initial);
  const original = initial.cases.find((item) => item.id === "rcv_8F2K1")!;

  const approved = applyDemoAction(
    initial,
    {
      action: "approve_case",
      caseId: original.id,
      decisionVersion: original.decisionVersion,
    },
    NOW,
  );
  const approvedCase = approved.state.cases.find((item) => item.id === original.id)!;

  assert.deepEqual(initial, before);
  assert.equal(approvedCase.status, "scheduled");
  assert.equal(approvedCase.contactCount, original.contactCount + 1);
  assert.equal(
    approved.state.comparison.recoverLoopContacts,
    initial.comparison.recoverLoopContacts + 1,
  );
  assert.equal(approved.state.updatedAt, NOW);
  assert.equal(approved.state.lastScenario, "approve_case");

  const replay = applyDemoAction(
    approved.state,
    {
      action: "approve_case",
      caseId: original.id,
      decisionVersion: approvedCase.decisionVersion,
    },
    LATER,
  );
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.state, approved.state);
});

test("approval rejects a stale decision version", () => {
  const initial = createSeedState();
  const target = initial.cases.find((item) => item.id === "rcv_8F2K1")!;

  const stale = applyDemoAction(
    initial,
    {
      action: "approve_case",
      caseId: target.id,
      decisionVersion: "dec_8F2K1_stale",
    },
    NOW,
  );

  assert.equal(stale.idempotent, true);
  assert.strictEqual(stale.state, initial);
  assert.match(stale.notice, /decision changed/i);
});

test("planner output is persisted with a new approval scope", () => {
  const initial = createSeedState();
  const target = initial.cases.find((item) => item.id === "rcv_8F2K1")!;
  const plan: PlannerDecision = {
    action: "request_method_update",
    actionLabel: "Request method update",
    strategy: "Use one approved account-billing prompt",
    confidence: 0.91,
    explanation: "The expired instrument requires customer action.",
    messageDraft: "Update the saved method in the secure account billing flow.",
    rejectedActions: ["Blind retry — the instrument remains expired"],
    source: "ai",
  };

  const applied = applyPlannerDecision(
    initial,
    target.id,
    target.decisionVersion,
    plan,
    NOW,
  );
  const nextTarget = applied.state.cases.find((item) => item.id === target.id)!;

  assert.equal(nextTarget.plannerSource, "ai");
  assert.equal(nextTarget.strategy, plan.strategy);
  assert.notEqual(nextTarget.decisionVersion, target.decisionVersion);
  assert.equal(applied.state.lastScenario, "refresh_plan");

  const stale = applyPlannerDecision(
    applied.state,
    target.id,
    target.decisionVersion,
    plan,
    LATER,
  );
  assert.equal(stale.idempotent, true);
  assert.strictEqual(stale.state, applied.state);
});

test("planner persistence rechecks hard policy", () => {
  const initial = createSeedState();
  const target = initial.cases.find((item) => item.id === "rcv_6A9M4")!;
  const unsafePlan: PlannerDecision = {
    action: "send_reminder",
    actionLabel: "Tactful reminder",
    strategy: "Contact now",
    confidence: 0.9,
    explanation: "Unsafe fixture",
    messageDraft: "Please retry.",
    rejectedActions: ["Wait"],
    source: "ai",
  };

  const rejected = applyPlannerDecision(
    initial,
    target.id,
    target.decisionVersion,
    unsafePlan,
    NOW,
  );

  assert.equal(rejected.idempotent, true);
  assert.strictEqual(rejected.state, initial);
});

test("stale approval cannot bypass consent or the contact cap", () => {
  const initial = createSeedState();
  const target = initial.cases.find((item) => item.id === "rcv_8F2K1")!;
  target.consent = false;

  const blocked = applyDemoAction(
    initial,
    {
      action: "approve_case",
      caseId: target.id,
      decisionVersion: target.decisionVersion,
    },
    NOW,
  );
  const blockedCase = blocked.state.cases.find((item) => item.id === target.id)!;

  assert.equal(blockedCase.status, "manual_review");
  assert.equal(blockedCase.contactCount, 0);
  assert.equal(
    blocked.state.comparison.recoverLoopContacts,
    initial.comparison.recoverLoopContacts,
  );
});

test("confirmed recovery updates money metrics exactly once", () => {
  const initial = createSeedState();
  const target = initial.cases.find((item) => item.id === "rcv_3D7T8")!;
  const baselineExpected = Math.round(
    target.amountMinor * (initial.comparison.baselineRecoveryRate / 100),
  );

  const recovered = applyDemoAction(
    initial,
    { action: "recover_case", caseId: target.id },
    NOW,
  );
  assert.equal(
    recovered.state.cases.find((item) => item.id === target.id)?.status,
    "recovered",
  );
  assert.equal(
    recovered.state.metrics.recoveredMinor,
    initial.metrics.recoveredMinor + target.amountMinor,
  );
  assert.equal(
    recovered.state.metrics.atRiskMinor,
    initial.metrics.atRiskMinor - target.amountMinor,
  );
  assert.equal(
    recovered.state.metrics.incrementalMinor,
    initial.metrics.incrementalMinor + target.amountMinor - baselineExpected,
  );
  assert.equal(
    recovered.state.metrics.recoveryRate,
    recovered.state.comparison.recoverLoopRecoveryRate,
  );
  assert.ok(recovered.state.metrics.recoveryRate > initial.metrics.recoveryRate);

  const replay = applyDemoAction(
    recovered.state,
    { action: "recover_case", caseId: target.id },
    LATER,
  );
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.state.metrics, recovered.state.metrics);
});

test("duplicate webhook replay has one bounded observability effect and no case effect", () => {
  const initial = createSeedState();
  const casesBefore = structuredClone(initial.cases);
  const first = applyDemoAction(initial, { action: "duplicate_webhook" }, NOW);

  assert.equal(first.idempotent, true);
  assert.deepEqual(first.state.cases, casesBefore);
  assert.equal(
    first.state.comparison.duplicateActionsPrevented,
    initial.comparison.duplicateActionsPrevented + 1,
  );
  assert.equal(first.state.metrics.contactsAvoided, initial.metrics.contactsAvoided + 1);

  const replay = applyDemoAction(first.state, { action: "duplicate_webhook" }, LATER);
  assert.deepEqual(replay.state, first.state);
});

test("late success is terminal and cancels stale recovery work", () => {
  const initial = createSeedState();
  const target = initial.cases.find((item) => item.id === "rcv_9J4L6")!;
  target.status = "pending_approval";
  const contactsAvoided = initial.metrics.contactsAvoided;

  const late = applyDemoAction(initial, { action: "out_of_order_success" }, NOW);
  const lateCase = late.state.cases.find((item) => item.id === target.id)!;
  assert.equal(lateCase.status, "recovered");
  assert.equal(late.state.metrics.contactsAvoided, contactsAvoided + 1);

  const staleApproval = applyDemoAction(
    late.state,
    {
      action: "approve_case",
      caseId: target.id,
      decisionVersion: target.decisionVersion,
    },
    LATER,
  );
  assert.equal(staleApproval.idempotent, true);
  assert.deepEqual(staleApproval.state, late.state);
});

test("AI outage switches eligible cases to deterministic fallback", () => {
  const initial = createSeedState();
  const degraded = applyDemoAction(initial, { action: "ai_outage" }, NOW);

  assert.equal(degraded.state.health.planner, "degraded");
  assert.equal(degraded.state.health.plannerMode, "Deterministic fallback");
  assert.ok(
    degraded.state.cases
      .filter((item) => item.status !== "recovered")
      .every((item) => item.plannerSource !== "ai"),
  );
  assert.equal(
    degraded.state.cases.find((item) => item.id === "rcv_1P5X2")?.plannerSource,
    "policy",
  );

  const replay = applyDemoAction(degraded.state, { action: "ai_outage" }, LATER);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.state, degraded.state);
});

test("provider timeout opens the messaging circuit and blocks blind redispatch", () => {
  const initial = createSeedState();
  const timedOut = applyDemoAction(initial, { action: "provider_timeout" }, NOW);

  assert.equal(timedOut.state.health.messaging, "degraded");
  assert.equal(timedOut.state.health.circuitBreaker, "open");
  assert.equal(
    timedOut.state.cases.find((item) => item.id === "rcv_3D7T8")?.status,
    "manual_review",
  );

  const replay = applyDemoAction(timedOut.state, { action: "provider_timeout" }, LATER);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.state, timedOut.state);
});

test("provider timeout never downgrades a case with confirmed success", () => {
  const initial = createSeedState();
  const recovered = applyDemoAction(
    initial,
    { action: "recover_case", caseId: "rcv_3D7T8" },
    NOW,
  );
  const timedOut = applyDemoAction(recovered.state, { action: "provider_timeout" }, LATER);

  assert.equal(
    timedOut.state.cases.find((item) => item.id === "rcv_3D7T8")?.status,
    "recovered",
  );
});

test("incident resolution re-evaluates a suppression without creating contact", () => {
  const initial = createSeedState();
  const target = initial.cases.find((item) => item.id === "rcv_6A9M4")!;
  const resolved = applyDemoAction(
    initial,
    { action: "incident_resolved", caseId: target.id },
    NOW,
  );
  const resolvedCase = resolved.state.cases.find((item) => item.id === target.id)!;

  assert.equal(resolvedCase.status, "scheduled");
  assert.equal(resolvedCase.contactCount, target.contactCount);
  assert.equal(
    resolved.state.comparison.recoverLoopContacts,
    initial.comparison.recoverLoopContacts,
  );

  const replay = applyDemoAction(
    resolved.state,
    { action: "incident_resolved", caseId: target.id },
    LATER,
  );
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.state, resolved.state);
});

test("reset restores the exact deterministic seed after combined drills", () => {
  const seed = createSeedState();
  let state = applyDemoAction(seed, { action: "duplicate_webhook" }, NOW).state;
  state = applyDemoAction(state, { action: "ai_outage" }, NOW).state;
  state = applyDemoAction(state, { action: "provider_timeout" }, NOW).state;
  state = applyDemoAction(
    state,
    { action: "incident_resolved", caseId: "rcv_6A9M4" },
    NOW,
  ).state;
  state = applyDemoAction(
    state,
    {
      action: "approve_case",
      caseId: "rcv_8F2K1",
      decisionVersion: state.cases.find((item) => item.id === "rcv_8F2K1")!
        .decisionVersion,
    },
    NOW,
  ).state;
  state = applyDemoAction(
    state,
    { action: "recover_case", caseId: "rcv_8F2K1" },
    NOW,
  ).state;

  const reset = applyDemoAction(state, { action: "reset" }, LATER);
  assert.deepEqual(reset.state, createSeedState());
});

test("audit stream stays bounded", () => {
  const initial = createSeedState();
  initial.audit = Array.from({ length: MAX_AUDIT_EVENTS + 20 }, (_, index) =>
    auditFixture(index),
  );

  const result = applyDemoAction(initial, { action: "duplicate_webhook" }, NOW);
  assert.equal(result.state.audit.length, MAX_AUDIT_EVENTS);
  assert.equal(result.state.audit[0]?.id, "demo_duplicate_webhook_evt_92a1");
});

test("missing and inapplicable case actions fail closed without mutation", () => {
  const initial = createSeedState();
  const missing = applyDemoAction(
    initial,
    {
      action: "approve_case",
      caseId: "rcv_missing",
      decisionVersion: "dec_missing_v1",
    },
    NOW,
  );
  const inapplicable = applyDemoAction(
    initial,
    {
      action: "approve_case",
      caseId: "rcv_3D7T8",
      decisionVersion: initial.cases.find((item) => item.id === "rcv_3D7T8")!
        .decisionVersion,
    },
    NOW,
  );

  assert.equal(missing.idempotent, true);
  assert.equal(inapplicable.idempotent, true);
  assert.strictEqual(missing.state, initial);
  assert.strictEqual(inapplicable.state, initial);
});

function auditFixture(index: number): AuditEvent {
  return {
    id: `fixture_${index}`,
    time: "14:00:00",
    title: "Fixture event",
    detail: `Synthetic audit ${index}`,
    category: "event",
    tone: "neutral",
  };
}
