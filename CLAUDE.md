# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Running the app

No build step, package manager or framework. Serve the folder (`python3 -m http.server`)
or open `index.html` directly (on `file://` the AI falls back to the main thread and
online play is unavailable). Deployed via GitHub Pages at `/3d-chess/`, i.e. on the same
origin as the main site, which is why the theme shares its `wc-color-theme` key.

## Architecture

- `engine.js` — **pure logic, no DOM**; exposes `FourEngine` on `self`/`window` and is
  loaded by both the page and `ai-worker.js`.
  - Cells are flattened: `idx = x + N*(y + N*(z + N*w))`; `geo.coords[idx]` is `[x,y,z(,w)]`.
  - `getGeometry(size, dims)` (cached) precomputes all winning windows (`lines`,
    4 cells each), `cellLines[idx]`, gravity columns (`columnOf`, `colCells`) and
    Zobrist keys. Directions: 13 (3D) / 40 (4D), one per ± pair.
  - `Game` keeps the board plus per-line counts for both players, the open-three sets
    (`threes`), an incremental static score (player-1 view) and the hash. `play`/`undo`
    are O(lines through the cell). `isPlayable` respects gravity; `resolveTarget` maps
    any cell in a column to its landing cell.
  - `chooseMove(game, level)` — negamax + alpha-beta, iterative deepening with a time
    budget, TT, heuristic ordering with a beam, forced-block extension, fork detection
    before the depth cutoff, and a "don't give up" fallback when every move is a proven
    loss. Levels live in `LEVELS`.
- `ai-worker.js` — rebuilds the position from the move list and calls `chooseMove`.
- `net.js` — `Net.host/join/send/leave` over PeerJS (vendored in `vendor/`, loaded
  lazily). Peer ids are `yc-fiar-<code>`; URL params `peerHost/peerPort/peerPath/peerSecure`
  point at a local signaling server for testing (honoured on localhost only).
- `app.js` — UI. Single state object `S`; `renderAll()` → board, status pill, move
  log, drawer, end card. Board DOM is rebuilt only when layout/size/dims change
  (`S.board.key`); `updateCells()` sets classes. Views: `stack` (CSS 3D perspective,
  camera in `S.view`) and `flat` (z-layers side by side). `S.sides[p]` is one of
  `local | me | ai | remote` and drives whose input the board accepts.
- Online protocol (documented at the top of the "Online play" section in `app.js`):
  `hello`/`welcome`/`reject` (seat tokens), `sync`, `sync-req`, `move` (with move count
  `n`), `undo-req/ok/no`, `rematch` (after a finished game), `restart-req/ok/no`
  (mid-game, needs consent), `bye`. The host's state is authoritative.

## Security invariants (keep these when changing online play)

- Treat every peer message as untrusted: validate with `intIn`, never put peer data in
  `innerHTML`, replay synced moves through `FourEngine.Game`.
- Anything that rewrites the game (undo, restart) needs local consent or must match a
  request this side made (`pendingUndo`, `pendingRestart`).
- `net.js` admits a host-side connection only after `authorizeGuest` approves its
  `hello`; it enforces JSON serialization, rate limits and handshake timeouts.
- The CSP in `index.html` forbids inline scripts: put new JS in files, and add any new
  network origin to `connect-src`.
- `boot()` runs at the end of `app.js` so top-level constants are initialised first.
- Tests used during development (engine, UI, online, adversarial) drive the page with
  Playwright against a local `peer` server; see README "Run locally".

## Conventions

- Coordinates shown to users are 1-based; internal ones are 0-based.
- Colours are CSS custom properties in `styles.css` (`html[data-theme="dark"]` overrides);
  keep the palette aligned with the main site (Berkeley blue `#003262`, teal `#6FA3A8`).
- `simulate.js` (untracked, if present) targets the pre-engine `app.js` and no longer runs.
