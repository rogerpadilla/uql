import { beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, getMeta, Id, idOf, ManyToMany, ManyToOne, OneToMany } from '../entity/index.js';
import { SqlSchemaGenerator } from '../migrate/schemaGenerator.js';
import { MySqlDialect } from '../mysql/mysqlDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { buildSchemaAST } from '../schema/schemaASTBuilder.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import { Sqlite3QuerierPool } from '../sqlite/sqliteQuerierPool.js';
import { raw } from '../util/index.js';

@Entity()
class Enrolment {
  @Id({ type: Number })
  studentId?: number;
  @Id({ type: String })
  courseId?: string;
  @OneToMany({ entity: () => Note, mappedBy: (note) => note.enrolment })
  notes?: Note[];
  @ManyToMany({ entity: () => Badge, through: () => EnrolmentBadge })
  badges?: Badge[];
  @Field({ type: String }) grade?: string;
}

@Entity()
class Badge {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) label?: string;
}

/**
 * One column per key of each side, and a relation over each - which is how a junction earns its
 * foreign keys and how populating one finds its way to the target. The derived column names are the
 * ones `through` pairs by, so declaring them is not a second convention: `<rel><Key>` either way.
 */
@Entity()
class EnrolmentBadge {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) enrolmentStudentId?: number;
  @Field({ type: String }) enrolmentCourseId?: string;
  @ManyToOne({ entity: () => Enrolment }) enrolment?: Enrolment;
  @Field({ type: Number }) badgeId?: number;
  @ManyToOne({ entity: () => Badge }) badge?: Badge;
}

/**
 * The foreign key columns are declared rather than left to registration - which derives these exact
 * names - so a payload can name them: they are what the reads below group and correlate by, and only
 * a declared column is on the entity's type. Registration keeps a column that is already there.
 */
@Entity()
class Note {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) enrolmentStudentId?: number;
  @Field({ type: String }) enrolmentCourseId?: string;
  @ManyToOne({ entity: () => Enrolment }) enrolment?: Enrolment;
  @Field({ type: String }) body?: string;
}

/** Its own table, so the writes below cannot disturb the row counts the reads further down assert. */
@Entity()
class Attempt {
  @Id({ type: Number }) studentId?: number;
  @Id({ type: String }) task?: string;
  @Field({ type: String }) score?: string;
}

@Entity()
class Term {
  @Id({ type: Number }) year?: number;
  @Id({ type: String }) season?: string;
  @OneToMany({ entity: () => Session, mappedBy: (it) => it.term, cascade: 'delete' })
  sessions?: Session[];
}

@Entity()
class Session {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) termYear?: number;
  @Field({ type: String }) termSeason?: string;
  @ManyToOne({ entity: () => Term }) term?: Term;
}

const pool = new Sqlite3QuerierPool(':memory:');

/**
 * Against a real database, because most of what follows is a claim about rows a statement did or did
 * not touch.
 */
beforeAll(async () => {
  for (const stmt of new SqlSchemaGenerator(new SqliteDialect()).generateCreateSchema([
    Enrolment,
    Note,
    Term,
    Session,
    Badge,
    EnrolmentBadge,
    Attempt,
  ])) {
    await pool.run(stmt);
  }
  await pool.insertMany(Enrolment, [
    { studentId: 1, courseId: 'maths', grade: 'A' },
    { studentId: 1, courseId: 'physics', grade: 'B' },
    { studentId: 2, courseId: 'maths', grade: 'C' },
    { studentId: 3, courseId: 'maths', grade: 'D' },
  ]);
  await pool.insertMany(Term, [{ year: 2026, season: 'spring' }]);
  await pool.insertMany(Badge, [
    { id: 1, label: 'merit' },
    { id: 2, label: 'honours' },
  ]);
  await pool.insertMany(EnrolmentBadge, [
    { id: 1, enrolmentStudentId: 1, enrolmentCourseId: 'maths', badgeId: 1 },
    { id: 2, enrolmentStudentId: 1, enrolmentCourseId: 'maths', badgeId: 2 },
    { id: 3, enrolmentStudentId: 2, enrolmentCourseId: 'maths', badgeId: 2 },
  ]);
  await pool.insertMany(Note, [
    { id: 1, enrolmentStudentId: 1, enrolmentCourseId: 'maths', body: 'first' },
    { id: 2, enrolmentStudentId: 1, enrolmentCourseId: 'maths', body: 'second' },
    { id: 3, enrolmentStudentId: 2, enrolmentCourseId: 'maths', body: 'other student' },
    { id: 4, enrolmentStudentId: 1, enrolmentCourseId: 'physics', body: 'other course' },
  ]);
});

