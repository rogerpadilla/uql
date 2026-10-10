import { Entity, Field, Id, ManyToOne, sql } from 'uql-orm';
import { User } from './User.js';

@Entity({ name: 'posts' })
export class Post {
  @Id({ type: 'uuid' })
  id!: string;

  @Field({ name: 'author_id', type: 'int', nullable: false })
  authorId!: number;

  @Field({ name: 'editor_id', type: 'int' })
  editorId?: number | null;

  @Field({ type: 'varchar', length: 255, nullable: false })
  title!: string;

  @Field({ type: 'varchar', length: 10, nullable: false, defaultValue: 'draft' })
  state?: string;

  @Field({ type: 'int', nullable: false, defaultValue: 0 })
  views?: number;

  @Field({ type: 'int', nullable: false, computed: sql`views * 2`, stored: true })
  readonly score!: number;

  @Field({ name: 'published_at', type: 'timestamp' })
  publishedAt?: Date | null;

  @Field({ name: 'read_at', type: 'time' })
  readAt?: string | null;

  @Field({ type: 'vector', dimensions: 3 })
  embedding?: number[] | null;

  @ManyToOne({ entity: () => User, references: (post) => post.authorId })
  author?: User;

  @ManyToOne({ entity: () => User, references: (post) => post.editorId })
  editor?: User;
}
