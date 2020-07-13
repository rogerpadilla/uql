import { PrimaryColumn } from './primaryColumn';

it('multiple @PrimaryColumn', () => {
  expect(() => {
    class SomeEntity {
      @PrimaryColumn()
      idOne: string;
      @PrimaryColumn()
      idTwo: string;
    }
  }).toThrow(`'SomeEntity' must have a single field decorated with @PrimaryColumn`);
});
