CREATE TABLE `notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` varchar(16) NOT NULL,
	`starts_at` datetime NOT NULL,
	`ends_at` datetime,
	`details` varchar(1000) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `notes_by_time` ON `notes` (`starts_at`);