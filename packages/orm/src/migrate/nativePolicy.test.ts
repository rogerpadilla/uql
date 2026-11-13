// The database holding rows to an entity's policies itself, on every engine that can: installed under names ending in
// a hash of their SQL, read back by name, and held to raw SQL too, which the querier never sees. Run as a role the
// database holds to them, for a superuser reads past row-level security.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrdbQuerierPool } from '../cockroachdb/crdbQuerierPool.js';
import { withContext } from '../context/context.js';
import { Entity, f, Field, ManyToOne, OneToMany } from '../entity/index.js';
import { PgQuerierPool } from '../postgres/pgQuerierPool.js';
import { queryErrorKind } from '../querier/queryError.js';
import { cockroachConnection, postgresConnection, provisioningTimeout } from '../test/index.js';
import type { ExtraOptions, SqlQuerierPool } from '../type/index.js';
import { $context } from '../util/contextRefs.js';
import { sql } from '../util/sql.js';
import { detectDrift } from './drift/driftDetector.js';
import { Migrator } from './migrator.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity()
class NpNote {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number().nullable().tenant($context.orgId)) tenantId?: number | null;
  @Field(f.string().nullable()) title?: string | null;
}

@Entity({
  policies: [
    { allow: { members: { userId: $context.userId } }, ops: ['read'] },
    { allow: {}, ops: ['insert'] },
  ],
})
class NpProject {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
  @OneToMany(() => NpMember, { mappedBy: (member) => member.project }) members?: NpMember[];
}

@Entity()
class NpMember {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.references(() => NpProject).nullable()) projectId?: number | null;
  @Field(f.string().nullable()) userId?: string | null;
  @ManyToOne(() => NpProject, { references: (member) => member.projectId }) project?: NpProject;
}

@Entity({
  policies: [
    { allow: { authorId: $context.userId }, check: { authorId: $context.userId, title: { $ne: 'void' } } },
    { allow: {}, ops: ['read'], when: { role: ['auditor', 'admin'] } },
  ],
})
class NpChecked {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) authorId?: string | null;
  @Field(f.string().nullable()) title?: string | null;
}

/** Read by `uql_policy_reader` alone, not by the login role, which inherits it. */
@Entity({
  policies: [
    { allow: {}, ops: ['read'], when: { dbRole: 'uql_policy_reader' } },
    { allow: {}, ops: ['insert'] },
  ],
})
class NpGranted {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
}

/** A table someone else held to row-level security, before uql's policy and after it is gone. */
@Entity({ name: 'NpShared', policies: [{ allow: { title: { $ne: 'hidden' } } }] })
class NpShared {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
}

@Entity({ name: 'NpShared' })
class NpSharedOpen {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
}

/** `NpNote` once its `allow` is edited: the same table, a policy under a new name. */
@Entity({
  name: 'NpNote',
  policies: [{ must: { tenantId: $context.orgId } }, { allow: { title: { $ne: 'hidden' } } }],
})
class NpNoteEdited {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number().nullable()) tenantId?: number | null;
  @Field(f.string().nullable()) title?: string | null;
}

const tables = ['NpMember', 'NpChecked', 'NpNote', 'NpProject', 'NpGranted', 'NpShared'];

/** Native, its transactions run as the database role context key `dbRole` names. */
const native: ExtraOptions = { policies: 'native', role: $context.dbRole };

/**
 * Each engine holding rows to policies: the owner it migrates as, the role its app connects as, what it grants that
 * role, and whether a policy may read a relation there.
 */
