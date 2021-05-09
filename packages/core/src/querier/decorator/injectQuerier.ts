import { Querier } from '../../type';

const metadataKey = Symbol('InjectQuerier');

export function InjectQuerier() {
  return (proto: object, prop: string) => {
    if (!proto[metadataKey]) {
      proto[metadataKey] = new WeakMap();
    }
    if (proto[metadataKey].has(proto.constructor)) {
      throw new TypeError(
        `Decorator @InjectQuerier() is already used in '${proto.constructor.name}.${proto[metadataKey].get(
          proto.constructor
        )}'`
      );
    }
    proto[metadataKey].set(proto.constructor, prop);
  };
}

export function getInjectedQuerierProperty(proto: object) {
  const injectedPropertiesMap = getInjectedQuerierPropertiesMap(proto);
  return Array.from(injectedPropertiesMap.values()).find(Boolean);
}

function getInjectedQuerierPropertiesMap(proto: object) {
  const resp = new Map<{ new (): any }, string>();
  let parentProto = proto;
  while (parentProto.constructor !== Object) {
    const prop = parentProto[metadataKey]?.get(parentProto.constructor);
    resp.set(parentProto.constructor as { new (): any }, prop);
    parentProto = Object.getPrototypeOf(parentProto);
  }
  return resp;
}

export function injectQuerier(instance: object, querier: Querier) {
  const proto = Object.getPrototypeOf(instance);
  const injectedPropertiesMap = getInjectedQuerierPropertiesMap(proto);
  for (const prop of Array.from(injectedPropertiesMap.values()).filter(Boolean)) {
    instance[prop] = querier;
  }
}
