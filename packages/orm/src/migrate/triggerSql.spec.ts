import { afterAll, describe, expect, it } from 'vitest';
import { CockroachDialect } from '../cockroachdb/cockroachDialect.js';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { Entity, Field, Filter, Id, removeEntity } from '../entity/index.js';
import { getMeta } from '../entity/metadata/definition.js';
import { MariaDialect } from '../maria/mariaDialect.js';
import { MsSqlDialect } from '../mssql/mssqlDialect.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { idKey } from '../type/index.js';
import type { EntityTriggerMeta, Json } from '../type/index.js';
import { raw } from '../util/raw.js';
import { deleteFrom, insertInto, updateTable } from '../util/triggerWrite.js';
import { dropTrigger, renderTrigger, stampTriggers } from './triggerSql.js';

@Entity()
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  @Field({ type: String }) searchVector?: string | null;
}

const stamp: EntityTriggerMeta<Post> = {
  on: 'beforeUpdate',
  of: ['body'],
  run: { postgres: (newRow) => raw`${newRow.searchVector} := ${newRow.body};` },
};

const plain: EntityTriggerMeta<object> = { on: 'beforeUpdate', run: { postgres: () => raw`SELECT 1;` } };

/** SQL Server has no BEFORE trigger, so anything rendered for it fires after the write. */
const setBased: EntityTriggerMeta<Post> = { on: 'afterUpdate', run: { mssql: () => raw`SELECT 1;` } };

const render = (dialect: AbstractSqlDialect, trigger: EntityTriggerMeta<Post>, i = 0) =>
  renderTrigger(dialect, getMeta(Post), trigger, i).statements;

const nameOf = (dialect: AbstractSqlDialect, trigger: EntityTriggerMeta<Post>, i = 0) =>
  renderTrigger(dialect, getMeta(Post), trigger, i).name;

afterAll(() => removeEntity(Post));

describe('renderTrigger', () => {
  it('should name it after the table, the event and its position, marked as uql owns it', () => {
    expect(nameOf(new PostgresDialect(), stamp)).toMatch(/^_uql_Post__beforeUpdate_0_[0-9a-f]{6}$/);
  });

  // A label, not the identifier: uql owns what it installs, or it could not tell its own objects from
  // hand-written ones, and two entities labelling a trigger alike would collide on a schema-scoped engine.
  it('should build the identifier from the label rather than installing it raw', () => {
    expect(nameOf(new PostgresDialect(), { ...stamp, name: 'searchVector' })).toMatch(/^_uql_Post__searchVector_/);
  });

  // Doubled between table and label, as `derivedConstraintName` does and for the same reason: joined by
  // one underscore, table `Post` labelled `a_b` and table `Post_a` labelled `b` are the same identifier.
  it('should separate the table from the label so neither can absorb the other', () => {
    expect(nameOf(new PostgresDialect(), { ...stamp, name: 'a_b' })).toMatch(/^_uql_Post__a_b_/);
  });

  it('should keep two entities sharing a label apart', () => {
    @Entity({ name: 'Page' })
    class Page {
      @Id({ type: Number }) id?: number;
    }
    expect(nameOf(new PostgresDialect(), { ...stamp, name: 'audit' })).toMatch(/^_uql_Post__audit_/);
    expect(renderTrigger(new PostgresDialect(), getMeta(Page), { ...plain, name: 'audit' }, 0).name).toMatch(
      /^_uql_Page__audit_/,
    );
    removeEntity(Page);
  });

  // The hash is the whole of change detection: the same trigger is the same name on every run, and an
  // edited one a different name, which is what `sync` and `generate:entities` compare installed ones by.
  it('should keep its name while the trigger stays the same, and change it with the SQL', () => {
    const dialect = new PostgresDialect();
    expect(nameOf(dialect, stamp)).toBe(nameOf(dialect, stamp));
    expect(nameOf(dialect, { ...stamp, of: undefined })).not.toBe(nameOf(dialect, stamp));
    expect(nameOf(dialect, { ...stamp, run: { postgres: (newRow) => raw`${newRow.searchVector} := NULL;` } })).not.toBe(
      nameOf(dialect, stamp),
    );
  });

  it('should install it under the name it reports', () => {
    const { name, statements } = renderTrigger(new PostgresDialect(), getMeta(Post), stamp, 0);
    expect(statements.join('\n')).toContain(`CREATE TRIGGER "${name}"`);
  });

  it('should keep a name, hash included, inside the shortest identifier every engine accepts', () => {
    @Entity({ name: 'A'.repeat(60) })
    class Long {
      @Id({ type: Number }) id?: number;
    }
    const { name } = renderTrigger(new PostgresDialect(), getMeta(Long), plain, 0);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/_[0-9a-f]{6}$/);
    removeEntity(Long);
  });

  // A name only ever stands for one trigger, so nothing is created where it already exists: no drop
  // first, and no `OR REPLACE`, which MySQL and SQLite do not have anyway.
  it('should create it outright, on every engine', () => {
    for (const dialect of [new PostgresDialect(), new MySqlDialect(), new MariaDialect(), new SqliteDialect()]) {
      const sql = render(dialect, { ...stamp, run: { [dialect.dialectName]: () => raw`SELECT 1;` } }).join('\n');
      expect(sql).toContain('CREATE TRIGGER');
      expect(sql).not.toContain('DROP TRIGGER');
    }
    expect(render(new MsSqlDialect(), setBased).join('\n')).toContain('CREATE TRIGGER');
  });
});

