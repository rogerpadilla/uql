import { parseWideToLong, Cell, Relation } from './wide2long';

fit('should parse wide to long', () => {
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
    ['Arizona', 1970, 9],
    ['Arizona', 1980, 8],
    ['Arizona', 1990, 7],
    ['Arizona', 2000, 5],
  ];

  const output = parseWideToLong(input, identifiers, relations);

  expect(output).toEqual(expected);
});

fit('should parse wide (one header row one primary column) to long', () => {
  const inputTable: string[][] = [
    ['Option', 'A', 'B', 'C'],
    ['0 mo-AL/AL', '0.95', '0.96', '0.97'],
    ['0 mo-EE/AL', '0.912', '0.913', '0.914'],
  ];

  const relations: Relation[] = [
    { key: { column: 1, row: 0 }, value: undefined },
    { key: { column: 2, row: 0 }, value: undefined },
    { key: { column: 3, row: 0 }, value: undefined },
  ];

  const identifiers: Cell[] = [{ column: 0, row: 0 }];

  const expected = [
    ['0 mo-AL/AL', 'A', '0.95'],
    ['0 mo-AL/AL', 'B', '0.96'],
    ['0 mo-AL/AL', 'C', '0.97'],
    ['0 mo-EE/AL', 'A', '0.912'],
    ['0 mo-EE/AL', 'B', '0.913'],
    ['0 mo-EE/AL', 'C', '0.914'],
  ];

  const output = parseWideToLong(inputTable, identifiers, relations);

  expect(output).toEqual(expected);
});

fit('should parse wide (one header row two primary columns) to long', () => {
  const inputTable: string[][] = [
    ['Min/Max', 'Option', 'A', 'B', 'C'],
    ['Max', '0 mo-AL/AL', '0.95', '0.96', '0.97'],
    ['Min', '0 mo-EE/AL', '0.912', '0.913', '0.914'],
  ];

  const relations: Relation[] = [
    { key: { column: 2, row: 0 }, value: undefined },
    { key: { column: 3, row: 0 }, value: undefined },
    { key: { column: 4, row: 0 }, value: undefined },
  ];

  const identifiers: Cell[] = [
    { column: 0, row: 0 },
    { column: 1, row: 0 },
  ];

  const expected = [
    ['Max', '0 mo-AL/AL', 'A', '0.95'],
    ['Max', '0 mo-AL/AL', 'B', '0.96'],
    ['Max', '0 mo-AL/AL', 'C', '0.97'],
    ['Min', '0 mo-EE/AL', 'A', '0.912'],
    ['Min', '0 mo-EE/AL', 'B', '0.913'],
    ['Min', '0 mo-EE/AL', 'C', '0.914'],
  ];

  const output = parseWideToLong(inputTable, identifiers, relations);

  expect(output).toEqual(expected);
});

fit('should parse wide (two header rows with relationships) to long', () => {
  const inputTable: string[][] = [
    ['', 'Part % >= 50%', 'Part % >= 50%', 'Part % < 50%', 'Part % < 50%'],
    ['Option Description', 'Virgin', 'Takeover', 'Virgin', 'Takeover'],
    ['12/24', '0.95', '0.99', '0.89', '0.96'],
    ['6/24', '0.94', '0.98', '0.88', '0.93'],
  ];
  const relations: Relation[] = [
    { key: { column: 1, row: 1 }, value: { column: 1, row: 0 } },
    { key: { column: 2, row: 1 }, value: { column: 2, row: 0 } },
    { key: { column: 3, row: 1 }, value: { column: 3, row: 0 } },
    { key: { column: 4, row: 1 }, value: { column: 4, row: 0 } },
  ];
  const identifiers: Cell[] = [{ column: 0, row: 1 }];

  const expected = [
    ['12/24', 'Part % >= 50%', 'Virgin', '0.95'],
    ['12/24', 'Part % >= 50%', 'Takeover', '0.99'],
    ['12/24', 'Part % < 50%', 'Virgin', '0.89'],
    ['12/24', 'Part % < 50%', 'Takeover', '0.96'],
    ['6/24', 'Part % >= 50%', 'Virgin', '0.94'],
    ['6/24', 'Part % >= 50%', 'Takeover', '0.98'],
    ['6/24', 'Part % < 50%', 'Virgin', '0.88'],
    ['6/24', 'Part % < 50%', 'Takeover', '0.93'],
  ];
  const output = parseWideToLong(inputTable, identifiers, relations);
  console.table(expected);
  console.table(output);
  expect(output).toEqual(expected);
});

