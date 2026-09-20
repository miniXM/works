<?php
declare(strict_types=1);

/**
 * 通用工具：时间格式、激活码、密码、状态判定。
 * 所有时间统一按 UTC 的 ISO-8601 字符串存取（2026-09-20T01:23:45Z），
 * 和客户端、网页前端约定的格式保持完全一致。
 */

const VM_CODE_ALPHABET  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VM_CODE_GROUPS    = 4;
const VM_CODE_GROUP_LEN = 5;

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

/** 把库里的 ISO 字符串转成 Unix 秒；解析不出来返回 null。 */
function parse_iso($value): ?int
{
    if ($value === null) {
        return null;
    }
    $text = trim((string)$value);
    if ($text === '') {
        return null;
    }
    $stamp = strtotime($text);
    return $stamp === false ? null : $stamp;
}

/** 在某个 ISO 时间上加若干天，仍返回 ISO 字符串。 */
function iso_plus_days(int $days, ?int $from = null): string
{
    $base = $from ?? time();
    return gmdate('Y-m-d\TH:i:s\Z', $base + $days * 86400);
}

/** 激活码归一化：去掉所有非字母数字并转大写。 */
function clean_code($value): string
{
    return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$value) ?? '');
}

/** 生成一个新的激活码，形如 ED5DB-K73BT-WXQN6-MZX6D。 */
function generate_code(): string
{
    $groups = [];
    $max = strlen(VM_CODE_ALPHABET) - 1;
    for ($g = 0; $g < VM_CODE_GROUPS; $g++) {
        $part = '';
        for ($i = 0; $i < VM_CODE_GROUP_LEN; $i++) {
            $part .= VM_CODE_ALPHABET[random_int(0, $max)];
        }
        $groups[] = $part;
    }
    return implode('-', $groups);
}

/**
 * 口令散列。新数据统一用 PHP 自带的 bcrypt；
 * 老后台（Python 版）导过来的 pbkdf2_sha256$... 也能继续验证通过。
 */
function hash_password(string $password): string
{
    return password_hash($password, PASSWORD_BCRYPT);
}

function verify_password(string $password, $stored): bool
{
    $stored = (string)$stored;
    if ($stored === '') {
        return false;
    }
    if (strncmp($stored, 'pbkdf2_sha256$', 14) === 0) {
        $parts = explode('$', $stored, 4);
        if (count($parts) !== 4 || $parts[0] !== 'pbkdf2_sha256') {
            return false;
        }
        $rounds = (int)$parts[1];
        if ($rounds < 1) {
            return false;
        }
        $digest = base64_encode(hash_pbkdf2('sha256', $password, $parts[2], $rounds, 32, true));
        return hash_equals($stored, 'pbkdf2_sha256$' . $rounds . '$' . $parts[2] . '$' . $digest);
    }
    return password_verify($password, $stored);
}

/** 激活码状态：revoked / expired / unused / bound / active */
function code_state(array $row, int $deviceCount): string
{
    if (!empty($row['revoked'])) {
        return 'revoked';
    }
    $expiry = parse_iso($row['expires_at'] ?? null);
    if ($expiry !== null && $expiry <= time()) {
        return 'expired';
    }
    if ($deviceCount <= 0) {
        return 'unused';
    }
    if ($deviceCount >= (int)$row['max_devices']) {
        return 'bound';
    }
    return 'active';
}

/** 把 1.2.3 这样的版本号转成可比较的数字数组。 */
function parse_version($text): array
{
    $parts = [];
    foreach (explode('.', trim((string)$text)) as $chunk) {
        if (preg_match('/^(\d+)/', trim($chunk), $m)) {
            $parts[] = (int)$m[1];
        } else {
            $parts[] = 0;
        }
    }
    while (count($parts) > 0 && end($parts) === 0) {
        array_pop($parts);
    }
    return $parts;
}

function version_is_newer($latest, $current): bool
{
    $a = parse_version($latest);
    $b = parse_version($current);
    $n = max(count($a), count($b));
    for ($i = 0; $i < $n; $i++) {
        $x = $a[$i] ?? 0;
        $y = $b[$i] ?? 0;
        if ($x !== $y) {
            return $x > $y;
        }
    }
    return false;
}

/** 只保留 http(s)://主机[:端口]，不要路径。 */
function clean_server_url($value): string
{
    $text = rtrim(trim((string)$value), '/');
    if ($text === '') {
        return '';
    }
    if (!preg_match('#^https?://[^\s/]+(:\d+)?$#', $text)) {
        throw new ApiError(400, '地址格式应为 http://主机 或 http://主机:端口（不要带路径）');
    }
    return $text;
}

/** 统一 JSON 输出格式：不转义中文，不转义斜杠。 */
function json_encode_cn($value): string
{
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $json === false ? '{}' : $json;
}

/** 客户端接口的成功应答（和原版 Windows 服务端逐字段一致）。 */
function client_success($data = null, string $message = '操作成功'): array
{
    $payload = ['success' => true, 'status' => 200, 'code' => 0, 'object' => 'SC', 'message' => $message];
    if ($data !== null) {
        $payload['data'] = $data;
    }
    return $payload;
}

/** 客户端接口的失败应答。 */
function client_failure(string $codeName, string $message): array
{
    return ['success' => false, 'status' => 200, 'code' => 1, 'object' => $codeName, 'message' => $message];
}

class ApiError extends RuntimeException
{
    public int $status;

    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}
