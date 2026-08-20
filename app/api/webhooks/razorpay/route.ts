import {
  ProviderEventConflictError,
  recordProviderEvent,
} from "@/db/repository";
import { getRazorpayWebhookSecret } from "@/db";
import {
  correlationIdFor,
  isPlainRecord,
  jsonResponse,
  parseJsonBytes,
  readRequestBytes,
  RequestValidationError,
  requireJsonContentType,
  sha256Hex,
  verifyHmacSha256,
} from "@/lib/security";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ALLOWED_EVENTS = new Set([
  "invoice.paid",
  "order.paid",
  "payment.authorized",
  "payment.captured",
  "payment.downtime.resolved",
  "payment.downtime.started",
  "payment.failed",
  "subscription.activated",
  "subscription.cancelled",
  "subscription.charged",
  "subscription.completed",
  "subscription.halted",
  "subscription.pending",
]);

export async function POST(request: Request): Promise<Response> {
  const correlationId = correlationIdFor(request);
  let secret: string;

  try {
    secret = getRazorpayWebhookSecret();
  } catch {
    console.error(
      JSON.stringify({
        event: "webhook_configuration_unavailable",
        correlationId,
        route: "/api/webhooks/razorpay",
      }),
    );
    return jsonResponse(
      { error: "Webhook endpoint is temporarily unavailable", correlationId },
      correlationId,
      { status: 503 },
    );
  }

  try {
    requireJsonContentType(request);
    const signature = request.headers.get("x-razorpay-signature")?.trim();
    const eventId = request.headers.get("x-razorpay-event-id")?.trim();

    if (!signature) {
      throw new RequestValidationError(401, "Webhook authentication failed");
    }

    if (!eventId || !EVENT_ID_PATTERN.test(eventId)) {
      throw new RequestValidationError(400, "Required webhook headers are invalid");
    }

    const body = await readRequestBytes(request, MAX_WEBHOOK_BODY_BYTES);
    if (!(await verifyHmacSha256(secret, body, signature))) {
      throw new RequestValidationError(401, "Webhook authentication failed");
    }

    const payload = parseJsonBytes(body);
    if (
      !isPlainRecord(payload) ||
      typeof payload.event !== "string" ||
      !ALLOWED_EVENTS.has(payload.event)
    ) {
      throw new RequestValidationError(422, "Webhook event is not supported");
    }

    const result = await recordProviderEvent({
      eventId,
      eventType: payload.event,
      payloadHash: await sha256Hex(body),
      correlationId,
    });

    return jsonResponse(
      { received: true, idempotent: result.idempotent, correlationId },
      correlationId,
    );
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse(
        { error: error.publicMessage, correlationId },
        correlationId,
        { status: error.status },
      );
    }

    if (error instanceof ProviderEventConflictError) {
      return jsonResponse(
        { error: "Webhook event could not be accepted", correlationId },
        correlationId,
        { status: 409 },
      );
    }

    console.error(
      JSON.stringify({
        event: "webhook_processing_failed",
        correlationId,
        route: "/api/webhooks/razorpay",
      }),
    );
    return jsonResponse(
      { error: "Webhook event could not be processed", correlationId },
      correlationId,
      { status: 500 },
    );
  }
}
