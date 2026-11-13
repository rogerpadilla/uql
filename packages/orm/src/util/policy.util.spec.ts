import { describe, expect, it } from 'vitest';
import { withContext } from '../context/context.js';
import { Entity, f, Field, getMeta, ManyToOne, OneToMany } from '../entity/index.js';
import { $context } from './contextRefs.js';
import {
  bindContext,
  contextEntries,
  explainPolicies,
  fromContext,
  nextBinding,
  NOTHING_BOUND,
  oldReads,
  onWritten,
  policyTransitions,
  policyWhere,
  unsettled,
} from './policy.util.js';
import { sql } from './sql.js';

@Entity()
class Member {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number().nullable()) projectId?: number | null;
  @Field(f.string().nullable()) userId?: string | null;
  @ManyToOne(() => Project, { references: (member) => member.projectId }) project?: Project;
}

@Entity({
  policies: [
    { must: { tenantId: $context.orgId } },
    { allow: { ownerId: $context.userId } },
    { allow: { members: { userId: $context.userId } }, ops: ['read'] },
    { allow: { status: 'public' }, ops: ['read'] },
    { allow: {}, when: { role: 'admin' } },
  ],
})
class Project {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.number().nullable()) tenantId?: number | null;
  @Field(f.string().nullable()) ownerId?: string | null;
  @Field(f.string().nullable()) status?: string | null;
  @OneToMany(() => Member, { mappedBy: (member) => member.project }) members?: Member[];
}

const meta = getMeta(Project);
const user = { orgId: 1, userId: 'u' };

describe('bindContext', () => {
  it('should read each key the context holds', () => {
    expect(
      bindContext(meta, { ownerId: $context.userId, tenantId: { $gte: $context.orgId } }, fromContext(user)),
    ).toEqual({
      $and: [{ ownerId: 'u' }, { tenantId: { $gte: 1 } }],
    });
  });

  it('should leave a predicate reading no key as it is', () => {
    const where = { status: 'public' };
    expect(bindContext(meta, where, fromContext(undefined))).toBe(where);
  });

  it('should make a comparison against a missing key match nothing, as SQL compares NULL', () => {
    expect(bindContext(meta, { ownerId: $context.userId }, fromContext({}))).toBe(false);
    expect(bindContext(meta, { ownerId: { $ne: $context.userId } }, fromContext({}))).toBe(false);
    expect(bindContext(meta, { ownerId: $context.userId }, fromContext({ userId: null }))).toBe(false);
  });

  it('should keep the branches of an $or a missing key leaves standing', () => {
    expect(bindContext(meta, { $or: [{ ownerId: $context.userId }, { status: 'public' }] }, fromContext({}))).toEqual({
      status: 'public',
    });
  });

  it('should keep a negated comparison against a missing key from ever holding', () => {
    expect(bindContext(meta, { $not: [{ ownerId: $context.userId }] }, fromContext({}))).toBe(false);
    expect(bindContext(meta, { $nor: [{ ownerId: $context.userId }, { status: 'x' }] }, fromContext({}))).toBe(false);
    expect(bindContext(meta, { ownerId: { $not: { $eq: $context.userId } } }, fromContext({}))).toBe(false);
  });

  it('should keep a negation that stays a predicate, and SQL beside a context read as it is', () => {
    const raw = sql`1 = 1`;
    expect(bindContext(meta, { $not: [{ ownerId: $context.userId }] }, fromContext(user))).toEqual({
      $not: [{ ownerId: 'u' }],
    });
    expect(bindContext(meta, { $and: [raw, { ownerId: $context.userId }] }, fromContext(user))).toEqual({
      $and: [{ $and: [raw] }, { ownerId: 'u' }],
    });
  });

  it('should read a relation reaching every related row as one reaching any', () => {
    expect(bindContext(meta, { members: {}, ownerId: $context.userId }, fromContext(user))).toEqual({
      $and: [{ members: {} }, { ownerId: 'u' }],
    });
  });

  it("should read a relation's predicate on its own, a subquery answering true or false", () => {
    expect(bindContext(meta, { members: { userId: $context.userId } }, fromContext(user))).toEqual({
      members: { userId: 'u' },
    });
    expect(bindContext(meta, { members: { userId: $context.userId } }, fromContext({}))).toBe(false);
    expect(bindContext(meta, { ownerId: { $in: [$context.userId] } }, fromContext(user))).toEqual({
      ownerId: { $in: [user.userId] },
    });
    expect(bindContext(meta, { $not: [{ members: { userId: $context.userId } }] }, fromContext({}))).toBe(true);
  });
});

