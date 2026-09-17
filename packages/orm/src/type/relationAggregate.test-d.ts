import { Entity, Field, Id, ManyToOne, OneToMany } from '../entity/index.js';

/**
 * What a relation aggregate checks at compile time: the relation it reads, the target's own fields in
 * its filter and its picked column, and the property, which has to hold exactly what the aggregate
 * reads - `max()` is `null` where the parent has no rows, and a `count` never is.
 *
 * `stored: true` is the shape [triggers](../../../../architecture/triggers.md) settled, so it compiles
 * here; registering one is refused until the triggers that maintain it exist.
 */
@Entity()
class Ticket {
  @Id({ type: Number }) id?: number;
  @Field({ references: () => Board, type: Number }) boardId?: number;
  @ManyToOne({ entity: () => Board, references: (ticket) => ticket.boardId }) board?: Board;
  @Field({ type: Number }) points?: number;
  @Field({ type: String }) title?: string;
  @Field({ type: Boolean }) open?: boolean;
}

@Entity()
class Board {
  @Id({ type: Number }) id?: number;

  @OneToMany({ entity: () => Ticket, mappedBy: (ticket) => ticket.board })
  tickets?: Ticket[];

  @Field({ computed: (board) => board.tickets.count() })
  readonly ticketCount?: number;

  @Field({ computed: (board) => board.tickets.count({ $where: { open: true } }), stored: true })
  readonly openCount?: number;

  @Field({ computed: (board) => board.tickets.sum((ticket) => ticket.points), stored: true })
  readonly totalPoints?: number;

  @Field({ computed: (board) => board.tickets.max((ticket) => ticket.points) })
  readonly hardestTicket?: number | null;

  @Field({ computed: (board) => board.tickets.avg((ticket) => ticket.points) })
  readonly averagePoints?: number | null;

  // @ts-expect-error - 'tickest' is not a relation of Board
  @Field({ computed: (board) => board.tickest.count() })
  readonly typo?: number;

  // @ts-expect-error - 'opne' is not a field of Ticket
  @Field({ computed: (board) => board.tickets.count({ $where: { opne: true } }) })
  readonly filterTypo?: number;

  // @ts-expect-error - 'open' holds a boolean, not a number
  @Field({ computed: (board) => board.tickets.count({ $where: { open: 3 } }) })
  readonly filterType?: number;

  // @ts-expect-error - only a numeric field can be summed
  @Field({ computed: (board) => board.tickets.sum((ticket) => ticket.title) })
  readonly summedTitle?: number;

  // @ts-expect-error - a count is a number
  @Field({ computed: (board) => board.tickets.count() })
  readonly countAsText?: string;

  // @ts-expect-error - a max reads null where the board has no tickets, so the property has to admit it
  @Field({ computed: (board) => board.tickets.max((ticket) => ticket.points) })
  readonly maxWithoutNull?: number;

  // @ts-expect-error - a count is never null
  @Field({ computed: (board) => board.tickets.count() })
  readonly countWithNull?: number | null;

  /** A page needs the order that picks it, and capping the rows is what makes the aggregate unstorable. */
  @Field({ computed: (board) => board.tickets.sum((t) => t.points, { $sort: { points: -1 }, $limit: 5 }) })
  readonly topPoints?: number;

  @Field({ computed: (board) => board.tickets.count({ $limit: 500 }) })
  readonly cappedCount?: number;

  // @ts-expect-error - which five rows a total covers is only defined by the order that picks them
  @Field({ computed: (board) => board.tickets.sum((t) => t.points, { $limit: 5 }) })
  readonly unorderedTop?: number;

  // @ts-expect-error - an order picks which rows a page holds, never how many, so a tally takes none
  @Field({ computed: (board) => board.tickets.count({ $sort: { points: -1 }, $limit: 5 }) })
  readonly sortedCount?: number;

  // @ts-expect-error - a capped total is not maintained by any row change
  @Field({
    computed: (board) => board.tickets.sum((t) => t.points, { $sort: { points: -1 }, $limit: 5 }),
    stored: true,
  })
  readonly storedTop?: number;

  // @ts-expect-error - a rescan on delete is a different cost model, so a max is never stored
  @Field({ computed: (board) => board.tickets.max((ticket) => ticket.points), stored: true })
  readonly storedMax?: number | null;

  // @ts-expect-error - an event list stamps a value; an aggregate is kept by the rows it reads
  @Field({ computed: (board) => board.tickets.count(), stored: ['update'] })
  readonly stampedCount?: number;

  /**
   * An aggregate is SQL like any other `computed`, so declaring its `type` still compiles; it is what
   * the aggregate already says, which is why the fields above declare none.
   */
  @Field({ type: Number, computed: (board) => board.tickets.count() })
  readonly typedCount?: number;
}
