/* eslint-disable jest/valid-title */
/* eslint-disable jest/expect-expect */
/* eslint-disable jest/no-export */
export function createSpec<T extends Spec>(spec: T) {
  let parentProto: object = Object.getPrototypeOf(spec);
  while (parentProto.constructor !== Object) {
    setupTestCases(spec, parentProto);
    parentProto = Object.getPrototypeOf(parentProto);
  }
}

function setupTestCases<T extends Spec>(spec: T, proto: object) {
  Object.getOwnPropertyNames(proto).forEach((key) => {
    if (typeof spec[key] === 'function' && key !== 'constructor') {
      const callback = spec[key].bind(spec);
      if (['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(key)) {
        globalThis[key](callback);
      } else {
        it(key, callback);
      }
    }
  });
}

export interface Spec {
  beforeEach?: jest.Lifecycle;
  afterEach?: jest.Lifecycle;
  [title: string]: jest.Lifecycle | any;
}
