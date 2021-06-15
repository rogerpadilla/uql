import {
  describe,
  fdescribe,
  xdescribe,
  it,
  fit,
  xit,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from '@jest/globals';

export function createSpec<T extends Spec>(spec: T) {
  const processedMethodsMap: { [k: string]: true } = {};
  let proto: object = Object.getPrototypeOf(spec);

  let describeFn: typeof fdescribe;

  const specName = proto.constructor.name;

  if (specName.startsWith('Fff')) {
    describeFn = fdescribe;
  } else if (specName.startsWith('Xxx')) {
    describeFn = xdescribe;
  } else {
    describeFn = describe;
  }

  describeFn(specName, () => {
    while (proto.constructor !== Object) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor' || processedMethodsMap[key]) {
          continue;
        }
        processedMethodsMap[key] = true;
        const callback = spec[key].bind(spec);
        if (hooks[key]) {
          hooks[key](callback);
        } else if (key.startsWith('should')) {
          it(key, callback);
        } else if (key.startsWith('fffshould')) {
          fit(key, callback);
        } else if (key.startsWith('xxxshould')) {
          xit(key, callback);
        }
      }
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
