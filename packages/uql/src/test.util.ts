/* eslint-disable jest/valid-title */
/* eslint-disable jest/expect-expect */
/* eslint-disable jest/no-export */
export function createSpec<T extends Spec>(spec: T) {
  const specKeys = new Map<string, true>();
  let proto: object = Object.getPrototypeOf(spec);

  while (proto.constructor !== Object) {
    Object.getOwnPropertyNames(proto).forEach((key) => {
      if (key !== 'constructor' && !specKeys.has(key)) {
        specKeys.set(key, true);
        const callback = spec[key].bind(spec);
        if (['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(key)) {
          globalThis[key](callback);
        } else if (key.startsWith('should')) {
          it(key, callback);
        }
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
  [title: string]: jest.Lifecycle | any;
}
