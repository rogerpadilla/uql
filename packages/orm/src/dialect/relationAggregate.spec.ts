import { describe, expect, it } from 'vitest';
import { defineField, Entity, Field, Id, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import type { Query, QueryAggregate } from '../type/index.js';
import { memberRefs, raw } from '../util/index.js';

/**
 * A field a relation aggregate computes reads as the correlated subquery `$count` already emits, so
 * every clause that names one - the projection, `$where`, `$sort` - writes the same SQL.
 */
@Entity()
class Task {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Project, type: Number }) projectId?: number | null;
  @ManyToOne({ entity: () => Project, references: (task) => task.projectId }) project?: Project;
  @Field({ type: Number }) hours?: number | null;
  @Field({ type: Boolean }) done?: boolean | null;
}

@Entity()
class Tag {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) weight?: number | null;
}

@Entity()
class ProjectTag {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Project, type: Number }) projectId?: number | null;
  @Field({ references: () => Tag, type: Number }) tagId?: number | null;
}

@Entity()
class Project {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) owner?: string | null;

  @OneToMany({ entity: () => Task, mappedBy: (task) => task.project })
  tasks?: Task[];

  @ManyToMany({ entity: () => Tag, through: () => ProjectTag })
  tags?: Tag[];

  @Field({ computed: (project) => project.tasks.count() })
  readonly taskCount?: number;

  @Field({ computed: (project) => project.tasks.count({ $where: { done: true } }) })
  readonly doneCount?: number;

  @Field({ computed: (project) => project.tasks.sum((task) => task.hours) })
  readonly totalHours?: number;

  @Field({ computed: (project) => project.tasks.max((task) => task.hours) })
  readonly longestTask?: number | null;

  @Field({ computed: (project) => project.tags.count() })
  readonly tagCount?: number;

  /** A column of the far side of a many-to-many: reachable as a page, which reads the target itself. */
  @Field({ computed: (project) => project.tags.max((tag) => tag.weight, { $sort: { weight: -1 }, $limit: 1 }) })
  readonly heaviestTag?: number | null;

  /** The same column without one: a many-to-many counts the junction's rows, which hold no weight. */
  @Field({ computed: (project) => project.tags.max((tag) => tag.weight) })
  readonly unpagedTagWeight?: number | null;

  /** Capped: the page is read first, then aggregated over, so the cap applies to rows and not to the answer. */
  @Field({ computed: (project) => project.tasks.count({ $limit: 100 }) })
  readonly cappedCount?: number;

  @Field({
    computed: (project) => project.tasks.sum((task) => task.hours, { $sort: { hours: -1 }, $limit: 5, $skip: 1 }),
  })
  readonly topHours?: number;
}

