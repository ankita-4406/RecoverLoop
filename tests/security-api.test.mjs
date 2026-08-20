import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const bindings = {
  DB: undefined,
  OPENAI_API_KEY: undefined,
  OPENAI_MODEL: undefined,
  OPENAI_TIMEOUT_MS: undefined,
  RAZORPAY_WEBHOOK_SECRET: undefined,
};
const databases = [];
let outputDirectory;
let security;
let repository;
let actionsRoute;
let planRoute;
let stateRoute;
let webhookRoute;

before(async () => {
  globalThis.__recoverLoopTestBindings = bindings;
  outputDirectory = await mkdtemp(join(tmpdir(), "recoverloop-tests-"));

  const entries = {
    security: "lib/security.ts",
    repository: "db/repository.ts",
    actions: "app/api/actions/route.ts",
    plan: "app/api/plan/route.ts",
    state: "app/api/state/route.ts",
    webhook: "app/api/webhooks/razorpay/route.ts",
  };

  await Promise.all(
    Object.entries(entries).map(([name, entryPoint]) =>
      build({
        absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
        entryPoints: [entryPoint],
        outfile: join(outputDirectory, `${name}.mjs`),
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        logLevel: "silent",
        plugins: [cloudflareWorkersStub],
      }),
    ),
  );

  [security, repository, actionsRoute, planRoute, stateRoute, webhookRoute] =
    await Promise.all(
      ["security", "repository", "actions", "plan", "state", "webhook"].map((name) =>
        import(pathToFileURL(join(outputDirectory, `${name}.mjs`)).href),
      ),
    );
});

