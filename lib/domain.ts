import type {
  AuditEvent,
  CaseStatus,
  DashboardMetrics,
  DashboardState,
  DemoActionRequest,
  DemoActionResponse,
  PlannerDecision,
  PolicyComparison,
  RecoveryAction,
  RecoveryCase,
} from "./contracts";

export const MAX_AUDIT_EVENTS = 32;

const MAX_TIMELINE_EVENTS = 16;
const DEMO_EVENT_PREFIX = "demo_";
const SEED_UPDATED_AT = "2026-08-20T14:33:00.000Z";
const DUPLICATE_DEMO_TOTAL = 38;

const SEED_METRICS: DashboardMetrics = Object.freeze({
  atRiskMinor: 1840_000_00,
  recoveredMinor: 672_000_00,
  incrementalMinor: 491_000_00,
  recoveryRate: 68.4,
  medianRecoveryMinutes: 47,
  contactsAvoided: 312,
});

const SEED_COMPARISON: PolicyComparison = Object.freeze({
  baselineRecoveryRate: 41.2,
  recoverLoopRecoveryRate: 68.4,
  baselineContacts: 1240,
  recoverLoopContacts: 718,
  incidentSuppressions: 184,
  duplicateActionsPrevented: 37,
});

type ResetDecision = Partial<
  Pick<
  RecoveryCase,
  | "failureCode"
  | "failureLabel"
  | "recommendedAction"
  | "actionLabel"
  | "strategy"
  | "confidence"
  | "explanation"
  | "messageDraft"
  | "rejectedActions"
  >
>;

interface SeedCaseState {
  status: CaseStatus;
  plannerSource: RecoveryCase["plannerSource"];
  contactCount: number;
  decisionVersion: string;
  decision?: ResetDecision;
}

const SEED_CASE_STATE = new Map<string, SeedCaseState>([
  [
    "rcv_8F2K1",
    {
      status: "pending_approval",
      plannerSource: "ai",
      contactCount: 0,
      decisionVersion: "dec_8F2K1_v1",
    },
  ],
  [
    "rcv_6A9M4",
    {
      status: "suppressed",
      plannerSource: "policy",
      contactCount: 0,
      decisionVersion: "dec_6A9M4_v1",
      decision: {
        failureCode: "PSP_DOWNTIME",
        failureLabel: "Issuer downtime",
        recommendedAction: "wait_for_incident",
        actionLabel: "Wait for incident",
        strategy: "Suppress contact until the affected rail recovers",
        confidence: 0.97,
        explanation:
          "A matching UPI incident is active. Contact would blame the customer for provider downtime and add no recovery value, so the case is paused until a resolved event arrives.",
        messageDraft: "No message will be sent while the incident is active.",
        rejectedActions: [
          "Customer reminder — provider fault, not customer action",
          "Immediate retry — affected rail is unavailable",
          "Escalation — incident automation owns this case",
        ],
      },
    },
  ],
  [
    "rcv_3D7T8",
    {
      status: "scheduled",
      plannerSource: "ai",
      contactCount: 1,
      decisionVersion: "dec_3D7T8_v1",
      decision: {
        recommendedAction: "send_reminder",
        actionLabel: "Tactful reminder",
      },
    },
  ],
  [
    "rcv_1P5X2",
    {
      status: "manual_review",
      plannerSource: "policy",
      contactCount: 0,
      decisionVersion: "dec_1P5X2_v1",
    },
  ],
  [
    "rcv_9J4L6",
    {
      status: "observing",
      plannerSource: "ai",
      contactCount: 0,
      decisionVersion: "dec_9J4L6_v1",
    },
  ],
  [
    "rcv_5C8R3",
    {
      status: "pending_approval",
      plannerSource: "ai",
      contactCount: 1,
      decisionVersion: "dec_5C8R3_v1",
    },
  ],
]);

const CUSTOMER_CONTACT_ACTIONS = new Set<RecoveryAction>([
  "request_method_update",
  "send_reminder",
  "offer_alternate_rail",
]);

type ClockValue = Date | string | number;

interface EventClock {
  iso: string;
  time: string;
}

