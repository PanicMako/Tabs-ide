import {
  connectedToolPuzzle,
  initialToolPuzzle,
  swapToolPuzzle,
  toolPuzzleNeighbor,
} from "../lib/toolPuzzle";

export function mountToolPuzzle(root: HTMLElement): void {
  if (root.dataset.ready === "true") return;
  const board = root.querySelector<HTMLElement>("[data-puzzle-board]");
  const status = root.querySelector<HTMLElement>("[data-puzzle-status]");
  const reset = root.querySelector<HTMLButtonElement>("[data-puzzle-reset]");
  if (!board || !status || !reset) throw new Error("The puzzle controls are unavailable.");
  let tiles: number[] = [...initialToolPuzzle];
  let selected: number | undefined;
  let moves = 0;
  const buttons = tiles.map((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => {
      if (index === 0 || index === 8) {
        status.textContent =
          "Input and output stay in place. Select one of the seven middle tools.";
      } else if (selected === undefined) {
        selected = index;
        status.textContent = `Tool ${tiles[index]} selected. Choose another middle tool to swap, or select it again to cancel.`;
      } else if (selected === index) {
        selected = undefined;
        status.textContent = "Selection cleared. Choose two middle tools to swap.";
      } else {
        tiles = swapToolPuzzle(tiles, selected, index);
        selected = undefined;
        moves++;
        status.textContent = connectedToolPuzzle(tiles)
          ? `Connected! All nine tools form a path from input to output. ${moves} swaps. Play again with Reset.`
          : `${moves} swaps. Connect consecutive numbers using horizontal or vertical neighbors.`;
      }
      render();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        buttons[toolPuzzleNeighbor(index, event.key)]?.focus();
      }
    });
    board.append(button);
    return button;
  });
  function render() {
    buttons.forEach((button, index) => {
      const label = index === 0 ? "Input" : index === 8 ? "Output" : "Tool";
      button.textContent = `${label} ${tiles[index]}`;
      button.setAttribute(
        "aria-label",
        `${label} ${tiles[index]}, row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}${index === 0 || index === 8 ? ", fixed" : ""}`,
      );
      button.setAttribute("aria-pressed", String(selected === index));
      button.dataset.connected = String(connectedToolPuzzle(tiles));
    });
  }
  reset.addEventListener("click", () => {
    tiles = [...initialToolPuzzle];
    selected = undefined;
    moves = 0;
    render();
    status.textContent = "Puzzle reset. Choose two middle tools to swap.";
    buttons[1]?.focus();
  });
  render();
  status.textContent = "Ready. Connect tools 1 through 9 in order. No timer; take your time.";
  root.dataset.ready = "true";
}
