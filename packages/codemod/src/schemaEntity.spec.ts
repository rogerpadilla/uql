import { describe, expect, it } from 'vitest';
import { toSchemaEntities } from './schemaEntity.js';

const convert = (text: string) => {
  const { text: written, unresolved, notes } = toSchemaEntities('/entities.ts', text);
  return { text: written, unresolved, notes };
};

describe('toSchemaEntities', () => {
  it('declares a class defineEntity registers as a schema, its fields, relations and options kept', () => {
    const { text, unresolved } = convert(`import { defineEntity } from 'uql-orm';

export class Post {
  id?: number;
  title?: string | null;
  authorId?: number | null;
  author?: User;
}

defineEntity(Post, {
  name: 'posts',
  fields: {
    id: { type: Number, isId: true },
    title: { type: String },
    authorId: { references: () => User },
  },
  relations: { author: { cardinality: 'm1', entity: () => User, references: (post) => post.authorId } },
  indexes: [{ columns: (post) => [post.title], unique: true }],
});
`);

    expect(unresolved).toEqual([]);
    expect(text).toBe(`import { defineEntity } from 'uql-orm';

export const Post = defineEntity({
  name: 'Post',
  table: 'posts',
  fields: {
    id: { type: Number, isId: true },
    title: { type: String },
    authorId: { references: () => User },
  },
  relations: (rel) => ({
    author: () => rel.manyToOne(User, { references: (post) => post.authorId }),
  }),
  indexes: [{ columns: (post) => [post.title], unique: true }],
});
export type Post = InstanceType<typeof Post>;
`);
  });

  it('names a schema after its class, moves computed columns apart, and spells each cardinality', () => {
    const { text } = convert(`class Line {
  id?: number;
}
defineEntity(Line, {
  fields: {
    id: { type: Number, isId: true },
    qty: { type: Number },
    double: { type: Number, computed: (line) => sql\`\${line.qty} * 2\` },
  },
  relations: {
    order: { cardinality: '11', entity: () => Order, mappedBy: (order) => order.line },
    parts: { cardinality: '1m', entity: () => Part, mappedBy: (part) => part.line },
    tags: { cardinality: 'mm', entity: () => Tag, through: () => LineTag },
  },
});
`);

    expect(text).toBe(`const Line = defineEntity({
  name: 'Line',
  fields: {
    id: { type: Number, isId: true },
    qty: { type: Number },
  },
  computed: {
    double: { type: Number, computed: (line) => sql\`\${line.qty} * 2\` },
  },
  relations: (rel) => ({
    order: () => rel.oneToOne(Order, { mappedBy: (order) => order.line }),
    parts: () => rel.oneToMany(Part, { mappedBy: (part) => part.line }),
    tags: () => rel.manyToMany(Tag, { through: () => LineTag }),
  }),
});
type Line = InstanceType<typeof Line>;
`);
  });

  it("turns a hook's method into a function of the row, and folds the incremental definers in", () => {
    const { text, notes } =
      convert(`import { defineEntity, defineField, defineHook, defineId, defineIndex, defineRelation, type HookContext } from 'uql-orm';

class Article {
  id?: string;
  title?: string;
  createdAt?: Date;

  async stamp(ctx: HookContext): Promise<void> {
    this.createdAt = await ctx.querier.now();
  }
}

defineId(Article, 'id', { type: 'uuid' });
defineField(Article, 'title', { type: String, nullable: false });
defineRelation(Article, 'author', { cardinality: 'm1', entity: () => User, references: (article) => article.authorId });
defineHook(Article, 'stamp', 'beforeInsert');
defineIndex(Article, { columns: (article) => [article.title] });
defineEntity(Article, { name: 'articles', hooks: { afterLoad: (article) => [article.stamp] } });
`);

    expect(text).toBe(`import { defineEntity, type HookContext } from 'uql-orm';

const Article = defineEntity({
  name: 'Article',
  table: 'articles',
  fields: {
    id: { isId: true, type: 'uuid' },
    title: { type: String, nullable: false },
  },
  relations: (rel) => ({
    author: () => rel.manyToOne(User, { references: (article) => article.authorId }),
  }),
  indexes: [{ columns: (article) => [article.title] }],
  hooks: {
    beforeInsert: [async (article, ctx: HookContext) => {
    article.createdAt = await ctx.querier.now();
  }],
    afterLoad: [async (article, ctx: HookContext) => {
    article.createdAt = await ctx.querier.now();
  }],
  },
});
type Article = InstanceType<typeof Article>;
`);
    expect(notes).toEqual([
      "/entities.ts:8: 'stamp' runs as a hook of the row now, no longer a method of 'Article': call sites need the function",
    ]);
  });

  it('keeps a brand off the schema, which derives its own', () => {
    const { text } = convert(`class Seat {
  [idKey]?: 'code';
  code?: string;
}
defineEntity(Seat, { fields: { code: { type: String, isId: true } } });
`);

    expect(text).toBe(`const Seat = defineEntity({
  name: 'Seat',
  fields: { code: { type: String, isId: true } },
});
type Seat = InstanceType<typeof Seat>;
`);
  });

  it('notes a property type a schema would derive more loosely, naming the option that keeps it', () => {
    const { notes } = convert(`class Doc {
  id?: number;
  meta?: Json<{ lang: string }>;
  status?: 'draft' | 'live';
}
defineEntity(Doc, { fields: { id: { type: Number, isId: true }, meta: { type: 'json' }, status: { type: String } } });
`);

    expect(notes).toEqual([
      "/entities.ts:3: 'meta' was declared Json<{ lang: string }>: describe its payload with 'shape' to keep it typed",
      "/entities.ts:4: 'status' was declared 'draft' | 'live': list its values in 'enum' to keep them typed",
    ]);
  });

  it('leaves what it cannot declare as a schema as written, saying what to do', () => {
    const { text, unresolved } = convert(`class Base {}
class Child extends Base {
  id?: number;
}
defineEntity(Child, { fields: { id: { type: Number, isId: true } } });

class Behaving {
  id?: number;
  label() {
    return 'x';
  }
}
defineEntity(Behaving, { fields: { id: { type: Number, isId: true } } });

class Spread {
  id?: number;
}
defineEntity(Spread, { ...shared });

const minted = { page: class {} }.page;
defineEntity(minted, { fields: { id: { type: Number, isId: true } } });

defineIndex(Decorated, { columns: (decorated) => [decorated.title] });
`);

    expect(text).toContain('defineEntity(Child, {');
    expect(unresolved).toEqual([
      "/entities.ts:5: 'Child' extends a class: declare the base with defineEntity too and pass it as 'extends'",
      "/entities.ts:13: 'Behaving' has the method 'label': rows are plain objects, so make it a function of the row, then run again",
      "/entities.ts:18: defineEntity's options could not be read: write them as an object literal",
      '/entities.ts:21: defineEntity takes a schema now: defineEntity({ name, fields, ... })',
      "/entities.ts:23: defineIndex was removed: register 'Decorated' with defineEntity in this file, or decorate it (@Entity's 'indexes')",
    ]);
  });

  it("declares a computed field over a relation as one of the schema's aggregates", () => {
    const { text, unresolved } = convert(`class Counted {
  id?: number;
}
defineEntity(Counted, {
  fields: {
    id: { type: Number, isId: true },
    total: { computed: (counted) => counted.items.count() },
    top: { computed: (counted) => counted.items.max((item) => item.amount) },
  },
  relations: { items: { cardinality: '1m', entity: () => Item, mappedBy: (item) => item.counted } },
});
`);

    expect(unresolved).toEqual([]);
    expect(text).toBe(`const Counted = defineEntity({
  name: 'Counted',
  fields: {
    id: { type: Number, isId: true },
  },
  relations: (rel) => ({
    items: () => rel.oneToMany(Item, { mappedBy: (item) => item.counted }),
  }),
  aggregates: (rel) => ({
    total: () => rel.items.count(),
    top: () => rel.items.max((item) => item.amount),
  }),
});
type Counted = InstanceType<typeof Counted>;
`);
  });

  it.each([
    [
      'total: { computed: (counted) => counted.items.count(), index: true }',
      "'Counted.total' aggregates a relation with options an aggregate takes none of: move it by hand",
    ],
    [
      'total: { computed: (counted) => counted.items.sum((item) => item.amount) + counted.id }',
      "'Counted.total' reads more than a relation's aggregate: move it by hand",
    ],
  ])('reports an aggregate it cannot move as written: %s', (field, message) => {
    const { unresolved } = convert(`class Counted {
  id?: number;
}
defineEntity(Counted, {
  fields: { id: { type: Number, isId: true }, ${field} },
  relations: { items: { cardinality: '1m', entity: () => Item, mappedBy: (item) => item.counted } },
});
`);

    expect(unresolved).toEqual([`/entities.ts:5: ${message}`]);
  });

  it("folds a definer's aggregate into the schema's, and reports one it cannot move", () => {
    const { text, unresolved } = convert(`class Counted {
  id?: number;
}
defineField(Counted, 'total', { computed: (counted) => counted.items.count() });
defineEntity(Counted, {
  fields: { id: { type: Number, isId: true } },
  relations: { items: { cardinality: '1m', entity: () => Item, mappedBy: (item) => item.counted } },
});
`);
    const reported = convert(`class Counted {
  id?: number;
}
defineField(Counted, 'total', { computed: (counted) => counted.items.count(), index: true });
defineEntity(Counted, {
  fields: { id: { type: Number, isId: true } },
  relations: { items: { cardinality: '1m', entity: () => Item, mappedBy: (item) => item.counted } },
});
`);

    expect(unresolved).toEqual([]);
    expect(text).toContain('aggregates: (rel) => ({\n    total: () => rel.items.count(),\n  }),');
    expect(reported.unresolved).toEqual([
      "/entities.ts:4: 'Counted.total' aggregates a relation with options an aggregate takes none of: move it by hand",
    ]);
  });

  it('folds a filter and a trigger into the lists defineEntity gave, and its schema and table', () => {
    const { text } = convert(`class Task {
  id?: number;
}
defineFilter(Task, 'open', { where: { done: false } });
defineTrigger(Task, { on: 'afterInsert', run: audit });
defineEntity(Task, {
  name: 'tasks',
  schema: 'work',
  extends: Audited,
  fields: { id: { type: Number, isId: true } },
  filters: { mine: { where: { owner: 'me' } } },
  triggers: [{ on: 'beforeUpdate', run: stamp }],
});
`);

    expect(text).toBe(`const Task = defineEntity({
  name: 'Task',
  table: 'tasks',
  schema: 'work',
  extends: Audited,
  fields: { id: { type: Number, isId: true } },
  filters: { open: { where: { done: false } }, mine: { where: { owner: 'me' } } },
  triggers: [{ on: 'afterInsert', run: audit }, { on: 'beforeUpdate', run: stamp }],
});
type Task = InstanceType<typeof Task>;
`);
  });

  it('registers a class defineEntity finishes without options, a field folded in under a quoted key', () => {
    const { text } = convert(`import { defineEntity, defineField } from 'uql-orm';
import { defineId } from 'uql-orm';
class Page { id?: number; 'hero-image'?: string; }
defineId(Page, 'id', {});
defineField(Page, 'hero-image', { type: String });
defineField(Page, 'total', { type: Number, computed: sql\`1\` });
defineEntity(Page);`);

    expect(text).toBe(`import { defineEntity } from 'uql-orm';
const Page = defineEntity({
  name: 'Page',
  fields: {
    id: { isId: true },
    'hero-image': { type: String },
  },
  computed: {
    total: { type: Number, computed: sql\`1\` },
  },
});
type Page = InstanceType<typeof Page>;`);
  });

  it.each([
    ['a default export', 'export default class C { id?: number; }\ndefineEntity(C, {});', "'C' is a default export"],
    ['a decorated class', '@Entity()\nclass C { id?: number; }\ndefineEntity(C, {});', "'C' is decorated as well"],
    [
      'an option a schema has no place for',
      "class C {}\ndefineEntity(C, { comment: 'x' });",
      "'comment' has no place in a schema",
    ],
    ['a constructor', 'class C { constructor() {} }\ndefineEntity(C, {});', "'C' has the member 'constructor() {}'"],
    [
      'a hook naming no method',
      'class C {}\ndefineEntity(C, { hooks: { beforeInsert: (c) => [c.stamp] } });',
      "the hook 'stamp' names no method",
    ],
    [
      'a hook taking more than its context',
      "class C { stamp(a: 1, b: 2) {} }\ndefineHook(C, 'stamp', 'beforeInsert');\ndefineEntity(C, {});",
      "'stamp' takes more than the hook context",
    ],
    [
      'a hook list that is no callback',
      'class C {}\ndefineEntity(C, { hooks: { beforeInsert: list } });',
      'a hook list could not be read',
    ],
    ['a list that is no literal', 'class C {}\ndefineEntity(C, { indexes: shared });', "'indexes' could not be read"],
    ['fields that are no literal', 'class C {}\ndefineEntity(C, { fields: shared });', "'fields' could not be read"],
    [
      'relations that are no literal',
      'class C {}\ndefineEntity(C, { relations: postRelations });',
      "'relations' could not be read",
    ],
    [
      'relations spread in',
      "class C {}\ndefineEntity(C, { relations: { ...base, r: { cardinality: 'm1', entity: () => D } } });",
      "'relations' could not be read",
    ],
    ['a shorthand field', 'class C {}\ndefineEntity(C, { fields: { id } });', "'fields' could not be read"],
    [
      'hooks that are no literal',
      'class C {}\ndefineEntity(C, { hooks });',
      "defineEntity's options could not be read",
    ],
    ['filters spread in', 'class C {}\ndefineEntity(C, { filters: { ...shared } });', "'filters' could not be read"],
    [
      'a relation of no known cardinality',
      'class C {}\ndefineEntity(C, { relations: { r: { cardinality: kind, entity: () => D } } });',
      'a relation could not be read',
    ],
    [
      'a relation spreading its options',
      "class C {}\ndefineEntity(C, { relations: { r: { cardinality: 'm1', entity: () => D, ...more } } });",
      'a relation could not be read',
    ],
    [
      'a field under a computed name',
      'class C {}\ndefineField(C, key, {});\ndefineEntity(C, {});',
      "defineField's arguments could not be read",
    ],
    [
      'an id whose options are no literal',
      "class C {}\ndefineId(C, 'id', shared);\ndefineEntity(C, {});",
      "defineId's arguments could not be read",
    ],
    [
      'a relation definer it cannot read',
      "class C {}\ndefineRelation(C, 'r', shared);\ndefineEntity(C, {});",
      "defineRelation's arguments could not be read",
    ],
    [
      'a hook definer naming no event',
      "class C { stamp() {} }\ndefineHook(C, 'stamp', event);\ndefineEntity(C, {});",
      "defineHook's arguments could not be read",
    ],
    [
      'an index definer with nothing to index',
      'class C {}\ndefineIndex(C);\ndefineEntity(C, {});',
      "defineIndex's arguments could not be read",
    ],
    [
      'a trigger definer with no trigger',
      'class C {}\ndefineTrigger(C);\ndefineEntity(C, {});',
      "defineTrigger's arguments could not be read",
    ],
    [
      'a filter definer under a computed name',
      'class C {}\ndefineFilter(C, name, {});\ndefineEntity(C, {});',
      "defineFilter's arguments could not be read",
    ],
    [
      'a second defineEntity',
      'class C {}\ndefineEntity(C, {});\ndefineEntity(C, {});',
      "defineEntity's arguments could not be read",
    ],
    ['a static member', 'class C { static count = 0; }\ndefineEntity(C, {});', "'C' has the member 'count'"],
    [
      'options passed as a variable',
      'class C {}\ndefineEntity(C, shared);',
      "defineEntity's options could not be read",
    ],
    [
      'a hook list naming another row',
      'class C { stamp() {} }\ndefineEntity(C, { hooks: { beforeInsert: (c) => [other.stamp] } });',
      'a hook list could not be read',
    ],
  ])('leaves %s as written, saying why', (_case, source, message) => {
    const { text, unresolved } = convert(source);

    expect(text).toBe(source);
    expect(unresolved).toEqual([expect.stringContaining(message)]);
  });

  it('removes a statement sharing its line with another, and an import left with nothing to import', () => {
    const { text } = convert(`import * as uql from 'uql-orm';
import { defineIndex } from 'uql-orm';
class Tag { id?: number; } defineIndex(Tag, { columns: (tag) => [tag.id] });
uql.defineEntity; defineEntity(Tag, { fields: { id: { type: Number, isId: true } } });
`);

    expect(text).toBe(`import * as uql from 'uql-orm';
uql.defineEntity; const Tag = defineEntity({
  name: 'Tag',
  fields: { id: { type: Number, isId: true } },
  indexes: [{ columns: (tag) => [tag.id] }],
});
type Tag = InstanceType<typeof Tag>;
`);
  });

  it("reads only the hook's own this as the row, not a function's inside it", () => {
    const { text } = convert(`class Log {
  stamp() {
    this.at = function () {
      return this;
    };
  }
}
defineHook(Log, 'stamp', 'beforeInsert');
defineEntity(Log, { fields: { id: { type: Number, isId: true } } });
`);

    expect(text).toContain(`beforeInsert: [(log) => {
    log.at = function () {
      return this;
    };
  }],`);
  });

  it("names a hook's row, and the schema's rel, past any name their code already reads", () => {
    const { text } = convert(`class Log {
  stamp() {
    const log = load();
    this.at = log.at;
  }
}
defineHook(Log, 'stamp', 'beforeInsert');
defineEntity(Log, {
  fields: { id: { type: Number, isId: true }, total: { computed: (log) => log.items.count() } },
  relations: { items: { cardinality: '1m', entity: () => rel.Item, mappedBy: (item) => item.log } },
});
`);

    expect(text).toContain(`beforeInsert: [(log2) => {
    const log = load();
    log2.at = log.at;
  }],`);
    expect(text).toContain(
      'relations: (rel2) => ({\n    items: () => rel2.oneToMany(rel.Item, { mappedBy: (item) => item.log }),',
    );
    expect(text).toContain('aggregates: (rel2) => ({\n    total: () => rel2.items.count(),');
  });

  it('leaves an entity extending a base declared below it as written, which its const would read too early', () => {
    const source = `class Base {}
class Child {}
defineEntity(Child, { extends: Base, fields: { name: { type: String } } });
defineEntity(Base, { fields: { id: { type: Number, isId: true } } });
`;
    const { text, unresolved } = convert(source);

    expect(unresolved).toEqual([
      "/entities.ts:3: 'Child' extends 'Base', declared below it: move defineEntity(Base, ...) above this one, then run again",
    ]);
    expect(text).toContain(
      'defineEntity(Child, { extends: Base, fields: { name: { type: String } } });\nconst Base = defineEntity({',
    );
  });

  it('changes nothing in a file with no class-form registration', () => {
    const source = `export const Post = defineEntity({ name: 'Post', fields: { id: { type: Number, isId: true } } });\n`;
    expect(convert(source)).toEqual({ text: source, unresolved: [], notes: [] });
  });
});

