import { describe, expect, it } from 'vitest';
import { sql } from '../../util/sql.js';
import { BeforeInsert, Entity, Field, Id, Index, Trigger } from '../index.js';
import { getMeta } from './definition.js';

const body = () => sql`PERFORM 1;`;

describe('what a subclass inherits of its bases', () => {
  @Index((tenanted) => [tenanted.tenant])
  @Trigger({ on: 'afterInsert', run: body })
  class Tenanted {
    @Id({ type: Number }) id?: number;
    @Field({ type: String }) tenant?: string | null;
    @BeforeInsert() stamp() {}
  }

  @Entity()
  class Invoice extends Tenanted {
    @Field({ type: Number }) total?: number | null;
  }

  @Entity()
  class PaidInvoice extends Invoice {
    @Field({ type: Date }) paidAt?: Date | null;
  }

  it('should inherit each entry once, through a registered class as through none', () => {
    const meta = getMeta(PaidInvoice);

    expect(meta.hooks?.beforeInsert).toEqual([{ methodName: 'stamp' }]);
    expect(meta.indexes).toHaveLength(1);
    expect(meta.triggers).toHaveLength(1);
  });

  it('should inherit the checks a registered base declares', () => {
    @Entity({ checks: [{ name: 'positive', where: { balance: { $gte: 0 } } }] })
    class Wallet {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number }) balance?: number | null;
    }
    @Entity()
    class Savings extends Wallet {
      @Field({ type: Number }) rate?: number | null;
    }

    expect(getMeta(Savings).checks?.map((check) => check.name)).toEqual(['positive']);
  });

  it("should put a base entry ahead of the subclass's own", () => {
    @Entity()
    @Index((quote) => [quote.tenant], { unique: true })
    class Quote extends Tenanted {}

    expect(getMeta(Quote).indexes?.map((index) => index.unique)).toEqual([false, true]);
  });

  it('should let a subclass entry of the same name replace the base one', () => {
    @Index((named) => [named.tenant], { name: 'by_tenant' })
    @Trigger({ on: 'afterInsert', name: 'audit', run: body })
    class Named {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) tenant?: string | null;
    }
    @Entity()
    @Index((own) => [own.tenant], { name: 'by_tenant', unique: true })
    @Trigger({ on: 'beforeInsert', name: 'audit', run: body })
    class Own extends Named {}

    const meta = getMeta(Own);

    expect(meta.indexes?.map((index) => index.unique)).toEqual([true]);
    expect(meta.triggers?.map((trigger) => trigger.on)).toEqual(['beforeInsert']);
  });
});
