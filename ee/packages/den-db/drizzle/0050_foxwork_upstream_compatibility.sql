-- 兼容已经执行 FoxWork 0.18.0 旧编号迁移的数据库，并补齐 OpenWork 0.18.3 结构。
-- 旧公司 Skill 表只改名为升级备份；待确认新插件数据完整后再由独立受控流程清理。
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'skill_hub_member'
  ) > 0
  AND (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'foxwork_legacy_skill_hub_member'
  ) = 0,
  'RENAME TABLE `skill_hub_member` TO `foxwork_legacy_skill_hub_member`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'skill_hub_skill'
  ) > 0
  AND (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'foxwork_legacy_skill_hub_skill'
  ) = 0,
  'RENAME TABLE `skill_hub_skill` TO `foxwork_legacy_skill_hub_skill`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'skill_hub'
  ) > 0
  AND (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'foxwork_legacy_skill_hub'
  ) = 0,
  'RENAME TABLE `skill_hub` TO `foxwork_legacy_skill_hub`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'skill'
  ) > 0
  AND (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'foxwork_legacy_skill'
  ) = 0,
  'RENAME TABLE `skill` TO `foxwork_legacy_skill`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'oauthAccessToken'
      AND index_name = 'oauth_access_token_token'
  ) = 0,
  'CREATE INDEX `oauth_access_token_token` ON `oauthAccessToken` (`token`(191))',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'desktop_policy_member'
      AND index_name = 'desktop_policy_member_policy_id'
  ) > 0,
  'DROP INDEX `desktop_policy_member_policy_id` ON `desktop_policy_member`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'desktop_policy'
      AND index_name = 'desktop_policy_organization_id'
  ) > 0,
  'DROP INDEX `desktop_policy_organization_id` ON `desktop_policy`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inference_org_limit_policies'
      AND index_name = 'inference_org_limit_policies_organization_id'
  ) > 0,
  'DROP INDEX `inference_org_limit_policies_organization_id` ON `inference_org_limit_policies`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inference_org_upstream_provider_keys'
      AND index_name = 'inference_org_upstream_provider_keys_organization_id'
  ) > 0,
  'DROP INDEX `inference_org_upstream_provider_keys_organization_id` ON `inference_org_upstream_provider_keys`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inference_org_usage_buckets'
      AND index_name = 'inference_org_usage_buckets_policy_id'
  ) > 0,
  'DROP INDEX `inference_org_usage_buckets_policy_id` ON `inference_org_usage_buckets`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'member'
      AND index_name = 'member_organization_id'
  ) > 0,
  'DROP INDEX `member_organization_id` ON `member`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'organization_brand_asset'
      AND index_name = 'organization_brand_asset_organization_id'
  ) > 0,
  'DROP INDEX `organization_brand_asset_organization_id` ON `organization_brand_asset`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'organization_role'
      AND index_name = 'organization_role_organization_id'
  ) > 0,
  'DROP INDEX `organization_role_organization_id` ON `organization_role`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'scim_group'
      AND index_name = 'scim_group_provider_id'
  ) > 0,
  'DROP INDEX `scim_group_provider_id` ON `scim_group`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connected_account'
      AND index_name = 'connected_account_org_membership_id'
  ) > 0,
  'DROP INDEX `connected_account_org_membership_id` ON `connected_account`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'org_oauth_client'
      AND index_name = 'org_oauth_client_organization_id'
  ) > 0,
  'DROP INDEX `org_oauth_client_organization_id` ON `org_oauth_client`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'plugin_mcp_requirement_binding'
      AND index_name = 'plugin_mcp_req_binding_organization_id'
  ) > 0,
  'DROP INDEX `plugin_mcp_req_binding_organization_id` ON `plugin_mcp_requirement_binding`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'llm_provider_access'
      AND index_name = 'llm_provider_access_llm_provider_id'
  ) > 0,
  'DROP INDEX `llm_provider_access_llm_provider_id` ON `llm_provider_access`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'llm_provider_model'
      AND index_name = 'llm_provider_model_llm_provider_id'
  ) > 0,
  'DROP INDEX `llm_provider_model_llm_provider_id` ON `llm_provider_model`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'config_object_access_grant'
      AND index_name = 'config_object_access_grant_config_object_id'
  ) > 0,
  'DROP INDEX `config_object_access_grant_config_object_id` ON `config_object_access_grant`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'config_object_version'
      AND index_name = 'config_object_version_config_object_id'
  ) > 0,
  'DROP INDEX `config_object_version_config_object_id` ON `config_object_version`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connector_account'
      AND index_name = 'connector_account_organization_id'
  ) > 0,
  'DROP INDEX `connector_account_organization_id` ON `connector_account`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connector_instance_access_grant'
      AND index_name = 'connector_instance_access_grant_instance_id'
  ) > 0,
  'DROP INDEX `connector_instance_access_grant_instance_id` ON `connector_instance_access_grant`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connector_instance'
      AND index_name = 'connector_instance_organization_id'
  ) > 0,
  'DROP INDEX `connector_instance_organization_id` ON `connector_instance`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connector_mapping'
      AND index_name = 'connector_mapping_connector_target_id'
  ) > 0,
  'DROP INDEX `connector_mapping_connector_target_id` ON `connector_mapping`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connector_source_binding'
      AND index_name = 'connector_source_binding_config_object_id'
  ) > 0,
  'DROP INDEX `connector_source_binding_config_object_id` ON `connector_source_binding`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connector_target'
      AND index_name = 'connector_target_connector_instance_id'
  ) > 0,
  'DROP INDEX `connector_target_connector_instance_id` ON `connector_target`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'marketplace_access_grant'
      AND index_name = 'marketplace_access_grant_marketplace_id'
  ) > 0,
  'DROP INDEX `marketplace_access_grant_marketplace_id` ON `marketplace_access_grant`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'marketplace_plugin'
      AND index_name = 'marketplace_plugin_marketplace_id'
  ) > 0,
  'DROP INDEX `marketplace_plugin_marketplace_id` ON `marketplace_plugin`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'plugin_access_grant'
      AND index_name = 'plugin_access_grant_plugin_id'
  ) > 0,
  'DROP INDEX `plugin_access_grant_plugin_id` ON `plugin_access_grant`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'plugin_config_object'
      AND index_name = 'plugin_config_object_plugin_id'
  ) > 0,
  'DROP INDEX `plugin_config_object_plugin_id` ON `plugin_config_object`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'org_subscriptions'
      AND index_name = 'org_subscriptions_organization_id'
  ) > 0,
  'DROP INDEX `org_subscriptions_organization_id` ON `org_subscriptions`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'team_member'
      AND index_name = 'team_member_team_id'
  ) > 0,
  'DROP INDEX `team_member_team_id` ON `team_member`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'team'
      AND index_name = 'team_organization_id'
  ) > 0,
  'DROP INDEX `team_organization_id` ON `team`',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'connector_account'
      AND index_name = 'idx_connector_account_on_remote_id'
  ) = 0,
  'CREATE INDEX `idx_connector_account_on_remote_id` ON `connector_account` (`remote_id`)',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'config_object_version'
      AND column_name = 'normalized_payload_json'
      AND data_type <> 'mediumtext'
  ) > 0,
  'ALTER TABLE `config_object_version` MODIFY COLUMN `normalized_payload_json` mediumtext',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'config_object_version'
      AND column_name = 'raw_source_text'
      AND data_type <> 'mediumtext'
  ) > 0,
  'ALTER TABLE `config_object_version` MODIFY COLUMN `raw_source_text` mediumtext',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
--> statement-breakpoint
SET @foxwork_compat_sql := IF(
  (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'desktop_policy_member'
      AND column_name = 'role'
  ) = 0,
  'ALTER TABLE `desktop_policy_member` ADD `role` varchar(64)',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_compat_stmt FROM @foxwork_compat_sql;
--> statement-breakpoint
EXECUTE foxwork_compat_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_compat_stmt;