export function applyDemoAction(
  current: DashboardState,
  request: DemoActionRequest,
  now: ClockValue = new Date(),
): DemoActionResponse {
  const clock = eventClock(now);

  switch (request.action) {
    case "approve_case":
      return approveCase(current, request.caseId, request.decisionVersion, clock);
    case "recover_case":
      return recoverCase(current, request.caseId, clock, false);
    case "duplicate_webhook":
      return duplicateWebhook(current, clock);
    case "out_of_order_success":
      return recoverCase(current, "rcv_9J4L6", clock, true);
    case "ai_outage":
      return aiOutage(current, clock);
    case "provider_timeout":
      return providerTimeout(current, clock);
    case "incident_resolved":
      return resolveIncident(current, request.caseId ?? "rcv_6A9M4", clock);
    case "reset":
      return resetState(current);
    default:
      return assertNever(request.action);
  }
}

export function applyPlannerDecision(
  current: DashboardState,
  caseId: string,
  basedOnDecisionVersion: string,
  plan: PlannerDecision,
  now: ClockValue = new Date(),
): DemoActionResponse {
  const item = findCase(current, caseId);
  if (!item) return unchanged(current, "That recovery case was not found.");
  if (
    item.status === "recovered" ||
    item.decisionVersion !== basedOnDecisionVersion
  ) {
    return unchanged(
      current,
      "The case changed while planning; no stale recommendation was applied.",
    );
  }
  if (!isPlannerActionAllowed(item, plan.action)) {
    return unchanged(
      current,
      "Current policy rejected the generated recommendation.",
    );
  }

  const clock = eventClock(now);
  const next = cloneState(current);
  const target = findCase(next, caseId)!;
  target.recommendedAction = plan.action;
  target.actionLabel = plan.actionLabel;
  target.strategy = plan.strategy;
  target.confidence = plan.confidence;
  target.explanation = plan.explanation;
  target.messageDraft = plan.messageDraft;
  target.rejectedActions = [...plan.rejectedActions];
  target.plannerSource = plan.source;
  target.decisionVersion = plannerDecisionVersion(target, plan, clock);
  if (plan.action === "manual_review") target.status = "manual_review";

  appendTimeline(target, {
    id: `${DEMO_EVENT_PREFIX}planner_${target.decisionVersion}`,
    time: clock.time,
    title:
      plan.source === "ai"
        ? "Constrained AI plan accepted"
        : "Deterministic fallback applied",
    detail: `${plan.actionLabel} · policy revalidated · ${target.decisionVersion}`,
    tone: "positive",
  });
  pushAudit(next, {
    id: `${DEMO_EVENT_PREFIX}planner_${target.decisionVersion}`,
    time: clock.time,
    title:
      plan.source === "ai"
        ? "Live advisory plan persisted"
        : "Fallback plan persisted",
    detail: `${target.id} · ${plan.action} · approval scope renewed`,
    category: plan.source === "ai" ? "ai" : "reliability",
    tone: "positive",
  });
  finish(next, "refresh_plan", clock);

  return {
    state: next,
    notice:
      plan.source === "ai"
        ? "Live AI plan passed policy revalidation and received a new approval version."
        : "Deterministic fallback plan received a new approval version.",
  };
}

function approveCase(
  current: DashboardState,
  caseId: string | undefined,
  decisionVersion: string | undefined,
  clock: EventClock,
): DemoActionResponse {
  const item = findCase(current, caseId);
  if (!item) return unchanged(current, "That recovery case was not found.");
  if (item.status === "recovered") {
    return unchanged(current, "Approval ignored because confirmed success is terminal.");
  }
  if (item.status !== "pending_approval") {
    return unchanged(current, "This action is no longer waiting for approval.");
  }
  if (!decisionVersion || decisionVersion !== item.decisionVersion) {
    return unchanged(
      current,
      "The decision changed; review the latest receipt before approving.",
    );
  }

  if (!item.consent || item.contactCount >= 2) {
    const next = cloneState(current);
    const target = findCase(next, item.id)!;
    target.status = "manual_review";
    appendTimeline(target, {
      id: `${DEMO_EVENT_PREFIX}approval_blocked_${target.id}`,
      time: clock.time,
      title: "Approval blocked by current policy",
      detail: !target.consent
        ? "Consent unavailable · no customer contact"
        : "Contact cap reached · operator review required",
      tone: "warning",
    });
    pushAudit(next, {
      id: `${DEMO_EVENT_PREFIX}approval_blocked_${target.id}`,
      time: clock.time,
      title: "Stale approval rejected",
      detail: `${target.id} · policy changed after proposal`,
      category: "policy",
      tone: "warning",
    });
    finish(next, requestName("approve_case"), clock);
    return { state: next, notice: "Approval was blocked by the latest policy state." };
  }

  const next = cloneState(current);
  const target = findCase(next, item.id)!;
  target.status = "scheduled";
  const createsContact = CUSTOMER_CONTACT_ACTIONS.has(target.recommendedAction);
  if (createsContact) {
    target.contactCount += 1;
    next.comparison.recoverLoopContacts += 1;
  }
  appendTimeline(target, {
    id: `${DEMO_EVENT_PREFIX}approved_${target.id}`,
    time: clock.time,
    title: "Recovery action approved",
    detail: createsContact
      ? "Exact action version scheduled · idempotency key reserved"
      : "Account workflow scheduled · no customer message sent",
    tone: "positive",
  });
  pushAudit(next, {
    id: `${DEMO_EVENT_PREFIX}approved_${target.id}`,
    time: clock.time,
    title: "Scoped approval recorded",
    detail: `${target.id} · ${target.recommendedAction} · ${target.decisionVersion}`,
    category: "action",
    tone: "positive",
  });
  finish(next, requestName("approve_case"), clock);

  return { state: next, notice: "Recovery approved and safely scheduled." };
}

