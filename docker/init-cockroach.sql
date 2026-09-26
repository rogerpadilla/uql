-- A dropped table's data waits out this window before its cleanup job ends. The 4-hour default leaves
-- a job running for every table the suites drop, thousands a day, until schema changes crawl.
ALTER RANGE default CONFIGURE ZONE USING gc.ttlseconds = 60;
-- Every table the suites create would start a statistics job of its own.
SET CLUSTER SETTING sql.stats.automatic_collection.enabled = false;
