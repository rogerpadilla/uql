import { afterAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, ManyToOne, OneToMany, removeEntity } from '../entity/index.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import type { QueryRaw, RefMap, TriggerRowName } from '../type/index.js';
import { raw, rowRefs } from './raw.js';

@Entity()
class Author {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, name: 'full_name' }) name?: string | null;
  @Field({ type: String, computed: (author) => raw`upper(${author.name})` }) loud?: string | null;
  @Field({ computed: (author) => author.posts.count() }) postCount?: number;
  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author }) posts?: Post[];
}

@Entity()
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Author }) authorId?: number | null;
  @ManyToOne({ entity: () => Author, references: (post) => post.authorId }) author?: Author;
}

describe('rowRefs', () => {
  const dialect = new PostgresDialect();
  const compile = (qualifier: TriggerRowName, read: (row: RefMap<Author>) => QueryRaw) =>
    dialect.compileDdl(raw`${read(rowRefs(Author, qualifier))}`, Author);

  afterAll(() => {
    removeEntity(Post);
    removeEntity(Author);
  });

  it('should read a column off the row it names', () => {
    expect(compile('NEW', (row) => row.name)).toBe('NEW."full_name"');
  });

  it('should read the other side off its own row, so one body may name both', () => {
    expect(compile('OLD', (row) => row.name)).toBe('OLD."full_name"');
  });

  // Quoted, `NEW` would name an identifier the engine case-folds; it is a record it declares itself.
  it('should write the row verbatim rather than as a quoted identifier', () => {
    expect(compile('NEW', (row) => row.name)).not.toContain('"NEW"');
  });

  it('should qualify the columns inside an inlined computed expression too', () => {
    expect(compile('NEW', (row) => row.loud)).toBe('(upper(NEW."full_name"))');
  });

  // The ref knows its own entity, so it names its column wherever it renders: inside a write to another
  // table, say, which is where a trigger's row is read from most often.
  it('should read its own column while another entity is the one rendering', () => {
    expect(dialect.compileDdl(raw`${rowRefs(Author, 'NEW').name}`, Post)).toBe('NEW."full_name"');
  });

  it('should refuse a field reading a relation, which no row can correlate a subquery to', () => {
    expect(() => compile('NEW', (row) => row.postCount)).toThrow(/reads a relation/);
  });
});
