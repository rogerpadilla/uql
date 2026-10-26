/**
 * What `@Field` and `@Computed` check of the property they sit on. Type-checked by `bun run ts` only.
 */
import { filledKey, idKey, type Json, sql, versionKey } from '../../index.js';
import type { StandardSchemaV1 } from '../../type/index.js';
import { f } from '../column.js';
import { Entity } from './entity.js';
import { Computed, Field, OneToMany } from './members.js';

declare const langSchema: StandardSchemaV1<unknown, { lang: string }>;

@Entity()
export class Post {
  [versionKey]?: 'revision';
  [filledKey]?: 'status' | 'views';

  @Field(f.number().id()) id?: number;
  @Field(f.string()) title!: string;
  @Field(f.string().nullable()) subtitle?: string | null;
  @Field(f.enum(['draft', 'published']).default('draft')) status!: 'draft' | 'published';
  @Field(f.number().default(0)) views!: number;
  @Field(f.version()) revision?: number;
  @Field(f.json(langSchema).nullable()) meta?: Json<{ lang: string }> | null;
  @Field(f.references(() => Author).nullable()) authorId?: number | null;
  @Computed((post) => f.string().as(sql`upper(${post.title})`)) readonly shout?: string;
  @Computed((post) =>
    f
      .string()
      .nullable()
      .as(sql`upper(${post.subtitle})`),
  )
  readonly loud?: string | null;
}

@Entity()
export class Author {
  @Field(f.number().id()) id?: number;
  @OneToMany({ entity: () => Post, mappedBy: (post) => post.authorId }) posts?: Post[];
  @Computed((author) => author.posts.count()) readonly postCount?: number;
  @Computed((author) => author.posts.max((post) => post.views)) readonly topViews?: number | null;
}

@Entity()
export class Mistakes {
  [idKey]?: 'code';
  @Field(f.string().id()) code?: string;
  // @ts-expect-error a NOT NULL column holds no null
  @Field(f.string()) a?: string | null;
  // @ts-expect-error a nullable one does, which the property has to admit
  @Field(f.string().nullable()) b?: string;
  // @ts-expect-error the property is the column's type
  @Field(f.number()) c?: string;
  // @ts-expect-error an enum's members
  @Field(f.enum(['x', 'y'])) d?: 'x' | 'z';
  // @ts-expect-error a foreign key holds its target's key
  @Field(f.references(() => Author)) e?: string;
  // @ts-expect-error a version needs the class's `versionKey` brand
  @Field(f.version()) revision?: number;
  // @ts-expect-error an aggregate's value is exact, so the property admits all of it
  @Computed((row) => row.code.length) readonly g?: number;
}

@Entity()
export class Unnamed {
  // @ts-expect-error a key not named `id`, `_id` or `uuid` needs the `idKey` brand
  @Field(f.number().id()) key?: number;
}

@Entity()
export class Unfilled {
  [filledKey]?: 'count';
  @Field(f.number().id()) id?: number;
  // @ts-expect-error a field the brand lets an insert leave out needs something to fill it
  @Field(f.number()) count!: number;
}