describe('dropTrigger', () => {
  // Only the Postgres family scopes a trigger name to its table; elsewhere `DROP TRIGGER x ON t` is a syntax error.
  it('should name the table only where the engine scopes the name to one', () => {
    expect(dropTrigger(new PostgresDialect(), getMeta(Post), '_uql_Post__x')[0]).toContain('ON "Post"');
    expect(dropTrigger(new MySqlDialect(), getMeta(Post), '_uql_Post__x')[0]).not.toContain(' ON ');
  });

  // Dropping a trigger leaves the function it called, which would pile up with every edited body.
  it('should drop the function holding the body where the engine keeps one', () => {
    expect(dropTrigger(new PostgresDialect(), getMeta(Post), '_uql_Post__x')).toEqual([
      'DROP TRIGGER IF EXISTS "_uql_Post__x" ON "Post"',
      'DROP FUNCTION IF EXISTS "_uql_Post__x"()',
    ]);
    expect(dropTrigger(new MySqlDialect(), getMeta(Post), '_uql_Post__x')).toEqual([
      'DROP TRIGGER IF EXISTS `_uql_Post__x`',
    ]);
  });
});

describe('the body, where the engine keeps it', () => {
  it('should wrap it in a function of its own on the Postgres family, named as the trigger is', () => {
    const { name, statements } = renderTrigger(new PostgresDialect(), getMeta(Post), stamp, 0);
    expect(statements.join('\n')).toContain(`CREATE OR REPLACE FUNCTION "${name}"() RETURNS trigger`);
    expect(statements.join('\n')).toContain(`EXECUTE FUNCTION "${name}"()`);
  });

  it('should inline it everywhere else', () => {
    const create = render(new MySqlDialect(), {
      ...stamp,
      run: { mysql: (newRow) => raw`SET @x = ${newRow.body};` },
    });
    expect(create.join('\n')).not.toContain('CREATE FUNCTION');
    expect(create.join('\n')).toContain('SET @x = NEW.`body`;');
  });
});

describe('what a body opens with', () => {
  // A T-SQL trigger running its own DML sends a rowcount back, which the client reads as what the
  // original statement affected. `SET NOCOUNT ON` is what every hand-written one starts with.
  it('should quiet the rowcount on SQL Server, ahead of the guard', () => {
    const sql = render(new MsSqlDialect(), { ...setBased, of: ['body'] }).join('\n');
    expect(sql).toContain('AS\nBEGIN\nSET NOCOUNT ON;\nIF EXISTS');
  });

  it('should open with nothing where the engine needs none', () => {
    for (const dialect of [new PostgresDialect(), new MySqlDialect(), new SqliteDialect()]) {
      expect(
        render(dialect, {
          ...stamp,
          run: { postgres: () => raw`SELECT 1;`, mysql: () => raw`SELECT 1;`, sqlite: () => raw`SELECT 1;` },
        }).join('\n'),
      ).not.toContain('NOCOUNT');
    }
  });
});

