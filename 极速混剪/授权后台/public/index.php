<?php
declare(strict_types=1);

/**
 * 唯一入口。网页后台的静态页、管理接口、客户端接口全部走这里。
 */

require __DIR__ . '/../lib/bootstrap.php';

if (!vm_has_config()) {
    header('Location: install.php');
    exit;
}

try {
    $store = vm_bootstrap();
} catch (Throwable $error) {
    error_log('[videomix] 启动失败：' . $error->getMessage());
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
        . '<title>VideoMix 授权中心 · 启动失败</title>'
        . '<style>body{font-family:"Microsoft YaHei",system-ui,sans-serif;background:#f5f6fa;color:#374151;'
        . 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}'
        . 'div{max-width:640px;background:#fff;border-radius:12px;padding:28px 32px;line-height:1.9;'
        . 'box-shadow:0 10px 40px rgba(15,23,42,.08)}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}'
        . 'h1{font-size:18px;margin:0 0 12px}</style></head><body><div><h1>授权后台启动失败</h1>'
        . '<p>数据库连接不上，或者 <code>config.php</code> 填错了。原始错误：</p><p><code>'
        . htmlspecialchars($error->getMessage(), ENT_QUOTES, 'UTF-8') . '</code></p>'
        . '<p>确认宝塔里数据库已建好、用户名密码正确，然后重新访问 <code>/install.php</code> 覆盖配置。</p>'
        . '</div></body></html>';
    exit;
}

(new License($store))->dispatch();
