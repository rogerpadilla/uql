import { parseWideToLong, Cell, Relation } from './wide2long';

it('should parse wide to long', () => {
  const identifiers: Cell[] = [{ column: 0, row: 0 }];
  const relations: Relation[] = [
    { key: { column: 1, row: 0 } },
    { key: { column: 2, row: 0 } },
    { key: { column: 3, row: 0 } },
    { key: { column: 4, row: 0 } },
    { key: { column: 5, row: 0 } },
  ];

  // data sample from http://jonathansoma.com/tutorials/d3/wide-vs-long-data/
  const input = [
    ['State', 1960, 1970, 1980, 1990, 2000],
    ['New York', 2, 5, 2, 5, 4],
    ['New Jersey', 3, 1, 4, 1, 5],
    ['Arizona', 3, 9, 8, 7, 5],
  ];

  const expected = [
    ['New York', 1960, 2],
    ['New York', 1970, 5],
    ['New York', 1980, 2],
    ['New York', 1990, 5],
    ['New York', 2000, 4],
    ['New Jersey', 1960, 3],
    ['New Jersey', 1970, 1],
    ['New Jersey', 1980, 4],
    ['New Jersey', 1990, 1],
    ['New Jersey', 2000, 5],
    ['Arizona', 1960, 3],
    ['Arizona', 1960, 9],
    ['Arizona', 1960, 8],
    ['Arizona', 1960, 7],
    ['Arizona', 1960, 5],
  ];

  const output = parseWideToLong(input, identifiers, relations);

  console.log('output', output);

  expect(output).toEqual(expected);
});
