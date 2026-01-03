import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';

export function createSpec<T extends Spec>(spec: T) {
  const proto: FunctionConstructor = Object.getPrototypeOf(spec);
  let describeFn: typeof describe | typeof describe.only | typeof describe.skip;
  const specName = proto.constructor.name;

  if (specName.startsWith('fff')) {
    describeFn = describe.only;
  } else if (specName.startsWith('xxx')) {
    describeFn = describe.skip;
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
      const callback: () => void | Promise<void> = spec[key].bind(spec);
      if (hooks[key]) {
        hooks[key](callback);
      } else if (key.startsWith('should')) {
        it(key, callback);
      } else if (key.startsWith('fffShould')) {
        it.only(key, callback);
      } else if (key.startsWith('xxxShould')) {
        it.skip(key, callback);
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
  readonly [k: string]: (() => void | Promise<void>) | any;
};
