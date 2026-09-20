<?php
declare(strict_types=1);

/**
 * 授权签名：RSA-2048 / PKCS#1 v1.5 / SHA-256。
 *
 * 客户端安装包里内置的是 .NET 的 <RSAKeyValue> XML 公钥，
 * 后台这边保存同一把私钥的 XML。这里负责：
 *   1) 解析 .NET XML 密钥
 *   2) 把它转成 OpenSSL 能用的 PEM（再用 openssl_sign 出标准 PKCS#1 v1.5 签名）
 *   3) 算密钥指纹（模数 SHA-256 前 16 位十六进制）——必须和安装包里的一致
 *   4) 生成授权票据 ticket
 *   5) 新生成一把密钥（只有后台还没配密钥时才用得上）
 */

final class SigningKey
{
    public string $n;      // 模数（大端，已去掉多余前导 0）
    public string $e;      // 公开指数
    public string $d;
    public ?string $p;
    public ?string $q;
    public ?string $dp;
    public ?string $dq;
    public ?string $iq;
    public string $kid;
    /** @var resource|\OpenSSLAsymmetricKey|null */
    private $privateKey = null;
    private string $pem = '';
    public string $signEngine = '';

    public function __construct(array $parts)
    {
        $this->n  = $parts['n'];
        $this->e  = $parts['e'];
        $this->d  = $parts['d'] ?? '';
        $this->p  = $parts['p'] ?? null;
        $this->q  = $parts['q'] ?? null;
        $this->dp = $parts['dp'] ?? null;
        $this->dq = $parts['dq'] ?? null;
        $this->iq = $parts['iq'] ?? null;
        $this->kid = key_fingerprint($this->n);
        $this->prepare();
    }

    public function isPrivate(): bool
    {
        return $this->d !== '' && $this->privateKey !== null;
    }

    public function keyBytes(): int
    {
        return strlen($this->n);
    }

    private function prepare(): void
    {
        if ($this->d === '') {
            return;
        }
        if (!extension_loaded('openssl')) {
            return;
        }
        if (!$this->hasCrtParams()) {
            $this->fillCrtParams();
        }
        if (!$this->hasCrtParams()) {
            return;
        }
        $pem = self::privatePemFromParts($this->n, $this->e, $this->d, $this->p, $this->q, $this->dp, $this->dq, $this->iq);
        $key = @openssl_pkey_get_private($pem);
        if ($key === false) {
            return;
        }
        $this->privateKey = $key;
        $this->pem = $pem;
        $this->signEngine = 'openssl';
    }

    private function hasCrtParams(): bool
    {
        return $this->p !== null && $this->q !== null && $this->dp !== null
            && $this->dq !== null && $this->iq !== null;
    }

    /** 只给了 p、q 时，把 d / dp / dq / iq 补齐（需要 gmp）。 */
    private function fillCrtParams(): void
    {
        if (!function_exists('gmp_init') || $this->p === null || $this->q === null) {
            return;
        }
        $p = gmp_init(bin2hex($this->p), 16);
        $q = gmp_init(bin2hex($this->q), 16);
        $e = gmp_init(bin2hex($this->e), 16);
        $phi = gmp_mul(gmp_sub($p, 1), gmp_sub($q, 1));
        if ($this->d === '') {
            $d = gmp_invert($e, $phi);
            if ($d === false) {
                return;
            }
            $this->d = self::gmpToBin($d);
        }
        $d = gmp_init(bin2hex($this->d), 16);
        $this->dp = self::gmpToBin(gmp_mod($d, gmp_sub($p, 1)));
        $this->dq = self::gmpToBin(gmp_mod($d, gmp_sub($q, 1)));
        $iq = gmp_invert(gmp_mod($q, $p), $p);
        if ($iq === false) {
            return;
        }
        $this->iq = self::gmpToBin($iq);
    }

    private static function gmpToBin($number): string
    {
        $hex = gmp_strval($number, 16);
        if (strlen($hex) % 2 === 1) {
            $hex = '0' . $hex;
        }
        return hex2bin($hex) ?: "\x00";
    }

