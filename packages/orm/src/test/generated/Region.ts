import { Entity, Field, f, idKey } from 'uql-orm';

@Entity({ name: 'regions' })
export class Region {
  [idKey]?: 'code';

  @Field(f.column('int').id().autoIncrement(false))
  code!: number;

  @Field(f.column('text'))
  name!: string;

}
