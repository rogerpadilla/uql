/**
 * The relation decorators on a real property: the inferred target must match the property's type, its
 * array-ness the cardinality, and a to-one holding the key must name it in `references` on columns that
 * can hold it. Type-checked by `bun run ts` only.
 */
import {
  BeforeInsert,
  f,
  Field,
  type HookContext,
  idKey,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
} from '../index.js';

class Company {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) name?: string | null;
}

class StringKeyed {
  @Field(f.string().id()) id?: string;
}

export class Pointer {
  @Field(f.number().id()) id?: number;
  @Field(
    f
      .string()
      .nullable()
      .references(() => StringKeyed),
  )
  keyedId?: string | null;
  @Field(
    f
      .number()
      .nullable()
      // @ts-expect-error a foreign key holds the key it references, a string here
      .references(() => StringKeyed),
  )
  miskeyedId?: number | null;
}

class Project {
  @Field(f.number().id()) id?: number;
  @Field(f.references(() => Company).nullable()) ownerId?: number | null;
  @ManyToOne({ entity: () => Company, references: (project) => project.ownerId }) owner?: Company;
}

// Shares no property name with `Project`: TypeScript only flags a mismatch between two all-optional
// shapes when they have zero properties in common (its "weak type" detection), so `Company` - which
// shares `id` with `Project` - would not do here (see `entityOptions.test-d.ts`'s `Unrelated`).
class Unrelated {
  label?: string;
}

export class Employee {
  @Field(f.number().id()) id?: number;

  @Field(f.references(() => Company).nullable()) companyId?: number | null;
  @ManyToOne({ entity: () => Company, references: (employee) => employee.companyId }) company?: Company;
  // @ts-expect-error `@ManyToOne` targets `Company`; the property must hold a `Company`, not a string.
  // Its `references` is what a valid one takes, so what this pins is the property's type and nothing else.
  @ManyToOne({ entity: () => Company, references: (employee) => employee.companyId }) badCompany?: string;
  // @ts-expect-error `references` names a column of the declaring entity, never a relation
  @ManyToOne({ entity: () => Company, references: (employee) => employee.company }) employer?: Company;
  // @ts-expect-error a to-many pairs its columns; naming one is for the side of a to-one holding the key
  @OneToMany({ entity: () => Project, references: (employee) => employee.id }) ownedProjects?: Project[];

  @OneToOne({ entity: () => Company, mappedBy: (company) => company.id }) sameSizedCompany?: Company;
  // @ts-expect-error a to-one owns the key or is mapped by the other side, never both
  @OneToOne({ entity: () => Company, references: (employee) => employee.companyId, mappedBy: (company) => company.id })
  bothSides?: Company;
  // @ts-expect-error a to-many reaches its rows through a junction or the columns, never a mapping too
  @ManyToMany({ entity: () => Company, through: () => Project, mappedBy: (company) => company.id })
  mixedJoin?: Company[];
  // @ts-expect-error a to-one cardinality cannot land on an array-typed property
  @OneToOne({ entity: () => Company, mappedBy: (company) => company.id }) badOneToOne?: Company[];

  @OneToMany({ entity: () => Project, mappedBy: (project) => project.owner }) projects?: Project[];
  // @ts-expect-error a to-many cardinality needs an array-typed property
  @OneToMany({ entity: () => Project, mappedBy: (project) => project.owner }) badProjects?: Project;

  @ManyToMany({
    entity: () => Project,
    references: (employee, project) => [{ local: employee.id, foreign: project.ownerId }],
  })
  sharedProjects?: Project[];
  // @ts-expect-error `@ManyToMany` targets `Project`; the property cannot hold `Unrelated[]`
  @ManyToMany({
    entity: () => Project,
    references: (employee, project) => [{ local: employee.id, foreign: project.ownerId }],
  })
  badSharedProjects?: Unrelated[];
}

abstract class Authored {
  @Field(f.references(() => Company).nullable()) creatorId?: number | null;
  @ManyToOne({ entity: () => Company, references: (authored) => authored.creatorId }) creator?: Company;
}

export class Contract extends Authored {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error the owning side of a one-to-one holds its foreign key the same way
  @OneToOne({ entity: () => Company }) vendor?: Company;
}

