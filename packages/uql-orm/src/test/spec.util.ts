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
      const callback = (method as SpecHook).bind(spec);
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

/**
 * Budget for a suite's setup and teardown, which drop and create every fixture table over the wire: a
 * contended CI database can take seconds to serve that, so holding it to a test's budget turns a slow
 * database into a red build. Exported for the few such hooks written by hand rather than through
 * {@link createSpec}. Both runners honour it as a hook's second argument.
 */
export const provisioningTimeout = 60_000;

/** Per-test hooks are left on the runner's default, so a genuinely hung connection still fails fast. */
const hooks = {
  beforeAll: (fn: SpecHook) => beforeAll(fn, provisioningTimeout),
  afterAll: (fn: SpecHook) => afterAll(fn, provisioningTimeout),
  beforeEach,
  afterEach,
} as const;

type SpecHook = () => void | Promise<void>;

export type Spec = Partial<typeof hooks> & {
  // biome-ignore lint/suspicious/noExplicitAny: `any` is required - `unknown` makes index signature incompatible with concrete spec classes
  readonly [k: string]: SpecHook | any;
};
