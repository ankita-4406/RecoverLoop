import { getDashboardState } from "@/db/repository";
import { correlationIdFor, jsonResponse } from "@/lib/security";

export async function GET(request: Request): Promise<Response> {
  const correlationId = correlationIdFor(request);

  try {
    return jsonResponse(await getDashboardState(), correlationId);
  } catch {
    console.error(
      JSON.stringify({
        event: "state_read_failed",
        correlationId,
        route: "/api/state",
      }),
    );
    return jsonResponse(
      { error: "Recovery state is temporarily unavailable", correlationId },
      correlationId,
      { status: 500 },
    );
  }
}