abstract class Unkeyed {
  // @ts-expect-error `references` reads the class declaring the relation, which a subclass's column is not on
  @ManyToOne({ entity: () => Company, references: (unkeyed) => unkeyed.ownerId }) owner?: Company;
}
export class Keyed extends Unkeyed {
  @Field(f.number().id()) id?: number;
  @Field(f.references(() => Company).nullable()) ownerId?: number | null;
}

class Berth {
  [idKey]?: 'dock' | 'slot';
  @Field(f.string().id()) dock?: string;
  @Field(f.number().id()) slot?: number;
}

export class Mooring {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) companyCode?: string | null;
  // @ts-expect-error a foreign key holds the value of the key it references, and `Company.id` is a number
  @ManyToOne({ entity: () => Company, references: (mooring) => mooring.companyCode }) company?: Company;

  @Field(f.string().nullable()) berthDock?: string | null;
  @Field(f.number().nullable()) berthSlot?: number | null;
  @ManyToOne({
    entity: () => Berth,
    references: (mooring, berth) => [
      { local: mooring.berthDock, foreign: berth.dock },
      { local: mooring.berthSlot, foreign: berth.slot },
    ],
  })
  berth?: Berth;
  @ManyToOne({
    entity: () => Berth,
    // @ts-expect-error each column holds the value of the key it is paired with
    references: (mooring, berth) => [
      { local: mooring.berthSlot, foreign: berth.dock },
      { local: mooring.berthSlot, foreign: berth.slot },
    ],
  })
  crossed?: Berth;
  // @ts-expect-error one column cannot hold a key of several
  @ManyToOne({ entity: () => Berth, references: (mooring) => mooring.berthDock }) sole?: Berth;
}

type Uuid = `${string}-${string}`;

class Ledger {
  @Field(f.uuid().id()) id?: Uuid;
}

class Note {
  @Field(f.number().id()) id?: number;
}

/** A column holds every value of the key it joins: a wider one does, a narrower one does not. */
export class Entry {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) ledgerCode?: string | null;
  @ManyToOne({ entity: () => Ledger, references: (entry) => entry.ledgerCode }) ledger?: Ledger;
  @Field(f.string().nullable()) noteRef?: Uuid | null;
  // @ts-expect-error a `Uuid` column cannot hold every `number` key
  @ManyToOne({ entity: () => Note, references: (entry) => entry.noteRef }) note?: Note;
}

class Review {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) body?: string | null;
  @Field(f.number().nullable()) berthSlot?: number | null;
  @Field(f.references(() => Company).nullable()) companyId?: number | null;
  @ManyToOne({ entity: () => Company, references: (review) => review.companyId }) company?: Company;
  touch(): void {}
}

/** `mappedBy` names the member of the target holding this side's key: its relation, or its one column. */
export class Reviewed {
  @Field(f.number().id()) id?: number;
  @OneToMany({ entity: () => Review, mappedBy: (review) => review.company }) byRelation?: Review[];
  @OneToMany({ entity: () => Review, mappedBy: (review) => review.companyId }) byColumn?: Review[];
  // @ts-expect-error a method holds no key
  @OneToMany({ entity: () => Review, mappedBy: (review) => review.touch }) byMethod?: Review[];
  // @ts-expect-error a string column cannot hold this side's number key
  @OneToMany({ entity: () => Review, mappedBy: (review) => review.body }) byBody?: Review[];
}

export class ReviewedBerth {
  [idKey]?: 'dock' | 'slot';
  @Field(f.string().id()) dock?: string;
  @Field(f.number().id()) slot?: number;
  // @ts-expect-error one column cannot hold a composite key: map it by the relation on the other side
  @OneToMany({ entity: () => Review, mappedBy: (review) => review.berthSlot }) reviews?: Review[];
}

export class Docking {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error a column references one key, and `Berth`'s is composite
  @Field(f.references(() => Berth).nullable()) berthId?: number | null;
}

/** A hook runs on the row with the querier's context, so it takes nothing else. */
export class Hooked {
  @Field(f.number().id()) id?: number;
  @BeforeInsert() touch(): void {}
  @BeforeInsert() async audit(ctx: HookContext): Promise<void> {
    await ctx.querier.count(Hooked, {});
  }
  // @ts-expect-error a hook is given the context, never a number
  @BeforeInsert() stamp(n: number): void {
    void n;
  }
}
