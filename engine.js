/* engine.js — pure game logic for N-dimensional four-in-a-row.
 *
 * Shared by the page (app.js) and the AI worker (ai-worker.js); no DOM access.
 * Exposes `FourEngine` on the global object (window or worker `self`).
 *
 * Board model
 *   A board is N^D cells (D = 3 or 4), flattened as idx = x + N*(y + N*(z + N*w)).
 *   Every winning window of 4 collinear cells is precomputed once per geometry
 *   ("lines"). Per-line stone counts are maintained incrementally, which makes
 *   win detection, static evaluation and threat lookup O(lines through a cell)
 *   per move instead of a board scan.
 *
 * Gravity: a "column" is (x, y[, w]); a stone dropped there lands on the lowest
 *   empty z. Only that landing cell is playable in the column.
 */
(function (root) {
  "use strict";

  const WIN_LENGTH = 4;
  const WIN_SCORE = 1e6;
  // Static-eval weight of an open line holding k stones of one player (k = 0..3).
  const LINE_WEIGHT = [0, 1, 6, 40];
  // Move-ordering weights: completing / extending own lines vs blocking the opponent's.
  const ATTACK = [1, 4, 22, 0];
  const DEFEND = [1, 3, 16, 0];

  // ─── Geometry ─────────────────────────────────────────────────────────────

  /** Canonical directions: one of each ± pair (first non-zero component, from the
   *  highest axis down, must be positive). 13 in 3D, 40 in 4D. */
  function buildDirections(dims) {
    const out = [];
    const total = 3 ** dims;
    for (let code = 0; code < total; code += 1) {
      const d = [];
      let c = code;
      for (let k = 0; k < dims; k += 1) {
        d.push((c % 3) - 1);
        c = Math.floor(c / 3);
      }
      if (d.every((v) => v === 0)) continue;
      let first = 0;
      for (let k = dims - 1; k >= 0; k -= 1) {
        if (d[k] !== 0) { first = d[k]; break; }
      }
      if (first > 0) out.push(d);
    }
    return out;
  }

  const geometryCache = new Map();

  function getGeometry(size, dims) {
    const key = `${size}:${dims}`;
    if (geometryCache.has(key)) return geometryCache.get(key);

    const n = size;
    const cells = n ** dims;
    const coords = new Array(cells);
    for (let i = 0; i < cells; i += 1) {
      const c = [];
      let r = i;
      for (let k = 0; k < dims; k += 1) {
        c.push(r % n);
        r = Math.floor(r / n);
      }
      coords[i] = c; // [x, y, z(, w)]
    }
    const index = (c) => {
      let i = 0;
      for (let k = dims - 1; k >= 0; k -= 1) i = i * n + c[k];
      return i;
    };

    const dirs = buildDirections(dims);
    const lineList = [];
    for (const d of dirs) {
      for (let s = 0; s < cells; s += 1) {
        const start = coords[s];
        let ok = true;
        for (let k = 0; k < dims; k += 1) {
          const end = start[k] + d[k] * (WIN_LENGTH - 1);
          if (end < 0 || end >= n) { ok = false; break; }
        }
        if (!ok) continue;
        const line = [];
        for (let step = 0; step < WIN_LENGTH; step += 1) {
          line.push(index(start.map((v, k) => v + d[k] * step)));
        }
        lineList.push(line);
      }
    }
    const lineCount = lineList.length;
    const lines = new Int32Array(lineCount * WIN_LENGTH);
    const through = Array.from({ length: cells }, () => []);
    lineList.forEach((line, l) => {
      line.forEach((cell, j) => {
        lines[l * WIN_LENGTH + j] = cell;
        through[cell].push(l);
      });
    });
    const cellLines = through.map((arr) => Int32Array.from(arr));

    // Gravity columns: (x, y[, w]) -> cells ordered by z (bottom first).
    const numCols = cells / n;
    const columnOf = new Int32Array(cells);
    const colCells = Array.from({ length: numCols }, () => new Int32Array(n));
    for (let i = 0; i < cells; i += 1) {
      const [x, y, z, w = 0] = coords[i];
      const col = x + n * (y + n * w);
      columnOf[i] = col;
      colCells[col][z] = i;
    }

    // Zobrist keys (two 32-bit halves per cell per player), deterministic seed.
    let seed = 0x9e3779b9 ^ (size * 131 + dims);
    const rand32 = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed;
    };
    const zob = [null, new Uint32Array(cells * 2), new Uint32Array(cells * 2)];
    for (let p = 1; p <= 2; p += 1) for (let i = 0; i < cells * 2; i += 1) zob[p][i] = rand32();

    const geo = {
      size, dims, cells, coords, index, dirs,
      lines, lineCount, cellLines, numCols, columnOf, colCells, zob,
    };
    geometryCache.set(key, geo);
    return geo;
  }

  // ─── Game state ──────────────────────────────────────────────────────────

  class Game {
    constructor(size, dims, gravity) {
      this.geo = getGeometry(size, dims);
      this.size = size;
      this.dims = dims;
      this.gravity = !!gravity;
      const g = this.geo;
      this.board = new Int8Array(g.cells);
      this.count = [null, new Uint8Array(g.lineCount), new Uint8Array(g.lineCount)];
      // Lines where player p has 3 stones and the opponent none ("open threes").
      this.threes = [null, new Set(), new Set()];
      this.height = new Int8Array(g.numCols);
      this.moves = [];
      this.toMove = 1;
      this.winner = 0;
      this.winLine = null;
      this.score = 0; // static eval from player 1's point of view
      this.h1 = 0;
      this.h2 = 0;
    }

    clone() {
      const g = new Game(this.size, this.dims, this.gravity);
      for (const cell of this.moves) g.play(cell);
      return g;
    }

    get isOver() {
      return this.winner !== 0 || this.moves.length === this.geo.cells;
    }

    /** Landing cell for a gravity column, or -1 when full. */
    dropCell(col) {
      const h = this.height[col];
      return h >= this.size ? -1 : this.geo.colCells[col][h];
    }

    isPlayable(cell) {
      if (cell < 0 || cell >= this.geo.cells || this.board[cell] !== 0) return false;
      if (!this.gravity) return true;
      return this.dropCell(this.geo.columnOf[cell]) === cell;
    }

    /** In gravity mode any cell in a column maps to that column's landing cell. */
    resolveTarget(cell) {
      if (!this.gravity) return cell;
      return this.dropCell(this.geo.columnOf[cell]);
    }

    legalMoves() {
      const out = [];
      if (this.isOver) return out;
      if (this.gravity) {
        for (let col = 0; col < this.geo.numCols; col += 1) {
          const c = this.dropCell(col);
          if (c >= 0) out.push(c);
        }
      } else {
        for (let i = 0; i < this.geo.cells; i += 1) if (this.board[i] === 0) out.push(i);
      }
      return out;
    }

    lineValue(l) {
      const a = this.count[1][l];
      const b = this.count[2][l];
      if (b === 0) return a >= WIN_LENGTH ? 0 : LINE_WEIGHT[a];
      if (a === 0) return b >= WIN_LENGTH ? 0 : -LINE_WEIGHT[b];
      return 0;
    }

    refreshThree(l) {
      const a = this.count[1][l];
      const b = this.count[2][l];
      if (a === 3 && b === 0) this.threes[1].add(l); else this.threes[1].delete(l);
      if (b === 3 && a === 0) this.threes[2].add(l); else this.threes[2].delete(l);
    }

    /** Place a stone for the side to move. Assumes legality (check isPlayable). */
    play(cell) {
      const g = this.geo;
      const p = this.toMove;
      const cnt = this.count[p];
      this.board[cell] = p;
      if (this.gravity) this.height[g.columnOf[cell]] += 1;
      this.moves.push(cell);
      this.h1 ^= g.zob[p][cell * 2];
      this.h2 ^= g.zob[p][cell * 2 + 1];
      const ls = g.cellLines[cell];
      let won = -1;
      for (let i = 0; i < ls.length; i += 1) {
        const l = ls[i];
        this.score -= this.lineValue(l);
        cnt[l] += 1;
        this.score += this.lineValue(l);
        this.refreshThree(l);
        if (cnt[l] === WIN_LENGTH && won < 0) won = l;
      }
      if (won >= 0) {
        this.winner = p;
        this.winLine = Array.from(g.lines.subarray(won * WIN_LENGTH, won * WIN_LENGTH + WIN_LENGTH));
      }
      this.toMove = 3 - p;
      return this.winner === p;
    }

    undo() {
      const g = this.geo;
      const cell = this.moves.pop();
      if (cell === undefined) return -1;
      const p = this.board[cell];
      const cnt = this.count[p];
      const ls = g.cellLines[cell];
      for (let i = 0; i < ls.length; i += 1) {
        const l = ls[i];
        this.score -= this.lineValue(l);
        cnt[l] -= 1;
        this.score += this.lineValue(l);
        this.refreshThree(l);
      }
      this.board[cell] = 0;
      if (this.gravity) this.height[g.columnOf[cell]] -= 1;
      this.h1 ^= g.zob[p][cell * 2];
      this.h2 ^= g.zob[p][cell * 2 + 1];
      this.toMove = p;
      this.winner = 0;
      this.winLine = null;
      return cell;
    }

    /** Playable cells that would immediately complete four for player p. */
    winningCells(p) {
      const out = [];
      const g = this.geo;
      for (const l of this.threes[p]) {
        for (let j = 0; j < WIN_LENGTH; j += 1) {
          const c = g.lines[l * WIN_LENGTH + j];
          if (this.board[c] === 0) {
            if (this.isPlayable(c) && !out.includes(c)) out.push(c);
            break;
          }
        }
      }
      return out;
    }

    /** Empty cells completing four for p, playable now or not (for hints). */
    threatCells(p) {
      const out = new Set();
      const g = this.geo;
      for (const l of this.threes[p]) {
        for (let j = 0; j < WIN_LENGTH; j += 1) {
          const c = g.lines[l * WIN_LENGTH + j];
          if (this.board[c] === 0) { out.add(c); break; }
        }
      }
      return [...out];
    }

    /** Heuristic value of playing `cell` for player p (move ordering). */
    moveHeuristic(cell, p) {
      const ls = this.geo.cellLines[cell];
      const mine = this.count[p];
      const theirs = this.count[3 - p];
      let s = 0;
      for (let i = 0; i < ls.length; i += 1) {
        const l = ls[i];
        const a = mine[l];
        const b = theirs[l];
        if (b === 0) s += ATTACK[a];
        else if (a === 0) s += DEFEND[b];
      }
      return s;
    }

    get hashKey() {
      return (this.h1 >>> 0) * 2097152 + (this.h2 & 0x1fffff);
    }
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  const LEVELS = {
    easy:   { timeMs: 250,  maxDepth: 1,  noise: 24, beam: 8,  blunder: 0.3 },
    medium: { timeMs: 600,  maxDepth: 3,  noise: 4,  beam: 10, blunder: 0 },
    hard:   { timeMs: 1800, maxDepth: 24, noise: 0,  beam: 14, blunder: 0 },
  };

  const TIMEOUT = { timeout: true };
  const MAX_PLY = 48;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  /**
   * Choose a move for the side to move.
   * Negamax + alpha-beta, iterative deepening under a time budget, transposition
   * table, and threat logic: immediate wins are taken, a single opponent threat
   * forces a block, and two simultaneous threats are scored as lost.
   */
  function chooseMove(game, levelName = "hard", rng = Math.random) {
    const opts = LEVELS[levelName] || LEVELS.hard;
    const g = game.clone();
    const me = g.toMove;
    const legal = g.legalMoves();
    if (!legal.length) return { cell: -1, depth: 0, score: 0, nodes: 0 };

    // Tactical shortcuts at the root.
    const wins = g.winningCells(me);
    if (wins.length) return { cell: wins[0], depth: 0, score: WIN_SCORE, nodes: 0 };
    if (opts.blunder && rng() < opts.blunder) {
      const ranked = legal
        .map((c) => ({ c, s: g.moveHeuristic(c, me) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 5);
      return { cell: ranked[Math.floor(rng() * ranked.length)].c, depth: 0, score: 0, nodes: 0 };
    }

    const deadline = now() + opts.timeMs;
    const tt = new Map();
    let nodes = 0;

    const evaluate = () => {
      const s = g.toMove === 1 ? g.score : -g.score;
      return opts.noise ? s + (rng() - 0.5) * opts.noise : s;
    };

    const orderMoves = (moves, p, ttMove, limit) => {
      const scored = moves.map((c) => ({ c, s: c === ttMove ? 1e9 : g.moveHeuristic(c, p) }));
      scored.sort((a, b) => b.s - a.s);
      const out = scored.map((m) => m.c);
      return limit && out.length > limit ? out.slice(0, limit) : out;
    };

    function negamax(depth, alpha, beta, ply) {
      nodes += 1;
      if ((nodes & 1023) === 0 && now() > deadline) throw TIMEOUT;
      const p = g.toMove;
      const q = 3 - p;

      if (g.winningCells(p).length) return WIN_SCORE - ply;
      if (g.moves.length === g.geo.cells) return 0;

      // Threat checks come before the depth cutoff so a fork (two open wins for
      // the opponent) is recognised even at the horizon, and forced blocks are
      // searched without spending depth (branching factor 1, bounded by MAX_PLY).
      const threats = g.winningCells(q);
      if (threats.length >= 2) return -(WIN_SCORE - ply - 1);
      const forced = threats.length === 1;
      if (depth <= 0 && !(forced && ply < MAX_PLY)) return evaluate();

      const key = g.hashKey;
      const hit = depth > 0 ? tt.get(key) : undefined;
      let ttMove = -1;
      if (hit) {
        ttMove = hit.move;
        if (hit.depth >= depth) {
          if (hit.flag === 0) return hit.score;
          if (hit.flag === 1 && hit.score >= beta) return hit.score;
          if (hit.flag === -1 && hit.score <= alpha) return hit.score;
        }
      }

      const moves = forced ? threats : orderMoves(g.legalMoves(), p, ttMove, opts.beam);
      const childDepth = forced ? Math.max(depth, 0) : depth - 1;

      const alpha0 = alpha;
      let best = -Infinity;
      let bestMove = moves[0];
      for (const c of moves) {
        g.play(c);
        let s;
        try {
          s = -negamax(childDepth, -beta, -alpha, ply + 1);
        } finally {
          g.undo();
        }
        if (s > best) { best = s; bestMove = c; }
        if (s > alpha) alpha = s;
        if (alpha >= beta) break;
      }
      const flag = best <= alpha0 ? -1 : best >= beta ? 1 : 0;
      if (depth > 0) tt.set(key, { depth, score: best, flag, move: bestMove });
      return best;
    }

    // Root: forced block if the opponent threatens; otherwise all moves, ordered.
    const threats = g.winningCells(3 - me);
    let rootMoves = threats.length ? threats.slice() : orderMoves(legal, me, -1, 0);
    let bestCell = rootMoves[0];
    let bestScore = -Infinity;
    let reached = 0;
    // Deepest result that did not "prove" a loss. Proofs of loss assume perfect
    // play by the opponent (and the beam can make them pessimistic), so when the
    // deepest search says every move loses we keep fighting with the best move
    // from the deepest iteration that still saw a game.
    let lastSafe = null;

    for (let depth = 1; depth <= opts.maxDepth; depth += 1) {
      let iterBest = -Infinity;
      let iterCell = rootMoves[0];
      const scores = new Map();
      try {
        let alpha = -Infinity;
        for (const c of rootMoves) {
          g.play(c);
          let s;
          try {
            // With noise (weaker levels) keep a full window so near-equal moves vary.
            s = -negamax(depth - 1, -Infinity, opts.noise ? Infinity : -alpha, 1);
          } finally {
            g.undo();
          }
          scores.set(c, s);
          if (s > iterBest) { iterBest = s; iterCell = c; }
          if (s > alpha) alpha = s;
        }
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        break;
      }
      bestCell = iterCell;
      bestScore = iterBest;
      reached = depth;
      if (bestScore > -(WIN_SCORE - 100)) lastSafe = { cell: bestCell, score: bestScore, depth };
      if (Math.abs(bestScore) >= WIN_SCORE - 100) break; // proven result
      if (now() > deadline) break;
      // Next iteration: best move first, then by this iteration's scores.
      rootMoves = rootMoves.slice().sort((a, b) => (scores.get(b) ?? -Infinity) - (scores.get(a) ?? -Infinity));
    }

    if (bestScore <= -(WIN_SCORE - 100) && lastSafe) {
      return { cell: lastSafe.cell, depth: lastSafe.depth, score: lastSafe.score, nodes, lost: true };
    }
    return { cell: bestCell, depth: reached, score: bestScore, nodes };
  }

  root.FourEngine = { WIN_LENGTH, WIN_SCORE, LEVELS, Game, getGeometry, buildDirections, chooseMove };
})(typeof self !== "undefined" ? self : globalThis);