describe('$context', () => {
  it('should answer a ref for each key, and nothing for a symbol a printer probes', () => {
    expect($context.userId).toEqual({ $context: 'userId' });
    expect(Reflect.get($context, Symbol.toPrimitive)).toBeUndefined();
  });
});

describe('contextEntries', () => {
  it('should send each scalar and date as text, leaving out what no setting can name or hold', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(contextEntries({ orgId: 1, admin: true, at, roles: ['a'], 'x-y': 'z', none: null })).toEqual([
      ['orgId', '1'],
      ['admin', 'true'],
      ['at', '2026-01-02 03:04:05.000'],
    ]);
  });
});

describe('nextBinding', () => {
  const first = nextBinding(NOTHING_BOUND, user);

  it('should bind each scalar key of a context', () => {
    expect(first.entries).toEqual([
      ['orgId', '1'],
      ['userId', 'u'],
    ]);
  });

  it('should bind nothing where the context is the one bound', () => {
    expect(nextBinding(first.bound, user)).toEqual({ entries: [], bound: first.bound });
  });

  it('should set empty each key the transaction bound and the next context lacks', () => {
    expect(nextBinding(first.bound, { orgId: 2 }).entries).toEqual([
      ['orgId', '2'],
      ['userId', ''],
    ]);
  });

  it('should keep unbinding a key a later context lacks too, which a rollback may bring back', () => {
    const second = nextBinding(first.bound, { orgId: 2 });
    expect(nextBinding(second.bound, { orgId: 3 }).entries).toEqual([
      ['orgId', '3'],
      ['userId', ''],
    ]);
  });

  it('should bind its context again once a rollback unsettled what is bound', () => {
    expect(nextBinding(unsettled(first.bound), user).entries).toEqual(first.entries);
  });

  it('should bind nothing for no context where the transaction bound none', () => {
    expect(nextBinding(NOTHING_BOUND, undefined).entries).toEqual([]);
  });
});

describe('policyWhere', () => {
  it('should OR the allows and AND the musts holding a statement', () => {
    expect(policyWhere(meta, 'read', '$old', user)).toEqual({
      $and: [{ tenantId: 1 }, { $or: [{ ownerId: 'u' }, { members: { userId: 'u' } }, { status: 'public' }] }],
    });
  });

  // A policy holding both statements is ANDed in once, not once per statement.
  it('should hold an update to the read policies and its own, each once', () => {
    expect(policyWhere(meta, 'update', '$old', user)).toEqual({
      $and: [
        { tenantId: 1 },
        { $or: [{ ownerId: 'u' }, { members: { userId: 'u' } }, { status: 'public' }] },
        { ownerId: 'u' },
      ],
    });
  });

  it('should fold a policy holding under the context to every row its musts leave', () => {
    expect(policyWhere(meta, 'delete', '$old', { ...user, role: 'admin' })).toEqual({ tenantId: 1 });
  });

  it('should reach no row where a must reads a missing key, whatever the allows', () => {
    expect(policyWhere(meta, 'read', '$old', { userId: 'u', role: 'admin' })).toBe(false);
  });

  it('should reach no row where no allow holds the statement', () => {
    @Entity({ policies: [{ allow: {}, ops: ['read'] }] })
    class ReadOnly {
      @Field(f.number().autoIncrement()) id?: number;
    }
    expect(policyWhere(getMeta(ReadOnly), 'read', '$old', undefined)).toBe(true);
    expect(policyWhere(getMeta(ReadOnly), 'delete', '$old', undefined)).toBe(false);
  });

  it('should answer nothing for an entity with no policies', () => {
    expect(policyWhere(getMeta(Member), 'read', '$old', user)).toBeUndefined();
  });
});