describe('writing composite rows', () => {
  /**
   * Nothing about the statement needs a single key: every column of a composite comes from the
   * caller, so there is nothing to generate and nothing to read back. What an insert cannot do is
   * *name* the row it wrote - `IdValue` is one column's value - so the id it reports is `undefined`,
   * exactly as it is for a key MySQL's header cannot speak for. `idOf` names such a row instead.
   */
  it('inserts rows whose key it did not generate, and reports no id', async () => {
    const ids = await pool.insertMany(Term, [
      { year: 2027, season: 'autumn' },
      { year: 2027, season: 'winter' },
    ]);
    expect(ids).toEqual([undefined, undefined]);
    expect(await pool.findOneById(Term, { year: 2027, season: 'winter' })).toEqual({
      year: 2027,
      season: 'winter',
    });
  });

  /**
   * `saveMany` reads an id as proof the row exists. A composite is supplied whole on an insert too,
   * so every row would look like an update and a new one would silently update nothing.
   */
  it('refuses to save, where an id proves nothing about whether the row exists', async () => {
    await expect(pool.saveMany(Enrolment, [{ studentId: 9, courseId: 'maths' }])).rejects.toThrow(
      /composite primary key \(studentId, courseId\), which saving a row does not support/,
    );
  });

  /**
   * What `saveMany` cannot do, an upsert can: it asks the database which rows exist rather than
   * reading an id as proof. The statement wants no id back - every column of the key was supplied -
   * so `RETURNING` is dropped rather than the whole upsert refused.
   */
  it('upserts on the whole key, inserting what is new and updating what is not', async () => {
    await pool.insertMany(Attempt, [{ studentId: 1, task: 'essay', score: 'B' }]);

    await pool.upsertMany(Attempt, { studentId: true, task: true }, [
      { studentId: 1, task: 'essay', score: 'A' },
      { studentId: 1, task: 'viva', score: 'C' },
    ]);

    const founds = await pool.findMany(Attempt, { $where: { studentId: 1 }, $sort: { task: 1 } });
    expect(founds).toEqual([
      { studentId: 1, task: 'essay', score: 'A' },
      { studentId: 1, task: 'viva', score: 'C' },
    ]);
  });

  it('updates one row by its whole key, and nothing that only shares a column', async () => {
    await pool.insertMany(Attempt, [
      { studentId: 2, task: 'oral', score: 'D' },
      { studentId: 2, task: 'written', score: 'D' },
      { studentId: 3, task: 'oral', score: 'D' },
    ]);

    await pool.updateOneById(Attempt, { studentId: 2, task: 'oral' }, { score: 'A' });

    expect((await pool.findOneById(Attempt, { studentId: 2, task: 'oral' }))?.score).toBe('A');
    // One shares the student, the other the task; neither is the row that was named.
    expect((await pool.findOneById(Attempt, { studentId: 2, task: 'written' }))?.score).toBe('D');
    expect((await pool.findOneById(Attempt, { studentId: 3, task: 'oral' }))?.score).toBe('D');
  });

  /** A paged update settles its rows first, and names them by every key, as a paged delete does. */
  it('updates the page it settled on', async () => {
    await pool.insertMany(Attempt, [
      { studentId: 4, task: 'lab', score: 'D' },
      { studentId: 5, task: 'lab', score: 'D' },
    ]);

    const changes = await pool.updateMany(
      Attempt,
      { $where: { task: 'lab' }, $sort: { studentId: -1 }, $limit: 1 },
      { score: 'E' },
    );

    expect(changes).toBe(1);
    const founds = await pool.findMany(Attempt, { $where: { task: 'lab' }, $sort: { studentId: 1 } });
    expect(founds.map((it) => [it.studentId, it.score])).toEqual([
      [4, 'D'],
      [5, 'E'],
    ]);
  });
});

