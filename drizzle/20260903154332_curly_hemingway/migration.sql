ALTER TABLE `participants` RENAME TO `bill_players`;--> statement-breakpoint
ALTER TABLE `customers` RENAME TO `players`;--> statement-breakpoint
ALTER TABLE `adjustment_allocations` RENAME COLUMN `participant_id` TO `bill_player_id`;--> statement-breakpoint
ALTER TABLE `bill_players` RENAME COLUMN `customer_id` TO `player_id`;--> statement-breakpoint
ALTER TABLE `item_allocations` RENAME COLUMN `participant_id` TO `bill_player_id`;--> statement-breakpoint
ALTER TABLE `payment_events` RENAME COLUMN `participant_id` TO `bill_player_id`;--> statement-breakpoint
ALTER TABLE `payment_statuses` RENAME COLUMN `participant_id` TO `bill_player_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `adjustment_allocations_adj_participant_uq`;--> statement-breakpoint
DROP INDEX IF EXISTS `participants_bill_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `participants_customer_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `item_allocations_item_participant_uq`;--> statement-breakpoint
DROP INDEX IF EXISTS `payment_events_participant_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `customers_name_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_allocations_adj_bill_player_uq` ON `adjustment_allocations` (`adjustment_id`,`bill_player_id`);--> statement-breakpoint
CREATE INDEX `bill_players_bill_idx` ON `bill_players` (`bill_id`);--> statement-breakpoint
CREATE INDEX `bill_players_player_idx` ON `bill_players` (`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `item_allocations_item_bill_player_uq` ON `item_allocations` (`item_id`,`bill_player_id`);--> statement-breakpoint
CREATE INDEX `payment_events_bill_player_idx` ON `payment_events` (`bill_player_id`);--> statement-breakpoint
CREATE INDEX `players_name_idx` ON `players` (`name`);