const engines: readonly [string, () => SqlQuerierPool, () => SqlQuerierPool, string, boolean][] = [
  [
    'postgres',
    () => new PgQuerierPool(postgresConnection('test_policy'), native),
    () => new PgQuerierPool({ ...postgresConnection('test_policy'), user: 'uql_policy' }, native),
    'GRANT USAGE ON SCHEMA public TO uql_policy, uql_policy_reader; GRANT ALL ON ALL TABLES IN SCHEMA public TO uql_policy; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO uql_policy; GRANT SELECT ON "NpGranted" TO uql_policy_reader',
    true,
  ],
  [
    'cockroachdb',
    () => new CrdbQuerierPool(cockroachConnection('test_policy'), native),
    () => new CrdbQuerierPool({ ...cockroachConnection('test_policy'), user: 'uql_policy' }, native),
    'GRANT ALL ON TABLE "NpNote", "NpChecked", "NpGranted" TO uql_policy; GRANT ALL ON SEQUENCE "NpNote_id_seq", "NpChecked_id_seq", "NpGranted_id_seq" TO uql_policy; GRANT SELECT ON TABLE "NpGranted" TO uql_policy_reader',
    false,
  ],
];

const asTenant = <T>(tenantId: number, fn: () => Promise<T>) => withContext({ orgId: tenantId }, fn);
const asUser = <T>(userId: string, fn: () => Promise<T>) => withContext({ userId }, fn);
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

