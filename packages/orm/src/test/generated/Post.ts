import { Computed, Entity, Field, ManyToOne, f, sql } from 'uql-orm';
import { User } from './User.js';

@Entity({ name: 'posts' })
export class Post {
  @Field(f.column('uuid').id())
  id!: string;

  @Field(f.column('int').name('author_id'))
  authorId!: number;

  @Field(f.column('int').nullable().name('editor_id'))
  editorId?: number | null;

  @Field(f.column('varchar').length(255))
  title!: string;

  @Field(f.column('varchar').length(10).default('draft'))
  state?: string;

  @Field(f.column('int').default(0))
  views?: number;

  @Computed(() => f.column('int').as(sql`views * 2`).stored())
  readonly score!: number;

  @Field(f.column('timestamp').nullable().name('published_at'))
  publishedAt?: Date | null;

  @Field(f.column('time').nullable().name('read_at'))
  readAt?: string | null;

  @Field(f.column('vector').dimensions(3).nullable())
  embedding?: number[] | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;

  @ManyToOne({ entity: () => User, references: (post) => post.editorId })
  editor?: User;
}
