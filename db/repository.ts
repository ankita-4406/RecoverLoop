import type {
  DashboardState,
} from "@/lib/contracts";
import { createSeedState } from "@/lib/seed";
import { isPlainRecord, sha256Hex } from "@/lib/security";
import { getD1Database } from "./index";

const STATE_ID = "recoverloop";
const MAX_WRITE_ATTEMPTS = 4;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dashboard_state (
    id TEXT PRIMARY KEY NOT NULL,
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    state_hash TEXT NOT NULL,
    audit_head_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_state_updated_at_idx
    ON dashboard_state (updated_at)`,
  `CREATE TABLE IF NOT EXISTS provider_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    event_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS provider_events_type_received_idx
    ON provider_events (event_type, received_at)`,
  `CREATE TABLE IF NOT EXISTS audit_records (
    id TEXT PRIMARY KEY NOT NULL,
    correlation_id TEXT NOT NULL,
    source TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT,
    before_hash TEXT NOT NULL,
    after_hash TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_records_correlation_idx
    ON audit_records (correlation_id)`,
  `CREATE INDEX IF NOT EXISTS audit_records_created_idx
    ON audit_records (created_at)`,
  `PRAGMA optimize`,
] as const;

interface StateRow {
  state_json: string;
  revision: number;
  state_hash: string;
  audit_head_hash: string;
}

interface ProviderEventRow {
  event_type: string;
  payload_hash: string;
}

export interface ProviderEventInput {
  eventId: string;
  eventType: string;
  payloadHash: string;
  correlationId: string;
}

export class ProviderEventConflictError extends Error {
  constructor() {
    super("Provider event identifier conflict");
    this.name = "ProviderEventConflictError";
  }
}

const readiness = new WeakMap<object, Promise<void>>();

export async function getDashboardState(): Promise<DashboardState> {
  const database = getD1Database();
  await ensureReady(database);
  return (await readStateRow(database)).state;
}

export async function mutateDashboardState<
  Request extends { action: string; caseId?: string },
  Result extends { state: DashboardState },
>(
  actionRequest: Request,
  correlationId: string,
  mutation: (state: DashboardState, request: Request) => Result,
): Promise<Result> {
  const database = getD1Database();
  await ensureReady(database);

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readStateRow(database);
    const result = mutation(current.state, actionRequest);
    const nextJson = JSON.stringify(result.state);
    const nextHash = await sha256Hex(nextJson);
    const createdAt = new Date().toISOString();
    const auditId = `audit_${crypto.randomUUID()}`;
    const integrityHash = await auditHash({
      previousHash: current.row.audit_head_hash,
      correlationId,
      source: "demo_action",
      action: actionRequest.action,
      entityId: actionRequest.caseId ?? "",
      beforeHash: current.row.state_hash,
      afterHash: nextHash,
      createdAt,
    });

    const results = await database.batch([
      database
        .prepare(
          `INSERT INTO audit_records (
            id, correlation_id, source, action, entity_id, before_hash,
            after_hash, previous_hash, integrity_hash, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM dashboard_state
            WHERE id = ? AND revision = ? AND audit_head_hash = ?
          )`,
        )
        .bind(
          auditId,
          correlationId,
          "demo_action",
          actionRequest.action,
          actionRequest.caseId ?? null,
          current.row.state_hash,
          nextHash,
          current.row.audit_head_hash,
          integrityHash,
          createdAt,
          STATE_ID,
          current.row.revision,
          current.row.audit_head_hash,
        ),
      database
        .prepare(
          `UPDATE dashboard_state
          SET state_json = ?, revision = revision + 1, state_hash = ?,
              audit_head_hash = ?, updated_at = ?
          WHERE id = ? AND revision = ? AND audit_head_hash = ?
            AND EXISTS (
              SELECT 1 FROM audit_records
              WHERE id = ? AND integrity_hash = ?
            )`,
        )
        .bind(
          nextJson,
          nextHash,
          integrityHash,
          createdAt,
          STATE_ID,
          current.row.revision,
          current.row.audit_head_hash,
          auditId,
          integrityHash,
        ),
    ]);

    if (changedRows(results[1]) === 1) {
      return result;
    }
  }

  throw new Error("State update contention exceeded retry limit");
}

export async function recordProviderEvent(
  input: ProviderEventInput,
): Promise<{ idempotent: boolean }> {
  const database = getD1Database();
  await ensureReady(database);

  const existing = await findProviderEvent(database, input.eventId);
  if (existing) return classifyExistingEvent(existing, input);

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readStateRow(database);
    const receivedAt = new Date().toISOString();
    const integrityHash = await auditHash({
      previousHash: current.row.audit_head_hash,
      correlationId: input.correlationId,
      source: "razorpay_webhook",
      action: input.eventType,
      entityId: input.eventId,
      beforeHash: input.payloadHash,
      afterHash: input.payloadHash,
      createdAt: receivedAt,
    });

    const results = await database.batch([
      database
        .prepare(
          `INSERT OR IGNORE INTO provider_events (
            event_id, event_type, payload_hash, correlation_id,
            previous_hash, integrity_hash, received_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM dashboard_state
            WHERE id = ? AND revision = ? AND audit_head_hash = ?
          )`,
        )
        .bind(
          input.eventId,
          input.eventType,
          input.payloadHash,
          input.correlationId,
          current.row.audit_head_hash,
          integrityHash,
          receivedAt,
          STATE_ID,
          current.row.revision,
          current.row.audit_head_hash,
        ),
      database
        .prepare(
          `UPDATE dashboard_state
          SET revision = revision + 1, audit_head_hash = ?, updated_at = ?
          WHERE id = ? AND revision = ? AND audit_head_hash = ?
            AND EXISTS (
              SELECT 1 FROM provider_events
              WHERE event_id = ? AND correlation_id = ? AND integrity_hash = ?
            )`,
        )
        .bind(
          integrityHash,
          receivedAt,
          STATE_ID,
          current.row.revision,
          current.row.audit_head_hash,
          input.eventId,
          input.correlationId,
          integrityHash,
        ),
    ]);

    if (changedRows(results[0]) === 1 && changedRows(results[1]) === 1) {
      return { idempotent: false };
    }

    const racedEvent = await findProviderEvent(database, input.eventId);
    if (racedEvent) return classifyExistingEvent(racedEvent, input);
  }

  throw new Error("Provider event contention exceeded retry limit");
}

async function ensureReady(database: D1Database): Promise<void> {
  const key = database as object;
  const active = readiness.get(key);
  if (active) return active;

  const initialization = initialize(database).catch((error) => {
    readiness.delete(key);
    throw error;
  });
  readiness.set(key, initialization);
  return initialization;
}

async function initialize(database: D1Database): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await database.prepare(statement).run();
  }

  const stateJson = JSON.stringify(createSeedState());
  const stateHash = await sha256Hex(stateJson);
  const auditHeadHash = await sha256Hex("recoverloop:audit:genesis:v1");
  const createdAt = new Date().toISOString();

  await database
    .prepare(
      `INSERT OR IGNORE INTO dashboard_state (
        id, state_json, revision, state_hash, audit_head_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      STATE_ID,
      stateJson,
      1,
      stateHash,
      auditHeadHash,
      createdAt,
      createdAt,
    )
    .run();
}

async function readStateRow(
  database: D1Database,
): Promise<{ row: StateRow; state: DashboardState }> {
  const row = await database
    .prepare(
      `SELECT state_json, revision, state_hash, audit_head_hash
      FROM dashboard_state WHERE id = ? LIMIT 1`,
    )
    .bind(STATE_ID)
    .first<StateRow>();

  if (!row || !Number.isInteger(row.revision) || row.revision < 1) {
    throw new Error("Persisted state is unavailable");
  }

  if ((await sha256Hex(row.state_json)) !== row.state_hash) {
    throw new Error("Persisted state failed integrity verification");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state_json);
  } catch {
    throw new Error("Persisted state is invalid");
  }

  if (!isDashboardState(parsed)) {
    throw new Error("Persisted state has an invalid shape");
  }

  return { row, state: parsed };
}

