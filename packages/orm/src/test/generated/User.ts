import { Entity, Field, ManyToOne, OneToMany, f, type Json } from 'uql-orm';
import { Post } from './Post.js';

@Entity({ name: 'users' })
export class User {
  @Field(f.column('int').id())
  id!: number;

  @Field(f.column('varchar').length(255).unique())
  email!: string;

  @Field(f.column('text').nullable())
  name?: string | null;

  @Field(f.column('jsonb').default({}))
  settings?: Json;

  @Field(f.column('int').nullable().name('manager_id'))
  managerId?: number | null;

  @ManyToOne({ entity: () => User, references: (user) => user.managerId })
  manager?: User;

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.author })
  authorPosts?: Post[];

  @OneToMany({ entity: () => Post, mappedBy: (post) => post.editor })
  editorPosts?: Post[];

  @OneToMany({ entity: () => User, mappedBy: (user) => user.manager })
  users?: User[];
}