describe('addressing a composite primary key', () => {
  it('refuses an id naming only some of the keys', async () => {
    await expect(pool.deleteOneById(Enrolment, { studentId: 1 })).rejects.toThrow(
      /every key of its primary key \(studentId, courseId\); missing courseId/,
    );
  });

  it('refuses a bare value, which can only name one column', async () => {
    await expect(pool.deleteOneById(Enrolment, 1)).rejects.toThrow(/composite primary key \(studentId, courseId\)/);
  });

  /** The type rejects this too; the guard is for an untyped caller, such as parsed JSON over HTTP. */
  it('refuses a nullish key inside an otherwise complete id', async () => {
    await expect(pool.deleteOneById(Enrolment, { studentId: 1, courseId: null } as never)).rejects.toThrow(
      /missing courseId/,
    );
  });

  /**
   * An empty object satisfies the id type - every key of it is optional, because `IdKey` cannot be
   * made precise - and reaches `deleteMany` as `$where: {}`, which is no filter at all.
   */
  it('refuses an id naming no key at all, on one key as much as on several', async () => {
    await expect(pool.deleteOneById(Enrolment, {})).rejects.toThrow(/missing studentId, courseId/);
    await expect(pool.deleteOneById(Note, {})).rejects.toThrow(/every key of its primary key \(id\); missing id/);
  });
});

describe('a composite primary key in DDL', () => {
  const ddl = new SqlSchemaGenerator(new PostgresDialect()).generateCreateSchema([Enrolment]).join('\n');

  it('declares every key in one named table-level PRIMARY KEY', () => {
    expect(ddl).toContain('CONSTRAINT "Enrolment__studentId_courseId_pk" PRIMARY KEY ("studentId", "courseId")');
  });

  /** Auto-increment defaults on a sole integer key; on a composite it would make each column serial. */
  it('leaves the columns alone rather than making each one serial', () => {
    expect(ddl).toContain('"studentId" BIGINT,');
    expect(ddl).not.toContain('IDENTITY');
  });

  /**
   * Adding one column of a composite key to a table that already has the other. The serial type is
   * for a sole key only - one per column would make each of them a generated key - and the key itself
   * is the table's, declared as its own constraint rather than on a column.
   */
  it('adds a key column as a plain one, leaving the key to the table', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect());
    const existing = buildSchemaAST([Enrolment]).getTable('Enrolment')!;
    existing.columns.delete('courseId');
    existing.primaryKey.length = 0;
    existing.primaryKey.push(existing.columns.get('studentId')!);
    existing.primaryKeyName = 'Enrolment_pkey'; // as introspection reports it

    const statements = generator.generateAlterTable(generator.diffSchema(Enrolment, existing)!);

    expect(statements).toContain('ALTER TABLE "Enrolment" ADD COLUMN "courseId" TEXT;');
    expect(statements).toContain(
      'ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment__studentId_courseId_pk" PRIMARY KEY ("studentId", "courseId");',
    );
  });

  /** A sole key still gets the serial type, and still does not declare the key on the column. */
  it('adds a sole integer key as a serial, without declaring the key on it', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect());
    const existing = buildSchemaAST([Note]).getTable('Note')!;
    existing.columns.delete('id');
    existing.primaryKey.length = 0;

    const statements = generator.generateAlterTable(generator.diffSchema(Note, existing)!);

    expect(statements).toContain('ALTER TABLE "Note" ADD COLUMN "id" BIGINT GENERATED BY DEFAULT AS IDENTITY;');
  });
});

/**
 * Adding a second `@Id` to an entity already in the database - the upgrade the 0.42.0 guide
 * documents. The column used to be added and the key left alone, so the table went on enforcing
 * uniqueness on one column while uql addressed rows by two.
 */
