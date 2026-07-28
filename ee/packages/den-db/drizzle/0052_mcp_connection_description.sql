-- 已有 FoxWork 数据库可能已经包含连接说明字段，重复升级时不得再次添加。
SET @foxwork_has_mcp_description := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'external_mcp_connection'
    AND column_name = 'description'
);
--> statement-breakpoint
SET @foxwork_add_mcp_description_sql := IF(
  @foxwork_has_mcp_description = 0,
  'ALTER TABLE `external_mcp_connection` ADD `description` varchar(1000)',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_add_mcp_description_stmt FROM @foxwork_add_mcp_description_sql;
--> statement-breakpoint
EXECUTE foxwork_add_mcp_description_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_add_mcp_description_stmt;
