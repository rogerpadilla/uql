import { Entity } from './entity';
import { Column } from './column';

it('no @PrimaryColumn', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Column()
      id: string;
    }
  }).toThrow(`'SomeEntity' must have at least one field decorated with @PrimaryColumn`);
});

it('no columns', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id: string;
    }
  }).toThrow(`'SomeEntity' must have columns`);
});
