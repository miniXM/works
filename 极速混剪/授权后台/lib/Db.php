<?php
declare(strict_types=1);

/**
 * MySQL 访问层。全部走 PDO 预处理，不拼接用户输入。
 */
final class Db
{
    private PDO $pdo;
    public string $dsn = '';

    public function __construct(array $cfg)
    {
        $host = (string)($cfg['host'] ?? '127.0.0.1');
        $port = (int)($cfg['port'] ?? 3306);
        $name = (string)($cfg['name'] ?? '');
        $user = (string)($cfg['user'] ?? '');
        $pass = (string)($cfg['pass'] ?? '');
        $charset = (string)($cfg['charset'] ?? 'utf8mb4');
        $unixSocket = (string)($cfg['socket'] ?? '');

        if ($name === '') {
            throw new RuntimeException('数据库名没有配置');
        }
        if ($unixSocket !== '') {
            $dsn = 'mysql:unix_socket=' . $unixSocket . ';dbname=' . $name . ';charset=' . $charset;
        } else {
            $dsn = 'mysql:host=' . $host . ';port=' . $port . ';dbname=' . $name . ';charset=' . $charset;
        }
        $this->dsn = $dsn;
        $this->pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ]);
        $this->pdo->exec("SET time_zone = '+00:00'");
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    private function bind(PDOStatement $stmt, array $args): void
    {
        $index = 1;
        foreach ($args as $value) {
            if (is_int($value)) {
                $stmt->bindValue($index, $value, PDO::PARAM_INT);
            } elseif ($value === null) {
                $stmt->bindValue($index, null, PDO::PARAM_NULL);
            } elseif (is_bool($value)) {
                $stmt->bindValue($index, $value ? 1 : 0, PDO::PARAM_INT);
            } else {
                $stmt->bindValue($index, (string)$value, PDO::PARAM_STR);
            }
            $index++;
        }
    }

    public function query(string $sql, array $args = []): array
    {
        $stmt = $this->pdo->prepare($sql);
        $this->bind($stmt, $args);
        $stmt->execute();
        $rows = $stmt->fetchAll();
        $stmt->closeCursor();
        return $rows;
    }

    public function one(string $sql, array $args = []): ?array
    {
        $rows = $this->query($sql, $args);
        return $rows[0] ?? null;
    }

    /** 执行写操作，返回受影响行数。 */
    public function exec(string $sql, array $args = []): int
    {
        $stmt = $this->pdo->prepare($sql);
        $this->bind($stmt, $args);
        $stmt->execute();
        $count = $stmt->rowCount();
        $stmt->closeCursor();
        return $count;
    }

    /** 执行 INSERT，返回自增主键。 */
    public function insert(string $sql, array $args = []): int
    {
        $this->exec($sql, $args);
        return (int)$this->pdo->lastInsertId();
    }

    public function scalar(string $sql, array $args = [])
    {
        $row = $this->one($sql, $args);
        if (!$row) {
            return null;
        }
        $values = array_values($row);
        return $values[0] ?? null;
    }

    public function begin(): void
    {
        $this->pdo->beginTransaction();
    }

    public function commit(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->commit();
        }
    }

    public function rollback(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }
}
