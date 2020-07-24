const metadataKey = Symbol('InjectQuerier');

export function InjectQuerier(): (target: object, propertyKey: string, index: number) => void {
  return (target: object, propertyKey: string, index: number): void => {
    target[metadataKey] = {
      [propertyKey]: index,
    };
  };
}

export function getInjectQuerier<T>(target: object, propertyKey: string): number {
  const index = target[metadataKey][propertyKey] as number;
  return index;
}
