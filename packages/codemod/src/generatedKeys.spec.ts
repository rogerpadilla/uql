import { describe, expect, it } from 'vitest';
import { toGeneratedKeys } from './generatedKeys.js';

const rewrite = (text: string) => toGeneratedKeys('/entities.ts', text);

describe('toGeneratedKeys', () => {
  it('should state the key the database used to generate unasked', () => {
    expect(rewrite(`class User { @Field(f.number().id()) id?: number; }`)).toBe(
      `class User { @Field(f.number().autoIncrement()) id?: number; }`,
    );
    expect(rewrite(`class User { @Field(f.number<UserId>().id()) id?: UserId; }`)).toBe(
      `class User { @Field(f.number<UserId>().autoIncrement()) id?: UserId; }`,
    );
    expect(rewrite(`class User { @Field(f.bigint().id()) id?: bigint; }`)).toBe(
      `class User { @Field(f.bigint().autoIncrement()) id?: bigint; }`,
    );
    expect(rewrite(`class User { @Field(f.column('int').id()) id?: number; }`)).toBe(
      `class User { @Field(f.column('int').autoIncrement()) id?: number; }`,
    );
  });

  it('should read the key past what is no column of the class', () => {
    expect(
      rewrite(
        `class User { @Other() kind?: string; @Frozen seen?: number; plain = 1; @Field(f.number().name('pk').id()) id?: number; }`,
      ),
    ).toBe(
      `class User { @Other() kind?: string; @Frozen seen?: number; plain = 1; @Field(f.number().name('pk').autoIncrement()) id?: number; }`,
    );
  });

  it("should state it in a defined entity's fields", () => {
    expect(
      rewrite(`const User = defineEntity({ name: 'User', fields: { id: f.number().id(), name: f.string() } });`),
    ).toBe(
      `const User = defineEntity({ name: 'User', fields: { id: f.number().autoIncrement(), name: f.string() } });`,
    );
  });

  it('should drop the key a generated column now states', () => {
    expect(rewrite(`class Done { @Field(f.number().id().autoIncrement()) id?: number; }`)).toBe(
      `class Done { @Field(f.number().autoIncrement()) id?: number; }`,
    );
  });

  it('should drop what generated nothing on a column no key', () => {
    expect(
      rewrite(`class Ticket { @Field(f.string().id()) id!: string; @Field(f.number().autoIncrement()) seq?: number; }`),
    ).toBe(`class Ticket { @Field(f.string().id()) id!: string; @Field(f.number()) seq?: number; }`);
    expect(
      rewrite(
        `class Pair { @Field(f.number().id()) a!: number; @Field(f.number().id()) b!: number; @Field(f.number().autoIncrement()) c?: number; }`,
      ),
    ).toBe(
      `class Pair { @Field(f.number().id()) a!: number; @Field(f.number().id()) b!: number; @Field(f.number()) c?: number; }`,
    );
  });

  it('should leave a key already written the new way', () => {
    const text = `class Done { @Field(f.number().autoIncrement()) id?: number; }`;
    expect(rewrite(text)).toBe(text);
  });

  it('should drop the opt-out, a key no longer needing one', () => {
    expect(rewrite(`class Ticket { @Field(f.number().autoIncrement(false)) seq?: number; }`)).toBe(
      `class Ticket { @Field(f.number()) seq?: number; }`,
    );
    expect(rewrite(`class Region { @Field(f.number().id().autoIncrement(false)) code!: number; }`)).toBe(
      `class Region { @Field(f.number().id()) code!: number; }`,
    );
  });

  it.each([
    ['a composite key', `class Pair { @Field(f.number().id()) a!: number; @Field(f.number().id()) b!: number; }`],
    ['a text key', `class Note { @Field(f.string().id()) id?: string; }`],
    ['a key of no builder', `class Note { @Field(held.id()) id?: number; }`],
    ['a text column', `class Note { @Field(f.column('text').id()) id?: string; }`],
    ['a type that only spells int', `class Spot { @Field(f.column('point').id()) at!: string; }`],
    ['a key filled on insert', `class Seq { @Field(f.number().id().onInsert(next)) id?: number; }`],
    ['a column reference', `class Visa { @Field(f.number().id().references(() => Person)) id!: number; }`],
    [
      'a key a relation shares',
      `class Visa { @Field(f.number().id()) id!: number; @OneToOne({ entity: () => Person, references: (visa) => visa.id }) person?: Person; }`,
    ],
    [
      'a key a defined relation shares',
      `const Visa = defineEntity({ name: 'Visa', fields: { id: f.number().id() } }).relations((rel) => ({ person: () => rel.oneToOne(Person, { references: (visa) => visa.id }) }));`,
    ],
  ])('should leave %s', (_case, text) => {
    expect(rewrite(text)).toBe(text);
  });
});
