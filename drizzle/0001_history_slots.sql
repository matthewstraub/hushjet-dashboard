CREATE TABLE `history_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serial` varchar(32) NOT NULL,
	`slot_start` datetime NOT NULL,
	`pm25` double,
	`pm10` double,
	`aqi` double,
	`fan_speed` double,
	`run_seconds` smallint,
	CONSTRAINT `history_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `history_slots_by_time` UNIQUE(`serial`,`slot_start`)
);
