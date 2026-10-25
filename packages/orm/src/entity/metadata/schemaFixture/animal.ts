import { f } from '../../column.js';
import { defineEntity } from '../definition.js';

export const Animal = defineEntity({
  name: 'Animal',
  fields: { id: f.number().id(), name: f.string() },
});

export const Dog = defineEntity({ name: 'Dog', extends: Animal, fields: { tricks: f.number().nullable() } });
