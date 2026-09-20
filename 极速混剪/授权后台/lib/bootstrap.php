<?php
declare(strict_types=1);

/**
 * 统一入口的公共引导：
 *   - 固定用 UTC，保证时间和客户端一致
 *   - 载入各个类库
 *   - 读取 config.php（数据库连接、私钥、更新包目录）
 */

date_default_timezone_set('UTC');
if (function_exists('mb_internal_encoding')) {
    mb_internal_encoding('UTF-8');
}

define('VM_ROOT', dirname(__DIR__));
define('VM_CONFIG_FILE', VM_ROOT . '/config.php');
define('VM_DEFAULT_UPDATES_DIR', VM_ROOT . '/data/updates');
define('VM_DEFAULT_BACKUPS_DIR', VM_ROOT . '/data/backups');

require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Backup.php';
require_once __DIR__ . '/Crypto.php';
require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Store.php';
require_once __DIR__ . '/License.php';

function vm_has_config(): bool
{
    return is_file(VM_CONFIG_FILE);
}

/** 读取 config.php；没有就返回 null。 */
function vm_config(): ?array
{
    if (!vm_has_config()) {
        return null;
    }
    $config = require VM_CONFIG_FILE;
    return is_array($config) ? $config : [];
}

/** 连上数据库并返回 Store。 */
function vm_bootstrap(): Store
{
    $config = vm_config();
    if ($config === null) {
        throw new RuntimeException('还没有配置文件 config.php，请先访问 /install.php 完成安装');
    }
    $db = new Db($config['db'] ?? []);
    $updatesDir = trim((string)($config['updates_dir'] ?? ''));
    if ($updatesDir === '') {
        $updatesDir = VM_DEFAULT_UPDATES_DIR;
    }
    if (!is_dir($updatesDir)) {
        @mkdir($updatesDir, 0755, true);
    }
    $backupsDir = trim((string)($config['backups_dir'] ?? ''));
    if ($backupsDir === '') {
        $backupsDir = VM_DEFAULT_BACKUPS_DIR;
    }
    if (!is_dir($backupsDir)) {
        @mkdir($backupsDir, 0755, true);
    }
    return new Store($db, $updatesDir, $backupsDir);
}

/** 站点根地址（install.php 里提示用）。 */
function vm_base_url(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
    return ($https ? 'https://' : 'http://') . $host;
}