describe('the guard, however the engine states one', () => {
  it('should emit UPDATE OF and a null-safe WHEN where the engine takes both', () => {
    const sql = render(new PostgresDialect(), stamp).join('\n');
    expect(sql).toContain('BEFORE UPDATE OF "body" ON "Post"');
    expect(sql).toContain('WHEN (OLD."body" IS DISTINCT FROM NEW."body")');
  });

  it('should spell the comparison as SQLite does, beside its own UPDATE OF', () => {
    const sql = render(new SqliteDialect(), {
      ...stamp,
      run: { sqlite: (newRow) => raw`SELECT ${newRow.body};` },
    }).join('\n');
    expect(sql).toContain('BEFORE UPDATE OF `body` ON `Post`');
    expect(sql).toContain('WHEN (OLD.`body` IS NOT NEW.`body`)');
  });

  // SQL Server is handed the rows as tables, so the same comparison is made over a join between them
  // rather than dropped for `UPDATE(col)`, which would fire on a column merely assigned. `EXCEPT` is
  // what makes it null-safe on every version of the engine.
  it('should compare the two sets on SQL Server, so the declaration means one thing everywhere', () => {
    const sql = render(new MsSqlDialect(), { ...setBased, of: ['body'] }).join('\n');
    expect(sql).toContain(
      'IF EXISTS (SELECT 1 FROM inserted JOIN deleted ON inserted."id" = deleted."id" ' +
        'WHERE EXISTS (SELECT deleted."body" EXCEPT SELECT inserted."body"))',
    );
    expect(sql).not.toContain('UPDATE("body")');
    expect(sql).not.toContain('END IF;');
  });

  it('should or two watched columns together on a set-based engine too', () => {
    const sql = render(new MsSqlDialect(), { ...setBased, of: ['body', 'searchVector'] }).join('\n');
    expect(sql).toContain(
      'WHERE (EXISTS (SELECT deleted."body" EXCEPT SELECT inserted."body") ' +
        'OR EXISTS (SELECT deleted."searchVector" EXCEPT SELECT inserted."searchVector")))',
    );
  });

  it('should refuse a where on a set-based engine, where no condition can read one row', () => {
    expect(() => render(new MsSqlDialect(), { ...setBased, where: { $new: { body: { $ne: null } } } })).toThrow(
      /once per statement/,
    );
  });

  // Measured, not assumed: CockroachDB has no `UPDATE OF`, and its `WHEN` resolves neither OLD nor NEW,
  // so the guard has to go inside the body. The body itself is written once, for Postgres.
  it('should emulate the guard in the body on CockroachDB, which has no usable WHEN', () => {
    const sql = render(new CockroachDialect(), stamp).join('\n');
    expect(sql).toContain('BEFORE UPDATE ON "Post"');
    expect(sql).not.toContain('UPDATE OF');
    expect(sql).not.toContain('WHEN (');
    expect(sql).toContain('IF OLD."body" IS DISTINCT FROM NEW."body" THEN');
  });

  it('should emulate it inside the body where the engine has no WHEN', () => {
    const sql = render(new MySqlDialect(), {
      ...stamp,
      run: { mysql: (newRow) => raw`SET @x = ${newRow.body};` },
    }).join('\n');
    expect(sql).not.toContain('WHEN (');
    expect(sql).toContain('IF NOT (OLD.`body` <=> NEW.`body`) THEN');
  });

  it('should emulate it on MariaDB as on MySQL, one family one rule', () => {
    const sql = render(new MariaDialect(), {
      ...stamp,
      run: { mariadb: (newRow) => raw`SET @x = ${newRow.body};` },
    }).join('\n');
    expect(sql).toContain('IF NOT (OLD.`body` <=> NEW.`body`) THEN');
  });

  it('should or two watched columns together, bracketed so a `where` beside them still ands', () => {
    const sql = render(new PostgresDialect(), {
      ...stamp,
      of: ['body', 'searchVector'],
      where: (newRow) => raw`${newRow.body} IS NOT NULL`,
    }).join('\n');
    expect(sql).toContain(
      'WHEN ((OLD."body" IS DISTINCT FROM NEW."body" OR OLD."searchVector" IS DISTINCT FROM NEW."searchVector")' +
        ' AND (NEW."body" IS NOT NULL))',
    );
  });

  it('should emit no guard at all where the trigger names no columns', () => {
    const sql = render(new PostgresDialect(), { ...stamp, of: undefined }).join('\n');
    expect(sql).not.toContain('WHEN (');
    expect(sql).toContain('BEFORE UPDATE ON "Post"');
  });
});

