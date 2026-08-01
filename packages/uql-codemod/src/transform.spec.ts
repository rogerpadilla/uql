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
  declare function InjectQuerier(): ParameterDecorator;
  declare function Log(): MethodDecorator;
  declare function Serialized(): PropertyDecorator;
  declare function Transactional(): MethodDecorator;
  declare class Querier {}
  declare function currentQuerier(): Querier;
  declare function ManyToOne(opts?: { entity?: EntityGetter }): PropertyDecorator;
  declare function OneToMany(opts?: { entity?: EntityGetter; mappedBy?: string }): PropertyDecorator;
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
    expect(text).toContain("@OneToMany({ entity: () => Company, mappedBy: 'entity' }) peers?: Company[];");
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

  it("rewrites an '@InjectQuerier()' parameter into a currentQuerier() call", () => {
    const { text } = codemod(`
      class Service {
        @Transactional()
        async save(name: string, @InjectQuerier() querier?: Querier) {
          await querier!.insertOne({}, { name });
        }
      }
    `);

    expect(text).toContain('async save(name: string) {');
    expect(text).toContain('const querier = currentQuerier();');
    expect(text).toContain("import { currentQuerier } from 'uql-orm';");
  });

  it('removes the sole parameter and its parentheses stay valid', () => {
    const { text } = codemod(`
      class Service {
        @Transactional()
        async save(@InjectQuerier() querier?: Querier) {
          await querier!.insertOne({}, {});
        }
      }
    `);

    expect(text).toContain('async save() {');
    expect(text).toContain('const querier = currentQuerier();');
  });

  it("reports an '@InjectQuerier()' parameter it cannot rewrite", () => {
    const { unresolved } = codemod(`
      class Service {
        @Transactional()
        async save(@InjectQuerier() querier: Querier = currentQuerier()) {
          await querier.insertOne({}, {});
        }
      }
    `);

    expect(unresolved[0]).toContain("cannot rewrite this '@InjectQuerier()' parameter");
  });

  /**
   * The polyfill import goes, and so does `InjectQuerier`: `uql-orm` no longer exports one, so leaving it
   * imported would turn a working file into a compile error.
   */
  it('reconciles the imports the rewrites leave behind', () => {
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
    expect(text).not.toContain('InjectQuerier');
    expect(text).toContain("import { Transactional, type Querier, currentQuerier } from 'uql-orm';");
    // Nothing blank left where the polyfill import was.
    expect(text.startsWith('import {')).toBe(true);
  });

  /**
   * The `uql-orm` import loses every name it had, so the whole statement goes and `currentQuerier` has
   * nothing to extend. Adding a name to a statement the drop pass had already removed is exactly the bug
   * the two passes are ordered against.
   */
  it('replaces an import that loses every name with the one the rewrite needs', () => {
    const { text } = codemodFile(`import { InjectQuerier } from 'uql-orm';

class Service {
  async save(@InjectQuerier() querier?: unknown) {
    return querier;
  }
}
`);

    expect(text).not.toContain('InjectQuerier');
    expect(text).toContain("import { currentQuerier } from 'uql-orm';");
    expect(text).toContain('async save() {');
    expect(text).toContain('const querier = currentQuerier();');
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
