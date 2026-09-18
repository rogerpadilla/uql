/**
 * A column holds `null` unless `nullable: false` says otherwise, and a read hydrates one, so the
 * property admits it. Both spellings state the rule: a decorator checks the property it is applied to,
 * `defineEntity` checks the options against the property. Type-checked by `bun run ts` only.
 */
import { defineEntity, Entity, Field, Id } from '../entity/index.js';
import type { FieldOptionsFor } from './entity.js';
import type { Json } from './utility.js';

@Entity()
class Ledger {
  @Id({ type: Number }) id?: number;

  @Field({ type: String }) note?: string | null;
  @Field({ type: String, nullable: false }) code?: string;
  @Field({ type: String, nullable: true }) loud?: string | null;

  // @ts-expect-error the column holds null, and the property does not admit it
  @Field({ type: String }) tight?: string;

  // @ts-expect-error `nullable: false` is what makes a property that refuses null honest
  @Field({ type: String, nullable: false }) wide?: string | null;

  // A key is NOT NULL on every engine, whichever decorator declares it.
  @Field({ type: Number, isId: true }) alternateKey?: number;

  // A family the property narrows: `numeric` reads either number kind, `jsonb` any document.
  @Field({ type: 'numeric' }) amount?: number | null;
  @Field({ type: 'jsonb' }) payload?: Json<{ lines: number }> | null;
}

class Defined {
  id?: number;
  note?: string | null;
  code?: string;
}

defineEntity(Defined, {
  fields: {
    id: { type: Number, isId: true },
    note: { type: String },
    code: { type: String, nullable: false },
  },
});

// @ts-expect-error a property that refuses null needs the column to refuse one too
const refused: FieldOptionsFor<string> = { type: String };

export { Ledger, Defined, refused };
