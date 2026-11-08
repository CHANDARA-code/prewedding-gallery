ALTER TABLE `photos` ADD `preview_filename` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `original_name` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `rotation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `exif` text;