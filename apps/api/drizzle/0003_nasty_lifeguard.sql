CREATE TABLE `validation_reports` (
	`dataset_id` text PRIMARY KEY NOT NULL,
	`verdict` text NOT NULL,
	`candle_count` integer NOT NULL,
	`expected_count` integer NOT NULL,
	`matched_count` integer NOT NULL,
	`completeness` real NOT NULL,
	`details` text NOT NULL,
	`schema_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `historical_datasets`(`dataset_id`) ON UPDATE no action ON DELETE cascade
);