describe('the where guard', () => {
  @Filter('tenant', { where: { tenantId: 7 }, security: true })
  @Entity({ name: 'Scoped' })
  class Scoped {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number }) tenantId?: number | null;
    @Field({ type: String }) status?: string | null;
    @Field({ type: Date, softDelete: true }) deletedAt?: Date | null;
  }

  afterAll(() => removeEntity(Scoped));

  const archived: EntityTriggerMeta<Post> = { ...stamp, where: (newRow) => raw`${newRow.body} IS NOT NULL` };

  it('should read the row it names, as the body does', () => {
    const sql = render(new PostgresDialect(), archived).join('\n');
    expect(sql).toContain('WHEN (');
    expect(sql).toContain('NEW."body" IS NOT NULL');
  });

  it('should stand alone where the trigger watches no columns', () => {
    const sql = render(new PostgresDialect(), { ...archived, of: undefined }).join('\n');
    expect(sql).toContain('WHEN (NEW."body" IS NOT NULL)');
  });

  it('should join the watched columns with AND, both having to hold', () => {
    const sql = render(new PostgresDialect(), archived).join('\n');
    expect(sql).toContain('WHEN (OLD."body" IS DISTINCT FROM NEW."body" AND (NEW."body" IS NOT NULL))');
  });

  it('should take a predicate object, rendered against the row it names', () => {
    const sql = render(new PostgresDialect(), {
      ...stamp,
      of: undefined,
      where: { $new: { body: { $ne: null } } },
    }).join('\n');
    expect(sql).toContain('WHEN (NEW."body" IS NOT NULL)');
  });

  it('should read the outgoing row where the predicate names it', () => {
    const sql = render(new PostgresDialect(), {
      on: 'afterDelete',
      where: { $old: { body: { $ne: null } } },
      run: { postgres: () => raw`SELECT 1;` },
    }).join('\n');
    expect(sql).toContain('WHEN (OLD."body" IS NOT NULL)');
  });

  // Each piece bracketed, so an `$or` inside one never swallows the `AND` joining it to the next.
  it('should keep an $or in a predicate from escaping the watched columns beside it', () => {
    const sql = render(new PostgresDialect(), {
      ...stamp,
      where: { $new: { $or: [{ body: 'a' }, { body: 'b' }] } },
    }).join('\n');
    expect(sql).toContain(`WHEN (OLD."body" IS DISTINCT FROM NEW."body" AND (NEW."body" = 'a' OR NEW."body" = 'b'))`);
  });

  // A transition, which `of` alone cannot state: changed, and from what to what.
  it('should hold a predicate on each row at once', () => {
    const sql = render(new PostgresDialect(), {
      ...stamp,
      of: undefined,
      where: { $old: { body: 'draft' }, $new: { body: { $in: ['published', 'featured'] } } },
    }).join('\n');
    expect(sql).toContain(`WHEN (OLD."body" = 'draft' AND NEW."body" IN ('published', 'featured'))`);
  });

  it('should spell a predicate as each engine does, from the one declaration', () => {
    const sql = render(new MySqlDialect(), {
      ...stamp,
      of: undefined,
      where: { $new: { body: { $ne: null } } },
      run: { mysql: () => raw`SET @x = 1;` },
    }).join('\n');
    expect(sql).toContain('IF NEW.`body` IS NOT NULL THEN');
  });

  it('should move into the body where the engine has no WHEN', () => {
    const sql = render(new MySqlDialect(), {
      ...archived,
      of: undefined,
      run: { mysql: () => raw`SET @x = 1;` },
    }).join('\n');
    expect(sql).toContain('IF NEW.`body` IS NOT NULL THEN');
  });

  // A filter scopes what a request reads, and a trigger serves no request: its guard holds what it states.
  it('should apply no entity filter, a soft delete or a security one', () => {
    const trigger: EntityTriggerMeta<Scoped> = {
      on: 'afterUpdate',
      where: { $new: { status: 'x' } },
      run: () => raw`SELECT 1;`,
    };
    const sql = renderTrigger(new PostgresDialect(), getMeta(Scoped), trigger, 0).statements.join('\n');
    expect(sql).toContain(`WHEN (NEW."status" = 'x')\n`);
  });
});

