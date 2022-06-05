import { Key, Type } from '../../type/index';

const metadataKey = Symbol('InjectQuerier');

export function InjectQuerier() {
  return (proto: object, key: string, index: number) => {
    const { constructor } = proto;

    if (!proto[metadataKey]) {
      proto[metadataKey] = new WeakMap();
    }

    if (!proto[metadataKey].has(constructor)) {
      proto[metadataKey].set(constructor, {});
    }

    const meta = proto[metadataKey].get(constructor);
    const isAlreadyInjected = key in meta;

    if (isAlreadyInjected) {
      throw new TypeError(`@InjectQuerier() can only appears once in '${constructor.name}.${key}'}`);
    }

    meta[key] = index;
  };
}

export function getInjectedQuerierIndex<S>(service: Type<S>, key: Key<S>) {
  let proto: FunctionConstructor = service.prototype;

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