describe('relation aggregate', () => {
  const dialect = new PostgresDialect();
  const sqlOf = (q: Query<Project>): string => {
    const ctx = dialect.createContext();
    dialect.find(ctx, Project, q);
    return ctx.sql;
  };
  const aggregateOf = (q: QueryAggregate<Project>): { sql: string; values: unknown[] } => {
    const ctx = dialect.createContext();
    dialect.aggregate(ctx, Project, q);
    return { sql: ctx.sql, values: ctx.values };
  };

  it('should read a count as a correlated subquery', () => {
    expect(sqlOf({ $select: { id: true, taskCount: true } })).toBe(
      'SELECT "id", (SELECT COUNT(*) FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id") "taskCount" FROM "Project"',
    );
  });

  it('should apply the aggregate filter to the subquery', () => {
    expect(sqlOf({ $select: { doneCount: true } })).toBe(
      'SELECT (SELECT COUNT(*) FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id" AND "tasks"."done" = $1) "doneCount" FROM "Project"',
    );
  });

  it('should total a column of the target, reading zero where it has no rows', () => {
    expect(sqlOf({ $select: { totalHours: true } })).toBe(
      'SELECT (SELECT COALESCE(SUM("tasks"."hours"), 0) FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id") "totalHours" FROM "Project"',
    );
  });

  it('should read a max as the engine answers it, which is null with no rows', () => {
    expect(sqlOf({ $select: { longestTask: true } })).toBe(
      'SELECT (SELECT MAX("tasks"."hours") FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id") "longestTask" FROM "Project"',
    );
  });

  it('should count the rows of a junction', () => {
    expect(sqlOf({ $select: { tagCount: true } })).toContain('SELECT COUNT(*) FROM "ProjectTag"');
  });

  it('should count no more rows than the cap, over the page it reads', () => {
    expect(sqlOf({ $select: { cappedCount: true } })).toBe(
      'SELECT (SELECT COUNT(*) FROM (SELECT 1 "_uql_value" FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id" LIMIT 100) "_uql_page") "cappedCount" FROM "Project"',
    );
  });

  it('should total the page a capped sum reads, carrying its column out under one alias', () => {
    expect(sqlOf({ $select: { topHours: true } })).toBe(
      'SELECT (SELECT COALESCE(SUM("_uql_page"."_uql_value"), 0) FROM (SELECT "tasks"."hours" "_uql_value" FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id" ORDER BY "tasks"."hours" DESC LIMIT 5 OFFSET 1) "_uql_page") "topHours" FROM "Project"',
    );
  });

  it('should read a column of a many-to-many target through its page', () => {
    const sql = sqlOf({ $select: { heaviestTag: true } });
    expect(sql).toContain('SELECT MAX("_uql_page"."_uql_value") FROM (SELECT "tags"."weight" "_uql_value" FROM "Tag"');
    expect(sql).toContain('ORDER BY "tags"."weight" DESC LIMIT 1');
  });

  it("should refuse a column of a many-to-many target without a page, whose rows are the junction's", () => {
    expect(() => sqlOf({ $select: { unpagedTagWeight: true } })).toThrow(
      "cannot read $max('weight') over the many-to-many 'tags' without a page",
    );
  });

  // The expression itself, never the output alias: `$where` cannot assume the field was selected.
  it('should compare the subquery in a $where', () => {
    expect(sqlOf({ $select: { id: true }, $where: { taskCount: { $gt: 3 } } })).toBe(
      'SELECT "id" FROM "Project" WHERE (SELECT COUNT(*) FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id") > $1',
    );
  });

  /** The subquery is spliced into each read, so there is nothing for a generated column to hold. */
  it('should refuse to store one', () => {
    expect(() =>
      defineField(Project, 'storedTaskCount', {
        type: Number,
        computed: memberRefs<Project>().tasks.count(),
        stored: true,
      }),
    ).toThrow("cannot be 'stored'");
  });

  /** Read off a definition's refs, an aggregate names no entity: it renders only inside its own. */
  it('should refuse to render outside the entity that declares it', () => {
    const ctx = dialect.createContext();
    const orphan = memberRefs<Project>().tasks.count();
    expect(() => dialect.find(ctx, Project, { $select: [raw`${orphan}`.as('x')] })).toThrow(
      "'tasks' was read off a definition's refs",
    );
  });

  it('should order by the subquery in a $sort', () => {
    expect(sqlOf({ $select: { id: true }, $sort: { taskCount: -1 } })).toBe(
      'SELECT "id" FROM "Project" ORDER BY (SELECT COUNT(*) FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id") DESC',
    );
  });

  /** SQL Server refuses a subquery inside an aggregate or a `GROUP BY`, so the rows computing one are read first. */
  it('should aggregate over the rows computing the field it names', () => {
    expect(
      aggregateOf({
        $where: { id: { $gt: 1 } },
        $group: { owner: true },
        $select: { hours: { $sum: { totalHours: true } }, done: { $sum: { doneCount: true } } },
      }),
    ).toEqual({
      sql: 'SELECT "owner", SUM("hours") "hours", SUM("done") "done" FROM (SELECT "owner", (SELECT COALESCE(SUM("tasks"."hours"), 0) FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id") "hours", (SELECT COUNT(*) FROM "Task" "tasks_2" WHERE "tasks_2"."projectId" = "Project"."id" AND "tasks_2"."done" = $1) "done" FROM "Project" WHERE "id" > $2) "_uql_rows" GROUP BY "owner"',
      values: [true, 1],
    });
  });

  it('should group by the field over the rows computing it', () => {
    expect(
      aggregateOf({
        $group: { taskCount: true },
        $select: { n: { $count: '*' } },
        $having: { n: { $gt: 1 } },
        $sort: { taskCount: -1 },
      }).sql,
    ).toBe(
      'SELECT "taskCount", COUNT(*) "n" FROM (SELECT (SELECT COUNT(*) FROM "Task" "tasks" WHERE "tasks"."projectId" = "Project"."id") "taskCount" FROM "Project") "_uql_rows" GROUP BY "taskCount" HAVING COUNT(*) > $1 ORDER BY "taskCount" DESC',
    );
  });

  it('should read the table itself where the aggregate names no computed field', () => {
    expect(aggregateOf({ $group: { owner: true }, $select: { n: { $count: '*' } } }).sql).toBe(
      'SELECT "owner", COUNT(*) "n" FROM "Project" GROUP BY "owner"',
    );
  });
});
