"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CaseStatus,
  DashboardState,
  DemoAction,
  DemoActionResponse,
  PlanRecoveryResponse,
  RecoveryCase,
} from "@/lib/contracts";

type QueueFilter = "all" | "action" | "suppressed" | "recovered";

const navItems = [
  { id: "overview", label: "Command center", glyph: "01" },
  { id: "queue", label: "Recovery queue", glyph: "02" },
  { id: "reliability", label: "Reliability lab", glyph: "03" },
  { id: "policy", label: "Policy replay", glyph: "04" },
  { id: "audit", label: "Audit stream", glyph: "05" },
];

const scenarioCards: Array<{
  action: DemoAction;
  eyebrow: string;
  title: string;
  detail: string;
  outcome: string;
}> = [
  {
    action: "duplicate_webhook",
    eyebrow: "AT-LEAST-ONCE DELIVERY",
    title: "Duplicate webhook",
    detail: "Replay the same provider event twice.",
    outcome: "One case · zero duplicate actions",
  },
  {
    action: "out_of_order_success",
    eyebrow: "EVENT REORDERING",
    title: "Success arrives late",
    detail: "Deliver captured after a failed event was queued.",
    outcome: "Terminal success wins · outreach cancelled",
  },
  {
    action: "ai_outage",
    eyebrow: "MODEL RESILIENCE",
    title: "AI provider offline",
    detail: "Fail the planner during a recovery decision.",
    outcome: "Policy fallback · payment flow stays live",
  },
  {
    action: "provider_timeout",
    eyebrow: "DEPENDENCY FAILURE",
    title: "Provider timeout",
    detail: "Trip the bounded retry and circuit breaker path.",
    outcome: "Retry contained · no retry storm",
  },
  {
    action: "incident_resolved",
    eyebrow: "INCIDENT AUTOMATION",
    title: "UPI rail restored",
    detail: "Resolve downtime and safely resume the queue.",
    outcome: "Suppression lifted · customer trust preserved",
  },
];

const statusLabels: Record<CaseStatus, string> = {
  observing: "Observing",
  pending_approval: "Needs approval",
  scheduled: "Scheduled",
  recovered: "Recovered",
  suppressed: "Suppressed",
  manual_review: "Manual review",
};