describe('a stamp, which uql writes the body of', () => {
  @Entity({ name: 'Note' })
  class Note {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number, computed: raw`1`, stored: ['update'] }) touched?: number | null;
  }

  const stampSql = (dialect: AbstractSqlDialect, meta = getMeta(Note)) =>
    stampTriggers(dialect, meta)
      .flatMap((trigger, i) => renderTrigger(dialect, meta, trigger, i).statements)
      .join('\n');

  afterAll(() => removeEntity(Note));

  it('should assign the incoming row where the engine lets a body write it', () => {
    expect(stampSql(new PostgresDialect())).toContain('NEW."touched" := 1;');
  });

  it('should spell the assignment as the MySQL family does', () => {
    expect(stampSql(new MySqlDialect())).toContain('SET NEW.`touched` = 1;');
  });

  // SQLite forbids writing `NEW`, so the row is restated after the write instead.
  it('should restate the row where a body may not assign to it', () => {
    const sql = stampSql(new SqliteDialect());
    expect(sql).toContain('AFTER UPDATE ON `Note`');
    expect(sql).toContain(
      'UPDATE `Note` SET `touched` = 1 WHERE `Note`.`id` = NEW.`id` AND `Note`.`touched` IS NOT 1;',
    );
  });

  // On a set-based engine the rows arrive as tables, which the `UPDATE` names as any write in the body does.
  it('should name the set in a FROM where the engine hands it a table', () => {
    expect(stampSql(new MsSqlDialect())).toContain(
      'UPDATE "Note" SET "touched" = 1 FROM inserted JOIN deleted ON inserted."id" = deleted."id"' +
        ' WHERE "Note"."id" = inserted."id" AND EXISTS (SELECT "Note"."touched" EXCEPT SELECT 1);',
    );
  });

  // A restated row is addressed by its whole key, or a composite one would restamp every row sharing a column.
  it('should address a restated row by every column of a composite key', () => {
    @Entity({ name: 'Pair' })
    class Pair {
      [idKey]?: 'left';
      @Id({ type: Number }) left?: number;
      @Id({ type: Number }) right?: number;
      @Field({ type: Number, computed: raw`1`, stored: ['update'] }) touched?: number | null;
    }
    const sql = stampSql(new SqliteDialect(), getMeta(Pair));
    expect(sql).toContain('WHERE `Pair`.`left` = NEW.`left` AND `Pair`.`right` = NEW.`right` AND');
    removeEntity(Pair);
  });

  it('should install one trigger per event, so neither replaces the other', () => {
    @Entity({ name: 'Both' })
    class Both {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number, computed: raw`1`, stored: ['insert', 'update'] }) touched?: number | null;
    }
    const names = stampTriggers(new PostgresDialect(), getMeta(Both)).map((it) => it.name);
    expect(names).toEqual(['touched_insert', 'touched_update']);
    removeEntity(Both);
  });
});

describe('what a row trigger hands back', () => {
  const run = { postgres: () => raw`SELECT 1;` };

  it('should return the incoming row before an insert, or the write is discarded', () => {
    expect(render(new PostgresDialect(), { on: 'beforeInsert', run }).join('\n')).toContain('RETURN NEW;');
  });

  // `RETURN NULL` from a BEFORE DELETE cancels the delete, so the outgoing row is the only right answer.
  it('should return the outgoing row before a delete, or the delete is cancelled', () => {
    expect(render(new PostgresDialect(), { on: 'beforeDelete', run }).join('\n')).toContain('RETURN OLD;');
  });

  it('should return nothing after the write, where the value is ignored', () => {
    expect(render(new PostgresDialect(), { on: 'afterInsert', run }).join('\n')).toContain('RETURN NULL;');
  });
});

