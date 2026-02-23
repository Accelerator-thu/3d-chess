# 3D Gomoku Variant (Win by 4)

This is a browser game inspired by Gomoku, adapted to a 3D board.

## Rules

- Board is `N x N x N` (default `5 x 5 x 5`, with `4 <= N <= 6`).
- Two players alternate placing stones.
- A player wins when 4 stones align in any straight 3D direction.

## Modes

- `Visual Click`: place stones by clicking cells on stacked z-layers.
- `Blind Coordinates`: board is hidden and players place by entering coordinates.
- Coordinate format:
  - normal mode: `x,y,z` (1-based)
  - gravity mode: `x,y` (1-based), with `z` chosen automatically
- `Gravity Mode` (toggle): moves are selected by column `(x,y)` and stones auto-drop to the next available `z`.
- Gravity setting is locked after the first move (change it before starting moves, or start a new game).
- In gravity mode, visual moves include a falling animation.

## Run

Open `index.html` in a browser.

No build step or dependencies are required.