describe('an entity declaring no allow', () => {
  @Entity({ policies: [{ must: { tenantId: $context.orgId } }] })
  class Ledger {
    @Field(f.number().autoIncrement()) id?: number;
    @Field(f.number().nullable()) tenantId?: number | null;
  }

  it('should reach every row its musts leave', () => {
    expect(policyWhere(getMeta(Ledger), 'delete', '$old', user)).toEqual({ tenantId: 1 });
    expect(policyWhere(getMeta(Ledger), 'insert', '$new', user)).toEqual({ tenantId: 1 });
  });

  it('should reach none where a must reads a missing key', () => {
    expect(policyWhere(getMeta(Ledger), 'read', '$old', {})).toBe(false);
  });
});

describe('when', () => {
  @Entity({ policies: [{ allow: { id: 0 } }, { allow: {}, ops: ['read'], when: { role: ['admin', 'owner'] } }] })
  class Ranked {
    @Field(f.number().autoIncrement()) id?: number;
  }

  it('should hold a policy where the context key is one of the values it lists', () => {
    expect(policyWhere(getMeta(Ranked), 'read', '$old', { role: 'owner' })).toBe(true);
    expect(policyWhere(getMeta(Ranked), 'read', '$old', { role: 'guest' })).toEqual({ id: 0 });
  });
});

describe('explainPolicies', () => {
  it('should answer the rows a statement reaches and what a row it writes must hold', () => {
    expect(explainPolicies(Project, 'update', { ...user, role: 'admin' })).toEqual({
      $old: { tenantId: 1 },
      $new: { tenantId: 1 },
    });
    expect(explainPolicies(Project, 'insert', {})).toEqual({ $new: { id: { $in: [] } } });
  });

  it('should read the ambient context where given none', () => {
    expect(withContext(user, () => explainPolicies(Project, 'read'))).toEqual({
      $old: {
        $and: [{ tenantId: 1 }, { $or: [{ ownerId: 'u' }, { members: { userId: 'u' } }, { status: 'public' }] }],
      },
    });
  });

  it('should answer nothing for an entity with no policies', () => {
    expect(explainPolicies(Member, 'read', user)).toEqual({});
    expect(explainPolicies(Member, 'insert', user)).toEqual({});
    expect(explainPolicies(Member, 'update', user)).toEqual({});
  });

  it('should keep a predicate of several fields reading no context whole', () => {
    @Entity({ policies: [{ allow: { id: 1, tenantId: 2 } }] })
    class Fixed {
      @Field(f.number().autoIncrement()) id?: number;
      @Field(f.number().nullable()) tenantId?: number | null;
    }
    expect(explainPolicies(Fixed, 'delete', user)).toEqual({ $old: { id: 1, tenantId: 2 } });
  });
});