function recoverCase(
  current: DashboardState,
  caseId: string | undefined,
  clock: EventClock,
  outOfOrder: boolean,
): DemoActionResponse {
  const item = findCase(current, caseId);
  if (!item) return unchanged(current, "That recovery case was not found.");
  if (item.status === "recovered") {
    return unchanged(
      current,
      outOfOrder
        ? "The late success was already applied; stale work remains cancelled."
        : "This payment is already recovered.",
    );
  }

  const previousStatus = item.status;
  const next = cloneState(current);
  const target = findCase(next, item.id)!;
  target.status = "recovered";
  updateRecoveryMetrics(next, target.amountMinor);
  if (outOfOrder && (previousStatus === "scheduled" || previousStatus === "pending_approval")) {
    next.metrics.contactsAvoided += 1;
  }

  const suffix = outOfOrder ? "late_success" : "recovered";
  appendTimeline(target, {
    id: `${DEMO_EVENT_PREFIX}${suffix}_${target.id}`,
    time: clock.time,
    title: outOfOrder ? "Late success superseded recovery" : "Payment recovery confirmed",
    detail: outOfOrder
      ? `Canonical state advanced from ${previousStatus} · stale work cancelled`
      : "Provider success confirmed · pending work cancelled",
    tone: "positive",
  });
  pushAudit(next, {
    id: `${DEMO_EVENT_PREFIX}${suffix}_${target.id}`,
    time: clock.time,
    title: outOfOrder ? "Terminal success took precedence" : "Revenue recovery confirmed",
    detail: `${target.id} · ${target.amountMinor} minor units · metrics updated once`,
    category: outOfOrder ? "reliability" : "event",
    tone: "positive",
  });
  finish(next, requestName(outOfOrder ? "out_of_order_success" : "recover_case"), clock);

  return {
    state: next,
    notice: outOfOrder
      ? "Late success won and all stale recovery work was cancelled."
      : "Payment marked recovered; portfolio metrics were updated once.",
  };
}

function duplicateWebhook(current: DashboardState, clock: EventClock): DemoActionResponse {
  if (current.comparison.duplicateActionsPrevented >= DUPLICATE_DEMO_TOTAL) {
    return unchanged(current, "Duplicate event acknowledged; no business action repeated.");
  }

  const next = cloneState(current);
  next.comparison.duplicateActionsPrevented = DUPLICATE_DEMO_TOTAL;
  next.metrics.contactsAvoided += 1;
  pushAudit(next, {
    id: `${DEMO_EVENT_PREFIX}duplicate_webhook_evt_92a1`,
    time: clock.time,
    title: "Duplicate webhook deduplicated",
    detail: "evt_92a1 · existing receipt returned · no action dispatched",
    category: "reliability",
    tone: "positive",
  });
  finish(next, requestName("duplicate_webhook"), clock);

  return {
    state: next,
    notice: "Replay detected and acknowledged with zero duplicate actions.",
    idempotent: true,
  };
}

