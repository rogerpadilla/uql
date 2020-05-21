export function parseWideToLong(input: readonly any[][], identifiers: readonly Cell[], relations: readonly Relation[]): any[][] {
  const output: any[][] = [];
  let longI = 0;

  for (let wideI = 0; wideI < input.length - 1; ++wideI) {
    for (let wideJ = 0; wideJ < relations.length; ++wideJ) {
      // identifiers
      output[longI] = identifiers.map((id) => input[wideI + 1][id.column]);
      // header
      output[longI].push(input[0][wideJ + identifiers.length]);
      // values
      for (let indexRel = wideI + identifiers.length; indexRel <= wideI + identifiers.length; ++indexRel) {
        output[longI].push(input[indexRel][wideJ + 1]);
      }
      longI++;
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
