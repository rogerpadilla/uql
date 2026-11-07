/**
 * What a definition's `wire` and `serve` take. Type-checked by `bun run ts` only.
 */
import { defineEntity, Entity, f, Field, OneToMany } from '../entity/index.js';
import { serve } from './exposure.js';

export function anEntityTakesDeletesToo() {
  defineEntity({ name: 'WireTypeNote', wire: ['read', 'delete'], fields: { id: f.number().autoIncrement() } });
  defineEntity({ name: 'WireTypeSession', wire: false, fields: { id: f.number().autoIncrement() } });

  @Entity({ wire: ['read'] })
  class Folder {
    @Field(f.number().autoIncrement()) id?: number;
    @OneToMany(() => Folder, { mappedBy: (folder) => folder.parent, wire: false }) children?: Folder[];
    @Field(f.number().nullable()) parentId?: number | null;
    parent?: Folder;
  }

  defineEntity({ name: 'WireTypeTag', fields: { id: f.number().autoIncrement() } }).relations((rel) => ({
    // @ts-expect-error a relation is a member: it takes no delete
    folders: () => rel.oneToMany(Folder, { wire: ['delete'] }),
  }));
}

export function serveTakesMiddleware() {
  @Entity()
  class Item {
    @Field(f.number().autoIncrement()) id?: number;
  }
  serve(Item, { use: [(call, _context, next) => next(call)] });
  // @ts-expect-error an entity with no middleware of its own is listed as it is
  serve(Item, {});
  // @ts-expect-error what a client may do is the definition's `wire`
  serve(Item, { use: [], ops: ['read'] });
}
