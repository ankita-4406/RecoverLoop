import { mutateDashboardState } from "@/db/repository";
import type { DemoAction, DemoActionRequest } from "@/lib/contracts";
import { applyDemoAction } from "@/lib/domain";
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

const MAX_ACTION_BODY_BYTES = 16 * 1024;
const CASE_ID_PATTERN = /^rcv_[A-Za-z0-9_-]{1,48}$/;
const DECISION_VERSION_PATTERN = /^dec_[A-Za-z0-9_-]{1,64}$/;
const ACTIONS = new Set<DemoAction>([
  "approve_case",
  "recover_case",
  "duplicate_webhook",
  "out_of_order_success",
  "ai_outage",
  "provider_timeout",
  "incident_resolved",
  "reset",
]);
const CASE_ACTIONS = new Set<DemoAction>(["approve_case", "recover_case"]);

export async function POST(request: Request): Promise<Response> {
  const correlationId = correlationIdFor(request);

  try {
    requireSameOriginMutation(request);
    requireJsonContentType(request);
    const payload = parseJsonBytes(
      await readRequestBytes(request, MAX_ACTION_BODY_BYTES),
    );
    const actionRequest = validateActionRequest(payload);
    const result = await mutateDashboardState(
      actionRequest,
      correlationId,
      applyDemoAction,
    );
    return jsonResponse(result, correlationId);
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
        event: "action_request_failed",
        correlationId,
        route: "/api/actions",
      }),
    );
    return jsonResponse(
      { error: "The action could not be completed", correlationId },
      correlationId,
      { status: 500 },
    );
  }
}

function validateActionRequest(value: unknown): DemoActionRequest {
  if (!isPlainRecord(value)) {
    throw new RequestValidationError(400, "Request body has an invalid shape");
  }

  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        key !== "action" && key !== "caseId" && key !== "decisionVersion",
    )
  ) {
    throw new RequestValidationError(400, "Request body contains unknown fields");
  }

  if (typeof value.action !== "string" || !ACTIONS.has(value.action as DemoAction)) {
    throw new RequestValidationError(400, "Action is not supported");
  }

  const action = value.action as DemoAction;
  const caseId = value.caseId;
  if (CASE_ACTIONS.has(action)) {
    if (typeof caseId !== "string" || !CASE_ID_PATTERN.test(caseId)) {
      throw new RequestValidationError(400, "A valid caseId is required");
    }
    if (action === "approve_case") {
      if (
        typeof value.decisionVersion !== "string" ||
        !DECISION_VERSION_PATTERN.test(value.decisionVersion)
      ) {
        throw new RequestValidationError(
          400,
          "A valid decisionVersion is required",
        );
      }
      return { action, caseId, decisionVersion: value.decisionVersion };
    }
    if (value.decisionVersion !== undefined) {
      throw new RequestValidationError(
        400,
        "decisionVersion is not allowed for this action",
      );
    }
    return { action, caseId };
  }

  if (caseId !== undefined || value.decisionVersion !== undefined) {
    throw new RequestValidationError(
      400,
      "Case fields are not allowed for this action",
    );
  }

  return { action };
}
