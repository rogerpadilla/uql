import { Entity, Field, Id, idKey } from 'uql-orm';

@Entity({ name: 'regions' })
export class Region {
  [idKey]?: 'code';

  @Id({ type: 'int', autoIncrement: false })
  code!: number;

  @Field({ type: 'text', nullable: false })
  name!: string;

}