describe.each(engines)('native policies on %s', (_engine, owned, held, grant, subqueries) => {
  let owner: SqlQuerierPool;
  let app: SqlQuerierPool;
  const entities = subqueries ? [NpNote, NpProject, NpMember, NpChecked, NpGranted] : [NpNote, NpChecked, NpGranted];

  const dropAll = async () => {
    for (const table of tables) {
      await owner.run(sql.text(`DROP TABLE IF EXISTS ${owner.dialect.escapeId(table)} CASCADE`));
    }
    await owner.run(sql.text('DROP TABLE IF EXISTS uql_migrations'));
  };

  beforeAll(async () => {
    owner = owned();
    app = held();
    await dropAll();
    await new Migrator(owner, { entities }).sync();
    for (const statement of grant.split('; ')) {
      await owner.run(sql.text(statement));
    }
  }, provisioningTimeout);

  afterAll(async () => {
    await dropAll();
    await Promise.all([owner.end(), app.end()]);
  }, provisioningTimeout);

  it('should install each policy under a name ending in a hash of its SQL, read back with no drift', async () => {
    const statements = new SqlSchemaGenerator(owner.dialect).generateCreateSchema([NpNote]);
    expect(statements.join('\n')).toMatch(/^ALTER TABLE "NpNote" .*FORCE ROW LEVEL SECURITY;$/m);
    expect(statements.find((statement) => statement.startsWith('CREATE POLICY'))).toMatch(
      /^CREATE POLICY "_uql_NpNote__tenant_[0-9a-f]{6}" ON "NpNote" AS RESTRICTIVE FOR ALL TO PUBLIC USING \("tenantId" = .*nullif\(current_setting\('uql\.orgId', true\), ''\)::/,
    );
    expect(await new Migrator(owner, { entities }).planSync({ safe: false })).toEqual([]);
  });

  it.runIf(!subqueries)('should refuse a policy reading a relation where the engine takes no subquery in one', () => {
    expect(() => new SqlSchemaGenerator(owner.dialect).generateCreateSchema([NpProject, NpMember])).toThrow(
      "takes no subquery in a policy, so 'NpProject' policy 'allow_0' cannot read a relation there",
    );
  });

  it('should show a tenant its own rows alone, to raw SQL as to the querier', async () => {
    await asTenant(1, () => app.insertOne(NpNote, { title: 'one' }));
    await asTenant(2, () => app.insertOne(NpNote, { title: 'two' }));

    expect(await asTenant(1, () => app.findMany(NpNote, { $select: { title: true } }))).toEqual([{ title: 'one' }]);
    expect(await asTenant(2, () => app.all(sql.text('SELECT "title" FROM "NpNote"')))).toEqual([{ title: 'two' }]);
    expect(await app.all(sql.text('SELECT "title" FROM "NpNote"'))).toEqual([]);
  });

  it("should refuse raw SQL writing into another tenant, as the database's own check", async () => {
    const refused = await refusal(
      asTenant(1, () => app.run(sql.text(`INSERT INTO "NpNote" ("tenantId", "title") VALUES (2, 'forged')`))),
    );

    expect(queryErrorKind(refused)).toBe('security');
  });

  it.runIf(subqueries)("should show a project to its members alone, through its members' table", async () => {
    const [mine, theirs] = await owner.insertMany(NpProject, [{ name: 'mine' }, { name: 'theirs' }]);
    await owner.insertMany(NpMember, [
      { projectId: mine, userId: 'a' },
      { projectId: theirs, userId: 'b' },
    ]);

    expect(await asUser('a', () => app.all(sql.text('SELECT "name" FROM "NpProject"')))).toEqual([{ name: 'mine' }]);
  });

  it('should refuse an update its check does not hold, in the database', async () => {
    const id = await asUser('a', () => app.insertOne(NpChecked, { title: 'draft' }));

    const refused = await refusal(asUser('a', () => app.updateOneById(NpChecked, id, { title: 'void' })));

    expect(queryErrorKind(refused)).toBe('security');
    expect(await asUser('a', () => app.findOneById(NpChecked, id, { $select: { title: true } }))).toEqual({
      title: 'draft',
    });
  });

  it('should upsert a row of its tenant in one statement, its tenant filled in', async () => {
    const id = await asTenant(1, () => app.insertOne(NpNote, { title: 'draft' }));

    await asTenant(1, () => app.upsertMany(NpNote, { $conflict: { id: true } }, [{ id, title: 'final' }]));

    expect(await asTenant(1, () => app.findOneById(NpNote, id, { $select: { tenantId: true, title: true } }))).toEqual({
      tenantId: 1,
      title: 'final',
    });
  });

  it("should refuse an upsert onto another tenant's row, in the database", async () => {
    const id = await asTenant(2, () => app.insertOne(NpNote, { title: 'theirs' }));

    const refused = await refusal(
      asTenant(1, () => app.upsertMany(NpNote, { $conflict: { id: true } }, [{ id, title: 'taken' }])),
    );

    expect(queryErrorKind(refused)).toBe('security');
    expect(await asTenant(2, () => app.findOneById(NpNote, id, { $select: { title: true } }))).toEqual({
      title: 'theirs',
    });
  });

  it('should stream a tenant its own rows alone, its context bound in the transaction', async () => {
    await asTenant(1, () => app.insertOne(NpNote, { title: 'stream-1' }));
    await asTenant(2, () => app.insertOne(NpNote, { title: 'stream-2' }));

    const rows = await app.transaction((querier) =>
      asTenant(1, () =>
        Array.fromAsync(
          querier.findManyStream(NpNote, {
            $select: { title: true },
            $where: { title: { $in: ['stream-1', 'stream-2'] } },
          }),
        ),
      ),
    );

    expect(rows).toEqual([{ title: 'stream-1' }]);
  });

  it('should hold a policy only under the context its when names', async () => {
    await asUser('a', () => app.insertOne(NpChecked, { title: 'audited' }));
    const titles = sql.text(`SELECT "title" FROM "NpChecked" WHERE "title" = 'audited'`);

    expect(await withContext({ userId: 'b' }, () => app.all(titles))).toEqual([]);
    expect(await withContext({ userId: 'b', role: 'auditor' }, () => app.all(titles))).toEqual([{ title: 'audited' }]);
  });

  it('should leave alone a policy it did not install', async () => {
    await owner.run(sql.text('CREATE POLICY "manual" ON "NpChecked" AS RESTRICTIVE FOR DELETE TO PUBLIC USING (true)'));

    expect(await new Migrator(owner, { entities }).planSync({ safe: false })).toEqual([]);
  });

  it('should replace an edited policy, the old one dropped', async () => {
    await asTenant(1, () => app.insertOne(NpNote, { title: 'hidden' }));
    const hidden = sql.text(`SELECT "title" FROM "NpNote" WHERE "title" = 'hidden'`);

    await new Migrator(owner, { entities: [NpNoteEdited] }).sync();
    const edited = await asTenant(1, () => app.all(hidden));
    await new Migrator(owner, { entities: [NpNote] }).sync();

    expect(edited).toEqual([]);
    expect(await asTenant(1, () => app.all(hidden))).toEqual([{ title: 'hidden' }]);
  });

  it('should refuse statements under a context where the role reads past the policies', async () => {
    await expect(asTenant(1, () => owner.count(NpNote))).rejects.toThrow(
      "a pool with policies: 'native' runs a context's statements as a role",
    );
  });

  it('should run a context as the database role it names, for its transaction alone', async () => {
    await owner.insertOne(NpGranted, { title: 'granted' });
    const granted = sql.text('SELECT current_user AS "role", "title" FROM "NpGranted"');

    expect(await withContext({ dbRole: 'uql_policy_reader' }, () => app.all(granted))).toEqual([
      { role: 'uql_policy_reader', title: 'granted' },
    ]);
    expect(await asUser('a', () => app.all(granted))).toEqual([]);
  });

  // Postgres holds a role to each policy `TO` a role it inherits, so the role is compared, as app mode does.
  it('should hold a policy naming a database role to that role alone, not to one inheriting it', async () => {
    await owner.insertOne(NpGranted, { title: 'inherited' });

    expect(await app.all(sql.text('SELECT "title" FROM "NpGranted"'))).toEqual([]);
  });

  it('should refuse a context naming a role the database lacks, as the database does', async () => {
    await expect(withContext({ dbRole: 'uql_policy_missing' }, () => app.count(NpGranted))).rejects.toThrow(
      'uql_policy_missing',
    );
  });

  it('should refuse statements under a context naming a role that reads past the policies', async () => {
    const bypassing = withContext({ dbRole: 'uql_policy_bypass' }, () => app.count(NpNote));

    await expect(bypassing).rejects.toThrow("a pool with policies: 'native' runs a context's statements as a role");
    await expect(withContext({ dbRole: 'uql_policy_reader' }, () => app.count(NpGranted))).resolves.toBeTypeOf(
      'number',
    );
  });

  it('should report row-level security turned off under its policies as critical, and turn it back on', async () => {
    const migrator = new Migrator(owner, { entities: [NpNote] });
    const generator = new SqlSchemaGenerator(owner.dialect);
    await owner.run(sql.text('ALTER TABLE "NpNote" NO FORCE ROW LEVEL SECURITY'));

    const { drifts } = detectDrift(
      generator.buildAST([NpNote]),
      await migrator.schemaIntrospector.introspect(['NpNote']),
    );
    const plan = await migrator.planSync({ safe: false });
    await migrator.sync();

    expect(drifts).toEqual([expect.objectContaining({ table: 'NpNote', severity: 'critical' })]);
    expect(plan.join(' ')).toMatch(/^ALTER TABLE "NpNote" ENABLE ROW LEVEL SECURITY.* FORCE ROW LEVEL SECURITY;$/);
    expect(await migrator.planSync({ safe: false })).toEqual([]);
  });

  it('should leave row-level security enabled on a table someone else enabled, once its policy is gone', async () => {
    const state = sql.text(
      `SELECT relrowsecurity AS "enabled", relforcerowsecurity AS "forced" FROM pg_class WHERE relname = 'NpShared'`,
    );
    await new Migrator(owner, { entities: [NpSharedOpen] }).sync();
    await owner.run(sql.text('ALTER TABLE "NpShared" ENABLE ROW LEVEL SECURITY'));

    await new Migrator(owner, { entities: [NpShared] }).sync();
    const held = await owner.all(state);
    await new Migrator(owner, { entities: [NpSharedOpen] }).sync();

    expect(held).toEqual([{ enabled: true, forced: true }]);
    expect(await owner.all(state)).toEqual([{ enabled: true, forced: false }]);
  });
});
