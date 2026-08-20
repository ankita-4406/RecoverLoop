CREATE TABLE `audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`source` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text,
	`before_hash` text NOT NULL,
	`after_hash` text NOT NULL,
	`previous_hash` text NOT NULL,
	`integrity_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_records_correlation_idx` ON `audit_records` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `audit_records_created_idx` ON `audit_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `dashboard_state` (
	`id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`state_hash` text NOT NULL,
	`audit_head_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dashboard_state_updated_at_idx` ON `dashboard_state` (`updated_at`);--> statement-breakpoint
CREATE TABLE `provider_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`correlation_id` text NOT NULL,
	`previous_hash` text NOT NULL,
	`integrity_hash` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_events_type_received_idx` ON `provider_events` (`event_type`,`received_at`);
--> statement-breakpoint
PRAGMA optimize;
