export function parseWideToLong(input: readonly any[][], identifiers: readonly Cell[], relations: readonly Relation[]): any[][] {
  const output: any[][] = [];
  let longI = 0;

  for (let wideI = 0; wideI < input.length - 1; ++wideI) {
    for (let wideJ = 0; wideJ < relations.length; ++wideJ) {
      const idCells = identifiers.map((id) => input[wideI + 1][id.column]);
      const headerCell = input[0][wideJ + identifiers.length];
      const valueCell = input[wideI + 1][wideJ + identifiers.length];
      output[longI] = [...idCells, headerCell, valueCell];
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
