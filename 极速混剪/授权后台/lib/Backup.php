<?php
declare(strict_types=1);

/**
 * 数据备份 / 恢复（DedeCMS 那种思路）：
 *   - 后台点一下，把整库导成 data/backups/videomix-backup-日期时间.sql
 *   - 文件可以下载下来，换服务器时在新站点访问 /install.php 选「用备份恢复」上传即可
 *   - 备份是纯 SQL（CREATE TABLE + INSERT），没有二进制格式，出问题也能手工看
 *
 * 只用 PDO，不依赖 mysqldump。
 */

const VM_BACKUP_HEADER = 'VIDEOMIX_BACKUP v1';
const VM_BACKUP_MAX_BYTES = 512 * 1024 * 1024;

/**
 * SQL 语句扫描器：按分号切句，能正确跳过字符串 / 反引号 / 注释里的分号。
 * 这样还原大文件时可以边读边执行，不用把整个文件塞进内存。
 */
final class SqlScriptScanner
{
    private string $buffer = '';
    private bool $inSingle = false;
    private bool $inDouble = false;
    private bool $inBacktick = false;
    private bool $inLineComment = false;
    private bool $inBlockComment = false;
    private bool $escape = false;

    /** 喂一段文本，返回其中已经完整的语句。 */
    public function feed(string $chunk): array
    {
        $statements = [];
        $length = strlen($chunk);
        for ($i = 0; $i < $length; $i++) {
            $ch = $chunk[$i];
            $next = ($i + 1 < $length) ? $chunk[$i + 1] : '';

            if ($this->inLineComment) {
                if ($ch === "\n") {
                    $this->inLineComment = false;
                    $this->buffer .= "\n";
                }
                continue;
            }
            if ($this->inBlockComment) {
                if ($ch === '*' && $next === '/') {
                    $this->inBlockComment = false;
                    $i++;
                }
                continue;
            }
            if ($this->inSingle || $this->inDouble || $this->inBacktick) {
                $this->buffer .= $ch;
                if ($this->escape) {
                    $this->escape = false;
                    continue;
                }
                if ($ch === '\\' && !$this->inBacktick) {
                    $this->escape = true;
                    continue;
                }
                if ($this->inSingle && $ch === "'") {
                    if ($next === "'") {
                        $this->buffer .= $next;
                        $i++;
                        continue;
                    }
                    $this->inSingle = false;
                } elseif ($this->inDouble && $ch === '"') {
                    if ($next === '"') {
                        $this->buffer .= $next;
                        $i++;
                        continue;
                    }
                    $this->inDouble = false;
                } elseif ($this->inBacktick && $ch === '`') {
                    if ($next === '`') {
                        $this->buffer .= $next;
                        $i++;
                        continue;
                    }
                    $this->inBacktick = false;
                }
                continue;
            }

            // 普通状态
            if ($ch === '-' && $next === '-') {
                $this->inLineComment = true;
                $i++;
                continue;
            }
            if ($ch === '#') {
                $this->inLineComment = true;
                continue;
            }
            if ($ch === '/' && $next === '*') {
                $this->inBlockComment = true;
                $i++;
                continue;
            }
            if ($ch === "'") {
                $this->inSingle = true;
                $this->buffer .= $ch;
                continue;
            }
            if ($ch === '"') {
                $this->inDouble = true;
                $this->buffer .= $ch;
                continue;
            }
            if ($ch === '`') {
                $this->inBacktick = true;
                $this->buffer .= $ch;
                continue;
            }
            if ($ch === ';') {
                $statement = trim($this->buffer);
                $this->buffer = '';
                if ($statement !== '') {
                    $statements[] = $statement;
                }
                continue;
            }
            $this->buffer .= $ch;
        }
        return $statements;
    }

    /** 收尾：文件最后一句可能没写分号。 */
    public function flush(): array
    {
        $statement = trim($this->buffer);
        $this->buffer = '';
        return $statement === '' ? [] : [$statement];
    }
}

final class Backup
{
    /** 文件名安全校验：只允许字母数字点横线，且必须是 .sql。 */
    public static function safeName(string $name): string
    {
        $name = trim($name);
        if ($name === '' || strpos($name, '..') !== false) {
            throw new ApiError(400, '备份文件名不合法');
        }
        if (!preg_match('/^[A-Za-z0-9._-]+\.sql$/', $name)) {
            throw new ApiError(400, '备份文件名不合法（只允许字母、数字、点、横线和下划线）');
        }
        return $name;
    }

