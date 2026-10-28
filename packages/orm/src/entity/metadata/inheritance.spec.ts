import { describe, expect, it } from 'vitest';
import { sql } from '../../util/sql.js';
import { BeforeInsert, Entity, f, Field } from '../index.js';
import { defineEntity, getEntities, getMeta } from './definition.js';

const body = () => sql`PERFORM 1;`;

describe('what a subclass inherits of its bases', () => {
  @Entity({
    abstract: true,
    triggers: (tenanted, trigger) => [trigger({ on: 'afterInsert', run: body })],
    indexes: (tenanted, index) => [index([tenanted.tenant])],
  })
  class Tenanted {
    @Field(f.number().id()) id?: number;
    @Field(f.string().nullable()) tenant?: string | null;
    @BeforeInsert() stamp() {}
  }

  @Entity()
  class Invoice extends Tenanted {
    @Field(f.number().nullable()) total?: number | null;
  }

  @Entity()
  class PaidInvoice extends Invoice {
    @Field(f.date().nullable()) paidAt?: Date | null;
  }

  it('should inherit each entry once, through a registered class as through none', () => {
    const meta = getMeta(PaidInvoice);

    expect(meta.hooks?.beforeInsert).toMatchObject([{ methodName: 'stamp' }]);
    expect(meta.indexes).toHaveLength(1);
    expect(meta.triggers).toHaveLength(1);
  });

  it('should inherit the checks a registered base declares', () => {
    @Entity({ checks: (wallet, check) => [check({ balance: { $gte: 0 } }, 'positive')] })
    class Wallet {
      @Field(f.number().id()) id?: number;
      @Field(f.number().nullable()) balance?: number | null;
    }
    @Entity()
    class Savings extends Wallet {
      @Field(f.number().nullable()) rate?: number | null;
    }

    expect(getMeta(Savings).checks?.map((check) => check.name)).toEqual(['positive']);
  });

  it("should put a base entry ahead of the subclass's own", () => {
    @Entity({ indexes: (quote, index) => [index([quote.tenant], { unique: true })] })
    class Quote extends Tenanted {}

    expect(getMeta(Quote).indexes?.map((index) => index.unique)).toEqual([false, true]);
  });

  it('should let a subclass entry of the same name replace the base one', () => {
    @Entity({
      abstract: true,
      triggers: (named, trigger) => [trigger({ on: 'afterInsert', name: 'audit', run: body })],
      indexes: (named, index) => [index([named.tenant], 'by_tenant')],
    })
    class Named {
      @Field(f.number().id()) id?: number;
      @Field(f.string().nullable()) tenant?: string | null;
    }
    @Entity({
      triggers: (own, trigger) => [trigger({ on: 'beforeInsert', name: 'audit', run: body })],
      indexes: (own, index) => [index([own.tenant], { name: 'by_tenant', unique: true })],
    })
    class Own extends Named {}

    const meta = getMeta(Own);

    expect(meta.indexes?.map((index) => index.unique)).toEqual([true]);
    expect(meta.triggers?.map((trigger) => trigger.on)).toEqual(['beforeInsert']);
  });
});

it('should keep the indexes an entity declares over a base declaring none', () => {
  abstract class Plain {
    @Field(f.number().id()) id?: number;
  }
  @Entity({ indexes: (sku, index) => [index([sku.code])] })
  class Sku extends Plain {
    @Field(f.string().nullable()) code?: string | null;
  }

  expect(getMeta(Sku).indexes).toHaveLength(1);
});

describe('an abstract base', () => {
  @Entity({
    abstract: true,
    indexes: (audited, index) => [index([audited.at])],
    triggers: (audited, trigger) => [trigger({ on: 'afterInsert', run: body })],
  })
  abstract class Audited {
    @Field(f.date().nullable()) at?: Date | null;
  }

  @Entity()
  class Receipt extends Audited {
    @Field(f.number().id()) id?: number;
  }

  it('should pass what it declares to the entities extending it, with no key of its own', () => {
    const meta = getMeta(Receipt);

    expect(Object.keys(meta.fields)).toEqual(['at', 'id']);
    expect(meta.indexes).toHaveLength(1);
    expect(meta.triggers).toHaveLength(1);
  });

  it('should never be a table', () => {
    expect(getEntities()).toContain(Receipt);
    expect(getEntities()).not.toContain(Audited);
    expect(() => getMeta(Audited)).toThrow("'Audited' is abstract: read an entity extending it");
  });

  it('should be declared by defineEntity too', () => {
    const Stamped = defineEntity({ name: 'Stamped', abstract: true, fields: { at: f.date().nullable() } });
    const Visit = defineEntity({ name: 'Visit', extends: Stamped, fields: { id: f.number().id() } });

    expect(Object.keys(getMeta(Visit).fields)).toEqual(['at', 'id']);
    expect(getEntities()).not.toContain(Stamped);
  });
});
