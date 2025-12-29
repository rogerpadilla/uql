import 'express';
import type { Query } from '../../type/query.js';

declare module 'express' {
  export interface Request {
    query?: Query;
  }
}
