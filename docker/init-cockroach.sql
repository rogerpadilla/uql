-- Idempotent, since the healthcheck runs it every interval. A dropped table's data waits out this window
-- before its cleanup job ends: the 4-hour default leaves a job running for every table the suites drop,
-- thousands a day, until schema changes crawl.
ALTER RANGE default CONFIGURE ZONE USING gc.ttlseconds = 60;
-- The store is in memory, so whatever piles up in it slows the server: a finished job's record, kept 14 days by
-- default (each full test run leaves ~750), every distinct statement's statistics, flushed every 10 minutes, and
-- an event per schema change (~1800 a run), kept 90 days.
SET CLUSTER SETTING jobs.retention_time = '1m';
SET CLUSTER SETTING jobs.registry.interval.gc = '1m';
SET CLUSTER SETTING sql.stats.flush.enabled = false;
SET CLUSTER SETTING sql.stats.activity.flush.enabled = false;
SET CLUSTER SETTING server.eventlog.enabled = false;
-- Every table the suites create would start a statistics job of its own.
SET CLUSTER SETTING sql.stats.automatic_collection.enabled = false;
-- The drivers' own databases, and one per test file that runs DDL (AGENTS.md).
CREATE DATABASE IF NOT EXISTS test_crdb;
CREATE DATABASE IF NOT EXISTS test_bun_crdb;
CREATE DATABASE IF NOT EXISTS test_trigger;
CREATE DATABASE IF NOT EXISTS test_drift;
CREATE DATABASE IF NOT EXISTS test_stamp;
CREATE DATABASE IF NOT EXISTS test_default;
CREATE DATABASE IF NOT EXISTS test_check;
CREATE DATABASE IF NOT EXISTS test_introspector;
CREATE DATABASE IF NOT EXISTS test_builder;
CREATE DATABASE IF NOT EXISTS test_sync;
CREATE DATABASE IF NOT EXISTS test_vector;
