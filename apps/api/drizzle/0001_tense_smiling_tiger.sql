CREATE TABLE `capture_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_connection_id` text,
	`batch_id` text,
	`instrument_key` text,
	`received_ts` integer,
	`session_date` text,
	`stage` text NOT NULL,
	`error_code` text NOT NULL,
	`error_message` text NOT NULL,
	`raw_payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `raw_batches`(`batch_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `raw_batches` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`source_connection_id` text NOT NULL,
	`received_ts` integer NOT NULL,
	`current_ts` integer,
	`session_date` text NOT NULL,
	`feed_mode` text NOT NULL,
	`schema_version` text NOT NULL,
	`batch_hash` text NOT NULL,
	`raw_payload` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_batches_batch_hash_unique` ON `raw_batches` (`batch_hash`);--> statement-breakpoint
CREATE TABLE `raw_market_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`instrument_key` text NOT NULL,
	`current_ts` integer,
	`ltt` integer,
	`received_ts` integer NOT NULL,
	`session_date` text NOT NULL,
	`feed_mode` text NOT NULL,
	`schema_version` text NOT NULL,
	`instrument_payload_hash` text NOT NULL,
	`raw_payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `raw_batches`(`batch_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_market_messages_instrument_dedup_unique` ON `raw_market_messages` (`instrument_key`,`current_ts`,`instrument_payload_hash`);--> statement-breakpoint
CREATE INDEX `raw_market_messages_batch_id_idx` ON `raw_market_messages` (`batch_id`);