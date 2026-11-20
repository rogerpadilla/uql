import { describe, expect, it } from 'vitest';
import { createApi } from '../../http/api.js';
import { NodeSqliteQuerierPool } from '../../sqlite/nodeSqliteQuerierPool.js';
import { idKey, readOnly } from '../../type/index.js';
import { sql } from '../../util/sql.js';
import { Entity, f, Field, ManyToOne, OneToMany, OneToOne } from '../index.js';
import { defineEntity, getEntities, getMeta } from './definition.js';

@Entity({ name: 'KeylessSite' })
class Site {
  @Field(f.number().autoIncrement()) id?: number;
  @OneToMany(() => Sample, { mappedBy: (sample) => sample.site }) samples?: Sample[];
}

@Entity({ name: 'KeylessSample' })
class Sample {
  @Field(f.references(() => Site)) siteId!: number;
  @Field(f.number()) value!: number;
  @ManyToOne(() => Site, { references: (sample) => sample.siteId }) site?: Site;
}

@Entity({ name: 'KeylessCascade' })
class Cascading {
  @Field(f.number().autoIncrement()) id?: number;
  @OneToMany(() => Logged, { mappedBy: (logged) => logged.owner, cascade: true }) logs?: Logged[];
}

@Entity({ name: 'KeylessLogged' })
class Logged {
  @Field(f.references(() => Cascading)) ownerId!: number;
  @ManyToOne(() => Cascading, { references: (logged) => logged.ownerId }) owner?: Cascading;
}

@Entity({ name: 'KeylessProfiled' })
class Profiled {
  @Field(f.number().autoIncrement()) id?: number;
  @OneToOne(() => Profile, { mappedBy: (profile) => profile.user }) profile?: Profile;
}

@Entity({ name: 'KeylessProfile' })
class Profile {
  @Field(f.references(() => Profiled)) userId!: number;
  @OneToOne(() => Profiled, { references: (profile) => profile.userId }) user?: Profiled;
}

@Entity({ name: 'KeylessParent' })
class Parent {
  @Field(f.string()) label!: string;
  @OneToMany(() => Child, { mappedBy: (child) => child.parentLabel }) children?: Child[];
}

@Entity({ name: 'KeylessChild' })
class Child {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string()) parentLabel!: string;
}

@Entity({ abstract: true })
abstract class Noted {
  @Field(f.string()) note!: string;
}

@Entity({ name: 'KeylessNotedKid' })
class NotedKid extends Noted {
  @Field(f.number().autoIncrement()) id?: number;
}

@Entity({ name: 'DeclaredRate', readOnly: true })
class Rate {
  [idKey]?: 'code';
  readonly [readOnly]?: true;
  @Field(f.string().id()) code!: string;
  @Field(f.number()) value!: number;
}

@Entity({ name: 'DeclaredRateKid' })
class RateKid extends Rate {}

@Entity({ name: 'DeclaredRateOwner' })
class RateOwner {
  @Field(f.number().autoIncrement()) id?: number;
  @OneToMany(() => Rated, { mappedBy: (rated) => rated.owner, cascade: true }) rated?: Rated[];
}

@Entity({ name: 'DeclaredRated', readOnly: true })
class Rated {
  readonly [readOnly]?: true;
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.references(() => RateOwner)) ownerId!: number;
  @ManyToOne(() => RateOwner, { references: (rated) => rated.ownerId }) owner?: RateOwner;
}