    public static function ensureDir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new ApiError(500, '备份目录建不出来，请检查权限：' . $dir);
        }
    }

    /** 列出目录里所有备份（新的在前）。 */
    public static function listFiles(string $dir): array
    {
        if (!is_dir($dir)) {
            return [];
        }
        $items = [];
        foreach (scandir($dir) ?: [] as $name) {
            if (!preg_match('/\.sql$/', $name)) {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $name;
            if (!is_file($path)) {
                continue;
            }
            $size = (int)filesize($path);
            $mtime = (int)filemtime($path);
            $items[] = [
                'name'      => $name,
                'size'      => $size,
                'sizeText'  => self::humanSize($size),
                'createdAt' => gmdate('Y-m-d\TH:i:s\Z', $mtime),
                'download'  => '/api/backups/' . rawurlencode($name) . '/download',
            ];
        }
        usort($items, static fn(array $a, array $b): int => strcmp($b['name'], $a['name']));
        return $items;
    }

    public static function humanSize(int $bytes): string
    {
        if ($bytes >= 1024 * 1024 * 1024) {
            return round($bytes / 1024 / 1024 / 1024, 2) . ' GB';
        }
        if ($bytes >= 1024 * 1024) {
            return round($bytes / 1024 / 1024, 1) . ' MB';
        }
        if ($bytes >= 1024) {
            return round($bytes / 1024, 1) . ' KB';
        }
        return $bytes . ' B';
    }

    /**
     * 把整个库导成一个 .sql 文件。
     * 返回 ['name','size','sizeText','createdAt','tables','rows']
     */
    public static function dump(PDO $pdo, string $dir, string $label = '', string $version = ''): array
    {
        self::ensureDir($dir);
        $stamp = gmdate('Ymd-His');
        $suffix = '';
        if ($label !== '') {
            $clean = preg_replace('/[^A-Za-z0-9_-]+/', '', $label) ?? '';
            $clean = trim(substr($clean, 0, 24), '-_');
            if ($clean !== '') {
                $suffix = '-' . $clean;
            }
        }
        $name = 'videomix-backup-' . $stamp . $suffix . '.sql';
        $final = $dir . DIRECTORY_SEPARATOR . $name;
        $temp = $final . '.part';

        $handle = fopen($temp, 'wb');
        if ($handle === false) {
            throw new ApiError(500, '写不了备份文件，请检查 data/backups 目录权限');
        }

        $written = 0;
        $write = static function (string $text) use ($handle, &$written): void {
            fwrite($handle, $text);
            $written += strlen($text);
        };

        try {
            $write("-- " . VM_BACKUP_HEADER . "\n");
            $write("-- VideoMix 授权中心数据库备份\n");
            $write("-- 生成时间：" . gmdate('Y-m-d H:i:s') . " UTC\n");
            if ($version !== '') {
                $write("-- 程序版本：" . $version . "\n");
            }
            $write("-- 恢复方法：把程序部署到新服务器，建好空库，访问 /install.php，\n");
            $write("--           在「安装方式」里选「用备份文件恢复」，上传本文件即可。\n");
            $write("-- 注意：本文件包含全部激活码、代理商账号和授权签名私钥，请妥善保管。\n\n");
            $write("SET NAMES utf8mb4;\n");
            $write("SET FOREIGN_KEY_CHECKS = 0;\n\n");

            $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
            $rowTotal = 0;
            foreach ($tables as $table) {
                $quoted = '`' . str_replace('`', '``', (string)$table) . '`';
                $createRow = $pdo->query('SHOW CREATE TABLE ' . $quoted)->fetch(PDO::FETCH_NUM);
                $ddl = $createRow[1] ?? '';
                $write("-- ------------------------------ 表 " . $table . " ------------------------------\n");
                $write('DROP TABLE IF EXISTS ' . $quoted . ";\n");
                $write($ddl . ";\n\n");

                $offset = 0;
                $chunk = 500;
                while (true) {
                    $rows = $pdo->query('SELECT * FROM ' . $quoted . ' LIMIT ' . $chunk . ' OFFSET ' . $offset)
                        ->fetchAll(PDO::FETCH_ASSOC);
                    if (!$rows) {
                        break;
                    }
                    $columns = array_keys($rows[0]);
                    $columnSql = '(`' . implode('`,`', array_map(
                        static fn(string $c): string => str_replace('`', '``', $c),
                        $columns
                    )) . '`)';
                    $buffer = [];
                    foreach ($rows as $row) {
                        $values = [];
                        foreach ($row as $value) {
                            $values[] = $value === null ? 'NULL' : $pdo->quote((string)$value);
                        }
                        $buffer[] = '(' . implode(',', $values) . ')';
                        $rowTotal++;
                        if (count($buffer) >= 50) {
                            $write('INSERT INTO ' . $quoted . ' ' . $columnSql . ' VALUES '
                                . implode(',', $buffer) . ";\n");
                            $buffer = [];
                        }
                    }
                    if ($buffer) {
                        $write('INSERT INTO ' . $quoted . ' ' . $columnSql . ' VALUES '
                            . implode(',', $buffer) . ";\n");
                    }
                    $offset += count($rows);
                    if (count($rows) < $chunk) {
                        break;
                    }
                }
                $write("\n");
            }
            $write("SET FOREIGN_KEY_CHECKS = 1;\n");
            $write("-- 备份完成，共 " . count($tables) . " 张表、" . $rowTotal . " 行数据。\n");
        } finally {
            fclose($handle);
        }

        if (is_file($final)) {
            @unlink($final);
        }
        if (!@rename($temp, $final)) {
            @unlink($temp);
            throw new ApiError(500, '备份文件保存失败，请检查目录权限');
        }
        @chmod($final, 0644);

        return [
            'name'      => $name,
            'size'      => $written,
            'sizeText'  => self::humanSize($written),
            'createdAt' => gmdate('Y-m-d\TH:i:s\Z', (int)filemtime($final)),
        ];
    }

    /** 执行一个 .sql 文件，返回执行的语句条数。 */
    public static function restore(PDO $pdo, string $path): int
    {
        if (!is_file($path)) {
            throw new ApiError(400, '备份文件不存在');
        }
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw new ApiError(500, '读不了备份文件');
        }
        $scanner = new SqlScriptScanner();
        $count = 0;
        $first = true;
        try {
            while (!feof($handle)) {
                $chunk = fread($handle, 256 * 1024);
                if ($chunk === false || $chunk === '') {
                    break;
                }
                if ($first) {
                    // 去掉 UTF-8 BOM
                    $chunk = preg_replace('/^\xEF\xBB\xBF/', '', $chunk) ?? $chunk;
                    $first = false;
                }
                foreach ($scanner->feed($chunk) as $statement) {
                    $pdo->exec($statement);
                    $count++;
                }
            }
            foreach ($scanner->flush() as $statement) {
                $pdo->exec($statement);
                $count++;
            }
        } finally {
            fclose($handle);
        }
        return $count;
    }

    public static function delete(string $dir, string $name): void
    {
        $name = self::safeName($name);
        $path = $dir . DIRECTORY_SEPARATOR . $name;
        if (!is_file($path)) {
            throw new ApiError(400, '备份文件不存在');
        }
        if (!@unlink($path)) {
            throw new ApiError(500, '删不掉备份文件，请检查目录权限');
        }
    }

    /**
     * 处理上传上来的备份：支持 .sql，也支持打包成 .zip 的。
     * 返回落在 $dir 里的 .sql 路径。
     */
    public static function importUpload(string $tmpPath, string $originalName, string $dir): string
    {
        self::ensureDir($dir);
        if (!is_file($tmpPath) || filesize($tmpPath) === 0) {
            throw new ApiError(400, '没有收到备份文件内容');
        }
        $looksZip = preg_match('/\.zip$/i', $originalName) === 1;
        if (!$looksZip) {
            $head = (string)file_get_contents($tmpPath, false, null, 0, 4);
            $looksZip = strncmp($head, "PK\x03\x04", 4) === 0;
        }

        if ($looksZip) {
            if (!class_exists('ZipArchive')) {
                throw new ApiError(400, '服务器 PHP 没开 zip 扩展，请直接上传 .sql 文件');
            }
            $zip = new ZipArchive();
            if ($zip->open($tmpPath) !== true) {
                throw new ApiError(400, 'zip 文件打不开，可能已损坏');
            }
            $target = '';
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = (string)$zip->getNameIndex($i);
                if (preg_match('/\.sql$/i', $entry) && substr($entry, -1) !== '/') {
                    $target = $entry;
                    break;
                }
            }
            if ($target === '') {
                $zip->close();
                throw new ApiError(400, '这个压缩包里没有 .sql 备份文件');
            }
            $content = $zip->getFromName($target);
            $zip->close();
            if ($content === false) {
                throw new ApiError(400, '压缩包里的备份文件读不出来');
            }
            $name = self::uploadName(basename($target));
            $path = $dir . DIRECTORY_SEPARATOR . $name;
            file_put_contents($path, $content);
            return $path;
        }

        $name = self::uploadName($originalName);
        $path = $dir . DIRECTORY_SEPARATOR . $name;
        if (!@copy($tmpPath, $path)) {
            // 上传目录和临时目录不在同一个盘时用流式复制
            $in = fopen($tmpPath, 'rb');
            $out = fopen($path, 'wb');
            if ($in === false || $out === false) {
                throw new ApiError(500, '保存备份文件失败，请检查目录权限');
            }
            stream_copy_to_stream($in, $out);
            fclose($in);
            fclose($out);
        }
        return $path;
    }

    /** 给上传的备份起一个不会覆盖别人、也不会被路径穿越的文件名。 */
    private static function uploadName(string $originalName): string
    {
        $base = pathinfo($originalName, PATHINFO_FILENAME);
        $base = preg_replace('/[^A-Za-z0-9_-]+/', '-', (string)$base) ?? '';
        $base = trim(substr($base, 0, 40), '-_');
        if ($base === '') {
            $base = 'upload';
        }
        return 'videomix-upload-' . gmdate('Ymd-His') . '-' . substr(bin2hex(random_bytes(3)), 0, 6)
            . '-' . $base . '.sql';
    }
}
