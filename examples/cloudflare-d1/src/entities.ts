import { Entity, f, Field } from 'uql-orm';

@Entity()
export class Todo {
  @Field(f.number().autoIncrement())
  id?: number;

  @Field(f.string())
  title!: string;

  @Field(f.boolean().nullable().default(false))
  completed?: boolean | null;
}
