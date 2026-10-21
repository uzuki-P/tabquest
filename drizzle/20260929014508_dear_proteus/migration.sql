CREATE TABLE `player_hover_summaries` (
	`player_id` text PRIMARY KEY,
	`rank` integer NOT NULL,
	`total_spend` integer NOT NULL,
	`total_tips` integer NOT NULL,
	`order_count` integer NOT NULL,
	`badges_json` text NOT NULL,
	CONSTRAINT `fk_player_hover_summaries_player_id_players_id_fk` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON DELETE CASCADE
);
