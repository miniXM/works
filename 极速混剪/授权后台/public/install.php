<?php
declare(strict_types=1);

/**
 * 网页安装向导：填数据库 + 总账号，自动建表、导入签名私钥、生成 config.php。
 * 装完之后这个文件可以留着（再次访问只会显示安装状态），也可以删掉。
 */

require __DIR__ . '/../lib/bootstrap.php';

$errors = [];
$notice = '';
$installed = vm_has_config();
$showForm = !$installed || isset($_GET['setup']);
$done = false;
$fingerprint = '';
$restoreInfo = '';
$mode = 'fresh';

/** 把 php.ini 里的 8M / 512M 这种写法换成字节数。 */
function ini_bytes(string $value): int
{
    $value = trim($value);
    if ($value === '' || $value === '-1') {
        return 0;
    }
    $unit = strtolower(substr($value, -1));
    $number = (float)$value;
    if ($unit === 'g') {
        $number *= 1024 * 1024 * 1024;
    } elseif ($unit === 'm') {
        $number *= 1024 * 1024;
    } elseif ($unit === 'k') {
        $number *= 1024;
    }
    return (int)$number;
}

$postMaxBytes = ini_bytes((string)ini_get('post_max_size'));
$uploadMaxBytes = ini_bytes((string)ini_get('upload_max_filesize'));
$uploadLimit = ($postMaxBytes > 0 && $uploadMaxBytes > 0)
    ? min($postMaxBytes, $uploadMaxBytes)
    : max($postMaxBytes, $uploadMaxBytes);

$post = function (string $key, string $default = '') {
    $value = $_POST[$key] ?? $default;
    return is_string($value) ? trim($value) : $default;
};