async function findProviderEvent(
  database: D1Database,
  eventId: string,
): Promise<ProviderEventRow | null> {
  return database
    .prepare(
      `SELECT event_type, payload_hash
      FROM provider_events WHERE event_id = ? LIMIT 1`,
    )
    .bind(eventId)
    .first<ProviderEventRow>();
}

function classifyExistingEvent(
  existing: ProviderEventRow,
  input: ProviderEventInput,
): { idempotent: true } {
  if (
    existing.event_type !== input.eventType ||
    existing.payload_hash !== input.payloadHash
  ) {
    throw new ProviderEventConflictError();
  }

  return { idempotent: true };
}

async function auditHash(fields: {
  previousHash: string;
  correlationId: string;
  source: string;
  action: string;
  entityId: string;
  beforeHash: string;
  afterHash: string;
  createdAt: string;
}): Promise<string> {
  return sha256Hex(
    [
      "recoverloop:audit:v1",
      fields.previousHash,
      fields.correlationId,
      fields.source,
      fields.action,
      fields.entityId,
      fields.beforeHash,
      fields.afterHash,
      fields.createdAt,
    ].join("\n"),
  );
}

function changedRows(
  result: { meta?: { changes?: number } } | undefined,
): number {
  return Number(result?.meta?.changes ?? 0);
}

function isDashboardState(value: unknown): value is DashboardState {
  if (!isPlainRecord(value)) return false;

  return (
    isPlainRecord(value.metrics) &&
    isPlainRecord(value.health) &&
    Array.isArray(value.cases) &&
    value.cases.every(isRecoveryCaseRecord) &&
    Array.isArray(value.audit) &&
    isPlainRecord(value.comparison) &&
    typeof value.updatedAt === "string" &&
    (value.lastScenario === null || typeof value.lastScenario === "string")
  );
}

function isRecoveryCaseRecord(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    /^rcv_[A-Za-z0-9_-]{1,48}$/.test(value.id) &&
    typeof value.decisionVersion === "string" &&
    /^dec_[A-Za-z0-9_-]{1,64}$/.test(value.decisionVersion) &&
    typeof value.status === "string" &&
    typeof value.recommendedAction === "string" &&
    typeof value.plannerSource === "string"
  );
}
