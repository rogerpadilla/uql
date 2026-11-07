import { describe, expect, it } from 'vitest';
import { defineEntity, Entity, f, Field, getMeta, ManyToOne } from '../entity/index.js';
import { Item, User } from '../test/index.js';
import type { EntityAccess, Type, Wire } from '../type/index.js';
import { sql } from '../util/index.js';
import { assertExposed, exposedQuery, hideUnreadable, serve, type ServedEntities } from './exposure.js';

const servedOf = (...entities: Type<object>[]): ServedEntities =>
  new Map(entities.map((entity) => [entity, undefined]));

/** A row a member's write nests, taking `wire`. */
const nestedRow = (name: string, wire: Wire<EntityAccess>) =>
  defineEntity({
    name,
    wire,
    fields: {
      id: f.number().autoIncrement(),
      memberId: f.number().nullable(),
      filedAt: f.date().nullable().updatable(false),
    },
  });

const Badge = nestedRow('WiredBadge', ['read', 'update']);
const Stamp = nestedRow('WiredStamp', ['read', 'insert']);
const Note = nestedRow('WiredNote', ['read', 'insert', 'update']);
const Inbox = nestedRow('WiredInbox', ['insert']);

const Firm = defineEntity({
  name: 'WiredFirm',
  fields: {
    id: f.number().autoIncrement(),
    name: f.string(),
    kind: f.jsonb<{ plan: string }>().nullable().wire(false),
  },
});

const Avatar = defineEntity({
  name: 'WiredAvatar',
  fields: {
    id: f.number().autoIncrement(),
    picture: f.string().nullable().wire(['read']),
    note: f.string().nullable().wire(false),
    memberId: f.number().nullable(),
  },
}).relations((rel) => ({ member: () => rel.oneToOne(Member, { references: (avatar) => avatar.memberId }) }));

const Member = defineEntity({
  name: 'WiredMember',
  wire: ['read', 'insert', 'update'],
  fields: {
    id: f.number().autoIncrement(),
    name: f.string().nullable(),
    email: f.string().nullable().wire(['read']),
    password: f.string().nullable().wire(['insert']),
    joinedAt: f.date().nullable().updatable(false),
    firmId: f.number().nullable(),
    creatorId: f.number().nullable(),
    badgeId: f.number().nullable(),
    stampId: f.number().nullable(),
    inboxId: f.number().nullable(),
  },
})
  .computed((member) => ({ shout: f.string().as(sql`upper(${member.name})`) }))
  .relations((rel) => ({
    firm: () => rel.manyToOne(Firm, { references: (member) => member.firmId }),
    creator: () => rel.manyToOne(Member, { references: (member) => member.creatorId }),
    avatar: () => rel.oneToOne(Avatar, { mappedBy: (avatar) => avatar.member, cascade: true }),
    members: () => rel.oneToMany(Member, { mappedBy: (member) => member.creator, wire: false }),
    badge: () => rel.oneToOne(Badge, { references: (member) => member.badgeId, cascade: 'persist' }),
    stamp: () => rel.oneToOne(Stamp, { references: (member) => member.stampId, cascade: 'persist' }),
    notes: () =>
      rel.oneToMany(Note, {
        references: (member, note) => [{ local: member.id, foreign: note.memberId }],
        cascade: true,
      }),
    inbox: () => rel.manyToOne(Inbox, { references: (member) => member.inboxId }),
  }));

@Entity({ wire: ['read', 'insert'] })
class WiredVault {
  @Field(f.number().autoIncrement()) id?: number;
  @Field(f.string().wire(false)) secret?: string;
  @Field(f.number().nullable()) parentId?: number | null;
  @ManyToOne(() => WiredVault, { references: (vault) => vault.parentId, wire: ['insert'] }) parent?: WiredVault;
}

@Entity()
class WiredSafe extends WiredVault {}

const served = servedOf(Member, Avatar);

const member = getMeta(Member);