function aiOutage(current: DashboardState, clock: EventClock): DemoActionResponse {
  const alreadyDegraded =
    current.health.planner === "degraded" &&
    current.health.plannerMode === "Deterministic fallback" &&
    current.cases.every(
      (item) => item.status === "recovered" || item.plannerSource !== "ai",
    );
  if (alreadyDegraded) {
    return unchanged(current, "Planner remains on deterministic fallback.");
  }

  const next = cloneState(current);
  next.health.planner = "degraded";
  next.health.plannerMode = "Deterministic fallback";
  for (const item of next.cases) {
    if (item.plannerSource === "ai" && item.status !== "recovered") {
      item.plannerSource = "fallback";
      item.decisionVersion = evolvedDecisionVersion(item, "fallback");
    }
  }
  pushAudit(next, {
    id: `${DEMO_EVENT_PREFIX}ai_outage`,
    time: clock.time,
    title: "Planner degraded safely",
    detail: "AI unavailable · constrained deterministic plans activated",
    category: "reliability",
    tone: "warning",
  });
  finish(next, requestName("ai_outage"), clock);

  return {
    state: next,
    notice: "AI is offline; deterministic policy plans are active.",
  };
}

function providerTimeout(current: DashboardState, clock: EventClock): DemoActionResponse {
  const target = findCase(current, "rcv_3D7T8");
  const alreadyContained =
    current.health.messaging === "degraded" &&
    current.health.circuitBreaker === "open" &&
    (target?.status === "manual_review" || target?.status === "recovered");
  if (alreadyContained) {
    return unchanged(current, "Provider outcome remains unknown; redispatch is blocked.");
  }

  const next = cloneState(current);
  next.health.messaging = "degraded";
  next.health.circuitBreaker = "open";
  const nextTarget = findCase(next, "rcv_3D7T8");
  if (nextTarget && nextTarget.status !== "recovered") {
    nextTarget.status = "manual_review";
    nextTarget.recommendedAction = "manual_review";
    nextTarget.actionLabel = "Reconcile provider outcome";
    nextTarget.decisionVersion = evolvedDecisionVersion(nextTarget, "timeout");
    appendTimeline(nextTarget, {
      id: `${DEMO_EVENT_PREFIX}provider_timeout_${nextTarget.id}`,
      time: clock.time,
      title: "Delivery outcome is unknown",
      detail: "Circuit opened · reconcile idempotency key before redispatch",
      tone: "critical",
    });
  }
  pushAudit(next, {
    id: `${DEMO_EVENT_PREFIX}provider_timeout`,
    time: clock.time,
    title: "Provider timeout contained",
    detail: "Messaging outcome unknown · circuit open · blind retry blocked",
    category: "reliability",
    tone: "critical",
  });
  finish(next, requestName("provider_timeout"), clock);

  return {
    state: next,
    notice: "Timeout marked unknown; the circuit is open pending reconciliation.",
  };
}

function resolveIncident(
  current: DashboardState,
  caseId: string,
  clock: EventClock,
): DemoActionResponse {
  const item = findCase(current, caseId);
  if (!item) return unchanged(current, "That incident-linked case was not found.");
  if (item.status === "recovered") {
    return unchanged(current, "Incident resolution cannot supersede confirmed success.");
  }
  if (item.status !== "suppressed") {
    return unchanged(current, "This case is no longer suppressed by an active incident.");
  }

  const next = cloneState(current);
  const target = findCase(next, item.id)!;
  target.status = "scheduled";
  target.failureCode = "INCIDENT_RESOLVED";
  target.failureLabel = "Rail restored";
  target.recommendedAction = "reconcile_payment";
  target.actionLabel = "Reconcile payment state";
  target.strategy = "Re-read canonical provider state before any recovery action";
  target.plannerSource = "policy";
  target.confidence = 1;
  target.decisionVersion = evolvedDecisionVersion(target, "resolved");
  target.explanation =
    "The rail is healthy again, but delivery order is not authoritative. RecoverLoop first reconciles the canonical payment state so a late success can cancel all recovery work.";
  target.messageDraft = "No customer message until payment state reconciliation completes.";
  target.rejectedActions = [
    "Immediate outreach — payment state is not reconciled",
    "Blind retry — a late success may already exist",
  ];
  appendTimeline(target, {
    id: `${DEMO_EVENT_PREFIX}incident_resolved_${target.id}`,
    time: clock.time,
    title: "Provider incident resolved",
    detail: "Canonical payment state re-read · one health-gated recovery scheduled",
    tone: "positive",
  });
  pushAudit(next, {
    id: `${DEMO_EVENT_PREFIX}incident_resolved_${target.id}`,
    time: clock.time,
    title: "Incident suppression released",
    detail: `${target.id} · ${target.rail} restored · queue resumed safely`,
    category: "reliability",
    tone: "positive",
  });
  finish(next, requestName("incident_resolved"), clock);

  return {
    state: next,
    notice: "Incident resolved; the case was re-evaluated and safely resumed.",
  };
}

