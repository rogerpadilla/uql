import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { transformFile } from './transform.js';

const FILE_NAME = '/entities.ts';

/**
 * Runs the codemod over one whole in-memory file, for the cases about imports and file-level text.
 *
 * A real `ts.Program` rather than a bare parse, because every transform here depends on the checker: the
 * whole job is writing down the types `design:type` used to report at runtime. The default lib is read
 * from disk rather than stubbed, since `Company[]` only resolves its element type when `Array` has a
 * declaration, and unwrapping arrays is exactly what the to-many relation transform depends on.
 */
function codemodFile(text: string) {
  const readFile = (name: string) => (name === FILE_NAME ? text : ts.sys.readFile(name));
  const host: ts.CompilerHost = {
    getSourceFile: (name, lang) => {
      const source = readFile(name);
      return source === undefined ? undefined : ts.createSourceFile(name, source, lang, true);
    },
    writeFile: () => {},
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (name) => readFile(name) !== undefined,
    readFile,
  };
  const program = ts.createProgram([FILE_NAME], { target: ts.ScriptTarget.ESNext, lib: ['lib.esnext.d.ts'] }, host);
  return transformFile(program.getSourceFile(FILE_NAME)!, program.getTypeChecker());
}

/** What a snippet is compiled against, so the checker resolves the decorators and the `Relation` alias. */
const STUBS = `
  type EntityGetter = () => unknown;
  type FieldOptions = { type?: unknown; references?: EntityGetter; name?: string; length?: number };
  declare function Field(opts?: FieldOptions): PropertyDecorator;
  declare function Id(opts?: FieldOptions): PropertyDecorator;
  declare const idKey: unique symbol;
  declare function InjectQuerier(): ParameterDecorator;
  declare function Log(): MethodDecorator;
  declare function Serialized(): PropertyDecorator;
  declare function Transactional(): MethodDecorator;
  declare class Querier {}
  declare function ManyToOne(opts?: { entity?: EntityGetter; references?: unknown }): PropertyDecorator;
  declare function OneToMany(opts?: { entity?: EntityGetter; mappedBy?: unknown }): PropertyDecorator;
  declare function Index(columns: unknown, options?: unknown): ClassDecorator;
  declare function defineEntity(entity: unknown, options: unknown): void;
  declare function defineIndex(entity: unknown, options: unknown): void;
  declare function defineRelation(entity: unknown, key: string, options: unknown): void;
  declare function raw(strings: TemplateStringsArray): unknown;
  type Relation<T> = T;
`;

/** Runs the codemod over a snippet compiled against {@link STUBS}, for the per-property cases. */
const codemod = (snippet: string) => codemodFile(`${STUBS}${snippet}`);

