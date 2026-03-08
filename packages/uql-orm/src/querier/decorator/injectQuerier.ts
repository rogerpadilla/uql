import type { Key, Primitive, Type } from '../../type/index.js';

const metadataKey = Symbol('InjectQuerier');

export function InjectQuerier() {
  return (proto: Record<Primitive, any>, key: string, index: number) => {
    if (!proto[metadataKey]) {
      proto[metadataKey] = new WeakMap();
    }

    if (!proto[metadataKey].has(proto.constructor)) {
      proto[metadataKey].set(proto.constructor, {});
    }

    const meta = proto[metadataKey].get(proto.constructor);
    const isAlreadyInjected = key in meta;

    if (isAlreadyInjected) {
      throw new TypeError(`@InjectQuerier() can only appears once in '${proto.constructor.name}.${key}'}`);
    }

    meta[key] = index;
  };
}

export function getInjectedQuerierIndex<S>(service: Type<S>, key: Key<S>) {
  let proto = service.prototype;

  while (proto.constructor !== Object) {
    const meta = proto[metadataKey]?.get(proto.constructor);

    if (meta && key in meta) {
      return meta[key];
    }

    const keys = Object.getOwnPropertyNames(proto) as Key<S>[];
    const isOwnKey = keys.includes(key);

    if (isOwnKey) {
      return;
    }

    proto = Object.getPrototypeOf(proto);
  }
}
