import { Entity, f, Field } from 'uql-orm';

// Next minifies the server bundle, renaming the class: the table is named, not derived from it.
@Entity({ name: 'todo' })
export class Todo {
  @Field(f.number().autoIncrement())
  id?: number;

  @Field(f.string())
  title!: string;

  @Field(f.boolean().nullable().default(false))
  completed?: boolean | null;
}
