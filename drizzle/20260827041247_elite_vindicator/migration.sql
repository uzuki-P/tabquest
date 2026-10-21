CREATE TABLE `adjustment_allocations` (
	`id` text PRIMARY KEY,
	`adjustment_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`signed_amount` integer NOT NULL,
	CONSTRAINT `fk_adjustment_allocations_adjustment_id_adjustments_id_fk` FOREIGN KEY (`adjustment_id`) REFERENCES `adjustments`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_adjustment_allocations_participant_id_participants_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `adjustments` (
	`id` text PRIMARY KEY,
	`bill_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`signed_amount` integer NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT `fk_adjustments_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY,
	`public_id` text NOT NULL,
	`merchant` text NOT NULL,
	`title` text,
	`order_date` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`source_subtotal` integer NOT NULL,
	`final_total` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`image_object_key` text,
	`image_media_type` text,
	`image_byte_size` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE TABLE `item_allocations` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	CONSTRAINT `fk_item_allocations_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_item_allocations_participant_id_participants_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY,
	`bill_id` text NOT NULL,
	`name` text NOT NULL,
	`variant_notes` text,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`line_total` integer NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT `fk_items_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY,
	`bill_id` text NOT NULL,
	`alias` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT `fk_participants_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY,
	`participant_id` text NOT NULL,
	`previous_state` text NOT NULL,
	`new_state` text NOT NULL,
	`actor_identity` text NOT NULL,
	`event_time` text NOT NULL,
	CONSTRAINT `fk_payment_events_participant_id_participants_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `payment_statuses` (
	`participant_id` text PRIMARY KEY,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`paid_at` text,
	`last_changed_by` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_payment_statuses_participant_id_participants_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_allocations_adj_participant_uq` ON `adjustment_allocations` (`adjustment_id`,`participant_id`);--> statement-breakpoint
CREATE INDEX `adjustments_bill_idx` ON `adjustments` (`bill_id`);--> statement-breakpoint
CREATE INDEX `bills_order_date_idx` ON `bills` (`order_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `bills_public_id_uq` ON `bills` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `item_allocations_item_participant_uq` ON `item_allocations` (`item_id`,`participant_id`);--> statement-breakpoint
CREATE INDEX `item_allocations_item_idx` ON `item_allocations` (`item_id`);--> statement-breakpoint
CREATE INDEX `items_bill_idx` ON `items` (`bill_id`);--> statement-breakpoint
CREATE INDEX `participants_bill_idx` ON `participants` (`bill_id`);--> statement-breakpoint
CREATE INDEX `payment_events_participant_idx` ON `payment_events` (`participant_id`);