<?php
declare(strict_types=1);

/**
 * 自检页：部署完打开 /check.php 一眼看出哪里没配好。
 * 只读，不会改任何数据；不想留着可以删掉。
 */

require __DIR__ . '/../lib/bootstrap.php';

$rows = [];
$add = function (string $name, bool $ok, string $detail) use (&$rows): void {
    $rows[] = ['name' => $name, 'ok' => $ok, 'detail' => $detail];
};

$add('PHP 版本', version_compare(PHP_VERSION, '7.4.0', '>='), PHP_VERSION . '（建议 8.0 以上）');
$add('pdo_mysql 扩展', extension_loaded('pdo_mysql'), extension_loaded('pdo_mysql') ? '已开启' : '没开！宝塔 → PHP 设置 → 安装扩展里装一下');
$add('openssl 扩展', extension_loaded('openssl'), extension_loaded('openssl') ? '已开启' : '没开！授权票据签不出来，必须开启');
$add('mbstring 扩展', extension_loaded('mbstring'), extension_loaded('mbstring') ? '已开启' : '没开也能跑');
$add('gmp 扩展', extension_loaded('gmp'), extension_loaded('gmp') ? '已开启' : '没开也能跑');
$add('pdo_sqlite 扩展', extension_loaded('pdo_sqlite'),
    extension_loaded('pdo_sqlite') ? '已开启（可以直接导入旧版 license.db）'
        : '没开。只有要从旧 Python 版搬数据才需要，宝塔 PHP 设置里勾一下即可');
$add('json 扩展', extension_loaded('json'), 'PHP 内置');

$hasConfig = vm_has_config();
$add('config.php', $hasConfig, $hasConfig ? '已生成' : '还没装，请先访问 /install.php');
$add('data/updates 可写', is_dir(VM_DEFAULT_UPDATES_DIR) && is_writable(VM_DEFAULT_UPDATES_DIR),
    VM_DEFAULT_UPDATES_DIR . (is_writable(VM_DEFAULT_UPDATES_DIR) ? '' : ' 不可写！宝塔里给目录 755、属主 www'));
$add('data/backups 可写', is_dir(VM_DEFAULT_BACKUPS_DIR) && is_writable(VM_DEFAULT_BACKUPS_DIR),
    VM_DEFAULT_BACKUPS_DIR . (is_writable(VM_DEFAULT_BACKUPS_DIR) ? '' : ' 不可写！后台「数据备份」要写这里'));
$backupCount = 0;
if (is_dir(VM_DEFAULT_BACKUPS_DIR)) {
    foreach (scandir(VM_DEFAULT_BACKUPS_DIR) ?: [] as $backupFile) {
        if (preg_match('/\.sql$/', $backupFile)) {
            $backupCount++;
        }
    }
}
$add('数据库备份文件', true, $backupCount > 0
    ? '已有 ' . $backupCount . ' 个（后台「数据备份」里可以下载 / 恢复）'
    : '还没有。建议登录后台点一下「数据备份 → 立即备份」');
$add('项目根目录可写', is_writable(VM_ROOT), VM_ROOT . '（安装向导要在这里写 config.php）');
$add('私钥文件存在', is_file(VM_ROOT . '/keys/license-private.xml'), VM_ROOT . '/keys/license-private.xml');

$store = null;
if ($hasConfig) {
    try {
        $store = vm_bootstrap();
        $add('数据库连接', true, '连接成功');
    } catch (Throwable $error) {
        $add('数据库连接', false, $error->getMessage());
    }
}

if ($store !== null) {
    try {
        $counts = [
            'users'   => (int)$store->db->scalar('SELECT COUNT(*) FROM `users`'),
            'codes'   => (int)$store->db->scalar('SELECT COUNT(*) FROM `codes`'),
            'devices' => (int)$store->db->scalar('SELECT COUNT(*) FROM `devices`'),
            'batches' => (int)$store->db->scalar('SELECT COUNT(*) FROM `batches`'),
        ];
        $add('数据表可读', true, '账号 ' . $counts['users'] . ' · 批次 ' . $counts['batches']
            . ' · 激活码 ' . $counts['codes'] . ' · 绑定设备 ' . $counts['devices']);
    } catch (Throwable $error) {
        $add('数据表可读', false, '表可能没建好：' . $error->getMessage());
    }
    try {
        $key = $store->signingKey(false);
        if ($key === null) {
            $add('授权签名密钥', false, '还没配置，去 /install.php 装一次或到后台「设置 → 授权签名」导入');
        } else {
            $good = $key->kid === '29566eb98cee5506';
            $add('授权签名密钥', true, '指纹 ' . $key->kid . '，签名引擎 ' . $key->signEngine
                . ($good ? '' : ' ⚠ 和安装包内置的公钥不是同一把，客户端会拒绝激活'));
        }
    } catch (Throwable $error) {
        $add('授权签名密钥', false, $error->getMessage());
    }
    $add('客户端授权地址', true, ($store->setting('client_server_url', '') ?: '（还没设置，去后台「设置 → 客户端授权地址」填）'));
}

$failed = array_filter($rows, static fn(array $r): bool => !$r['ok']);

function hh($value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VideoMix 授权中心 · 自检</title>
<style>
  body { margin:0; padding:32px 16px; background:#f5f6fa; color:#374151;
    font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif; font-size:14px; }
  .card { max-width:860px; margin:0 auto; background:#fff; border-radius:14px; padding:26px 30px;
    box-shadow:0 12px 40px rgba(15,23,42,.08); }
  h1 { font-size:19px; margin:0 0 4px; }
  .sub { color:#6b7280; margin:0 0 20px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:9px 8px; border-bottom:1px solid #eef1f5; vertical-align:top; }
  td:first-child { width:34px; }
  td:nth-child(2) { width:190px; color:#111827; }
  .ok { color:#059669; font-weight:700; }
  .bad { color:#dc2626; font-weight:700; }
  .detail { color:#6b7280; word-break:break-all; }
  .banner { border-radius:10px; padding:12px 16px; margin:0 0 18px; }
  .banner.ok { background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; }
  .banner.bad { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:12px; }
  a { color:#4a7de0; }
</style>
</head>
<body>
<div class="card">
  <h1>VideoMix 授权中心 · 部署自检</h1>
  <p class="sub">服务器环境、数据库、签名密钥一次性检查。</p>

  <?php if (!$failed): ?>
    <div class="banner ok">全部正常，可以去后台干活了：<a href="./">进入授权后台</a></div>
  <?php else: ?>
    <div class="banner bad">有 <?= count($failed) ?> 项需要处理，看下面标红的行。</div>
  <?php endif; ?>

  <table>
    <?php foreach ($rows as $row): ?>
      <tr>
        <td class="<?= $row['ok'] ? 'ok' : 'bad' ?>"><?= $row['ok'] ? '✔' : '✘' ?></td>
        <td><?= hh($row['name']) ?></td>
        <td class="detail"><?= hh($row['detail']) ?></td>
      </tr>
    <?php endforeach; ?>
  </table>

  <p class="sub" style="margin-top:20px">
    客户端接口自检：<a href="./health" target="_blank">/health</a> ·
    安装向导：<a href="./install.php">/install.php</a>
  </p>
</div>
</body>
</html>
