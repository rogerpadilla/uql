import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { type FileResult, rewriteLegacy, transformFile } from './transform.js';

const FILE_NAME = '/entities.ts';

/**
 * Runs the codemod over one whole in-memory file, for the cases about imports and file-level text.
 *
 * A real `ts.Program` rather than a bare parse, because the transforms read the types the checker resolves,
 * such as a relation's target and the `null` arm of a property. The default lib is read
 * from disk rather than stubbed, since `Company[]` only resolves its element type when `Array` has a
 * declaration, and unwrapping arrays is exactly what the to-many relation transform depends on.
 */
function codemodFile(
  text: string,
  files: Readonly<Record<string, string>> = {},
  strictNullChecks = true,
  transform: (
    source: ts.SourceFile,
    checker: ts.TypeChecker,
    options: { strictNullChecks: boolean },
  ) => FileResult = rewriteLegacy,
) {
  const readFile = (name: string) => (name === FILE_NAME ? text : (files[name] ?? ts.sys.readFile(name)));
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
  const options = {
    target: ts.ScriptTarget.ESNext,
    lib: ['lib.esnext.d.ts'],
    moduleResolution: ts.ModuleResolutionKind.Node10,
  };
  const program = ts.createProgram([FILE_NAME], options, host);
  return transform(program.getSourceFile(FILE_NAME)!, program.getTypeChecker(), { strictNullChecks });
}

/** What a snippet is compiled against, so the checker resolves the decorators. */
const STUBS = `
  type EntityGetter = () => unknown;
  type FieldOptions = { type?: unknown; references?: EntityGetter; name?: string; length?: number };
  declare function Field(opts?: FieldOptions): PropertyDecorator;
  declare function Id(opts?: FieldOptions): PropertyDecorator;
  declare function InjectQuerier(): ParameterDecorator;
  declare function Log(): MethodDecorator;
  declare function Serialized(): PropertyDecorator;
  declare function Transactional(): MethodDecorator;
  declare class Querier {}
  declare function ManyToOne(opts?: { entity?: EntityGetter; references?: unknown; cascade?: boolean }): PropertyDecorator;
  declare function OneToOne(opts?: { entity?: EntityGetter; mappedBy?: unknown; references?: unknown }): PropertyDecorator;
  declare function OneToMany(opts?: { entity?: EntityGetter; mappedBy?: unknown }): PropertyDecorator;
  declare function Index(columns: unknown, options?: unknown): ClassDecorator;
  declare function defineEntity(entity: unknown, options: unknown): void;
  declare function defineIndex(entity: unknown, options: unknown): void;
  declare function defineRelation(entity: unknown, key: string, options: unknown): void;
  declare function Entity(options?: unknown): ClassDecorator;
  declare function Filter(name: string, options: unknown): ClassDecorator;
  declare function Trigger(...triggers: unknown[]): ClassDecorator;
  declare function defineFilter(entity: unknown, name: string, options: unknown): void;
`;

/** The findings for a missing option and the removed `Relation`; each is matched within its `file:line: ` prefix. */
const NO_TYPE = "has no 'type': declare its column as a builder, such as `f.string()`";
const NO_ENTITY = "has no 'entity': name its target, `entity: () => Target`";
const RELATION_IMPORT = "'Relation' was removed; write the property's type without it, and drop the import";

