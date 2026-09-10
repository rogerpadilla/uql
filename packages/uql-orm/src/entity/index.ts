export * from './decorator/entity.js';
export * from './decorator/members.js';
export {
  defineEntity,
  defineField,
  defineFilter,
  defineHook,
  defineId,
  defineIndex,
  defineRelation,
  getEntities,
  getMeta,
  removeEntity,
  assertSoleId,
  fieldOf,
  idOf,
  namesKey,
  soleIdOf,
} from './metadata/definition.js';
