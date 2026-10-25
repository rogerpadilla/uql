import { Entity, f, Field } from 'uql-orm';

@Entity()
export class Todo {
  @Field(f.number().id())
  id?: number;

  @Field(f.string())
  title!: string;

  @Field(f.boolean().nullable().default(false))
  completed?: boolean | null;
}
