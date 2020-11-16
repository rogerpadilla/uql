const metadataKey = Symbol('InjectQuerier');

export function InjectQuerier() {
  return (target: object, prop: string, index: number) => {
    if (!target[metadataKey]) {
      target[metadataKey] = {};
    }
    if (target[metadataKey][prop] !== undefined) {
      throw new Error(
        `Decorator @InjectQuerier() must appear only once in the parameters of '${target.constructor.name}.${prop}'`
      );
    }
    target[metadataKey][prop] = index;
  };
}

export function getInjectQuerier<T>(target: object, prop: string) {
  return target[metadataKey]?.[prop] as number;
}
