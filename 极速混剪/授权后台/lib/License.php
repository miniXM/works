<?php
declare(strict_types=1);

/**
 * 全部接口实现。
 *
 * 客户端接口（安装包里的服务器代理调用）
 *   GET  /health
 *   POST /rpc/authActivateCode   {activateCode, deviceId, category}
 *   POST /rpc/judgeActivateCode  {activateCode, deviceId, category}
 *   GET  /api/client-config      客户端拉取最新的授权服务器地址
 *   GET  /api/client-version     客户端检查有没有新版本
 *   GET  /api/client-download    下发更新包
 *
 * 管理后台（浏览器）
 *   /api/login  /api/logout  /api/me  /api/overview  /api/agents  /api/batches
 *   /api/codes  /api/records  /api/logs  /api/password  /api/export
 *   /api/settings/client-url  /api/settings/signing-key  /api/settings/client-update
 *
 * 这些路径、字段名和返回结构都跟原版保持一致，所以网页前端和小程序前端不用改。
 */

const VM_SERVICE_NAME = 'videomix-license';
    const VM_VERSION = '2.5.4';
const VM_SESSION_HOURS = 12;
const VM_UPDATE_MAX_BYTES = 512 * 1024 * 1024;

final class License
{
    private Store $store;
    private string $method = 'GET';
    private string $path = '/';
    private array $query = [];
    private ?string $rawBody = null;
    private bool $userLoaded = false;
    private ?array $cachedUser = null;

    public function __construct(Store $store)
    {
        $this->store = $store;
    }

    /* ===============================================================
     * 入口
     * ============================================================= */

    public function dispatch(): void
    {
        $this->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = (string)($_SERVER['REQUEST_URI'] ?? '/');
        $cut = strpos($uri, '?');
        $this->path = $cut === false ? $uri : substr($uri, 0, $cut);
        if ($this->path === '') {
            $this->path = '/';
        }
        $this->query = $_GET ?? [];

        try {
            if ($this->method === 'OPTIONS') {
                if (!headers_sent()) {
                    http_response_code(204);
                    header('Access-Control-Allow-Origin: *');
                    header('Access-Control-Allow-Headers: Content-Type');
                    header('Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS');
                    header('Content-Length: 0');
                }
                return;
            }
            if (strncmp($this->path, '/rpc/', 5) === 0 || $this->path === '/health') {
                $this->handleClientApi();
                return;
            }
            if (strncmp($this->path, '/api/', 5) === 0) {
                $this->handleAdminApi();
                return;
            }
            if ($this->method === 'GET' || $this->method === 'HEAD') {
                $this->serveStatic($this->path);
                return;
            }
            $this->sendJson(['success' => false, 'message' => '不支持的请求'], 405);
        } catch (ApiError $error) {
            $this->sendJson(['success' => false, 'message' => $error->getMessage()], $error->status);
        } catch (Throwable $error) {
            error_log('[videomix] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
            $this->sendJson(['success' => false, 'message' => '服务器内部错误'], 500);
        }
    }

    /* ===============================================================
     * 基础输出
     * ============================================================= */

    private function sendJson($payload, int $status = 200, ?string $cookie = null): void
    {
        $body = json_encode_cn($payload);
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Length: ' . strlen($body));
            header('Cache-Control: no-store');
            if ($cookie !== null) {
                header('Set-Cookie: ' . $cookie, false);
            }
        }
        if ($this->method !== 'HEAD') {
            echo $body;
        }
    }

    private function readBody(): string
    {
        if ($this->rawBody === null) {
            $this->rawBody = (string)file_get_contents('php://input');
        }
        return $this->rawBody;
    }

    private function jsonBody(): array
    {
        $raw = $this->readBody();
        if (trim($raw) === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new ApiError(400, '请求格式不是合法 JSON');
        }
        return $data;
    }