function resetState(current: DashboardState): DemoActionResponse {
  const next = cloneState(current);
  next.metrics = { ...SEED_METRICS };
  next.health = {
    ingest: "healthy",
    planner: "healthy",
    messaging: "healthy",
    circuitBreaker: "healthy",
    plannerMode: "Constrained AI",
  };
  next.comparison = { ...SEED_COMPARISON };
  next.cases = next.cases.map((item) => {
    const initial = SEED_CASE_STATE.get(item.id);
    if (!initial) return item;
    const { decision, ...mutable } = initial;
    return {
      ...item,
      ...mutable,
      ...decision,
      timeline: item.timeline.filter((event) => !event.id.startsWith(DEMO_EVENT_PREFIX)),
    };
  });
  next.audit = next.audit.filter((event) => !event.id.startsWith(DEMO_EVENT_PREFIX));
  next.lastScenario = null;
  next.updatedAt = SEED_UPDATED_AT;

  return { state: next, notice: "Deterministic demo state restored." };
}

function updateRecoveryMetrics(state: DashboardState, amountMinor: number): void {
  const priorRate = state.metrics.recoveryRate / 100;
  const eligibleBefore =
    priorRate > 0
      ? state.metrics.recoveredMinor / priorRate
      : state.metrics.recoveredMinor + state.metrics.atRiskMinor;
  const nextRecovered = state.metrics.recoveredMinor + amountMinor;
  const nextEligible = eligibleBefore + amountMinor;
  const baselineExpected = Math.round(
    amountMinor * (state.comparison.baselineRecoveryRate / 100),
  );
  const nextRate = roundOneDecimal((nextRecovered / nextEligible) * 100);

  state.metrics.atRiskMinor = Math.max(0, state.metrics.atRiskMinor - amountMinor);
  state.metrics.recoveredMinor = nextRecovered;
  state.metrics.incrementalMinor += Math.max(0, amountMinor - baselineExpected);
  state.metrics.recoveryRate = nextRate;
  state.comparison.recoverLoopRecoveryRate = nextRate;
}

function appendTimeline(
  item: RecoveryCase,
  event: RecoveryCase["timeline"][number],
): void {
  if (item.timeline.some((existing) => existing.id === event.id)) return;
  item.timeline = [...item.timeline, event].slice(-MAX_TIMELINE_EVENTS);
}

function pushAudit(state: DashboardState, event: AuditEvent): void {
  if (state.audit.some((existing) => existing.id === event.id)) return;
  state.audit = [event, ...state.audit].slice(0, MAX_AUDIT_EVENTS);
}

function finish(state: DashboardState, scenario: string, clock: EventClock): void {
  state.lastScenario = scenario;
  state.updatedAt = clock.iso;
}

function cloneState(state: DashboardState): DashboardState {
  return structuredClone(state);
}

function findCase(state: DashboardState, caseId: string | undefined): RecoveryCase | undefined {
  if (!caseId) return undefined;
  return state.cases.find((item) => item.id === caseId);
}

function unchanged(state: DashboardState, notice: string): DemoActionResponse {
  return { state, notice, idempotent: true };
}

function eventClock(value: ClockValue): EventClock {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid demo action timestamp");
  const iso = date.toISOString();
  return { iso, time: iso.slice(11, 19) };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function requestName(action: DemoActionRequest["action"]): string {
  return action;
}

function evolvedDecisionVersion(
  item: RecoveryCase,
  transition: "fallback" | "timeout" | "resolved",
): string {
  return `dec_${item.id.replace(/^rcv_/u, "")}_${transition}_v2`;
}

function plannerDecisionVersion(
  item: RecoveryCase,
  plan: PlannerDecision,
  clock: EventClock,
): string {
  const timestamp = clock.iso.replace(/[^0-9]/gu, "").slice(0, 17);
  return `dec_${item.id.replace(/^rcv_/u, "")}_${plan.source}_${timestamp}`;
}

function isPlannerActionAllowed(
  item: RecoveryCase,
  action: RecoveryAction,
): boolean {
  if (item.status === "recovered") return false;
  if (/RISK/iu.test(item.failureCode)) return action === "manual_review";
  if (
    item.status === "suppressed" ||
    /DOWNTIME|OUTAGE/iu.test(item.failureCode)
  ) {
    return action === "wait_for_incident";
  }
  if (!item.consent || item.contactCount >= 2) {
    return action === "manual_review";
  }
  return action !== "reconcile_payment";
}

function assertNever(value: never): never {
  throw new Error(`Unsupported demo action: ${String(value)}`);
}
