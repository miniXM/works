<?php
declare(strict_types=1);

/**
 * 业务数据访问：设置项、日志、账号、签名密钥。
 */
final class Store
{
    public Db $db;
    /** 更新包存放目录（绝对路径） */
    public string $updatesDir;
    /** 数据库备份存放目录（绝对路径） */
    public string $backupDir;
    private ?SigningKey $keyCache = null;
    private bool $keyLoaded = false;

    public function __construct(Db $db, string $updatesDir, string $backupDir = '')
    {
        $this->db = $db;
        $this->updatesDir = $updatesDir;
        if (!is_dir($this->updatesDir)) {
            @mkdir($this->updatesDir, 0755, true);
        }
        $this->backupDir = $backupDir !== '' ? $backupDir : (defined('VM_DEFAULT_BACKUPS_DIR') ? VM_DEFAULT_BACKUPS_DIR : $updatesDir . '/../backups');
        if (!is_dir($this->backupDir)) {
            @mkdir($this->backupDir, 0755, true);
        }
    }

    /* ---------------------------------------------------------------
     * 设置项
     * ------------------------------------------------------------- */

    public function setting(string $key, string $default = ''): string
    {
        $row = $this->db->one('SELECT `value` FROM `settings` WHERE `key` = ?', [$key]);
        if (!$row) {
            return $default;
        }
        return (string)($row['value'] ?? '');
    }

    public function setSetting(string $key, string $value): void
    {
        $this->db->exec(
            'INSERT INTO `settings` (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
            [$key, $value]
        );
    }

    /* ---------------------------------------------------------------
     * 日志
     * ------------------------------------------------------------- */

    public function log(?array $actor, string $action, string $detail, string $ip = ''): void
    {
        $this->db->exec(
            'INSERT INTO `logs` (`ts`, `actor_id`, `actor_name`, `action`, `detail`, `ip`) VALUES (?,?,?,?,?,?)',
            [
                now_iso(),
                $actor ? (int)$actor['id'] : null,
                $actor ? (string)$actor['username'] : 'system',
                $action,
                $detail,
                $ip,
            ]
        );
    }

    /* ---------------------------------------------------------------
     * 账号
     * ------------------------------------------------------------- */

    public function userByName(string $username): ?array
    {
        return $this->db->one('SELECT * FROM `users` WHERE `username` = ?', [$username]);
    }

    public function userById(int $id): ?array
    {
        return $this->db->one('SELECT * FROM `users` WHERE `id` = ?', [$id]);
    }

    public function createUser(
        string $username,
        string $password,
        string $displayName,
        string $role,
        int $level,
        ?int $parentId,
        string $note,
        string $phone,
        ?int $actorId
    ): int {
        return $this->db->insert(
            'INSERT INTO `users` (`username`, `display_name`, `password`, `role`, `level`, `parent_id`,'
            . ' `note`, `phone`, `created_at`, `created_by`) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [$username, $displayName, hash_password($password), $role, $level, $parentId, $note, $phone, now_iso(), $actorId]
        );
    }

    /** 该账号名下的全部下级 id（含多级）。 */
    public function descendants(int $userId): array
    {
        $result = [];
        $frontier = [$userId];
        while ($frontier) {
            $placeholders = implode(',', array_fill(0, count($frontier), '?'));
            $rows = $this->db->query(
                'SELECT `id` FROM `users` WHERE `parent_id` IN (' . $placeholders . ')',
                $frontier
            );
            $frontier = array_map(static fn(array $r): int => (int)$r['id'], $rows);
            foreach ($frontier as $id) {
                $result[] = $id;
            }
        }
        return $result;
    }

    /** 当前账号可见的归属 id 集合（总账号 = 全部）。 */
    public function visibleUserIds(array $user): array
    {
        if (($user['role'] ?? '') === 'master') {
            $rows = $this->db->query('SELECT `id` FROM `users`');
            return array_map(static fn(array $r): int => (int)$r['id'], $rows);
        }
        return array_merge([(int)$user['id']], $this->descendants((int)$user['id']));
    }

    /* ---------------------------------------------------------------
     * 签名密钥
     * ------------------------------------------------------------- */

    public function signingKey(bool $generate = true): ?SigningKey
    {
        if ($this->keyLoaded) {
            return $this->keyCache;
        }
        $xml = $this->setting('signing_key_xml', '');
        if ($xml === '') {
            if (!$generate) {
                $this->keyLoaded = true;
                $this->keyCache = null;
                return null;
            }
            $xml = generate_key_xml(2048);
            $this->setSetting('signing_key_xml', $xml);
            $this->setSetting('signing_key_updated_at', now_iso());
            $parts = parse_key_xml($xml);
            $this->log(null, 'signing_key', '首次启动自动生成授权签名密钥（指纹 ' . key_fingerprint($parts['n']) . '）');
        }
        $parts = parse_key_xml($xml);
        if (($parts['d'] ?? '') === '') {
            throw new RuntimeException('设置里的签名密钥只有公钥，无法签名');
        }
        $key = new SigningKey($parts);
        if (!$key->isPrivate()) {
            throw new RuntimeException('签名私钥无法载入（请检查密钥 XML 是否带 P/Q/DP/DQ/InverseQ，以及服务器 PHP 是否开了 openssl 扩展）');
        }
        $this->keyCache = $key;
        $this->keyLoaded = true;
        return $key;
    }

    public function forgetSigningKey(): void
    {
        $this->keyCache = null;
        $this->keyLoaded = false;
    }

    public function ticketTtlDays(): int
    {
        $value = (int)($this->setting('ticket_ttl_days', (string)VM_TICKET_TTL_DEFAULT) ?: VM_TICKET_TTL_DEFAULT);
        if ($value < 1) {
            $value = 1;
        }
        if ($value > 3650) {
            $value = 3650;
        }
        return $value;
    }

    /* ---------------------------------------------------------------
     * 安装
     * ------------------------------------------------------------- */

    /** 逐句执行 SQL 文件（去掉 -- 注释，按分号切开）。 */
    public static function runSqlFile(PDO $pdo, string $path): void
    {
        if (!is_file($path)) {
            throw new RuntimeException('找不到建表脚本：' . $path);
        }
        $sql = (string)file_get_contents($path);
        $lines = preg_split('/\r\n|\n|\r/', $sql) ?: [];
        $clean = [];
        foreach ($lines as $line) {
            $trimmed = ltrim($line);
            if (strncmp($trimmed, '--', 2) === 0) {
                continue;
            }
            $clean[] = $line;
        }
        $statements = preg_split('/;\s*(?:\r\n|\n|\r|$)/', implode("\n", $clean)) ?: [];
        foreach ($statements as $statement) {
            $statement = trim($statement);
            if ($statement === '') {
                continue;
            }
            $pdo->exec($statement);
        }
    }
}