    private function clientIp(): string
    {
        $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if (is_string($forwarded) && $forwarded !== '') {
            $first = trim(explode(',', $forwarded)[0]);
            if ($first !== '') {
                return substr($first, 0, 64);
            }
        }
        return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64);
    }

    private function q(string $name, string $default = ''): string
    {
        $value = $this->query[$name] ?? $default;
        if (is_array($value)) {
            $value = reset($value);
        }
        return (string)($value ?? $default);
    }

    /* ===============================================================
     * 会话
     * ============================================================= */

    private function currentUser(): ?array
    {
        if ($this->userLoaded) {
            return $this->cachedUser;
        }
        $this->userLoaded = true;
        $this->cachedUser = null;

        $token = $_COOKIE['vm_session'] ?? '';
        if (!is_string($token) || $token === '') {
            return null;
        }
        $row = $this->store->db->one('SELECT * FROM `sessions` WHERE `token` = ?', [$token]);
        if (!$row) {
            return null;
        }
        $expires = parse_iso($row['expires_at']);
        if ($expires === null || $expires <= time()) {
            $this->store->db->exec('DELETE FROM `sessions` WHERE `token` = ?', [$token]);
            return null;
        }
        $user = $this->store->userById((int)$row['user_id']);
        $this->cachedUser = $user ?: null;
        return $this->cachedUser;
    }

    private function requireUser(): array
    {
        $user = $this->currentUser();
        if (!$user) {
            throw new ApiError(401, '请先登录');
        }
        if (($user['status'] ?? '') !== 'active') {
            throw new ApiError(403, '账号已被停用');
        }
        return $user;
    }

    private function requireMaster(): array
    {
        $user = $this->requireUser();
        if (($user['role'] ?? '') !== 'master') {
            throw new ApiError(403, '只有总账号可以执行该操作');
        }
        return $user;
    }

    /* ===============================================================
     * 客户端接口
     * ============================================================= */

    private function handleClientApi(): void
    {
        if ($this->path === '/health') {
            $this->sendJson([
                'service' => VM_SERVICE_NAME,
                'ok'      => true,
                'version' => VM_VERSION,
                'time'    => now_iso(),
            ]);
            return;
        }
        if ($this->method !== 'POST') {
            $this->sendJson(client_failure('E1', '不支持的请求方式'));
            return;
        }
        $data = $this->jsonBody();
        $code = trim((string)($data['activateCode'] ?? $data['activate_code'] ?? ''));
        $device = trim((string)($data['deviceId'] ?? $data['device_id'] ?? ''));
        $ip = $this->clientIp();

        if ($this->path === '/rpc/authActivateCode') {
            $this->sendJson($this->withTicket($this->activateLogic($code, $device, $ip, 'activate'), $code, $device));
            return;
        }
        if ($this->path === '/rpc/judgeActivateCode') {
            $this->sendJson($this->withTicket($this->activateLogic($code, $device, $ip, 'verify'), $code, $device));
            return;
        }
        $this->sendJson(client_failure('E1', '接口不存在'));
    }

    /** 激活 / 校验的核心逻辑。 */
    private function activateLogic(string $activateCode, string $deviceId, string $ip, string $kind): array
    {
        $db = $this->store->db;
        $normalized = clean_code($activateCode);
        if ($normalized === '') {
            return client_failure('E1', '激活码不存在或无效');
        }

        $row = $db->one('SELECT * FROM `codes` WHERE `code` = ?', [strtoupper(trim($activateCode))]);
        if ($row === null) {
            $row = $db->one('SELECT * FROM `codes` WHERE `code` = ?', [$normalized]);
        }
        if ($row === null) {
            // 容错：库里存的是带横杠的原样，客户端可能传成没横杠的
            foreach ($db->query('SELECT * FROM `codes`') as $candidate) {
                if (clean_code($candidate['code']) === $normalized) {
                    $row = $candidate;
                    break;
                }
            }
        }
        if ($row === null) {
            return client_failure('E1', '激活码不存在或无效');
        }
        if (!empty($row['revoked'])) {
            return client_failure('E4', '激活码已被吊销');
        }

        $expiry = parse_iso($row['expires_at']);
        if ($expiry !== null && $expiry <= time()) {
            return client_failure('E3', '激活码已过期');
        }

        $deviceId = trim($deviceId);
        if ($deviceId === '') {
            return client_failure('E2', '设备信息无效，请重新登录');
        }

        $bound = $db->query('SELECT * FROM `devices` WHERE `code_id` = ?', [(int)$row['id']]);
        $match = null;
        foreach ($bound as $item) {
            if ($item['device_id'] === $deviceId) {
                $match = $item;
                break;
            }
        }

        if ($row['expires_at'] === null && (int)$row['days'] > 0) {
            // 首次激活后才开始计时
            $db->exec('UPDATE `codes` SET `expires_at` = ? WHERE `id` = ?', [iso_plus_days((int)$row['days']), (int)$row['id']]);
            $row = $db->one('SELECT * FROM `codes` WHERE `id` = ?', [(int)$row['id']]);
        }

        if ($match !== null) {
            $db->exec('UPDATE `devices` SET `last_seen_at` = ?, `ip` = ? WHERE `id` = ?', [now_iso(), $ip, (int)$match['id']]);
            return client_success([
                'expiresAt'    => $row['expires_at'],
                'label'        => $row['label'],
                'maxDevices'   => (int)$row['max_devices'],
                'boundDevices' => count($bound),
                'deviceId'     => $deviceId,
                'verifiedAt'   => now_iso(),
            ], $kind === 'activate' ? '激活成功' : '校验通过');
        }

        if ($kind === 'verify') {
            return client_failure('E2', '设备与激活码不匹配，请重新登录');
        }
        if (count($bound) >= (int)$row['max_devices']) {
            return client_failure('E2', '设备与激活码不匹配，请重新登录');
        }

        $db->exec(
            'INSERT INTO `devices` (`code_id`, `device_id`, `activated_at`, `last_seen_at`, `ip`) VALUES (?,?,?,?,?)',
            [(int)$row['id'], $deviceId, now_iso(), now_iso(), $ip]
        );
        $this->store->log(null, 'activate', '激活码 ' . $row['code'] . ' 绑定设备 ' . substr($deviceId, 0, 12) . '（' . $ip . '）', $ip);
        return client_success([
            'expiresAt'    => $row['expires_at'],
            'label'        => $row['label'],
            'maxDevices'   => (int)$row['max_devices'],
            'boundDevices' => count($bound) + 1,
            'deviceId'     => $deviceId,
            'activatedAt'  => now_iso(),
        ], '激活成功');
    }

    /** 激活通过时附上服务器签名的授权票据。 */
    private function withTicket(array $result, string $activateCode, string $deviceId): array
    {
        if (($result['object'] ?? '') !== 'SC') {
            return $result;
        }
        try {
            $key = $this->store->signingKey();
        } catch (Throwable $error) {
            error_log('[videomix] 签名密钥不可用：' . $error->getMessage());
            return client_failure('E9', '授权服务器签名密钥异常，请联系授权方');
        }
        if ($key === null) {
            return client_failure('E9', '授权服务器未配置签名密钥，请联系授权方');
        }
        $result['ticket'] = build_ticket($key, strtoupper(trim($activateCode)), $deviceId, $this->store->ticketTtlDays());
        $result['keyId'] = $key->kid;
        return $result;
    }

    /* ===============================================================
     * 管理接口路由
     * ============================================================= */

    private function handleAdminApi(): void
    {
        $path = rawurldecode($this->path);
        $method = $this->method;

        // ---- 客户端用、不需要登录的两个接口 ----
        if ($path === '/api/client-config' && ($method === 'GET' || $method === 'POST')) {
            $this->apiClientConfig();
            return;
        }
        if ($path === '/api/client-version' && ($method === 'GET' || $method === 'POST')) {
            $this->apiClientVersion();
            return;
        }
        if ($path === '/api/client-download' && ($method === 'GET' || $method === 'HEAD')) {
            $this->apiClientDownload();
            return;
        }

        // ---- 登录相关 ----
        if ($path === '/api/login' && $method === 'POST') {
            $this->apiLogin();
            return;
        }
        if ($path === '/api/logout' && $method === 'POST') {
            $this->apiLogout();
            return;
        }
        if ($path === '/api/me' && $method === 'GET') {
            $user = $this->requireUser();
            $this->sendJson(['success' => true, 'user' => $this->publicUser($user), 'version' => VM_VERSION]);
            return;
        }

        // ---- 概览 ----
        if ($path === '/api/overview' && $method === 'GET') {
            $user = $this->requireUser();
            $this->sendJson(['success' => true, 'data' => $this->overview($user)]);
            return;
        }

        // ---- 代理商 ----
        if ($path === '/api/agents') {
            $user = $this->requireUser();
            if ($method === 'GET') {
                $this->sendJson(['success' => true, 'data' => $this->listAgents($user)]);
                return;
            }
            if ($method === 'POST') {
                $this->createAgent($user);
                return;
            }
        }
        if (preg_match('#^/api/agents/(\d+)$#', $path, $m)) {
            $user = $this->requireUser();
            $targetId = (int)$m[1];
            if ($method === 'PATCH') {
                $this->updateAgent($user, $targetId);
                return;
            }
            if ($method === 'DELETE') {
                $this->deleteAgent($user, $targetId);
                return;
            }
        }
        if (preg_match('#^/api/agents/(\d+)/password$#', $path, $m) && $method === 'POST') {
            $user = $this->requireUser();
            $this->resetAgentPassword($user, (int)$m[1]);
            return;
        }

        // ---- 批次 ----
        if ($path === '/api/batches') {
            $user = $this->requireUser();
            if ($method === 'GET') {
                $this->sendJson(['success' => true, 'data' => $this->listBatches($user)]);
                return;
            }
            if ($method === 'POST') {
                $this->createBatch($user);
                return;
            }
        }
        if (preg_match('#^/api/batches/(\d+)/allocate$#', $path, $m) && $method === 'POST') {
            $user = $this->requireUser();
            $this->allocateBatch($user, (int)$m[1]);
            return;
        }
        if (preg_match('#^/api/batches/(\d+)$#', $path, $m) && $method === 'DELETE') {
            $user = $this->requireUser();
            $this->deleteBatch($user, (int)$m[1]);
            return;
        }

        // ---- 激活码 ----
        if ($path === '/api/codes' && $method === 'GET') {
            $user = $this->requireUser();
            $this->sendJson(['success' => true, 'data' => $this->listCodes($user)]);
            return;
        }
        if ($path === '/api/codes/allocate' && $method === 'POST') {
            $user = $this->requireUser();
            $this->allocateCodes($user);
            return;
        }
        if (preg_match('#^/api/codes/(\d+)/revoke$#', $path, $m) && $method === 'POST') {
            $user = $this->requireUser();
            $this->setRevoked($user, (int)$m[1], true);
            return;
        }
        if (preg_match('#^/api/codes/(\d+)/restore$#', $path, $m) && $method === 'POST') {
            $user = $this->requireUser();
            $this->setRevoked($user, (int)$m[1], false);
            return;
        }
        if (preg_match('#^/api/codes/(\d+)/devices$#', $path, $m) && $method === 'GET') {
            $user = $this->requireUser();
            $this->listCodeDevices($user, (int)$m[1]);
            return;
        }
        if (preg_match('#^/api/codes/(\d+)/devices/(.+)/unbind$#', $path, $m) && $method === 'POST') {
            $user = $this->requireUser();
            $this->unbindDevice($user, (int)$m[1], $m[2]);
            return;
        }
        if (preg_match('#^/api/codes/(\d+)$#', $path, $m) && $method === 'DELETE') {
            $user = $this->requireUser();
            $this->deleteCode($user, (int)$m[1]);
            return;
        }

        // ---- 记录 / 日志 / 密码 / 导出 ----
        if ($path === '/api/records' && $method === 'GET') {
            $user = $this->requireUser();
            $this->sendJson(['success' => true, 'data' => $this->records($user)]);
            return;
        }
        if ($path === '/api/logs' && $method === 'GET') {
            $this->requireUser();
            $limit = min(max((int)$this->q('limit', '100'), 1), 500);
            $rows = $this->store->db->query('SELECT * FROM `logs` ORDER BY `id` DESC LIMIT ' . $limit);
            $this->sendJson(['success' => true, 'data' => array_map([$this, 'logRow'], $rows)]);
            return;
        }
        if ($path === '/api/password' && $method === 'POST') {
            $this->changePassword();
            return;
        }
        if ($path === '/api/export' && $method === 'GET') {
            $user = $this->requireUser();
            if (($user['role'] ?? '') !== 'master') {
                throw new ApiError(403, '只有总账号可以导出数据');
            }
            $this->sendJson(['success' => true, 'data' => $this->exportAll()]);
            return;
        }

        // ---- 设置 ----
        if ($path === '/api/settings/client-url') {
            $this->requireMaster();
            if ($method === 'GET') {
                $this->sendJson(['success' => true, 'data' => $this->clientUrlState()]);
                return;
            }
            if ($method === 'POST') {
                $this->updateClientUrl();
                return;
            }
        }
        if ($path === '/api/settings/signing-key') {
            $this->requireMaster();
            if ($method === 'GET') {
                $this->sendJson(['success' => true, 'data' => $this->signingKeyState()]);
                return;
            }
            if ($method === 'POST') {
                $this->updateSigningKey();
                return;
            }
        }
        if ($path === '/api/settings/client-update') {
            $this->requireMaster();
            if ($method === 'GET') {
                $this->sendJson(['success' => true, 'data' => $this->clientUpdateState()]);
                return;
            }
            if ($method === 'POST') {
                $this->updateClientUpdate();
                return;
            }
        }
        if ($path === '/api/settings/client-update/upload' && $method === 'POST') {
            $this->requireMaster();
            $this->uploadClientUpdate();
            return;
        }
        if ($path === '/api/settings/client-update/clients' && $method === 'GET') {
            $this->requireMaster();
            $this->sendJson(['success' => true, 'data' => $this->clientUpdateClients()]);
            return;
        }

        // ---- 数据备份 / 迁移 ----
        if ($path === '/api/backups') {
            $this->requireMaster();
            if ($method === 'GET') {
                $this->sendJson(['success' => true, 'data' => $this->backupList()]);
                return;
            }
            if ($method === 'POST') {
                $this->createBackup();
                return;
            }
        }
        if (preg_match('#^/api/backups/([^/]+)/download$#', $path, $m) && ($method === 'GET' || $method === 'HEAD')) {
            $this->requireMaster();
            $this->downloadBackup($m[1]);
            return;
        }
        if ($path === '/api/backups/upload' && $method === 'POST') {
            $this->requireMaster();
            $this->uploadBackup();
            return;
        }
        // 删除备份：文件名放在请求体里，不用拼进 URL。
        // （宝塔 nginx 默认有 .sql/.txt 之类的静态文件规则，URL 以文件名结尾会被它拦掉，
        //   交给 nginx 就直接 404，根本到不了 PHP。）
        if ($path === '/api/backups/delete' && $method === 'POST') {
            $this->requireMaster();
            $body = $this->jsonBody();
            $this->deleteBackup((string)($body['name'] ?? ''));
            return;
        }
        if (preg_match('#^/api/backups/([^/]+)/restore$#', $path, $m) && $method === 'POST') {
            $this->requireMaster();
            $this->restoreBackup($m[1]);
            return;
        }
        if (preg_match('#^/api/backups/([^/]+)$#', $path, $m) && $method === 'DELETE') {
            $this->requireMaster();
            $this->deleteBackup($m[1]);
            return;
        }

        // ---- 从旧版（Python + SQLite）或别处导出的 JSON 导入 ----
        if ($path === '/api/import' && $method === 'POST') {
            $this->requireMaster();
            $this->importLegacyData();
            return;
        }
        if ($path === '/api/import/sqlite' && $method === 'POST') {
            $this->requireMaster();
            $this->importSqliteUpload();
            return;
        }

        throw new ApiError(404, '接口不存在');
    }

    /* ===============================================================
     * 登录 / 会话
     * ============================================================= */

    private function apiLogin(): void
    {
        $data = $this->jsonBody();
        $username = trim((string)($data['username'] ?? ''));
        $password = (string)($data['password'] ?? '');
        $row = $this->store->userByName($username);
        if (!$row || !verify_password($password, $row['password'])) {
            $this->store->log(null, 'login_failed', '登录失败：' . $username, $this->clientIp());
            throw new ApiError(401, '账号或密码不正确');
        }
        if (($row['status'] ?? '') !== 'active') {
            throw new ApiError(403, '该账号已被停用');
        }
        $token = bin2hex(random_bytes(32));
        $expiresAt = time() + VM_SESSION_HOURS * 3600;
        $this->store->db->exec(
            'INSERT INTO `sessions` (`token`, `user_id`, `created_at`, `expires_at`, `ip`) VALUES (?,?,?,?,?)',
            [$token, (int)$row['id'], now_iso(), gmdate('Y-m-d\TH:i:s\Z', $expiresAt), $this->clientIp()]
        );
        $this->store->db->exec('UPDATE `users` SET `last_login` = ? WHERE `id` = ?', [now_iso(), (int)$row['id']]);
        $this->store->log($row, 'login', '登录后台', $this->clientIp());
        $cookie = 'vm_session=' . $token . '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' . (VM_SESSION_HOURS * 3600);
        $this->sendJson(['success' => true, 'user' => $this->publicUser($row)], 200, $cookie);
    }

    private function apiLogout(): void
    {
        $user = $this->currentUser();
        if ($user) {
            $this->store->db->exec('DELETE FROM `sessions` WHERE `user_id` = ?', [(int)$user['id']]);
            $this->store->log($user, 'logout', '退出登录', $this->clientIp());
        }
        $this->sendJson(['success' => true], 200, 'vm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    }

    private function publicUser(array $row): array
    {
        return [
            'id'          => (int)$row['id'],
            'username'    => $row['username'],
            'displayName' => $row['display_name'],
            'role'        => $row['role'],
            'level'       => (int)$row['level'],
            'parentId'    => $row['parent_id'] === null ? null : (int)$row['parent_id'],
            'status'      => $row['status'],
            'createdAt'   => $row['created_at'],
            'lastLogin'   => $row['last_login'],
        ];
    }

    private function changePassword(): void
    {
        $user = $this->requireUser();
        $data = $this->jsonBody();
        $old = (string)($data['oldPassword'] ?? '');
        $new = (string)($data['newPassword'] ?? '');
        if (!verify_password($old, $user['password'])) {
            throw new ApiError(400, '原密码不正确');
        }
        if (strlen($new) < 6) {
            throw new ApiError(400, '新密码至少 6 位');
        }
        $this->store->db->exec('UPDATE `users` SET `password` = ? WHERE `id` = ?', [hash_password($new), (int)$user['id']]);
        $this->store->log($user, 'password', '修改了自己的密码', $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '密码已更新']);
    }

    /* ===============================================================
     * 概览
     * ============================================================= */

    private function overview(array $user): array
    {
        $db = $this->store->db;
        $ownerIds = $this->store->visibleUserIds($user);
        $placeholders = implode(',', array_fill(0, count($ownerIds), '?'));
        $args = $ownerIds;
        $masterClause = ($user['role'] ?? '') === 'master' ? 'c.`owner_id` IS NULL OR ' : '';
        $sql = 'SELECT c.*, (SELECT COUNT(*) FROM `devices` d WHERE d.`code_id` = c.`id`) AS device_count'
            . ' FROM `codes` c WHERE (' . $masterClause . 'c.`owner_id` IN (' . $placeholders . '))';
        $codes = $db->query($sql, $args);

        $total = count($codes);
        $revoked = 0;
        $expired = 0;
        $bound = 0;
        $devices = 0;
        $now = time();
        foreach ($codes as $c) {
            $count = (int)$c['device_count'];
            $devices += $count;
            if (!empty($c['revoked'])) {
                $revoked++;
                continue;
            }
            $expiry = parse_iso($c['expires_at']);
            if ($expiry !== null && $expiry <= $now) {
                $expired++;
                continue;
            }
            if ($count > 0) {
                $bound++;
            }
        }

        $agents = array_values(array_filter($this->listAgents($user), static fn(array $a): bool => $a['role'] === 'agent'));
        $since = gmdate('Y-m-d\TH:i:s\Z', $now - 7 * 86400);
        $recent = $db->query(
            'SELECT d.*, c.`code`, c.`label`, u.`username` AS owner_name FROM `devices` d'
            . ' LEFT JOIN `codes` c ON c.`id` = d.`code_id`'
            . ' LEFT JOIN `users` u ON u.`id` = c.`owner_id`'
            . ' WHERE d.`activated_at` >= ? ORDER BY d.`id` DESC LIMIT 8',
            [$since]
        );
        $logins = $db->query('SELECT `ts`, `actor_name`, `action`, `detail` FROM `logs` ORDER BY `id` DESC LIMIT 6');

        return [
            'totalCodes'        => $total,
            'boundCodes'        => $bound,
            'availableCodes'    => $total - $bound - $revoked - $expired,
            'revokedCodes'      => $revoked,
            'expiredCodes'      => $expired,
            'agents'            => count($agents),
            'level1'            => count(array_filter($agents, static fn(array $a): bool => (int)$a['level'] === 1)),
            'level2'            => count(array_filter($agents, static fn(array $a): bool => (int)$a['level'] === 2)),
            'devices'           => $devices,
            'recentActivations' => array_map([$this, 'deviceRow'], $recent),
            'logins'            => array_map([$this, 'logRow'], $logins),
            'scope'             => ($user['role'] ?? '') === 'master' ? 'all' : 'self',
        ];
    }

    private function deviceRow(array $row): array
    {
        return [
            'id'           => (int)($row['id'] ?? 0),
            'code_id'      => isset($row['code_id']) ? (int)$row['code_id'] : null,
            'device_id'    => $row['device_id'] ?? '',
            'activated_at' => $row['activated_at'] ?? '',
            'last_seen_at' => $row['last_seen_at'] ?? '',
            'ip'           => $row['ip'] ?? '',
            'code'         => $row['code'] ?? '',
            'label'        => $row['label'] ?? '',
            'owner_name'   => $row['owner_name'] ?? '',
        ];
    }

    private function logRow(array $row): array
    {
        return [
            'id'         => (int)($row['id'] ?? 0),
            'ts'         => $row['ts'] ?? '',
            'actor_id'   => isset($row['actor_id']) && $row['actor_id'] !== null ? (int)$row['actor_id'] : null,
            'actor_name' => $row['actor_name'] ?? '',
            'action'     => $row['action'] ?? '',
            'detail'     => (string)($row['detail'] ?? ''),
            'ip'         => $row['ip'] ?? '',
        ];
    }

    /* ===============================================================
     * 代理商
     * ============================================================= */

    private function listAgents(array $user): array
    {
        $db = $this->store->db;
        if (($user['role'] ?? '') === 'master') {
            $rows = $db->query('SELECT * FROM `users` ORDER BY `level`, `id`');
        } else {
            $ids = $this->store->visibleUserIds($user);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $rows = $db->query('SELECT * FROM `users` WHERE `id` IN (' . $placeholders . ') ORDER BY `level`, `id`', $ids);
        }
        $result = [];
        foreach ($rows as $row) {
            $counts = $db->one(
                'SELECT COUNT(*) AS total, SUM(CASE WHEN `revoked` = 0 THEN 1 ELSE 0 END) AS active'
                . ' FROM `codes` WHERE `owner_id` = ?',
                [(int)$row['id']]
            );
            $result[] = [
                'id'          => (int)$row['id'],
                'username'    => $row['username'],
                'displayName' => $row['display_name'],
                'role'        => $row['role'],
                'level'       => (int)$row['level'],
                'parentId'    => $row['parent_id'] === null ? null : (int)$row['parent_id'],
                'status'      => $row['status'],
                'note'        => (string)($row['note'] ?? ''),
                'phone'       => $row['phone'],
                'createdAt'   => $row['created_at'],
                'lastLogin'   => $row['last_login'],
                'codeCount'   => (int)($counts['total'] ?? 0),
                'activeCodes' => (int)($counts['active'] ?? 0),
            ];
        }
        return $result;
    }

    private function createAgent(array $user): void
    {
        $db = $this->store->db;
        $data = $this->jsonBody();
        $username = trim((string)($data['username'] ?? ''));
        $password = (string)($data['password'] ?? '');
        $displayName = trim((string)($data['displayName'] ?? $data['display_name'] ?? $username));
        $note = (string)($data['note'] ?? '');
        $phone = (string)($data['phone'] ?? '');

        if (!preg_match('/^[A-Za-z0-9_.@-]{3,32}$/', $username)) {
            throw new ApiError(400, '账号只能包含字母、数字、下划线、点或 @，长度 3-32 位');
        }
        if (strlen($password) < 6) {
            throw new ApiError(400, '密码至少 6 位');
        }
        if ($this->store->userByName($username)) {
            throw new ApiError(400, '该账号名已存在');
        }

        if (($user['role'] ?? '') === 'master') {
            $level = 1;
            $parentId = null;
        } else {
            if ((int)$user['level'] !== 1) {
                throw new ApiError(403, '只有总账号和一级代理商可以创建下级账号');
            }
            $level = 2;
            $parentId = (int)$user['id'];
        }

        $newId = $this->store->createUser($username, $password, $displayName, 'agent', $level, $parentId, $note, $phone, (int)$user['id']);
        $this->store->log($user, 'agent_create', '创建' . ($level === 1 ? '一级' : '二级') . '代理账号 ' . $username, $this->clientIp());
        $this->sendJson(['success' => true, 'id' => $newId, 'message' => '账号已创建']);
    }

    private function visibleAgentIds(array $user): array
    {
        if (($user['role'] ?? '') === 'master') {
            $rows = $this->store->db->query('SELECT `id` FROM `users`');
            return array_map(static fn(array $r): int => (int)$r['id'], $rows);
        }
        return $this->store->visibleUserIds($user);
    }

    private function updateAgent(array $user, int $targetId): void
    {
        $db = $this->store->db;
        if (!in_array($targetId, $this->visibleAgentIds($user), true) || $targetId === (int)$user['id']) {
            throw new ApiError(403, '没有权限修改该账号');
        }
        $target = $this->store->userById($targetId);
        if (!$target) {
            throw new ApiError(400, '账号不存在');
        }
        if ($target['role'] === 'master' && ($user['role'] ?? '') !== 'master') {
            throw new ApiError(403, '没有权限修改该账号');
        }
        $data = $this->jsonBody();
        $fields = [];
        $args = [];
        if (array_key_exists('displayName', $data)) {
            $fields[] = '`display_name` = ?';
            $args[] = trim((string)($data['displayName'] ?? ''));
        }
        if (array_key_exists('note', $data)) {
            $fields[] = '`note` = ?';
            $args[] = (string)($data['note'] ?? '');
        }
        if (array_key_exists('phone', $data)) {
            $fields[] = '`phone` = ?';
            $args[] = (string)($data['phone'] ?? '');
        }
        if (array_key_exists('status', $data)) {
            $status = trim((string)($data['status'] ?? ''));
            if (!in_array($status, ['active', 'disabled'], true)) {
                throw new ApiError(400, '状态只能是 active 或 disabled');
            }
            if ($target['role'] === 'master') {
                throw new ApiError(400, '总账号不能被停用');
            }
            $fields[] = '`status` = ?';
            $args[] = $status;
        }
        if (!$fields) {
            throw new ApiError(400, '没有需要修改的内容');
        }
        $args[] = $targetId;
        $db->exec('UPDATE `users` SET ' . implode(', ', $fields) . ' WHERE `id` = ?', $args);
        $this->store->log($user, 'agent_update', '修改账号 ' . $target['username'] . ' 的信息', $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '已保存']);
    }

    private function resetAgentPassword(array $user, int $targetId): void
    {
        if (!in_array($targetId, $this->visibleAgentIds($user), true)) {
            throw new ApiError(403, '没有权限操作该账号');
        }
        $target = $this->store->userById($targetId);
        if (!$target) {
            throw new ApiError(400, '账号不存在');
        }
        if ($targetId !== (int)$user['id'] && ($user['role'] ?? '') !== 'master'
            && (int)$target['parent_id'] !== (int)$user['id']) {
            throw new ApiError(403, '只能重置自己直属下级的密码');
        }
        $data = $this->jsonBody();
        $password = (string)($data['password'] ?? '');
        if (strlen($password) < 6) {
            throw new ApiError(400, '密码至少 6 位');
        }
        $this->store->db->exec('UPDATE `users` SET `password` = ? WHERE `id` = ?', [hash_password($password), $targetId]);
        $this->store->log($user, 'agent_password', '重置账号 ' . $target['username'] . ' 的密码', $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '密码已重置']);
    }

    private function deleteAgent(array $user, int $targetId): void
    {
        $db = $this->store->db;
        if (($user['role'] ?? '') !== 'master' && !in_array($targetId, $this->store->descendants((int)$user['id']), true)) {
            throw new ApiError(403, '没有权限删除该账号');
        }
        $target = $this->store->userById($targetId);
        if (!$target) {
            throw new ApiError(400, '账号不存在');
        }
        if ($target['role'] === 'master') {
            throw new ApiError(400, '总账号不能删除');
        }
        $children = (int)($db->one('SELECT COUNT(*) AS n FROM `users` WHERE `parent_id` = ?', [$targetId])['n'] ?? 0);
        if ($children) {
            throw new ApiError(400, '该账号下面还有 ' . $children . ' 个下级账号，请先处理');
        }
        $owned = (int)($db->one('SELECT COUNT(*) AS n FROM `codes` WHERE `owner_id` = ?', [$targetId])['n'] ?? 0);
        if ($owned) {
            throw new ApiError(400, '该账号名下还有 ' . $owned . ' 个激活码，请先收回或转移');
        }
        $db->exec('DELETE FROM `sessions` WHERE `user_id` = ?', [$targetId]);
        $db->exec('DELETE FROM `users` WHERE `id` = ?', [$targetId]);
        $this->store->log($user, 'agent_delete', '删除账号 ' . $target['username'], $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '账号已删除']);
    }

    /* ===============================================================
     * 批次
     * ============================================================= */

    private function listBatches(array $user): array
    {
        $db = $this->store->db;
        if (($user['role'] ?? '') === 'master') {
            $rows = $db->query('SELECT * FROM `batches` ORDER BY `id` DESC');
        } else {
            $ids = $this->store->visibleUserIds($user);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $rows = $db->query('SELECT * FROM `batches` WHERE `owner_id` IN (' . $placeholders . ') ORDER BY `id` DESC', $ids);
        }
        $owners = [];
        foreach ($db->query('SELECT `id`, `username` FROM `users`') as $r) {
            $owners[(int)$r['id']] = $r['username'];
        }
        $result = [];
        foreach ($rows as $row) {
            $stats = $db->one(
                'SELECT COUNT(*) AS total,'
                . ' SUM(CASE WHEN `revoked` = 1 THEN 1 ELSE 0 END) AS revoked,'
                . ' SUM(CASE WHEN (SELECT COUNT(*) FROM `devices` d WHERE d.`code_id` = `codes`.`id`) > 0 THEN 1 ELSE 0 END) AS bound,'
                . ' SUM(CASE WHEN `owner_id` = ? THEN 1 ELSE 0 END) AS mine'
                . ' FROM `codes` WHERE `batch_id` = ?',
                [$row['owner_id'] === null ? 0 : (int)$row['owner_id'], (int)$row['id']]
            );
            $distribution = [];
            $grouped = $db->query('SELECT `owner_id`, COUNT(*) AS n FROM `codes` WHERE `batch_id` = ? GROUP BY `owner_id`', [(int)$row['id']]);
            foreach ($grouped as $item) {
                $key = $item['owner_id'] === null ? '总账号' : ($owners[(int)$item['owner_id']] ?? '总账号');
                $distribution[$key] = (int)$item['n'];
            }
            $result[] = [
                'id'           => (int)$row['id'],
                'name'         => $row['name'],
                'days'         => (int)$row['days'],
                'maxDevices'   => (int)$row['max_devices'],
                'quantity'     => (int)$row['quantity'],
                'note'         => (string)($row['note'] ?? ''),
                'ownerId'      => $row['owner_id'] === null ? null : (int)$row['owner_id'],
                'ownerName'    => $row['owner_id'] === null ? '总账号' : ($owners[(int)$row['owner_id']] ?? '总账号'),
                'createdAt'    => $row['created_at'],
                'total'        => (int)($stats['total'] ?? 0),
                'bound'        => (int)($stats['bound'] ?? 0),
                'revoked'      => (int)($stats['revoked'] ?? 0),
                'distribution' => $distribution,
            ];
        }
        return $result;
    }

    private function createBatch(array $user): void
    {
        if (($user['role'] ?? '') !== 'master') {
            throw new ApiError(403, '只有总账号可以新建批次');
        }
        $db = $this->store->db;
        $data = $this->jsonBody();
        $name = trim((string)($data['name'] ?? ''));
        if ($name === '') {
            $name = '批次 ' . date('Y-m-d H:i');
        }
        $quantity = (int)($data['quantity'] ?? 0);
        $days = (int)($data['days'] ?? 365);
        $maxDevices = (int)($data['maxDevices'] ?? $data['max_devices'] ?? 1);
        $note = (string)($data['note'] ?? '');
        $startOnActivation = !empty($data['startOnActivation']);

        if ($quantity < 1 || $quantity > 5000) {
            throw new ApiError(400, '数量需要在 1 - 5000 之间');
        }
        if ($days < 1 || $days > 3650) {
            throw new ApiError(400, '有效期需要在 1 - 3650 天之间');
        }
        if ($maxDevices < 1 || $maxDevices > 50) {
            throw new ApiError(400, '可绑定设备数需要在 1 - 50 之间');
        }

        $batchId = $db->insert(
            'INSERT INTO `batches` (`name`, `days`, `max_devices`, `quantity`, `note`, `owner_id`, `created_at`, `created_by`)'
            . ' VALUES (?,?,?,?,?,?,?,?)',
            [$name, $days, $maxDevices, $quantity, $note, null, now_iso(), (int)$user['id']]
        );
        $expiresAt = $startOnActivation ? null : iso_plus_days($days);
        $created = 0;
        $db->begin();
        try {
            for ($i = 0; $i < $quantity; $i++) {
                $candidate = '';
                for ($attempt = 0; $attempt < 20; $attempt++) {
                    $candidate = generate_code();
                    if (!$db->one('SELECT `id` FROM `codes` WHERE `code` = ?', [$candidate])) {
                        break;
                    }
                }
                if ($candidate === '') {
                    continue;
                }
                $db->exec(
                    'INSERT INTO `codes` (`code`, `batch_id`, `owner_id`, `label`, `note`, `days`, `expires_at`,'
                    . ' `max_devices`, `created_at`, `created_by`) VALUES (?,?,?,?,?,?,?,?,?,?)',
                    [$candidate, $batchId, null, '', '', $days, $expiresAt, $maxDevices, now_iso(), (int)$user['id']]
                );
                $created++;
            }
            $db->commit();
        } catch (Throwable $error) {
            $db->rollback();
            throw $error;
        }
        $this->store->log($user, 'batch_create', '新建批次「' . $name . '」，共 ' . $created . ' 个激活码', $this->clientIp());
        $this->sendJson(['success' => true, 'id' => $batchId, 'created' => $created, 'message' => '批次已创建']);
    }

    private function deleteBatch(array $user, int $batchId): void
    {
        if (($user['role'] ?? '') !== 'master') {
            throw new ApiError(403, '只有总账号可以删除批次');
        }
        $db = $this->store->db;
        $batch = $db->one('SELECT * FROM `batches` WHERE `id` = ?', [$batchId]);
        if (!$batch) {
            throw new ApiError(400, '批次不存在');
        }
        $used = (int)($db->one(
            'SELECT COUNT(*) AS n FROM `codes` WHERE `batch_id` = ? AND'
            . ' (`revoked` = 1 OR `id` IN (SELECT `code_id` FROM `devices`))',
            [$batchId]
        )['n'] ?? 0);
        if ($used) {
            throw new ApiError(400, '该批次里有 ' . $used . ' 个激活码已经绑定设备或被吊销，不能整批删除');
        }
        $db->exec('DELETE FROM `codes` WHERE `batch_id` = ?', [$batchId]);
        $db->exec('DELETE FROM `batches` WHERE `id` = ?', [$batchId]);
        $this->store->log($user, 'batch_delete', '删除批次「' . $batch['name'] . '」', $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '批次已删除']);
    }

    /** 判断 user 能不能把激活码分配给 agentId（null / 0 表示收回总账号）。 */
    private function assertOwnerPermission(array $user, $agentId): ?int
    {
        if ($agentId === null || $agentId === '' || $agentId === 0 || $agentId === '0') {
            return null;
        }
        $agentId = (int)$agentId;
        $agent = $this->store->userById($agentId);
        if (!$agent) {
            throw new ApiError(400, '代理商不存在');
        }
        if ($agent['role'] === 'master') {
            throw new ApiError(400, '不能分配给总账号');
        }
        if (($user['role'] ?? '') === 'master') {
            return $agentId;
        }
        if ((int)$user['level'] !== 1) {
            throw new ApiError(403, '只有总账号和一级代理商可以分配激活码');
        }
        if ($agentId === (int)$user['id']) {
            return $agentId;
        }
        if ((int)$agent['parent_id'] !== (int)$user['id']) {
            throw new ApiError(403, '只能分配给自己名下的二级代理商');
        }
        return $agentId;
    }

    private function allocateBatch(array $user, int $batchId): void
    {
        $db = $this->store->db;
        $data = $this->jsonBody();
        $agentId = $this->assertOwnerPermission($user, $data['agentId'] ?? null);
        $batch = $db->one('SELECT * FROM `batches` WHERE `id` = ?', [$batchId]);
        if (!$batch) {
            throw new ApiError(400, '批次不存在');
        }
        if (($user['role'] ?? '') !== 'master' && (int)$batch['owner_id'] !== (int)$user['id']) {
            throw new ApiError(403, '该批次不在你名下');
        }
        $db->exec('UPDATE `batches` SET `owner_id` = ? WHERE `id` = ?', [$agentId, $batchId]);
        $db->exec(
            'UPDATE `codes` SET `owner_id` = ?, `assigned_at` = ?, `assigned_by` = ? WHERE `batch_id` = ?',
            [$agentId, now_iso(), (int)$user['id'], $batchId]
        );
        $target = $agentId ? (string)$this->store->userById($agentId)['username'] : '总账号';
        $this->store->log($user, 'batch_allocate', '把批次「' . $batch['name'] . '」整批分配给 ' . $target, $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '整批已分配给 ' . $target]);
    }

    /* ===============================================================
     * 激活码
     * ============================================================= */

    private function listCodes(array $user): array
    {
        $db = $this->store->db;
        $where = [];
        $args = [];
        if (($user['role'] ?? '') !== 'master') {
            $ids = $this->store->visibleUserIds($user);
            $where[] = 'c.`owner_id` IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
            foreach ($ids as $id) {
                $args[] = $id;
            }
        }
        $batchId = $this->q('batchId');
        if ($batchId !== '') {
            $where[] = 'c.`batch_id` = ?';
            $args[] = (int)$batchId;
        }
        $ownerId = $this->q('ownerId');
        if ($ownerId !== '') {
            if ($ownerId === 'master') {
                $where[] = 'c.`owner_id` IS NULL';
            } else {
                $where[] = 'c.`owner_id` = ?';
                $args[] = (int)$ownerId;
            }
        }
        $status = $this->q('status');
        $keyword = trim($this->q('q'));
        if ($keyword !== '') {
            $where[] = '(c.`code` LIKE ? OR c.`label` LIKE ? OR c.`note` LIKE ?)';
            $like = '%' . $keyword . '%';
            $args[] = $like;
            $args[] = $like;
            $args[] = $like;
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $rows = $db->query(
            'SELECT c.*, (SELECT COUNT(*) FROM `devices` d WHERE d.`code_id` = c.`id`) AS device_count,'
            . ' b.`name` AS batch_name, u.`username` AS owner_name'
            . ' FROM `codes` c LEFT JOIN `batches` b ON b.`id` = c.`batch_id`'
            . ' LEFT JOIN `users` u ON u.`id` = c.`owner_id` ' . $clause . ' ORDER BY c.`id` DESC',
            $args
        );
        $items = [];
        foreach ($rows as $row) {
            $count = (int)$row['device_count'];
            $state = code_state($row, $count);
            if ($status !== '' && $status !== 'all' && $state !== $status) {
                continue;
            }
            $items[] = [
                'id'          => (int)$row['id'],
                'code'        => $row['code'],
                'label'       => $row['label'],
                'note'        => (string)($row['note'] ?? ''),
                'batchId'     => $row['batch_id'] === null ? null : (int)$row['batch_id'],
                'batchName'   => $row['batch_name'] ?: '-',
                'ownerId'     => $row['owner_id'] === null ? null : (int)$row['owner_id'],
                'ownerName'   => $row['owner_name'] ?: '总账号',
                'days'        => (int)$row['days'],
                'expiresAt'   => $row['expires_at'],
                'maxDevices'  => (int)$row['max_devices'],
                'deviceCount' => $count,
                'revoked'     => (bool)$row['revoked'],
                'state'       => $state,
                'createdAt'   => $row['created_at'],
            ];
        }
        return $items;
    }

    private function allocateCodes(array $user): void
    {
        $db = $this->store->db;
        $data = $this->jsonBody();
        $agentId = $this->assertOwnerPermission($user, $data['agentId'] ?? null);
        $ids = $data['ids'] ?? [];
        if (!is_array($ids) || !$ids) {
            throw new ApiError(400, '请选择要分配的激活码');
        }
        $ids = array_slice(array_map('intval', $ids), 0, 5000);
        $allowed = ($user['role'] ?? '') !== 'master' ? $this->store->visibleUserIds($user) : null;
        $moved = 0;
        foreach ($ids as $codeId) {
            $row = $db->one('SELECT * FROM `codes` WHERE `id` = ?', [$codeId]);
            if (!$row) {
                continue;
            }
            $owner = $row['owner_id'] === null ? null : (int)$row['owner_id'];
            if ($allowed !== null && !in_array($owner, $allowed, true)) {
                continue;
            }
            if ($owner === $agentId) {
                continue;
            }
            $db->exec(
                'UPDATE `codes` SET `owner_id` = ?, `assigned_at` = ?, `assigned_by` = ? WHERE `id` = ?',
                [$agentId, now_iso(), (int)$user['id'], $codeId]
            );
            $moved++;
        }
        $target = $agentId ? (string)$this->store->userById($agentId)['username'] : '总账号';
        $this->store->log($user, 'code_allocate', '把 ' . $moved . ' 个激活码分配给 ' . $target, $this->clientIp());
        $this->sendJson(['success' => true, 'moved' => $moved, 'message' => '已把 ' . $moved . ' 个激活码分配给 ' . $target]);
    }

    private function getVisibleCode(array $user, int $codeId): array
    {
        $row = $this->store->db->one('SELECT * FROM `codes` WHERE `id` = ?', [$codeId]);
        if (!$row) {
            throw new ApiError(400, '激活码不存在');
        }
        if (($user['role'] ?? '') !== 'master') {
            $visible = $this->store->visibleUserIds($user);
            $owner = $row['owner_id'] === null ? null : (int)$row['owner_id'];
            if (!in_array($owner, $visible, true)) {
                throw new ApiError(403, '没有权限操作该激活码');
            }
        }
        return $row;
    }

    private function setRevoked(array $user, int $codeId, bool $revoked): void
    {
        $db = $this->store->db;
        $row = $this->getVisibleCode($user, $codeId);
        $db->exec(
            'UPDATE `codes` SET `revoked` = ?, `revoked_at` = ?, `revoked_by` = ? WHERE `id` = ?',
            [$revoked ? 1 : 0, $revoked ? now_iso() : null, $revoked ? (int)$user['id'] : null, $codeId]
        );
        $this->store->log(
            $user,
            $revoked ? 'code_revoke' : 'code_restore',
            ($revoked ? '吊销' : '恢复') . '激活码 ' . $row['code'],
            $this->clientIp()
        );
        $this->sendJson(['success' => true, 'message' => '已' . ($revoked ? '吊销' : '恢复')]);
    }

    private function deleteCode(array $user, int $codeId): void
    {
        $db = $this->store->db;
        $row = $this->getVisibleCode($user, $codeId);
        $devices = (int)($db->one('SELECT COUNT(*) AS n FROM `devices` WHERE `code_id` = ?', [$codeId])['n'] ?? 0);
        if ($devices && ($user['role'] ?? '') !== 'master') {
            throw new ApiError(400, '该激活码已经绑定设备，请先解绑');
        }
        $db->exec('DELETE FROM `devices` WHERE `code_id` = ?', [$codeId]);
        $db->exec('DELETE FROM `codes` WHERE `id` = ?', [$codeId]);
        $this->store->log($user, 'code_delete', '删除激活码 ' . $row['code'], $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '已删除']);
    }

    private function listCodeDevices(array $user, int $codeId): void
    {
        $row = $this->getVisibleCode($user, $codeId);
        $devices = $this->store->db->query('SELECT * FROM `devices` WHERE `code_id` = ? ORDER BY `id`', [$codeId]);
        $this->sendJson([
            'success' => true,
            'code'    => ['code' => $row['code'], 'maxDevices' => (int)$row['max_devices'], 'label' => $row['label']],
            'data'    => array_map(static fn(array $d): array => [
                'id'           => (int)$d['id'],
                'code_id'      => (int)$d['code_id'],
                'device_id'    => $d['device_id'],
                'activated_at' => $d['activated_at'],
                'last_seen_at' => $d['last_seen_at'],
                'ip'           => $d['ip'],
            ], $devices),
        ]);
    }

    private function unbindDevice(array $user, int $codeId, string $deviceId): void
    {
        $row = $this->getVisibleCode($user, $codeId);
        $deviceId = rawurldecode($deviceId);
        $this->store->db->exec('DELETE FROM `devices` WHERE `code_id` = ? AND `device_id` = ?', [$codeId, $deviceId]);
        $this->store->log($user, 'device_unbind', '解绑激活码 ' . $row['code'] . ' 上的设备 ' . substr($deviceId, 0, 16), $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '设备已解绑']);
    }

    private function records(array $user): array
    {
        $db = $this->store->db;
        $limit = min(max((int)$this->q('limit', '200'), 1), 1000);
        $rows = $db->query(
            'SELECT d.*, c.`code`, c.`label`, c.`owner_id` AS code_owner_id, u.`username` AS owner_name'
            . ' FROM `devices` d LEFT JOIN `codes` c ON c.`id` = d.`code_id`'
            . ' LEFT JOIN `users` u ON u.`id` = c.`owner_id` ORDER BY d.`id` DESC LIMIT ' . $limit
        );
        $visible = ($user['role'] ?? '') === 'master' ? null : $this->store->visibleUserIds($user);
        $items = [];
        foreach ($rows as $row) {
            $owner = $row['code_owner_id'] === null ? null : (int)$row['code_owner_id'];
            if ($visible !== null && $row['code_id'] !== null && !in_array($owner, $visible, true)) {
                continue;
            }
            $items[] = [
                'id'          => (int)$row['id'],
                'code'        => $row['code'] ?? '',
                'label'       => $row['label'] ?? '',
                'ownerName'   => $row['owner_name'] ?: '总账号',
                'deviceId'    => $row['device_id'],
                'activatedAt' => $row['activated_at'],
                'lastSeenAt'  => $row['last_seen_at'],
                'ip'          => $row['ip'],
            ];
        }
        return $items;
    }

    private function exportAll(): array
    {
        $db = $this->store->db;
        $users = $db->query('SELECT * FROM `users`');
        foreach ($users as $i => $row) {
            unset($users[$i]['password']);
        }
        return [
            'version'    => VM_VERSION,
            'exportedAt' => now_iso(),
            'users'      => array_values($users),
            'batches'    => $db->query('SELECT * FROM `batches`'),
            'codes'      => $db->query('SELECT * FROM `codes`'),
            'devices'    => $db->query('SELECT * FROM `devices`'),
        ];
    }

    /* ===============================================================
     * 客户端授权地址（后台集中下发）
     * ============================================================= */

    private function clientConfigPayload(): array
    {
        return [
            'serverUrl' => $this->store->setting('client_server_url', ''),
            'version'   => (int)($this->store->setting('client_server_version', '0') ?: 0),
            'updatedAt' => $this->store->setting('client_server_updated_at', ''),
        ];
    }

    private function apiClientConfig(): void
    {
        $payload = $this->clientConfigPayload();
        $current = substr($this->q('current'), 0, 120);
        $ip = $this->clientIp();
        try {
            $row = $this->store->db->one('SELECT `count` FROM `config_hits` WHERE `ip` = ?', [$ip]);
            if ($row) {
                $this->store->db->exec(
                    'UPDATE `config_hits` SET `count` = `count` + 1, `last_at` = ?, `current` = ? WHERE `ip` = ?',
                    [now_iso(), $current, $ip]
                );
            } else {
                $this->store->db->exec(
                    'INSERT INTO `config_hits` (`ip`, `count`, `last_at`, `current`) VALUES (?, 1, ?, ?)',
                    [$ip, now_iso(), $current]
                );
            }
        } catch (Throwable $ignored) {
            // 统计失败不影响客户端拿地址
        }
        $payload['success'] = true;
        $payload['now'] = now_iso();
        $this->sendJson($payload);
    }

    private function clientUrlState(): array
    {
        $db = $this->store->db;
        $payload = $this->clientConfigPayload();
        $hits = $db->query('SELECT * FROM `config_hits` ORDER BY `last_at` DESC LIMIT 200');
        $byCurrent = [];
        $totalFetches = 0;
        foreach ($hits as $row) {
            $key = $row['current'] !== '' ? $row['current'] : '（未上报）';
            $byCurrent[$key] = ($byCurrent[$key] ?? 0) + 1;
            $totalFetches += (int)$row['count'];
        }
        $list = [];
        foreach (array_slice($hits, 0, 50) as $row) {
            $list[] = [
                'ip'      => $row['ip'],
                'count'   => (int)$row['count'],
                'lastAt'  => $row['last_at'],
                'current' => $row['current'],
            ];
        }
        return [
            'serverUrl'    => $payload['serverUrl'],
            'version'      => $payload['version'],
            'updatedAt'    => $payload['updatedAt'],
            'listeners'    => count($hits),
            'totalFetches' => $totalFetches,
            'lastFetchAt'  => $hits[0]['last_at'] ?? '',
            'distribution' => $byCurrent,
            'hits'         => $list,
        ];
    }

    private function updateClientUrl(): void
    {
        $data = $this->jsonBody();
        $url = clean_server_url($data['serverUrl'] ?? '');
        $old = $this->store->setting('client_server_url', '');
        $version = (int)($this->store->setting('client_server_version', '0') ?: 0);
        if ($url === $old) {
            $this->sendJson(['success' => true, 'message' => '地址没有变化', 'data' => $this->clientUrlState()]);
            return;
        }
        $this->store->setSetting('client_server_url', $url);
        $this->store->setSetting('client_server_version', (string)($version + 1));
        $this->store->setSetting('client_server_updated_at', now_iso());
        $this->store->log(
            $this->requireUser(),
            'client_url',
            '客户端授权地址：' . ($old !== '' ? $old : '（空）') . ' → ' . ($url !== '' ? $url : '（空）'),
            $this->clientIp()
        );
        $this->sendJson([
            'success' => true,
            'message' => $url !== '' ? '已保存，客户端会自动跟过来' : '已清空，客户端将保持现有地址',
            'data'    => $this->clientUrlState(),
        ]);
    }

    /* ===============================================================
     * 客户端在线升级
     * ============================================================= */

    private function updateSettings(): array
    {
        return [
            'enabled'     => $this->store->setting('client_update_enabled', '0') === '1',
            'version'     => $this->store->setting('client_update_version', ''),
            'notes'       => (string)$this->store->setting('client_update_notes', ''),
            'force'       => $this->store->setting('client_update_force', '0') === '1',
            'fileName'    => $this->store->setting('client_update_file', ''),
            'size'        => (int)($this->store->setting('client_update_size', '0') ?: 0),
            'sha256'      => $this->store->setting('client_update_sha256', ''),
            'signature'   => $this->store->setting('client_update_signature', ''),
            'publishedAt' => $this->store->setting('client_update_published_at', ''),
            'uploadedAt'  => $this->store->setting('client_update_uploaded_at', ''),
            'downloads'   => (int)($this->store->setting('client_update_downloads', '0') ?: 0),
        ];
    }

    private function updatePackagePath(): string
    {
        $name = $this->store->setting('client_update_file', '');
        if ($name === '') {
            return '';
        }
        $path = $this->store->updatesDir . DIRECTORY_SEPARATOR . basename($name);
        return is_file($path) ? $path : '';
    }

    private function signUpdatePackage(string $version, string $sha256, int $size): string
    {
        $key = $this->store->signingKey();
        if ($key === null) {
            throw new ApiError(400, '后台还没有签名密钥，无法发布更新包');
        }
        return base64_encode($key->sign(update_signature_message($version, $sha256, $size)));
    }

    private function reportClientVersion(string $device, string $version, string $ip): void
    {
        $device = substr(trim($device), 0, 190);
        if ($device === '') {
            return;
        }
        $now = now_iso();
        $row = $this->store->db->one('SELECT `device` FROM `client_versions` WHERE `device` = ?', [$device]);
        if ($row) {
            $this->store->db->exec(
                'UPDATE `client_versions` SET `version` = ?, `ip` = ?, `last_at` = ? WHERE `device` = ?',
                [$version, $ip, $now, $device]
            );
        } else {
            $this->store->db->exec(
                'INSERT INTO `client_versions` (`device`, `version`, `ip`, `first_at`, `last_at`) VALUES (?,?,?,?,?)',
                [$device, $version, $ip, $now, $now]
            );
        }
    }

    private function apiClientVersion(): void
    {
        $current = substr(trim($this->q('current')), 0, 40);
        $device = substr(trim($this->q('device')), 0, 190);
        $this->reportClientVersion($device, $current, $this->clientIp());

        $state = $this->updateSettings();
        $hasPackage = $this->updatePackagePath() !== '';
        $latest = $state['version'];
        $update = (bool)($state['enabled'] && $hasPackage && $latest !== '' && version_is_newer($latest, $current));
        $keyId = '';
        try {
            $key = $this->store->signingKey(false);
            $keyId = $key ? $key->kid : '';
        } catch (Throwable $ignored) {
            $keyId = '';
        }
        $note = '';
        if ($latest !== '' && $current !== '' && version_is_newer($current, $latest)) {
            $note = '客户端版本比后台发布的更新';
        }
        $this->sendJson(['success' => true, 'data' => [
            'enabled'     => (bool)($state['enabled'] && $hasPackage),
            'latest'      => $latest,
            'current'     => $current,
            'update'      => $update,
            'force'       => (bool)$state['force'],
            'notes'       => $state['notes'],
            'size'        => $state['size'],
            'sha256'      => $state['sha256'],
            'signature'   => $update ? $state['signature'] : '',
            'path'        => '/api/client-download',
            'fileName'    => $state['fileName'] !== '' ? basename($state['fileName']) : '',
            'keyId'       => $keyId,
            'publishedAt' => $state['publishedAt'],
            'note'        => $note,
        ]]);
    }

    private function apiClientDownload(): void
    {
        $path = $this->updatePackagePath();
        if ($path === '') {
            $this->sendJson(['success' => false, 'message' => '后台还没有发布更新包'], 404);
            return;
        }
        $size = (int)filesize($path);
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code(200);
        header('Content-Type: application/zip');
        header('Content-Length: ' . $size);
        header('Content-Disposition: attachment; filename="' . basename($path) . '"');
        header('Cache-Control: no-store');
        if ($this->method !== 'HEAD') {
            $handle = fopen($path, 'rb');
            if ($handle !== false) {
                fpassthru($handle);
                fclose($handle);
            }
        }
        $count = (int)($this->store->setting('client_update_downloads', '0') ?: 0);
        $this->store->setSetting('client_update_downloads', (string)($count + 1));
    }

    private function clientUpdateState(): array
    {
        $state = $this->updateSettings();
        $path = $this->updatePackagePath();
        $keyId = '';
        try {
            $key = $this->store->signingKey(false);
            $keyId = $key ? $key->kid : '';
        } catch (Throwable $ignored) {
            $keyId = '';
        }
        $state['fileName'] = $state['fileName'] !== '' ? basename($state['fileName']) : '';
        $state['hasPackage'] = $path !== '';
        $state['packageMissing'] = $state['fileName'] !== '' && $path === '';
        $state['signingKeyId'] = $keyId;
        $state['downloadUrl'] = '/api/client-download';
        return $state;
    }

    private function updateClientUpdate(): void
    {
        $data = $this->jsonBody();
        $action = strtolower(trim((string)($data['action'] ?? 'save')));
        $user = $this->requireUser();

        if (array_key_exists('notes', $data)) {
            $notes = (string)($data['notes'] ?? '');
            if (function_exists('mb_substr')) {
                $notes = mb_substr($notes, 0, 4000);
            } else {
                $notes = substr($notes, 0, 4000);
            }
            $this->store->setSetting('client_update_notes', $notes);
        }
        if (array_key_exists('force', $data)) {
            $this->store->setSetting('client_update_force', !empty($data['force']) ? '1' : '0');
        }

        if ($action === 'withdraw') {
            $this->store->setSetting('client_update_enabled', '0');
            $this->store->setSetting('client_update_published_at', '');
            $this->store->log($user, 'client_update', '撤回客户端更新发布', $this->clientIp());
            $this->sendJson(['success' => true, 'message' => '已撤回，客户端不会再收到这次更新', 'data' => $this->clientUpdateState()]);
            return;
        }

        if ($action === 'remove') {
            $path = $this->updatePackagePath();
            if ($path !== '') {
                @unlink($path);
            }
            foreach ([
                'client_update_file', 'client_update_version', 'client_update_sha256',
                'client_update_signature', 'client_update_published_at', 'client_update_uploaded_at',
            ] as $key) {
                $this->store->setSetting($key, '');
            }
            $this->store->setSetting('client_update_size', '0');
            $this->store->setSetting('client_update_enabled', '0');
            $this->store->log($user, 'client_update', '删除客户端更新包', $this->clientIp());
            $this->sendJson(['success' => true, 'message' => '更新包已删除', 'data' => $this->clientUpdateState()]);
            return;
        }

        if ($action === 'publish') {
            $path = $this->updatePackagePath();
            if ($path === '') {
                throw new ApiError(400, '还没有上传更新包');
            }
            $state = $this->updateSettings();
            $version = trim($state['version']);
            if (!preg_match('/^\d+(\.\d+){0,3}$/', $version)) {
                throw new ApiError(400, '版本号格式应为 1.2.3 这样的数字');
            }
            [$sha256, $size] = file_sha256($path);
            $this->store->setSetting('client_update_sha256', $sha256);
            $this->store->setSetting('client_update_size', (string)$size);
            $signature = $this->signUpdatePackage($version, $sha256, $size);
            $this->store->setSetting('client_update_signature', $signature);
            $this->store->setSetting('client_update_enabled', '1');
            $this->store->setSetting('client_update_published_at', now_iso());
            $this->store->log(
                $user,
                'client_update',
                '发布客户端更新 v' . $version . '（' . basename($path) . '，' . $size . ' 字节，强制更新：'
                . ($state['force'] ? '是' : '否') . '）',
                $this->clientIp()
            );
            $this->sendJson([
                'success' => true,
                'message' => '已发布 v' . $version . '，客户端会在几分钟内自动升级',
                'data'    => $this->clientUpdateState(),
            ]);
            return;
        }

        $this->store->log($user, 'client_update', '修改客户端更新设置', $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '已保存', 'data' => $this->clientUpdateState()]);
    }

    private function uploadClientUpdate(): void
    {
        $version = trim($this->q('version'));
        if (!preg_match('/^\d+(\.\d+){0,3}$/', $version)) {
            throw new ApiError(400, '版本号格式应为 1.2.3 这样的数字');
        }
        $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($length <= 0) {
            throw new ApiError(400, '没有收到文件内容');
        }
        if ($length > VM_UPDATE_MAX_BYTES) {
            throw new ApiError(413, '更新包太大（上限 512 MB）');
        }

        $dir = $this->store->updatesDir;
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
            throw new ApiError(500, '更新包目录不可写：' . $dir);
        }
        $name = 'client-' . $version . '.zip';
        $final = $dir . DIRECTORY_SEPARATOR . $name;
        $temp = $final . '.part';

        $source = fopen('php://input', 'rb');
        $target = fopen($temp, 'wb');
        if ($source === false || $target === false) {
            if ($source !== false) {
                fclose($source);
            }
            if ($target !== false) {
                fclose($target);
            }
            throw new ApiError(500, '无法写入更新包，请检查目录权限');
        }
        $digest = hash_init('sha256');
        $written = 0;
        while (!feof($source)) {
            $chunk = fread($source, 256 * 1024);
            if ($chunk === false || $chunk === '') {
                break;
            }
            fwrite($target, $chunk);
            hash_update($digest, $chunk);
            $written += strlen($chunk);
        }
        fclose($source);
        fclose($target);

        if ($written !== $length) {
            @unlink($temp);
            throw new ApiError(400, '文件传输不完整（收到 ' . $written . ' / ' . $length . ' 字节），请重试');
        }

        $old = $this->store->setting('client_update_file', '');
        if ($old !== '' && basename($old) !== $name) {
            @unlink($dir . DIRECTORY_SEPARATOR . basename($old));
        }
        if (is_file($final)) {
            @unlink($final);
        }
        if (!@rename($temp, $final)) {
            @unlink($temp);
            throw new ApiError(500, '保存更新包失败，请检查目录权限');
        }

        $user = $this->requireUser();
        $this->store->setSetting('client_update_file', $name);
        $this->store->setSetting('client_update_version', $version);
        $this->store->setSetting('client_update_size', (string)$written);
        $this->store->setSetting('client_update_sha256', hash_final($digest));
        $this->store->setSetting('client_update_signature', '');
        $this->store->setSetting('client_update_published_at', '');
        $this->store->setSetting('client_update_enabled', '0');
        $this->store->setSetting('client_update_uploaded_at', now_iso());
        $this->store->log($user, 'client_update', '上传客户端更新包 ' . $name . '（' . $written . ' 字节）', $this->clientIp());
        $this->sendJson([
            'success' => true,
            'message' => '已上传 v' . $version . '，确认说明后点“发布”',
            'data'    => $this->clientUpdateState(),
        ]);
    }

    private function clientUpdateClients(): array
    {
        $latest = $this->store->setting('client_update_version', '');
        $rows = $this->store->db->query('SELECT * FROM `client_versions` ORDER BY `last_at` DESC LIMIT 500');
        $distribution = [];
        $clients = [];
        $outdated = 0;
        foreach ($rows as $row) {
            $version = $row['version'] !== '' ? $row['version'] : '（未上报）';
            $distribution[$version] = ($distribution[$version] ?? 0) + 1;
            $stale = $latest !== '' && version_is_newer($latest, $row['version']);
            if ($stale) {
                $outdated++;
            }
            $clients[] = [
                'device'   => $row['device'],
                'version'  => $version,
                'ip'       => $row['ip'],
                'firstAt'  => $row['first_at'],
                'lastAt'   => $row['last_at'],
                'outdated' => $stale,
            ];
        }
        return [
            'latest'       => $latest,
            'total'        => count($rows),
            'outdated'     => $outdated,
            'upToDate'     => count($rows) - $outdated,
            'distribution' => $distribution,
            'clients'      => $clients,
        ];
    }

    /* ===============================================================
     * 签名密钥设置
     * ============================================================= */

    private function signingKeyState(): array
    {
        $key = $this->store->signingKey();
        return [
            'keyId'        => $key->kid,
            'publicKeyXml' => $key->publicXml(),
            'ttlDays'      => $this->store->ticketTtlDays(),
            'autoGenerated' => $this->store->setting('signing_key_xml', '') === '',
            'updatedAt'    => $this->store->setting('signing_key_updated_at', ''),
            'serverUrl'    => $this->store->setting('client_server_url', ''),
            'signEngine'   => $key->signEngine,
            'keyBytes'     => $key->keyBytes(),
        ];
    }

    private function updateSigningKey(): void
    {
        $user = $this->requireUser();
        $data = $this->jsonBody();
        $xml = trim((string)($data['privateKeyXml'] ?? ''));
        $rawTtl = $data['ttlDays'] ?? null;
        $message = '没有提交私钥，未做修改';

        if ($xml !== '') {
            try {
                $parts = parse_key_xml($xml);
            } catch (Throwable $error) {
                throw new ApiError(400, '私钥无法解析：' . $error->getMessage());
            }
            if (($parts['d'] ?? '') === '') {
                throw new ApiError(400, '这是公钥，不是私钥；请填带 D 的完整私钥');
            }
            if (strlen($parts['n']) < 256) {
                throw new ApiError(400, '私钥长度不足 2048 位，请换一把');
            }
            $probe = new SigningKey($parts);
            if (!$probe->isPrivate()) {
                throw new ApiError(400, '私钥不可用：需要带 P/Q/DP/DQ/InverseQ 的完整 RSA 私钥，且服务器 PHP 要开 openssl 扩展');
            }
            try {
                $probe->sign('videomix-signing-key-check');
            } catch (Throwable $error) {
                throw new ApiError(400, '私钥不可用：' . $error->getMessage());
            }
            $old = $this->store->setting('signing_key_xml', '');
            $this->store->setSetting('signing_key_xml', $xml);
            $this->store->setSetting('signing_key_updated_at', now_iso());
            $this->store->forgetSigningKey();
            $key = $this->store->signingKey();
            $this->store->log($user, 'signing_key', ($old !== '' ? '更换' : '导入') . '授权签名密钥（指纹 ' . $key->kid . '）', $this->clientIp());
            $message = '已保存，指纹 ' . $key->kid . '；请确认安装包里内置的是同一把公钥';
        }

        if ($rawTtl !== null && $rawTtl !== '') {
            if (!is_numeric($rawTtl)) {
                throw new ApiError(400, '票据有效期要填数字（天）');
            }
            $ttl = (int)$rawTtl;
            if ($ttl < 1 || $ttl > 3650) {
                throw new ApiError(400, '票据有效期请填 1~3650 天');
            }
            $this->store->setSetting('ticket_ttl_days', (string)$ttl);
            $this->store->log($user, 'signing_key', '授权票据有效期改为 ' . $ttl . ' 天', $this->clientIp());
        }

        $this->sendJson(['success' => true, 'message' => $message, 'data' => $this->signingKeyState()]);
    }

    /* ===============================================================
     * 数据备份 / 迁移（DedeCMS 风格）
     * ============================================================= */

    /** 所有备份文件 + 目录信息。 */
    private function backupList(): array
    {
        $dir = $this->store->backupDir;
        $items = Backup::listFiles($dir);
        $total = 0;
        foreach ($items as $item) {
            $total += (int)$item['size'];
        }
        $writable = is_dir($dir) ? is_writable($dir) : false;
        return [
            'dir'           => $dir,
            'relativeDir'   => 'data/backups',
            'writable'      => $writable,
            'isMaster'      => true,
            'items'         => $items,
            'count'         => count($items),
            'totalSize'     => $total,
            'totalSizeText' => Backup::humanSize($total),
            'uploadMax'     => $this->uploadLimitText(),
        ];
    }

    private function createBackup(): void
    {
        $user = $this->requireUser();
        $data = $this->jsonBody();
        $label = trim((string)($data['label'] ?? ''));
        $item = Backup::dump($this->store->db->pdo(), $this->store->backupDir, $label, VM_VERSION);
        $this->store->log($user, 'backup', '生成数据库备份 ' . $item['name'] . '（' . $item['sizeText'] . '）', $this->clientIp());
        $this->sendJson([
            'success' => true,
            'message' => '备份完成：' . $item['name'] . '（' . $item['sizeText'] . '）',
            'data'    => $item,
        ]);
    }

    private function downloadBackup(string $name): void
    {
        $dir = $this->store->backupDir;
        $safe = Backup::safeName(rawurldecode($name));
        $path = $dir . DIRECTORY_SEPARATOR . $safe;
        if (!is_file($path)) {
            throw new ApiError(400, '备份文件不存在，可能已经被删除');
        }
        $size = (int)filesize($path);
        $this->store->log($this->currentUser(), 'backup', '下载数据库备份 ' . $safe, $this->clientIp());
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code(200);
        header('Content-Type: application/sql; charset=utf-8');
        header('Content-Length: ' . $size);
        header('Content-Disposition: attachment; filename="' . $safe . '"');
        header('Cache-Control: no-store');
        if ($this->method !== 'HEAD') {
            $handle = fopen($path, 'rb');
            if ($handle !== false) {
                fpassthru($handle);
                fclose($handle);
            }
        }
    }

    /** 把本机上的某个备份喂回数据库（覆盖当前数据）。 */
    private function restoreBackup(string $name): void
    {
        $user = $this->requireUser();
        $data = $this->jsonBody();
        $safe = Backup::safeName(rawurldecode($name));
        $path = $this->store->backupDir . DIRECTORY_SEPARATOR . $safe;
        if (!is_file($path)) {
            throw new ApiError(400, '备份文件不存在，可能已经被删除');
        }
        if (($data['confirm'] ?? '') !== 'RESTORE') {
            throw new ApiError(400, '恢复会把当前数据库覆盖成备份里的内容，请在弹窗里确认');
        }

        // 恢复前先自保一份当前数据，恢复错了还能回头
        $safety = Backup::dump($this->store->db->pdo(), $this->store->backupDir, 'before-restore', VM_VERSION);

        $pdo = $this->store->db->pdo();
        $statements = Backup::restore($pdo, $path);
        $this->store->forgetSigningKey();
        $fingerprint = '';
        try {
            $key = $this->store->signingKey(false);
            $fingerprint = $key ? $key->kid : '';
        } catch (Throwable $ignored) {
            $fingerprint = '';
        }
        $this->store->log($user, 'backup', '用备份 ' . $safe . ' 恢复数据库（执行 ' . $statements . ' 条语句）', $this->clientIp());

        $this->sendJson([
            'success' => true,
            'message' => '恢复完成，共执行 ' . $statements . ' 条语句（已自动把恢复前的数据另存为 ' . $safety['name'] . '）',
            'data'    => [
                'statements'  => $statements,
                'fingerprint' => $fingerprint,
                'safetyCopy'  => $safety['name'],
                'list'        => $this->backupList(),
            ],
        ]);
    }

    /** 把客户端上传的 .sql / .zip 收进备份目录（方便从别的机器拷过来）。 */
    private function uploadBackup(): void
    {
        $user = $this->requireUser();
        $raw = $this->readBody();
        if ($raw === '') {
            throw new ApiError(400, '没有收到文件内容');
        }
        if (strlen($raw) > VM_BACKUP_MAX_BYTES) {
            throw new ApiError(413, '备份文件太大（上限 512 MB）');
        }
        $name = (string)($this->query['name'] ?? '');
        $tmp = tempnam(sys_get_temp_dir(), 'vmbak');
        if ($tmp === false) {
            throw new ApiError(500, '服务器临时目录不可写');
        }
        file_put_contents($tmp, $raw);
        try {
            $path = Backup::importUpload($tmp, $name !== '' ? $name : 'upload.sql', $this->store->backupDir);
        } finally {
            @unlink($tmp);
        }
        $stored = basename($path);
        $this->store->log($user, 'backup', '上传数据库备份 ' . $stored . '（' . Backup::humanSize((int)filesize($path)) . '）', $this->clientIp());
        $this->sendJson([
            'success' => true,
            'message' => '已收下备份文件 ' . $stored . '，可以点「恢复」把它导回数据库',
            'data'    => $this->backupList(),
        ]);
    }

    private function deleteBackup(string $name): void
    {
        $user = $this->requireUser();
        $safe = Backup::safeName(rawurldecode($name));
        Backup::delete($this->store->backupDir, $safe);
        $this->store->log($user, 'backup', '删除数据库备份 ' . $safe, $this->clientIp());
        $this->sendJson(['success' => true, 'message' => '已删除 ' . $safe, 'data' => $this->backupList()]);
    }

    /** 读 php.ini 的上传上限，前端用来提示「备份太大要改服务器设置」。 */
    private function uploadLimitText(): string
    {
        $toBytes = static function (string $value): int {
            $value = trim($value);
            if ($value === '' || $value === '-1') {
                return 0;
            }
            $unit = strtolower(substr($value, -1));
            $number = (float)$value;
            switch ($unit) {
                case 'g':
                    $number *= 1024 * 1024 * 1024;
                    break;
                case 'm':
                    $number *= 1024 * 1024;
                    break;
                case 'k':
                    $number *= 1024;
                    break;
            }
            return (int)$number;
        };
        $upload = $toBytes((string)ini_get('upload_max_filesize'));
        $post = $toBytes((string)ini_get('post_max_size'));
        $limit = ($upload > 0 && $post > 0) ? min($upload, $post) : max($upload, $post);
        return Backup::humanSize($limit > 0 ? $limit : 0);
    }

    /* ===============================================================
     * 从旧版（Python + SQLite）导入
     * ---------------------------------------------------------------
     * 旧版后台「/api/export」导出的 JSON 和这里要的结构完全一样：
     *   {version, exportedAt, users[], batches[], codes[], devices[]}
     * 说明：
     *   - 只补不覆盖：账号按用户名、批次/激活码按 id 或 code 判断，已存在的跳过
     *   - 不碰总账号密码、不碰 settings（所以签名私钥和授权地址保持现在的）
     *   - 新建的代理商账号密码是随机生成的，导入完会把明文列出来让你发给对方
     * ============================================================= */

    private function importLegacyData(): void
    {
        $user = $this->requireUser();
        $body = $this->jsonBody();
        $data = isset($body['data']) && is_array($body['data']) ? $body['data'] : $body;
        $report = $this->importRecords($data, $user);

        $this->sendJson([
            'success' => true,
            'message' => $report['message'],
            'data'    => [
                'stats'        => $report['stats'],
                'createdUsers' => $report['createdUsers'],
                'overview'     => $this->overview($user),
            ],
        ]);
    }

    /**
     * 直接上传旧版的 SQLite 文件（license.db），后台自己读出来导入。
     * 需要 PHP 的 pdo_sqlite 扩展；没开就提示去宝塔开一下，或者改用 JSON 那条路。
     */
    private function importSqliteUpload(): void
    {
        $user = $this->requireUser();
        if (!extension_loaded('pdo_sqlite')) {
            throw new ApiError(400, '服务器 PHP 没开 pdo_sqlite 扩展，读不了 .db 文件。'
                . '去宝塔「软件商店 → PHP-x.x → 安装扩展」勾上 pdo_sqlite（和 sqlite3）再试；'
                . '或者改用「从旧版导入」传 JSON。');
        }
        $raw = $this->readBody();
        if ($raw === '') {
            throw new ApiError(400, '没有收到文件内容');
        }
        if (strlen($raw) > 128 * 1024 * 1024) {
            throw new ApiError(413, '文件太大（上限 128 MB）');
        }
        if (strncmp($raw, "SQLite format 3\x00", 16) !== 0) {
            throw new ApiError(400, '这不是 SQLite 数据库文件（旧版 license.db 才是）');
        }

        $tmp = tempnam(sys_get_temp_dir(), 'vmsqlite');
        if ($tmp === false) {
            throw new ApiError(500, '服务器临时目录不可写');
        }
        file_put_contents($tmp, $raw);
        $data = ['users' => [], 'batches' => [], 'codes' => [], 'devices' => []];
        try {
            $pdo = new PDO('sqlite:' . $tmp, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            foreach (['users', 'batches', 'codes', 'devices'] as $table) {
                try {
                    $data[$table] = $pdo->query('SELECT * FROM "' . $table . '"')->fetchAll(PDO::FETCH_ASSOC);
                } catch (Throwable $ignored) {
                    // 旧库里没有这张表就当是空的
                }
            }
        } catch (Throwable $error) {
            throw new ApiError(400, '读不了这个数据库文件：' . $error->getMessage());
        } finally {
            @unlink($tmp);
        }
        foreach ($data['users'] as $index => $row) {
            unset($data['users'][$index]['password']);
        }

        $report = $this->importRecords($data, $user);
        $this->sendJson([
            'success' => true,
            'message' => $report['message'],
            'data'    => [
                'stats'        => $report['stats'],
                'createdUsers' => $report['createdUsers'],
                'overview'     => $this->overview($user),
            ],
        ]);
    }

    /** 导入主体：只补不覆盖，事务里跑，出错整批回滚。返回 ['stats','createdUsers','message']。 */
    private function importRecords(array $data, array $user): array
    {
        $users = is_array($data['users'] ?? null) ? $data['users'] : [];
        $batches = is_array($data['batches'] ?? null) ? $data['batches'] : [];
        $codes = is_array($data['codes'] ?? null) ? $data['codes'] : [];
        $devices = is_array($data['devices'] ?? null) ? $data['devices'] : [];
        if (!$users && !$batches && !$codes && !$devices) {
            throw new ApiError(400, '这个文件里没有 users / batches / codes / devices，看起来不是旧版的数据');
        }

        $db = $this->store->db;
        $stats = [
            'users'   => ['added' => 0, 'skipped' => 0],
            'batches' => ['added' => 0, 'skipped' => 0],
            'codes'   => ['added' => 0, 'skipped' => 0],
            'devices' => ['added' => 0, 'skipped' => 0],
        ];
        $createdUsers = [];
        $userMap = [];
        $batchMap = [];
        $codeMap = [];

        $db->begin();
        try {
            // ---- 1. 账号（先父后子，保证 parent_id 能对上）----
            usort($users, static fn($a, $b) => ((int)($a['level'] ?? 0)) <=> ((int)($b['level'] ?? 0)));
            foreach ($users as $row) {
                $username = trim((string)($row['username'] ?? ''));
                if ($username === '') {
                    continue;
                }
                $oldId = (int)($row['id'] ?? 0);
                $existing = $db->one('SELECT `id` FROM `users` WHERE `username` = ?', [$username]);
                if ($existing) {
                    $stats['users']['skipped']++;
                    if ($oldId > 0) {
                        $userMap[$oldId] = (int)$existing['id'];
                    }
                    continue;
                }
                $role = ((string)($row['role'] ?? 'agent')) === 'master' ? 'master' : 'agent';
                if ($role === 'master') {
                    // 总账号不导入：本机已经有自己的总账号了
                    $stats['users']['skipped']++;
                    continue;
                }
                $plain = $this->randomPassword();
                $parentId = isset($row['parent_id']) && $row['parent_id'] !== null
                    ? ($userMap[(int)$row['parent_id']] ?? null)
                    : null;
                $params = [
                    $username,
                    (string)($row['display_name'] ?? $username),
                    hash_password($plain),
                    $role,
                    (int)($row['level'] ?? 1),
                    $parentId,
                    (string)($row['status'] ?? 'active'),
                    (string)($row['note'] ?? ''),
                    (string)($row['phone'] ?? ''),
                    (string)($row['created_at'] ?? now_iso()),
                    null,
                    null,
                ];
                $newId = $this->insertWithOptionalId(
                    'INSERT INTO `users` (`id`,`username`,`display_name`,`password`,`role`,`level`,`parent_id`,'
                    . '`status`,`note`,`phone`,`created_at`,`created_by`,`last_login`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    $oldId,
                    $params
                );
                $stats['users']['added']++;
                if ($oldId > 0) {
                    $userMap[$oldId] = $newId;
                }
                $createdUsers[] = ['username' => $username, 'password' => $plain];
            }

            // ---- 2. 批次 ----
            foreach ($batches as $row) {
                $oldId = (int)($row['id'] ?? 0);
                if ($oldId > 0 && isset($batchMap[$oldId])) {
                    $stats['batches']['skipped']++;
                    continue;
                }
                $params = [
                    (string)($row['name'] ?? '导入批次'),
                    (int)($row['days'] ?? 365),
                    (int)($row['max_devices'] ?? 1),
                    (int)($row['quantity'] ?? 0),
                    (string)($row['note'] ?? ''),
                    isset($row['owner_id']) && $row['owner_id'] !== null
                        ? ($userMap[(int)$row['owner_id']] ?? null)
                        : null,
                    (string)($row['created_at'] ?? now_iso()),
                    null,
                ];
                $newId = $this->insertWithOptionalId(
                    'INSERT INTO `batches` (`id`,`name`,`days`,`max_devices`,`quantity`,`note`,`owner_id`,'
                    . '`created_at`,`created_by`) VALUES (?,?,?,?,?,?,?,?,?)',
                    $oldId,
                    $params
                );
                $stats['batches']['added']++;
                if ($oldId > 0) {
                    $batchMap[$oldId] = $newId;
                }
            }

            // ---- 3. 激活码 ----
            foreach ($codes as $row) {
                $code = strtoupper(trim((string)($row['code'] ?? '')));
                $normalized = clean_code($code);
                if ($normalized === '') {
                    continue;
                }
                $oldId = (int)($row['id'] ?? 0);
                $existing = $db->one('SELECT `id` FROM `codes` WHERE `code` = ?', [$code]);
                if (!$existing) {
                    // 兜底：新旧后台对横杠的存法可能不一样，按去掉横杠再比一次
                    foreach ($db->query('SELECT `id`, `code` FROM `codes`') as $candidate) {
                        if (clean_code($candidate['code']) === $normalized) {
                            $existing = $candidate;
                            break;
                        }
                    }
                }
                if ($existing) {
                    $stats['codes']['skipped']++;
                    if ($oldId > 0) {
                        $codeMap[$oldId] = (int)$existing['id'];
                    }
                    continue;
                }
                $params = [
                    $code,
                    isset($row['batch_id']) && $row['batch_id'] !== null
                        ? ($batchMap[(int)$row['batch_id']] ?? null)
                        : null,
                    isset($row['owner_id']) && $row['owner_id'] !== null
                        ? ($userMap[(int)$row['owner_id']] ?? null)
                        : null,
                    (string)($row['label'] ?? ''),
                    (string)($row['note'] ?? ''),
                    (int)($row['days'] ?? 0),
                    isset($row['expires_at']) && $row['expires_at'] !== null ? (string)$row['expires_at'] : null,
                    (int)($row['max_devices'] ?? 1),
                    (int)($row['revoked'] ?? 0) ? 1 : 0,
                    isset($row['revoked_at']) && $row['revoked_at'] !== null ? (string)$row['revoked_at'] : null,
                    null,
                    (string)($row['created_at'] ?? now_iso()),
                    null,
                    isset($row['assigned_at']) && $row['assigned_at'] !== null ? (string)$row['assigned_at'] : null,
                    null,
                ];
                $newId = $this->insertWithOptionalId(
                    'INSERT INTO `codes` (`id`,`code`,`batch_id`,`owner_id`,`label`,`note`,`days`,`expires_at`,'
                    . '`max_devices`,`revoked`,`revoked_at`,`revoked_by`,`created_at`,`created_by`,`assigned_at`,'
                    . '`assigned_by`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    $oldId,
                    $params
                );
                $stats['codes']['added']++;
                if ($oldId > 0) {
                    $codeMap[$oldId] = $newId;
                }
            }

            // ---- 4. 绑定设备 ----
            foreach ($devices as $row) {
                $codeId = isset($row['code_id']) ? ($codeMap[(int)$row['code_id']] ?? null) : null;
                $deviceId = trim((string)($row['device_id'] ?? ''));
                if ($codeId === null || $deviceId === '') {
                    $stats['devices']['skipped']++;
                    continue;
                }
                $exists = $db->one('SELECT `id` FROM `devices` WHERE `code_id` = ? AND `device_id` = ?',
                    [$codeId, $deviceId]);
                if ($exists) {
                    $stats['devices']['skipped']++;
                    continue;
                }
                $db->exec(
                    'INSERT INTO `devices` (`code_id`,`device_id`,`activated_at`,`last_seen_at`,`ip`) VALUES (?,?,?,?,?)',
                    [
                        $codeId,
                        $deviceId,
                        (string)($row['activated_at'] ?? now_iso()),
                        (string)($row['last_seen_at'] ?? ''),
                        (string)($row['ip'] ?? ''),
                    ]
                );
                $stats['devices']['added']++;
            }

            $db->commit();
        } catch (Throwable $error) {
            $db->rollback();
            throw new ApiError(400, '导入失败（已回滚，没动现有数据）：' . $error->getMessage());
        }

        $this->store->log(
            $user,
            'import',
            '从旧版导入：账号 +' . $stats['users']['added'] . '，批次 +' . $stats['batches']['added']
            . '，激活码 +' . $stats['codes']['added'] . '，绑定设备 +' . $stats['devices']['added'],
            $this->clientIp()
        );

        $message = '导入完成：激活码 +' . $stats['codes']['added'] . '（跳过已存在的 ' . $stats['codes']['skipped']
            . '），代理商 +' . $stats['users']['added'] . '（跳过 ' . $stats['users']['skipped'] . '）'
            . '，批次 +' . $stats['batches']['added'] . '，绑定设备 +' . $stats['devices']['added'];
        return [
            'stats'        => $stats,
            'createdUsers' => $createdUsers,
            'message'      => $message,
        ];
    }

    /** 尽量沿用旧 id（外键好对上），被占了就让自增分配。 */
    private function insertWithOptionalId(string $sql, int $preferredId, array $params): int
    {
        $db = $this->store->db;
        if ($preferredId > 0) {
            $suffix = strpos($sql, 'INSERT INTO `users`') === 0 ? 'users'
                : (strpos($sql, 'INSERT INTO `batches`') === 0 ? 'batches'
                : (strpos($sql, 'INSERT INTO `codes`') === 0 ? 'codes' : ''));
            if ($suffix !== '' && !$db->one('SELECT `id` FROM `' . $suffix . '` WHERE `id` = ?', [$preferredId])) {
                $db->exec($sql, array_merge([$preferredId], $params));
                return $preferredId;
            }
        }
        return (int)$db->insert($sql, array_merge([null], $params));
    }

    private function randomPassword(): string
    {
        $alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $out = '';
        for ($i = 0; $i < 12; $i++) {
            $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return $out;
    }

    /* ===============================================================
     * 静态文件
     * ============================================================= */

    private function serveStatic(string $path): void
    {
        $publicDir = dirname(__DIR__) . '/public';
        $webDir = $publicDir . '/web';

        if ($path === '/' || $path === '/index.html' || $path === '/admin' || $path === '/admin/') {
            $this->sendFile($webDir . '/index.html');
            return;
        }

        $relative = ltrim($path, '/');
        $blockedExt = ['php', 'phtml', 'phar', 'inc', 'ini', 'xml', 'sql', 'md', 'log', 'part', 'lock', 'json'];
        $reqExt = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
        if ($relative === '' || strpos($relative, '..') !== false || in_array($reqExt, $blockedExt, true)) {
            http_response_code(404);
            return;
        }

        // 前台网页放在 public/web/ 下。为了兼容不同站点的站点根目录写法，
        // 这里同时接受 /app.js 和 /web/app.js 两种地址。
        $candidates = [];
        if (strncmp($relative, 'web/', 4) === 0) {
            $candidates[] = $webDir . '/' . substr($relative, 4);
            $candidates[] = $publicDir . '/' . $relative;
        } else {
            $candidates[] = $webDir . '/' . $relative;
            $candidates[] = $publicDir . '/' . $relative;
        }

        foreach ($candidates as $target) {
            if (is_file($target)) {
                $this->sendFile($target);
                return;
            }
        }

        // 前端页面本身没有扩展名语义（比如 /admin/xxx），回退到入口页。
        if ($reqExt === '' || $reqExt === 'html' || $reqExt === 'htm') {
            $this->sendFile($webDir . '/index.html');
            return;
        }

        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'not found';
    }

    private function sendFile(string $path): void
    {
        if (!is_file($path)) {
            http_response_code(404);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'not found';
            return;
        }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $types = [
            'html' => 'text/html; charset=utf-8',
            'css'  => 'text/css; charset=utf-8',
            'js'   => 'application/javascript; charset=utf-8',
            'json' => 'application/json; charset=utf-8',
            'svg'  => 'image/svg+xml',
            'png'  => 'image/png',
            'jpg'  => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'ico'  => 'image/x-icon',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'txt'  => 'text/plain; charset=utf-8',
        ];
        $type = $types[$ext] ?? 'application/octet-stream';
        http_response_code(200);
        header('Content-Type: ' . $type);
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: no-cache');
        if ($this->method !== 'HEAD') {
            readfile($path);
        }
    }
}
