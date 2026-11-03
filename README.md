# 3D / 4D Four-in-a-Row

Gomoku-style four-in-a-row on an `N×N×N` cube (or `N` stacked cubes in 4D).
Play at <https://accelerator-thu.github.io/3d-chess/>.

## Rules

- Board is `N×N×N` with `4 ≤ N ≤ 6`, or `N×N×N×N` with `4 ≤ N ≤ 5` in 4D.
- Two players alternate; orange always moves first.
- Four in a straight line wins: any axis, face diagonal or space diagonal
  (13 directions in 3D, 40 in 4D).
- **Gravity** (optional, fixed per game): you choose an `(x, y)` column and the stone
  drops to the lowest empty `z`.

## Ways to play

- **Same screen** — pass-and-play.
- **vs AI** — Easy / Medium / Hard; choose whether you move first. Rematches swap sides.
- **Online friend** — creates a link (`?room=CODE`); moves travel peer-to-peer over
  WebRTC. The PeerJS public server only introduces the two browsers. Undo and
  mid-game restarts need the other player's consent; rematches alternate who starts.
  A dropped guest can rejoin with the same link from the same browser.

## Security of online play

The other browser is treated as untrusted input.

- **Seats are locked.** The first browser to open the link gets the guest seat and a
  random seat token (kept in its local storage) that lets it rejoin after a reload.
  Anyone else opening the link while your friend is connected is told the game is
  full; if the seat is empty, the host is asked before a new browser can take it.
- **Hard-to-guess rooms.** Room codes are 10 random symbols (~49 bits).
- **Every message is validated.** Integers are range-checked, move legality and turn
  order are enforced locally, sync payloads are capped and replayed through the
  rules engine, and nothing from the peer is ever inserted as HTML.
- **Consent for anything that rewrites the game.** Undo only takes back the
  requester's own moves and needs approval; restarting an unfinished game needs
  approval; forged "approvals" that weren't requested are ignored.
- **Abuse limits.** JSON-only serialization (no binary object unpacking),
  per-connection rate limiting (a flooding peer is disconnected), throttled prompts and
  resyncs, a handshake timeout, and a cap on pending connections.
- **Locked-down page.** A Content-Security-Policy allows only this site's own scripts
  and connections to the PeerJS server; PeerJS is vendored rather than loaded from a
  CDN; `?peerHost=` overrides work only on localhost.

Limits that come with peer-to-peer play: your friend's browser (and the PeerJS
servers) can see your IP address, as in any WebRTC call; the matchmaking server is
a free public service, so availability isn't guaranteed; and a player can always
modify their own copy of the game. They still can't make an illegal move on your
board, but they could, say, play with computer help.

## Views and controls

- **Stack** — layers in 3D perspective. Drag to rotate, scroll / pinch to zoom.
- **Layers** — every z-level side by side (rows of `w` in 4D). Default on phones.
- **Blind** — board hidden; enter coordinates (`x,y,z`, 1-based; `x,y` with gravity,
  plus `w` in 4D).
- Hovering previews where the stone lands, highlights the layer / gravity column, and
  shows the coordinates. The last move is ringed; the winning line glows.
- Keyboard: `V` view · `U` undo · `H` threat hints · `R` reset camera · `C` controls ·
  `N` rematch.
- Light / dark theme follows the main site's setting (`wc-color-theme`) or the system.

## AI

`engine.js` precomputes every winning window ("line") and keeps per-line stone counts
incrementally, so a move, an undo, win detection and the static evaluation each cost
O(lines through one cell). The search is negamax with alpha-beta pruning, iterative
deepening under a time budget, a Zobrist-hashed transposition table, heuristic move
ordering (attack + defence value of each cell) with a beam at inner nodes, and threat
logic: immediate wins are taken, a single opponent threat forces the block (searched
without spending depth), and two simultaneous threats are scored as lost even at the
horizon. It runs in a Web Worker, so the page stays responsive.

| Level  | Budget  | Notes |
| ------ | ------- | ----- |
| Easy   | depth 1 | noisy evaluation; sometimes plays a plausible but unforced move |
| Medium | ~0.6 s, depth ≤ 3 | light noise |
| Hard   | ~1.8 s, iterative deepening | no noise |

## Run locally

Open `index.html`. Everything works from `file://` except that the AI then runs on the
main thread (browsers block workers there) and online play needs a served page:

```sh
python3 -m http.server 8000   # then http://localhost:8000
```

To test online play without the public signaling server, run a local PeerJS server
(`npx peer --port 9000`) and open
`http://localhost:8000/?peerHost=localhost&peerPort=9000&peerPath=/&peerSecure=0`.

## Files

| File | Role |
| ---- | ---- |
| `index.html` | markup for the setup and game screens; Content-Security-Policy |
| `theme-init.js` | applies light/dark before first paint (external so the CSP needs no inline script) |
| `styles.css` | styling; colour tokens with a dark theme |
| `engine.js` | rules, geometry, win detection, AI search (no DOM; shared with the worker) |
| `ai-worker.js` | runs the search off the main thread |
| `net.js` | online rooms over WebRTC (PeerJS) |
| `app.js` | UI, rendering, input, turn flow, online protocol |
| `vendor/peerjs.min.js` | PeerJS 1.5.5 (MIT), loaded only for online play |