describe('codemod transforms', () => {
  it('writes the type reflection used to supply, for every scalar shape', () => {
    const { text, changed } = codemod(`
      class Entity {
        @Id() id?: number;
        @Field() name?: string;
        @Field() count?: bigint;
        @Field() active?: boolean;
        @Field() at?: Date;
        @Field() avatar?: Uint8Array;
      }
    `);

    expect(changed).toBe(true);
    expect(text).toContain('@Id({ type: Number }) id?: number;');
    expect(text).toContain('@Field({ type: String }) name?: string;');
    expect(text).toContain('@Field({ type: BigInt }) count?: bigint;');
    expect(text).toContain('@Field({ type: Boolean }) active?: boolean;');
    expect(text).toContain('@Field({ type: Date }) at?: Date;');
    expect(text).toContain("@Field({ type: 'blob' }) avatar?: Uint8Array;");
  });

  it('keeps existing options and puts the type first', () => {
    const { text } = codemod(`
      class Entity {
        @Field({ name: 'image', length: 150 }) picture?: string;
      }
    `);

    expect(text).toContain("@Field({ type: String, name: 'image', length: 150 }) picture?: string;");
  });

  it('names an unconventional key with the idKey brand', () => {
    const { text } = codemod(`
      class Entity {
        @Id({ type: String }) code?: string;
        @Field({ type: String }) title?: string;
      }
    `);

    expect(text).toContain("[idKey]?: 'code';");
  });

  it('names both columns of a composite key', () => {
    const { text } = codemod(`
      class Entity {
        @Id({ type: Number }) studentId?: number;
        @Id({ type: String }) courseId?: string;
      }
    `);

    expect(text).toContain("[idKey]?: 'studentId' | 'courseId';");
  });

  it('leaves a conventional key alone', () => {
    const { text } = codemod(`
      class Entity {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string;
      }
    `);

    expect(text).not.toContain('[idKey]');
  });

  it('leaves a key that is already branded alone', () => {
    const { text } = codemod(`
      class Entity {
        [idKey]?: 'pk';
        @Id({ type: Number }) pk?: number;
      }
    `);

    expect(text.match(/\[idKey\]/g)).toHaveLength(1);
  });

  it('reports a key written as a computed name rather than guess its brand', () => {
    const { text, unresolved } = codemod(`
      const code = 'code';
      class Entity {
        @Id({ type: String }) [code]?: string;
      }
    `);

    expect(text).not.toContain('[idKey]');
    expect(unresolved).toContainEqual(
      expect.stringContaining("a key written as a computed name; add the 'idKey' brand by hand"),
    );
  });

  it('writes the brand without importing idKey a second time', () => {
    const { text } = codemodFile(`import { Id, idKey } from 'uql-orm';

class Entity {
  @Id({ type: String }) code?: string;
}
`);

    expect(text).toContain("[idKey]?: 'code';");
    expect(text).toContain("import { Id, idKey } from 'uql-orm';");
  });

  it('imports idKey into the uql-orm import it finds', () => {
    const { text } = codemodFile(`import { Id } from 'uql-orm';

class Entity {
  @Id({ type: String }) code?: string;
}
`);

    expect(text).toContain("import { idKey, Id } from 'uql-orm';");
  });

  /** A namespace import has no list to add a name to, so the import is left to the author. */
  it('reports the idKey import it cannot add beside a namespace import', () => {
    const { unresolved } = codemodFile(`import * as uql from 'uql-orm';
declare function Id(opts?: object): PropertyDecorator;

class Entity {
  @Id({ type: String }) code?: string;
}
`);

    expect(unresolved).toContain("/entities.ts: import 'idKey' from 'uql-orm' for the brand(s) written here");
  });

  /** Options it cannot read may still hold `virtual`, so the rename is reported rather than silently skipped. */
  it('reports a virtual option it cannot reach inside options it cannot read', () => {
    const { unresolved } = codemod(`
      declare const options: { virtual: FieldOptions };
      class Entity {
        @Field(options.virtual) total?: number;
      }
    `);

    expect(unresolved).toContainEqual(
      expect.stringMatching(/^\/entities\.ts:\d+: its options are passed as 'options\.virtual'$/),
    );
  });

  it('leaves a decorator it cannot name alone', () => {
    const { text, changed } = codemod(`
      const decorators = { Field };
      class Entity {
        @decorators.Field() title?: string;
      }
    `);

    expect(changed).toBe(false);
    expect(text).toContain('@decorators.Field() title?: string;');
  });

  it('removes a statement from the last line of a file that has no line after it', () => {
    const { text } = codemodFile(`class Item {}\nimport 'reflect-metadata';`);

    expect(text).toBe('class Item {}\n');
  });

  it('renames the virtual option to computed, leaving its expression alone', () => {
    const { text } = codemod(`
      class Entity {
        @Field({ type: Number, virtual: raw\`1 + 1\` }) score?: number;
      }
    `);

    expect(text).toContain('@Field({ type: Number, computed: raw`1 + 1` }) score?: number;');
  });

  /** A shorthand has no value to keep, so the key alone would rebind it to a local that is not there. */
  it('renames a shorthand virtual, keeping what it referred to', () => {
    const { text, unresolved } = codemod(`
      const virtual = raw\`1 + 1\`;
      class Entity {
        @Field({ type: Number, virtual }) score?: number;
      }
    `);

    expect(text).toContain('@Field({ type: Number, computed: virtual }) score?: number;');
    expect(unresolved).toEqual([]);
  });

  it('renames a quoted virtual key', () => {
    const { text, unresolved } = codemod(`
      class Entity {
        @Field({ type: Number, 'virtual': raw\`1\` }) score?: number;
      }
    `);

    expect(text).toContain('@Field({ type: Number, computed: raw`1` }) score?: number;');
    expect(unresolved).toEqual([]);
  });

  /** The same lookup decides whether an option is already stated, so a quoted one is not doubled. */
  it('leaves a quoted type alone rather than inserting a second one', () => {
    const { text } = codemod(`
      class Entity {
        @Field({ 'type': String }) name?: string;
      }
    `);

    expect(text).toContain("@Field({ 'type': String }) name?: string;");
  });

  it('reports a field giving both names rather than choosing one', () => {
    const { unresolved } = codemod(`
      class Entity {
        @Field({ type: Number, virtual: raw\`1\`, computed: raw\`2\` }) score?: number;
      }
    `);

    expect(unresolved.join('\n')).toContain("gives both 'virtual' and 'computed'");
  });

  /** An empty literal has no first property to insert before, so the whole object is rewritten instead. */
  it('fills in an empty options object', () => {
    const { text } = codemod(`
      class Entity {
        @Field({}) name?: string;
      }
    `);

    expect(text).toContain('@Field({ type: String }) name?: string;');
  });

  it('treats a string-literal union as a string column', () => {
    const { text } = codemod(`
      type Role = 'admin' | 'member';
      class Entity {
        @Field() role?: Role;
      }
    `);

    expect(text).toContain('@Field({ type: String }) role?: Role;');
  });

  it('leaves a nullable field alone once the null arm is dropped', () => {
    const { text } = codemod(`
      class Entity {
        @Field() nickname?: string | null;
      }
    `);

    expect(text).toContain('@Field({ type: String }) nickname?: string | null;');
  });

  /** Arms that disagree have no single column type, and reflection reported the useless `Object` for them. */
  it('reports a union whose arms disagree', () => {
    const { changed, unresolved } = codemod(`
      class Entity {
        @Field() mixed?: string | number;
      }
    `);

    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("cannot infer 'type'");
  });

  /**
   * Found by running this against a real project: branded id types are template literals, not plain
   * string aliases, and were reported as unresolvable until the checker flags included them.
   *
   * `String` is the answer rather than `'uuid'` because reflection erased these to `String` at runtime,
   * so that is the column the existing database already has; emitting `'uuid'` would silently change
   * the schema (`{ category: 'string' }` becomes `{ category: 'uuid' }`). It is usually not what the
   * author wanted, though, so the rewrite is reported for review instead of being decided quietly.
   */
  it('treats a branded template-literal id type as a string column, and says so', () => {
    const { text, notes } = codemod(`
      type UUID = \`\${string}-\${string}-\${string}-\${string}-\${string}\`;
      class Entity {
        @Id() id?: UUID;
        @Field() ref?: Uppercase<'abc'>;
      }
    `);

    expect(text).toContain('@Id({ type: String }) id?: UUID;');
    // `Uppercase<'abc'>` is evaluated eagerly to the literal `'ABC'`, so it resolves like any other
    // string literal and needs no note; only the genuinely unresolved template literal gets one.
    expect(text).toContain("@Field({ type: String }) ref?: Uppercase<'abc'>;");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("If the column should be 'uuid'");
  });

  it('treats a union of branded template literals as a string column', () => {
    const { text } = codemod(`
      class Entity {
        @Id() id?: \`user_\${string}\` | \`team_\${string}\`;
      }
    `);

    expect(text).toContain('@Id({ type: String }) id?: `user_${string}` | `team_${string}`;');
  });

  it('says nothing about a plain string field', () => {
    const { notes } = codemod(`
      class Entity {
        @Field() name?: string;
      }
    `);

    expect(notes).toHaveLength(0);
  });

  it('does not touch a field that already declares a type', () => {
    const { text, changed } = codemod(`
      class Entity {
        @Field({ type: 'uuid' }) id?: string;
      }
    `);

    expect(changed).toBe(false);
    expect(text).toContain("@Field({ type: 'uuid' }) id?: string;");
  });

  it('leaves a reference field without a type, so the column resolves from the referenced key', () => {
    const { text, changed } = codemod(`
      class Company { id?: number; }
      class Entity {
        @Field({ references: () => Company }) companyId?: number;
      }
    `);

    expect(changed).toBe(false);
    expect(text).toContain('@Field({ references: () => Company }) companyId?: number;');
  });

  it('adds the entity getter relations can no longer infer, for one and for many', () => {
    const { text } = codemod(`
      class Company { id?: number; }
      class Entity {
        @ManyToOne() company?: Company;
        @OneToMany({ mappedBy: 'entity' }) peers?: Company[];
      }
    `);

    expect(text).toContain('@ManyToOne({ entity: () => Company }) company?: Company;');
    expect(text).toContain(
      '@OneToMany({ entity: () => Company, mappedBy: (company) => company.entity }) peers?: Company[];',
    );
  });

  it('rewrites a string mappedBy into the callback named after the target, leaving a callback alone', () => {
    const { text } = codemod(`
      class Company { id?: number; owner?: Entity; 'owner-ref'?: Entity; dueño?: Entity; }
      class Entity {
        @OneToMany({ entity: () => Company, mappedBy: 'owner' }) owned?: Company[];
        @OneToMany({ entity: () => Company, mappedBy: 'owner-ref' }) quoted?: Company[];
        @OneToMany({ entity: () => Company, mappedBy: 'dueño' }) unicode?: Company[];
        @OneToMany({ entity: () => Company, mappedBy: (c) => c.owner }) kept?: Company[];
      }
    `);

    expect(text).toContain(
      '@OneToMany({ entity: () => Company, mappedBy: (company) => company.owner }) owned?: Company[];',
    );
    expect(text).toContain(
      "@OneToMany({ entity: () => Company, mappedBy: (company) => company['owner-ref'] }) quoted?: Company[];",
    );
    expect(text).toContain(
      '@OneToMany({ entity: () => Company, mappedBy: (company) => company.dueño }) unicode?: Company[];',
    );
    expect(text).toContain('@OneToMany({ entity: () => Company, mappedBy: (c) => c.owner }) kept?: Company[];');
  });

  it('reports a mappedBy it cannot read', () => {
    const { text, unresolved } = codemod(`
      const key = 'owner';
      class Company { id?: number; owner?: Entity; }
      class Entity {
        @OneToMany({ entity: () => Company, mappedBy: key }) owned?: Company[];
      }
    `);

    expect(text).toContain('mappedBy: key');
    expect(unresolved).toContainEqual(expect.stringContaining("write 'mappedBy' as a key-map callback"));
  });

  it('rewrites @Index columns and include into key-map callbacks named after the class', () => {
    const { text, unresolved } = codemod(`
      declare const columns: string[];
      @Index(['title', { column: 'createdAt', order: 'desc' }, raw\`lower("title")\`], { include: ['slug'], unique: true })
      @Index(['first-name'])
      @Index((post) => [post.title])
      @Index(columns)
      class Post { id?: number; title?: string; createdAt?: Date; slug?: string; 'first-name'?: string; }
    `);

    expect(text).toContain(
      '@Index((post) => [post.title, { column: post.createdAt, order: \'desc\' }, raw`lower("title")`], { include: (post) => [post.slug], unique: true })',
    );
    expect(text).toContain("@Index((post) => [post['first-name']])");
    expect(text).toContain('@Index((post) => [post.title])');
    expect(text).toContain('@Index(columns)');
    expect(unresolved).toContainEqual(expect.stringContaining("write '@Index' columns as a key-map callback"));
  });

  it('rewrites references into a callback over both key maps, and a self-relation into (local, foreign)', () => {
    const { text } = codemod(`
      class Customer { id?: number; code?: string; }
      class Order {
        customerCode?: string;
        parentId?: number;
        @ManyToOne({ entity: () => Customer, references: [{ local: 'customerCode', foreign: 'code' }] }) customer?: Customer;
        @ManyToOne({ entity: () => Order, references: [{ local: 'parentId', foreign: 'id' }] }) parent?: Order;
      }
    `);

    expect(text).toContain(
      'references: (order, customer) => [{ local: order.customerCode, foreign: customer.code }] }) customer?: Customer;',
    );
    expect(text).toContain(
      'references: (local, foreign) => [{ local: local.parentId, foreign: foreign.id }] }) parent?: Order;',
    );
  });

  it("rewrites defineEntity's indexes, hooks and relations into key-map callbacks", () => {
    const { text } = codemod(`
      class Tag { id?: number; posts?: Post[]; }
      class Post { id?: number; title?: string; tagId?: number; tags?: Tag[]; tag?: Tag; touch(): void {} }
      defineEntity(Post, {
        indexes: [{ columns: ['title'], include: ['tagId'], unique: true }],
        hooks: { beforeInsert: ['touch'] },
        relations: {
          tags: { cardinality: 'mm', entity: () => Tag, mappedBy: 'posts' },
          tag: { cardinality: 'm1', entity: () => Tag, references: [{ local: 'tagId', foreign: 'id' }] },
        },
      });
    `);

    expect(text).toContain(
      'indexes: [{ columns: (post) => [post.title], include: (post) => [post.tagId], unique: true }]',
    );
    expect(text).toContain('hooks: { beforeInsert: (post) => [post.touch] }');
    expect(text).toContain("tags: { cardinality: 'mm', entity: () => Tag, mappedBy: (tag) => tag.posts }");
    expect(text).toContain(
      "tag: { cardinality: 'm1', entity: () => Tag, references: (post, tag) => [{ local: post.tagId, foreign: tag.id }] }",
    );
  });

  it('keeps the formatting of a column list it rewrites', () => {
    const { text } = codemod(`
      @Index([
        'title', // the lookup
        { column: 'slug',   order: 'desc' },
      ])
      class Post { id?: number; title?: string; slug?: string; }
    `);

    expect(text).toContain(`@Index((post) => [
        post.title, // the lookup
        { column: post.slug,   order: 'desc' },
      ])`);
  });

  it('rewrites the incremental defineIndex and defineRelation the same way', () => {
    const { text } = codemod(`
      class Tag { id?: number; }
      class Post { id?: number; title?: string; tagId?: number; tag?: Tag; }
      defineIndex(Post, { columns: ['title'], unique: true });
      defineRelation(Post, 'tag', { cardinality: 'm1', entity: () => Tag, references: [{ local: 'tagId', foreign: 'id' }] });
    `);

    expect(text).toContain('defineIndex(Post, { columns: (post) => [post.title], unique: true });');
    expect(text).toContain(
      "defineRelation(Post, 'tag', { cardinality: 'm1', entity: () => Tag, references: (post, tag) => [{ local: post.tagId, foreign: tag.id }] });",
    );
  });

  it("rewrites @Entity's indexes, hooks and relations like defineEntity's", () => {
    const { text } = codemod(`
      declare function Entity(options?: unknown): ClassDecorator;
      class Tag { id?: number; }
      @Entity({
        indexes: [{ columns: ['title'], unique: true }],
        hooks: { beforeInsert: ['touch'] },
        relations: { tag: { cardinality: 'm1', entity: () => Tag, references: [{ local: 'tagId', foreign: 'id' }] } },
      })
      class Post { id?: number; title?: string; tagId?: number; tag?: Tag; touch(): void {} }
    `);

    expect(text).toContain('indexes: [{ columns: (post) => [post.title], unique: true }],');
    expect(text).toContain('hooks: { beforeInsert: (post) => [post.touch] },');
    expect(text).toContain('references: (post, tag) => [{ local: post.tagId, foreign: tag.id }] } },');
  });

  it("rewrites an aggregate's $agg into $select, naming each field as a key", () => {
    const { text, unresolved } = codemod(`
      declare const querier: { aggregate(entity: unknown, q: unknown): void };
      class Order { id?: number; amount?: number; 'unit-price'?: number; größe?: number; status?: string; }
      querier.aggregate(Order, {
        $group: { status: true },
        $agg: { n: { $count: '*' }, total: { $sum: 'amount' }, top: { $max: 'unit-price' }, big: { $max: 'größe' }, ids: { $countDistinct: 'id' } },
      });
    `);

    expect(text).toContain(
      "$select: { n: { $count: '*' }, total: { $sum: { amount: true } }, top: { $max: { 'unit-price': true } }, big: { $max: { größe: true } }, ids: { $countDistinct: { id: true } } },",
    );
    expect(unresolved).toEqual([]);
  });

  it('reports an $agg entry it cannot read, and an $agg beside a $select', () => {
    const { text, unresolved } = codemod(`
      declare const querier: { aggregate(entity: unknown, q: unknown): void };
      declare const field: 'amount';
      class Order { id?: number; amount?: number; }
      querier.aggregate(Order, { $agg: { total: { $sum: field } } });
      querier.aggregate(Order, { $select: { n: { $count: '*' } }, $agg: { total: { $sum: 'amount' } } });
    `);

    expect(text).toContain('$select: { total: { $sum: field } }');
    expect(text).toContain("$select: { n: { $count: '*' } }, $agg: { total: { $sum: 'amount' } }");
    expect(unresolved).toContainEqual(expect.stringContaining("write '$sum' as { field: true }"));
    expect(unresolved).toContainEqual(expect.stringContaining("merge '$agg' into the '$select' beside it"));
  });

  it("rewrites $text's $fields into a key map, reporting a list it cannot read", () => {
    const { text, unresolved } = codemod(`
      declare const querier: { findMany(entity: unknown, q: unknown): void };
      declare const fields: string[];
      class Post { id?: number; title?: string; 'sub-title'?: string; }
      querier.findMany(Post, { $where: { $text: { $value: 'noir', $fields: ['title', 'sub-title'] } } });
      querier.findMany(Post, { $where: { $text: { $value: 'noir', $fields: fields } } });
      const unrelated = { $fields: ['title'] };
    `);

    expect(text).toContain("$text: { $value: 'noir', $fields: { title: true, 'sub-title': true } }");
    expect(text).toContain('$fields: fields');
    expect(text).toContain("const unrelated = { $fields: ['title'] };");
    expect(unresolved).toContainEqual(expect.stringContaining("write '$fields' as { field: true }"));
  });

  it('unwraps the Relation alias and resolves the entity through it', () => {
    const { text } = codemod(`
      class Company { id?: number; }
      class Entity {
        @ManyToOne() company?: Relation<Company>;
      }
    `);

    expect(text).toContain('@ManyToOne({ entity: () => Company }) company?: Company;');
    expect(text).not.toContain('company?: Relation<');
  });

  it('drops declare from a decorated field, which the standard spec cannot decorate', () => {
    const { text } = codemod(`
      class Company { id?: number; }
      class Entity {
        @ManyToOne({ entity: () => Company }) declare company?: Company;
      }
    `);

    expect(text).toContain('@ManyToOne({ entity: () => Company }) company?: Company;');
    expect(text).not.toContain('declare company');
  });

  /**
   * `@Field(shared)` used to become `@Field({ type: String })`, dropping whatever `shared` held. The
   * codemod cannot read an options object it does not own, so it reports the property instead.
   */
  it('refuses to rewrite options it cannot read, rather than replacing them', () => {
    const { text, changed, unresolved } = codemod(`
      const shared: FieldOptions = { name: 'renamed' };
      class Entity {
        @Field(shared) title?: string;
      }
    `);

    expect(text).toContain('@Field(shared) title?: string;');
    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("cannot add 'type' because its options are passed as 'shared'");
  });

  /** There is no argument list to write into, and it used to be read as an empty one and crash. */
  it('refuses to rewrite a decorator that is never called', () => {
    const { text, changed, unresolved } = codemod(`
      class Entity {
        @Field title?: string;
      }
    `);

    expect(text).toContain('@Field title?: string;');
    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("cannot add 'type' because it is used without being called");
  });

  /** A spread may already carry the option, and would override an insertion placed before it. */
  it('refuses to rewrite an options object that spreads another', () => {
    const { text, unresolved } = codemod(`
      const base = { name: 'renamed' };
      class Entity {
        @Field({ ...base }) title?: string;
      }
    `);

    expect(text).toContain('@Field({ ...base }) title?: string;');
    expect(unresolved[0]).toContain("cannot add 'type' because its options object spreads another");
  });

  /** The polyfill only ever fed `design:type`, and nothing else in the file needs rewriting. */
  it('drops the reflect-metadata polyfill and leaves the rest of the imports alone', () => {
    const { text } = codemodFile(`import 'reflect-metadata';
import { Transactional, InjectQuerier, type Querier } from 'uql-orm';

class Service {
  @Transactional()
  async save(@InjectQuerier() querier?: Querier) {
    await querier!.insertOne({}, {});
  }
}
`);

    expect(text).not.toContain('reflect-metadata');
    expect(text).toContain("import { Transactional, InjectQuerier, type Querier } from 'uql-orm';");
    // Nothing blank left where the polyfill import was.
    expect(text.startsWith('import {')).toBe(true);
  });

  /** Its only name went, so the statement goes with it rather than being left as `import {} from`. */
  it('removes an import that loses every name it had', () => {
    const { text } = codemodFile(`import { type Relation } from 'uql-orm';
import { ManyToOne } from 'uql-orm';

class Item {
  @ManyToOne({ entity: () => Item }) parent?: Relation<Item>;
}
`);

    expect(text).not.toContain('Relation');
    expect(text).toContain("import { ManyToOne } from 'uql-orm';");
  });

  it('drops the Relation import once every usage is unwrapped', () => {
    const { text } = codemodFile(`import { Field, ManyToOne, type Relation } from 'uql-orm';

class Item {
  @ManyToOne({ entity: () => Item }) parent?: Relation<Item>;
}
`);

    expect(text).toContain('parent?: Item;');
    expect(text).not.toContain('Relation');
  });

  /** One left where the codemod does not reach, and the import has to stay for the file to resolve. */
  it('keeps the Relation import when a usage is left unrewritten, and every unrelated one', () => {
    const { text, changed, unresolved } = codemodFile(`import base from './base.js';
import * as all from './all.js';
import { type Relation } from 'uql-orm';

type ParentOf<T> = Relation<T>;
`);

    expect(changed).toBe(false);
    expect(text).toContain("import base from './base.js';");
    expect(text).toContain("import * as all from './all.js';");
    expect(text).toContain("import { type Relation } from 'uql-orm';");
    expect(unresolved[0]).toContain("1 'Relation<T>' reference(s)");
  });

  it('reports an export that no longer exists rather than rewriting the call', () => {
    const { text, changed, unresolved } = codemod(`
      import { setQuerierPool, getQuerier } from 'uql-orm';
      setQuerierPool(pool);
    `);

    expect(changed).toBe(false);
    expect(text).toContain('setQuerierPool(pool)');
    expect(unresolved[0]).toContain("'setQuerierPool' was removed; pass the pool where it is used");
    expect(unresolved[1]).toContain("'getQuerier' was removed; use `pool.withQuerier(...)`");
  });

  /** A `$where` is one map now; the compiler points at every call site still passing an id or a list. */
  it('reports the `$where` types and helpers that no longer exist', () => {
    const { changed, unresolved } = codemod(`
      import { QueryWhereFieldMap, augmentWhere, buildQueryWhereAsMap } from 'uql-orm';
    `);

    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("'QueryWhereFieldMap' was removed; use `QueryWhere`");
    expect(unresolved[1]).toContain("'augmentWhere' was removed; spread the two maps");
    expect(unresolved[2]).toContain("'buildQueryWhereAsMap' was removed; a `$where` is a map already");
  });

  it('renames a renamed export, its import and every use of it', () => {
    const { text, unresolved } = codemodFile(`import { QueryWhereMap, type RelationKeyMap as Keys } from 'uql-orm';
const where: QueryWhereMap<User> = {};
function other(QueryWhereMap: number) { return QueryWhereMap; }
type K = Keys<User>;
`);

    expect(text).toBe(`import { QueryWhere, type KeyMap as Keys } from 'uql-orm';
const where: QueryWhere<User> = {};
function other(QueryWhereMap: number) { return QueryWhereMap; }
type K = Keys<User>;
`);
    expect(unresolved).toEqual([]);
  });

  it('drops a renamed import whose new name is already imported', () => {
    const { text } = codemodFile(`import { QueryWhere, QueryWhereMap } from 'uql-orm';
const a: QueryWhereMap<User> = {};
const b: QueryWhere<User> = {};
`);

    expect(text).toBe(`import { QueryWhere } from 'uql-orm';
const a: QueryWhere<User> = {};
const b: QueryWhere<User> = {};
`);
  });

  it('reports a removed driver class where it is imported from its own entry', () => {
    const { changed, unresolved } = codemod(`
      import { PgDialect } from 'uql-orm/postgres';
      import { LibsqlQuerier } from 'uql-orm/libsql';
    `);

    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("'PgDialect' was removed; the pools build `PostgresDialect`");
    expect(unresolved[1]).toContain("'LibsqlQuerier' was removed; the libSQL and Turso pools return `HranaQuerier`");
  });

  it('reports a decorator that no longer exists rather than removing it', () => {
    const { text, changed, unresolved } = codemod(`
      class Service {
        @Serialized() secret?: string;
        @Log()
        async work() {}
      }
    `);

    expect(changed).toBe(false);
    expect(text).toContain('@Serialized()');
    expect(text).toContain('@Log()');
    expect(unresolved[0]).toContain("'@Serialized()' was removed; delete it and its import");
    expect(unresolved[1]).toContain("'@Log()' was removed; delete it and its import");
  });

  /**
   * Both go together: a transaction is the caller's `pool.transaction()` now, so the method has to be
   * rewritten around a pool the codemod cannot name.
   */
  it("reports '@Transactional()' and '@InjectQuerier()' rather than rewriting them", () => {
    const { text, changed, unresolved } = codemod(`
      class Service {
        @Transactional()
        async save(@InjectQuerier() querier?: Querier) {
          await querier!.insertOne({}, {});
        }
      }
    `);

    expect(changed).toBe(false);
    expect(text).toContain('@Transactional()');
    expect(text).toContain('@InjectQuerier() querier?: Querier');
    expect(unresolved[0]).toContain("'@Transactional()' was removed; wrap the body in `pool.transaction(");
    expect(unresolved[1]).toContain("'@InjectQuerier()' was removed; take the querier from the enclosing");
  });

  it('reports rather than guesses when it cannot resolve a shape', () => {
    const { unresolved, changed } = codemod(`
      class Entity {
        @Field() payload?: { nested: true };
      }
    `);

    expect(changed).toBe(false);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toContain("cannot infer 'type'");
  });

  it('reports a relation whose target is not a class', () => {
    const { unresolved } = codemod(`
      class Entity {
        @ManyToOne() broken?: number;
      }
    `);

    expect(unresolved[0]).toContain("cannot infer 'entity'");
  });
});

