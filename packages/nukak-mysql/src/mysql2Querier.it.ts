import { createSpec } from 'nukak/test';
import { AbstractSqlQuerierIt } from 'nukak/querier/abstractSqlQuerier-it';
import { MySql2QuerierPool } from './mysql2QuerierPool';

export class MySql2QuerierIt extends AbstractSqlQuerierIt {
  constructor() {
    super(
      new MySql2QuerierPool({
        host: '0.0.0.0',
        port: 3316,
        user: 'test',
        password: 'test',
        database: 'test',
      }),
      'INT AUTO_INCREMENT PRIMARY KEY'
    );
  }
}

createSpec(new MySql2QuerierIt());
