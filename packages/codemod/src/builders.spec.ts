import { describe, expect, it } from 'vitest';
import { toBuilders } from './builders.js';
import { FOREIGN_KEY_IN_DEFINED as FOREIGN_KEY, NO_KEY_TYPE, ON_DELETE_ON_RELATION } from './definedMessages.js';

const build = (text: string) => {
  const { text: written, unresolved } = toBuilders('/entities.ts', text, { taken: new Set() });
  return { text: written, unresolved };
};

describe('toBuilders', () => {
  it('should write each column as a builder, NOT NULL now the default', () => {
    const { text, unresolved } = build(`import { Entity, Field, Id } from 'uql-orm';
@Entity()
export class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, nullable: false, length: 80 }) name!: string;
  @Field({ type: String }) bio?: string | null;
  @Field({ type: Number, nullable: false, defaultValue: 0 }) score!: number;
  @Field({ type: String, enum: ['a', 'b'] as const, nullable: false }) kind!: 'a' | 'b';
  @Field({ type: 'uuid', isId: true }) uuid?: string;
  @Field({ type: 'jsonb' }) meta?: unknown;
  @Field({ type: 'decimal', precision: 12, scale: 2 }) price?: string | null;
  @Field({ type: 'timestamptz', onInsert: currentTimestamp, updatable: false }) createdAt?: Date | null;
  @Field({ type: Number, version: true }) revision?: number;
  @Field({ references: () => Company, onDelete: 'CASCADE' }) companyId?: number | null;
  @Field({ type: 'vector', dimensions: 3, distance: 'l2' }) embedding?: number[] | null;
}`);
    expect(unresolved).toEqual([]);
    expect(text).toBe(`import { f, Entity, Field } from 'uql-orm';
@Entity()
export class User {
  @Field(f.number().id()) id?: number;
  @Field(f.string().length(80)) name!: string;
  @Field(f.string().nullable()) bio?: string | null;
  @Field(f.number().default(0)) score!: number;
  @Field(f.enum(['a', 'b'])) kind!: 'a' | 'b';
  @Field(f.uuid().id()) uuid?: string;
  @Field(f.jsonb().nullable()) meta?: unknown;
  @Field(f.decimal(12, 2).nullable()) price?: string | null;
  @Field(f.column('timestamptz').nullable().onInsert(currentTimestamp).updatable(false)) createdAt?: Date | null;
  @Field(f.version()) revision?: number;
  @Field(f.references(() => Company).nullable().onDelete('CASCADE')) companyId?: number | null;
  @Field(f.vector(3).nullable().distance('l2')) embedding?: number[] | null;
}`);
  });

  it('should write a computed field as @Computed, SQL as the column it reads as', () => {
    const { text } = build(`import { Entity, Field } from 'uql-orm';
@Entity()
export class User {
  @Field({ type: String, computed: (u) => sql\`upper(\${u.name})\`, stored: true }) readonly shout?: string | null;
  @Field({ computed: (user) => user.posts.count() }) readonly postCount?: number;
}`);
    expect(text).toBe(`import { Computed, f, Entity } from 'uql-orm';
@Entity()
export class User {
  @Computed((u) => f.string().nullable().as(sql\`upper(\${u.name})\`).stored()) readonly shout?: string | null;
  @Computed((user) => user.posts.count()) readonly postCount?: number;
}`);
  });

  it("should write @Entity's lists as sections over the class's refs, each entry through its helper", () => {
    const { text, unresolved } = build(`@Entity({
  indexes: [
    { columns: (p) => [p.title, { column: p.createdAt, order: 'desc' }], unique: true },
    // by name
    { columns: (post) => [post.slug], name: 'by_slug' },
    { columns: () => [sql\`lower(title)\`], include: (post) => [post.id], where: { live: true } },
  ],
  checks: [{ name: 'positive', where: (post) => sql\`\${post.views} >= 0\` }, { where: { views: { $gte: 0 } } }],
  triggers: [{ on: 'beforeUpdate', of: (post) => [post.body], run: () => sql\`select 1\` }],
})
export class Post {}`);
    expect(unresolved).toEqual([]);
    expect(text).toBe(`@Entity({
  indexes: (post, index) => [
    index([post.title, { column: post.createdAt, order: 'desc' }], { unique: true }),
    // by name
    index([post.slug], 'by_slug'),
    index([sql\`lower(title)\`], { include: [post.id], where: { live: true } }),
  ],
  checks: (post, check) => [check(sql\`\${post.views} >= 0\`, 'positive'), check({ views: { $gte: 0 } })],
  triggers: (post, trigger) => [trigger({ on: 'beforeUpdate', of: [post.body], run: () => sql\`select 1\` })],
})
export class Post {}`);
  });

  it('should write a defined entity as its columns and a chain of sections, relations last', () => {
    const { text, unresolved } = build(`import { defineEntity } from 'uql-orm';
export const Book = defineEntity({
  name: 'Book',
  fields: {
    // the key
    id: { type: Number, isId: true },
    title: { type: String, nullable: false },
    authorId: { type: Number },
  },
  computed: { shout: { type: String, computed: (b) => sql\`upper(\${b.title})\` } },
  relations: (rel) => ({ author: () => rel.manyToOne(Author, { references: (book) => book.authorId }) }),
  aggregates: (rel) => ({ n: () => rel.tags.count() }),
  indexes: [{ columns: (book) => [book.title] }],
  hooks: { beforeInsert: [(book) => {}] },
});`);
    expect(unresolved).toEqual([]);
    expect(text).toBe(`import { f, defineEntity } from 'uql-orm';
export const Book = defineEntity({
  name: 'Book',
  fields: {
    // the key
    id: f.number().id(),
    title: f.string(),
    authorId: f.number().nullable(),
  },
})
  .computed((book) => ({ shout: f.string().nullable().as(sql\`upper(\${book.title})\`) }))
  .indexes((book, index) => [index([book.title])])
  .hooks({ beforeInsert: [(book) => {}] })
  .relations((rel) => ({ author: () => rel.manyToOne(Author, { references: (book) => book.authorId }) }), (rel) => ({ n: () => rel.tags.count() }));`);
  });

  it("should write the relation a defined column's foreign key needs, and move its onDelete there", () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, references: () => Customer, onDelete: 'CASCADE' },
    parent_id: { type: Number, nullable: false, references: () => Order },
  },
});`);
    expect(unresolved).toEqual([]);
    expect(text).toBe(`import { f } from 'uql-orm';
