/**
 * Every place a statement or a definition names a member of an entity. `scripts/type-rename.ts` renames
 * each field, relation and method declared here through the language server and fails on any mention
 * left behind, so a key whose type stops linking back to the entity property is caught. Type-checked
 * like any `.test-d.ts`.
 */
import { defineEntity, Entity, Field, Id, Index, ManyToOne, OneToMany } from '../entity/index.js';
import type { Querier } from './index.js';

@Entity()
class Studio {
  @Id({ type: Number }) id?: number;
  @OneToMany({ entity: () => Movie, mappedBy: (movie) => movie.studio }) movies?: Movie[];
}

@Index((movie) => [movie.title, { column: movie.rating, order: 'desc' }], { include: (movie) => [movie.studioId] })
@Entity()
class Movie {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string;
  @Field({ type: Number }) rating?: number;
  @Field({ type: Number, references: () => Studio }) studioId?: number;
  @ManyToOne({ entity: () => Studio, references: (movie, target) => [{ local: movie.studioId, foreign: target.id }] })
  studio?: Studio;
  @Field({ type: Number, references: () => Cinema }) cinemaId?: number;
}

class Cinema {
  id?: number;
  city?: string;
  films?: Movie[];
  touch(): void {}
}

defineEntity(Cinema, {
  fields: { id: { type: Number, isId: true }, city: { type: String } },
  relations: { films: { cardinality: '1m', entity: () => Movie, mappedBy: (movie) => movie.cinemaId } },
  indexes: [{ columns: (cinema) => [cinema.city], include: (cinema) => [cinema.id] }],
  hooks: { beforeInsert: (cinema) => [cinema.touch] },
});

declare const querier: Querier;

export async function find() {
  const found = await querier.findMany(Movie, {
    $select: { title: true, rating: true, studioId: true },
    $populate: { studio: { $select: { id: true } } },
    $where: { rating: { $gte: 7 }, studio: { id: 1 }, $text: { $value: 'noir', $fields: { title: true } } },
    $sort: { rating: -1, studio: { id: 1 } },
  });
  const studios = await querier.findMany(Studio, {
    $populate: { movies: { $select: { title: true }, $where: { rating: 1 }, $sort: { rating: 1 } } },
    $count: { movies: { $where: { rating: { $gt: 8 } } } },
    $where: { movies: { $size: { $gte: 1 } } },
  });
  const excluded = await querier.findMany(Movie, { $exclude: { rating: true } });
  return [found[0].title, found[0].rating, found[0].studioId, found[0].studio, studios[0].movies, excluded[0].title];
}

export async function write() {
  await querier.insertOne(Movie, { title: 'Heat', rating: 8, studioId: 1 });
  await querier.updateMany(Movie, { $where: { studioId: 1 } }, { title: 'Heat', rating: 9 });
  await querier.upsertOne(Movie, { title: true }, { title: 'Heat', rating: 8 });
}

export async function aggregate() {
  const rows = await querier.aggregate(Movie, {
    $where: { rating: { $gt: 0 } },
    $group: { studioId: true },
    $select: {
      total: { $sum: { rating: true } },
      best: { $max: { rating: true } },
      titles: { $countDistinct: { title: true } },
    },
    $having: { studioId: { $gt: 0 }, total: { $gt: 10 } },
    $sort: { studioId: 1, total: -1 },
  });
  return [rows[0].studioId, rows[0].best, rows[0].titles];
}
