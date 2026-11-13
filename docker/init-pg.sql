-- The drivers' own databases, and one per test file that runs DDL (AGENTS.md). Idempotent, since the
-- healthcheck runs it every interval.
SELECT format('CREATE DATABASE %I', name)
FROM unnest(ARRAY['test_pg', 'test_bun_pg', 'test_neon', 'test_trigger', 'test_drift', 'test_stamp', 'test_default', 'test_check', 'test_defined', 'test_introspector', 'test_builder', 'test_sync', 'test_vector', 'test_alloc', 'test_policy']) AS name
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = name)\gexec
-- The role a native-policy suite connects as: no superuser and no BYPASSRLS, so the database holds it to them.
SELECT 'CREATE ROLE uql_policy LOGIN PASSWORD ''test'' NOSUPERUSER NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uql_policy')\gexec
-- The database roles that suite's context binds, both granted to it: one its policies name, one reading past them.
SELECT 'CREATE ROLE uql_policy_reader NOLOGIN NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uql_policy_reader')\gexec
SELECT 'CREATE ROLE uql_policy_bypass NOLOGIN BYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uql_policy_bypass')\gexec
GRANT uql_policy_reader, uql_policy_bypass TO uql_policy;
