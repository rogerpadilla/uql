import { Querier, Type } from '../../type';

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
    if (meta[key] !== undefined) {
      throw new TypeError(`Decorator @InjectQuerier() can only appears once in '${constructor.name}.${key}'}`);
    }
    meta[key] = index;
  };
}

export function getInjectedQuerierIndex<T>(type: Type<T>, key: keyof T) {
  let proto = type.prototype;

  while (proto.constructor !== Object) {
    const meta = proto[metadataKey]?.get(proto.constructor);
    const index = meta?.[key];

    if (index !== undefined) {
      return index;
    }

    const props = Object.getOwnPropertyNames(proto) as (keyof T)[];
    const isOwnProperty = props.includes(key);

    if (isOwnProperty) {
      return;
    }

    proto = Object.getPrototypeOf(proto);
  }
}
