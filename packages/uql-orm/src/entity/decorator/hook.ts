import type { HookEvent, Type } from '../../type/index.js';
import { defineHook } from './definition.js';

function createHookDecorator(event: HookEvent): () => MethodDecorator {
  return () =>
    (target: object, key: string | symbol): void => {
      const entity = target.constructor as Type<unknown>;
      defineHook(entity, String(key), event);
    };
}

export const BeforeInsert = createHookDecorator('beforeInsert');
export const AfterInsert = createHookDecorator('afterInsert');
export const BeforeUpdate = createHookDecorator('beforeUpdate');
export const AfterUpdate = createHookDecorator('afterUpdate');
export const BeforeDelete = createHookDecorator('beforeDelete');
export const AfterDelete = createHookDecorator('afterDelete');
export const AfterLoad = createHookDecorator('afterLoad');
