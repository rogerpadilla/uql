import { ManyToOne } from './relation.js';

it('invalid auto-inferred type', () => {
  expect(() => {
    class SomeEntity {
      @ManyToOne()
      idTwo: number;
    }
  }).toThrow(`'SomeEntity.idTwo' type was auto-inferred with invalid type 'Number'`);
  expect(() => {
    class SomeEntity {
      @ManyToOne()
      idTwo: string;
    }
  }).toThrow(`'SomeEntity.idTwo' type was auto-inferred with invalid type 'String'`);
  expect(() => {
    class SomeEntity {
      @ManyToOne()
      idTwo: boolean;
    }
  }).toThrow(`'SomeEntity.idTwo' type was auto-inferred with invalid type 'Boolean'`);
  expect(() => {
    class SomeEntity {
      @ManyToOne()
      idTwo: object;
    }
  }).toThrow(`'SomeEntity.idTwo' type was auto-inferred with invalid type 'Object'`);
  expect(() => {
    class SomeEntity {
      @ManyToOne()
      idTwo: null;
    }
  }).toThrow(`'SomeEntity.idTwo' type was auto-inferred with invalid type 'undefined'`);
  expect(() => {
    class SomeEntity {
      @ManyToOne()
      idTwo: undefined;
    }
  }).toThrow(`'SomeEntity.idTwo' type was auto-inferred with invalid type 'undefined'`);
});
