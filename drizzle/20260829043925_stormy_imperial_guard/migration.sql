CREATE TABLE `customers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`phone` text,
	`note` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bills` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `customer_id` text REFERENCES customers(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);--> statement-breakpoint
CREATE INDEX `participants_customer_idx` ON `participants` (`customer_id`);