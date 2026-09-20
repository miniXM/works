<?php
/**
 * VideoMix 授权中心 · 配置样例
 *
 * 正常部署不用手动改这个文件：
 *   把整个项目传到宝塔站点目录，浏览器访问 https://你的域名/install.php，
 *   填完数据库和总账号，安装向导会自动生成 config.php。
 *
 * 只有想手动改配置时，才把这个文件复制成 config.php 再编辑。
 */

return [
    // ---------- MySQL / MariaDB ----------
    'db' => [
        'host'    => '127.0.0.1',          // 数据库和网站同一台机器就填 127.0.0.1
        'port'    => 3306,
        'name'    => 'videomix_license',   // 宝塔「数据库」里建的库名
        'user'    => 'videomix_license',   // 宝塔「数据库」里建的用户名
        'pass'    => '在这里填数据库密码',
        'charset' => 'utf8mb4',
        // 'socket' => '/tmp/mysql.sock',  // 用 socket 连接时才需要填，一般不用
    ],

    // ---------- 授权签名私钥 ----------
    // 留空：私钥存在数据库 settings 表里，由 install.php 导入（推荐）。
    // 填写：把 .NET 的 <RSAKeyValue>...</RSAKeyValue> 私钥整段粘在这里。
    'private_key_xml' => '',

    // ---------- 其它 ----------
    'session_hours' => 12,   // 后台登录保持多少小时
    'updates_dir'   => '',   // 客户端更新包目录，留空 = 项目里的 data/updates
];
