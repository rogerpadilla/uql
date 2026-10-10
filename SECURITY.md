# Security policy

## Reporting a vulnerability

Report it privately through [GitHub's security advisories](https://github.com/rogerpadilla/uql/security/advisories/new). Please do not open a public issue for it.

Include the version, the database engine, and the smallest query or entity that shows the problem. I aim to answer within 7 days and to release a fix before the report is made public.

## What counts

- A value that reaches the database as SQL instead of a bound parameter.
- A `security` filter, soft-delete filter or tenant context that a query method fails to apply.
- A request to the `/http` handler that reads or writes what its `include` list does not allow.

SQL passed to `raw.text`, or built by string concatenation, is trusted by design and out of scope: the [Raw SQL guide](https://uql-orm.dev/querying/raw-sql) says so.

## Supported versions

Fixes ship in the latest release of `uql-orm` and `uql-codemod`.
