-- One database per test file that runs DDL: SQL Server's catalog locks ignore snapshot isolation, so two
-- files changing one database's schema at once deadlock on `sys.sysschobjs`. Idempotent, since the
-- healthcheck runs it every interval.
IF DB_ID('test') IS NULL BEGIN CREATE DATABASE test; ALTER DATABASE test SET READ_COMMITTED_SNAPSHOT ON; END
IF DB_ID('test_regexp') IS NULL BEGIN CREATE DATABASE test_regexp; ALTER DATABASE test_regexp SET READ_COMMITTED_SNAPSHOT ON; END
IF DB_ID('test_introspector') IS NULL BEGIN CREATE DATABASE test_introspector; ALTER DATABASE test_introspector SET READ_COMMITTED_SNAPSHOT ON; END
IF DB_ID('test_builder') IS NULL BEGIN CREATE DATABASE test_builder; ALTER DATABASE test_builder SET READ_COMMITTED_SNAPSHOT ON; END
IF DB_ID('test_sync') IS NULL BEGIN CREATE DATABASE test_sync; ALTER DATABASE test_sync SET READ_COMMITTED_SNAPSHOT ON; END
SELECT 1
