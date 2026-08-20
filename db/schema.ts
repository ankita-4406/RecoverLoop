import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dashboardState = sqliteTable(
  "dashboard_state",
  {
    id: text("id").primaryKey(),
    stateJson: text("state_json").notNull(),
    revision: integer("revision").notNull().default(1),
    stateHash: text("state_hash").notNull(),
    auditHeadHash: text("audit_head_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("dashboard_state_updated_at_idx").on(table.updatedAt)],
);

export const providerEvents = sqliteTable(
  "provider_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    previousHash: text("previous_hash").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    index("provider_events_type_received_idx").on(
      table.eventType,
      table.receivedAt,
    ),
  ],
);

export const auditRecords = sqliteTable(
  "audit_records",
  {
    id: text("id").primaryKey(),
    correlationId: text("correlation_id").notNull(),
    source: text("source").notNull(),
    action: text("action").notNull(),
    entityId: text("entity_id"),
    beforeHash: text("before_hash").notNull(),
    afterHash: text("after_hash").notNull(),
    previousHash: text("previous_hash").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_records_correlation_idx").on(table.correlationId),
    index("audit_records_created_idx").on(table.createdAt),
  ],
);
