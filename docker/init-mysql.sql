-- `test_bun_mysql` is the Bun driver's own, `test_mysql` the other database the introspector reads, and
-- the rest one per test file that runs DDL (AGENTS.md). Idempotent, since the healthcheck runs it every
-- interval.
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
CREATE DATABASE IF NOT EXISTS test_introspector;
GRANT ALL PRIVILEGES ON test_introspector.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_builder;
GRANT ALL PRIVILEGES ON test_builder.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_sync;
GRANT ALL PRIVILEGES ON test_sync.* TO 'test'@'%';
