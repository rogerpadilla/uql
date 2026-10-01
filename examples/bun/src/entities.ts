import { Entity, Field, Id } from 'uql-orm';

@Entity()
export class Todo {
  @Id({ type: Number })
  id?: number;

  @Field({ type: String, nullable: false })
  title!: string;

  @Field({ type: Boolean, defaultValue: false })
  completed?: boolean | null;
}
