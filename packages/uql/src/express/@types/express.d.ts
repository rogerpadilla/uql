import 'express';
import type { Query } from 'nukak/type/query.js';

declare module 'express' {
  export interface Request {
    query?: Query;
  }
}
