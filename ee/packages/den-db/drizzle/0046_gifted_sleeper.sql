ALTER TABLE `skill_hub` ADD `managed_key` varchar(255);--> statement-breakpoint
ALTER TABLE `skill` ADD `slug` varchar(64);--> statement-breakpoint
ALTER TABLE `skill` ADD `source_key` varchar(255);--> statement-breakpoint
ALTER TABLE `skill` ADD `bundle_hash` varchar(64);--> statement-breakpoint
ALTER TABLE `skill` ADD `bundle_files_json` mediumtext;--> statement-breakpoint
ALTER TABLE `skill_hub` ADD CONSTRAINT `skill_hub_organization_managed_key` UNIQUE(`organization_id`,`managed_key`);--> statement-breakpoint
ALTER TABLE `skill` ADD CONSTRAINT `skill_organization_source_key` UNIQUE(`organization_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `skill_slug` ON `skill` (`slug`);