import { Entity, Field, Id, ManyToOne, OneToMany, type Filled, type Json } from 'uql-orm';
import { Post } from './Post.js';

@Entity({ name: 'users' })
export class User {
  @Id({ type: 'int' })
  id!: number;

  @Field({ type: 'varchar', length: 255, nullable: false, unique: true })
  email!: string;

  @Field({ type: 'text' })
  name?: string | null;

  @Field({ type: 'jsonb', nullable: false, defaultValue: '{}' })
  settings!: Filled<Json<unknown>>;

  @Field({ name: 'manager_id', type: 'int' })
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
