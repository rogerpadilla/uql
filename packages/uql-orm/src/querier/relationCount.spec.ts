import { describe, expect, it } from 'vitest';
import { COUNT_ALIAS } from '../dialect/aliases.js';
import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';
import { COUNT_RESULT_KEY, type Querier } from '../type/index.js';
import { fillRelationCounts } from './relationCount.js';

@Entity()
class Team {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) ownerId?: number;
  @ManyToOne({ entity: () => Owner }) owner?: Owner;
  @OneToMany({ entity: () => Player, mappedBy: (it) => it.team }) players?: Player[];
}

@Entity()
class Owner {
  @Id({ type: Number }) id?: number;
}

@Entity()
class Player {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) teamId?: number;
  @ManyToOne({ entity: () => Team }) team?: Team;
}

/** Answers whatever grouped rows the test hands it, so what is asserted is how they are matched back. */
function querierOf(rows: Record<string, unknown>[]): Pick<Querier, 'aggregate' | 'findMany'> {
  return {
    aggregate: async () => rows,
    findMany: async () => [],
  } as unknown as Pick<Querier, 'aggregate' | 'findMany'>;
}

describe('fillRelationCounts', () => {
  it('matches a to-many tally to its parent', async () => {
    const payload = [{ id: 1 }, { id: 2 }] as Team[];
    const querier = querierOf([{ teamId: 1, [COUNT_ALIAS]: 3 }]);

    await fillRelationCounts(querier, Team, payload, { players: true });

    expect(payload.map((it) => (it as Record<string, unknown>)[COUNT_RESULT_KEY])).toEqual([
      { players: 3 },
      { players: 0 },
    ]);
  });

  /**
   * `$count` is typed to to-many keys, so this is what an untyped caller reaches - parsed JSON over
   * HTTP. A many-to-one groups by the *target's* key and correlates on the parent's own foreign key
   * column, which is not the parent's primary key: reading the parent through `meta.ids` looked every
   * tally up under the wrong value and answered zero for all of them.
   */
  it('matches a to-one tally through the relation own join columns, not the parent key', async () => {
    const payload = [
      { id: 1, ownerId: 70 },
      { id: 2, ownerId: 80 },
    ] as Team[];
    const querier = querierOf([{ id: 70, [COUNT_ALIAS]: 1 }]);

    await fillRelationCounts(querier, Team, payload, { owner: true } as never);

    expect(payload.map((it) => (it as Record<string, unknown>)[COUNT_RESULT_KEY])).toEqual([
      { owner: 1 },
      { owner: 0 },
    ]);
  });
});