it('should parse wide (two header rows with relationships to merged cells) to long', () => {
  // This test is same as previous one, but tes data comes from excel with 'merged cells'
  // 'Part % >= 50%', '' -> 1 excel merged cell
  const inputTable = [
    ['', 'Part % >= 50%', '', 'Part % < 50%', ''],
    ['Option Description', 'Virgin', 'Takeover', 'Virgin', 'Takeover'],
    ['12/24', '0.95', '0.99', '0.89', '0.96'],
    ['6/24', '0.94', '0.98', '0.88', '0.93'],
  ];
  // Here is main difference with above test
  // some relationship point same parent
  const relations: Relation[] = [
    { key: { column: 1, row: 1 }, value: { column: 1, row: 0 } },
    { key: { column: 2, row: 1 }, value: { column: 1, row: 0 } },
    { key: { column: 3, row: 1 }, value: { column: 3, row: 0 } },
    { key: { column: 4, row: 1 }, value: { column: 3, row: 0 } },
  ];
  const identifiers: Cell[] = [{ column: 0, row: 1 }];

  const expected = [
    ['12/24', 'Part % >= 50%', 'Virgin', '0.95'],
    ['12/24', 'Part % >= 50%', 'Takeover', '0.99'],
    ['12/24', 'Part % < 50%', 'Virgin', '0.89'],
    ['12/24', 'Part % < 50%', 'Takeover', '0.96'],
    ['6/24', 'Part % >= 50%', 'Virgin', '0.94'],
    ['6/24', 'Part % >= 50%', 'Takeover', '0.98'],
    ['6/24', 'Part % < 50%', 'Virgin', '0.88'],
    ['6/24', 'Part % < 50%', 'Takeover', '0.93'],
  ];
  const output = parseWideToLong(inputTable, identifiers, relations);
  expect(output).toEqual(expected);
});

it('should parse wide (one header row two primary columns with merged cells) to long', () => {
  // This test may be unnecesary, in case merged cells issue is solved in UI/above layer
  // The issue is that merged cells in excel in TSV are -> 'Max' '' -> 1 excel merged cell
  const inputTable = [
    ['Min/Max', 'Option', 'A', 'B', 'C'],
    ['Max', '0 mo-AL/AL', '0.95', '0.96', '0.97'],
    ['', '0 mo-EE/AL', '0.912', '0.913', '0.914'],
    ['Min', '0 mo-AL/AL', '0.11', '0.12', '0.13'],
  ];
  const relations: Relation[] = [{ key: { column: 2, row: 0 } }, { key: { column: 3, row: 0 } }, { key: { column: 4, row: 0 } }];
  const identifiers: Cell[] = [
    { column: 0, row: 0 },
    { column: 1, row: 0 },
  ];

  const expected = [
    ['Max', '0 mo-AL/AL', 'A', '0.95'],
    ['Max', '0 mo-AL/AL', 'B', '0.96'],
    ['Max', '0 mo-AL/AL', 'C', '0.97'],
    ['Max', '0 mo-EE/AL', 'A', '0.912'],
    ['Max', '0 mo-EE/AL', 'B', '0.913'],
    ['Max', '0 mo-EE/AL', 'C', '0.914'],
    ['Min', '0 mo-AL/AL', 'A', '0.11'],
    ['Min', '0 mo-AL/AL', 'B', '0.12'],
    ['Min', '0 mo-AL/AL', 'C', '0.13'],
  ];
  const output = parseWideToLong(inputTable, identifiers, relations);
  expect(output).toEqual(expected);
});

// Some alternative positive user flows, based in UI

fit('should parse wide (user did not select all available keys) to long', () => {
  const inputTable: string[][] = [
    ['Option', 'A', 'B', 'C'],
    ['0 mo-AL/AL', '0.95', '0.96', '0.97'],
    ['0 mo-EE/AL', '0.912', '0.913', '0.914'],
  ];
  const relations: Relation[] = [{ key: { column: 1, row: 0 } }, { key: { column: 2, row: 0 } }];
  const identifiers: Cell[] = [{ column: 0, row: 0 }];

  const expected = [
    ['0 mo-AL/AL', 'A', '0.95'],
    ['0 mo-AL/AL', 'B', '0.96'],
    ['0 mo-EE/AL', 'A', '0.912'],
    ['0 mo-EE/AL', 'B', '0.913'],
  ];
  const output = parseWideToLong(inputTable, identifiers, relations);
  expect(output).toEqual(expected);
});

