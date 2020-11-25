export function createSpec<T extends Spec>(spec: T) {
  const specKeysMap: { [k: string]: true } = {};
  let proto: object = Object.getPrototypeOf(spec);

  while (proto.constructor !== Object) {
    Object.getOwnPropertyNames(proto).forEach((key) => {
      if (key === 'constructor' || specKeysMap[key]) {
        return;
      }
      specKeysMap[key] = true;
      const callback = spec[key].bind(spec);
      if (['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(key)) {
        globalThis[key](callback);
      } else if (key.startsWith('should')) {
        it(key, callback);
      }
    });
    proto = Object.getPrototypeOf(proto);
  }
}

export interface Spec {
  beforeAll?: jest.Lifecycle;
  afterAll?: jest.Lifecycle;
  beforeEach?: jest.Lifecycle;
  afterEach?: jest.Lifecycle;
  [prop: string]: jest.Lifecycle | any;
}