describe('changing the primary key of an existing table', () => {
  @Entity({ name: 'Member' })
  class MemberBefore {
    @Id({ type: Number }) userId?: number;
    @Field({ type: String }) note?: string;
  }
  @Entity({ name: 'Member' })
  class MemberAfter {
    @Id({ type: Number }) userId?: number;
    @Id({ type: Number }) groupId?: number;
    @Field({ type: String }) note?: string;
  }

  /** As introspection reports it: the columns it has, under the name the engine gave the constraint. */
  const existingTable = () => {
    const table = buildSchemaAST([MemberBefore]).getTable('Member')!;
    table.primaryKeyName = 'Member_pkey';
    return table;
  };

  it('drops the old key, adds the column, then declares the new key', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect());
    const diff = generator.diffSchema(MemberAfter, existingTable())!;

    expect(diff.primaryKey).toEqual({ from: ['userId'], to: ['userId', 'groupId'], fromName: 'Member_pkey' });
    expect(generator.generateAlterTable(diff)).toEqual([
      // The drop comes first: a column the new key names does not exist yet, and the old key has to
      // be gone before the table can take another.
      'ALTER TABLE "Member" DROP CONSTRAINT "Member_pkey";',
      'ALTER TABLE "Member" ADD COLUMN "groupId" BIGINT;',
      'ALTER TABLE "Member" ADD CONSTRAINT "Member__userId_groupId_pk" PRIMARY KEY ("userId", "groupId");',
    ]);
  });

  /** MySQL names every table's key `PRIMARY`, so its drop takes no name at all. */
  it('drops by shape rather than by name where the engine has no name to give', () => {
    const generator = new SqlSchemaGenerator(new MySqlDialect());
    const diff = generator.diffSchema(MemberAfter, existingTable())!;
    expect(generator.generateAlterTable(diff)[0]).toBe('ALTER TABLE `Member` DROP PRIMARY KEY;');
  });

  /**
   * The whole reason the comparison is by columns: the engine named the constraint on every table
   * that already exists, so matching on names would rewrite every one of them on the first migration
   * after upgrading.
   */
  it('says nothing about a key whose columns are unchanged, whatever it is called', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect());
    const table = buildSchemaAST([MemberBefore]).getTable('Member')!;
    table.primaryKeyName = 'some_legacy_name';

    expect(generator.diffSchema(MemberBefore, table)).toBeUndefined();
  });

  it('reverses itself, restoring the key under the name the database had for it', () => {
    const generator = new SqlSchemaGenerator(new PostgresDialect());
    const diff = generator.diffSchema(MemberAfter, existingTable())!;

    expect(generator.generateAlterTableDown(diff)).toEqual([
      'ALTER TABLE "Member" DROP CONSTRAINT "Member__userId_groupId_pk";',
      'ALTER TABLE "Member" DROP COLUMN "groupId";',
      'ALTER TABLE "Member" ADD CONSTRAINT "Member_pkey" PRIMARY KEY ("userId");',
    ]);
  });

  /** SQLite's only route is rebuilding the table, so it refuses by name rather than emitting DDL. */
  it('refuses on an engine that cannot alter a key at all', () => {
    const generator = new SqlSchemaGenerator(new SqliteDialect());
    const diff = generator.diffSchema(MemberAfter, existingTable())!;

    expect(() => generator.generateAlterTable(diff)).toThrow(
      /Cannot change the primary key of "Member" - this database has no ALTER for it/,
    );
  });
});

