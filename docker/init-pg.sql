-- The drivers' own databases, and one per test file that runs DDL (AGENTS.md). Idempotent, since the
-- healthcheck runs it every interval.
SELECT format('CREATE DATABASE %I', name)
FROM unnest(ARRAY['test_pg', 'test_bun_pg', 'test_neon', 'test_trigger', 'test_drift', 'test_stamp', 'test_default', 'test_check', 'test_introspector', 'test_builder', 'test_sync', 'test_vector', 'test_alloc']) AS name
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = name)\gexec