    public function sign(string $message): string
    {
        if ($this->privateKey === null) {
            throw new RuntimeException('授权签名私钥不可用（缺少 P/Q/DP/DQ/InverseQ，或 PHP 没开 openssl 扩展）');
        }
        $signature = '';
        if (!openssl_sign($message, $signature, $this->privateKey, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('授权签名失败：' . (openssl_error_string() ?: '未知错误'));
        }
        return $signature;
    }

    /** 内置进安装包的公钥（和客户端里的格式一模一样）。 */
    public function publicXml(): string
    {
        return '<RSAKeyValue><Modulus>' . base64_encode($this->n) . '</Modulus><Exponent>'
            . base64_encode($this->e) . '</Exponent></RSAKeyValue>';
    }

    public static function privatePemFromParts(
        string $n,
        string $e,
        string $d,
        string $p,
        string $q,
        string $dp,
        string $dq,
        string $iq
    ): string {
        $body = der_int("\x00")
            . der_int($n) . der_int($e) . der_int($d)
            . der_int($p) . der_int($q) . der_int($dp) . der_int($dq) . der_int($iq);
        $der = der_tlv(0x30, $body);
        return "-----BEGIN RSA PRIVATE KEY-----\n"
            . chunk_split(base64_encode($der), 64, "\n")
            . "-----END RSA PRIVATE KEY-----\n";
    }
}

/* ---------------------------------------------------------------------
 * DER / PEM 基础
 * ------------------------------------------------------------------- */

function der_len(int $len): string
{
    if ($len < 0x80) {
        return chr($len);
    }
    $bytes = '';
    while ($len > 0) {
        $bytes = chr($len & 0xFF) . $bytes;
        $len >>= 8;
    }
    return chr(0x80 | strlen($bytes)) . $bytes;
}

function der_tlv(int $tag, string $body): string
{
    return chr($tag) . der_len(strlen($body)) . $body;
}

function der_int(string $bin): string
{
    $bin = ltrim($bin, "\x00");
    if ($bin === '') {
        $bin = "\x00";
    }
    if ((ord($bin[0]) & 0x80) !== 0) {
        $bin = "\x00" . $bin;
    }
    return der_tlv(0x02, $bin);
}

/* ---------------------------------------------------------------------
 * .NET XML 密钥
 * ------------------------------------------------------------------- */

function xml_b64_bin($value): string
{
    $text = preg_replace('/\s+/', '', (string)$value) ?? '';
    if ($text === '') {
        return '';
    }
    $raw = base64_decode($text, true);
    if ($raw === false) {
        return '';
    }
    return ltrim($raw, "\x00") ?: "\x00";
}

/**
 * 解析 .NET 的 <RSAKeyValue>。返回的是各参数的大端原始字节。
 * 没有 D 表示只有公钥。
 */
function parse_key_xml(string $xmlText): array
{
    $text = trim($xmlText);
    if ($text === '') {
        throw new RuntimeException('密钥是空的');
    }
    $previous = libxml_use_internal_errors(true);
    $doc = simplexml_load_string($text);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    if ($doc === false) {
        throw new RuntimeException('密钥不是合法的 XML');
    }
    $pick = static function (string $name) use ($doc): ?string {
        $node = $doc->{$name};
        if ($node === null) {
            return null;
        }
        $value = trim((string)$node);
        return $value === '' ? null : $value;
    };

    $parts = [];
    $map = [
        'n'  => 'Modulus',
        'e'  => 'Exponent',
        'd'  => 'D',
        'p'  => 'P',
        'q'  => 'Q',
        'dp' => 'DP',
        'dq' => 'DQ',
        'iq' => 'InverseQ',
    ];
    foreach ($map as $key => $node) {
        $raw = $pick($node);
        $parts[$key] = $raw === null ? null : xml_b64_bin($raw);
        if ($parts[$key] === '') {
            $parts[$key] = null;
        }
    }
    if ($parts['n'] === null || $parts['e'] === null) {
        throw new RuntimeException('密钥缺少 Modulus / Exponent');
    }
    if ($parts['d'] === null) {
        $parts['d'] = '';
    }
    return $parts;
}

/** 密钥指纹：模数字节的 SHA-256 前 16 位十六进制。客户端拿它对号。 */
function key_fingerprint(string $modulusBin): string
{
    return substr(hash('sha256', $modulusBin), 0, 16);
}

/** 现场新生成一把 2048 位私钥并导出成 .NET XML。 */
function generate_key_xml(int $bits = 2048): string
{
    if (!extension_loaded('openssl')) {
        throw new RuntimeException('PHP 没有 openssl 扩展，无法自动生成密钥');
    }
    $resource = openssl_pkey_new([
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
        'private_key_bits' => $bits,
    ]);
    if ($resource === false) {
        throw new RuntimeException('生成密钥失败：' . (openssl_error_string() ?: '未知错误'));
    }
    $details = openssl_pkey_get_details($resource);
    if (!is_array($details) || empty($details['rsa'])) {
        throw new RuntimeException('读取新密钥参数失败');
    }
    $rsa = $details['rsa'];
    $b64 = static fn(string $bin): string => base64_encode(ltrim($bin, "\x00") ?: "\x00");

    return '<RSAKeyValue>'
        . '<Modulus>' . $b64($rsa['n']) . '</Modulus>'
        . '<Exponent>' . $b64($rsa['e']) . '</Exponent>'
        . '<P>' . $b64($rsa['p']) . '</P>'
        . '<Q>' . $b64($rsa['q']) . '</Q>'
        . '<DP>' . $b64($rsa['dmp1']) . '</DP>'
        . '<DQ>' . $b64($rsa['dmq1']) . '</DQ>'
        . '<InverseQ>' . $b64($rsa['iqmp']) . '</InverseQ>'
        . '<D>' . $b64($rsa['d']) . '</D>'
        . '</RSAKeyValue>';
}

/* ---------------------------------------------------------------------
 * 授权票据
 * ------------------------------------------------------------------- */

const VM_TICKET_VERSION = 1;
const VM_TICKET_TTL_DEFAULT = 30;
const VM_UPDATE_SIGN_PREFIX = 'videomix-update-v1';

function b64url_encode(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function b64url_decode(string $text): string
{
    if ($text === '') {
        return '';
    }
    $padded = strtr($text, '-_', '+/');
    $padded .= str_repeat('=', (4 - strlen($padded) % 4) % 4);
    $raw = base64_decode($padded, true);
    return $raw === false ? '' : $raw;
}

/**
 * 构造授权票据：base64url(JSON).base64url(RSA 签名)
 * JSON 的字段顺序和原版一致（v, kid, code, device, iat, exp），
 * 客户端验证的是这段原始字节，顺序一致最稳妥。
 */
function build_ticket(SigningKey $key, string $code, string $deviceId, int $ttlDays): string
{
    $issued = time();
    $payload = json_encode([
        'v'      => VM_TICKET_VERSION,
        'kid'    => $key->kid,
        'code'   => $code,
        'device' => $deviceId,
        'iat'    => $issued,
        'exp'    => $issued + max(1, $ttlDays) * 86400,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        throw new RuntimeException('生成票据内容失败');
    }
    return b64url_encode($payload) . '.' . b64url_encode($key->sign($payload));
}

/** 更新包签名的原文：videomix-update-v1|版本号|sha256|字节数 */
function update_signature_message(string $version, string $sha256, int $size): string
{
    return VM_UPDATE_SIGN_PREFIX . '|' . $version . '|' . $sha256 . '|' . $size;
}

/** 文件 sha256 + 大小。 */
function file_sha256(string $path): array
{
    $digest = hash_file('sha256', $path);
    $size = filesize($path);
    return [$digest === false ? '' : $digest, $size === false ? 0 : (int)$size];
}
