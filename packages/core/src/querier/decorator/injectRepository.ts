import { Type } from '../../type';

const metadataKey = Symbol('InjectQuerier');

type InjectionMap = { [k in number]: Type<any> };

export function InjectRepository<E>(entity: Type<E>) {
  return (proto: object, key: string, index: number) => {
    const { constructor } = proto;

    if (!proto[metadataKey]) {
      proto[metadataKey] = new WeakMap();
    }
    if (!proto[metadataKey].has(constructor)) {
      proto[metadataKey].set(constructor, {});
    }
    const meta = proto[metadataKey].get(constructor);
    const injected: InjectionMap = meta[key];
    const isAlreadyInjected = injected && Object.values(injected).some((val) => val === entity);
    if (isAlreadyInjected) {
      throw new TypeError(`@InjectRepository(${entity.name}) can only appears once in '${constructor.name}.${key}'}`);
    }
    meta[key] = { ...meta[key], [index]: entity };
  };
}

export function getInjectedRepositoriesMap<S>(type: Type<S>, key: keyof S): InjectionMap {
  let proto = type.prototype;

  while (proto.constructor !== Object) {
    const meta = proto[metadataKey]?.get(proto.constructor);
    const map: InjectionMap = meta?.[key];

    if (map !== undefined) {
      return map;
    }

    const keys = Object.getOwnPropertyNames(proto) as (keyof S)[];
    const isOwnKey = keys.includes(key);

    if (isOwnKey) {
      return;
    }

    proto = Object.getPrototypeOf(proto);
  }
}
