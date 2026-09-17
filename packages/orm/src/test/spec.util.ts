import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/** The shape of a generated key, whose value a test cannot know. */
export const uuidPattern = /^[0-9a-f-]{36}$/;

/**
 * Matches any column holding a generated key. Stateless, so one instance serves every assertion.
 * Annotated `string` - the value is a matcher object, but vitest types `stringMatching` as `any`,
 * which would spread to every call site.
 */
export const anyUuid: string = expect.stringMatching(uuidPattern);

/** Fails the test where `value` is missing, and narrows it where it is not. */
export function assertDefined<T>(value: T | undefined, message?: string): asserts value is T {
  expect(value, message).toBeDefined();
}

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

function createTestCases(spec: Spec) {
  let proto: FunctionConstructor = Object.getPrototypeOf(spec);
  const requirements: Readonly<Record<string, boolean | undefined>> = spec.requirements?.() ?? {};

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
        (requirements[key] === false ? it.skip : it)(key, callback);
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

/** A suite's test cases by name. */
export type SpecCase<T> = Extract<keyof T, `should${string}`>;

/**
 * Which cases a suite's engine can run, `false` reporting one as skipped: a case never branches on the
 * engine inside its body, where a missing capability would pass having asserted nothing.
 */
export type SpecRequirements<T> = { readonly [K in SpecCase<T>]?: boolean };

export type Spec = Partial<typeof hooks> & {
  readonly requirements?: () => Readonly<Record<string, boolean | undefined>>;
  // oxlint-disable-next-line typescript/no-explicit-any -- `any` is required - `unknown` makes index signature incompatible with concrete spec classes
  readonly [k: string]: SpecHook | any;
};
