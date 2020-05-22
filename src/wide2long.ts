export function parseWideToLong(input: readonly any[][], identifiers: readonly Cell[], relations: readonly Relation[]): any[][] {
  const output: any[][] = [];

  const wideStartI = identifiers[identifiers.length - 1].row;

  for (let wideI = wideStartI; wideI < input.length - 1; ++wideI) {
    for (let wideJ = 0; wideJ < relations.length; ++wideJ) {
      const currentRowIdx = wideI + 1;
      const currentColIdx = wideJ + identifiers.length;
      const idCells = identifiers.map((id) => input[currentRowIdx][id.column]);
      const headerCell = input[0][currentColIdx];
      const valueCell = input[currentRowIdx][currentColIdx];
      output.push([...idCells, headerCell, valueCell]);
    }
  }

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
