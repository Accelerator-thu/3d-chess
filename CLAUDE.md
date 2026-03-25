# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

Open `index.html` directly in a browser. No build step, server, package manager, or dependencies are required.

## Architecture

This is a single-page browser game (3D Gomoku / "4 in a row" on an N×N×N board). The entire logic lives in three files:

- `index.html` — static markup; all UI elements have IDs referenced via `dom` object in `app.js`
- `styles.css` — styling and CSS animations (including the `drop-in` gravity animation using CSS custom properties)
- `app.js` — all game logic and DOM manipulation; no frameworks

### app.js structure

**State** — a single `state` object holds all mutable game state: board (3D array indexed `board[z][y][x]`), current player, winner, move history, mode, gravity flag, camera view, and drag tracking.

**Boot sequence**: `boot()` → `wireEvents()` + `initializeSetupScreen()` + `enterSetupPhase()`

**Two screens**: setup screen (choose board size 4–6, mode, gravity) and game screen. Transitions via `enterSetupPhase()` / `enterGamePhase()`.

**Game modes**:
- `visual` — players click cells rendered as stacked 2D grid layers in CSS 3D perspective
- `coord` (blind) — board is hidden; players type coordinates into an input field

**Gravity mode** — when enabled, moves specify only `(x,y)` and the stone drops to the lowest empty `z`. Locked after the first move of a game. Includes a CSS `drop-in` animation driven by `--drop-from-x/y/z` custom properties set per-cell.

**Board rendering**: `renderBoard()` calls `ensureBoardStructure()` (rebuilds DOM layers only on size change) then `updateBoardCells()` (updates classes/text/animations on existing cells). The 3D perspective is pure CSS using `--rot-x`, `--rot-z`, `--camera-z` custom properties on the `.layers` container.

**Win detection**: `findWinningLineFrom()` checks all 13 unique 3D directions (built by `buildDirections()` — half-space enumeration to avoid duplicates) from the just-placed stone.

**Coordinate convention**: internal board is 0-based `(x, y, z)`; display and input are 1-based. Board array is indexed `board[z][y][x]`.

**Camera/drag**: single-pointer drag rotates the view; two-pointer pinch zooms. Mouse wheel also zooms. A `suppressNextClick` flag prevents cell clicks from firing after a drag gesture.
