/**
 * A column is NOT NULL unless `nullable()` says otherwise, and a read hydrates a nullable one's `null`, so the
 * property admits it: a decorator checks the property it is applied to, and a defined entity derives it
 * (`definedEntity.test-d.ts`). Type-checked by `bun run ts` only.
 */
import { Entity, f, Field } from '../entity/index.js';
import { idKey } from './entity.js';
import type { Json } from './utility.js';

@Entity()
class Ledger {
  [idKey]?: 'id' | 'alternateKey';
  @Field(f.number().id()) id?: number;

  @Field(f.string().nullable()) note?: string | null;
  @Field(f.string()) code?: string;

  // @ts-expect-error the column holds null, and the property does not admit it
  @Field(f.string().nullable()) tight?: string;

  // @ts-expect-error a NOT NULL column never reads null, so a property admitting it says what is not so
  @Field(f.string()) wide?: string | null;

  // A key is NOT NULL on every engine, a composite one's every column too.
  @Field(f.number().id()) alternateKey?: number;

  // A family the property narrows: `numeric` reads as exact text, `bigint` either number kind, `jsonb` any document.
  @Field(f.column('numeric').nullable()) amount?: string | null;
  @Field(f.column('bigint').nullable()) total?: number | null;
  @Field(f.jsonb().nullable()) payload?: Json<{ lines: number }> | null;
}

export { Ledger };