describe('a keyless entity', () => {
  it('should register with no key, and migrate as a table', () => {
    expect(getMeta(Sample).ids).toEqual([]);
    expect(getEntities()).toContain(Sample);
  });

  it('should take reads alone over the wire', async () => {
    const api = createApi({ pool: new NodeSqliteQuerierPool(':memory:'), include: [Sample] });

    expect(getMeta(Sample).readOnly).toBe(true);
    await expect(
      api.call({ entity: 'sample', op: 'insertOne', payload: { siteId: 1, value: 1 } }, undefined),
    ).rejects.toThrow("'Sample' cannot be inserted through this API");
  });

  it('should leave an entity extending a keyless base writable, its key its own', () => {
    expect(getMeta(NotedKid).readOnly).toBeUndefined();
    expect(getMeta(NotedKid).wire).toBeUndefined();
  });

  it('should refuse a wire taking a write, which it never takes', () => {
    const Wired = defineEntity({ name: 'KeylessWired', wire: ['read', 'insert'], fields: { value: f.number() } });

    expect(() => getMeta(Wired)).toThrow(
      "'KeylessWired' has no primary key, so it is read-only: its wire takes 'read' alone",
    );
  });

  it('should hold a to-one by its foreign key, and be reached by a to-many', () => {
    expect(getMeta(Sample).relations.site?.references).toEqual([{ local: 'siteId', foreign: 'id' }]);
    expect(getMeta(Site).relations.samples?.references).toEqual([{ local: 'id', foreign: 'siteId' }]);
  });

  it('should refuse a cascade reaching it, which writes rows it never takes', () => {
    expect(() => getMeta(Cascading)).toThrow(
      "'Cascading.logs' cascades into 'Logged', which has no primary key, so it is read-only",
    );
  });

  it('should refuse a to-one reaching it, which tells no row from a row of nulls without a key', () => {
    expect(() => getMeta(Profiled)).toThrow(
      "'Profiled.profile' reaches 'Profile', which has no primary key to join to",
    );
  });

  it('should refuse a relation of its own joining by its key, which it has none of', () => {
    expect(() => getMeta(Parent)).toThrow(
      "'Parent' has no primary key, which 'Parent.children', mapped by a column, needs",
    );
  });
});

describe('an entity declared read-only', () => {
  it('should keep its key, read by it, and refuse every write', async () => {
    const pool = new NodeSqliteQuerierPool(':memory:');
    await pool.run(sql.text('CREATE TABLE "DeclaredRate" ("code" TEXT PRIMARY KEY, "value" REAL)'));
    await pool.run(sql.text(`INSERT INTO "DeclaredRate" VALUES ('eur', 1.1)`));

    expect(getMeta(Rate).ids).toEqual(['code']);
    expect(await pool.findOneById(Rate, 'eur')).toEqual({ code: 'eur', value: 1.1 });
    // @ts-expect-error the compiler refuses it first
    await expect(pool.insertOne(Rate, { code: 'usd', value: 1 })).rejects.toThrow("'Rate' is read-only");
    // @ts-expect-error the compiler refuses it first
    await expect(pool.updateOneById(Rate, 'eur', { value: 2 })).rejects.toThrow("'Rate' is read-only");
    // @ts-expect-error the compiler refuses it first
    await expect(pool.deleteOneById(Rate, 'eur')).rejects.toThrow("'Rate' is read-only");
    await pool.end();
  });

  it('should take reads alone over the wire', async () => {
    const api = createApi({ pool: new NodeSqliteQuerierPool(':memory:'), include: [Rate] });

    await expect(
      api.call({ entity: 'rate', op: 'insertOne', payload: { code: 'usd', value: 1 } }, undefined),
    ).rejects.toThrow("'Rate' cannot be inserted through this API");
  });

  it('should refuse a wire taking a write', () => {
    const Wired = defineEntity({
      name: 'DeclaredWired',
      readOnly: true,
      wire: ['read', 'update'],
      fields: { id: f.number().autoIncrement() },
    });

    expect(() => getMeta(Wired)).toThrow("'DeclaredWired' is read-only: its wire takes 'read' alone");
  });

  it('should refuse a cascade reaching it', () => {
    expect(() => getMeta(RateOwner)).toThrow("'RateOwner.rated' cascades into 'Rated', which is read-only");
  });

  it('should leave an entity extending it writable, each stating its own', () => {
    expect(getMeta(RateKid).readOnly).toBeUndefined();
  });
});
