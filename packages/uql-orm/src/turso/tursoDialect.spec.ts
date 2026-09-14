import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import type { Json } from '../type/index.js';
import { TursoDialect } from './tursoDialect.js';
import { TursoLocalDialect } from './tursoLocalDialect.js';

/** A document with open keys, so one update can pass a call more arguments than libSQL takes. */
@Entity()
class TursoPreferences {
  @Id({ type: String })
  id?: string;

  @Field({ type: 'json' })
  values?: Json<Record<string, number>>;
}

const keys = Array.from({ length: 200 }, (_, at) => `k${at}`);

/** The `JSON_REMOVE` calls a wide `$unset` compiles to on `dialect`. */
function removeCalls(dialect: TursoDialect): number {
  const ctx = dialect.createContext();
  dialect.update(ctx, TursoPreferences, { $where: { id: 'p' } }, { values: { $unset: keys } });
  return ctx.sql.split('JSON_REMOVE(').length - 1;
}

describe('TursoDialect', () => {
  /** A Turso Cloud database runs libSQL unless it was created as `tursodb`, and libSQL caps a call at 127. */
  it('chains a wide JSON update into calls libSQL takes', () => {
    expect(removeCalls(new TursoDialect())).toBe(2);
  });
});

describe('TursoLocalDialect', () => {
  /** The embedded Rust engine caps no function call. */
  it('removes every key of a wide JSON update in one call', () => {
    expect(removeCalls(new TursoLocalDialect())).toBe(1);
  });
});