it('should parse wide (not consecutive keys selected) to long', () => {
  const inputTable: string[][] = [
    ['Option', 'A', 'B', 'C'],
    ['0 mo-AL/AL', '0.95', '0.96', '0.97'],
    ['0 mo-EE/AL', '0.912', '0.913', '0.914'],
  ];
  const relations: Relation[] = [{ key: { column: 1, row: 0 } }, { key: { column: 3, row: 0 } }];
  const identifiers: Cell[] = [{ column: 0, row: 0 }];

  const expected = [
    ['0 mo-AL/AL', 'A', '0.95'],
    ['0 mo-AL/AL', 'C', '0.97'],
    ['0 mo-EE/AL', 'A', '0.912'],
    ['0 mo-EE/AL', 'C', '0.914'],
  ];
  const output = parseWideToLong(inputTable, identifiers, relations);
  expect(output).toEqual(expected);
});

it('should parse wide (user does not pick relations in table with 2 row headers) to long', () => {
  const inputTable: string[][] = [
    ['', 'Part % >= 50%', 'Part % >= 50%', 'Part % >= 50%', 'Part % >= 50%'],
    ['Option Description', '1/4', '2/4', '3/4', '4/4'],
    ['12/24', '0.95', '0.99', '0.89', '0.96'],
    ['6/24', '0.94', '0.98', '0.88', '0.93'],
  ];
  const relations: Relation[] = [
    { key: { column: 1, row: 1 } },
    { key: { column: 2, row: 1 } },
    { key: { column: 3, row: 1 } },
    { key: { column: 4, row: 1 } },
  ];
  const identifiers: Cell[] = [{ column: 0, row: 1 }];

  const expected = [
    ['12/24', '1/4', '0.95'],
    ['12/24', '2/4', '0.99'],
    ['12/24', '3/4', '0.89'],
    ['12/24', '4/4', '0.96'],
    ['6/24', '1/4', '0.94'],
    ['6/24', '2/4', '0.98'],
    ['6/24', '3/4', '0.88'],
    ['6/24', '4/4', '0.93'],
  ];
  const output = parseWideToLong(inputTable, identifiers, relations);
  expect(output).toEqual(expected);
});

// TODO: ADD test for 3+ row headers

// Negative tests

it('should not parse wide to long when some relations has value and others not', () => {
  const inputTable: string[][] = [
    ['', 'Part % >= 50%', 'Part % >= 50%', 'Part % < 50%', 'Part % < 50%'],
    ['Option Description', 'Virgin', 'Takeover', 'Virgin', 'Takeover'],
    ['12/24', '0.95', '0.99', '0.89', '0.96'],
    ['6/24', '0.94', '0.98', '0.88', '0.93'],
  ];
  const relations: Relation[] = [
    { key: { column: 1, row: 1 } },
    { key: { column: 2, row: 1 }, value: { column: 2, row: 0 } },
    { key: { column: 3, row: 1 }, value: { column: 3, row: 0 } },
    { key: { column: 4, row: 1 }, value: { column: 4, row: 0 } },
  ];
  const identifiers: Cell[] = [{ column: 0, row: 1 }];

  expect(parseWideToLong(inputTable, identifiers, relations)).toThrowError(
    'Unsupported relations array, all or none relations should have value'
  );
});

it('should not parse wide to long when all cells in main row are set as keys (not primary columns)', () => {
  const inputTable: string[][] = [
    ['Option', 'A', 'B', 'C'],
    ['0 mo-AL/AL', '0.95', '0.96', '0.97'],
    ['0 mo-EE/AL', '0.912', '0.913', '0.914'],
  ];
  const relations: Relation[] = [
    { key: { column: 0, row: 0 } },
    { key: { column: 1, row: 0 } },
    { key: { column: 2, row: 0 } },
    { key: { column: 3, row: 0 } },
  ];
  const identifiers: Cell[] = [];

  expect(parseWideToLong(inputTable, identifiers, relations)).toThrowError('The table must have at least one primary column');
});