after(async () => {
  for (const database of databases) database.close();
  delete globalThis.__recoverLoopTestBindings;
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

test("security helpers enforce HMAC, request limits, and mutation provenance", async () => {
  const body = new TextEncoder().encode('{"event":"payment.failed"}');
  const signature = await hmacHex("unit-test-secret", body);

  assert.equal(
    await security.verifyHmacSha256("unit-test-secret", body, signature),
    true,
  );
  assert.equal(
    await security.verifyHmacSha256("different-secret", body, signature),
    false,
  );
  assert.equal(await security.verifyHmacSha256("unit-test-secret", body, "bad"), false);
  assert.equal((await security.sha256Hex(body)).length, 64);

  const allowed = actionRequest({ action: "reset" });
  security.requireSameOriginMutation(allowed);
  security.requireJsonContentType(allowed);

  assert.throws(
    () =>
      security.requireSameOriginMutation(
        actionRequest(
          { action: "reset" },
          { origin: "https://attacker.example" },
        ),
      ),
    (error) => error instanceof security.RequestValidationError && error.status === 403,
  );
  assert.throws(
    () =>
      security.requireSameOriginMutation(
        actionRequest({ action: "reset" }, { "x-recoverloop-action": "" }),
      ),
    (error) => error instanceof security.RequestValidationError && error.status === 403,
  );

  const oversized = new Request("https://recoverloop.test/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(9));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    }),
    duplex: "half",
  });
  await assert.rejects(
    security.readRequestBytes(oversized, 16),
    (error) => error instanceof security.RequestValidationError && error.status === 413,
  );

  const response = security.jsonResponse({ ok: true }, "correlation-test-001");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-correlation-id"), "correlation-test-001");
});

test("D1 repository seeds once, serializes writes, and chains audit hashes", async () => {
  const database = useFreshDatabase();
  const initial = await repository.getDashboardState();
  assert.equal(initial.cases.length, 6);

  await Promise.all([
    repository.mutateDashboardState(
      { action: "ai_outage" },
      "correlation-repository-001",
      (state) => ({
        state: { ...state, lastScenario: "ai_outage" },
        notice: "fallback",
      }),
    ),
    repository.mutateDashboardState(
      { action: "provider_timeout" },
      "correlation-repository-002",
      (state) => ({
        state: { ...state, lastScenario: "provider_timeout" },
        notice: "circuit open",
      }),
    ),
  ]);

  assert.equal(database.value("SELECT COUNT(*) AS value FROM dashboard_state"), 1);
  assert.equal(database.value("SELECT COUNT(*) AS value FROM audit_records"), 2);
  assert.equal(database.value("SELECT revision AS value FROM dashboard_state"), 3);
  assert.match(
    database.value("SELECT state_hash AS value FROM dashboard_state"),
    /^[0-9a-f]{64}$/,
  );

  const providerEvent = {
    eventId: "evt_repository_001",
    eventType: "payment.failed",
    payloadHash: "a".repeat(64),
    correlationId: "correlation-repository-003",
  };
  assert.deepEqual(await repository.recordProviderEvent(providerEvent), {
    idempotent: false,
  });
  assert.deepEqual(await repository.recordProviderEvent(providerEvent), {
    idempotent: true,
  });
  await assert.rejects(
    repository.recordProviderEvent({
      ...providerEvent,
      payloadHash: "b".repeat(64),
    }),
    repository.ProviderEventConflictError,
  );

  assert.equal(database.value("SELECT COUNT(*) AS value FROM provider_events"), 1);
  assert.equal(
    database.value(
      `SELECT p.previous_hash AS value
       FROM provider_events p
       JOIN audit_records a ON a.integrity_hash = p.previous_hash
       WHERE p.event_id = 'evt_repository_001'`,
    ),
    database.value(
      "SELECT previous_hash AS value FROM provider_events WHERE event_id = 'evt_repository_001'",
    ),
  );
});

test("action API rejects unsafe input and persists valid domain transitions", async () => {
  useFreshDatabase();

  const missingGuard = await actionsRoute.POST(
    actionRequest(
      { action: "approve_case", caseId: "rcv_8F2K1" },
      { "x-recoverloop-action": "" },
    ),
  );
  assert.equal(missingGuard.status, 403);

  const unknownField = await actionsRoute.POST(
    actionRequest({ action: "reset", unexpected: true }),
  );
  assert.equal(unknownField.status, 400);

  const tooLarge = await actionsRoute.POST(
    actionRequest({ action: "reset", padding: "x".repeat(17 * 1024) }),
  );
  assert.equal(tooLarge.status, 413);

  const staleApproval = await actionsRoute.POST(
    actionRequest({
      action: "approve_case",
      caseId: "rcv_8F2K1",
      decisionVersion: "dec_stale_v1",
    }),
  );
  assert.equal(staleApproval.status, 200);
  const stalePayload = await staleApproval.json();
  assert.equal(stalePayload.idempotent, true);
  assert.equal(stalePayload.state.cases[0].status, "pending_approval");

  const approved = await actionsRoute.POST(
    actionRequest({
      action: "approve_case",
      caseId: "rcv_8F2K1",
      decisionVersion: "dec_8F2K1_v1",
    }),
  );
  assert.equal(approved.status, 200);
  const actionPayload = await approved.json();
  assert.equal(actionPayload.state.cases[0].status, "scheduled");
  assert.equal(approved.headers.get("cache-control"), "no-store");

  const planned = await planRoute.POST(
    actionRequest({ caseId: "rcv_8F2K1" }, {}, "/api/plan"),
  );
  assert.equal(planned.status, 200);
  const plannedPayload = await planned.json();
  assert.equal(plannedPayload.execution, "deterministic_fallback");
  assert.equal(plannedPayload.plan.source, "fallback");
  assert.equal(plannedPayload.state.cases[0].plannerSource, "fallback");
  assert.notEqual(
    plannedPayload.state.cases[0].decisionVersion,
    "dec_8F2K1_v1",
  );

  const persisted = await stateRoute.GET(
    new Request("https://recoverloop.test/api/state"),
  );
  assert.equal(persisted.status, 200);
  assert.equal((await persisted.json()).cases[0].status, "scheduled");
});

test("Razorpay webhook authenticates raw bytes and deduplicates event IDs", async () => {
  const database = useFreshDatabase();
  bindings.RAZORPAY_WEBHOOK_SECRET = undefined;

  const errorLines = [];
  const originalConsoleError = console.error;
  console.error = (value) => errorLines.push(String(value));
  let unavailable;
  try {
    unavailable = await webhookRoute.POST(
      await webhookRequest(
        "evt_webhook_000",
        { event: "payment.failed" },
        "unused-secret",
      ),
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(unavailable.status, 503);
  assert.equal(errorLines.length, 1);
  assert.doesNotMatch(errorLines[0], /unused-secret/);

  const secret = "webhook-test-secret";
  bindings.RAZORPAY_WEBHOOK_SECRET = secret;

  const oversized = await webhookRoute.POST(
    new Request("https://recoverloop.test/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-event-id": "evt_webhook_oversized",
        "x-razorpay-signature": "0".repeat(64),
      },
      body: new Uint8Array(256 * 1024 + 1),
    }),
  );
  assert.equal(oversized.status, 413);

  const invalidSignature = await webhookRoute.POST(
    new Request("https://recoverloop.test/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-event-id": "evt_webhook_001",
        "x-razorpay-signature": "0".repeat(64),
      },
      body: JSON.stringify({ event: "payment.failed" }),
    }),
  );
  assert.equal(invalidSignature.status, 401);

  const unsupported = await webhookRoute.POST(
    await webhookRequest(
      "evt_webhook_002",
      { event: "payment.untrusted" },
      secret,
    ),
  );
  assert.equal(unsupported.status, 422);

  const event = { event: "payment.downtime.started", payload: { synthetic: true } };
  const first = await webhookRoute.POST(
    await webhookRequest("evt_webhook_003", event, secret),
  );
  assert.equal(first.status, 200);
  assert.equal((await first.json()).idempotent, false);

  const replay = await webhookRoute.POST(
    await webhookRequest("evt_webhook_003", event, secret),
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotent, true);

  const collision = await webhookRoute.POST(
    await webhookRequest(
      "evt_webhook_003",
      { event: "payment.downtime.resolved" },
      secret,
    ),
  );
  assert.equal(collision.status, 409);
  assert.equal(database.value("SELECT COUNT(*) AS value FROM provider_events"), 1);
  assert.equal(
    database.value(
      "SELECT length(payload_hash) AS value FROM provider_events LIMIT 1",
    ),
    64,
  );
});

