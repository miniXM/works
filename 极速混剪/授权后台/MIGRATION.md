# PHP 授权后台

源码直接来自当前 PHP + MySQL 授权后台版本。部署前不要手工创建 `config.php`，上传后通过 `public/install.php` 完成数据库配置、总账号初始化和私钥导入。

私钥必须在新机器通过安全渠道单独迁移，不能上传到仓库。授权后台的 `data/backups` 和 `data/updates` 需要配置为站点可写。
