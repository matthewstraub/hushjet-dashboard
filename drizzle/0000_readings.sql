CREATE TABLE `readings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taken_at` datetime(3) NOT NULL,
	`serial` varchar(32) NOT NULL,
	`source` varchar(16) NOT NULL,
	`power` boolean,
	`fan_speed` smallint,
	`auto_mode` boolean,
	`night_mode` boolean,
	`monitoring` boolean,
	`fan_state` varchar(16),
	`hepa_filter_pct` smallint,
	`carbon_filter_pct` smallint,
	`pm25` smallint,
	`pm10` smallint,
	`sensor_status` varchar(8),
	`state` json NOT NULL,
	`sensor` json NOT NULL,
	CONSTRAINT `readings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `readings_by_time` ON `readings` (`serial`,`taken_at`);