describe('the rows it reads', () => {
  it('should render each row it names as the record the engine hands a row trigger', () => {
    const sql = render(new PostgresDialect(), {
      on: 'afterUpdate',
      run: { postgres: (newRow, oldRow) => raw`PERFORM ${newRow.body}, ${oldRow.body};` },
    }).join('\n');
    expect(sql).toContain('PERFORM NEW."body", OLD."body";');
  });

  it('should render them as the tables a set-based engine hands it instead', () => {
    const sql = render(new MsSqlDialect(), {
      on: 'afterUpdate',
      run: { mssql: (newRow, oldRow) => raw`SELECT ${newRow.body}, ${oldRow.body} FROM inserted, deleted;` },
    }).join('\n');
    expect(sql).toContain('SELECT inserted."body", deleted."body" FROM inserted, deleted;');
  });

  // Named rather than positional, so one body reading the row two events share reads it on both.
  it('should read the outgoing row alike on an update and a delete', () => {
    const logOld: EntityTriggerMeta<Post>['run'] = { postgres: (_newRow, oldRow) => raw`PERFORM ${oldRow.body};` };
    for (const on of ['afterUpdate', 'afterDelete'] as const) {
      expect(render(new PostgresDialect(), { on, run: logOld }).join('\n')).toContain('PERFORM OLD."body";');
    }
  });

  it('should fire per row where the engine is row-based', () => {
    expect(render(new PostgresDialect(), stamp).join('\n')).toContain('FOR EACH ROW');
  });

  it('should refuse a before event on SQL Server, which has only AFTER and INSTEAD OF', () => {
    expect(() => render(new MsSqlDialect(), { ...stamp, run: { mssql: () => raw`SELECT 1;` } })).toThrow(/before/i);
  });

  it('should fire per statement on SQL Server, reading the set it touched', () => {
    const sql = render(new MsSqlDialect(), {
      on: 'afterUpdate',
      run: { mssql: () => raw`SELECT 1;` },
    }).join('\n');
    expect(sql).toContain('AFTER UPDATE');
    expect(sql).not.toContain('FOR EACH ROW');
  });

  // The table a trigger names is qualified: two schemas may hold a table of the same name.
  it('should name the table behind its schema where the entity claims one', () => {
    @Entity({ name: 'Note', schema: 'sales' })
    class Note {
      @Id({ type: Number }) id?: number;
    }
    const sql = renderTrigger(new PostgresDialect(), getMeta(Note), plain, 0).statements.join('\n');
    expect(sql).toContain('ON "sales"."Note"');
    removeEntity(Note);
  });

  // Postgres keeps a trigger's name under its table and refuses a schema on it; its function is a schema object.
  it("should put the function in the table's schema, leaving the trigger name bare, on Postgres", () => {
    @Entity({ name: 'Note', schema: 'sales' })
    class Note {
      @Id({ type: Number }) id?: number;
    }
    const meta = getMeta(Note);
    const { name, statements } = renderTrigger(new PostgresDialect(), meta, plain, 0);
    expect(statements.join('\n')).toContain(`CREATE OR REPLACE FUNCTION "sales"."${name}"()`);
    expect(statements.join('\n')).toContain(`CREATE TRIGGER "${name}"\n`);
    expect(dropTrigger(new PostgresDialect(), meta, name)).toEqual([
      `DROP TRIGGER IF EXISTS "${name}" ON "sales"."Note"`,
      `DROP FUNCTION IF EXISTS "sales"."${name}"()`,
    ]);
    removeEntity(Note);
  });

  // MySQL keeps trigger names per database and SQL Server per schema, so both are named in the table's.
  it("should name the trigger in the table's schema where the engine keeps names per schema", () => {
    @Entity({ name: 'Note', schema: 'sales' })
    class Note {
      @Id({ type: Number }) id?: number;
    }
    const meta = getMeta(Note);
    const mysql = renderTrigger(new MySqlDialect(), meta, { on: 'afterInsert', run: () => raw`SET @x = 1;` }, 0);
    expect(mysql.statements.join('\n')).toContain(`CREATE TRIGGER \`sales\`.\`${mysql.name}\``);
    expect(dropTrigger(new MySqlDialect(), meta, mysql.name)).toEqual([
      `DROP TRIGGER IF EXISTS \`sales\`.\`${mysql.name}\``,
    ]);
    const mssql = renderTrigger(new MsSqlDialect(), meta, { on: 'afterInsert', run: () => raw`SELECT 1;` }, 0);
    expect(mssql.statements.join('\n')).toContain(`CREATE TRIGGER "sales"."${mssql.name}"`);
    removeEntity(Note);
  });

  it('should refuse a body the engine in use has none of', () => {
    expect(() => render(new SqliteDialect(), stamp)).toThrow(/sqlite/);
  });
});

