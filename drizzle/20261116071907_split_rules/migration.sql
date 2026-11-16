ALTER TABLE `bills` ADD `split_version` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `rounding_bill_player_id` text;--> statement-breakpoint
ALTER TABLE `players` ADD `takes_rounding` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `bills` SET `split_version` = 1 WHERE `status` = 'published';
