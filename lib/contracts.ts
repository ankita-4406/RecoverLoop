export type CaseStatus =
  | "observing"
  | "pending_approval"
  | "scheduled"
  | "recovered"
  | "suppressed"
  | "manual_review";

export type HealthState = "healthy" | "degraded" | "open";

export type RecoveryAction =
  | "wait_for_incident"
  | "reconcile_payment"
  | "request_method_update"
  | "send_reminder"
  | "offer_alternate_rail"
  | "escalate_account"
  | "manual_review";

export interface DecisionSignal {
  label: string;
  impact: number;
  detail: string;
}

export interface CaseTimelineEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  tone: "neutral" | "positive" | "warning" | "critical";
}

export interface RecoveryCase {
  id: string;
  decisionVersion: string;
  customer: string;
  customerRef: string;
  segment: string;
  amountMinor: number;
  currency: "INR";
  rail: "UPI" | "Card" | "Netbanking" | "Mandate";
  failureCode: string;
  failureLabel: string;
  status: CaseStatus;
  confidence: number;
  expectedValueMinor: number;
  recommendedAction: RecoveryAction;
  actionLabel: string;
  strategy: string;
  plannerSource: "policy" | "ai" | "fallback";
  consent: boolean;
  contactCount: number;
  accountAgeMonths: number;
  locale: "en-IN" | "hi-IN";
  owner: string;
  relativeTime: string;
  explanation: string;
  messageDraft: string;
  rejectedActions: string[];
  signals: DecisionSignal[];
  timeline: CaseTimelineEvent[];
}

export interface AuditEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  category: "event" | "policy" | "ai" | "action" | "reliability";
  tone: "neutral" | "positive" | "warning" | "critical";
}

export interface DashboardMetrics {
  atRiskMinor: number;
  recoveredMinor: number;
  incrementalMinor: number;
  recoveryRate: number;
  medianRecoveryMinutes: number;
  contactsAvoided: number;
}

export interface SystemHealth {
  ingest: HealthState;
  planner: HealthState;
  messaging: HealthState;
  circuitBreaker: HealthState;
  plannerMode: "Constrained AI" | "Deterministic fallback";
}

export interface PolicyComparison {
  baselineRecoveryRate: number;
  recoverLoopRecoveryRate: number;
  baselineContacts: number;
  recoverLoopContacts: number;
  incidentSuppressions: number;
  duplicateActionsPrevented: number;
}

export interface DashboardState {
  metrics: DashboardMetrics;
  health: SystemHealth;
  cases: RecoveryCase[];
  audit: AuditEvent[];
  comparison: PolicyComparison;
  lastScenario: string | null;
  updatedAt: string;
}

export type DemoAction =
  | "approve_case"
  | "recover_case"
  | "duplicate_webhook"
  | "out_of_order_success"
  | "ai_outage"
  | "provider_timeout"
  | "incident_resolved"
  | "reset";

export interface DemoActionRequest {
  action: DemoAction;
  caseId?: string;
  decisionVersion?: string;
}

export interface DemoActionResponse {
  state: DashboardState;
  notice: string;
  idempotent?: boolean;
}

export interface PlannerDecision {
  action: RecoveryAction;
  actionLabel: string;
  strategy: string;
  confidence: number;
  explanation: string;
  messageDraft: string;
  rejectedActions: string[];
  source: "ai" | "fallback";
}

export interface PlanRecoveryResponse {
  caseId: string;
  plan: PlannerDecision;
  execution: "live_ai" | "deterministic_fallback";
  generatedAt: string;
  state: DashboardState;
}
