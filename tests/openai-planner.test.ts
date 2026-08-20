import assert from "node:assert/strict";
import test from "node:test";

const {
  buildMaskedCaseContext,
  DEFAULT_OPENAI_MODEL,
  deterministicPlan,
  PlannerCircuitBreaker,
  planRecovery,
} = (await import(
  new URL("../lib/openai-planner.ts", import.meta.url).href
)) as typeof import("../lib/openai-planner");
const { createSeedState } = (await import(
  new URL("../lib/seed.ts", import.meta.url).href
)) as typeof import("../lib/seed");

function caseById(id: string) {
  return createSeedState().cases.find((item) => item.id === id)!;
}

function providerResponse(output: unknown): Response {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(output) }],
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("deterministic planner enforces incident, risk, consent, fatigue, and failure policy", () => {
  assert.equal(deterministicPlan(caseById("rcv_6A9M4")).action, "wait_for_incident");
  assert.equal(deterministicPlan(caseById("rcv_1P5X2")).action, "manual_review");
  assert.equal(deterministicPlan(caseById("rcv_8F2K1")).action, "request_method_update");
  assert.equal(deterministicPlan(caseById("rcv_3D7T8")).action, "send_reminder");
  assert.equal(deterministicPlan(caseById("rcv_9J4L6")).action, "offer_alternate_rail");
  assert.equal(deterministicPlan(caseById("rcv_5C8R3")).action, "escalate_account");

  const noConsent = caseById("rcv_8F2K1");
  noConsent.consent = false;
  assert.equal(deterministicPlan(noConsent).action, "manual_review");
  assert.equal(deterministicPlan(noConsent).messageDraft, "");

  const fatigued = caseById("rcv_3D7T8");
  fatigued.contactCount = 2;
  assert.equal(deterministicPlan(fatigued).action, "manual_review");
});

test("zero-key mode returns fallback without attempting network access", async () => {
  let calls = 0;
  const result = await planRecovery(caseById("rcv_8F2K1"), {
    apiKey: "",
    fetcher: async () => {
      calls += 1;
      throw new Error("network should not be called");
    },
  });

  assert.equal(result.source, "fallback");
  assert.equal(calls, 0);
});

test("planner sends only masked context and accepts strict structured output", async () => {
  const item = caseById("rcv_8F2K1");
  const apiKey = "x".repeat(32);
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const decision = await planRecovery(item, {
    apiKey,
    circuitBreaker: new PlannerCircuitBreaker(),
    fetcher: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return providerResponse({
        action: "request_method_update",
        strategy: "Send one respectful method-update request after approval.",
        confidence: 0.91,
        explanation: "The instrument is permanently invalid and cannot recover by retrying.",
        messageDraft: "Your saved payment method needs an update before the renewal can complete.",
        rejectedActions: ["Retry would repeat a permanent decline"],
      });
    },
  });

  assert.equal(decision.source, "ai");
  assert.equal(decision.action, "request_method_update");
  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), `Bearer ${apiKey}`);

  const bodyText = String(requestInit?.body);
  const body = JSON.parse(bodyText) as {
    model: string;
    store: boolean;
    tools: unknown[];
    text: { format: { strict: boolean; schema: { additionalProperties: boolean } } };
  };
  assert.equal(body.model, DEFAULT_OPENAI_MODEL);
  assert.equal(body.store, false);
  assert.deepEqual(body.tools, []);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(bodyText.includes(item.customer), false);
  assert.equal(bodyText.includes(item.customerRef), false);
  assert.equal(bodyText.includes(String(item.amountMinor)), false);
});

test("masked context contains derived bands and no direct customer fields", () => {
  const item = caseById("rcv_5C8R3");
  const context = buildMaskedCaseContext(item);
  const serialised = JSON.stringify(context);

  assert.equal(context.case_ref, "case-redacted");
  assert.equal(context.amount_band, "100k_plus_inr");
  assert.equal(context.tenure_band, "24_months_plus");
  assert.equal(serialised.includes(item.customer), false);
  assert.equal(serialised.includes(item.customerRef), false);
  assert.equal(Object.hasOwn(context, "customer"), false);
});