/** {@link STUBS} without `Field`, for the cases where the codemod writes the `Field` import itself. */
const STUBS_WITHOUT_FIELD = STUBS.replace(/ {2}declare function Field\(.*\n/, '');

/** Runs the codemod over a snippet compiled against {@link STUBS}, for the per-property cases. */
const codemod = (snippet: string) => codemodFile(`${STUBS}${snippet}`);

describe('transformFile', () => {
  it.each([`import * as f from 'x';`, `import f from 'y';`, `function f() {}`, `class f {}`, `const f = 1;`])(
    'should refuse a file that declares the name it writes: %s',
    (own) => {
      const { unresolved } = codemodFile(
        `${own}
@Entity()
export class A {
  @Field({ type: Number, isId: true }) id?: number;
}`,
        {},
        true,
        transformFile,
      );
      expect(unresolved).toContain(
        "/entities.ts:1: 'f' is already named here, and the codemod writes it: rename that, then run again",
      );
    },
  );

  it('should report what the builder pass cannot write at its line in the file as written', () => {
    const { unresolved } = codemodFile(
      `import { Entity, Field, Id } from 'uql-orm';
const shared = { type: String };
@Entity()
export class A {
  @Id({ type: String }) code?: string;
  @Field({ ...shared }) name?: string;
}`,
      {},
      true,
      transformFile,
    );
    expect(unresolved).toContain('/entities.ts:6: cannot write a builder because its options object spreads another');
  });

  it('should run the rewrites the checker reads types for, then write the columns as builders', () => {
    const { text, unresolved } = codemodFile(
      `import { Entity, Field, Id } from 'uql-orm';
@Entity()
export class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}`,
      {},
      true,
      transformFile,
    );
    expect(unresolved).toEqual([]);
    expect(text).toBe(`import { f, Entity, Field } from 'uql-orm';
@Entity()
export class User {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
}`);
  });
});

/** The SQL querier as 0.99.0 typed it, its `run`/`all` taking a string, installed where `uql-orm` resolves. */
const UQL_ORM_0_99 = {
  '/node_modules/uql-orm/package.json': '{ "name": "uql-orm", "types": "index.d.ts" }',
  '/node_modules/uql-orm/index.d.ts': `export interface SqlQuerier {
    run(sql: string, values?: unknown[]): Promise<unknown>;
    all<T>(sql: string, values?: unknown[]): Promise<T[]>;
  }
  export interface Querier {
    upsertOne(entity: unknown, conflictPaths: unknown, payload: unknown): Promise<{ id?: number; created?: boolean }>;
  }
  export declare class Migrator {
    pending(): Promise<string[]>;
    executed(): Promise<string[]>;
    down(options?: { to?: string; step?: number }): Promise<unknown>;
  }`,
};

describe('codemod transforms', () => {
  /** The schema pass reads the text the first one wrote, so a line it reports is mapped back to the file's own. */
  it('reports a schema it cannot convert at its line in the file as written', () => {
    const { unresolved } = codemodFile(`import 'reflect-metadata';
import { defineEntity } from 'uql-orm';

class Base {}
class Child extends Base {
  id?: number;
}
defineEntity(Child, { fields: { id: { type: Number, isId: true } } });
`);

    expect(unresolved).toEqual([
      expect.stringMatching(/:8: 'Child' extends a class: declare the base with defineEntity too/),
    ]);
  });

  it('reports every decorator with no type, whatever its shape, and writes none', () => {
    const { text, changed, unresolved } = codemod(/*ts*/ `
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
    expect(text).toContain('@Id() id?: number;');
    expect(text).toContain('@Field() name?: string | null;');
    expect(text).toContain('@Field() avatar?: Uint8Array | null;');
    expect(unresolved).toEqual(Array.from({ length: 6 }, () => expect.stringContaining(NO_TYPE)));
  });

  it('keeps existing options as written, and reports the type they lack', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      class Entity {
        @Field({ name: 'image', length: 150 }) picture?: string;
      }
    `);

    expect(text).toContain("@Field({ name: 'image', length: 150 }) picture?: string | null;");
    expect(unresolved).toEqual([expect.stringContaining(NO_TYPE)]);
  });

  it('names an unconventional key with the idKey brand', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Id({ type: String }) code?: string;
        @Field({ type: String }) title?: string;
      }
    `);

    expect(text).toContain("[idKey]?: 'code';");
  });

  it('names both columns of a composite key', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Id({ type: Number }) studentId?: number;
        @Id({ type: String }) courseId?: string;
      }
    `);

    expect(text).toContain("[idKey]?: 'studentId' | 'courseId';");
  });

  it('leaves a conventional key alone', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string;
      }
    `);

    expect(text).not.toContain('[idKey]');
  });

  it('leaves a key that is already branded alone', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        [idKey]?: 'pk';
        @Id({ type: Number }) pk?: number;
      }
    `);

    expect(text.match(/\[idKey\]/g)).toHaveLength(1);
  });

  it('reports a key written as a computed name rather than guess its brand', () => {
    const { text, unresolved } = codemod(/*ts*/ `
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
    const { unresolved } = codemod(/*ts*/ `
      declare const options: { virtual: FieldOptions };
      class Entity {
        @Field(options.virtual) total?: number;
      }
    `);

    expect(unresolved).toContainEqual(
      expect.stringMatching(/^\/entities\.ts:\d+: its options are passed as 'options\.virtual'$/),
    );
  });

  it('declares a key @Field marks with isId as the builder that names it', () => {
    const { text } = codemodFile(
      /*ts*/ `import { Entity, Field } from 'uql-orm';
@Entity()
class Post {
  @Field({ type: Number, isId: true }) id?: number;
  @Field({ isId: true, type: String }) slug?: string;
}
`,
      {},
      true,
      transformFile,
    );

    expect(text).toBe(`import { f, idKey, Entity, Field } from 'uql-orm';
@Entity()
class Post {
  [idKey]?: 'id' | 'slug';
  @Field(f.number().id()) id?: number;
  @Field(f.string().id()) slug?: string;
}
`);
  });

  describe("folding the class decorators into @Entity's options", () => {
    it('moves each into the option it registers under', () => {
      const { text } = codemod(/*ts*/ `
      @Index((post) => [post.slug], { unique: true })
      @Entity()
      @Trigger({ on: 'afterInsert', run: audit })
      @Filter('live', { where: { live: true } })
      class Post { id?: number; slug?: string; live?: boolean; }
    `);

      expect(text)
        .toContain(`      @Entity({ triggers: [{ on: 'afterInsert', run: audit }], indexes: [{ columns: (post) => [post.slug], unique: true }], filters: { live: { where: { live: true } } } })
      class Post`);
    });

    it('merges indexes and filters after the lists @Entity states, in the order written', () => {
      const { text } = codemod(/*ts*/ `
      @Index((post) => [post.slug])
      @Entity({ indexes: [{ columns: (post) => [post.title] }], name: 'posts' })
      @Index((post) => [post.live])
      class Post { id?: number; slug?: string; title?: string; live?: boolean; }
    `);

      expect(text).toContain(
        "@Entity({ indexes: [{ columns: (post) => [post.title] }, { columns: (post) => [post.slug] }, { columns: (post) => [post.live] }], name: 'posts' })",
      );
    });

    it('moves a commented trigger below into a list @Entity states, its comment kept above it', () => {
      const { text } = codemod(/*ts*/ `
      @Entity({ triggers: [{ on: 'beforeInsert', run: other }] })
      // audits every insert
      @Trigger({ on: 'afterInsert', run: audit })
      class Post { id?: number; }
    `);

      expect(text).toContain(`      @Entity({ triggers: [
        // audits every insert
        { on: 'afterInsert', run: audit },
        { on: 'beforeInsert', run: other }] })
      class Post`);
    });

    it('indents a list it writes into a file with no indented line by two spaces', () => {
      const { text } = codemod(
        /*ts*/ `@Index((doc) => [doc.kind]) @Entity({ name: 'docs' }) @Index((doc) => [doc.title]) class Doc { kind?: string; title?: string; }`,
      );

      expect(text).toContain(`@Entity({ name: 'docs', indexes: [
  { columns: (doc) => [doc.kind] },
  { columns: (doc) => [doc.title] },
] }) class Doc`);
    });

    it('drops every named import that is folded away, the default import left on its own', () => {
      const { text } = codemodFile(/*ts*/ `import Orm, { Index } from 'uql-orm';
@Entity()
@Index((doc) => [doc.kind])
class Doc { kind?: string; }
void Orm;
`);

      expect(text).toContain("import Orm from 'uql-orm';");
    });

    it('moves an uncommented trigger below into a list @Entity states, ahead of it', () => {
      const { text } = codemod(/*ts*/ `
      @Entity({ triggers: [{ on: 'beforeInsert', run: other }] })
      @Trigger({ on: 'afterInsert', run: audit })
      class Post { id?: number; }
    `);

      expect(text).toContain(
        "@Entity({ triggers: [{ on: 'afterInsert', run: audit }, { on: 'beforeInsert', run: other }] })",
      );
    });

    it('keeps a rewrite inside a decorator it moves, and drops the import with its last use', () => {
      const { text } = codemodFile(/*ts*/ `import { Entity, Index } from 'uql-orm';
@Entity()
@Index(['title'])
class Post { id?: number; title?: string; }
`);

      expect(text).toBe(`import { Entity } from 'uql-orm';
@Entity({ indexes: [{ columns: (post) => [post.title] }] })
class Post { id?: number; title?: string; }
`);
    });

    it('declares a base with none an abstract entity, which is never a table', () => {
      const { text } = codemodFile(/*ts*/ `import { Index, Trigger } from 'uql-orm';
@Index((base) => [base.tenant])
@Trigger(first, second)
abstract class Tenanted { tenant?: string; }
`);

      expect(text).toBe(`import { Entity } from 'uql-orm';
@Entity({ abstract: true, triggers: [
  first,
  second,
], indexes: [{ columns: (base) => [base.tenant] }] })
abstract class Tenanted { tenant?: string; }
`);
    });

    it("keeps each decorator's comments on the lines above its entry, and the class's doc where it is", () => {
      const { text } = codemodFile(/*ts*/ `import { Entity, Index } from 'uql-orm';
/** A post. */
// the lookup by slug
@Index((post) => [post.slug])
@Entity({ name: 'posts' })
// @ts-expect-error a column the entity does not model
@Index((post) => [post.nope])
class Post { id?: number; slug?: string; }
`);

      expect(text).toBe(`import { Entity } from 'uql-orm';
/** A post. */
@Entity({ name: 'posts', indexes: [
  // the lookup by slug
  { columns: (post) => [post.slug] },
  // @ts-expect-error a column the entity does not model
  { columns: (post) => [post.nope] },
] })
class Post { id?: number; slug?: string; }
`);
    });

    it('keeps the order triggers register in, which is the order they run in', () => {
      const { text } = codemod(/*ts*/ `
      @Trigger({ on: 'afterInsert', name: 'last' })
      @Entity({ triggers: [{ on: 'afterInsert', name: 'own' }] })
      @Trigger({ on: 'afterInsert', name: 'second' })
      @Trigger({ on: 'afterInsert', name: 'first' })
      class Post { id?: number; }
    `);

      expect(text).toContain(
        "@Entity({ triggers: [{ on: 'afterInsert', name: 'first' }, { on: 'afterInsert', name: 'second' }, { on: 'afterInsert', name: 'own' }, { on: 'afterInsert', name: 'last' }] })",
      );
    });

    it("takes along a comment closing a decorator's line", () => {
      const { text } = codemod(/*ts*/ `
      @Entity()
      @Index((post) => [post.slug]) // the lookup
      class Post { id?: number; slug?: string; }
    `);

      expect(text).toContain(`@Entity({ indexes: [
        // the lookup
        { columns: (post) => [post.slug] },
      ] })
      class Post`);
    });

    it.each([
      [
        'an uncalled @Entity',
        '@Entity\n      @Index((post) => [post.id])',
        "call '@Entity()' to move '@Index', '@Trigger' and '@Filter' into its options",
      ],
      [
        'options it cannot read',
        '@Entity(shared)\n      @Index((post) => [post.id])',
        "move '@Index', '@Trigger' and '@Filter' into '@Entity' options this cannot read",
      ],
      [
        'an index naming no columns',
        '@Entity()\n      @Index()',
        "move this '@Index' into '@Entity({ indexes })' by hand: it names no columns",
      ],
    ])('reports %s, leaving the class as written', (_, decorators, message) => {
      const { text, unresolved } = codemod(/*ts*/ `
      declare const shared: object;
      ${decorators}
      class Post { id?: number; }
    `);

      expect(text).toContain(decorators);
      expect(unresolved).toEqual([expect.stringContaining(message)]);
    });

    it('writes options it cannot spell out as a spread, and quotes a filter name no identifier holds', () => {
      const { text } = codemod(/*ts*/ `
      declare const unique: { unique: true };
      @Entity({})
      @Index((post) => [post.id], unique)
      @Filter('my-filter', { where: {} })
      class Post { id?: number; }
    `);

      expect(text).toContain(
        "@Entity({ indexes: [{ columns: (post) => [post.id], ...unique }], filters: { 'my-filter': { where: {} } } })",
      );
    });

    it('merges commented entries into the lists @Entity states, each on its own line', () => {
      const { text } = codemodFile(/*ts*/ `import { Entity, Index, Trigger } from 'uql-orm';
// after its own
@Trigger(after)
@Entity({ triggers: [own], indexes: [] })
// the slug
@Index((post) => [post.slug])
// ahead of its own
@Trigger(ahead)
class Post { id?: number; slug?: string; }
`);

      expect(text).toBe(`import { Entity } from 'uql-orm';
@Entity({ triggers: [
  // ahead of its own
  ahead,
  own,
  // after its own
  after], indexes: [
  // the slug
  { columns: (post) => [post.slug] }] })
class Post { id?: number; slug?: string; }
`);
    });

    it('folds decorators sharing a line with each other or with the class', () => {
      const { text } = codemodFile(/*ts*/ `import { Entity, Index } from 'uql-orm';
@Index((post) => [post.id]) @Entity() class Post { id?: number; }
@Index((base) => [base.id]) abstract class Base { id?: number; }
`);

      expect(text).toBe(`import { Entity } from 'uql-orm';
@Entity({ indexes: [{ columns: (post) => [post.id] }] }) class Post { id?: number; }
@Entity({ abstract: true, indexes: [{ columns: (base) => [base.id] }] }) abstract class Base { id?: number; }
`);
    });

    it('reports a filter named by no string', () => {
      const { unresolved } = codemod(/*ts*/ `
      declare const name: string;
      @Entity()
      @Filter(name, { where: {} })
      class Post { id?: number; }
    `);

      expect(unresolved).toEqual([
        expect.stringContaining("move this '@Filter' into '@Entity({ filters })' by hand: its name is not a string"),
      ]);
    });
  });

  it('leaves a class decorator that is never called alone, rewriting the ones beside it', () => {
    const { text } = codemod(/*ts*/ `
      declare const Sealed: ClassDecorator;
      @Sealed
      @Entity()
      @Index(['title'])
      class Post { id?: number; title?: string; }
    `);

    expect(text).toContain(
      '@Sealed\n      @Entity({ indexes: [{ columns: (post) => [post.title] }] })\n      class Post',
    );
  });

  it('leaves a decorator it cannot name alone', () => {
    const { text, changed } = codemod(/*ts*/ `
      const decorators = { Field };
      class Entity {
        @decorators.Field() title?: string;
      }
    `);

    expect(changed).toBe(false);
    expect(text).toContain('@decorators.Field() title?: string;');
  });

  it('removes a statement from the last line of a file that has no line after it', () => {
    const { text } = codemodFile(`class Item {}\nimport { col } from 'uql-orm';`);

    expect(text).toBe('class Item {}\n');
  });

  it('renames the virtual option to computed, leaving its expression alone', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Field({ type: Number, virtual: raw\`1 + 1\` }) score?: number;
      }
    `);

    expect(text).toContain('@Field({ type: Number, computed: raw`1 + 1` }) score?: number | null;');
  });

  /** A shorthand has no value to keep, so the key alone would rebind it to a local that is not there. */
  it('renames a shorthand virtual, keeping what it referred to', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      const virtual = raw\`1 + 1\`;
      class Entity {
        @Field({ type: Number, virtual }) score?: number;
      }
    `);

    expect(text).toContain('@Field({ type: Number, computed: virtual }) score?: number | null;');
    expect(unresolved).toEqual([]);
  });

  it('renames a quoted virtual key', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      class Entity {
        @Field({ type: Number, 'virtual': raw\`1\` }) score?: number;
      }
    `);

    expect(text).toContain('@Field({ type: Number, computed: raw`1` }) score?: number | null;');
    expect(unresolved).toEqual([]);
  });

  /** The same lookup decides whether an option is already stated, so a quoted one is not doubled. */
  it('leaves a quoted type alone rather than inserting a second one', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Field({ 'type': String }) name?: string;
      }
    `);

    expect(text).toContain("@Field({ 'type': String }) name?: string | null;");
  });

  it('reports a field giving both names rather than choosing one', () => {
    const { unresolved } = codemod(/*ts*/ `
      class Entity {
        @Field({ type: Number, virtual: raw\`1\`, computed: raw\`2\` }) score?: number;
      }
    `);

    expect(unresolved.join('\n')).toContain("gives both 'virtual' and 'computed'");
  });

  /** An empty literal has no option to state, so the report is the only change. */
  it('reports an empty options object as having no type', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      class Entity {
        @Field({}) name?: string;
      }
    `);

    expect(text).toContain('@Field({}) name?: string | null;');
    expect(unresolved).toEqual([expect.stringContaining(NO_TYPE)]);
  });

  it('reports a string-literal union with no type, rather than inferring a column', () => {
    const { unresolved } = codemod(/*ts*/ `
      type Role = 'admin' | 'member';
      class Entity {
        @Field() role?: Role;
      }
    `);

    expect(unresolved).toEqual([expect.stringContaining(NO_TYPE)]);
  });

  it('leaves a nullable field alone once the null arm is dropped', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Field({ type: String }) nickname?: string | null;
      }
    `);

    expect(text).toContain('@Field({ type: String }) nickname?: string | null;');
  });

  /** Arms that disagree have no single column type, and nothing here picks one for a missing `type`. */
  it('reports a union whose arms disagree, and admits null all the same', () => {
    const { changed, unresolved } = codemod(/*ts*/ `
      class Entity {
        @Field() mixed?: string | number;
      }
    `);

    expect(changed).toBe(true);
    expect(unresolved).toEqual([expect.stringContaining(NO_TYPE)]);
  });

  /**
   * A branded id is a template literal, not a plain string, so the codemod cannot tell its column type from the
   * property alone: `String` and `'uuid'` are both plausible, and the choice changes the schema.
   */
  it('reports a branded template-literal id with no type, rather than choosing its column', () => {
    const { text, notes, unresolved } = codemod(/*ts*/ `
      type UUID = \`\${string}-\${string}-\${string}-\${string}-\${string}\`;
      class Entity {
        @Id() id?: UUID;
      }
    `);

    expect(text).toContain('@Id() id?: UUID;');
    expect(notes).toHaveLength(0);
    expect(unresolved).toEqual([expect.stringContaining(NO_TYPE)]);
  });

  it('says nothing about a plain string field', () => {
    const { notes } = codemod(/*ts*/ `
      class Entity {
        @Field() name?: string;
      }
    `);

    expect(notes).toHaveLength(0);
  });

  it('does not touch a field that already declares a type', () => {
    const { text, changed } = codemod(/*ts*/ `
      class Entity {
        @Field({ type: 'uuid' }) id?: string;
      }
    `);

    expect(changed).toBe(true);
    expect(text).toContain("@Field({ type: 'uuid' }) id?: string | null;");
  });

  it('leaves a reference field without a type, so the column resolves from the referenced key', () => {
    const { text, changed } = codemod(/*ts*/ `
      class Company { id?: number; }
      class Entity {
        @Field({ references: () => Company }) companyId?: number;
      }
    `);

    expect(changed).toBe(true);
    expect(text).toContain('@Field({ references: () => Company }) companyId?: number | null;');
  });

  it('admits no null in a project without strictNullChecks, where it would change nothing', () => {
    const { text } = codemodFile(
      `${STUBS}
      class Entity {
        @Field({ type: String }) name?: string;
      }
    `,
      {},
      false,
    );

    expect(text).toContain('@Field({ type: String }) name?: string;');
  });

  it('turns an upsert destructured for its id into the id it resolves to, reporting any other key', () => {
    const { text, unresolved } = codemodFile(
      `import type { Querier } from 'uql-orm';
export async function f(q: Querier) {
  const { id } = await q.upsertOne(Object, {}, {});
  const { id: saved } = await q.upsertOne(Object, {}, {});
  const { created } = await q.upsertOne(Object, {}, {});
  return [id, saved, created];
}
`,
      UQL_ORM_0_99,
    );

    expect(text).toContain('  const id = await q.upsertOne(Object, {}, {});');
    expect(text).toContain('  const saved = await q.upsertOne(Object, {}, {});');
    expect(unresolved).toEqual(["/entities.ts:5: upsertOne() resolves to the id; 'created' and 'changes' are gone"]);
  });

  it('leaves a computed field without a type, since its SQL decides the column', () => {
    const { text } = codemod(/*ts*/ `
      class Account {
        @Field({ computed: () => 1, eager: true }) readonly passkeyCount?: number;
      }
    `);

    expect(text).toContain('@Field({ computed: () => 1, eager: true }) readonly passkeyCount?: number;');
  });

  it('reports a relation with no entity, for one and for many, and writes none', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      class Company { id?: number; }
      class Entity {
        @ManyToOne() company?: Company;
        @OneToMany({ mappedBy: 'entity' }) peers?: Company[];
      }
    `);

    expect(text).toContain('@ManyToOne() company?: Company;');
    expect(text).toContain('@OneToMany({ mappedBy: (company) => company.entity }) peers?: Company[];');
    expect(unresolved).toEqual([expect.stringContaining(NO_ENTITY), expect.stringContaining(NO_ENTITY)]);
  });

  it('rewrites a string mappedBy into the callback named after the target, leaving a callback alone', () => {
    const { text } = codemod(/*ts*/ `
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
    const { text, unresolved } = codemod(/*ts*/ `
      const key = 'owner';
      class Company { id?: number; owner?: Entity; }
      class Entity {
        @OneToMany({ entity: () => Company, mappedBy: key }) owned?: Company[];
      }
    `);

    expect(text).toContain('mappedBy: key');
    expect(unresolved).toContainEqual(expect.stringContaining("write 'mappedBy' as a callback"));
  });

  it('names the foreign key a to-one found by name, where its class declares or inherits it', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      class Company { id?: number; }
      class Owned { @Field({ type: Number }) companyId?: number; }
      class Employee extends Owned {
        @Field({ type: Number }) managerId?: number;
        sponsorId?: number;
        @ManyToOne({ entity: () => Company }) sponsor?: Company;
        @ManyToOne({ entity: () => Company }) company?: Company;
        @OneToOne({
          entity: () => Employee,
        })
        manager?: Employee;
        @ManyToOne({ entity: () => Company }) employer?: Company;
      }
    `);

    expect(text).toContain(
      '@ManyToOne({ entity: () => Company, references: (employee) => employee.companyId }) company?: Company;',
    );
    expect(text).toContain('entity: () => Employee, references: (employee) => employee.managerId,');
    expect(text).toContain('@ManyToOne({ entity: () => Company }) employer?: Company;');
    // A member that is no column would be refused on first read once named.
    expect(text).toContain('@ManyToOne({ entity: () => Company }) sponsor?: Company;');
    expect(unresolved).toContainEqual(
      expect.stringContaining("declare the foreign key column 'sponsorId' and name it in 'references'"),
    );
  });

  it('declares the foreign key a to-one created by name, typed as the key it points at', () => {
    const { text, unresolved } = codemodFile(`import { ManyToOne, OneToOne } from 'uql-orm';
${STUBS_WITHOUT_FIELD}
type Uuid = \`\${string}-\${string}\`;
abstract class Base {
  @Id({ type: 'uuid' }) id?: Uuid;
}
class Company extends Base {}
class Pair {
  [idKey]?: 'left' | 'right';
  @Id({ type: Number }) left?: number;
  @Id({ type: Number }) right?: number;
}
class Employee extends Base {
  @ManyToOne({ entity: () => Company })
  company?: Company;
  @OneToOne({ entity: () => Employee }) manager?: Employee;
  @ManyToOne({ entity: () => Pair }) pair?: Pair;
}
`);

    expect(text).toContain(`import { Field, ManyToOne, OneToOne } from 'uql-orm';`);
    expect(text).toContain(
      '  @Field({ references: () => Company }) companyId?: Uuid | null;\n' +
        '  @ManyToOne({ entity: () => Company, references: (employee) => employee.companyId })\n' +
        '  company?: Company;',
    );
    expect(text).toContain(
      '  @Field({ references: () => Employee }) managerId?: Uuid | null;\n' +
        '  @OneToOne({ entity: () => Employee, references: (employee) => employee.managerId }) manager?: Employee;',
    );
    expect(text).toContain('  @ManyToOne({ entity: () => Pair }) pair?: Pair;');
    expect(unresolved).toContainEqual(
      expect.stringContaining("'Pair' has a composite key: declare a column per key and pair each in 'references'"),
    );
  });

  it('declares the foreign key of a to-one with no entity getter, typed as the key it points at', () => {
    const { text, unresolved } = codemodFile(`${STUBS_WITHOUT_FIELD}
      class Company { @Id({ type: Number }) id = 0; }
      class Employee {
        @ManyToOne({ cascade: true }) company?: Company;
      }
    `);

    expect(text).toContain(
      '@Field({ references: () => Company }) companyId?: number | null;\n' +
        '        @ManyToOne({ cascade: true, references: (employee) => employee.companyId }) company?: Company;',
    );
    expect(unresolved).toContainEqual(expect.stringContaining(NO_ENTITY));
  });

  it('leaves a to-one that already says how it joins, and names the key in defineEntity and defineRelation', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      class Company { id?: number; contractor?: Contractor; }
      class Contractor {
        companyId?: number;
        ownerId?: number;
        @ManyToOne({ entity: () => Company, references: (contractor) => contractor.companyId }) company?: Company;
        @OneToOne({ entity: () => Company, mappedBy: (company) => company.contractor }) owner?: Company;
      }
      class Supplier { id?: number; companyId?: number; company?: Company; managerId?: number; manager?: Supplier; }
      defineEntity(Supplier, { relations: { company: { cardinality: 'm1', entity: () => Company } } });
      defineRelation(Supplier, 'manager', { cardinality: '11', entity: () => Supplier });
      declare const relation: string;
      defineRelation(Supplier, relation, { cardinality: 'm1', entity: () => Company });
      defineRelation(Supplier, 'vendor', { cardinality: 'm1', entity: () => Company });
      class Buyer { id?: number; companyId?: number; company?: Company; }
      defineEntity(Buyer, { fields: { id: { type: Number } }, relations: { company: { cardinality: 'm1', entity: () => Company } } });
    `);

    expect(unresolved).toContainEqual(
      expect.stringContaining("declare the foreign key column 'vendorId' and name it in 'references'"),
    );
    expect(unresolved).toContainEqual(
      expect.stringContaining("declare the foreign key column 'companyId' and name it in 'references'"),
    );
    expect(text).toContain('company: () => rel.manyToOne(Company),');
    expect(unresolved).toContainEqual(expect.stringContaining("defineRelation's arguments could not be read"));

    expect(text).toContain(
      '@ManyToOne({ entity: () => Company, references: (contractor) => contractor.companyId }) company?: Company;',
    );
    expect(text).toContain(
      '@OneToOne({ entity: () => Company, mappedBy: (company) => company.contractor }) owner?: Company;',
    );
    expect(text).toContain(
      "{ company: { cardinality: 'm1', entity: () => Company, references: (supplier) => supplier.companyId } }",
    );
    expect(text).toContain(
      "{ cardinality: '11', entity: () => Supplier, references: (supplier) => supplier.managerId }",
    );
    expect(text).toContain("defineRelation(Supplier, relation, { cardinality: 'm1', entity: () => Company });");
  });

  it('rewrites @Index columns and include into callbacks named after the class', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      declare const columns: string[];
      @Entity()
      @Index(['title', { column: 'createdAt', order: 'desc' }, raw\`lower("title")\`], { include: ['slug'], unique: true })
      @Index(['first-name'])
      @Index((post) => [post.title])
      @Index(columns)
      class Post { id?: number; title?: string; createdAt?: Date; slug?: string; 'first-name'?: string; }
    `);

    expect(text).toContain(
      '{ columns: (post) => [post.title, { column: post.createdAt, order: \'desc\' }, raw`lower("title")`], include: (post) => [post.slug], unique: true }',
    );
    expect(text).toContain("{ columns: (post) => [post['first-name']] }");
    expect(text).toContain('{ columns: (post) => [post.title] }');
    expect(text).toContain('{ columns: columns }');
    expect(unresolved).toContainEqual(expect.stringContaining("write '@Index' columns as a callback"));
  });

  it("rewrites a JSON index entry into the path read off the column's ref", () => {
    const { text, unresolved } = codemod(/*ts*/ `
      declare const path: string;
      @Entity()
      @Index((doc) => [{ column: doc.kind, jsonPath: { path: 'theme.color', type: String, length: 32 } }])
      @Index((doc) => [{ column: doc.kind, jsonPath: { path: 'rating', type: Number }, order: 'desc' }])
      @Index((doc) => [{ column: doc.tags, jsonArray: { type: String, length: 64 } }])
      @Index((doc) => [{ column: doc.kind, jsonArray: { path: 'first-ids', type: Number } }])
      @Index((doc) => [{ column: doc.kind, jsonPath: { path, type: String } }])
      @Index((doc) => [{ column: doc.kind, length: 16 }, { column: doc.tags, order: 'desc' }])
      class Doc { kind?: unknown; tags?: unknown; }
    `);

    expect(text).toContain('{ columns: (doc) => [{ column: doc.kind.theme.color, type: String, charLength: 32 }] }');
    expect(text).toContain("{ columns: (doc) => [{ column: doc.kind.rating, type: Number, order: 'desc' }] }");
    expect(text).toContain('{ columns: (doc) => [{ column: doc.tags, type: [String], charLength: 64 }] }');
    expect(text).toContain("{ columns: (doc) => [{ column: doc.kind['first-ids'], type: [Number] }] }");
    expect(text).toContain('{ columns: (doc) => [{ column: doc.kind, jsonPath: { path, type: String } }] }');
    expect(text).toContain(
      "{ columns: (doc) => [{ column: doc.kind, prefixLength: 16 }, { column: doc.tags, order: 'desc' }] }",
    );
    expect(unresolved).toContainEqual(expect.stringContaining("read the JSON path off the column's ref"));
  });

  it('rewrites a JSON entry of a column list written as strings, inside the callback it becomes', () => {
    const { text } = codemod(/*ts*/ `
      @Entity()
      @Index(['tenantId', { column: 'kind', jsonPath: { path: 'theme', type: String } }])
      class Doc { tenantId?: string; kind?: unknown; }
    `);

    expect(text).toContain('{ columns: (doc) => [doc.tenantId, { column: doc.kind.theme, type: String }] }');
  });

  it('reports a JSON read on an entry with no column, or whose read is not a literal, and leaves both as they are', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      declare const read: object;
      @Entity()
      @Index((doc) => [{ jsonPath: { path: 'theme', type: String } }])
      @Index((doc) => [{ column: doc.kind, jsonPath: read }])
      class Doc { kind?: unknown; }
    `);

    expect(text).toContain("{ columns: (doc) => [{ jsonPath: { path: 'theme', type: String } }] }");
    expect(text).toContain('{ columns: (doc) => [{ column: doc.kind, jsonPath: read }] }');
    expect(unresolved).toHaveLength(2);
  });

  it('leaves an entry with no JSON read as it is, and reports one whose length is stated twice', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      @Entity()
      @Index((doc) => [{ column: doc.kind, order: 'desc' }])
      @Index((doc) => [{ column: doc.tags, length: 8, jsonArray: { type: String, length: 64 } }])
      class Doc { kind?: unknown; tags?: unknown; }
    `);

    expect(text).toContain("{ columns: (doc) => [{ column: doc.kind, order: 'desc' }] }");
    expect(text).toContain(
      '{ columns: (doc) => [{ column: doc.tags, length: 8, jsonArray: { type: String, length: 64 } }] }',
    );
    expect(unresolved).toEqual([expect.stringContaining("read the JSON path off the column's ref")]);
  });

  it('writes a key no identifier can name as a quoted string, escaping its quotes', () => {
    const { text } = codemod(/*ts*/ `
      declare const querier: { findMany(entity: unknown, q: unknown): void };
      @Entity()
      @Index(["o'clock"])
      class Post { @Id({ type: String }) "o'clock"?: string; }
      querier.findMany(Post, { $where: { $text: { $value: 'noon', $fields: ["o'clock"] } } });
    `);

    expect(text).toContain("{ columns: (post) => [post['o\\'clock']] }");
    expect(text).toContain("[idKey]?: 'o\\'clock';");
    expect(text).toContain("$fields: { 'o\\'clock': true }");
  });

  it('rewrites references into a callback over both key maps, and a self-relation into (local, foreign)', () => {
    const { text } = codemod(/*ts*/ `
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

  it('reports references it cannot read', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      class Customer { id?: number; code?: string; }
      declare const pair: { local: 'customerCode'; foreign: 'code' };
      class Order {
        customerCode?: string;
        @ManyToOne({ entity: () => Customer, references: [pair] }) customer?: Customer;
        @ManyToOne({ entity: () => Customer, references: [{ local: 'customerCode' }] }) buyer?: Customer;
        @ManyToOne({ entity: () => Customer, references: 'customerCode' }) seller?: Customer;
      }
    `);

    const report = "write 'references' as a callback; this one could not be read";
    expect(text).toContain("references: [{ local: 'customerCode' }] }) buyer?: Customer;");
    expect(text).toContain("references: 'customerCode' }) seller?: Customer;");
    expect(unresolved).toEqual([
      expect.stringContaining(report),
      expect.stringContaining(report),
      expect.stringContaining(report),
    ]);
  });

  it("renames $lock's wait to $wait, writing a lock that waits as true", () => {
    const { text, unresolved } = codemod(/*ts*/ `
      declare const querier: { findMany(entity: unknown, q: unknown): void };
      declare const wait: 'skip';
      querier.findMany(Object, { $lock: { wait: 'nowait' } });
      querier.findMany(Object, { $lock: { wait } });
      querier.findMany(Object, { $lock: { wait: 'block' } });
      querier.findMany(Object, { $lock: {} });
    `);

    expect(text).toContain("querier.findMany(Object, { $lock: { $wait: 'nowait' } });");
    expect(text).toContain('querier.findMany(Object, { $lock: { $wait: wait } });');
    expect(text.match(/\$lock: true/g)).toHaveLength(2);
    expect(unresolved).toEqual([]);
  });

  it("rewrites defineEntity's indexes, hooks and relations into a schema's callbacks", () => {
    const { text } = codemod(/*ts*/ `
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
    expect(text).toContain('beforeInsert: [(post) => {}],');
    expect(text).toContain('tags: () => rel.manyToMany(Tag, { mappedBy: (tag) => tag.posts }),');
    expect(text).toContain(
      'tag: () => rel.manyToOne(Tag, { references: (post, tag) => [{ local: post.tagId, foreign: tag.id }] }),',
    );
  });

  it('names the callbacks of a class written inline after the class, as a declared one', () => {
    const { text } = codemod(/*ts*/ `
      defineEntity(class Post { id?: number; title?: string; }, { indexes: [{ columns: ['title'] }] });
    `);

    expect(text).toContain('indexes: [{ columns: (post) => [post.title] }]');
  });

  it("leaves defineEntity's indexes, relations and fields it cannot read or find as written", () => {
    const body = `
      declare const shared: object;
      declare const key: string;
      class Tag { id?: number; }
      class Post { id?: number; title?: string; tag?: Tag; }
      defineEntity(Post, {
        fields: { [key]: { type: String }, gone: { type: String } },
        indexes: [shared],
        relations: { tag: shared },
      });
    `;
    const { text, unresolved } = codemod(body);

    expect(text).toBe(`${STUBS}${body}`);
    expect(unresolved).toEqual([expect.stringContaining('a relation could not be read')]);
  });

  it('names the callback parameter entity where a relation has no entity getter', () => {
    const { text } = codemod(/*ts*/ `
      class Comment { id?: number; post?: Post; }
      class Post { id?: number; comments?: Comment[]; }
      defineRelation(Post, 'comments', { cardinality: '1m', mappedBy: 'post' });
    `);

    expect(text).toContain(
      "defineRelation(Post, 'comments', { cardinality: '1m', mappedBy: (entity) => entity.post });",
    );
  });

  it('keeps the formatting of a column list it rewrites', () => {
    const { text } = codemod(/*ts*/ `
      @Entity()
      @Index([
        'title', // the lookup
        { column: 'slug',   order: 'desc' },
      ])
      class Post { id?: number; title?: string; slug?: string; }
    `);

    expect(text).toContain(`{ columns: (post) => [
        post.title, // the lookup
        { column: post.slug,   order: 'desc' },
      ] }`);
  });

  it('rewrites the incremental defineIndex and defineRelation the same way', () => {
    const { text } = codemod(/*ts*/ `
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

  it('reports the members and base @Entity no longer takes, saying where each goes', () => {
    const { unresolved } = codemod(/*ts*/ `
      class Base { id?: number; }
      @Entity({ fields: { id: { type: Number, isId: true } }, extends: Base })
      class Post { id?: number; }
    `);

    expect(unresolved).toEqual([
      expect.stringContaining("@Entity takes no 'fields' now: declare each with @Field or @Id"),
      expect.stringContaining("@Entity takes no 'extends' now: extend the base class itself"),
    ]);
  });

  it("rewrites @Entity's indexes, hooks and relations like defineEntity's", () => {
    const { text } = codemod(/*ts*/ `
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
    const { text, unresolved } = codemod(/*ts*/ `
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
    const { text, unresolved } = codemod(/*ts*/ `
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

  it('rewrites $exclude as a $select leaving its fields out', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      declare const querier: { findMany(entity: unknown, q: unknown): void };
      class User { id?: number; name?: string; email?: string; }
      querier.findMany(User, { $exclude: { name: true, email: 1 }, $populate: { posts: { $exclude: { body: true } } } });
    `);

    expect(text).toContain(
      'querier.findMany(User, { $select: { name: false, email: false }, $populate: { posts: { $select: { body: false } } } });',
    );
    expect(unresolved).toEqual([]);
  });

  it('reports an $exclude it cannot read, and an $exclude beside a $select', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      declare const querier: { findMany(entity: unknown, q: unknown): void };
      declare const hidden: { name: true };
      class User { id?: number; name?: string; email?: string; }
      querier.findMany(User, { $exclude: hidden });
      querier.findMany(User, { $select: { name: false }, $exclude: { email: true } });
    `);

    expect(text).toContain('{ $exclude: hidden }');
    expect(unresolved).toEqual([
      expect.stringContaining("write '$exclude' as `$select: { field: false }`"),
      expect.stringContaining("merge '$exclude' into the '$select' beside it, each field as `field: false`"),
    ]);
  });

  it("rewrites $text's $fields into a key map, reporting a list it cannot read", () => {
    const { text, unresolved } = codemod(/*ts*/ `
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

  it('leaves a Relation<T> property as written, and reports the import the codemod cannot drop', () => {
    const { text, unresolved } = codemodFile(`import { ManyToOne, type Relation } from 'uql-orm';
class Company { id?: number; }
class Entity {
  @ManyToOne({ entity: () => Company, references: (item) => item.companyId }) company?: Relation<Company>;
}
`);

    expect(text).toContain('company?: Relation<Company>;');
    expect(text).toContain("import { ManyToOne, type Relation } from 'uql-orm';");
    expect(unresolved).toEqual([expect.stringContaining(RELATION_IMPORT)]);
  });

  it('drops declare from a decorated field, which the standard spec cannot decorate', () => {
    const { text } = codemod(/*ts*/ `
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
    const { text, changed, unresolved } = codemod(/*ts*/ `
      const shared: FieldOptions = { name: 'renamed' };
      class Entity {
        @Field(shared) title?: string;
      }
    `);

    expect(text).toContain('@Field(shared) title?: string;');
    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("its options are passed as 'shared'");
  });

  /** There is no argument list to write into, and it used to be read as an empty one and crash. */
  it('refuses to rewrite a decorator that is never called', () => {
    const { text, changed, unresolved } = codemod(/*ts*/ `
      class Entity {
        @Field title?: string;
      }
    `);

    expect(text).toContain('@Field title?: string;');
    expect(changed).toBe(false);
    expect(unresolved[0]).toContain('it is used without being called');
  });

  /** A spread may already carry the option, and would override an insertion placed before it. */
  it('refuses to rewrite an options object that spreads another', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      const base = { name: 'renamed' };
      class Entity {
        @Field({ ...base }) title?: string;
      }
    `);

    expect(text).toContain('@Field({ ...base }) title?: string;');
    expect(unresolved[0]).toContain('its options object spreads another');
  });

  /** The polyfill is harmless, so the codemod leaves it in place rather than deciding it is unused. */
  it('keeps the reflect-metadata import, which is harmless, and the rest of the imports', () => {
    const { text, changed } = codemodFile(`import 'reflect-metadata';
import { Transactional, InjectQuerier, type Querier } from 'uql-orm';

class Service {
  @Transactional()
  async save(@InjectQuerier() querier?: Querier) {
    await querier!.insertOne({}, {});
  }
}
`);

    expect(text).toContain(
      "import 'reflect-metadata';\nimport { Transactional, InjectQuerier, type Querier } from 'uql-orm';",
    );
    expect(changed).toBe(false);
  });

  /** Dropping the import alone would leave the property naming a type it no longer has, so it is reported. */
  it('reports the Relation import and keeps it, with the rest of the file', () => {
    const { text, unresolved } = codemodFile(`import { Field, ManyToOne, type Relation } from 'uql-orm';

class Item {
  @ManyToOne({ entity: () => Item, references: (item) => item.parentId }) parent?: Relation<Item>;
}
`);

    expect(text).toContain("import { Field, ManyToOne, type Relation } from 'uql-orm';");
    expect(unresolved).toEqual([expect.stringContaining(RELATION_IMPORT)]);
  });

  it('reports the Relation import even when no property uses it', () => {
    const { unresolved } = codemodFile(`import { type Relation } from 'uql-orm';
export const one = 1;
`);

    expect(unresolved).toEqual([expect.stringContaining(RELATION_IMPORT)]);
  });

  it('reports an export that no longer exists rather than rewriting the call', () => {
    const { text, changed, unresolved } = codemod(/*ts*/ `
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
    const { changed, unresolved } = codemod(/*ts*/ `
      import { QueryWhereFieldMap, augmentWhere, buildQueryWhereAsMap } from 'uql-orm';
    `);

    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("'QueryWhereFieldMap' was removed; use `QueryWhere`");
    expect(unresolved[1]).toContain("'augmentWhere' was removed; spread the two maps");
    expect(unresolved[2]).toContain("'buildQueryWhereAsMap' was removed; a `$where` is a map already");
  });

  /** Nothing to rewrite and nothing to report: the name is only gone from the package. */
  it('drops a col import nothing uses', () => {
    const { text, unresolved } = codemodFile(`import { col, raw } from 'uql-orm';
export const one = raw\`1\`;
`);

    expect(text).toContain("import { sql } from 'uql-orm';");
    expect(unresolved).toEqual([]);
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

  it('renames FilterCondition to FilterWhere', () => {
    const { text } = codemodFile(`import { type FilterCondition } from 'uql-orm';
const where: FilterCondition<Post> = {};
`);

    expect(text).toBe(`import { type FilterWhere } from 'uql-orm';
const where: FilterWhere<Post> = {};
`);
  });

  it('renames a renamed export beside a Relation import, which it reports and keeps', () => {
    const { text, unresolved } = codemodFile(`import { ManyToOne, QueryWhereMap, type Relation } from 'uql-orm';
class Item {
  @ManyToOne({ entity: () => Item, references: (item) => item.parentId }) parent?: Relation<Item>;
}
const where: QueryWhereMap<Item> = {};
`);

    expect(text).toBe(`import { ManyToOne, QueryWhere, type Relation } from 'uql-orm';
class Item {
  @ManyToOne({ entity: () => Item, references: (item) => item.parentId }) parent?: Relation<Item>;
}
const where: QueryWhere<Item> = {};
`);
    expect(unresolved).toEqual([expect.stringContaining(RELATION_IMPORT)]);
  });

  it('renames a removed driver class to the one its entry exports', () => {
    const { text, unresolved } = codemodFile(`import { PgDialect, PgQuerierPool } from 'uql-orm/postgres';
const dialect: PgDialect = new PgDialect();
`);

    expect(text).toBe(`import { PostgresDialect, PgQuerierPool } from 'uql-orm/postgres';
const dialect: PostgresDialect = new PostgresDialect();
`);
    expect(unresolved).toEqual([]);
  });

  it('moves a removed driver class to the entry that exports its replacement, once', () => {
    const { text } = codemodFile(`import { NeonQuerierPool, NeonDialect, NeonQuerier } from 'uql-orm/neon';
import type { PgliteDialect } from 'uql-orm/pglite';
let a: NeonDialect; let b: NeonQuerier; let c: PgliteDialect;
`);

    expect(text).toBe(`import { NeonQuerierPool } from 'uql-orm/neon';
import { PostgresDialect, PgQuerier } from 'uql-orm/postgres';
let a: PostgresDialect; let b: PgQuerier; let c: PostgresDialect;
`);
  });

  it('reports AbstractPgQuerier, whose replacement is concrete', () => {
    const { changed, unresolved } = codemod(/*ts*/ `
      import { AbstractPgQuerier } from 'uql-orm/postgres';
    `);

    expect(changed).toBe(false);
    expect(unresolved[0]).toContain("'AbstractPgQuerier' was removed; every pg-compatible pool returns `PgQuerier`");
  });

  it('moves the embedded Turso querier to SqliteQuerier, which serves every driver that prepares', () => {
    const { text, unresolved } =
      codemodFile(`import { TursoDatabase, TursoLocalQuerier, TursoLocalQuerierPool } from 'uql-orm/turso/local';
let q: TursoLocalQuerier; let db: TursoDatabase;
`);

    expect(text).toBe(`import { TursoLocalQuerierPool } from 'uql-orm/turso/local';
import { SqliteDatabase, SqliteQuerier } from 'uql-orm/sqlite';
let q: SqliteQuerier; let db: SqliteDatabase;
`);
    expect(unresolved).toEqual([]);
  });

  it('reports the SQLite bases folded into their drivers', () => {
    const { changed, unresolved } = codemod(/*ts*/ `
      import { AbstractHranaQuerierPool, PreparedSqliteQuerier, toSqliteBindValues } from 'uql-orm/sqlite';
      import { libsqlUseRemoteForMigrations } from 'uql-orm/libsql';
    `);

    expect(changed).toBe(false);
    expect(unresolved).toEqual([
      expect.stringContaining("'AbstractHranaQuerierPool' was removed"),
      expect.stringContaining("'PreparedSqliteQuerier' was removed"),
      expect.stringContaining("'toSqliteBindValues' was removed"),
      expect.stringContaining("'libsqlUseRemoteForMigrations' was removed"),
    ]);
  });

  it('renames the dialect and D1 types to the one each duplicated', () => {
    const { text, unresolved } =
      codemodFile(`import type { EngineFeatures, KnownMigratorDialect, QueryDialect } from 'uql-orm';
import { type D1Database, type D1Preparer, D1QuerierPool } from 'uql-orm/d1';
let a: QueryDialect; let b: KnownMigratorDialect; let c: D1Preparer; let d: EngineFeatures; let e: D1Database;
`);

    expect(text).toBe(`import type { DialectFeatures, DialectName, SqlQueryDialect } from 'uql-orm';
import { type D1Queryable, D1QuerierPool } from 'uql-orm/d1';
let a: SqlQueryDialect; let b: DialectName; let c: D1Queryable; let d: DialectFeatures; let e: D1Queryable;
`);
    expect(unresolved).toEqual([]);
  });

  it('moves the MongoDB migration exports to uql-orm/mongodb', () => {
    const { text, unresolved } =
      codemodFile(`import { defineMigration, type MongoQuerier, MongoSchemaIntrospector } from 'uql-orm/migrate';
import { isMongoQuerier } from 'uql-orm';
let a: MongoQuerier; let b = [MongoSchemaIntrospector, isMongoQuerier, defineMigration];
`);

    expect(text).toBe(`import { defineMigration } from 'uql-orm/migrate';
import { type MongoQuerier, MongoSchemaIntrospector } from 'uql-orm/mongodb';
import { isMongoQuerier } from 'uql-orm/mongodb';
let a: MongoQuerier; let b = [MongoSchemaIntrospector, isMongoQuerier, defineMigration];
`);
    expect(unresolved).toEqual([]);
  });

  it('leaves an import already from the entry its export moved to', () => {
    const { changed } = codemodFile(`import type { MongoQuerier } from 'uql-orm/mongodb';
let a: MongoQuerier;
`);

    expect(changed).toBe(false);
  });

  it('moves an import off a renamed entry', () => {
    const { text, unresolved } = codemodFile(`import { MariadbQuerierPool } from 'uql-orm/maria';
import { MongodbQuerierPool } from "uql-orm/mongo";
import { BunSqlQuerierPool } from 'uql-orm/bunSql';
`);

    expect(text).toBe(`import { MariadbQuerierPool } from 'uql-orm/mariadb';
import { MongodbQuerierPool } from "uql-orm/mongodb";
import { BunSqlQuerierPool } from 'uql-orm/bun-sql';
`);
    expect(unresolved).toEqual([]);
  });

  it('moves an import off an entry the root repeated to the root', () => {
    const { text } = codemodFile(`import type { Query } from 'uql-orm/type';
import { SnakeCaseNamingStrategy } from 'uql-orm/namingStrategy';
let q: Query<object>; let n = SnakeCaseNamingStrategy;
`);

    expect(text).toBe(`import type { Query } from 'uql-orm';
import { SnakeCaseNamingStrategy } from 'uql-orm';
let q: Query<object>; let n = SnakeCaseNamingStrategy;
`);
  });

  it("renames /http's hook types and the lock error, leaving the entity HookContext alone", () => {
    const { text } = codemodFile(`import type { Hook, HookContext } from 'uql-orm/http';
import { type HookContext as EntityHookContext, UqlLockUsageError } from 'uql-orm';
let a: Hook; let b: HookContext<object>; let c: EntityHookContext; let d = UqlLockUsageError;
`);

    expect(text).toBe(`import type { RequestHook, RequestHookContext } from 'uql-orm/http';
import { type HookContext as EntityHookContext, UqlUsageError } from 'uql-orm';
let a: RequestHook; let b: RequestHookContext<object>; let c: EntityHookContext; let d = UqlUsageError;
`);
  });

  it('writes a literal statement to a querier as a tagged call, which needs no import', () => {
    const { text, unresolved } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
export const up = (q: SqlQuerier) => [q.run('CREATE TABLE "a" (b INT)'), q.all<{ n: number }>(\`SELECT 1\`)];
`,
      UQL_ORM_0_99,
    );

    expect(text).toBe(`import type { SqlQuerier } from 'uql-orm';
export const up = (q: SqlQuerier) => [q.run\`CREATE TABLE "a" (b INT)\`, q.all<{ n: number }>\`SELECT 1\`];
`);
    expect(unresolved).toEqual([]);
  });

  it('does not bind a placeholder used twice by evaluating its value twice', () => {
    const { text } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
export const up = (q: SqlQuerier) => q.run('select $1 + $1', [next()]);
`,
      UQL_ORM_0_99,
    );

    expect(text).toContain("q.run('select $1 + $1', [next()]);");
  });

  it('imports a value a rewrite needs as a value, beside a type-only import it cannot join', () => {
    const { text } = codemodFile(
      `import type { IMigrationBuilder, IForeignKeyBuilder } from 'uql-orm';
import { expr } from 'uql-orm';
export const up = (m: IMigrationBuilder) => [m.raw(expr.raw('x')), m.foreignKey(IForeignKeyBuilder)];
`,
      UQL_ORM_0_99,
    );

    expect(text).toContain("import { sql } from 'uql-orm';");
    expect(text).not.toContain('import type { sql');
  });

  it('renames an export a statement names in its type argument, as it renames it everywhere else', () => {
    const { text } = codemodFile(
      `import type { SqlQuerier, IForeignKeyBuilder } from 'uql-orm';
export const up = (q: SqlQuerier) => [q.all<IForeignKeyBuilder>(\`SELECT 1\`), q.all<IForeignKeyBuilder>('SELECT 2')];
`,
      UQL_ORM_0_99,
    );

    expect(text).toBe(`import type { SqlQuerier, ForeignKeyBuilder } from 'uql-orm';
export const up = (q: SqlQuerier) => [q.all<ForeignKeyBuilder>\`SELECT 1\`, q.all<ForeignKeyBuilder>\`SELECT 2\`];
`);
  });

  it('keeps every type argument a statement is called with, renamed where it names an export', () => {
    const { text } = codemodFile(
      `import type { SqlQuerier, IForeignKeyBuilder } from 'uql-orm';
export const up = (q: SqlQuerier) => q.all<IForeignKeyBuilder, { n: number }>(\`SELECT 1\`);
`,
      UQL_ORM_0_99,
    );

    expect(text).toBe(`import type { SqlQuerier, ForeignKeyBuilder } from 'uql-orm';
export const up = (q: SqlQuerier) => q.all<ForeignKeyBuilder, { n: number }>\`SELECT 1\`;
`);
  });

  it('wraps SQL built at run time in sql.text, which still splices it, and says so for a template', () => {
    const { text, notes } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
export const f = (q: SqlQuerier, text: string, t: string) => [q.all(text), q.run(\`DROP TABLE \${t}\`)];
`,
      UQL_ORM_0_99,
    );

    expect(text).toBe(`import { sql } from 'uql-orm';
import type { SqlQuerier } from 'uql-orm';
export const f = (q: SqlQuerier, text: string, t: string) => [q.all(sql.text(text)), q.run(sql.text(\`DROP TABLE \${t}\`))];
`);
    expect(notes).toEqual([
      '/entities.ts:2: the values in this template are spliced into the SQL; write it as sql`...` to bind them',
    ]);
  });

  it('leaves a run() with no statement, or one that is no string', () => {
    const { changed } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
declare const statement: object;
export const f = (q: SqlQuerier) => [q.all(), q.run(statement)];
`,
      UQL_ORM_0_99,
    );

    expect(changed).toBe(false);
  });

  it('reports a statement passed with values it cannot read, and leaves a run() that is not a querier', () => {
    const { text, unresolved, changed } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
declare const job: { run(name: string): void };
export const f = (q: SqlQuerier, values: number[]) => [q.run('DELETE FROM a WHERE id = $1', values), job.run('x')];
`,
      UQL_ORM_0_99,
    );

    expect(changed).toBe(false);
    expect(text).toContain("job.run('x')");
    expect(unresolved).toEqual([
      '/entities.ts:3: run() takes one statement: write the values into it, sql`... ${value}`, which binds them',
    ]);
  });

  it('writes a statement passed with ? placeholders as a tag interpolating each value', () => {
    const { text, unresolved } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
export const f = (q: SqlQuerier, user: { id: number }, ids: number[]) =>
  q.run("UPDATE \`a\` SET b = '\${x}', c = 'it''s' WHERE id = ? AND d = ?", [user.id, ids[0]]);
`,
      UQL_ORM_0_99,
    );

    expect(text).toBe(`import type { SqlQuerier } from 'uql-orm';
export const f = (q: SqlQuerier, user: { id: number }, ids: number[]) =>
  q.run\`UPDATE \\\`a\\\` SET b = '\\\${x}', c = 'it''s' WHERE id = \${user.id} AND d = \${ids[0]}\`;
`);
    expect(unresolved).toEqual([]);
  });

  it('writes a statement passed with $n placeholders as a tag, a repeated one repeating its value', () => {
    const { text, unresolved } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
export const f = (q: SqlQuerier, a: number, b: number) => [
  q.all<{ n: number }>('SELECT $1::int AS a, $2 AS b WHERE x = $1', [a, b + 1]),
  q.all('SELECT 1', []),
];
`,
      UQL_ORM_0_99,
    );

    expect(text).toBe(`import type { SqlQuerier } from 'uql-orm';
export const f = (q: SqlQuerier, a: number, b: number) => [
  q.all<{ n: number }>\`SELECT \${a}::int AS a, \${b + 1} AS b WHERE x = \${a}\`,
  q.all\`SELECT 1\`,
];
`);
    expect(unresolved).toEqual([]);
  });

  it('reports a statement whose values it cannot place for certain', () => {
    const { changed, unresolved } = codemodFile(
      `import type { SqlQuerier } from 'uql-orm';
declare const extra: unknown;
export const f = (q: SqlQuerier, id: number, ids: number[], text: string) => [
  q.run('DELETE FROM a WHERE id = ? OR id = ?', [id]),
  q.run('DELETE FROM a WHERE id = $1', [id, id]),
  q.run('DELETE FROM a WHERE id = $2', [id]),
  q.run('DELETE FROM a WHERE id IN (?, ?)', [...ids]),
  q.run('DELETE FROM a WHERE id IN (?, ?)', [id, , id]),
  q.run('DELETE FROM a WHERE id = ?', [id], extra),
  q.run("UPDATE a SET b = '?' WHERE id = ?", [id]),
  q.run('SELECT "a?" FROM a WHERE id = ?', [id]),
  q.run('DELETE FROM a WHERE id = ? -- or ?', [id]),
  q.run('DELETE FROM a WHERE id = ? /* or $1 */', [id]),
  q.run('DELETE FROM a WHERE id = ? OR id = $1', [id]),
  q.run("UPDATE a SET b = 'it\\\\'s' WHERE id = ?", [id]),
  q.run('DO $body$ SELECT ? $body$', [id]),
  q.run('DELETE FROM a WHERE id = $0', [id]),
  q.run(text, [id]),
  q.run('DELETE FROM a', ids),
];
`,
      UQL_ORM_0_99,
    );

    const report = (line: number) =>
      `/entities.ts:${line}: run() takes one statement: write the values into it, sql\`... \${value}\`, which binds them`;
    expect(changed).toBe(false);
    expect(unresolved).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(report));
  });

  it('reports the Migrator calls whose name or meaning changed', () => {
    const { unresolved, notes } = codemodFile(
      `import { Migrator } from 'uql-orm';
declare const m: Migrator;
export const f = async () => [await m.pending(), await m.executed(), await m.down(), await m.down({ step: 2 })];
`,
      UQL_ORM_0_99,
    );

    expect(unresolved).toEqual([
      "/entities.ts:3: 'pending()' was removed; read `(await migrator.status()).pending`",
      "/entities.ts:3: 'executed()' was removed; read `(await migrator.status()).executed`",
    ]);
    expect(notes).toEqual([
      '/entities.ts:3: down() with no options reverts only the last migration now; pass `{ step: Infinity }` to revert them all',
    ]);
  });

  it("renames the migration builder's column types, leaving the root's to `f`", () => {
    const { text } = codemodFile(`import type { ColumnBuilder, IColumnFactory } from 'uql-orm/migrate';
import type { ColumnBuilder as FieldColumn } from 'uql-orm';
let b: ColumnBuilder; let c: IColumnFactory; let f: FieldColumn<object, string, 'string'>;
`);

    expect(text).toBe(`import type { TableColumnBuilder, TableColumnFactory } from 'uql-orm/migrate';
import type { ColumnBuilder as FieldColumn } from 'uql-orm';
let b: TableColumnBuilder; let c: TableColumnFactory; let f: FieldColumn<object, string, 'string'>;
`);
  });

  it('renames the SQLite pool and the migration builder types', () => {
    const { text } = codemodFile(`import { Sqlite3QuerierPool } from 'uql-orm/sqlite';
import type { IMigrationBuilder, ITableBuilder } from 'uql-orm/migrate';
const pool = new Sqlite3QuerierPool();
let m: IMigrationBuilder; let t: ITableBuilder;
`);

    expect(text).toBe(`import { SqliteQuerierPool } from 'uql-orm/sqlite';
import type { MigrationBuilder, TableBuilder } from 'uql-orm/migrate';
const pool = new SqliteQuerierPool();
let m: MigrationBuilder; let t: TableBuilder;
`);
  });

  it('reports an internal the root no longer exports, and every import from uql-orm/util', () => {
    const { unresolved } = codemodFile(`import { AbstractSqlQuerier, Entity, fieldOf } from 'uql-orm';
import { hasKeys } from 'uql-orm/util';
`);

    expect(unresolved).toEqual([
      "/entities.ts:1: 'AbstractSqlQuerier' is internal; extend a driver's querier or pool from its entry instead",
      "/entities.ts:1: 'fieldOf' is internal; read the field off `getMeta(Entity).fields`",
      "/entities.ts:2: 'uql-orm/util' was removed; its helpers are internal, so write your own `hasKeys`",
    ]);
  });

  it('moves what the root still exports out of uql-orm/util, and reports the rest', () => {
    const { text, unresolved } = codemodFile(`import { hasKeys, raw } from 'uql-orm/util';
import { refs } from 'uql-orm/util';
raw\`now()\`;
`);

    expect(text).toBe(`import { hasKeys } from 'uql-orm/util';
import { sql } from 'uql-orm';
import { refs } from 'uql-orm';
sql\`now()\`;
`);
    expect(unresolved).toEqual([
      "/entities.ts:1: 'uql-orm/util' was removed; its helpers are internal, so write your own `hasKeys`",
    ]);
  });

  it('reports an internal imported from an entry that moved to the root', () => {
    const { unresolved } = codemodFile(`import { AbstractSqlDialect } from 'uql-orm/dialect';
import { getEntities } from 'uql-orm/entity';
`);

    expect(unresolved).toEqual([
      expect.stringContaining("'AbstractSqlDialect' is internal"),
      expect.stringContaining("'getEntities' is internal"),
    ]);
  });

  it('reports the migration storages, which the migrator owns', () => {
    const { unresolved } =
      codemodFile(`import { JsonMigrationStorage, DatabaseMigrationStorage } from 'uql-orm/migrate';
import { MongoMigrationStorage } from 'uql-orm/mongo';
`);

    expect(unresolved).toEqual([
      expect.stringContaining("'JsonMigrationStorage' was removed"),
      expect.stringContaining("'DatabaseMigrationStorage' was removed"),
      expect.stringContaining("'MongoMigrationStorage' was removed"),
    ]);
  });

  it('reports the dialect, pool, migrator and D1 exports that repeated another or always held', () => {
    const { changed, unresolved } = codemod(/*ts*/ `
      import { isKnownMigratorDialect, MysqlLikeSqlDialect, QuerierPoolDialect, QuerierPoolQuerier } from 'uql-orm';
      import { POSTGRES_WIRE_DRIVER_CAPABILITIES } from 'uql-orm/postgres';
      import type { D1ExecResult, D1Meta } from 'uql-orm/d1';
      import { createSchemaGenerator } from 'uql-orm/migrate';
    `);

    expect(changed).toBe(false);
    expect(unresolved).toEqual([
      expect.stringContaining("'isKnownMigratorDialect' was removed"),
      expect.stringContaining("'MysqlLikeSqlDialect' was removed"),
      expect.stringContaining("'QuerierPoolDialect' was removed"),
      expect.stringContaining("'QuerierPoolQuerier' was removed"),
      expect.stringContaining("'POSTGRES_WIRE_DRIVER_CAPABILITIES' was removed"),
      expect.stringContaining("'D1ExecResult' was removed"),
      expect.stringContaining("'D1Meta' was removed"),
      expect.stringContaining("'createSchemaGenerator' was removed"),
    ]);
  });

  it('renames the migration module builders to their querier-neutral names', () => {
    const { text, unresolved } =
      codemodFile(`import { buildSqlQuerierMigrationModule, SqlMigrationModuleOptions } from 'uql-orm/migrate';
declare const options: SqlMigrationModuleOptions;
buildSqlQuerierMigrationModule(options);
`);

    expect(text).toBe(`import { buildMigrationModule, MigrationModuleOptions } from 'uql-orm/migrate';
declare const options: MigrationModuleOptions;
buildMigrationModule(options);
`);
    expect(unresolved).toEqual([]);
  });

  it('reports the index types an index reading its refs no longer has, and renames the ones it renamed', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      import { IndexColumnOptions, SqlCallback, EntityIndexColumn, IndexJsonPath, IndexJsonArray } from 'uql-orm';
      import type { IndexColumnSchema, IndexColumnModifiers } from 'uql-orm';
      export type Entry = IndexColumnSchema & IndexColumnModifiers;
    `);

    expect(text).toContain("import type { IndexEntry, IndexEntryModifiers } from 'uql-orm';");
    expect(text).toContain('export type Entry = IndexEntry & IndexEntryModifiers;');
    expect(unresolved).toEqual([
      expect.stringContaining("'IndexColumnOptions' was removed; an entity's index entry is `EntityIndexColumnInput`"),
      expect.stringContaining("'SqlCallback' was removed; use `EntitySql<E>`"),
      expect.stringContaining("'EntityIndexColumn' was removed; an entity's index entry is `EntityIndexColumnInput`"),
      expect.stringContaining(
        "'IndexJsonPath' was removed; read the path off the column's ref: `{ column: post.meta.lang, type: Number }`",
      ),
      expect.stringContaining(
        "'IndexJsonArray' was removed; give the elements' type: `{ column: post.tags, type: [String] }`",
      ),
    ]);
  });

  it('reports a decorator that no longer exists rather than removing it', () => {
    const { text, changed, unresolved } = codemod(/*ts*/ `
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
    const { text, changed, unresolved } = codemod(/*ts*/ `
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
    const { unresolved, changed } = codemod(/*ts*/ `
      class Entity {
        @Field() payload?: { nested: true };
      }
    `);

    expect(changed).toBe(true);
    expect(unresolved).toEqual([expect.stringContaining(NO_TYPE)]);
  });

  it('reports a relation with no entity whatever its property holds', () => {
    const { unresolved } = codemod(/*ts*/ `
      class Entity {
        @ManyToOne() broken?: number;
      }
    `);

    expect(unresolved).toEqual([expect.stringContaining(NO_ENTITY)]);
  });
});

describe('a nullable column admits null', () => {
  it("adds '| null' to every property whose column can hold one", () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) name?: string;
        @Field({ references: () => Entity }) parentId?: string;
        @Field({ type: String, nullable: false }) email?: string;
        @Field({ type: String, nullable: true }) loud?: string;
        @Field({ type: String }) already?: string | null;
        @Field({ type: Number }) tags?: number[];
      }
    `);

    // A key is NOT NULL on every engine, and one that says `nullable: false` already declared it.
    expect(text).toContain('@Id({ type: Number }) id?: number;');
    expect(text).toContain('@Field({ type: String, nullable: false }) email?: string;');
    expect(text).toContain('@Field({ type: String }) already?: string | null;');

    expect(text).toContain('@Field({ type: String }) name?: string | null;');
    // `nullable: true` is the default said out loud, so it is a column that holds one like any other.
    expect(text).toContain('@Field({ type: String, nullable: true }) loud?: string | null;');
    expect(text).toContain('@Field({ references: () => Entity }) parentId?: string | null;');
    expect(text).toContain('@Field({ type: Number }) tags?: number[] | null;');
  });

  it('reports a property it cannot read the type of, rather than guessing', () => {
    const { text, notes } = codemod(/*ts*/ `
      class Entity {
        @Field({ type: String }) name = 'x';
      }
    `);

    expect(text).toContain("@Field({ type: String }) name = 'x';");
    expect(notes.join('\n')).toContain("declare 'name' as");
  });

  it('leaves a relation aggregate alone, since the aggregate types it', () => {
    const { text } = codemod(/*ts*/ `
      class Entity {
        @Field({ computed: (entity: any) => entity.children.count() }) readonly childCount?: number;
      }
    `);

    expect(text).toContain('readonly childCount?: number;');
  });
});

describe('SQL in definitions', () => {
  it('rewrites a raw() call in a column list together with the list', () => {
    const { text } = codemodFile(`import { Index, raw } from 'uql-orm';
@Index(['title', raw('lower("title")'), { column: raw\`upper("title")\` }])
class Post { id?: number; title?: string; }
`);

    expect(text).toContain(
      '@Entity({ abstract: true, indexes: [{ columns: (post) => [post.title, sql`lower("title")`, { column: sql`upper("title")` }] }] })',
    );
  });

  it('writes a partial-index where given as a string as raw, importing raw', () => {
    const { text, unresolved } = codemodFile(`import { Entity, Index, defineIndex } from 'uql-orm';
@Index((post) => [post.slug], { where: '"deletedAt" IS NULL' })
@Entity({ indexes: [{ columns: (post) => [post.title], where: \`"deletedAt" IS NULL\` }] })
class Post { id?: number; title?: string; slug?: string; deletedAt?: Date; }
defineIndex(Post, { columns: (post) => [post.title], where: "status = 'live'" });
`);

    expect(text).toContain("import { sql, Entity, defineIndex } from 'uql-orm';");
    expect(text).toContain(
      '@Entity({ indexes: [{ columns: (post) => [post.title], where: sql`"deletedAt" IS NULL` }, { columns: (post) => [post.slug], where: sql`"deletedAt" IS NULL` }] })',
    );
    expect(text).toContain("defineIndex(Post, { columns: (post) => [post.title], where: sql`status = 'live'` });");
    expect(unresolved).toEqual([expect.stringContaining('defineIndex was removed')]);
  });

  /** A template that interpolates spliced its value in as SQL, which `raw` would bind instead. */
  it('reports a partial-index where it cannot write as raw', () => {
    const { text, unresolved } = codemodFile(`import { Index, raw } from 'uql-orm';
declare const minimum: number;
declare const predicate: string;
declare const either: '"a" IS NULL' | '"b" IS NULL';
@Index((post) => [post.slug], { where: \`"stock" > \${minimum}\` })
@Index((post) => [post.title], { where: predicate })
@Index((post) => [post.id], { where: raw\`"stock" > 0\` })
@Index((post) => [post.stock], { where: either })
class Post { id?: number; title?: string; slug?: string; stock?: number; }
`);

    expect(text).toContain('where: `"stock" > ${minimum}` }');
    expect(text).toContain('where: predicate }');
    expect(text).toContain('where: either }');
    expect(unresolved).toEqual([
      "/entities.ts:5: write the partial-index 'where' as sql`...` or a predicate; this one could not be read",
      "/entities.ts:6: write the partial-index 'where' as sql`...` or a predicate; this one could not be read",
      "/entities.ts:8: write the partial-index 'where' as sql`...` or a predicate; this one could not be read",
    ]);
  });

  it('reports the raw import it cannot add', () => {
    const { unresolved } = codemod(/*ts*/ `
      @Entity()
      @Index((post) => [post.slug], { where: '"deletedAt" IS NULL' })
      class Post { id?: number; slug?: string; deletedAt?: Date; }
    `);

    expect(unresolved).toEqual(["/entities.ts: import 'sql' from 'uql-orm' for the sql`...` written here"]);
  });

  it("rewrites the migration builder's partial-index where string as raw", () => {
    const { text } = codemodFile(`import { raw } from 'uql-orm';
import { defineBuilderMigration } from 'uql-orm/migrate';

export default defineBuilderMigration({
  async up(m) {
    await m.createTable('notes', (t) => {
      t.unique([raw\`lower("email")\`], { where: '"deleted_at" IS NULL' });
    });
    await m.createIndex('notes', ['slug'], { where: '"deleted_at" IS NULL' });
  },
});
`);

    expect(text).toContain('t.unique([sql`lower("email")`], { where: sql`"deleted_at" IS NULL` });');
    expect(text).toContain("m.createIndex('notes', ['slug'], { where: sql`\"deleted_at\" IS NULL` });");
  });

  it("renames a migration builder index entry's length to the length it states", () => {
    const { text } = codemodFile(`import { defineBuilderMigration } from 'uql-orm/migrate';

export default defineBuilderMigration({
  async up(m) {
    await m.createTable('notes', (t) => {
      t.index([{ column: 'body', length: 64 }, { column: 'meta', path: 'lang', length: 8 }]);
    });
    await m.createIndex('notes', [{ column: 'title', length: 32 }, { column: 'slug', order: 'desc' }]);
  },
});
`);

    expect(text).toContain(
      "t.index([{ column: 'body', prefixLength: 64 }, { column: 'meta', path: 'lang', charLength: 8 }]);",
    );
    expect(text).toContain(
      "m.createIndex('notes', [{ column: 'title', prefixLength: 32 }, { column: 'slug', order: 'desc' }]);",
    );
  });

  it("leaves the migration builder's index options alone where they are not a literal", () => {
    const body = `import { raw } from 'uql-orm';
declare const t: { index(columns: unknown[], options?: unknown): void };
declare const options: { where: string };
t.index([raw\`lower("email")\`], options);
`;
    const { text, unresolved } = codemodFile(body);

    expect(text).toBe(body.replaceAll('raw', 'sql'));
    expect(unresolved).toEqual([]);
  });

  it("rewrites the migration builder's expr defaults as the values entities use, dropping the import", () => {
    const { text, unresolved } = codemodFile(`import { raw } from 'uql-orm';
import { defineBuilderMigration, expr } from 'uql-orm/migrate';

export default defineBuilderMigration({
  async up(m) {
    await m.createTable('notes', (t) => {
      t.timestamp('at', { defaultValue: expr.now() });
      t.uuid('id', { defaultValue: expr.uuid() });
      t.uuid('ordered', { defaultValue: expr.uuidv7() });
      t.date('day', { defaultValue: expr.currentDate() });
      t.time('clock', { defaultValue: expr.currentTime() });
      t.bigint('seq', { defaultValue: expr.raw("nextval('s')") });
    });
  },
});
`);

    expect(text).toContain("import { currentTimestamp, uuid, uuidv7, currentDate, currentTime, sql } from 'uql-orm';");
    expect(text).toContain("import { defineBuilderMigration } from 'uql-orm/migrate';");
    expect(text).toContain("t.timestamp('at', { defaultValue: currentTimestamp });");
    expect(text).toContain("t.uuid('id', { defaultValue: uuid });");
    expect(text).toContain("t.uuid('ordered', { defaultValue: uuidv7 });");
    expect(text).toContain("t.date('day', { defaultValue: currentDate });");
    expect(text).toContain("t.time('clock', { defaultValue: currentTime });");
    expect(text).toContain("t.bigint('seq', { defaultValue: sql`nextval('s')` });");
    expect(unresolved).toEqual([]);
  });

  it('leaves an expr of the file its own alone, in a file importing uql-orm', () => {
    const body = `import { raw } from 'uql-orm';

const expr = { now: () => raw\`now()\` };
export const at = expr.now();
`;

    expect(codemodFile(body).text).toBe(body.replaceAll('raw', 'sql'));
  });

  it('reports an expr default it has no rewrite for, and keeps the import', () => {
    const { text, unresolved } = codemodFile(`import { raw } from 'uql-orm';
import { defineBuilderMigration, expr } from 'uql-orm/migrate';

export default defineBuilderMigration({
  async up(m) {
    await m.createTable('notes', (t) => {
      t.timestamp('touched', { defaultValue: expr.onUpdateNow() });
    });
  },
});
`);

    expect(text).toContain("import { defineBuilderMigration, expr } from 'uql-orm/migrate';");
    expect(unresolved).toEqual([
      '/entities.ts:7: expr.onUpdateNow() is gone: declare the column with m.raw(...), or use a stamp on the entity',
    ]);
  });

  it("passes an upsert's update itself, wherever the querier comes from", () => {
    const { text, unresolved } = codemodFile(`declare function upsertInto(...args: unknown[]): void;
declare const pool: { upsertOne(...args: unknown[]): void; upsertMany(...args: unknown[]): void };
declare const Tally: unknown;
const update = { hits: { $inc: 1 } };
pool.upsertOne(Tally, { sku: true }, { sku: 'a' }, { update: { hits: { $inc: 1 } } });
pool.upsertMany(Tally, { sku: true }, [{ sku: 'a' }], { update });
pool.upsertOne(Tally, { sku: true }, { sku: 'a' }, { update: {} });
upsertInto(Tally, { sku: true }, { sku: 'a' }, { 'update': update });
`);

    expect(text).toContain("pool.upsertOne(Tally, { sku: true }, { sku: 'a' }, { hits: { $inc: 1 } });");
    expect(text).toContain("pool.upsertMany(Tally, { sku: true }, [{ sku: 'a' }], update);");
    expect(text).toContain("pool.upsertOne(Tally, { sku: true }, { sku: 'a' }, {});");
    expect(text).toContain("upsertInto(Tally, { sku: true }, { sku: 'a' }, update);");
    expect(unresolved).toEqual([]);
  });

  it('leaves an upsert already passing its update alone, so a second run changes nothing', () => {
    const body = `declare const pool: { upsertOne(...args: unknown[]): void };
declare const Tally: unknown;
declare const update: object;
pool.upsertOne(Tally, { sku: true }, { sku: 'a' }, { hits: { $inc: 1 } });
pool.upsertOne(Tally, { sku: true }, { sku: 'a' }, update);
pool.upsertOne(Tally, { sku: true }, { sku: 'a' }, {});
`;
    const { text, unresolved } = codemodFile(body);

    expect(text).toBe(body);
    expect(unresolved).toEqual([]);
  });

  it('leaves a method of the same name alone in a file that does not import uql-orm', () => {
    const body = `declare const t: { index(columns: unknown[], options?: unknown): void };
declare function raw(strings: TemplateStringsArray): unknown;
t.index([raw\`lower("email")\`], { where: 'active' });
`;

    expect(codemodFile(body).text).toBe(body);
  });

  it("renames a check's expression and a filter's condition to where", () => {
    const { text, unresolved } = codemod(/*ts*/ `
      const condition = { status: 'live' };
      @Filter('live', { condition: { status: 'live' }, default: false })
      @Filter('shorthand', { condition })
      @Entity({
        checks: [{ name: 'positive', expression: raw\`1 = 1\` }],
        filters: { mine: { condition: () => ({ status: 'mine' }) } },
      })
      class Post { id?: number; status?: string; }
      defineFilter(Post, 'draft', { condition: { status: 'draft' } });
      defineFilter(Post, 'unwritten');
      defineEntity(Post, { checks: [{ expression: raw\`2 = 2\` }], filters: { all: { condition: {} } } });
    `);

    expect(text).toContain("checks: [{ name: 'positive', where: raw`1 = 1` }],");
    expect(text).toContain(
      "filters: { mine: { where: () => ({ status: 'mine' }) }, live: { where: { status: 'live' }, default: false }, shorthand: { where: condition } },",
    );
    expect(text).toContain("defineFilter(Post, 'draft', { where: { status: 'draft' } });");
    expect(text).toContain("defineFilter(Post, 'unwritten');");
    expect(text).toContain('defineEntity(Post, { checks: [{ where: raw`2 = 2` }], filters: { all: { where: {} } } });');
    expect(unresolved).toEqual([expect.stringContaining("'Post' is decorated as well")]);
  });

  it('reports a check giving both names rather than choosing one', () => {
    const { unresolved } = codemod(/*ts*/ `
      class Post { id?: number; }
      defineEntity(Post, { checks: [{ expression: raw\`1 = 1\`, where: raw\`2 = 2\` }] });
    `);

    expect(unresolved).toEqual([expect.stringContaining("gives both 'expression' and 'where'; keep 'where'")]);
  });

  it("renames virtual to computed in defineEntity's fields, as on @Field", () => {
    const { text } = codemod(/*ts*/ `
      class Line { id?: number; total?: number; }
      defineEntity(Line, { fields: { total: { type: Number, virtual: raw\`1 + 1\` } } });
    `);

    expect(text).toContain('total: { type: Number, computed: raw`1 + 1` },');
  });

  /** A string literal and a word called as a function are left out: `'gone'` is a value, `count(*)` a call. */
  it('notes SQL in a definition that names a column by hand, which a rename does not reach', () => {
    const { notes } = codemodFile(`import { raw } from 'uql-orm';
${STUBS}
      @Index(() => [raw\`lower("email")\`], { where: raw\`status <> 'gone'\` })
      @Entity({ checks: [{ expression: raw\`length(code) = 3 AND "code" <> 'status'\` }] })
      class User {
        id?: number; email?: string; status?: string; code?: string; count?: number;
        @Field({ type: Number, computed: raw\`count(*) + 1\` }) total?: number;
        @Field({ type: Number, computed: (user) => raw\`\${user.count} + 1\` }) next?: number;
      }
    `);

    expect(notes).toEqual([
      expect.stringMatching(/^\/entities\.ts:\d+: SQL names 'email' by hand, which a rename does not reach; /),
      expect.stringMatching(/^\/entities\.ts:\d+: SQL names 'status' by hand/),
      expect.stringMatching(/^\/entities\.ts:\d+: SQL names 'code' by hand/),
    ]);
    expect(notes[0]).toMatch(
      /; read each off a callback's refs instead: \(user\) => sql`\.\.\.\$\{user\.<member>\}\.\.\.`$/,
    );
  });

  it('reports a list of names holding an entry it cannot read', () => {
    const { text, unresolved } = codemod(/*ts*/ `
      declare const slug: 'slug';
      @Entity()
      @Index(['title', slug])
      class Post { id?: number; title?: string; slug?: string; }
    `);

    expect(text).toContain("{ columns: ['title', slug] }");
    expect(unresolved).toEqual([
      expect.stringContaining("write '@Index' columns as a callback; this one could not be read"),
    ]);
  });

  it('leaves a raw() call it cannot read alone, noting nothing', () => {
    const { text, notes } = codemodFile(`import { Field, raw } from 'uql-orm';
class Entity {
  @Field({ type: Number, computed: raw() }) score?: number;
  @Field({ type: Number, computed: raw('a', 'b', 'c') }) total?: number;
}
`);

    expect(text).toContain('computed: sql() })');
    expect(text).toContain("computed: sql('a', 'b', 'c') })");
    expect(notes).toEqual([]);
  });
});

describe('raw()', () => {
  const codemodRaw = (body: string) => codemodFile(`import { raw } from 'uql-orm';\n${body}`).text;

  it('rewrites a string expression into a tagged template', () => {
    expect(codemodRaw(`const a = raw('"salePrice" > "cost" * 2');`)).toContain(
      'const a = sql`"salePrice" > "cost" * 2`;',
    );
  });

  it('moves a second alias argument onto as()', () => {
    expect(codemodRaw(`const a = raw('LOG10(points)', 'score');`)).toContain(
      "const a = sql`LOG10(points)`.as('score');",
    );
  });

  it('moves the alias of a callback onto as()', () => {
    expect(codemodRaw(`const a = raw(({ ctx }) => ctx.append('x'), 'score');`)).toContain(
      "const a = sql(({ ctx }) => ctx.append('x')).as('score');",
    );
  });

  it('keeps a rewrite inside the alias argument of as()', () => {
    expect(codemodRaw(`const a = raw('LOG10(points)', raw('name'));`)).toContain(
      'const a = sql`LOG10(points)`.as(sql`name`);',
    );
  });

  it('escapes a backtick that would end the template', () => {
    expect(codemodRaw('const a = raw("`points` > 1");')).toContain('const a = sql`\\`points\\` > 1`;');
  });

  it('escapes a dollar-brace that would interpolate', () => {
    expect(codemodRaw(`const a = raw('cost > \${x}');`)).toContain('sql`cost > \\${x}`');
  });

  it('leaves the callback form alone', () => {
    const body = 'const a = raw(({ ctx }) => ctx.append("x"));';
    expect(codemodRaw(body)).toContain(body.replace('raw', 'sql'));
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

describe('raw to sql', () => {
  it('leaves a file naming sql itself alone, reporting it, since the tag it writes would be shadowed', () => {
    const body = `import { raw } from 'uql-orm';
const sql = 'SELECT 1';
export const a = raw\`1\`;
`;
    const { text, unresolved } = codemodFile(body);

    expect(text).toBe(body);
    expect(unresolved).toEqual([
      "/entities.ts:2: 'sql' is already named here, and the codemod writes it: rename that, then run again",
    ]);
  });

  it('renames a raw inside an upsert update, which the update is unwrapped from its options', () => {
    const { text } = codemodFile(`import { raw } from 'uql-orm';
declare const q: { upsertOne(entity: unknown, data: unknown, unique: unknown, options: unknown): void };
q.upsertOne(Item, { id: 1 }, ['id'], { update: { stock: raw\`1 + 1\` } });
`);

    expect(text).toContain("q.upsertOne(Item, { id: 1 }, ['id'], { stock: sql`1 + 1` });");
  });

  it('renames a raw inside a statement value, which the statement keeps as written', () => {
    const { text } = codemodFile(
      `import { raw, type SqlQuerier } from 'uql-orm';
export const f = (q: SqlQuerier) => q.run('SELECT $1', [raw\`1\`]);
`,
      UQL_ORM_0_99,
    );

    expect(text).toContain('q.run`SELECT ${sql`1`}`');
  });

  it('drops the raw import where the file already imports sql, renaming its uses to it', () => {
    const { text } = codemodFile(`import { raw, sql } from 'uql-orm';
export const a = raw\`1\`;
`);

    expect(text).toBe(`import { sql } from 'uql-orm';
export const a = sql\`1\`;
`);
  });

  it('leaves a file alone when it uses a sql no declaration binds, which the import would capture', () => {
    const body = `import { raw } from 'uql-orm';
export const a = raw\`1\`;
export const b = sql\`2\`;
`;
    const { text, unresolved } = codemodFile(body);

    expect(text).toBe(body);
    expect(unresolved).toEqual([
      "/entities.ts:3: 'sql' is already named here, and the codemod writes it: rename that, then run again",
    ]);
  });

  it('rewrites a raw imported under another name, keeping the name', () => {
    const { text } = codemodFile(`import { raw as r } from 'uql-orm';
export const a = r('1 + 1');
export const b = r\`2\`;
`);

    expect(text).toBe(`import { sql as r } from 'uql-orm';
export const a = r\`1 + 1\`;
export const b = r\`2\`;
`);
  });

  it('leaves a file alone when it names any name the codemod writes, not only sql', () => {
    const body = `import { expr } from 'uql-orm/migrate';
const currentTimestamp = 1;
declare const t: { timestamp(name: string, options: unknown): void };
t.timestamp('at', { defaultValue: expr.now() });
`;
    const { text, unresolved } = codemodFile(body);

    expect(text).toBe(body);
    expect(unresolved).toEqual([
      "/entities.ts:2: 'currentTimestamp' is already named here, and the codemod writes it: rename that, then run again",
    ]);
  });

  it('writes the tag it adds by the name the file imports the SQL tag as', () => {
    const { text } = codemodFile(`import { sql as q } from 'uql-orm';
${STUBS}
      @Entity()
      @Index((post) => [post.slug], { where: '"deletedAt" IS NULL' })
      class Post { id?: number; slug?: string; deletedAt?: Date; }
    `);

    expect(text).toContain('where: q`"deletedAt" IS NULL` }] })');
  });

  it('leaves a sql property name alone, which binds nothing', () => {
    const { text } = codemodFile(`import { raw } from 'uql-orm';
export const o = { sql: 1 };
export const a = raw\`1\`;
`);

    expect(text).toBe(`import { sql } from 'uql-orm';
export const o = { sql: 1 };
export const a = sql\`1\`;
`);
  });
});

describe('col()', () => {
  it("rewrites a computed field's col() into the refs its callback takes, and drops the import", () => {
    const { text, unresolved } = codemodFile(`import { col, Entity, Field, Id, raw } from 'uql-orm';
@Entity()
class Product {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) salePrice?: number;
  @Field({ type: Number }) cost?: number;
  @Field({ type: Number, computed: raw\`\${col('salePrice')} - \${col('cost')}\` }) profit?: number;
}
class Line { id?: number; unitPrice?: number; total?: number; }
defineEntity(Line, { fields: { total: { type: Number, virtual: raw\`\${col('unitPrice')} * 2\` } } });
`);

    expect(text).toContain("import { Entity, Field, Id, sql } from 'uql-orm';");
    expect(text).toContain(
      '@Field({ type: Number, computed: (product) => sql`${product.salePrice} - ${product.cost}` }) profit?: number | null;',
    );
    expect(text).toContain('total: { type: Number, computed: (line) => sql`${line.unitPrice} * 2` },');
    expect(unresolved).toEqual([]);
  });

  it("rewrites a statement's col() into refs(Entity), and a populated relation's into its target's", () => {
    const { text, unresolved } = codemodFile(`import { col, raw } from 'uql-orm';
declare const pool: { findMany(entity: unknown, q: unknown): void; updateMany(entity: unknown, q: unknown, p: unknown): void };
class Tax { id?: number; name?: string; }
class Item { id?: number; stock?: number; tax?: Tax; }
pool.updateMany(Item, { $where: { id: 1 } }, { stock: raw\`\${col('stock')} - 1\` });
pool.findMany(Item, { $populate: { tax: { $select: [raw\`UPPER(\${col('name')})\`.as('label')] } } });
`);

    expect(text).toContain("import { refs, sql } from 'uql-orm';");
    expect(text).toContain('{ stock: sql`${refs(Item).stock} - 1` }');
    expect(text).toContain("$select: [sql`UPPER(${refs(Tax).name})`.as('label')]");
    expect(unresolved).toEqual([]);
  });

  /**
   * A raw built apart from its query, a column no field maps, a relation filter's own table, a col not
   * called, inside a function, outside any definition, or in a call that names no entity.
   */
  it('reports a col() whose entity or member it cannot tell, keeping the import', () => {
    const { text, unresolved } = codemodFile(`import { col, raw } from 'uql-orm';
declare const pool: { findMany(entity: unknown, q: unknown): void };
declare function wrap(value: unknown): unknown;
class Tax { id?: number; name?: string; }
class Item { id?: number; stock?: number; tax?: Tax; }
const shared = raw\`\${col('stock')} > 0\`;
pool.findMany(Item, { $where: { $and: [raw\`\${col('legacy_stock')} > 0\`] } });
pool.findMany(Item, { $where: { tax: { $and: [raw\`\${col('name')} <> ''\`] } } });
const alias = col;
const later = () => raw\`\${col('stock')} > 0\`;
const options = { computed: raw\`\${col('stock')} * 2\` };
wrap(raw\`\${col('stock')} > 0\`);
`);

    const report = "'col' was removed; read the column off refs(Entity), which the codemod could not tell here";
    expect(text).toContain("import { col, sql } from 'uql-orm';");
    expect(unresolved).toEqual([6, 7, 8, 9, 10, 11, 12].map((line) => `/entities.ts:${line}: ${report}`));
  });

  it("reads an entity off a statement's $entity and an accessed class, past a computed key and a member named like the parameter", () => {
    const { text, unresolved } = codemodFile(`import { col, Field, raw } from 'uql-orm';
declare const pool: { findMany(q: unknown): void };
declare const key: string;
declare const settings: { product: number };
declare function defineEntity(entity: unknown, options: unknown): void;
class Item { id?: number; stock?: number; }
pool.findMany({ $entity: Item, $where: { [key]: raw\`\${col('stock')} > 0\` } });
class Product {
  cost?: number;
  @Field({ type: Number, computed: raw\`\${col('cost')} * \${settings.product}\` }) margin?: number;
}
const models = { Line: class { unitPrice?: number; total?: number; } };
defineEntity(models.Line, { fields: { total: { type: Number, computed: raw\`\${col('unitPrice')} * 2\` } } });
`);

    expect(text).toContain("import { refs, Field, sql } from 'uql-orm';");
    expect(text).toContain('$where: { [key]: sql`${refs(Item).stock} > 0` }');
    expect(text).toContain('computed: (product) => sql`${product.cost} * ${settings.product}`');
    expect(text).toContain('computed: (entity) => sql`${entity.unitPrice} * 2`');
    expect(unresolved).toEqual([expect.stringContaining('defineEntity takes a schema now')]);
  });

  it('reports a computed col() whose callback parameter would shadow a binding its SQL reads', () => {
    const { text, unresolved } = codemodFile(`import { col, Field, raw } from 'uql-orm';
declare const product: number;
class Product {
  cost?: number;
  @Field({ type: Number, computed: raw\`\${col('cost')} * \${product}\` }) margin?: number;
}
`);

    expect(text).toContain("computed: sql`${col('cost')} * ${product}`");
    expect(unresolved).toEqual([
      "/entities.ts:5: 'col' was removed; read the column off refs(Entity), which the codemod could not tell here",
    ]);
  });
});
