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

function createTestCases(spec: Record<string, unknown>) {
  let proto: FunctionConstructor = Object.getPrototypeOf(spec);

  const processedMethodsMap: { [k: string]: true } = {};

  while (proto.constructor !== Object) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      const isProcessed = processedMethodsMap[key];
      processedMethodsMap[key] = true;
      const method = spec[key];
      if (isProcessed || key === 'constructor' || typeof method !== 'function') {
        continue;
      }
      const callback = (method as () => void | Promise<void>).bind(spec);
      const hookFn = hooks[key as keyof typeof hooks];
      if (hookFn) {
        hookFn(callback);
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
