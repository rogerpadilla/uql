import { expect, it } from 'vitest';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { User } from '../test/entityMock.js';
import type { Query } from '../type/index.js';

type ProjectionCase = {
  readonly name: string;
  readonly query: Query<User>;
  readonly sqlIncludes: string[];
  readonly sqlExcludes: string[];
  readonly mongoProjection: Record<string, 1>;
};

const cases: ProjectionCase[] = [
  {
    name: 'select whitelist',
    query: { $select: { name: true } },
    sqlIncludes: ['"name"'],
    sqlExcludes: ['"createdAt"', '"email"'],
    mongoProjection: { name: 1 },
  },
  {
    name: 'exclude subtractive',
    query: { $exclude: { name: true } },
    sqlIncludes: ['"id"', '"createdAt"'],
    sqlExcludes: ['"name"'],
    mongoProjection: { id: 1, companyId: 1, creatorId: 1, createdAt: 1, updatedAt: 1, email: 1 },
  },
  {
    name: 'negative select subtractive',
    query: { $select: { name: false } },
    sqlIncludes: ['"id"', '"createdAt"'],
    sqlExcludes: ['"name"'],
    mongoProjection: { id: 1, companyId: 1, creatorId: 1, createdAt: 1, updatedAt: 1, email: 1 },
  },
  {
    name: 'populate only keeps default scalars',
    query: { $populate: { profile: true } },
    sqlIncludes: ['LEFT JOIN "user_profile" "profile"'],
    sqlExcludes: [],
    mongoProjection: {},
  },
];

it.each(cases)('projection parity: $name', ({ query, sqlIncludes, sqlExcludes, mongoProjection }) => {
  const pg = new PostgresDialect();
  const ctx = pg.createContext();
  pg.find(ctx, User, query);
  for (const token of sqlIncludes) {
    expect(ctx.sql).toContain(token);
  }
  for (const token of sqlExcludes) {
    expect(ctx.sql).not.toContain(token);
  }

  const mongo = new MongoDialect();
  const select = mongo.select(User, query.$select, query.$exclude);
  expect(select).toEqual(mongoProjection);
});
