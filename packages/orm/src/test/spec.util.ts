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

/**
 * Budget for a suite's setup and teardown, which drop and create every fixture table over the wire, and for
 * a case writing as many rows: a contended CI database can take seconds to serve that, so holding it to a
 * test's budget turns a slow database into a red build. Both runners take it as a hook's second argument.
 */
export const provisioningTimeout = 60_000;

type SpecHook = () => unknown;

/** Per-test hooks keep the runner's default, so a genuinely hung connection still fails fast. */
const hooks = new Map<string, (hook: SpecHook) => void>([
  ['beforeAll', (hook) => beforeAll(hook, provisioningTimeout)],
  ['afterAll', (hook) => afterAll(hook, provisioningTimeout)],
  ['beforeEach', beforeEach],
  ['afterEach', afterEach],
]);

/** A suite's test cases by name. */
type SpecCase<T> = Extract<keyof T, `should${string}`>;

/**
 * Which cases a suite's engine can run, `false` reporting one as skipped: a case never branches on the
 * engine inside its body, where a missing capability would pass having asserted nothing.
 */
export type SpecRequirements<T> = { readonly [K in SpecCase<T>]?: boolean };

/** The cases given {@link provisioningTimeout} or a budget of their own, the rest keeping the runner's default. */
export type SpecTimeouts<T> = { readonly [K in SpecCase<T>]?: number };

/** A suite as a class: its hooks, its `should...` cases, and which of them the engine runs. */
export type Spec = {
  beforeAll?(): unknown;
  afterAll?(): unknown;
  beforeEach?(): unknown;
  afterEach?(): unknown;
  requirements?(): Readonly<Record<string, boolean | undefined>>;
  timeouts?(): Readonly<Record<string, number | undefined>>;
};

/** Registers `spec`'s hooks and cases under its class name, a method shadowing the one it overrides. */
export function createSpec(spec: Spec): void {
  describe(spec.constructor.name, () => {
    const requirements = spec.requirements?.() ?? {};
    const timeouts = spec.timeouts?.() ?? {};
    for (const [key, run] of methodsOf(spec)) {
      const hook = hooks.get(key);
      if (hook) {
        hook(run);
      } else if (key.startsWith('should')) {
        (requirements[key] === false ? it.skip : it)(key, run, timeouts[key]);
      }
    }
  });
}

/** Each method `spec` answers to, bound to it, the nearest definition of a name winning. */
function methodsOf(spec: object): Map<string, SpecHook> {
  const methods = new Map<string, SpecHook>();
  for (let proto = Object.getPrototypeOf(spec); proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      const method: unknown = Object.getOwnPropertyDescriptor(proto, key)?.value;
      if (key !== 'constructor' && typeof method === 'function' && !methods.has(key)) {
        methods.set(key, () => method.call(spec));
      }
    }
  }
  return methods;
}