function formatMoney(minor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function formatLakhs(minor: number) {
  const lakhs = minor / 10_000_000;
  return `₹${lakhs.toFixed(lakhs >= 10 ? 1 : 2)}L`;
}

function statusClass(status: CaseStatus) {
  return `status-pill status-${status.replace("_", "-")}`;
}

function healthLabel(value: string) {
  if (value === "healthy") return "Nominal";
  if (value === "open") return "Circuit open";
  return "Degraded";
}

function caseMatchesFilter(item: RecoveryCase, filter: QueueFilter) {
  if (filter === "action") {
    return item.status === "pending_approval" || item.status === "scheduled";
  }
  if (filter === "suppressed") return item.status === "suppressed";
  if (filter === "recovered") return item.status === "recovered";
  return true;
}

export function RecoverLoopDashboard({
  initialState,
}: {
  initialState: DashboardState;
}) {
  const [state, setState] = useState(initialState);
  const [selectedId, setSelectedId] = useState(initialState.cases[0]?.id ?? "");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [activeNav, setActiveNav] = useState("overview");
  const [pendingAction, setPendingAction] = useState<DemoAction | null>(null);
  const [planning, setPlanning] = useState(false);
  const [notice, setNotice] = useState("Demo data loaded locally");
  const [connection, setConnection] = useState<"loading" | "ready" | "offline">(
    "loading",
  );

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/state", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("State endpoint unavailable");
        return (await response.json()) as DashboardState;
      })
      .then((nextState) => {
        setState(nextState);
        setConnection("ready");
        setNotice("Durable demo state connected");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setConnection("offline");
        setNotice("Local preview active · API reconnects on refresh");
      });

    return () => controller.abort();
  }, []);

  const selectedCase =
    state.cases.find((item) => item.id === selectedId) ?? state.cases[0];

  const filteredCases = useMemo(
    () => state.cases.filter((item) => caseMatchesFilter(item, filter)),
    [filter, state.cases],
  );

  const actionableCount = state.cases.filter(
    (item) => item.status === "pending_approval" || item.status === "scheduled",
  ).length;

  const incidentCase = state.cases.find((item) => item.id === "rcv_6A9M4");
  const incidentActive = incidentCase?.status === "suppressed";
  const incidentSuppressedCount = state.cases.filter(
    (item) => item.failureCode === "PSP_DOWNTIME" && item.status === "suppressed",
  ).length;
  const recoveryLift =
    state.comparison.recoverLoopRecoveryRate -
    state.comparison.baselineRecoveryRate;
  const contactReduction =
    state.comparison.baselineContacts > 0
      ? ((state.comparison.baselineContacts -
          state.comparison.recoverLoopContacts) /
          state.comparison.baselineContacts) *
        100
      : 0;
  const recoverLoopContactWidth =
    state.comparison.baselineContacts > 0
      ? Math.min(
          100,
          (state.comparison.recoverLoopContacts /
            state.comparison.baselineContacts) *
            100,
        )
      : 0;
  const explainedCaseCount = state.cases.filter(
    (item) => item.explanation.trim().length > 0,
  ).length;

  function moveToSection(id: string) {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  async function runAction(
    action: DemoAction,
    caseId?: string,
    decisionVersion?: string,
  ) {
    setPendingAction(action);
    setNotice(`Running ${action.replaceAll("_", " ")}…`);

    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-RecoverLoop-Action": "demo",
        },
        body: JSON.stringify({ action, caseId, decisionVersion }),
      });
      const payload = (await response.json()) as DemoActionResponse | { error: string };
      if (!response.ok || !("state" in payload)) {
        throw new Error("error" in payload ? payload.error : "Action failed");
      }
      setState(payload.state);
      setConnection("ready");
      setNotice(payload.notice);
    } catch (error) {
      setConnection("offline");
      setNotice(error instanceof Error ? error.message : "Action failed safely");
    } finally {
      setPendingAction(null);
    }
  }

  async function runPlanner(caseId: string) {
    setPlanning(true);
    setNotice("Generating a policy-bounded recovery plan…");

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-RecoverLoop-Action": "demo",
        },
        body: JSON.stringify({ caseId }),
      });
      const payload = (await response.json()) as
        | PlanRecoveryResponse
        | { error: string };
      if (!response.ok || !("plan" in payload)) {
        throw new Error("error" in payload ? payload.error : "Planning failed");
      }

      setState(payload.state);
      setConnection("ready");
      setNotice(
        payload.execution === "live_ai"
          ? "Live AI plan passed policy revalidation and was versioned for approval."
          : "Deterministic fallback plan was versioned for approval.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Planning failed safely");
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <div>
            <strong>RecoverLoop</strong>
            <span>Revenue recovery OS</span>
          </div>
        </div>

        <nav className="side-nav">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <button
              className={activeNav === item.id ? "nav-item active" : "nav-item"}
              key={item.id}
              onClick={() => moveToSection(item.id)}
              type="button"
            >
              <span>{item.glyph}</span>
              {item.label}
              {item.id === "queue" && <em>{actionableCount}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-insight">
          <span className="insight-kicker">TRUST SIGNAL</span>
          <strong>{state.metrics.contactsAvoided} contacts avoided</strong>
          <p>Recovering revenue without turning provider incidents into customer noise.</p>
        </div>

        <div className="sidebar-footer">
          <div className="operator-avatar" aria-hidden="true">
            MS
          </div>
          <div>
            <strong>Mira Shah</strong>
            <span>Recovery operator</span>
          </div>
          <button
            className="more-button"
            type="button"
            aria-label="Reset demo workspace"
            onClick={() => runAction("reset")}
            disabled={pendingAction !== null}
          >
            ↻
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="mobile-brand">RecoverLoop</span>
            <p>Track 3 · AI Revenue Recovery</p>
          </div>
          <div className="topbar-actions">
            <span className="simulation-badge">SIMULATED DATA</span>
            <span className={`connection-state connection-${connection}`}>
              <i aria-hidden="true" />
              {connection === "ready"
                ? "Durable state"
                : connection === "loading"
                  ? "Connecting"
                  : "Preview mode"}
            </span>
            <button
              className="reset-button"
              type="button"
              onClick={() => runAction("reset")}
              disabled={pendingAction !== null}
            >
              Reset demo
            </button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="hero-section" id="overview">
            <div className="hero-copy">
              <div className="eyebrow-row">
                <span>RECOVERY CONTROL PLANE</span>
                <span className="live-indicator">
                  <i aria-hidden="true" /> LIVE
                </span>
              </div>
              <h1>
                Recover revenue.
                <br />
                <span>Preserve trust.</span>
              </h1>
              <p>
                Every failed payment deserves a different next move. RecoverLoop
                knows when to retry, when to ask, and—most importantly—when to wait.
              </p>
              <div className="hero-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => moveToSection("reliability")}
                >
                  Open reliability lab <span aria-hidden="true">↘</span>
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => moveToSection("queue")}
                >
                  Review priority queue
                </button>
              </div>
            </div>

            <div className="risk-orbit" aria-label="Revenue at risk summary">
              <div className="orbit orbit-outer" />
              <div className="orbit orbit-middle" />
              <div className="orbit-pulse pulse-one" />
              <div className="orbit-pulse pulse-two" />
              <div className="orbit-core">
                <span>AT RISK</span>
                <strong>{formatLakhs(state.metrics.atRiskMinor)}</strong>
                <small>across the simulated portfolio</small>
              </div>
              <div className="orbit-note orbit-note-top">
                <span>{state.metrics.recoveryRate.toFixed(1)}%</span>
                recovery rate
              </div>
              <div className="orbit-note orbit-note-bottom">
                <span>{formatLakhs(state.metrics.incrementalMinor)}</span>
                incremental
              </div>
            </div>
          </section>

          <section className="metric-grid" aria-label="Recovery metrics">
            <article className="metric-card metric-primary">
              <div className="metric-topline">
                <span>Recovered today</span>
                <em className="neutral-tag">STATE DERIVED</em>
              </div>
              <strong>{formatLakhs(state.metrics.recoveredMinor)}</strong>
              <div className="metric-foot">
                <span>Updated after each simulated recovery</span>
              </div>
            </article>
            <article className="metric-card">
              <div className="metric-topline">
                <span>Incremental recovery</span>
                <em className="neutral-tag">HOLDOUT ADJUSTED</em>
              </div>
              <strong>{formatLakhs(state.metrics.incrementalMinor)}</strong>
              <div className="metric-foot">
                <span>Not every later payment is credited to AI</span>
              </div>
            </article>
            <article className="metric-card">
              <div className="metric-topline">
                <span>Recovery rate</span>
                <em>
                  {recoveryLift >= 0 ? "+" : "−"}
                  {Math.abs(recoveryLift).toFixed(1)} pts
                </em>
              </div>
              <strong>{state.metrics.recoveryRate.toFixed(1)}%</strong>
              <div className="progress-track" aria-hidden="true">
                <i style={{ width: `${state.metrics.recoveryRate}%` }} />
              </div>
              <p>vs {state.comparison.baselineRecoveryRate.toFixed(1)}% fixed dunning</p>
            </article>
            <article className="metric-card compact-metric">
              <span>Median recovery</span>
              <strong>{state.metrics.medianRecoveryMinutes}m</strong>
              <p>Synthetic portfolio median</p>
            </article>
            <article className="metric-card compact-metric trust-metric">
              <span>Contacts avoided</span>
              <strong>{state.metrics.contactsAvoided}</strong>
              <p>Downtime + duplicate guards</p>
            </article>
          </section>

          <section className="workspace-section" id="queue">
            <div className="section-heading">
              <div>
                <span className="section-kicker">RECOVERY QUEUE</span>
                <h2>Prioritised by expected value, not invoice size.</h2>
              </div>
              <div className="filter-tabs" role="group" aria-label="Filter recovery cases">
                {(
                  [
                    ["all", "All"],
                    ["action", "Action needed"],
                    ["suppressed", "Suppressed"],
                    ["recovered", "Recovered"],
                  ] as Array<[QueueFilter, string]>
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={filter === value ? "active" : ""}
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="queue-layout">
              <div className="queue-panel">
                <div className="queue-header">
                  <span>Customer / account</span>
                  <span>Failure</span>
                  <span>Expected value</span>
                  <span>Next move</span>
                  <span>Status</span>
                </div>
                <div className="queue-rows">
                  {filteredCases.map((item, index) => (
                    <button
                      type="button"
                      key={item.id}
                      className={selectedCase?.id === item.id ? "queue-row selected" : "queue-row"}
                      onClick={() => setSelectedId(item.id)}
                      aria-label={`Open recovery case for ${item.customer}`}
                    >
                      <span className="customer-cell">
                        <i>{String(index + 1).padStart(2, "0")}</i>
                        <span>
                          <strong>{item.customer}</strong>
                          <small>
                            {item.segment} · {formatMoney(item.amountMinor)}
                          </small>
                        </span>
                      </span>
                      <span className="failure-cell">
                        <strong>{item.failureLabel}</strong>
                        <small>{item.rail}</small>
                      </span>
                      <span className="value-cell">
                        <strong>{formatMoney(item.expectedValueMinor)}</strong>
                        <small>{Math.round(item.confidence * 100)}% confidence</small>
                      </span>
                      <span className="action-cell">
                        <strong>{item.actionLabel}</strong>
                        <small>{item.plannerSource} decision</small>
                      </span>
                      <span>
                        <em className={statusClass(item.status)}>
                          {statusLabels[item.status]}
                        </em>
                      </span>
                    </button>
                  ))}
                  {filteredCases.length === 0 && (
                    <div className="empty-queue">No cases match this filter.</div>
                  )}
                </div>
              </div>

              {selectedCase && (
                <aside className="decision-panel" aria-label="Decision receipt">
                  <div className="decision-header">
                    <div>
                      <span className="section-kicker">DECISION RECEIPT</span>
                      <h3>{selectedCase.id}</h3>
                      <code className="decision-version">
                        {selectedCase.decisionVersion}
                      </code>
                    </div>
                    <em className={statusClass(selectedCase.status)}>
                      {statusLabels[selectedCase.status]}
                    </em>
                  </div>

                  <div className="decision-customer">
                    <div className="customer-monogram" aria-hidden="true">
                      {selectedCase.customer
                        .split(" ")
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join("")}
                    </div>
                    <div>
                      <strong>{selectedCase.customer}</strong>
                      <span>
                        {selectedCase.customerRef} · {selectedCase.accountAgeMonths} months
                      </span>
                    </div>
                    <strong>{formatMoney(selectedCase.amountMinor)}</strong>
                  </div>

                  <div className="recommendation-card">
                    <div className="recommendation-title">
                      <span>
                        {selectedCase.plannerSource === "ai"
                          ? "AI + policy"
                          : selectedCase.plannerSource === "fallback"
                            ? "Deterministic fallback"
                            : "Policy gate"}
                      </span>
                      <em>{Math.round(selectedCase.confidence * 100)}% confidence</em>
                    </div>
                    <h4>{selectedCase.actionLabel}</h4>
                    <p>{selectedCase.explanation}</p>
                    <div className="confidence-track" aria-label={`${Math.round(selectedCase.confidence * 100)} percent confidence`}>
                      <i style={{ width: `${selectedCase.confidence * 100}%` }} />
                    </div>
                  </div>

                  <div className="signal-list">
                    <div className="mini-heading">
                      <span>WHY THIS MOVE</span>
                      <em>Impact</em>
                    </div>
                    {selectedCase.signals.map((signal) => (
                      <div className="signal-row" key={signal.label}>
                        <span>
                          <strong>{signal.label}</strong>
                          <small>{signal.detail}</small>
                        </span>
                        <em className={signal.impact < 0 ? "negative" : ""}>
                          {signal.impact > 0 ? "+" : ""}
                          {signal.impact}
                        </em>
                      </div>
                    ))}
                  </div>

                  <details className="rejected-actions">
                    <summary>
                      {selectedCase.rejectedActions.length} unsafe or low-value moves rejected
                    </summary>
                    <ul>
                      {selectedCase.rejectedActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </details>

                  <div className="message-preview">
                    <div className="mini-heading">
                      <span>SAFE DRAFT · {selectedCase.locale}</span>
                      <em>PII masked</em>
                    </div>
                    <p>{selectedCase.messageDraft}</p>
                  </div>

                  <div className="decision-actions">
                    {selectedCase.status === "pending_approval" && (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={pendingAction !== null || planning}
                        onClick={() =>
                          runAction(
                            "approve_case",
                            selectedCase.id,
                            selectedCase.decisionVersion,
                          )
                        }
                      >
                        Approve recovery
                      </button>
                    )}
                    {selectedCase.status === "scheduled" && (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={pendingAction !== null || planning}
                        onClick={() => runAction("recover_case", selectedCase.id)}
                      >
                        Simulate successful payment
                      </button>
                    )}
                    {selectedCase.status === "suppressed" && (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={pendingAction !== null || planning}
                        onClick={() => runAction("incident_resolved")}
                      >
                        Resolve rail incident
                      </button>
                    )}
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={
                        pendingAction !== null ||
                        planning ||
                        selectedCase.status === "recovered"
                      }
                      onClick={() => runPlanner(selectedCase.id)}
                    >
                      {planning ? "Planning safely…" : "Re-plan with guardrails"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => moveToSection("audit")}
                    >
                      View full audit
                    </button>
                  </div>
                </aside>
              )}
            </div>
          </section>

          <section
            className={`incident-band${incidentActive ? "" : " incident-resolved"}`}
            aria-label={incidentActive ? "Active simulated incident" : "Resolved simulated incident"}
            aria-live="polite"
          >
            <div className="incident-icon" aria-hidden="true">
              {incidentActive ? "!" : "✓"}
            </div>
            <div>
              <span>{incidentActive ? "ACTIVE RAIL INCIDENT" : "INCIDENT RESOLVED"}</span>
              <strong>
                {incidentActive
                  ? `${incidentCase?.rail ?? "Payment"} rail · elevated technical failures`
                  : `${incidentCase?.rail ?? "Payment"} rail · recovery queue reopened`}
              </strong>
              <p>
                {incidentActive
                  ? `${incidentSuppressedCount} matching demo ${incidentSuppressedCount === 1 ? "case" : "cases"} · customer outreach suppressed`
                  : "Suppression lifted after the affected case was re-evaluated against current state."}
              </p>
            </div>
            <div className="incident-effect">
              <span>CASE STATE</span>
              <strong>
                {incidentCase ? statusLabels[incidentCase.status] : "Unavailable"}
              </strong>
            </div>
            <button
              type="button"
              onClick={() => runAction("incident_resolved")}
              disabled={pendingAction !== null || !incidentActive}
            >
              {pendingAction === "incident_resolved"
                ? "Resolving…"
                : incidentActive
                  ? "Simulate resolution"
                  : "Resolution complete"}{" "}
              {incidentActive && <span aria-hidden="true">→</span>}
            </button>
          </section>

          <section className="reliability-section" id="reliability">
            <div className="section-heading light-heading">
              <div>
                <span className="section-kicker">RELIABILITY LAB</span>
                <h2>The AI can fail. The recovery system cannot.</h2>
                <p>
                  Run controlled distributed-systems failure drills and inspect the guardrail,
                  fallback, and audit trail in the same workspace.
                </p>
              </div>
              <div className="health-cluster" aria-label="System health">
                <div>
                  <i className={`health-dot health-${state.health.ingest}`} />
                  <span>Ingest</span>
                  <strong>{healthLabel(state.health.ingest)}</strong>
                </div>
                <div>
                  <i className={`health-dot health-${state.health.planner}`} />
                  <span>Planner</span>
                  <strong>{healthLabel(state.health.planner)}</strong>
                </div>
                <div>
                  <i className={`health-dot health-${state.health.messaging}`} />
                  <span>Messaging</span>
                  <strong>{healthLabel(state.health.messaging)}</strong>
                </div>
              </div>
            </div>

            <div className="scenario-grid">
              {scenarioCards.map((scenario, index) => (
                <button
                  className="scenario-card"
                  type="button"
                  key={scenario.action}
                  onClick={() => runAction(scenario.action)}
                  disabled={
                    pendingAction !== null ||
                    (scenario.action === "incident_resolved" && !incidentActive)
                  }
                >
                  <div className="scenario-index">0{index + 1}</div>
                  <span>{scenario.eyebrow}</span>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.detail}</p>
                  <div className="scenario-outcome">
                    <i aria-hidden="true">✓</i>
                    {scenario.outcome}
                  </div>
                  <em>
                    {pendingAction === scenario.action
                      ? "Running…"
                      : scenario.action === "incident_resolved" && !incidentActive
                        ? "Incident resolved"
                        : "Run drill"}
                    <span aria-hidden="true">↗</span>
                  </em>
                </button>
              ))}
            </div>

            <div className="lab-console" aria-live="polite">
              <div className="console-lights" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span>recoverloop://reliability</span>
              <code>{notice}</code>
              <em>{state.lastScenario ?? "READY"}</em>
            </div>
          </section>

          <section className="policy-section" id="policy">
            <div className="section-heading">
              <div>
                <span className="section-kicker">POLICY REPLAY · 30 DAYS</span>
                <h2>Prove the policy before it touches a customer.</h2>
                <p>
                  The same simulated event set, replayed against fixed dunning and
                  RecoverLoop. Revenue is holdout-adjusted; contacts are counted directly.
                </p>
              </div>
              <span className="simulation-badge dark-badge">SIMULATED BENCHMARK</span>
            </div>

            <div className="comparison-layout">
              <div className="comparison-chart">
                <div className="chart-legend">
                  <span>
                    <i className="baseline-key" /> Fixed dunning
                  </span>
                  <span>
                    <i className="recover-key" /> RecoverLoop
                  </span>
                </div>
                <div className="bar-group">
                  <div className="bar-label">
                    <span>Incremental recovery rate</span>
                    <em>
                      {recoveryLift >= 0 ? "+" : "−"}
                      {Math.abs(recoveryLift).toFixed(1)} pts
                    </em>
                  </div>
                  <div className="horizontal-bar baseline-bar">
                    <i style={{ width: `${state.comparison.baselineRecoveryRate}%` }} />
                    <strong>{state.comparison.baselineRecoveryRate}%</strong>
                  </div>
                  <div className="horizontal-bar recover-bar">
                    <i style={{ width: `${state.comparison.recoverLoopRecoveryRate}%` }} />
                    <strong>{state.comparison.recoverLoopRecoveryRate}%</strong>
                  </div>
                </div>
                <div className="bar-group">
                  <div className="bar-label">
                    <span>Customer contacts</span>
                    <em className="contact-drop">
                      {contactReduction >= 0 ? "−" : "+"}
                      {Math.abs(contactReduction).toFixed(1)}%
                    </em>
                  </div>
                  <div className="horizontal-bar baseline-bar">
                    <i style={{ width: "100%" }} />
                    <strong>{state.comparison.baselineContacts.toLocaleString("en-IN")}</strong>
                  </div>
                  <div className="horizontal-bar recover-bar">
                    <i
                      style={{
                        width: `${recoverLoopContactWidth}%`,
                      }}
                    />
                    <strong>{state.comparison.recoverLoopContacts.toLocaleString("en-IN")}</strong>
                  </div>
                </div>
              </div>

              <div className="policy-proof-grid">
                <article>
                  <span>INCIDENT SUPPRESSIONS</span>
                  <strong>{state.comparison.incidentSuppressions}</strong>
                  <p>Messages not sent while a provider rail was down.</p>
                </article>
                <article>
                  <span>DUPLICATES PREVENTED</span>
                  <strong>{state.comparison.duplicateActionsPrevented}</strong>
                  <p>Repeated events reduced to one business action.</p>
                </article>
                <article>
                  <span>AUTONOMOUS CHARGES</span>
                  <strong>NONE</strong>
                  <p>AI never moves money or overrides risk controls.</p>
                </article>
                <article>
                  <span>EXPLAINABLE DECISIONS</span>
                  <strong>
                    {explainedCaseCount}/{state.cases.length}
                  </strong>
                  <p>Visible cases with an operator-facing explanation.</p>
                </article>
              </div>
            </div>
          </section>

          <section className="audit-section" id="audit">
            <div className="section-heading">
              <div>
                <span className="section-kicker">HASH-LINKED ACTION RECEIPTS</span>
                <h2>Inspect events, rejections, fallbacks, and actions.</h2>
              </div>
              <span className="audit-chain">SHA-256 HASH LINKS</span>
            </div>

            <div className="audit-grid">
              {state.audit.slice(0, 8).map((event, index) => (
                <article className="audit-event" key={event.id}>
                  <div className={`audit-marker audit-${event.tone}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <div>
                    <span>
                      {event.time} · {event.category.toUpperCase()}
                    </span>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                  </div>
                  <code>{event.id}</code>
                </article>
              ))}
            </div>
          </section>

          <footer className="product-footer">
            <div className="brand-lockup footer-brand">
              <span className="brand-mark" aria-hidden="true">
                R
              </span>
              <div>
                <strong>RecoverLoop</strong>
                <span>Recover revenue without retry spam.</span>
              </div>
            </div>
            <p>Track 3 · AI Revenue Recovery · All workspace data is simulated.</p>
            <div>
              <span>POLICY-FIRST</span>
              <span>FAILURE-READY</span>
              <span>AUDITABLE</span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
