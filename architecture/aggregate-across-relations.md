# Aggregates across relations

A report groups one entity's rows by a column of a row they point at, and pivots them into columns in the same statement:

```ts
const rows = await querier.aggregate(LedgerEntry, {
  $where: { currency, transaction: { kind: { $in: ['order_paid', 'order_refunded'] } } },
  $group: { orderId: { transaction: { orderId: true } } },
  $select: {
    held: { $sum: { amount: true }, $where: { account: 'buyer_clearing' } },
    fee: { $sum: { amount: true }, $where: { account: 'gateway_expense' } },
  },
});
// [{ orderId, held, fee }]
```

## Why

The alternatives, measured on Postgres 18 over 200k transactions and 800k entries:

| Shape                                                   | All orders | 100 orders |
| :------------------------------------------------------ | :--------- | :--------- |
| a relation aggregate per field, summed (`computed`)     | 395 ms     | 0.6 ms     |
| join, grouped by order and account, pivoted in code     | 281 ms     | 0.5 ms     |
| **join, grouped by order, one filtered sum per column** | **145 ms** | **0.4 ms** |

A relation aggregate is a correlated subquery per parent, which Postgres does not decorrelate. It stays the tool for a value per row - `$select`, `$where`, `$sort` - and this is the tool for a value per group. Prisma, Drizzle, TypeORM, MikroORM, Sequelize and Knex leave the last shape to hand-written SQL; Django (`Sum('amount', filter=Q(...))`), SQLAlchemy, jOOQ and Kysely (`filterWhere`) declare it.

## Grouping by a relation's field

A `$group` key is either a field of the entity, `true`, or an alias naming a to-one relation's field by the path through it:

```ts
$group: { account: true, orderId: { transaction: { orderId: true } } }
```

- **Rows stay flat**, keyed by field or alias, as `$select`'s aliases already are. `$having` and `$sort` name the same keys, and a view's columns are these names - no flattening rule to invent, and every other tool's report rows are flat too. The path is a key map, never a string, so a rename reaches it.
- **An alias may not be a field's name**, and a field key takes only `true`: a typo is still a compile error, since it matches neither.
- **To-one only, at any depth.** A to-many multiplies the rows it joins, and every total with them. Refused by the type and at runtime.
- **A `LEFT JOIN`, from the resolver `$sort` joins with.** A row pointing nowhere groups under `null`. A `$where` on the relation stays the `EXISTS` it is everywhere else; filtering on the join it duplicates is a later optimization worth 145 against 168 ms, and changes no API.
- **Grouped, never aggregated.** Totalling a parent's column counts it once per child.

## A filtered aggregate

`$where` beside the op, the option a relation aggregate already takes (`tx.entries.sum((e) => e.amount, { $where })`), so a declared aggregate and a queried one read the same:

```ts
held: { $sum: { amount: true }, $where: { account: 'buyer_clearing' } }
```

- **The entity's own fields only**, by type. A relation there would be a subquery inside an aggregate, which SQL Server refuses (Msg 130).
- **The entity's filters are not applied again**: the statement's rows already passed them.
- **`CASE WHEN`, on every engine**: `SUM(CASE WHEN … THEN "amount" END)`, `COUNT(CASE WHEN … THEN 1 END)` for `'*'`. `FILTER (WHERE …)` exists on Postgres, CockroachDB and SQLite only, and measured the same (474 against 487 ms over 3M rows), so one rendering serves all.
- **MongoDB** accumulates `{ $cond: [<condition>, '$amount', null] }`. A condition there is an aggregation expression, not a query filter, so the comparisons translate - `$eq`, `$ne`, `$gt(e)`, `$lt(e)`, `$in`, `$nin`, `$between`, `$isNull`, `$isNotNull`, under `$and`, `$or`, `$not`, `$nor` - and any other is refused by name. A null or missing field is tested with `$ifNull`, since an expression compares a missing field as neither null nor a value.
- **A total over no rows is null**, as SQL answers it. MongoDB's `$sum` answers 0, so a count of the values it read sits beside it and the projection reads null where that count is 0.

## The rows an aggregate reads

An aggregate reads a list of values - each group key, each op's argument with its filter - and groups and reduces them. Bare columns it reads inline; anything else, an inlined field or a filter's `CASE`, it reads first as a derived table, naming each value by its alias. SQL Server refuses a subquery inside an aggregate (Msg 130) or a `GROUP BY` (Msg 144), and a filter's bound values would otherwise repeat wherever `$having` or `$sort` names its aggregate.

## Not doing

- **Rewriting relation aggregates into a join.** Summing two `computed` fields is the slow shape above, but turning it into the fast one changes what a row is, and a `$count: '*'` beside it would count entries instead of transactions.
- **`FILTER` where it exists.** Two renderings for no measured gain.