describe('the schema it writes', () => {
  it("should write in the file's own indentation, four spaces here", () => {
    const { text } = convert(`import { defineEntity } from 'uql-orm';
class Post {}
defineEntity(Post, {
    fields: {
        id: { type: Number, isId: true },
        title: { type: String },
    },
});
`);

    expect(text).toBe(`import { defineEntity } from 'uql-orm';
const Post = defineEntity({
    name: 'Post',
    fields: {
        id: { type: Number, isId: true },
        title: { type: String },
    },
});
type Post = InstanceType<typeof Post>;
`);
  });

  it('should write two spaces where the file has no indented code to read', () => {
    const { text } = convert(`import { defineEntity } from 'uql-orm';
class Post {}
defineEntity(Post, { fields: { id: { type: Number, isId: true } } });
`);

    expect(text).toContain("const Post = defineEntity({\n  name: 'Post',\n  fields: {");
  });

  it("should write in the file's own indentation, a tab here", () => {
    const { text } = convert(`import { defineEntity } from 'uql-orm';
class Post {}
defineEntity(Post, {
\tfields: {
\t\tid: { type: Number, isId: true },
\t},
});
`);

    expect(text).toContain("const Post = defineEntity({\n\tname: 'Post',\n\tfields: {\n\t\tid:");
  });
});
