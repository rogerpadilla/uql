export function parseWideToLong(input: readonly any[][], identifiers: readonly Cell[], relations: readonly Relation[]): any[][] {
  const output: any[][] = [];

  const lastIdentifierI = identifiers[identifiers.length - 1].row;

  for (let wideI = lastIdentifierI; wideI < input.length - 1; ++wideI) {
    for (let wideJ = 0; wideJ < relations.length; ++wideJ) {
      const currentRowIdx = wideI + 1;
      const currentColIdx = wideJ + identifiers.length;
      const idCells = identifiers.map((id) => input[currentRowIdx][id.column]);
      const headerCells = Array.from({ length: lastIdentifierI + 1 }, (arr, index) => input[index][currentColIdx]);
      const valueCell = input[currentRowIdx][currentColIdx];
      output.push([...idCells, ...headerCells, valueCell]);
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
