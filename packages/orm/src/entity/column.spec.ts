import { describe, expect, it } from 'vitest';
import { COLUMN_OPTIONS } from '../type/index.js';
import { sql } from '../util/sql.js';
import { f } from './column.js';

const optionsOf = (column: { readonly [COLUMN_OPTIONS]: object }) => column[COLUMN_OPTIONS];

describe('f', () => {
  it('should write the options the registry reads, each method one of them', () => {
    expect(optionsOf(f.string().nullable().length(80).default('x').unique().index('by_name'))).toEqual({
      type: String,
      nullable: true,
      length: 80,
      defaultValue: 'x',
      unique: true,
      index: 'by_name',
    });
    expect(optionsOf(f.number().id().autoIncrement(false).name('pk').comment('the key'))).toEqual({
      type: Number,
      isId: true,
      autoIncrement: false,
      name: 'pk',
      comment: 'the key',
    });
  });

  it('should spell each column type its constructor names', () => {
    expect(optionsOf(f.text())).toEqual({ type: 'text' });
    expect(optionsOf(f.uuid())).toEqual({ type: 'uuid' });
    expect(optionsOf(f.bigint())).toEqual({ type: BigInt });
    expect(optionsOf(f.boolean())).toEqual({ type: Boolean });
    expect(optionsOf(f.date())).toEqual({ type: Date });
    expect(optionsOf(f.decimal(12, 2))).toEqual({ type: 'decimal', precision: 12, scale: 2 });
    expect(optionsOf(f.decimal())).toEqual({ type: 'decimal' });
    expect(optionsOf(f.json())).toEqual({ type: 'json' });
    expect(optionsOf(f.jsonb({ theme: String }))).toEqual({ type: 'jsonb', shape: { theme: String } });
    expect(optionsOf(f.vector(3).distance('l2'))).toEqual({
      type: 'vector',
      dimensions: 3,
      distance: 'l2',
    });
    expect(optionsOf(f.column('timestamptz').precision(6))).toEqual({
      type: 'timestamptz',
      precision: 6,
    });
    expect(optionsOf(f.version())).toEqual({ type: Number, version: true });
  });

  it('should type an enum by its members', () => {
    expect(optionsOf(f.enum(['draft', 'paid']))).toEqual({ type: String, enum: ['draft', 'paid'] });
    expect(optionsOf(f.enum([1, 2]))).toEqual({ type: Number, enum: [1, 2] });
  });

  it('should default a flag to on, and a soft delete to now', () => {
    expect(optionsOf(f.date().nullable().softDelete().index())).toEqual({
      type: Date,
      nullable: true,
      softDelete: true,
      index: true,
    });
  });

  it('should keep a foreign key, its action and a computed column', () => {
    class User {}
    const target = () => User;
    expect(optionsOf(f.references(target).onDelete('CASCADE'))).toEqual({
      references: target,
      onDelete: 'CASCADE',
    });
    const upper = sql`upper(name)`;
    expect(optionsOf(f.string().as(upper).stored())).toEqual({
      type: String,
      computed: upper,
      stored: true,
    });
    expect(optionsOf(f.date().as(upper).stored(['update']))).toEqual({
      type: Date,
      computed: upper,
      stored: ['update'],
    });
  });

  it('should never change a builder another column reuses', () => {
    const money = f.decimal(12, 2);
    const price = money.nullable();
    expect(optionsOf(money)).toEqual({ type: 'decimal', precision: 12, scale: 2 });
    expect(optionsOf(price)).toEqual({ type: 'decimal', precision: 12, scale: 2, nullable: true });
    expect(money.narrow()).toBe(money);
  });
});
