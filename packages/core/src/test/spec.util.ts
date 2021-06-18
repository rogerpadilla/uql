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

import type { Global } from '@jest/types';

export function createSpec<T extends Spec>(spec: T) {
  const proto: FunctionConstructor = Object.getPrototypeOf(spec);
  let describeFn: Global.DescribeBase;
  const specName = proto.constructor.name;

  if (specName.startsWith('Fff')) {
    describeFn = fdescribe;
  } else if (specName.startsWith('Xxx')) {
    describeFn = xdescribe;
  } else {
    describeFn = describe;
  }

  describeFn(specName, () => createTestCases(spec));
}

function createTestCases(spec: object) {
  let proto: FunctionConstructor = Object.getPrototypeOf(spec);

  const processedMethodsMap: { [k: string]: true } = {};

  while (proto.constructor !== Object) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      const isProcessed = processedMethodsMap[key];
      processedMethodsMap[key] = true;
      if (isProcessed || key === 'constructor' || typeof spec[key] !== 'function') {
        continue;
      }
      const callback: Global.TestFn = spec[key].bind(spec);
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
}

const hooks = {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} as const;

type SpecHooks = Partial<typeof hooks>;

export type Spec = SpecHooks & {
  readonly [k: string]: Global.It | any;
};
