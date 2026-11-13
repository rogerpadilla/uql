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
  policyCheck,
  policyScope,
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

describe('policyScope', () => {
  it('should OR the allows and AND the musts holding a statement', () => {
    expect(policyScope(meta, 'read', user)).toEqual({
      $and: [{ tenantId: 1 }, { $or: [{ ownerId: 'u' }, { members: { userId: 'u' } }, { status: 'public' }] }],
    });
  });

  it('should hold an update to the read policies and its own', () => {
    expect(policyScope(meta, 'update', user)).toEqual({
      $and: [
        { tenantId: 1 },
        { $or: [{ ownerId: 'u' }, { members: { userId: 'u' } }, { status: 'public' }] },
        { tenantId: 1 },
        { ownerId: 'u' },
      ],
    });
  });

  it('should fold a policy holding under the context to every row its musts leave', () => {
    expect(policyScope(meta, 'delete', { ...user, role: 'admin' })).toEqual({
      $and: [{ tenantId: 1 }, { tenantId: 1 }],
    });
  });

  it('should reach no row where a must reads a missing key, whatever the allows', () => {
    expect(policyScope(meta, 'read', { userId: 'u', role: 'admin' })).toBe(false);
  });

  it('should reach no row where no allow holds the statement', () => {
    @Entity({ policies: [{ allow: {}, ops: ['read'] }] })
    class ReadOnly {
      @Field(f.number().autoIncrement()) id?: number;
    }
    expect(policyScope(getMeta(ReadOnly), 'read', undefined)).toBe(true);
    expect(policyScope(getMeta(ReadOnly), 'delete', undefined)).toBe(false);
  });

  it('should answer nothing for an entity with no policies', () => {
    expect(policyScope(getMeta(Member), 'read', user)).toBeUndefined();
  });
});

describe('an entity declaring no allow', () => {
  @Entity({ policies: [{ must: { tenantId: $context.orgId } }] })
  class Ledger {
    @Field(f.number().autoIncrement()) id?: number;
    @Field(f.number().nullable()) tenantId?: number | null;
  }

  it('should reach every row its musts leave', () => {
    expect(policyScope(getMeta(Ledger), 'delete', user)).toEqual({ $and: [{ tenantId: 1 }, { tenantId: 1 }] });
    expect(policyCheck(getMeta(Ledger), 'insert', user)).toEqual({ tenantId: 1 });
  });

  it('should reach none where a must reads a missing key', () => {
    expect(policyScope(getMeta(Ledger), 'read', {})).toBe(false);
  });
});

describe('when', () => {
  @Entity({ policies: [{ allow: { id: 0 } }, { allow: {}, ops: ['read'], when: { role: ['admin', 'owner'] } }] })
  class Ranked {
    @Field(f.number().autoIncrement()) id?: number;
  }

  it('should hold a policy where the context key is one of the values it lists', () => {
    expect(policyScope(getMeta(Ranked), 'read', { role: 'owner' })).toBe(true);
    expect(policyScope(getMeta(Ranked), 'read', { role: 'guest' })).toEqual({ id: 0 });
  });
});

describe('explainPolicies', () => {
  it('should answer the rows a statement reaches and what a row it writes must hold', () => {
    expect(explainPolicies(Project, 'update', { ...user, role: 'admin' })).toEqual({
      where: { $and: [{ tenantId: 1 }, { tenantId: 1 }] },
      check: { tenantId: 1 },
    });
    expect(explainPolicies(Project, 'insert', {})).toEqual({ check: { id: { $in: [] } } });
  });

  it('should read the ambient context where given none', () => {
    expect(withContext(user, () => explainPolicies(Project, 'read'))).toEqual({
      where: {
        $and: [{ tenantId: 1 }, { $or: [{ ownerId: 'u' }, { members: { userId: 'u' } }, { status: 'public' }] }],
      },
    });
  });

  it('should answer nothing for an entity with no policies', () => {
    expect(explainPolicies(Member, 'read', user)).toEqual({});
    expect(explainPolicies(Member, 'insert', user)).toEqual({});
  });

  it('should keep a predicate of several fields reading no context whole', () => {
    @Entity({ policies: [{ allow: { id: 1, tenantId: 2 } }] })
    class Fixed {
      @Field(f.number().autoIncrement()) id?: number;
      @Field(f.number().nullable()) tenantId?: number | null;
    }
    expect(explainPolicies(Fixed, 'delete', user)).toEqual({
      where: {
        $and: [
          { id: 1, tenantId: 2 },
          { id: 1, tenantId: 2 },
        ],
      },
    });
  });
});

describe('policyCheck', () => {
  it('should hold a written row to the checks of the policies holding its statement', () => {
    @Entity({ policies: [{ allow: { ownerId: $context.userId }, check: { status: { $ne: 'void' } } }] })
    class Checked {
      @Field(f.number().autoIncrement()) id?: number;
      @Field(f.string().nullable()) ownerId?: string | null;
      @Field(f.string().nullable()) status?: string | null;
    }
    expect(policyCheck(getMeta(Checked), 'insert', user)).toEqual({ status: { $ne: 'void' } });
    expect(policyScope(getMeta(Checked), 'update', user)).toEqual({ $and: [{ ownerId: 'u' }, { ownerId: 'u' }] });
  });
});
