import { Entity, Field, Id } from 'uql-orm';

// Next minifies the server bundle, renaming the class: the table is named, not derived from it.
@Entity({ name: 'todo' })
export class Todo {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String, nullable: false })
  title!: string;

  @Field({ type: Boolean, defaultValue: false })
  completed?: boolean | null;
}
