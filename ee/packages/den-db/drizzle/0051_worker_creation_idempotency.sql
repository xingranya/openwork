-- 已有 FoxWork 数据库可能已经执行旧编号迁移，因此每一步都按实际结构幂等补齐。
SET @foxwork_has_worker_idempotency_key := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'worker'
    AND column_name = 'idempotency_key'
);
--> statement-breakpoint
SET @foxwork_add_worker_idempotency_key_sql := IF(
  @foxwork_has_worker_idempotency_key = 0,
  'ALTER TABLE `worker` ADD `idempotency_key` varchar(128)',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_add_worker_idempotency_key_stmt FROM @foxwork_add_worker_idempotency_key_sql;
--> statement-breakpoint
EXECUTE foxwork_add_worker_idempotency_key_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_add_worker_idempotency_key_stmt;
--> statement-breakpoint
SET @foxwork_has_worker_idempotency_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'worker'
    AND index_name = 'worker_org_user_idempotency_key'
);
--> statement-breakpoint
SET @foxwork_add_worker_idempotency_index_sql := IF(
  @foxwork_has_worker_idempotency_index = 0,
  'ALTER TABLE `worker` ADD CONSTRAINT `worker_org_user_idempotency_key` UNIQUE(`org_id`,`created_by_user_id`,`idempotency_key`)',
  'SELECT 1'
);
--> statement-breakpoint
PREPARE foxwork_add_worker_idempotency_index_stmt FROM @foxwork_add_worker_idempotency_index_sql;
--> statement-breakpoint
EXECUTE foxwork_add_worker_idempotency_index_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE foxwork_add_worker_idempotency_index_stmt;