describe('assertExposed', () => {
  it.each([
    { op: 'deleteMany', refusal: "'WiredMember' cannot be deleted through this API" },
    { op: 'deleteOneById', refusal: "'WiredMember' cannot be deleted through this API" },
  ] as const)('should refuse $op on an entity that does not take it', ({ op, refusal }) => {
    expect(() => assertExposed(member, op, {}, undefined, served)).toThrow(refusal);
  });

  it('should refuse a save on an entity taking inserts alone, a save updating as well', () => {
    const inbox = getMeta(Inbox);
    const inboxes = servedOf(Inbox);

    expect(() => assertExposed(inbox, 'insertOne', {}, { memberId: 1 }, inboxes)).not.toThrow();
    expect(() => assertExposed(inbox, 'saveOne', {}, { memberId: 1 }, inboxes)).toThrow(
      "'WiredInbox' cannot be updated through this API",
    );
  });

  /** Filtering, sorting or tallying by a value reads it as surely as selecting it does, a character at a time. */
  it.each([
    { clause: '$select', query: { $select: { password: true } }, path: 'password' },
    { clause: '$select', query: { $select: { password: false } }, path: 'password' },
    { clause: '$where', query: { $where: { password: { $startsWith: 'a' } } }, path: 'password' },
    { clause: '$where', query: { $where: { $or: [{ name: 'a' }, { password: 'b' }] } }, path: 'password' },
    { clause: '$where', query: { $where: { creator: { password: 'b' } } }, path: 'creator.password' },
    { clause: '$sort', query: { $sort: { password: 1 } }, path: 'password' },
    { clause: '$sort', query: { $sort: { creator: { password: 1 } } }, path: 'creator.password' },
    {
      clause: '$populate',
      query: { $populate: { creator: { $select: { password: true } } } },
      path: 'creator.password',
    },
    { clause: '$populate', query: { $populate: { members: true } }, path: 'members' },
    { clause: '$count', query: { $count: { members: true } }, path: 'members' },
  ])('should refuse a read of what is not readable, in $clause', ({ query, path }) => {
    expect(() => assertExposed(member, 'findMany', query, undefined, served)).toThrow(
      `'${path}' cannot be read through this API`,
    );
  });

  /** What a form highlights the field by: every key from the call's root, clauses and list indexes included. */
  it.each([
    {
      op: 'findMany',
      query: { $where: { $or: [{ name: 'a' }, { password: 'b' }] } },
      payload: undefined,
      path: ['query', '$where', '$or', 1, 'password'],
    },
    {
      op: 'findMany',
      query: { $where: { creator: { password: 'b' } } },
      payload: undefined,
      path: ['query', '$where', 'creator', 'password'],
    },
    {
      op: 'findMany',
      query: { $populate: { firm: true } },
      payload: undefined,
      path: ['query', '$populate', 'firm'],
    },
    { op: 'insertMany', query: {}, payload: [{ name: 'a' }, { email: 'a@b.c' }], path: ['payload', 1, 'email'] },
  ] as const)('should point at what it refuses: $path', ({ op, query, payload, path }) => {
    expect(() => assertExposed(member, op, query, payload, served)).toThrow(expect.objectContaining({ path }));
  });

  it('should refuse a filter on what is not readable in a write too', () => {
    expect(() => assertExposed(member, 'updateMany', { $where: { password: 'a' } }, { name: 'b' }, served)).toThrow(
      "'password' cannot be read through this API",
    );
  });

  it.each([
    { op: 'insertOne', payload: { email: 'a@b.c' }, refusal: "'email' cannot be inserted through this API" },
    { op: 'insertMany', payload: [{ name: 'a' }, { email: 'a@b.c' }], refusal: "'email' cannot be inserted" },
    { op: 'updateMany', payload: { password: 'x' }, refusal: "'password' cannot be updated through this API" },
    { op: 'updateOneById', payload: { email: 'a@b.c' }, refusal: "'email' cannot be updated through this API" },
    { op: 'saveOne', payload: { password: 'x' }, refusal: "'password' cannot be updated through this API" },
    {
      op: 'insertOne',
      payload: { avatar: { picture: 'a.png' } },
      refusal: "'avatar.picture' cannot be inserted through this API",
    },
    { op: 'updateMany', payload: { joinedAt: new Date() }, refusal: "'joinedAt' cannot be updated through this API" },
    { op: 'insertOne', payload: { shout: 'A' }, refusal: "'shout' cannot be inserted through this API" },
  ] as const)('should refuse $op writing what it does not take', ({ op, payload, refusal }) => {
    expect(() => assertExposed(member, op, {}, payload, served)).toThrow(refusal);
  });

  /** A save or a cascade may insert, which writes a field no update does. */
  it('should take a field only an update drops in a write that may insert', () => {
    expect(() => assertExposed(member, 'saveOne', {}, { joinedAt: new Date() }, served)).not.toThrow();
    expect(() =>
      assertExposed(member, 'insertOne', {}, { notes: [{ filedAt: new Date() }] }, servedOf(Member, Note)),
    ).not.toThrow();
  });

  it('should take what each field takes', () => {
    expect(() =>
      assertExposed(member, 'insertOne', {}, { name: 'a', password: 'x', joinedAt: new Date() }, served),
    ).not.toThrow();
    expect(() => assertExposed(member, 'updateMany', { $where: { email: 'a' } }, { name: 'b' }, served)).not.toThrow();
    expect(() =>
      assertExposed(
        member,
        'findMany',
        { $select: { name: true, email: true }, $populate: { avatar: true } },
        undefined,
        served,
      ),
    ).not.toThrow();
  });

  it('should refuse a relation reaching an entity it does not serve', () => {
    expect(() => assertExposed(member, 'findMany', { $populate: { firm: true } }, undefined, served)).toThrow(
      "'firm' reaches 'WiredFirm', which this API does not serve",
    );
  });

  /** A JSON path reads the member it starts at, so a hidden column is no more readable a key at a time. */
  it.each([
    { query: { $where: { 'kind.plan': { $startsWith: 'a' } } } },
    { query: { $sort: { 'kind.plan': 1 } } },
    { query: { $where: { $or: [{ 'kind.plan': 'pro' }] } } },
  ])('should refuse a JSON path into what is not readable: $query', ({ query }) => {
    expect(() => assertExposed(getMeta(Firm), 'findMany', query, undefined, servedOf(Firm))).toThrow(
      "'kind.plan' cannot be read through this API",
    );
  });

  /** A cascade saves the rows a write nests, inserting new ones and updating listed ones, whatever the op. */
  it('should hold a relation a write nests to what a save takes', () => {
    const nested = servedOf(Member, Badge, Stamp);

    expect(() => assertExposed(member, 'updateMany', {}, { badge: {} }, nested)).toThrow(
      "'WiredBadge' cannot be inserted through this API",
    );
    expect(() => assertExposed(member, 'insertOne', {}, { stamp: {} }, nested)).toThrow(
      "'WiredStamp' cannot be updated through this API",
    );
  });

  /** An update of a to-many replaces its rows: those it does not list are deleted. */
  it('should hold a to-many an update nests to deleting the rows it no longer lists', () => {
    const notes = servedOf(Member, Note);

    expect(() => assertExposed(member, 'updateMany', {}, { notes: [{}] }, notes)).toThrow(
      "'WiredNote' cannot be deleted through this API",
    );
    expect(() => assertExposed(member, 'insertOne', {}, { notes: [{}] }, notes)).not.toThrow();
  });

  /** The querier writes a relation a payload names only where it cascades: any other it leaves as it is. */
  it('should leave alone a relation a write names that does not cascade', () => {
    expect(() => assertExposed(member, 'updateMany', {}, { inbox: { memberId: 1 } }, servedOf(Member))).not.toThrow();
  });

  it('should take nothing on an entity it does not serve', () => {
    expect(() => assertExposed(getMeta(Firm), 'findMany', {}, undefined, served)).toThrow(
      "'WiredFirm' cannot be read through this API",
    );
  });

  it('should take every operation on an entity served as it is, and every member no wire narrows', () => {
    expect(() =>
      assertExposed(getMeta(Avatar), 'deleteMany', { $where: { member: { name: 'b' } } }, undefined, served),
    ).not.toThrow();
  });

  it("should hold a decorated class's fields and relations to their wire", () => {
    const vault = getMeta(WiredVault);
    const vaults = servedOf(WiredVault);

    expect(() => assertExposed(vault, 'findMany', { $where: { secret: 'a' } }, undefined, vaults)).toThrow(
      "'secret' cannot be read through this API",
    );
    expect(() => assertExposed(vault, 'findMany', { $populate: { parent: true } }, undefined, vaults)).toThrow(
      "'parent' cannot be read through this API",
    );
    expect(hideUnreadable(vault, {})).toEqual({ $select: { secret: false } });
  });

  it("should hold an entity to its definition's wire, a subclass declaring none to its base's", () => {
    expect(() => assertExposed(getMeta(WiredVault), 'deleteMany', {}, undefined, servedOf(WiredVault))).toThrow(
      "'WiredVault' cannot be deleted through this API",
    );
    expect(() => assertExposed(getMeta(WiredSafe), 'updateMany', {}, {}, servedOf(WiredSafe))).toThrow(
      "'WiredSafe' cannot be updated through this API",
    );
  });
});

