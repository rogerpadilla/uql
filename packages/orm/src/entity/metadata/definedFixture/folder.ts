import { f } from '../../column.js';
import { defineEntity } from '../definition.js';

export const Folder = defineEntity({
  name: 'Folder',
  fields: { id: f.number().autoIncrement(), name: f.string(), size: f.number(), parentId: f.number().nullable() },
}).relations(
  (rel) => ({
    parent: () => rel.manyToOne(Folder, { references: (folder) => folder.parentId }),
    children: () => rel.oneToMany(Folder, { mappedBy: (folder) => folder.parent }),
  }),
  (folder) => ({
    childCount: () => folder.children.count(),
    childSize: () => folder.children.sum((child) => child.size),
  }),
);
export interface Folder extends InstanceType<typeof Folder> {}
