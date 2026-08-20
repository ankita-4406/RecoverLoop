import { getOpenAIPlannerConfig } from "@/db";
import {
  getDashboardState,
  mutateDashboardState,
} from "@/db/repository";
import type { PlanRecoveryResponse } from "@/lib/contracts";
import { applyPlannerDecision } from "@/lib/domain";
import { planRecovery } from "@/lib/openai-planner";
import {
  correlationIdFor,
  isPlainRecord,
  jsonResponse,
  parseJsonBytes,
  readRequestBytes,
  RequestValidationError,
  requireJsonContentType,
  requireSameOriginMutation,
} from "@/lib/security";

const MAX_PLAN_BODY_BYTES = 8 * 1024;
const CASE_ID_PATTERN = /^rcv_[A-Za-z0-9_-]{1,48}$/;

export async function POST(request: Request): Promise<Response> {
  const correlationId = correlationIdFor(request);

  try {
    requireSameOriginMutation(request);
    requireJsonContentType(request);
    const caseId = validatePlanRequest(
      parseJsonBytes(await readRequestBytes(request, MAX_PLAN_BODY_BYTES)),
    );
    const state = await getDashboardState();
    const item = state.cases.find((candidate) => candidate.id === caseId);
    if (!item) {
      throw new RequestValidationError(404, "Recovery case was not found");
    }

    const basedOnDecisionVersion = item.decisionVersion;
    const plan = await planRecovery(item, getOpenAIPlannerConfig());
    const generatedAt = new Date().toISOString();
    const mutation = await mutateDashboardState(
      { action: "refresh_plan", caseId },
      correlationId,
      (current) =>
        applyPlannerDecision(
          current,
          caseId,
          basedOnDecisionVersion,
          plan,
          generatedAt,
        ),
    );
    if (mutation.idempotent) {
      throw new RequestValidationError(
        409,
        "The case changed while planning; refresh and try again",
      );
    }
    const response: PlanRecoveryResponse = {
      caseId,
      plan,
      execution:
        plan.source === "ai" ? "live_ai" : "deterministic_fallback",
      generatedAt,
      state: mutation.state,
    };
    return jsonResponse(response, correlationId);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse(
        { error: error.publicMessage, correlationId },
        correlationId,
        { status: error.status },
      );
    }

    console.error(
      JSON.stringify({
        event: "plan_request_failed",
        correlationId,
        route: "/api/plan",
      }),
    );
    return jsonResponse(
      { error: "A recovery plan could not be generated", correlationId },
      correlationId,
      { status: 500 },
    );
  }
}

function validatePlanRequest(value: unknown): string {
  if (!isPlainRecord(value)) {
    throw new RequestValidationError(400, "Request body has an invalid shape");
  }
  if (
    Object.keys(value).length !== 1 ||
    typeof value.caseId !== "string" ||
    !CASE_ID_PATTERN.test(value.caseId)
  ) {
    throw new RequestValidationError(400, "A valid caseId is required");
  }
  return value.caseId;
}
