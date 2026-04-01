import { PostgresDialect } from './packages/uql-orm/src/postgres/postgresDialect.js';

const dialect = new PostgresDialect();
const ctx = dialect.createContext();

const obj = { private: 1 };
console.log('Input:', obj);

const ph = (dialect as any).jsonVal(ctx, obj);
console.log('Resulting placeholder expression:', ph);
console.log('Values array:', ctx.values);

if (typeof ctx.values[0] === 'string') {
  console.log('SUCCESS: Value is a string');
} else {
  console.log('FAILURE: Value is a', typeof ctx.values[0]);
}
