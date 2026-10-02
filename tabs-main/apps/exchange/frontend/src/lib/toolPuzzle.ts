export const initialToolPuzzle = [1, 3, 2, 4, 6, 5, 7, 8, 9] as const;

export function validToolPuzzle(tiles: readonly number[]): boolean {
  return (
    tiles.length === 9 &&
    new Set(tiles).size === 9 &&
    tiles.every((tile) => Number.isInteger(tile) && tile >= 1 && tile <= 9)
  );
}

export function connectedToolPuzzle(tiles: readonly number[]): boolean {
  if (!validToolPuzzle(tiles) || tiles[0] !== 1 || tiles[8] !== 9) return false;
  for (let tool = 1; tool < 9; tool++) {
    const from = tiles.indexOf(tool);
    const to = tiles.indexOf(tool + 1);
    if (Math.abs(Math.floor(from / 3) - Math.floor(to / 3)) + Math.abs((from % 3) - (to % 3)) !== 1)
      return false;
  }
  return true;
}

export function swapToolPuzzle(tiles: readonly number[], from: number, to: number): number[] {
  if (
    !validToolPuzzle(tiles) ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from <= 0 ||
    from >= 8 ||
    to <= 0 ||
    to >= 8
  ) {
    throw new Error("Only the seven middle tools can be swapped.");
  }
  const next = [...tiles];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function toolPuzzleNeighbor(index: number, key: string): number {
  if (!Number.isInteger(index) || index < 0 || index > 8) return 0;
  switch (key) {
    case "ArrowLeft":
      return index % 3 > 0 ? index - 1 : index;
    case "ArrowRight":
      return index % 3 < 2 ? index + 1 : index;
    case "ArrowUp":
      return index >= 3 ? index - 3 : index;
    case "ArrowDown":
      return index < 6 ? index + 3 : index;
    default:
      return index;
  }
}