describe('policy sides', () => {
  @Entity({
    policies: [
      { allow: { ownerId: $context.userId, $new: { status: { $ne: 'void' } } } },
      { must: { $old: { status: { $ne: 'locked' } } }, ops: ['update', 'delete'] },
    ],
  })
  class Sided {
    @Field(f.number().autoIncrement()) id?: number;
    @Field(f.string().nullable()) ownerId?: string | null;
    @Field(f.string().nullable()) status?: string | null;
  }
  const sided = getMeta(Sided);

  it('should hold the row as found to the conditions on every row and those on $old', () => {
    expect(policyWhere(sided, 'update', '$old', user)).toEqual({
      $and: [{ status: { $ne: 'locked' } }, { ownerId: 'u' }],
    });
  });

  // An unqualified condition holds the written row too, so a write cannot hand the row to another owner.
  it('should hold the row as written to the conditions on every row and those on $new', () => {
    expect(policyWhere(sided, 'update', '$new', user)).toEqual({
      $and: [{ ownerId: 'u' }, { status: { $ne: 'void' } }],
    });
  });

  it('should keep SQL ANDed in, and AND conditions of one field the sides both name', () => {
    const raw = sql`1 = 1`;
    @Entity({ policies: [{ allow: { $and: [raw, { status: 'a' }], $old: { status: { $ne: 'b' } } } }] })
    class Twice {
      @Field(f.number().autoIncrement()) id?: number;
      @Field(f.string().nullable()) status?: string | null;
    }
    expect(policyWhere(getMeta(Twice), 'read', '$old', user)).toEqual({
      $and: [{ $and: [raw] }, { status: 'a' }, { status: { $ne: 'b' } }],
    });
  });

  it('should hold a statement to no side it lacks', () => {
    expect(policyWhere(sided, 'insert', '$old', user)).toBeUndefined();
    expect(policyWhere(sided, 'read', '$new', user)).toBeUndefined();
  });

  it('should read the context inside a side, a missing key there matching nothing however negated', () => {
    expect(bindContext(meta, { $old: { ownerId: $context.userId } }, fromContext(user))).toEqual({
      $old: { ownerId: 'u' },
    });
    expect(bindContext(meta, { $old: { ownerId: $context.userId } }, fromContext({}))).toBe(false);
    expect(bindContext(meta, { $not: [{ $new: { ownerId: $context.userId } }] }, fromContext({}))).toBe(false);
  });
});

describe('policyTransitions', () => {
  const steps = {
    $or: [
      { $old: { status: 'draft' }, $new: { status: { $in: ['draft', 'published'] } } },
      { $old: { status: 'published' }, $new: { status: 'archived' } },
    ],
  };

  @Entity({ policies: [{ must: { ownerId: $context.userId, ...steps }, ops: ['update'] }] })
  class Article {
    @Field(f.number().autoIncrement()) id?: number;
    @Field(f.string().nullable()) ownerId?: string | null;
    @Field(f.string().nullable()) status?: string | null;
  }
  const article = getMeta(Article);

  it('should hold neither side to a group pairing both rows, and answer it as a transition', () => {
    expect(policyWhere(article, 'update', '$old', user)).toEqual({ ownerId: 'u' });
    expect(policyWhere(article, 'update', '$new', user)).toEqual({ ownerId: 'u' });
    expect(policyTransitions(article, user)).toEqual([steps]);
  });

  it('should read each condition on the row as found, negated under a negation', () => {
    expect(oldReads<Article>({ $or: [{ $old: { status: 'a' } }, { $not: [{ $old: { status: 'b' } }] }] })).toEqual([
      { status: 'a' },
      { $not: [{ status: 'b' }] },
    ]);
  });

  it('should hold an unqualified condition of a transition on the row as found and as written', () => {
    expect(oldReads<Article>({ $or: [{ ownerId: 'u' }] })).toEqual([{ ownerId: 'u' }]);
    expect(onWritten<Article>({ $or: [{ ownerId: 'u' }] }, () => true)).toEqual({ ownerId: 'u' });
  });

  it('should fold a transition on the row as written once each condition on the row as found is answered', () => {
    expect(onWritten<Article>(steps, (at) => at === 0)).toEqual({ status: { $in: ['draft', 'published'] } });
    expect(onWritten<Article>(steps, () => false)).toBe(false);
  });

  it('should answer none for an entity declaring no transition', () => {
    expect(policyTransitions(meta, user)).toEqual([]);
  });

  it('should explain each side a statement reads, and the transitions an update is held to', () => {
    expect(explainPolicies(Article, 'update', user)).toEqual({
      $old: { ownerId: 'u' },
      $new: { ownerId: 'u' },
      $and: [steps],
    });
  });
});