$existing = [];
if ($installed) {
    $loaded = vm_config();
    $existing = is_array($loaded) ? $loaded : [];
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $showForm = true;
    $mode = ($post('install_mode', 'fresh') === 'restore') ? 'restore' : 'fresh';
    $dbHost = $post('db_host', '127.0.0.1');
    $dbPort = (int)$post('db_port', '3306');
    $dbName = $post('db_name');
    $dbUser = $post('db_user');
    $dbPass = (string)($_POST['db_pass'] ?? '');
    $adminUser = $post('admin_user');
    $adminPass = (string)($_POST['admin_pass'] ?? '');
    $adminPass2 = (string)($_POST['admin_pass2'] ?? '');
    $adminDisplay = $post('admin_display', '总账号');
    $keyText = (string)($_POST['private_key'] ?? '');
    $keySource = $post('key_source', 'bundled');
    $upload = $_FILES['backup_file'] ?? null;

    // POST 体积超过 post_max_size 时，PHP 会把 $_POST / $_FILES 全清空，这里给个人话提示
    $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if (!$post('db_name') && $contentLength > 0 && $postMaxBytes > 0 && $contentLength > $postMaxBytes) {
        $errors[] = '这次提交的数据（' . Backup::humanSize($contentLength) . '）超过了 PHP 的 post_max_size（'
            . Backup::humanSize($postMaxBytes) . '）。请在宝塔的 PHP 设置里把 post_max_size 和 upload_max_filesize 调大，再重试。';
    }

    if ($dbName === '') {
        $errors[] = '请填数据库名（在宝塔「数据库」里新建的那个）。';
    }
    if ($dbUser === '') {
        $errors[] = '请填数据库用户名。';
    }
    if ($mode === 'fresh') {
        if (!preg_match('/^[A-Za-z0-9_.@-]{3,32}$/', $adminUser)) {
            $errors[] = '总账号只能包含字母、数字、下划线、点或 @，长度 3-32 位。';
        }
        if (strlen($adminPass) < 6) {
            $errors[] = '总账号密码至少 6 位。';
        }
        if ($adminPass !== $adminPass2) {
            $errors[] = '两次输入的总账号密码不一致。';
        }
    } else {
        if (!is_array($upload) || (int)($upload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            $errors[] = '请选择要恢复的备份文件（.sql 或打包成 .zip 的备份）。';
        } elseif ((int)$upload['error'] !== UPLOAD_ERR_OK) {
            $errors[] = '备份文件上传失败（错误码 ' . (int)$upload['error'] . '），可能是文件太大，请把 post_max_size'
                . ' 和 upload_max_filesize 调大后重试。';
        } elseif ((int)($upload['size'] ?? 0) <= 0) {
            $errors[] = '备份文件是空的，请重新导出后再上传。';
        } elseif ($uploadLimit > 0 && (int)$upload['size'] > $uploadLimit) {
            $errors[] = '备份文件 ' . Backup::humanSize((int)$upload['size']) . ' 超过了 PHP 允许的上传上限（'
                . Backup::humanSize($uploadLimit) . '），请调大 post_max_size / upload_max_filesize 后重试。';
        }
    }

    if (!$errors) {
        try {
            $pdo = new PDO(
                'mysql:host=' . $dbHost . ';port=' . $dbPort . ';dbname=' . $dbName . ';charset=utf8mb4',
                $dbUser,
                $dbPass,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
            );
        } catch (Throwable $error) {
            $errors[] = '连不上数据库：' . $error->getMessage();
        }
    }

    if (!$errors) {
        try {
            if ($mode === 'fresh') {
                Store::runSqlFile($pdo, VM_ROOT . '/sql/schema.sql');
            } else {
                $imported = Backup::importUpload(
                    (string)$upload['tmp_name'],
                    (string)($upload['name'] ?? 'backup.sql'),
                    VM_DEFAULT_BACKUPS_DIR
                );
                $statements = Backup::restore($pdo, $imported);
                $restoreInfo = '共执行 ' . $statements . ' 条语句，备份文件已留存在 <span class="mono">data/backups/'
                    . h(basename($imported)) . '</span>';
            }
        } catch (Throwable $error) {
            $errors[] = ($mode === 'fresh' ? '建表失败：' : '恢复失败：') . $error->getMessage();
        }
    }

    $keyXml = '';
    if (!$errors && $mode === 'fresh') {
        try {
            if ($keySource === 'custom' && trim($keyText) !== '') {
                $keyXml = trim($keyText);
            } elseif (is_file(VM_ROOT . '/keys/license-private.xml')) {
                $keyXml = trim((string)file_get_contents(VM_ROOT . '/keys/license-private.xml'));
            } else {
                $keyXml = generate_key_xml(2048);
            }
            $parts = parse_key_xml($keyXml);
            if (($parts['d'] ?? '') === '') {
                throw new RuntimeException('这份密钥里没有 D（只有公钥），不能用它签名');
            }
            $probe = new SigningKey($parts);
            if (!$probe->isPrivate()) {
                throw new RuntimeException('密钥载入失败：需要带 P/Q/DP/DQ/InverseQ 的完整 RSA 私钥，并确认 PHP 已开启 openssl 扩展');
            }
            $probe->sign('videomix-install-probe');
            $fingerprint = $probe->kid;
        } catch (Throwable $error) {
            $errors[] = '签名私钥不可用：' . $error->getMessage();
        }
    }

    // 恢复模式：指纹从备份里读出来给用户看一眼
    if (!$errors && $mode === 'restore') {
        try {
            $row = $pdo->query("SELECT `value` FROM `settings` WHERE `key` = 'signing_key_xml' LIMIT 1")->fetch();
            $xml = $row ? (string)$row['value'] : '';
            if ($xml === '') {
                throw new RuntimeException('备份里没有找到授权签名密钥');
            }
            $parts = parse_key_xml($xml);
            $probe = new SigningKey($parts);
            $fingerprint = $probe->kid;
        } catch (Throwable $error) {
            $errors[] = '备份里的签名私钥读不出来：' . $error->getMessage();
        }
    }

    if (!$errors) {
        try {
            $now = now_iso();
            if ($mode === 'fresh') {
                $stmt = $pdo->prepare(
                    'INSERT INTO `settings` (`key`, `value`) VALUES (?, ?)'
                    . ' ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)'
                );
                $stmt->execute(['signing_key_xml', $keyXml]);
                $stmt->execute(['signing_key_updated_at', $now]);
                if (!$stmt->execute(['ticket_ttl_days', '30'])) {
                    throw new RuntimeException('写入票据有效期失败');
                }

                $master = $pdo->query("SELECT `id` FROM `users` WHERE `role` = 'master' ORDER BY `id` LIMIT 1")->fetch();
                $hash = password_hash($adminPass, PASSWORD_BCRYPT);
                if ($master) {
                    $update = $pdo->prepare(
                        'UPDATE `users` SET `username` = ?, `display_name` = ?, `password` = ?, `status` = \'active\' WHERE `id` = ?'
                    );
                    $update->execute([$adminUser, $adminDisplay, $hash, (int)$master['id']]);
                } else {
                    $insert = $pdo->prepare(
                        'INSERT INTO `users` (`username`, `display_name`, `password`, `role`, `level`, `parent_id`,'
                        . ' `status`, `note`, `phone`, `created_at`, `created_by`, `last_login`)'
                        . ' VALUES (?,?,?,?,0,NULL,\'active\',\'\',\'\',?,NULL,NULL)'
                    );
                    $insert->execute([$adminUser, $adminDisplay, $hash, 'master', $now]);
                }
            }

            $config = [
                'db' => [
                    'host'    => $dbHost,
                    'port'    => $dbPort,
                    'name'    => $dbName,
                    'user'    => $dbUser,
                    'pass'    => $dbPass,
                    'charset' => 'utf8mb4',
                ],
                'private_key_xml' => '',
                'session_hours'   => 12,
                'updates_dir'     => '',
                'backups_dir'     => '',
                'installed_at'    => $now,
            ];
            $php = "<?php\n"
                . "// VideoMix 授权中心配置文件（安装向导生成于 " . $now . "）\n"
                . "// 数据库密码、私钥都在这里；改完保存即可生效。\n"
                . "return " . var_export($config, true) . ";\n";
            if (@file_put_contents(VM_CONFIG_FILE, $php) === false) {
                throw new RuntimeException('写不进 config.php，请给项目根目录写权限（宝塔里把目录权限设为 755、属主 www）');
            }
            @chmod(VM_CONFIG_FILE, 0644);
            @mkdir(VM_DEFAULT_UPDATES_DIR, 0755, true);
            @mkdir(VM_DEFAULT_BACKUPS_DIR, 0755, true);
            $done = true;
            $showForm = false;
        } catch (Throwable $error) {
            $errors[] = '保存配置失败：' . $error->getMessage();
        }
    }
}

function h($value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VideoMix 授权中心 · 安装</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:32px 16px; background:#f5f6fa; color:#374151;
    font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif; font-size:14px; line-height:1.7; }
  .card { max-width:760px; margin:0 auto; background:#fff; border-radius:14px; padding:28px 32px;
    box-shadow:0 12px 40px rgba(15,23,42,.08); }
  h1 { font-size:20px; margin:0 0 6px; color:#111827; }
  .sub { color:#6b7280; margin:0 0 22px; }
  h2 { font-size:15px; margin:26px 0 10px; color:#111827; }
  label { display:block; margin:12px 0 6px; color:#4b5563; }
  input[type=text], input[type=password], input[type=number], input[type=file], textarea, select {
    width:100%; box-sizing:border-box; padding:9px 12px; border:1px solid #d7dbe3; border-radius:8px;
    font-family:inherit; font-size:14px; background:#fff; }
  input[type=file] { padding:8px 10px; }
  input:focus, textarea:focus, select:focus { outline:2px solid #bfd3ff; border-color:#5b8def; }
  textarea { min-height:88px; font-family:Consolas,Monaco,monospace; font-size:12px; }
  .row { display:flex; gap:14px; }
  .row > div { flex:1; }
  .modes { display:flex; gap:12px; margin-top:8px; }
  .mode { flex:1; display:flex; gap:10px; align-items:flex-start; margin:0; padding:12px 14px;
    border:1px solid #d7dbe3; border-radius:10px; background:#fafbfd; cursor:pointer; }
  .mode.on { border-color:#5b8def; background:#f2f6ff; box-shadow:0 0 0 2px rgba(91,141,239,.15); }
  .mode input { margin-top:3px; }
  .mode b { color:#111827; }
  .hint { color:#8b93a1; font-size:12px; margin-top:4px; }
  button { margin-top:24px; width:100%; padding:12px; border:0; border-radius:9px; background:#4a7de0;
    color:#fff; font-size:15px; cursor:pointer; }
  button:hover { background:#3d6ed0; }
  .err { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; border-radius:10px; padding:12px 16px; margin:0 0 16px; }
  .ok { background:#ecfdf5; border:1px solid #a7f3d0; color:#047857; border-radius:10px; padding:14px 18px; }
  .mono { font-family:Consolas,Monaco,monospace; background:#f1f5f9; padding:2px 6px; border-radius:4px; }
  a { color:#4a7de0; }
  .actions { display:flex; gap:12px; margin-top:22px; }
  .actions a { flex:1; text-align:center; padding:11px; border-radius:9px; background:#eef3ff;
    text-decoration:none; color:#2f5bbf; }
</style>
</head>
<body>
<div class="card">

<?php if ($done): ?>
  <h1><?= $mode === 'restore' ? '数据恢复完成 ✅' : '安装完成 ✅' ?></h1>
  <p class="sub">
    <?= $mode === 'restore'
        ? '备份里的数据库已经导回来了，用<b>原来后台的账号和密码</b>登录即可。'
        : '后台已经建好表、写入配置，可以登录了。' ?>
  </p>
  <?php if ($mode === 'restore' && $restoreInfo !== ''): ?>
    <div class="ok" style="margin-bottom:16px"><?= $restoreInfo ?></div>
  <?php endif; ?>
  <div class="ok">
    <p style="margin:0 0 8px"><b>授权签名指纹：</b><span class="mono"><?= h($fingerprint) ?></span></p>
    <p style="margin:0">安装包里内置的公钥必须和这个指纹一致，否则客户端会拒绝激活。<?= $mode === 'restore'
        ? '（恢复模式下指纹来自备份，正常应该和原来一样。）' : '' ?></p>
  </div>
  <div class="actions">
    <a href="./">进入授权后台</a>
    <a href="./health" target="_blank">检查服务状态</a>
  </div>
  <p class="hint" style="margin-top:18px">安全提示：装好后可以把 <span class="mono">install.php</span> 删掉，或改成别的文件名。</p>

<?php elseif (!$showForm): ?>
  <h1>授权中心已经安装过了</h1>
  <p class="sub">检测到配置文件 <span class="mono">config.php</span> 已存在。</p>
  <div class="actions">
    <a href="./">进入授权后台</a>
    <a href="./install.php?setup=1">重新配置数据库 / 总账号</a>
  </div>

<?php else: ?>
  <h1>VideoMix 授权中心 · 安装向导</h1>
  <p class="sub">先到宝塔「数据库」里新建一个 MySQL 库，再回这里填写连接信息。</p>

  <?php foreach ($errors as $error): ?>
    <div class="err"><?= h($error) ?></div>
  <?php endforeach; ?>

  <form method="post" action="install.php" enctype="multipart/form-data">
    <h2>0. 安装方式</h2>
    <div class="modes">
      <label class="mode<?= ($mode === 'fresh') ? ' on' : '' ?>">
        <input type="radio" name="install_mode" value="fresh"<?= ($mode === 'fresh') ? ' checked' : '' ?> onchange="switchMode()">
        <span><b>新建安装</b><br><span class="hint">全新部署：建表 → 导入签名私钥 → 创建总账号</span></span>
      </label>
      <label class="mode<?= ($mode === 'restore') ? ' on' : '' ?>">
        <input type="radio" name="install_mode" value="restore"<?= ($mode === 'restore') ? ' checked' : '' ?> onchange="switchMode()">
        <span><b>用备份文件恢复</b><br><span class="hint">搬迁 / 还原：上传后台导出的 .sql 备份，账号密码沿用原来的</span></span>
      </label>
    </div>

    <h2>1. 数据库</h2>
    <div class="row">
      <div>
        <label for="db_host">数据库地址</label>
        <input id="db_host" name="db_host" type="text" value="<?= h($_POST['db_host'] ?? ($existing['db']['host'] ?? '127.0.0.1')) ?>" required>
        <div class="hint">数据库和网站同一台机器就填 127.0.0.1</div>
      </div>
      <div style="max-width:150px">
        <label for="db_port">端口</label>
        <input id="db_port" name="db_port" type="number" value="<?= h($_POST['db_port'] ?? ($existing['db']['port'] ?? '3306')) ?>" required>
      </div>
    </div>
    <label for="db_name">数据库名</label>
    <input id="db_name" name="db_name" type="text" value="<?= h($_POST['db_name'] ?? ($existing['db']['name'] ?? '')) ?>" required>
    <label for="db_user">数据库用户名</label>
    <input id="db_user" name="db_user" type="text" value="<?= h($_POST['db_user'] ?? ($existing['db']['user'] ?? '')) ?>" required>
    <label for="db_pass">数据库密码</label>
    <input id="db_pass" name="db_pass" type="password" value="<?= h($_POST['db_pass'] ?? ($existing['db']['pass'] ?? '')) ?>">
    <div class="hint">恢复模式下，请先建一个<b>空库</b>（不要有同名表）；恢复会清掉库里现有的表再导入备份。</div>

    <div id="freshOnly" style="display:<?= ($mode === 'fresh') ? 'block' : 'none' ?>">

    <h2>2. 总账号（你自己用的最高权限账号）</h2>
    <div class="row">
      <div>
        <label for="admin_user">总账号</label>
        <input id="admin_user" name="admin_user" type="text" value="<?= h($_POST['admin_user'] ?? 'admin') ?>" required>
      </div>
      <div>
        <label for="admin_display">显示名称</label>
        <input id="admin_display" name="admin_display" type="text" value="<?= h($_POST['admin_display'] ?? '总账号') ?>">
      </div>
    </div>
    <div class="row">
      <div>
        <label for="admin_pass">登录密码</label>
        <input id="admin_pass" name="admin_pass" type="password" required>
      </div>
      <div>
        <label for="admin_pass2">再输一次</label>
        <input id="admin_pass2" name="admin_pass2" type="password" required>
      </div>
    </div>
    <div class="hint">密码至少 6 位，装好之后可以在后台里改。</div>

    <h2>3. 授权签名私钥</h2>
    <label for="key_source">用哪把私钥</label>
    <select id="key_source" name="key_source" onchange="document.getElementById('keyBox').style.display = this.value === 'custom' ? 'block' : 'none';">
      <option value="bundled"<?= (($_POST['key_source'] ?? 'bundled') === 'bundled') ? ' selected' : '' ?>>用程序里自带的那把（推荐，老客户不用重装）</option>
      <option value="custom"<?= (($_POST['key_source'] ?? '') === 'custom') ? ' selected' : '' ?>>我自己粘贴一把私钥</option>
    </select>
    <?php if (is_file(VM_ROOT . '/keys/license-private.xml')): ?>
      <div class="hint">自带私钥：<span class="mono">keys/license-private.xml</span></div>
    <?php else: ?>
      <div class="hint">程序里没有自带私钥，会自动新生成一把。</div>
    <?php endif; ?>
    <div id="keyBox" style="display:<?= (($_POST['key_source'] ?? '') === 'custom') ? 'block' : 'none' ?>">
      <label for="private_key">把 &lt;RSAKeyValue&gt;...&lt;/RSAKeyValue&gt; 整段粘进来</label>
      <textarea id="private_key" name="private_key" placeholder="&lt;RSAKeyValue&gt;&lt;Modulus&gt;...&lt;/Modulus&gt;...&lt;D&gt;...&lt;/D&gt;&lt;/RSAKeyValue&gt;"><?= h($_POST['private_key'] ?? '') ?></textarea>
    </div>

    </div>

    <div id="restoreOnly" style="display:<?= ($mode === 'restore') ? 'block' : 'none' ?>">
      <h2>2. 备份文件</h2>
      <label for="backup_file">选择后台导出的备份（.sql，或打包成 .zip 也可以）</label>
      <input id="backup_file" name="backup_file" type="file" accept=".sql,.zip,application/sql,application/zip">
      <div class="hint">
        当前 PHP 允许的上传上限：<span class="mono"><?= h(Backup::humanSize($uploadLimit)) ?></span>
        （<span class="mono">post_max_size</span> / <span class="mono">upload_max_filesize</span>）。
        备份太大就先在宝塔「软件商店 → PHP 设置 → 配置修改」里调大这两个值。
      </div>
      <div class="hint">
        <b>备份文件里含全部激活码、代理商账号和授权签名私钥，请只在自己可控的机器之间传递。</b>
        恢复完成后，用<b>原来后台的总账号和密码</b>登录；总账号/密码/代理商/激活码全部来自备份，不会重设。
      </div>
    </div>

    <button type="submit" id="submitBtn"><?= ($mode === 'restore') ? '开始恢复' : '开始安装' ?></button>
  </form>

  <p class="hint" style="margin-top:20px">
    新建安装会做：建表 → 导入签名私钥 → 创建总账号 → 生成 <span class="mono">config.php</span>。<br>
    恢复安装会做：导入备份（自动先另存一份当前数据）→ 生成 <span class="mono">config.php</span>。
  </p>
<?php endif; ?>

</div>
<script>
function switchMode() {
  var mode = document.querySelector('input[name=install_mode]:checked').value;
  document.getElementById('freshOnly').style.display = mode === 'fresh' ? 'block' : 'none';
  document.getElementById('restoreOnly').style.display = mode === 'restore' ? 'block' : 'none';
  document.getElementById('submitBtn').textContent = mode === 'restore' ? '开始恢复' : '开始安装';
  var modes = document.querySelectorAll('.mode');
  for (var i = 0; i < modes.length; i++) modes[i].classList.remove('on');
  document.querySelector('input[name=install_mode]:checked').closest('.mode').classList.add('on');
}
</script>
</body>
</html>