const cloudflareWorkersStub = {
  name: "cloudflare-workers-test-binding",
  setup(builder) {
    builder.onResolve(
      { filter: /^cloudflare:workers$/ },
      () => ({ path: "bindings", namespace: "recoverloop-test" }),
    );
    builder.onLoad(
      { filter: /^bindings$/, namespace: "recoverloop-test" },
      () => ({
        contents:
          "export const env = globalThis.__recoverLoopTestBindings;",
        loader: "js",
      }),
    );
  },
};

function actionRequest(
  payload,
  headerOverrides = {},
  pathname = "/api/actions",
) {
  return new Request(`https://recoverloop.test${pathname}`, {
    method: "POST",
    headers: {
      origin: "https://recoverloop.test",
      "content-type": "application/json",
      "x-recoverloop-action": "demo",
      ...headerOverrides,
    },
    body: JSON.stringify(payload),
  });
}

async function webhookRequest(eventId, payload, secret) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  return new Request("https://recoverloop.test/api/webhooks/razorpay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-event-id": eventId,
      "x-razorpay-signature": await hmacHex(secret, body),
    },
    body,
  });
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function useFreshDatabase() {
  const database = new FakeD1();
  databases.push(database);
  bindings.DB = database;
  bindings.RAZORPAY_WEBHOOK_SECRET = undefined;
  return database;
}

class FakeD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
  }

  prepare(query) {
    return new FakeD1Statement(this.database, query);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  value(query) {
    return this.database.prepare(query).get()?.value;
  }

  close() {
    this.database.close();
  }
}

class FakeD1Statement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new FakeD1Statement(this.database, this.query, values);
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.database.prepare(this.query).run(...this.values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }

  async first() {
    return this.database.prepare(this.query).get(...this.values) ?? null;
  }
}
