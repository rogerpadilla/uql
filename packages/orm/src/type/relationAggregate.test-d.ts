import { Computed, Entity, f, Field, ManyToOne, OneToMany } from '../entity/index.js';

/**
 * What a relation aggregate checks at compile time: the relation it reads, the target's own fields in
 * its filter and its picked column, and the property, which has to hold exactly what the aggregate
 * reads - `max()` is `null` where the parent has no rows, and a `count` never is.
 */
@Entity()
class Ticket {
  @Field(f.number().id()) id?: number;
  @Field(
    f
      .number()
      .nullable()
      .references(() => Board),
  )
  boardId?: number | null;
  @ManyToOne({ entity: () => Board, references: (ticket) => ticket.boardId }) board?: Board;
  @Field(f.number().nullable()) points?: number | null;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.boolean().nullable()) open?: boolean | null;
}

@Entity()
class Board {
  @Field(f.number().id()) id?: number;

  @OneToMany({ entity: () => Ticket, mappedBy: (ticket) => ticket.board })
  tickets?: Ticket[];

  @Computed((board) => board.tickets.count())
  readonly ticketCount?: number;

  @Computed((board) => board.tickets.count({ $where: { open: true } }))
  readonly openCount?: number;

  @Computed((board) => board.tickets.sum((ticket) => ticket.points))
  readonly totalPoints?: number;

  @Computed((board) => board.tickets.max((ticket) => ticket.points))
  readonly hardestTicket?: number | null;

  @Computed((board) => board.tickets.avg((ticket) => ticket.points))
  readonly averagePoints?: number | null;

  // @ts-expect-error - 'tickest' is not a relation of Board
  @Computed((board) => board.tickest.count())
  readonly typo?: number;

  // @ts-expect-error - 'opne' is not a field of Ticket
  @Computed((board) => board.tickets.count({ $where: { opne: true } }))
  readonly filterTypo?: number;

  // @ts-expect-error - 'open' holds a boolean, not a number
  @Computed((board) => board.tickets.count({ $where: { open: 3 } }))
  readonly filterType?: number;

  // @ts-expect-error - only a numeric field can be summed
  @Computed((board) => board.tickets.sum((ticket) => ticket.title))
  readonly summedTitle?: number;

  // @ts-expect-error - a count is a number
  @Computed((board) => board.tickets.count())
  readonly countAsText?: string;

  // @ts-expect-error - a max reads null where the board has no tickets, so the property has to admit it
  @Computed((board) => board.tickets.max((ticket) => ticket.points))
  readonly maxWithoutNull?: number;

  // @ts-expect-error - a count is never null
  @Computed((board) => board.tickets.count())
  readonly countWithNull?: number | null;

  /** A page of a value aggregate needs the order that picks it. */
  @Computed((board) => board.tickets.sum((t) => t.points, { $sort: { points: -1 }, $limit: 5 }))
  readonly topPoints?: number;

  @Computed((board) => board.tickets.count({ $limit: 500 }))
  readonly cappedCount?: number;

  // @ts-expect-error - which five rows a total covers is only defined by the order that picks them
  @Computed((board) => board.tickets.sum((t) => t.points, { $limit: 5 }))
  readonly unorderedTop?: number;

  // @ts-expect-error - an order picks which rows a page holds, never how many, so a tally takes none
  @Computed((board) => board.tickets.count({ $sort: { points: -1 }, $limit: 5 }))
  readonly sortedCount?: number;

  // @ts-expect-error - a relation aggregate is read on each query, never stored: it is no column's SQL
  @Computed((board) => f.number().as(board.tickets.count()).stored())
  readonly storedCount?: number;

  // @ts-expect-error - an event list stamps a value; an aggregate is kept by the rows it reads
  @Computed((board) => f.number().as(board.tickets.count()).stored(['insert']))
  readonly stampedCount?: number;
}