describe('serve', () => {
  /** An API hands an entity's middleware that entity's calls alone, and the guard holds the same off it. */
  it("should run an entity's middleware on its own calls, handing any other on as it is", async () => {
    const seen: string[] = [];
    const { around } = serve(User, {
      use: [
        (call, _context, next) => {
          seen.push(call.entity.name);
          return next(call);
        },
      ],
    });
    const next = async () => 'answered';

    expect(await around({ entity: Item, op: 'count', query: {}, hardDelete: false }, undefined, next)).toBe('answered');
    expect(await around({ entity: User, op: 'count', query: {}, hardDelete: false }, undefined, next)).toBe('answered');
    expect(seen).toEqual(['User']);
  });
});

describe('exposedQuery', () => {
  it('should leave out what is not readable on a read answering rows, and nothing on a count', () => {
    expect(exposedQuery(member, 'findMany', {}, undefined, served)).toEqual({ $select: { password: false } });
    expect(exposedQuery(member, 'count', {}, undefined, served)).toEqual({});
  });

  it('should refuse before it projects', () => {
    expect(() => exposedQuery(member, 'findMany', { $sort: { password: 1 } }, undefined, served)).toThrow(
      "'password' cannot be read through this API",
    );
  });
});

describe('hideUnreadable', () => {
  it('should leave out what is not readable where the read names no projection', () => {
    expect(hideUnreadable(member, {})).toEqual({ $select: { password: false } });
  });

  it('should add to a projection leaving fields out, and keep one naming the fields it reads', () => {
    expect(hideUnreadable(member, { $select: { name: false } })).toEqual({
      $select: { name: false, password: false },
    });
    expect(hideUnreadable(member, { $select: { name: true } })).toEqual({ $select: { name: true } });
  });

  it('should leave out what a populated relation cannot read, at any depth', () => {
    expect(hideUnreadable(member, { $populate: { avatar: { $populate: { member: true } } } })).toEqual({
      $select: { password: false },
      $populate: { avatar: { $select: { note: false }, $populate: { member: { $select: { password: false } } } } },
    });
  });

  it('should leave alone what a $populate does not populate: a relation turned off, a key no relation has', () => {
    const query = { $populate: { avatar: false, nothing: true } };

    expect(hideUnreadable(member, query).$populate).toBe(query.$populate);
  });

  it('should leave a read of an entity with nothing hidden as it is', () => {
    const query = { $where: { name: 'a' } };

    expect(hideUnreadable(getMeta(User), query)).toBe(query);
  });
});
