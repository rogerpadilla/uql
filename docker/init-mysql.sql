-- The drivers' own databases, and one per test file that runs DDL (AGENTS.md). Idempotent, since the
-- healthcheck runs it every interval.
CREATE DATABASE IF NOT EXISTS test_mysql;
GRANT ALL PRIVILEGES ON test_mysql.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_bun_mysql;
GRANT ALL PRIVILEGES ON test_bun_mysql.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_trigger;
GRANT ALL PRIVILEGES ON test_trigger.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_drift;
GRANT ALL PRIVILEGES ON test_drift.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_stamp;
GRANT ALL PRIVILEGES ON test_stamp.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_default;
GRANT ALL PRIVILEGES ON test_default.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_check;
GRANT ALL PRIVILEGES ON test_check.* TO 'test'@'%';
