CREATE TABLE `outdoor_readings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serial` varchar(32) NOT NULL,
	`measured_at` datetime NOT NULL,
	`aqi` smallint,
	`aqi_name` varchar(64),
	`pm25` double,
	`pm10` double,
	`no2` double,
	CONSTRAINT `outdoor_readings_id` PRIMARY KEY(`id`),
	CONSTRAINT `outdoor_readings_by_time` UNIQUE(`serial`,`measured_at`)
);