describe('raw()', () => {
  const codemodRaw = (body: string) => codemodFile(`import { raw } from 'uql-orm';\n${body}`).text;

  it('rewrites a string expression into a tagged template', () => {
    expect(codemodRaw(`const a = raw('"salePrice" > "cost" * 2');`)).toContain(
      'const a = raw`"salePrice" > "cost" * 2`;',
    );
  });

  it('moves a second alias argument onto as()', () => {
    expect(codemodRaw(`const a = raw('LOG10(points)', 'score');`)).toContain(
      "const a = raw`LOG10(points)`.as('score');",
    );
  });

  it('escapes a backtick that would end the template', () => {
    expect(codemodRaw('const a = raw("`points` > 1");')).toContain('const a = raw`\\`points\\` > 1`;');
  });

  it('escapes a dollar-brace that would interpolate', () => {
    expect(codemodRaw(`const a = raw('cost > \${x}');`)).toContain('raw`cost > \\${x}`');
  });

  it('leaves the callback form alone', () => {
    const body = 'const a = raw(({ ctx }) => ctx.append("x"));';
    expect(codemodRaw(body)).toContain(body);
  });

  it("leaves another library's function of the same name alone", () => {
    const body = `import { raw } from 'express';\nconst a = raw('"a" > 1');`;
    expect(codemodFile(body).text).toContain(`const a = raw('"a" > 1');`);
  });

  it('leaves a computed string alone, having no literal to inline', () => {
    const body = 'declare const sql: string;\nconst a = raw(sql);';
    expect(codemodRaw(body)).toContain('const a = raw(sql);');
  });
});