describe('a write in the body, to another table', () => {
  // Each option here is one a request's write applies and a trigger's must not: a security filter, a soft
  // delete, a JavaScript fill standing on a column default.
  @Filter('tenant', { where: { tenantId: 7 }, security: true })
  @Entity({ name: 'WriteAudit' })
  class WriteAudit {
    @Id({ type: Number }) id?: number;
    @Field({ type: Number, name: 'post_id' }) postId?: number | null;
    @Field({ type: String }) body?: string | null;
    @Field({ type: Number, onInsert: () => 7, defaultValue: 0 }) hits?: number | null;
    @Field({ type: 'jsonb' }) tags?: Json<{ list?: string[] }> | null;
    @Field({ type: Number }) tenantId?: number | null;
    @Field({ type: Date, softDelete: true }) deletedAt?: Date | null;
  }

  @Entity({ name: 'UuidAudit' })
  class UuidAudit {
    @Id({ type: 'uuid', onInsert: () => crypto.randomUUID() }) id?: string;
    @Field({ type: Number }) postId?: number | null;
  }

  afterAll(() => {
    removeEntity(WriteAudit);
    removeEntity(UuidAudit);
  });

  const inserted: EntityTriggerMeta<Post> = {
    on: 'afterInsert',
    run: (newRow) => insertInto(WriteAudit, { postId: newRow.id, body: "it's" }),
  };
  const updated: EntityTriggerMeta<Post> = {
    on: 'afterUpdate',
    run: (newRow) => updateTable(WriteAudit, { $where: { postId: newRow.id } }, { body: newRow.body }),
  };
  const deleted: EntityTriggerMeta<Post> = {
    on: 'afterDelete',
    run: (_newRow, oldRow) => deleteFrom(WriteAudit, { $where: { postId: oldRow.id } }),
  };

  // Columns named by the table written (`post_id`), refs by the trigger's own entity, a literal escaped
  // as each engine escapes one, and `hits` left to its column's default. SQL Server reads its set.
  it.each([
    { dialect: new PostgresDialect(), sql: `INSERT INTO "WriteAudit" ("post_id", "body") VALUES (NEW."id", 'it''s');` },
    {
      dialect: new CockroachDialect(),
      sql: `INSERT INTO "WriteAudit" ("post_id", "body") VALUES (NEW."id", 'it''s');`,
    },
    { dialect: new MySqlDialect(), sql: "INSERT INTO `WriteAudit` (`post_id`, `body`) VALUES (NEW.`id`, 'it\\'s');" },
    { dialect: new MariaDialect(), sql: "INSERT INTO `WriteAudit` (`post_id`, `body`) VALUES (NEW.`id`, 'it\\'s');" },
    { dialect: new SqliteDialect(), sql: "INSERT INTO `WriteAudit` (`post_id`, `body`) VALUES (NEW.`id`, 'it''s');" },
    {
      dialect: new MsSqlDialect(),
      sql: `INSERT INTO "WriteAudit" ("post_id", "body") SELECT inserted."id", N'it''s' FROM inserted;`,
    },
  ])('should insert on $dialect.dialectName', ({ dialect, sql }) => {
    expect(render(dialect, inserted).join('\n')).toContain(sql);
  });

  // No filter narrows the rows named: the security one would bake in the tenant of whoever ran `sync`.
  it.each([
    {
      dialect: new PostgresDialect(),
      sql: 'UPDATE "WriteAudit" SET "body" = NEW."body" WHERE "WriteAudit"."post_id" = NEW."id";',
    },
    {
      dialect: new CockroachDialect(),
      sql: 'UPDATE "WriteAudit" SET "body" = NEW."body" WHERE "WriteAudit"."post_id" = NEW."id";',
    },
    {
      dialect: new MySqlDialect(),
      sql: 'UPDATE `WriteAudit` SET `body` = NEW.`body` WHERE `WriteAudit`.`post_id` = NEW.`id`;',
    },
    {
      dialect: new MariaDialect(),
      sql: 'UPDATE `WriteAudit` SET `body` = NEW.`body` WHERE `WriteAudit`.`post_id` = NEW.`id`;',
    },
    {
      dialect: new SqliteDialect(),
      sql: 'UPDATE `WriteAudit` SET `body` = NEW.`body` WHERE `WriteAudit`.`post_id` = NEW.`id`;',
    },
    {
      dialect: new MsSqlDialect(),
      sql:
        'UPDATE "WriteAudit" SET "body" = inserted."body" FROM inserted JOIN deleted ON inserted."id" = deleted."id"' +
        ' WHERE "WriteAudit"."post_id" = inserted."id";',
    },
  ])('should update the rows it names, and no others, on $dialect.dialectName', ({ dialect, sql }) => {
    expect(render(dialect, updated).join('\n')).toContain(sql);
  });

  // Outright, though the table soft-deletes, and with no filter narrowing the rows named.
  it.each([
    { dialect: new PostgresDialect(), sql: 'DELETE FROM "WriteAudit" WHERE "WriteAudit"."post_id" = OLD."id";' },
    { dialect: new CockroachDialect(), sql: 'DELETE FROM "WriteAudit" WHERE "WriteAudit"."post_id" = OLD."id";' },
    { dialect: new MySqlDialect(), sql: 'DELETE FROM `WriteAudit` WHERE `WriteAudit`.`post_id` = OLD.`id`;' },
    { dialect: new MariaDialect(), sql: 'DELETE FROM `WriteAudit` WHERE `WriteAudit`.`post_id` = OLD.`id`;' },
    { dialect: new SqliteDialect(), sql: 'DELETE FROM `WriteAudit` WHERE `WriteAudit`.`post_id` = OLD.`id`;' },
    {
      dialect: new MsSqlDialect(),
      sql: 'DELETE FROM "WriteAudit" FROM deleted WHERE "WriteAudit"."post_id" = deleted."id";',
    },
  ])('should delete the rows it names outright on $dialect.dialectName', ({ dialect, sql }) => {
    expect(render(dialect, deleted).join('\n')).toContain(sql);
  });

  it('should take a counter where the engine fires per row', () => {
    const sql = render(new PostgresDialect(), {
      on: 'afterInsert',
      run: (newRow) => updateTable(WriteAudit, { $where: { postId: newRow.id } }, { hits: { $inc: 1 } }),
    }).join('\n');
    expect(sql).toContain(
      'UPDATE "WriteAudit" SET "hits" = COALESCE("hits", 0) + 1 WHERE "WriteAudit"."post_id" = NEW."id";',
    );
  });

  // A set-based UPDATE writes a target once however many rows of the set match it, so what accumulates
  // per row would apply once.
  it('should refuse a counter where the body reads a set', () => {
    expect(() =>
      render(new MsSqlDialect(), {
        on: 'afterInsert',
        run: (newRow) => updateTable(WriteAudit, { $where: { postId: newRow.id } }, { hits: { $inc: 1 } }),
      }),
    ).toThrow(`'WriteAudit.hits' cannot accumulate per row in a trigger fired once per statement`);
  });

  it('should refuse a push where the body reads a set', () => {
    expect(() =>
      render(new MsSqlDialect(), {
        on: 'afterInsert',
        run: (newRow) => updateTable(WriteAudit, { $where: { postId: newRow.id } }, { tags: { $push: { list: 'x' } } }),
      }),
    ).toThrow(`'WriteAudit.tags' cannot accumulate per row in a trigger fired once per statement`);
  });

  it('should run several writes in one body, each reading the rows it was handed', () => {
    const sql = render(new MsSqlDialect(), {
      on: 'afterDelete',
      run: (_newRow, oldRow) =>
        raw`${deleteFrom(WriteAudit, { $where: { postId: oldRow.id } })}
          ${insertInto(WriteAudit, { body: oldRow.body })}`,
    }).join('\n');
    expect(sql).toContain('DELETE FROM "WriteAudit" FROM deleted WHERE "WriteAudit"."post_id" = deleted."id";');
    expect(sql).toContain('INSERT INTO "WriteAudit" ("body") SELECT deleted."body" FROM deleted;');
  });

  // Left out, a uuid uql fills in JavaScript would be NULL, and every write firing the trigger would fail.
  it('should refuse an insert leaving out what uql fills on insert, with no column default to stand in', () => {
    expect(() =>
      render(new PostgresDialect(), {
        on: 'afterInsert',
        run: (newRow) => insertInto(UuidAudit, { postId: newRow.id }),
      }),
    ).toThrow(
      `'UuidAudit.id' is filled on insert by uql, which a trigger does not run: name it, or give it a defaultValue`,
    );
  });

  it('should take SQL in place of what uql would fill', () => {
    const sql = render(new PostgresDialect(), {
      on: 'afterInsert',
      run: (newRow) => insertInto(UuidAudit, { id: raw`gen_random_uuid()`, postId: newRow.id }),
    }).join('\n');
    expect(sql).toContain('INSERT INTO "UuidAudit" ("id", "postId") VALUES (gen_random_uuid(), NEW."id");');
  });

  it('should refuse a write naming no field', () => {
    expect(() => render(new PostgresDialect(), { on: 'afterInsert', run: () => insertInto(WriteAudit, {}) })).toThrow(
      `a trigger's write to 'WriteAudit' names no field`,
    );
  });

  // Every row of the table, each time the trigger fires, is what a forgotten filter looks like.
  it('should refuse an update or a delete naming no rows', () => {
    expect(() =>
      render(new PostgresDialect(), {
        on: 'afterDelete',
        run: () => deleteFrom(WriteAudit, { $where: { postId: undefined } }),
      }),
    ).toThrow(`a trigger's delete over 'WriteAudit' names no rows, so it would address every one`);
    expect(() =>
      render(new PostgresDialect(), {
        on: 'afterDelete',
        run: () => deleteFrom(WriteAudit, { $where: { $or: [{ postId: undefined }] } }),
      }),
    ).toThrow(`a trigger's delete over 'WriteAudit' names no rows, so it would address every one`);
  });

  it('should refuse a field the table has not got', () => {
    expect(() =>
      // @ts-expect-error: the types refuse it first, and plain JavaScript reaches the dialect past them
      render(new PostgresDialect(), { on: 'afterInsert', run: () => insertInto(WriteAudit, { nope: 1 }) }),
    ).toThrow(`'WriteAudit' has no field 'nope' for a trigger to write`);
  });
});
