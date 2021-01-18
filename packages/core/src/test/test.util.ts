import { describe, it, fit, xit, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';

export function createSpec<T extends Spec>(spec: T) {
  const specKeysMap: { [k: string]: true } = {};
  let proto: object = Object.getPrototypeOf(spec);

  describe(spec.name, () => {
    while (proto.constructor !== Object) {
      Object.getOwnPropertyNames(proto).forEach((key) => {
        if (key === 'constructor' || specKeysMap[key]) {
          return;
        }
        specKeysMap[key] = true;
        const callback = spec[key].bind(spec);
        if (hooks[key]) {
          hooks[key](callback);
        } else if (key.startsWith('should')) {
          it(key, callback);
        } else if (key.startsWith('fshould')) {
          fit(key, callback);
        } else if (key.startsWith('xshould')) {
          xit(key, callback);
        }
      });
      proto = Object.getPrototypeOf(proto);
    }
  });
}

const hooks = {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} as const;

type SpecHooks = {
  readonly [k in keyof typeof hooks]?: jest.Lifecycle;
};

export type Spec = {
  [prop: string]: jest.Lifecycle | any;
} & SpecHooks;