describe('a composite key across a relation', () => {
  const dialect = new PostgresDialect();

  /** Declares no foreign key of its own, so every column below is one registration worked out. */
  @Entity()
  class Attendance {
    @Id({ type: Number }) id?: number;
    @ManyToOne({ entity: () => Enrolment }) enrolment?: Enrolment;
  }
  const ddl = new SqlSchemaGenerator(dialect).generateCreateSchema([Enrolment, Attendance]).join('\n');

  it('derives one column per key, named for the relation and the key', () => {
    expect(ddl).toContain('"enrolmentStudentId"');
    expect(ddl).toContain('"enrolmentCourseId"');
  });

  it('names one foreign key over every column, not one per column', () => {
    expect(ddl).toContain(
      'FOREIGN KEY ("enrolmentStudentId", "enrolmentCourseId") REFERENCES "Enrolment" ("studentId", "courseId")',
    );
    // Two single-column constraints would not enforce the pair, and the engine rejects them anyway.
    expect(ddl).not.toContain('FOREIGN KEY ("enrolmentStudentId") REFERENCES');
  });

  /** Neither column states a type, so both are resolved from the key each one points at. */
  it('types each foreign key column from the key it points at', () => {
    expect(ddl).toContain('"enrolmentStudentId" BIGINT');
    expect(ddl).toContain('"enrolmentCourseId" TEXT');
  });

  it('correlates a relation filter on every key of the parent', () => {
    const ctx = dialect.createContext();
    dialect.find(ctx, Enrolment, { $where: { notes: { body: 'x' } } } as never);
    // Both keys correlated, anded: matching on one alone would find another parent's notes.
    expect(ctx.sql).toContain('"enrolmentStudentId" = "Enrolment"."studentId"');
    expect(ctx.sql).toContain('"enrolmentCourseId" = "Enrolment"."courseId"');
  });
});

describe('naming settled rows', () => {
  /**
   * A list of ids is an `IN` over the one key column, which a composite has no single column for.
   * The same list of id objects is a list of `$where`s, so it is an OR of them - which is also what
   * makes the documented array `$where` work, rather than being read as a list of bare ids.
   */
  it('names a list of composite rows by an OR of their keys', () => {
    const ctx = new PostgresDialect().createContext();
    new PostgresDialect().delete(ctx, Enrolment, {
      $where: [
        { studentId: 1, courseId: 'maths' },
        { studentId: 2, courseId: 'physics' },
      ],
    });
    expect(ctx.sql).toBe(
      'DELETE FROM "Enrolment" WHERE ("studentId" = $1 AND "courseId" = $2) OR ("studentId" = $3 AND "courseId" = $4)',
    );
    expect(ctx.values).toEqual([1, 'maths', 2, 'physics']);
  });

  /**
   * A paged write settles the rows first and then names them, because `ORDER BY`/`LIMIT` on an
   * UPDATE is MySQL's alone. Naming them by one column of a composite would address every row
   * agreeing on it, so the settled set is a list of id objects.
   */
  it('names a settled composite row by every key', () => {
    const meta = getMeta(Enrolment);
    expect(idOf(meta, { studentId: 1, courseId: 'c2', grade: 'A' })).toEqual({ studentId: 1, courseId: 'c2' });
  });

  it('names a single-key row by the value itself, which is what a `$where` takes', () => {
    expect(idOf(getMeta(Note), { id: 7, body: 'x' })).toBe(7);
  });
});

