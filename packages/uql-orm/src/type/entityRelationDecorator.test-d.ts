/**
 * Type-level regression tests for the relation decorators (`@OneToOne`, `@ManyToOne`, `@OneToMany`,
 * `@ManyToMany`) applied directly to a class property - not through `RelationOptionsFor` in isolation
 * (see `entityOptions.test-d.ts`), but through the actual `MemberDecorator` a real property must
 * accept. `entity` is inferred from the mandatory getter and then checked two ways: the property's
 * type must match the target entity, and its array-ness must match the cardinality.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import { Field, Id, ManyToMany, ManyToOne, OneToMany, OneToOne } from '../index.js';

class Company {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
}

class Project {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Company }) ownerId?: number;
  @ManyToOne({ entity: () => Company }) owner?: Company;
}

// Shares no property name with `Project`: TypeScript only flags a mismatch between two all-optional
// shapes when they have zero properties in common (its "weak type" detection), so `Company` - which
// shares `id` with `Project` - would not do here (see `entityOptions.test-d.ts`'s `Unrelated`).
class Unrelated {
  label?: string;
}

export class Employee {
  @Id({ type: Number }) id?: number;

  @Field({ references: () => Company }) companyId?: number;
  @ManyToOne({ entity: () => Company }) company?: Company;
  // @ts-expect-error `@ManyToOne` targets `Company`; the property must hold a `Company`, not a string
  @ManyToOne({ entity: () => Company }) badCompany?: string;

  @OneToOne({ entity: () => Company, mappedBy: 'id' }) sameSizedCompany?: Company;
  // @ts-expect-error a to-one cardinality cannot land on an array-typed property
  @OneToOne({ entity: () => Company, mappedBy: 'id' }) badOneToOne?: Company[];

  @OneToMany({ entity: () => Project, mappedBy: (project) => project.owner }) projects?: Project[];
  // @ts-expect-error a to-many cardinality needs an array-typed property
  @OneToMany({ entity: () => Project, mappedBy: 'owner' }) badProjects?: Project;

  @ManyToMany({ entity: () => Project, references: [{ local: 'employeeId', foreign: 'projectId' }] })
  sharedProjects?: Project[];
  // @ts-expect-error `@ManyToMany` targets `Project`; the property cannot hold `Unrelated[]`
  @ManyToMany({ entity: () => Project, references: [{ local: 'employeeId', foreign: 'projectId' }] })
  badSharedProjects?: Unrelated[];
}
