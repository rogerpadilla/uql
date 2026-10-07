-- `test_bun_maria` is the Bun driver's own, `test_maria` the other database the introspector reads, and
-- the rest one per test file that runs DDL (AGENTS.md). Idempotent, since the healthcheck runs it every
-- interval.
CREATE DATABASE IF NOT EXISTS test_maria;
GRANT ALL PRIVILEGES ON test_maria.* TO 'test'@'%';
CREATE DATABASE IF NOT EXISTS test_bun_maria;
GRANT ALL PRIVILEGES ON test_bun_maria.* TO 'test'@'%';
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
CREATE DATABASE IF NOT EXISTS test_vector;
GRANT ALL PRIVILEGES ON test_vector.* TO 'test'@'%';
