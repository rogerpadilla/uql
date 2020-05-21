export function parseWideToLong(input: readonly any[][], identifiers: readonly Cell[], relations: readonly Relation[]): any[][] {
  const output: any[][] = [];
  let count = 0;

  for (let i = 0; i < input.length - 1; ++i) {
    for (let j = 0; j < input[i].length - 1; ++j) {
      // identifiers
      output[count] = identifiers.map((id) => input[i + 1][id.column]);
      // header
      output[count].push(input[0][j + identifiers.length]);
      // values
      for (let indexRel = i + identifiers.length; indexRel <= i + identifiers.length; ++indexRel) {
        output[count].push(input[indexRel][j + 1]);
      }
      count++;
    }
  }

  console.table(output);

  return output;
}

// A cell in the table
export interface Cell {
  row: number;
  column: number;
}

// A mapping between two cells
export interface Relation {
  key: Cell;
  value?: Cell;
}