test("hard policy cases never reach the model even when a key is configured", async () => {
  let calls = 0;
  const riskCase = caseById("rcv_1P5X2");
  const result = await planRecovery(riskCase, {
    apiKey: "x".repeat(32),
    fetcher: async () => {
      calls += 1;
      return providerResponse({});
    },
  });

  assert.equal(result.action, "manual_review");
  assert.equal(result.source, "fallback");
  assert.equal(calls, 0);
});

test("unknown fields, disallowed actions, unsafe URLs, and tool calls fail closed", async (t) => {
  const item = caseById("rcv_8F2K1");
  const apiKey = "x".repeat(32);
  const base = {
    action: "request_method_update",
    strategy: "Send one approved request.",
    confidence: 0.9,
    explanation: "The saved instrument cannot recover through another retry.",
    messageDraft: "Update the payment method from the secure account billing flow.",
    rejectedActions: ["Retry remains unsafe"],
  };

  await t.test("unknown field", async () => {
    const result = await planRecovery(item, {
      apiKey,
      circuitBreaker: new PlannerCircuitBreaker(),
      fetcher: async () => providerResponse({ ...base, extra: true }),
    });
    assert.equal(result.source, "fallback");
  });

  await t.test("disallowed action", async () => {
    const result = await planRecovery(item, {
      apiKey,
      circuitBreaker: new PlannerCircuitBreaker(),
      fetcher: async () => providerResponse({ ...base, action: "send_reminder" }),
    });
    assert.equal(result.source, "fallback");
  });

  await t.test("URL in message", async () => {
    const result = await planRecovery(item, {
      apiKey,
      circuitBreaker: new PlannerCircuitBreaker(),
      fetcher: async () =>
        providerResponse({ ...base, messageDraft: "Pay at https://untrusted.example now." }),
    });
    assert.equal(result.source, "fallback");
  });

  await t.test("tool output", async () => {
    const result = await planRecovery(item, {
      apiKey,
      circuitBreaker: new PlannerCircuitBreaker(),
      fetcher: async () =>
        new Response(
          JSON.stringify({ output: [{ type: "function_call", name: "send_message" }] }),
          { status: 200 },
        ),
    });
    assert.equal(result.source, "fallback");
  });
});

test("deadline covers the response body and opens the circuit after a timeout", async () => {
  const breaker = new PlannerCircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 });
  let calls = 0;
  const hangingBody = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"output":['));
        },
      }),
      { status: 200 },
    );

  const first = await planRecovery(caseById("rcv_8F2K1"), {
    apiKey: "x".repeat(32),
    timeoutMs: 15,
    circuitBreaker: breaker,
    fetcher: async () => {
      calls += 1;
      return hangingBody();
    },
  });
  assert.equal(first.source, "fallback");
  assert.equal(breaker.getState(), "open");
  assert.equal(calls, 1);

  const second = await planRecovery(caseById("rcv_8F2K1"), {
    apiKey: "x".repeat(32),
    timeoutMs: 15,
    circuitBreaker: breaker,
    fetcher: async () => {
      calls += 1;
      return providerResponse({});
    },
  });
  assert.equal(second.source, "fallback");
  assert.equal(calls, 1);
});

test("circuit breaker permits one half-open probe and resets after success", () => {
  const breaker = new PlannerCircuitBreaker({ failureThreshold: 2, cooldownMs: 100 });
  breaker.recordFailure(0);
  assert.equal(breaker.getState(0), "closed");
  breaker.recordFailure(10);
  assert.equal(breaker.getState(50), "open");
  assert.equal(breaker.allowRequest(50), false);
  assert.equal(breaker.getState(110), "half_open");
  assert.equal(breaker.allowRequest(110), true);
  assert.equal(breaker.allowRequest(111), false);
  breaker.recordSuccess();
  assert.equal(breaker.getState(112), "closed");
  assert.equal(breaker.failureCount, 0);
});
