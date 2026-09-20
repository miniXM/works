-- =====================================================================
-- VideoMix 授权中心 · MySQL / MariaDB 建表脚本
-- 适用：宝塔面板新建的 PHP 站点 + MySQL 5.7 / 8.0 / MariaDB 10.2+
-- 用法：在宝塔「数据库」里先建好库，再把这个文件导入进去；
--       或者直接访问站点的 /install.php，由安装向导自动建表。
-- 说明：所有时间字段统一存 ISO-8601 UTC 字符串（2026-09-20T01:23:45Z），
--       和客户端 / 前端约定的格式完全一致，不做时区转换。
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 账号：总账号（master, level 0）、一级代理（agent, level 1）、
--       二级代理（agent, level 2）。一二级代理共用同一张表，靠 parent_id 串起来。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`     VARCHAR(32)  NOT NULL,
  `display_name` VARCHAR(64)  NOT NULL DEFAULT '',
  `password`     VARCHAR(255) NOT NULL,
  `role`         VARCHAR(16)  NOT NULL DEFAULT 'agent',
  `level`        TINYINT      NOT NULL DEFAULT 1,
  `parent_id`    INT UNSIGNED NULL DEFAULT NULL,
  `status`       VARCHAR(16)  NOT NULL DEFAULT 'active',
  `note`         TEXT         NULL,
  `phone`        VARCHAR(32)  NOT NULL DEFAULT '',
  `created_at`   VARCHAR(32)  NOT NULL DEFAULT '',
  `created_by`   INT UNSIGNED NULL DEFAULT NULL,
  `last_login`   VARCHAR(32)  NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_users_username` (`username`),
  KEY `idx_users_parent` (`parent_id`),
  KEY `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 激活码批次
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `batches` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(128) NOT NULL,
  `days`        INT          NOT NULL DEFAULT 365,
  `max_devices` INT          NOT NULL DEFAULT 1,
  `quantity`    INT          NOT NULL DEFAULT 0,
  `note`        TEXT         NULL,
  `owner_id`    INT UNSIGNED NULL DEFAULT NULL,
  `created_at`  VARCHAR(32)  NOT NULL DEFAULT '',
  `created_by`  INT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_batches_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 激活码（由后台生成，存本表；客户端拿它来激活）
-- owner_id 为 NULL 表示在总账号名下
-- expires_at 为 NULL 表示「首次激活后才开始计时」
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `codes` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(64)  NOT NULL,
  `batch_id`    INT UNSIGNED NULL DEFAULT NULL,
  `owner_id`    INT UNSIGNED NULL DEFAULT NULL,
  `label`       VARCHAR(128) NOT NULL DEFAULT '',
  `note`        TEXT         NULL,
  `days`        INT          NOT NULL DEFAULT 0,
  `expires_at`  VARCHAR(32)  NULL DEFAULT NULL,
  `max_devices` INT          NOT NULL DEFAULT 1,
  `revoked`     TINYINT      NOT NULL DEFAULT 0,
  `revoked_at`  VARCHAR(32)  NULL DEFAULT NULL,
  `revoked_by`  INT UNSIGNED NULL DEFAULT NULL,
  `created_at`  VARCHAR(32)  NOT NULL DEFAULT '',
  `created_by`  INT UNSIGNED NULL DEFAULT NULL,
  `assigned_at` VARCHAR(32)  NULL DEFAULT NULL,
  `assigned_by` INT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_codes_code` (`code`),
  KEY `idx_codes_batch` (`batch_id`),
  KEY `idx_codes_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 设备绑定：一个激活码可绑多台设备，受 codes.max_devices 限制
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `devices` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_id`      INT UNSIGNED NOT NULL,
  `device_id`    VARCHAR(191) NOT NULL,
  `activated_at` VARCHAR(32)  NOT NULL DEFAULT '',
  `last_seen_at` VARCHAR(32)  NOT NULL DEFAULT '',
  `ip`           VARCHAR(64)  NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_devices` (`code_id`, `device_id`),
  KEY `idx_devices_code` (`code_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 操作日志
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `logs` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ts`         VARCHAR(32)  NOT NULL DEFAULT '',
  `actor_id`   INT UNSIGNED NULL DEFAULT NULL,
  `actor_name` VARCHAR(64)  NOT NULL DEFAULT '',
  `action`     VARCHAR(32)  NOT NULL DEFAULT '',
  `detail`     TEXT         NULL,
  `ip`         VARCHAR(64)  NOT NULL DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 登录会话（浏览器 Cookie 里的 vm_session 对应这里的 token）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `token`      VARCHAR(64)  NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `created_at` VARCHAR(32)  NOT NULL DEFAULT '',
  `expires_at` VARCHAR(32)  NOT NULL DEFAULT '',
  `ip`         VARCHAR(64)  NOT NULL DEFAULT '',
  PRIMARY KEY (`token`),
  KEY `idx_sessions_user` (`user_id`),
  KEY `idx_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 系统设置（签名私钥、客户端授权地址、更新包信息等）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `key`   VARCHAR(64) NOT NULL,
  `value` TEXT        NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 客户端来拉「授权服务器地址」时的统计
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `config_hits` (
  `ip`      VARCHAR(64)  NOT NULL,
  `count`   INT          NOT NULL DEFAULT 0,
  `last_at` VARCHAR(32)  NOT NULL DEFAULT '',
  `current` VARCHAR(191) NOT NULL DEFAULT '',
  PRIMARY KEY (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ---------------------------------------------------------------------
-- 客户端上报的版本号（在线升级用）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `client_versions` (
  `device`   VARCHAR(191) NOT NULL,
  `version`  VARCHAR(40)  NOT NULL DEFAULT '',
  `ip`       VARCHAR(64)  NOT NULL DEFAULT '',
  `first_at` VARCHAR(32)  NOT NULL DEFAULT '',
  `last_at`  VARCHAR(32)  NOT NULL DEFAULT '',
  PRIMARY KEY (`device`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- 默认设置项
-- ---------------------------------------------------------------------
INSERT INTO `settings` (`key`, `value`) VALUES ('client_update_enabled', '0')
  ON DUPLICATE KEY UPDATE `value` = `value`;
INSERT INTO `settings` (`key`, `value`) VALUES ('client_update_size', '0')
  ON DUPLICATE KEY UPDATE `value` = `value`;
INSERT INTO `settings` (`key`, `value`) VALUES ('client_update_downloads', '0')
  ON DUPLICATE KEY UPDATE `value` = `value`;
INSERT INTO `settings` (`key`, `value`) VALUES ('client_server_version', '0')
  ON DUPLICATE KEY UPDATE `value` = `value`;

-- ---------------------------------------------------------------------
-- 默认总账号：admin / admin123   （登录后请立刻在「设置 → 修改密码」里改掉）
-- 如果你是用 /install.php 安装的，安装向导会按你填的账号密码重新写入，
-- 下面这行可以不管。
-- ---------------------------------------------------------------------
INSERT INTO `users` (`username`, `display_name`, `password`, `role`, `level`, `parent_id`, `status`, `note`, `phone`, `created_at`, `created_by`, `last_login`)
SELECT 'admin', '总账号', '$2y$10$3yGNEsq/SHwR/9Yu.FeysObiLGiVHAWk368emmHi/pglZpzDbwzx2', 'master', 0, NULL, 'active', '', '', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ'), NULL, NULL
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `users` WHERE `role` = 'master');