export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: f.number().id(),
    customerId: f.number().nullable(),
    parent_id: f.number(),
  },
})
  .relations((rel) => ({
    customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId, onDelete: 'CASCADE' }),
    parent: () => rel.manyToOne(Order, { references: (order) => order.parent_id }),
  }));`);
  });

  it('should refuse a foreign key whose relation it cannot name, or with no type of its own', () => {
    const input = `export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    owner: { type: Number, references: () => User },
    payerId: { type: Number, references: () => User },
    payer: { type: String },
    editorId: { references: () => User },
  },
});`;
    const { text, unresolved } = build(input);
    expect(text).toBe(input);
    expect(unresolved).toEqual([
      `/entities.ts:5: 'owner' ${FOREIGN_KEY}`,
      `/entities.ts:6: 'payerId' ${FOREIGN_KEY}`,
      `/entities.ts:8: 'editorId' ${NO_KEY_TYPE}`,
    ]);
  });

  it("should drop a defined column's foreign key where its relation already joins on it", () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer },
  },
  relations: (rel) => ({ customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId }) }),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain('customerId: f.number().nullable(),');
    expect(text).not.toContain('references: () => Customer');
    expect(text).toContain('customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId })');
  });

  it("should move a joined column's onDelete into its relation, and refuse one the relation contradicts", () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer, onDelete: 'CASCADE' },
    payerId: { type: Number, references: () => Customer, onDelete: 'SET NULL' },
  },
  relations: (rel) => ({
    customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId }),
    payer: () => rel.manyToOne(Customer, { references: (order) => order.payerId, onDelete: 'SET NULL' }),
  }),
});
export const Line = defineEntity({
  name: 'Line',
  fields: { id: f.number().id(), orderId: f.number().references(() => Order).onDelete('CASCADE') },
  relations: (rel) => ({ order: () => rel.manyToOne(Order, { references: (line) => line.orderId, onDelete: 'NO ACTION' }) }),
});`);
    expect(unresolved).toEqual([`/entities.ts:15: 'orderId' ${ON_DELETE_ON_RELATION}`]);
    expect(text).toContain(
      "customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId, onDelete: 'CASCADE' }),",
    );
    expect(text).toContain(
      "payer: () => rel.manyToOne(Customer, { references: (order) => order.payerId, onDelete: 'SET NULL' }),",
    );
    expect(text).toContain('payerId: f.number().nullable(),');
  });

  it("should drop a builder's foreign key where a relation joins on it", () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: f.number().id(),
    customerId: f.number().nullable().references(() => Customer),
  },
  relations: (rel) => ({
    customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId }),
  }),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain('customerId: f.number().nullable(),');
    expect(text).not.toContain('.references(() => Customer)');
  });

  it('should join on a relation written as a call naming its column, alone or in pairs', () => {
    const { text, unresolved } = build(`export const Block = defineEntity({
  name: 'Block',
  fields: { id: f.number().id(), customerId: f.number().nullable().references(() => Customer) },
  relations: (rel) => ({
    customer: () => { return rel.manyToOne(Customer, { references: (block) => block.customerId }); },
  }),
});
export const Shared = defineEntity({
  name: 'Shared',
  fields: { id: f.number().id(), customerId: f.number().nullable().references(() => Customer) },
  relations: sharedRelations,
});
export const Many = defineEntity({
  name: 'Many',
  fields: { id: f.number().id(), customerId: f.number().nullable().references(() => Customer) },
  relations: (rel) => ({
    customer: () => rel.manyToMany(Customer, { through: () => Link }),
    other: () => rel.manyToOne(Customer, { references: [{ local: 'customerId', foreign: 'id' }] }),
  }),
});
export const Paired = defineEntity({
  name: 'Paired',
  fields: { id: f.number().id(), customerId: f.number().nullable().references(() => Customer) },
  relations: (rel) => ({
    customer: () => rel.manyToOne(Customer, { references: (paired, customer) => [{ local: paired.customerId, foreign: customer.id }] }),
  }),
});`);
    expect(unresolved).toEqual([
      `/entities.ts:3: 'customerId' ${FOREIGN_KEY}`,
      `/entities.ts:10: 'customerId' ${FOREIGN_KEY}`,
      `/entities.ts:15: 'customerId' ${FOREIGN_KEY}`,
    ]);
    expect(text).toContain('fields: { id: f.number().id(), customerId: f.number().nullable() },');
  });

  it('should write the join of a relation that names none, as the ORM infers it, so its column drops its references', () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer },
  },
  relations: (rel) => ({ customer: () => rel.manyToOne(Customer) }),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain('customerId: f.number().nullable(),');
    expect(text).toContain('customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId })');
  });

  it('should refuse a column whose to-one takes options it cannot write a join into', () => {
    const input = `export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer },
  },
  relations: (rel) => ({ customer: () => rel.manyToOne(Customer, sharedOptions) }),
});`;
    const { text, unresolved } = build(input);
    expect(text).toBe(input);
    expect(unresolved).toEqual([`/entities.ts:5: 'customerId' ${FOREIGN_KEY}`]);
  });

  it('should refuse a column no relation joins by whose relation is named already, where the ORM would infer none', () => {
    const { unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer },
    payerId: { type: Number, nullable: true, references: () => Customer },
  },
  relations: (rel) => ({ customer: () => rel.manyToOne(Customer) }),
});`);
    expect(unresolved).toEqual([`/entities.ts:5: 'customerId' ${FOREIGN_KEY}`]);
  });

  it("should move a builder's onDelete into its relation, add the relations it lacks, and refuse a key with no type", () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: f.number().id(),
    parentId: f.number().references(() => Order).onDelete('CASCADE'),
    replyId: f.number().nullable().references(() => Order),
  },
  relations: (rel) => ({
    parent: () => rel.manyToOne(Order, { references: (order) => order.parentId }),
  }),
});
export const Owned = defineEntity({
  name: 'Owned',
  fields: { id: f.number().id(), ownerId: f.references(() => Order) },
  relations: (rel) => ({ owner: () => rel.manyToOne(Order, { references: (owned) => owned.ownerId }) }),
});`);
    expect(unresolved).toEqual([`/entities.ts:14: 'ownerId' ${NO_KEY_TYPE}`]);
    expect(text).toContain(`  .relations((rel) => ({
    parent: () => rel.manyToOne(Order, { references: (order) => order.parentId, onDelete: 'CASCADE' }),
    reply: () => rel.manyToOne(Order, { references: (order) => order.replyId }),
  }));`);
    expect(text).toContain('replyId: f.number().nullable(),');
  });

  it('should leave what it cannot write as it is, and say why', () => {
    const input = `@Entity()
export class User {
  @Field(shared) a?: string;
  @Field({ type: String, frobnicate: true }) b?: string;
  @Field({ type: Number, computed: (u) => { return sql\`1\`; } }) readonly c?: number;
}`;
    const { text, unresolved } = build(input);
    expect(text).toBe(input);
    expect(unresolved).toEqual([
      "/entities.ts:3: cannot write a builder because its options are passed as 'shared'",
      '/entities.ts:4: has options no builder writes: frobnicate',
      '/entities.ts:5: cannot inline a computed callback with a block body',
    ]);
  });

  it('should refuse a shape, which no builder writes, and chain a defined entity with no columns of its own', () => {
    const { text, unresolved } = build(`defineEntity({
  name: 'Anthology',
  extends: Author,
  fields: { title: { type: 'jsonb', shape: { lang: String } } },
});
defineEntity({ name: 'Child', extends: Base, fields: {}, hooks: { beforeInsert: [] } });`);
    expect(unresolved).toEqual(["/entities.ts:4: 'title' has options no builder writes: shape"]);
    expect(text).toContain(`defineEntity({ name: 'Child', extends: Base, fields: {} })
  .hooks({ beforeInsert: [] });`);
  });

  it('should write every option a column states as its method', () => {
    const { text, unresolved } = build(`import { Entity, Field, Id } from 'uql-orm';
@Entity()
export class All {
  @Id() id?: number;
  @Field({ type: Number, nullable: false, onUpdate: Date.now, updatable: true, eager: false, softDelete: () => 1 }) a!: number;
  @Field({ type: Number, nullable: false, unique: false, index: 'by_b', autoIncrement: true, precision: 4, scale: 1 }) b!: number;
  @Field({ type: 'halfvec', dimensions: 3, distance: 'l2' }) c?: number[] | null;
  @Field({ type: String, columnType, name: 'd_col', comment: 'the d', softDelete: true, updatable: false }) d?: string | null;
  @Field({ type: 'text', eager: true, softDelete: false, index: true, unique: true }) e?: string | null;
  @Field({ type: BigInt, version: true }) wide?: bigint;
  @Field({ type: String, columnType: 'decimal', precision: 9, scale: 2 }) exact?: string | null;
  @Field({ type: String, columnType: 'numeric', precision: 9 }) loose?: string | null;
  @Field({ type: Number, references: () => All, onDelete: 'CASCADE' }) parentId?: number | null;
  @Field({ type: 'uuid', nullable: true }) g?: string | null;
}`);
    expect(unresolved).toEqual([]);
    expect(text).toBe(`import { f, Entity, Field } from 'uql-orm';
@Entity()
export class All {
  @Field(f.number().id()) id?: number;
  @Field(f.number().onUpdate(Date.now).eager(false).softDelete(() => 1)) a!: number;
  @Field(f.number().index('by_b').autoIncrement().precision(4).scale(1)) b!: number;
  @Field(f.column('halfvec').nullable().dimensions(3).distance('l2')) c?: number[] | null;
  @Field(f.string().nullable().updatable(false).softDelete().columnType(columnType).name('d_col').comment('the d')) d?: string | null;
  @Field(f.text().nullable().unique().index()) e?: string | null;
  @Field(f.version(BigInt)) wide?: bigint;
  @Field(f.decimal(9, 2).nullable()) exact?: string | null;
  @Field(f.column('numeric').nullable().precision(9)) loose?: string | null;
  @Field(f.number().nullable().references(() => All).onDelete('CASCADE')) parentId?: number | null;
  @Field(f.uuid().nullable()) g?: string | null;
}`);
  });

  it('should report what a column cannot be written as', () => {
    const { unresolved } = build(`@Entity()
export class Wrong {
  @Field({ type: String, version: true }) a?: string;
  @Field({ type: Date, enum: [new Date()] }) b?: Date;
  @Field({ nullable: true }) c?: string;
  @Field({ type: Kind }) d?: string;
  @Field({ type: String, shape: { lang: String } }) e?: string;
  @Field({ type: 'varchar', shape: { lang: String } }) f2?: string;
  @Field({ type: String, frob: true, computed: (w) => sql\`1\` }) g?: string;
  @Field({ ['computed']: 1 }) h?: string;
}`);
    expect(unresolved).toEqual([
      '/entities.ts:3: is a version of type String: use f.version()',
      "/entities.ts:4: has an enum on a 'Date' column: declare it f.enum([...]).columnType(Date)",
      "/entities.ts:5: has no 'type': state it, f.string() and so on",
      "/entities.ts:6: has a type written as 'Kind': write its builder, f.string() and so on",
      '/entities.ts:7: has options no builder writes: shape',
      '/entities.ts:8: has options no builder writes: shape',
      '/entities.ts:9: has options no builder writes: frob',
      '/entities.ts:10: cannot write a builder because its options name one by a computed key',
    ]);
  });

  it("should move a builder already in a defined entity's fields off its foreign key, and refuse one with no type", () => {
    const { text, unresolved } = build(`import { defineEntity, f } from 'uql-orm';
export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: f.number().id(),
    customerId: f.number().nullable().references(() => Customer).onDelete('CASCADE'),
    parentId: f.number().references(() => Order),
  },
});
export const Bare = defineEntity({ name: 'Bare', fields: { id: f.number().id(), ownerId: f.references(() => Order) } });
export const Odd = defineEntity({ name: 'Odd', fields: { id: f.number().id() }, frobnicate: true });
export const Plain = defineEntity({ name: 'Plain', fields: { id: f.number().id() } });`);
    expect(unresolved).toEqual([
      `/entities.ts:10: 'ownerId' ${NO_KEY_TYPE}`,
      '/entities.ts:11: cannot write a chain: it states frobnicate: true',
    ]);
    expect(text).toContain(`  fields: {
    id: f.number().id(),
    customerId: f.number().nullable(),
    parentId: f.number(),
  },
})
  .relations((rel) => ({
    customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId, onDelete: 'CASCADE' }),
    parent: () => rel.manyToOne(Order, { references: (order) => order.parentId }),
  }));`);
    expect(text).toContain(`export const Plain = defineEntity({ name: 'Plain', fields: { id: f.number().id() } });`);
  });

  it("should report a defined field's foreign key with no type, and sections it cannot read", () => {
    const { unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: { id: { type: Number, isId: true }, customerId: { references: () => Customer } },
});
export const Listed = defineEntity({
  name: 'Listed',
  fields: { id: { type: Number, isId: true } },
  indexes: shared,
  computed: { a: { type: String, computed: (l) => { return sql\`1\`; } } },
});
@Entity({ indexes: [{ ...base }], checks: [{ where: sql\`1\`, frob: 1 }] })
export class Spread {}
const Chained = defineEntity({ name, fields: { id: f.number().id() }, indexes: [{ columns: (c) => { return [c.id]; } }] });`);
    expect(unresolved).toEqual([
      `/entities.ts:3: 'customerId' ${NO_KEY_TYPE}`,
      "/entities.ts:8: cannot write 'indexes' as a section: write each entry as index(...) over its refs",
      "/entities.ts:9: cannot write 'computed' as a section: inline each callback",
      "/entities.ts:11: cannot write 'indexes' as a section: write each entry as index(...) over its refs",
      "/entities.ts:11: cannot write 'checks' as a section: write each entry as check(...) over its refs",
      "/entities.ts:13: cannot write 'indexes' as a section: write each entry as index(...) over its refs",
    ]);
  });

  it("should chain a list named off the defined entity's variable, and keep a stored computed column's events", () => {
    const { text } = build(`import { Id } from 'uql-orm';
const Chained = defineEntity({ name, fields: { id: f.number().id() }, checks: [{ where: { id: 1 } }] });
export const Stamped = defineEntity({
  name: 'Stamped',
  fields: { id: { type: Number, isId: true } },
  computed: { at: { type: Date, computed: sql\`now()\`, stored: ['update'] }, b: { type: Number, computed: (s) => sql\`1\`, stored: false } },
});`);
    expect(text).toContain('.checks((chained, check) => [check({ id: 1 })])');
    expect(text).toContain(
      ".computed((stamped) => ({ at: f.date().nullable().as(sql`now()`).stored(['update']), b: f.number().nullable().as(sql`1`) }))",
    );
    expect(text).toMatch(/^import \{ f \} from 'uql-orm';/);
  });

  it('should write the forms each part of a definition takes', () => {
    const { text, unresolved } = build(`import { Entity, Field } from 'uql-orm';
@Entity
@Entity()
export class Forms {
  @Field({ type: Number, isId: true, autoIncrement: false }) id?: number;
  @Field({ type: 'json' }) doc?: unknown;
  @Field({ type: 'vector' }) vec?: number[] | null;
  @Field({ type: String, computed: sql\`'x'\` }) readonly x?: string | null;
  @Field({ type: String, computed: (row) => (sql\`'y'\`) }) readonly y?: string | null;
  @Other() other?: string;
  @Field uncalled?: string;
}
export const Short = defineEntity({ name, fields: { id: { type: Number, isId: true } }, aggregates: (agg) => ({}) });
defineEntity({ name: 'Free', fields: { id: { type: Number, isId: true } }, indexes: [{ columns: (e) => [e.id] }], relations: (rel) => ({}) });`);
    expect(unresolved).toEqual([]);
    expect(text).toContain('@Field(f.number().id().autoIncrement(false)) id?: number;');
    expect(text).toContain('@Field(f.json().nullable()) doc?: unknown;');
    expect(text).toContain("@Field(f.column('vector').nullable()) vec?: number[] | null;");
    expect(text).toContain("@Computed((row) => f.string().nullable().as(sql`'x'`)) readonly x?: string | null;");
    expect(text).toContain("@Computed((row) => f.string().nullable().as(sql`'y'`)) readonly y?: string | null;");
    expect(text).toContain('@Field uncalled?: string;');
    expect(text).toContain(`export const Short = defineEntity({ name, fields: { id: f.number().id() } })
  .relations(() => ({}), (agg) => ({}));`);
    expect(text).toContain(`defineEntity({ name: 'Free', fields: { id: f.number().id() } })
  .indexes((free, index) => [index([free.id])])
  .relations((rel) => ({}));`);
  });

  it('should report what a defined entity or a section it cannot read states', () => {
    const { unresolved } = build(`defineEntity(Shared);
defineEntity({ ...base, fields: { id: { type: Number, isId: true } } });
defineEntity({ name: 'S', fields: { id, ...more } });
defineEntity({ name: 'C', fields: { id: { type: Number, isId: true } }, computed: { a: shared } });
defineEntity({ name: 'D', fields: { id: shared }, computed: { b } });
@Entity({ indexes: shared, checks, triggers: [{ on: 'beforeUpdate', of: (t) => { return [t.a]; } }] })
export class T {}
@Entity({ indexes: [{ columns: (t) => [t.a], include: (t) => { return [t.b]; } }] })
export class U {}`);
    expect(unresolved).toEqual([
      '/entities.ts:2: cannot write a chain: it states ...base',
      "/entities.ts:3: cannot write 'id' as a column: write its options inline",
      "/entities.ts:3: cannot write '...more' as a column: write its options inline",
      "/entities.ts:4: cannot write 'computed' as a section: inline each callback",
      "/entities.ts:5: 'id' cannot be written as a builder because its options are passed as 'shared'",
      "/entities.ts:5: cannot write 'computed' as a section: inline each callback",
      "/entities.ts:6: cannot write 'indexes' as a section: write each entry as index(...) over its refs",
      "/entities.ts:6: cannot write 'checks' as a section: write each entry as check(...) over its refs",
      "/entities.ts:6: cannot write 'triggers' as a section: write each entry as trigger(...) over its refs",
      "/entities.ts:8: cannot write 'indexes' as a section: write each entry as index(...) over its refs",
    ]);
  });

  it('should keep an import a bare `@Field` still spells, and drop the `@Id` it replaced', () => {
    const text = `import { Field, Id } from 'uql-orm';\nexport class A {\n  @Id() id?: number;\n  @Field bare?: string;\n}`;
    expect(build(text).text).toContain("import { f, Field } from 'uql-orm';");
  });

  it('should keep a name it imports from uql-orm, and leave a file with nothing to write alone', () => {
    const entity = `@Entity()\nexport class A {\n  @Field({ type: Number, isId: true }) id?: number;\n}`;
    expect(build(`import { f, Field } from 'uql-orm';\n${entity}`).text).toContain('@Field(f.number().id())');
    const sectioned = `@Entity({ indexes: (a, index) => [index([a.id])] })\nexport class A {}`;
    expect(build(sectioned)).toEqual({ text: sectioned, unresolved: [] });
    expect(build('const x = 1;')).toEqual({ text: 'const x = 1;', unresolved: [] });
  });

  it('should leave a file already on builders alone', () => {
    const input = `@Entity()\nexport class User {\n  @Field(f.number().id()) id?: number;\n}`;
    expect(build(input)).toEqual({ text: input, unresolved: [] });
  });

  it.each([
    ['unique', '@Field({ type: String, unique: isUnique }) code?: string;', 'unique: isUnique'],
    ['updatable', '@Field({ type: String, updatable: canWrite }) code?: string;', 'updatable: canWrite'],
    ['nullable', '@Field({ type: String, nullable: isNull }) code?: string;', 'nullable: isNull'],
  ])('should refuse a %s whose value no literal states, rather than dropping it', (_, field, option) => {
    const { text, unresolved } = build(`import { Entity, Field } from 'uql-orm';
@Entity()
export class User {
  ${field}
}`);
    expect(text).toContain(field);
    expect(unresolved).toEqual([expect.stringContaining(option)]);
  });

  it('should keep a variable autoIncrement as the argument it is', () => {
    const { text, unresolved } = build(`import { Entity, Field } from 'uql-orm';
@Entity()
export class User {
  @Field({ type: Number, autoIncrement: auto }) n?: number;
}`);
    expect(unresolved).toEqual([]);
    expect(text).toContain('f.number().nullable().autoIncrement(auto)');
  });
});

describe('foreign keys moved into their relations', () => {
  it('should refuse a foreign key whose target is no arrow, or a name it cannot read off the column', () => {
    const input = `export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: shared },
    'owner-ref': { type: Number, nullable: true, references: () => User },
    payer: f.number().references(shared),
  },
});`;
    const { text, unresolved } = build(input);
    expect(text).toBe(input);
    expect(unresolved).toEqual([
      `/entities.ts:5: 'customerId' ${FOREIGN_KEY}`,
      `/entities.ts:6: 'owner-ref' ${FOREIGN_KEY}`,
      `/entities.ts:7: 'payer' ${FOREIGN_KEY}`,
    ]);
  });

  it('should write a column onDelete into an inferred join, which takes no options of its own', () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer, onDelete: 'CASCADE' },
  },
  relations: (rel) => ({ customer: () => rel.manyToOne(Customer) }),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain(
      ".relations((rel) => ({ customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId, onDelete: 'CASCADE' }) }));",
    );
  });

  it('should keep the relations it does not touch, a relation not written as a call among them', () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer, onDelete: 'CASCADE' },
  },
  relations: (rel) => ({ customer: () => rel.manyToOne(Customer), loose: sharedRelation }),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain('loose: sharedRelation');
    expect(text).toContain(
      "customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId, onDelete: 'CASCADE' }),",
    );
  });

  it('should move a column onDelete into the first relation joining on it, and leave a second one as written', () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: f.number().id(),
    customerId: f.number().nullable().references(() => Customer).onDelete('CASCADE'),
  },
  relations: (rel) => ({
    customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId }),
    buyer: () => rel.manyToOne(Customer, { references: (order) => order.customerId }),
  }),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain(
      "customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId, onDelete: 'CASCADE' }),",
    );
    expect(text).toContain('buyer: () => rel.manyToOne(Customer, { references: (order) => order.customerId }),');
  });

  it('should refuse a column its relations join on by pairs naming no local column of the entity', () => {
    const input = `export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer },
  },
  relations: (rel) => ({
    customer: () => rel.manyToOne(Customer, { references: (order) => [{ foreign: 'id' }] }),
    buyer: () => rel.manyToOne(Customer, { references: (order) => [{ local: other.customerId, foreign: 'id' }] }),
  }),
});`;
    const { text, unresolved } = build(input);
    expect(text).toBe(input);
    expect(unresolved).toEqual([`/entities.ts:5: 'customerId' ${FOREIGN_KEY}`]);
  });

  it('should write a relation options literal left empty as the options a join needs', () => {
    const { text, unresolved } = build(`export const Order = defineEntity({
  name: 'Order',
  fields: {
    id: { type: Number, isId: true },
    customerId: { type: Number, nullable: true, references: () => Customer },
  },
  relations: (rel) => ({ customer: () => rel.manyToOne(Customer, {}) }),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain(
      '.relations((rel) => ({ customer: () => rel.manyToOne(Customer, { references: (order) => order.customerId }) }));',
    );
  });

  it('should add the relation a foreign key needs to a defined entity whose relations are empty', () => {
    const { text, unresolved } = build(`export const Line = defineEntity({
  name: 'Line',
  fields: { id: { type: Number, isId: true }, ownerId: { type: Number, references: () => Order } },
  relations: (rel) => ({}),
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain(
      '.relations((rel) => ({ owner: () => rel.manyToOne(Order, { references: (line) => line.ownerId }) }));',
    );
  });

  it('should add the relation a foreign key needs to a defined entity with no relations, laid out as its fields are', () => {
    const { text, unresolved } =
      build(`export const Line = defineEntity({ name: 'Line', fields: { id: { type: Number, isId: true }, ownerId: { type: Number, references: () => Order } } });
export const Tab = defineEntity({
  name: 'Tab',
  fields: {
    id: { type: Number, isId: true },
    ownerId: { type: Number, references: () => Order },
  },
});`);
    expect(unresolved).toEqual([]);
    expect(text).toContain(
      '.relations((rel) => ({ owner: () => rel.manyToOne(Order, { references: (line) => line.ownerId }) }));',
    );
    expect(text).toContain(
      '  .relations((rel) => ({\n    owner: () => rel.manyToOne(Order, { references: (tab) => tab.ownerId }),\n  }));',
    );
  });
});