describe('reading composite rows', () => {
  it('finds one row by its whole key', async () => {
    const found = await pool.findOneById(Enrolment, { studentId: 1, courseId: 'maths' });
    expect(found?.grade).toBe('A');
  });

  /** Each key alone matches three rows and two rows; only the pair names one. */
  it('populates a to-many by every key, not by whichever column comes first', async () => {
    const [found] = await pool.findMany(Enrolment, {
      $where: { studentId: 1, courseId: 'maths' },
      $populate: { notes: true },
    });
    expect(found?.notes?.map((note) => note.body)).toEqual(['first', 'second']);
  });

  it('counts a to-many by every key', async () => {
    const founds = await pool.findMany(Enrolment, { $count: { notes: true }, $sort: { courseId: 1, studentId: 1 } });
    expect(founds.map((it) => [it.studentId, it.courseId, it._count.notes])).toEqual([
      [1, 'maths', 2],
      [2, 'maths', 1],
      [3, 'maths', 0],
      [1, 'physics', 1],
    ]);
  });

  /**
   * The other direction: a join over both foreign key columns, not just the first. Every key column
   * survives the projection on both sides, which is what lets the rows be grouped and addressed.
   */
  it('joins a to-one whose target key is composite', async () => {
    const founds = await pool.findMany(Note, {
      $select: { body: true },
      $populate: { enrolment: { $select: { grade: true } } },
      $where: { body: 'other student' },
    });
    expect(founds).toEqual([
      { id: 3, body: 'other student', enrolment: { studentId: 2, courseId: 'maths', grade: 'C' } },
    ]);
  });

  /**
   * A junction holds one column per key of each side, and the pairs are the parent's followed by the
   * target's - so where the parent's end is decides which columns correlate and which identify the
   * target. Both enrolments below share a student and a course respectively.
   */
  it('reads a many-to-many through a junction keyed by every column', async () => {
    const founds = await pool.findMany(Enrolment, {
      $select: { studentId: true, courseId: true },
      $populate: { badges: { $select: { label: true } } },
      $count: { badges: true },
      $where: { courseId: 'maths' },
      $sort: { studentId: 1 },
    });
    expect(founds.map((it) => [it.studentId, it._count.badges, it.badges?.map((badge) => badge.label)])).toEqual([
      [1, 2, ['merit', 'honours']],
      [2, 1, ['honours']],
      [3, 0, []],
    ]);
  });

  /** Both guards name what the tallies group by, which for a composite is every column of the key. */
  it('refuses a $count it cannot group, naming every key', async () => {
    await expect(pool.findMany(Enrolment, { $count: { notes: true }, $distinct: true })).rejects.toThrow(
      /group by each row's 'studentId, courseId'/,
    );
    await expect(pool.findMany(Enrolment, { $count: { notes: true }, $select: [raw`"grade"`] })).rejects.toThrow(
      /needs the 'studentId, courseId' of each row/,
    );
  });

  it('filters by a many-to-many on every key of the parent', async () => {
    const founds = await pool.findMany(Enrolment, {
      $select: { studentId: true, courseId: true },
      $where: { badges: { label: 'merit' } },
    });
    expect(founds).toEqual([{ studentId: 1, courseId: 'maths' }]);
  });

  it('filters by a relation on every key', async () => {
    const founds = await pool.findMany(Enrolment, { $where: { notes: { body: 'first' } } });
    expect(founds).toEqual([{ studentId: 1, courseId: 'maths', grade: 'A' }]);
  });

  /** A paged write names the rows it settled on, which for a composite is a list of id objects. */
  it('deletes the page it settled on, and nothing that only shares a column', async () => {
    await pool.insertMany(Enrolment, [
      { studentId: 8, courseId: 'latin' },
      { studentId: 9, courseId: 'latin' },
    ]);

    const changes = await pool.deleteMany(Enrolment, {
      $where: { courseId: 'latin' },
      $sort: { studentId: -1 },
      $limit: 1,
    });

    expect(changes).toBe(1);
    const left = await pool.findMany(Enrolment, {
      $select: { studentId: true, courseId: true },
      $where: { courseId: 'latin' },
    });
    expect(left).toEqual([{ studentId: 8, courseId: 'latin' }]);
  });
});

/**
 * A cascade names its children by the columns holding the parent's key. One `IN` fits a single
 * column; several take an OR of key maps, because independent `IN`s would also match a pairing no
 * parent has - which a read absorbs by regrouping and a delete cannot.
 */
it('cascades to the children of the whole key, not of one column of it', async () => {
  await pool.insertMany(Term, [
    { year: 2030, season: 'spring' },
    { year: 2030, season: 'autumn' },
  ]);
  await pool.insertMany(Session, [
    { id: 1, termYear: 2030, termSeason: 'spring' },
    { id: 2, termYear: 2030, termSeason: 'autumn' },
  ]);

  await pool.deleteOneById(Term, { year: 2030, season: 'spring' });

  // The surviving term shares the year, so a cascade over `termYear` alone would have taken its own.
  expect(await pool.findMany(Session, { $select: { id: true } })).toEqual([{ id: 2 }]);
  expect(await pool.findOneById(Term, { year: 2030, season: 'autumn' })).toBeDefined();
});
