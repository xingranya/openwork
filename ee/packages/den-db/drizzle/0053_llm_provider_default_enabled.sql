-- 默认关闭可保持升级前“仅显式授权成员可用”的访问语义。
SET @foxwork_has_llm_default_enabled := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'llm_provider'
    AND column_name = 'default_enabled'
);
--> statement-breakpoint
SET @foxwork_add_llm_default_enabled_sql := IF(
  @foxwork_has_llm_default_enabled = 0,
  'ALTER TABLE `llm_provider` ADD `default_enabled` boolean DEFAULT false NOT NULL',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_add_llm_default_enabled_stmt FROM @foxwork_add_llm_default_enabled_sql;
--> statement-breakpoint
EXECUTE foxwork_add_llm_default_enabled_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_add_llm_default_enabled_stmt;
