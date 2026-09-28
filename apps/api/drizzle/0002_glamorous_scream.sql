CREATE TABLE `historical_candles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset_id` text NOT NULL,
	`instrument_key` text NOT NULL,
	`timestamp` integer NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	`open_interest` real,
	`unit` text NOT NULL,
	`interval` integer NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `historical_datasets`(`dataset_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `historical_candles_dataset_timestamp_unique` ON `historical_candles` (`dataset_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `historical_candles_dataset_timestamp_idx` ON `historical_candles` (`timestamp`);--> statement-breakpoint
CREATE TABLE `historical_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_from` text NOT NULL,
	`chunk_to` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`response_hash` text,
	`requested_at` integer,
	`responded_at` integer,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`dataset_id`) REFERENCES `historical_datasets`(`dataset_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `historical_chunks_dataset_chunk_unique` ON `historical_chunks` (`dataset_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `historical_datasets` (
	`dataset_id` text PRIMARY KEY NOT NULL,
	`instrument_key` text NOT NULL,
	`requested_from` text NOT NULL,
	`requested_to` text NOT NULL,
	`unit` text NOT NULL,
	`interval` integer NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`chunks_total` integer NOT NULL,
	`chunks_completed` integer DEFAULT 0 NOT NULL,
	`chunks_failed` integer DEFAULT 0 NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`schema_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `historical_datasets_instrument_idx` ON `historical_datasets` (`instrument_key`);--> statement-breakpoint
CREATE TABLE `historical_raw_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`raw_payload` text NOT NULL,
	`response_hash` text NOT NULL,
	`acquired_at` integer NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `historical_datasets`(`dataset_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `historical_raw_responses_dataset_chunk_unique` ON `historical_raw_responses` (`dataset_id`,`chunk_index`);