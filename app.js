/* app.js — UI for 3D / 4D four-in-a-row.
 *
 * Game rules, win detection and the AI live in engine.js (FourEngine); the AI runs
 * in ai-worker.js when workers are available. Online play goes through net.js.
 * This file owns: setup screen, board rendering (stacked 3D view and flat layer
 * view), input (pointer, keyboard, coordinates), turn flow, and the online protocol.
 */
"use strict";

const LAYER_SPACING = 72;
const LAYER_DRIFT = 18;
const DEFAULT_VIEW = { rotX: 58, rotZ: -34, distance: 120 };
const AI_MIN_DELAY_MS = 380;
const SETUP_KEY = "fiar-setup-v2";

const COLORS = { 1: "Orange", 2: "Blue" };

const S = {
  setup: {
    opponent: "local", // local | ai | online
    level: "medium",
    humanFirst: "1",
    dims: "3",
    size: "5",
    display: "visual", // visual | blind
    gravity: false,
  },
  config: null, // { dims, size, gravity, display, opponent, level }
  game: null, // FourEngine.Game
  sides: { 1: "local", 2: "local" }, // local | ai | me | remote
  tally: { 1: 0, 2: 0, draw: 0 },
  scoredGame: false,
  ui: { layout: "stack", layoutChosen: false, hints: false, drawerOpen: false, hover: -1, reviewing: false },
  view: { ...DEFAULT_VIEW },
  drag: { active: false, moved: false, suppressClick: false, lastX: 0, lastY: 0, pointers: new Map(), pinchStart: 0, pinchCamera: 0 },
  ai: { gen: 0, busy: false, worker: null, workerBroken: false },
  online: { role: null, code: null, connected: false, gameNo: 1, guestToken: null, pendingUndo: null, pendingRestart: null, lastSync: -Infinity, lastRequest: -Infinity },
  board: { key: "", cellEls: [], layerEls: [], anim: null },
};

const $ = (id) => document.getElementById(id);
const dom = {
  setupScreen: $("setupScreen"),
  gameScreen: $("gameScreen"),
  dimHint: $("dimHint"),
  gravityToggle: $("gravityToggle"),
  startBtn: $("startBtn"),
  backBtn: $("backBtn"),
  statusPill: $("statusPill"),
  statusStone: $("statusStone"),
  statusText: $("statusText"),
  layoutBtn: $("layoutBtn"),
  layoutLbl: $("layoutLbl"),
  undoBtn: $("undoBtn"),
  menuBtn: $("menuBtn"),
  drawer: $("drawer"),
  name1: $("name1"),
  name2: $("name2"),
  tally1: $("tally1"),
  tally2: $("tally2"),
  gameMeta: $("gameMeta"),
  cameraSection: $("cameraSection"),
  rotXInput: $("rotXInput"),
  rotZInput: $("rotZInput"),
  zoomInput: $("zoomInput"),
  resetViewBtn: $("resetViewBtn"),
  hintsToggle: $("hintsToggle"),
  moveLog: $("moveLog"),
  resetBtn: $("resetBtn"),
  boardArea: $("boardArea"),
  boardContainer: $("boardContainer"),
  blindPanel: $("blindPanel"),
  blindHint: $("blindHint"),
  blindLog: $("blindLog"),
  coordReadout: $("coordReadout"),
  onlineCard: $("onlineCard"),
  shareLink: $("shareLink"),
  copyLinkBtn: $("copyLinkBtn"),
  onlineStatus: $("onlineStatus"),
  endCard: $("endCard"),
  endText: $("endText"),
  endSub: $("endSub"),
  rematchBtn: $("rematchBtn"),
  reviewBtn: $("reviewBtn"),
  promptCard: $("promptCard"),
  promptText: $("promptText"),
  promptYes: $("promptYes"),
  promptNo: $("promptNo"),
  toast: $("toast"),
};

// ─── Boot & setup ─────────────────────────────────────────────────────────

function boot() {
  loadSetup();
  wireEvents();
  renderSetup();
  const room = new URLSearchParams(location.search).get("room");
  if (room !== null) {
    if (Net.isValidCode(room)) joinOnline(room);
    else {
      history.replaceState(null, "", location.pathname);
      showPrompt("That game link looks incomplete. Ask your friend to send it again.", "OK", null, () => {});
    }
  }
}

function loadSetup() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) || "null");
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(S.setup)) if (k in saved) S.setup[k] = saved[k];
    }
  } catch (_) { /* storage unavailable */ }
  if (S.setup.opponent === "online" && !window.RTCPeerConnection) S.setup.opponent = "local";
}

function saveSetup() {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(S.setup)); } catch (_) { /* ignore */ }
}

function wireEvents() {
  document.querySelectorAll(".seg[data-setting]").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn) return;
      S.setup[seg.dataset.setting] = btn.dataset.value;
      if (S.setup.dims === "4" && S.setup.size === "6") S.setup.size = "5";
      renderSetup();
    });
  });
  dom.gravityToggle.addEventListener("change", () => { S.setup.gravity = dom.gravityToggle.checked; renderSetup(); });
  dom.startBtn.addEventListener("click", startFromSetup);
  document.querySelectorAll(".theme-toggle").forEach((b) => b.addEventListener("click", toggleTheme));

  dom.backBtn.addEventListener("click", backToSetup);
  dom.layoutBtn.addEventListener("click", toggleLayout);
  dom.undoBtn.addEventListener("click", requestUndo);
  dom.menuBtn.addEventListener("click", () => setDrawer(!S.ui.drawerOpen));
  dom.resetBtn.addEventListener("click", () => requestRestart());
  dom.rematchBtn.addEventListener("click", () => requestRestart());
  dom.reviewBtn.addEventListener("click", () => { S.ui.reviewing = true; dom.endCard.classList.add("hidden"); });
  dom.hintsToggle.addEventListener("change", () => { S.ui.hints = dom.hintsToggle.checked; renderBoard(); });

  dom.rotXInput.addEventListener("input", onSliders);
  dom.rotZInput.addEventListener("input", onSliders);
  dom.zoomInput.addEventListener("input", onSliders);
  dom.resetViewBtn.addEventListener("click", resetView);

  document.querySelectorAll("[data-coord-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector("input");
      if (placeFromText(input.value)) input.value = "";
    });
  });

  const bc = dom.boardContainer;
  bc.addEventListener("click", onBoardClick);
  bc.addEventListener("pointerover", onBoardHover);
  bc.addEventListener("pointerleave", () => setHover(-1));
  bc.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  bc.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", () => { if (S.ui.layout === "flat") renderBoard(true); });
  document.addEventListener("keydown", onKey);

  dom.copyLinkBtn.addEventListener("click", copyShareLink);
  dom.shareLink.addEventListener("focus", () => dom.shareLink.select());

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    let stored = null;
    try { stored = localStorage.getItem("wc-color-theme"); } catch (_) { /* ignore */ }
    if (stored !== "dark" && stored !== "light") applyTheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });
  // pagehide also fires on mobile tab switches/closes where beforeunload does not.
  window.addEventListener("pagehide", () => { if (S.online.role) Net.leave(true); });
}

function renderSetup() {
  const st = S.setup;
  document.querySelectorAll(".seg[data-setting]").forEach((seg) => {
    seg.querySelectorAll("button").forEach((b) => {
      const active = String(st[seg.dataset.setting]) === b.dataset.value;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
      if (seg.dataset.setting === "size") b.disabled = st.dims === "4" && b.dataset.value === "6";
    });
  });
  dom.gravityToggle.checked = !!st.gravity;
  dom.setupScreen.classList.toggle("opp-ai", st.opponent === "ai");
  dom.setupScreen.classList.toggle("opp-online", st.opponent === "online");
  const n = Number(st.size);
  dom.dimHint.textContent = st.dims === "4"
    ? `${n} cubes of ${n}×${n}×${n} (${n ** 4} cells), 40 line directions. Brain-burning.`
    : `One ${n}×${n}×${n} cube (${n ** 3} cells), 13 line directions.`;
  dom.startBtn.textContent = st.opponent === "online" ? "Create game link" : "Start game";
  saveSetup();
}

function startFromSetup() {
  const st = S.setup;
  const config = {
    dims: Number(st.dims),
    size: Math.min(Number(st.size), st.dims === "4" ? 5 : 6),
    gravity: !!st.gravity,
    display: st.display,
    opponent: st.opponent,
    level: st.level,
  };
  S.tally = { 1: 0, 2: 0, draw: 0 };
  if (config.opponent === "online") {
    hostOnline(config);
    return;
  }
  leaveOnline();
  const sides = config.opponent === "ai"
    ? (st.humanFirst === "1" ? { 1: "me", 2: "ai" } : { 1: "ai", 2: "me" })
    : { 1: "local", 2: "local" };
  startGame(config, sides);
}

function startGame(config, sides, moves = []) {
  cancelAI();
  S.config = config;
  S.sides = sides;
  S.game = new FourEngine.Game(config.size, config.dims, config.gravity);
  for (const c of moves) S.game.play(c);
  S.scoredGame = false;
  S.ui.reviewing = false;
  S.ui.hover = -1;
  S.board.anim = null;
  S.online.pendingUndo = null;
  S.online.pendingRestart = null;
  if (!S.ui.layoutChosen && window.innerWidth < 700) S.ui.layout = "flat"; // easier to tap on phones
  S.view = fittedView();
  dom.endCard.classList.add("hidden");
  dom.promptCard.classList.add("hidden");
  dom.setupScreen.classList.add("hidden");
  dom.gameScreen.classList.remove("hidden");
  setDrawer(config.display === "blind" ? false : S.ui.drawerOpen);
  renderAll();
  maybeAIMove();
}

function backToSetup() {
  cancelAI();
  leaveOnline();
  if (new URLSearchParams(location.search).has("room")) {
    history.replaceState(null, "", location.pathname);
  }
  dom.onlineCard.classList.add("hidden");
  dom.endCard.classList.add("hidden");
  dom.promptCard.classList.add("hidden");
  dom.gameScreen.classList.add("hidden");
  dom.setupScreen.classList.remove("hidden");
  renderSetup();
}

// ─── Theme ────────────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0e141a" : "#003262");
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  // Same key as the Hugo Blox site, so the preference carries across both.
  try { localStorage.setItem("wc-color-theme", next); } catch (_) { /* ignore */ }
}

// ─── Turn flow ────────────────────────────────────────────────────────────

/** Whose input is the board waiting for? */
function canActLocally() {
  const g = S.game;
  if (!g || g.isOver || S.ai.busy) return false;
  const side = S.sides[g.toMove];
  if (side === "remote") return false;
  if (S.online.role && !S.online.connected) return false;
  return side === "local" || side === "me";
}

function attemptMove(rawCell) {
  const g = S.game;
  if (!canActLocally()) {
    if (g && !g.isOver && S.sides[g.toMove] === "remote") toast("Waiting for your friend's move");
    return false;
  }
  const cell = g.resolveTarget(rawCell);
  if (cell < 0) { toast("That column is full"); return false; }
  if (!g.isPlayable(cell)) { toast("That cell is taken"); return false; }
  applyMove(cell, "local");
  return true;
}

function applyMove(cell, source) {
  const g = S.game;
  const n = g.moves.length;
  if (g.gravity) {
    const z = g.geo.coords[cell][2];
    const fall = g.size - 1 - z;
    S.board.anim = { cell, dx: fall * LAYER_DRIFT, dy: -fall * LAYER_DRIFT, dz: fall * LAYER_SPACING };
  } else {
    S.board.anim = { cell };
  }
  g.play(cell);
  if (S.online.role && source === "local") Net.send({ t: "move", cell, n });
  onPositionChanged();
}

function onPositionChanged() {
  const g = S.game;
  if (g.isOver && !S.scoredGame) {
    S.scoredGame = true;
    if (g.winner) S.tally[g.winner] += 1; else S.tally.draw += 1;
  }
  renderAll();
  maybeAIMove();
}

function maybeAIMove() {
  const g = S.game;
  if (!g || g.isOver || S.sides[g.toMove] !== "ai" || S.ai.busy) return;
  const gen = ++S.ai.gen;
  S.ai.busy = true;
  renderStatus();
  const started = performance.now();
  const finish = (cell) => {
    if (gen !== S.ai.gen) return;
    const wait = Math.max(0, AI_MIN_DELAY_MS - (performance.now() - started));
    setTimeout(() => {
      if (gen !== S.ai.gen) return;
      S.ai.busy = false;
      if (cell >= 0 && S.game.isPlayable(cell)) applyMove(cell, "ai");
      else renderAll();
    }, wait);
  };
  const runInline = () => setTimeout(() => {
    if (gen !== S.ai.gen) return;
    finish(FourEngine.chooseMove(S.game, S.config.level).cell);
  }, 30);

  const worker = getWorker();
  if (!worker) { runInline(); return; }
  worker.onmessage = (e) => {
    if (e.data.id !== gen) return;
    if (e.data.error) { console.warn("AI worker:", e.data.error); runInline(); return; }
    finish(e.data.cell);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    S.ai.workerBroken = true;
    S.ai.worker = null;
    runInline();
  };
  worker.postMessage({ id: gen, size: g.size, dims: g.dims, gravity: g.gravity, moves: g.moves.slice(), level: S.config.level });
}

function getWorker() {
  if (S.ai.workerBroken) return null;
  if (!S.ai.worker) {
    try {
      S.ai.worker = new Worker("./ai-worker.js");
    } catch (_) {
      S.ai.workerBroken = true; // e.g. opened from file:// — search runs inline instead
      return null;
    }
  }
  return S.ai.worker;
}

function cancelAI() {
  S.ai.gen += 1;
  if (S.ai.busy && S.ai.worker) {
    // Abandon a long search immediately rather than waiting for it to finish.
    S.ai.worker.terminate();
    S.ai.worker = null;
  }
  S.ai.busy = false;
}

/** Undo until it is `side`'s turn again, having removed at least one of their moves. */
function undoToSide(side) {
  const g = S.game;
  undoTally();
  let removedOwn = false;
  while (g.moves.length) {
    const last = g.moves[g.moves.length - 1];
    const owner = g.board[last];
    g.undo();
    if (owner === side) removedOwn = true;
    if (removedOwn && g.toMove === side) break;
  }
  S.board.anim = null;
  S.ui.reviewing = false;
  dom.endCard.classList.add("hidden");
}

function requestUndo() {
  const g = S.game;
  if (!g || !g.moves.length) { toast("Nothing to undo"); return; }
  if (S.online.role) {
    if (!S.online.connected) { toast("Your friend isn't connected"); return; }
    const mine = mySide();
    if (!g.moves.some((c) => g.board[c] === mine)) { toast("You haven't moved yet"); return; }
    if (S.online.pendingUndo) { toast("Still waiting for your friend's answer"); return; }
    S.online.pendingUndo = { n: g.moves.length };
    Net.send({ t: "undo-req", n: g.moves.length });
    toast("Asked your friend to allow an undo…");
    return;
  }
  if (S.config.opponent === "ai") {
    const human = S.sides[1] === "me" ? 1 : 2;
    if (!g.moves.some((c) => g.board[c] === human)) { toast("Nothing to undo yet"); return; }
    cancelAI();
    undoToSide(human);
  } else {
    undoTally();
    g.undo();
    S.board.anim = null;
    dom.endCard.classList.add("hidden");
    S.scoredGame = false;
  }
  renderAll();
  maybeAIMove();
}

function undoTally() {
  const g = S.game;
  if (!S.scoredGame) return;
  if (g.winner) S.tally[g.winner] -= 1; else S.tally.draw -= 1;
  S.scoredGame = false;
}

function requestRestart() {
  if (!S.game) return;
  if (S.online.role) {
    if (!S.online.connected) { toast("Your friend isn't connected"); return; }
    const gameNo = S.online.gameNo + 1;
    if (S.game.isOver) {
      Net.send({ t: "rematch", gameNo });
      startOnlineRound(gameNo);
    } else if (!S.online.pendingRestart) {
      // Abandoning a game in progress needs the other player's consent.
      S.online.pendingRestart = { gameNo };
      Net.send({ t: "restart-req", gameNo });
      toast("Asked your friend to start a new game…");
    }
    return;
  }
  const sides = S.config.opponent === "ai" && S.game.isOver
    ? { 1: S.sides[2], 2: S.sides[1] } // after a finished game vs AI, swap who starts
    : S.sides;
  startGame(S.config, sides);
}

function placeFromText(text) {
  const g = S.game;
  if (!g) return false;
  const nums = text.split(/[\s,;()]+/).filter(Boolean).map(Number);
  const want = g.dims - (g.gravity ? 1 : 0);
  if (nums.length !== want || nums.some((v) => !Number.isInteger(v))) {
    toast(`Enter ${coordTemplate()} (1–${g.size})`);
    return false;
  }
  if (nums.some((v) => v < 1 || v > g.size)) { toast(`Coordinates must be 1–${g.size}`); return false; }
  const v = nums.map((x) => x - 1);
  let cell;
  if (g.gravity) {
    const [x, y, w = 0] = v;
    cell = g.geo.colCells[x + g.size * (y + g.size * w)][0];
  } else {
    cell = g.geo.index(v);
  }
  return attemptMove(cell);
}

function coordTemplate() {
  const g = S.game || { dims: Number(S.setup.dims), gravity: S.setup.gravity };
  if (g.dims === 4) return g.gravity ? "x,y,w" : "x,y,z,w";
  return g.gravity ? "x,y" : "x,y,z";
}

// ─── Rendering ────────────────────────────────────────────────────────────

function renderAll() {
  if (!S.game || !S.config) return;
  renderBoard();
  renderStatus();
  renderLog();
  renderDrawer();
  renderEnd();
}

function playerName(p) {
  const side = S.sides[p];
  if (side === "ai") return "AI";
  if (side === "me") return "You";
  if (side === "remote") return "Friend";
  return COLORS[p];
}

function renderStatus() {
  const g = S.game;
  if (!g) return;
  const pill = dom.statusPill;
  pill.classList.remove("thinking", "over");
  let stone = g.toMove;
  let text;
  if (g.winner) {
    stone = g.winner;
    const who = S.sides[g.winner];
    text = who === "me" ? "You win!" : who === "ai" ? "AI wins" : who === "remote" ? "Your friend wins" : `${COLORS[g.winner]} wins!`;
    pill.classList.add("over");
  } else if (g.isOver) {
    stone = 0;
    text = "Draw — the board is full";
    pill.classList.add("over");
  } else if (S.online.role && !S.online.connected) {
    if (S.online.role === "guest") text = "Host disconnected";
    else text = g.moves.length ? "Friend disconnected" : "Waiting for your friend…";
  } else {
    const side = S.sides[g.toMove];
    if (side === "ai") { text = "AI is thinking…"; pill.classList.add("thinking"); }
    else if (side === "me") text = "Your move";
    else if (side === "remote") { text = "Friend's move…"; pill.classList.add("thinking"); }
    else text = `${COLORS[g.toMove]} to move`;
  }
  dom.statusStone.className = stone ? `stone s${stone}` : "stone hidden";
  dom.statusText.textContent = text;
  dom.undoBtn.disabled = !g.moves.length;
  dom.layoutLbl.textContent = S.ui.layout === "stack" ? "Layers" : "Stack";
  dom.layoutBtn.classList.toggle("hidden", S.config.display === "blind");
  document.title = `${g.isOver ? "Game over" : text} · Four-in-a-Row`;
}

function renderDrawer() {
  const g = S.game;
  dom.name1.textContent = playerName(1);
  dom.name2.textContent = playerName(2);
  dom.tally1.textContent = S.tally[1];
  dom.tally2.textContent = S.tally[2];
  const parts = [`${g.size}^${g.dims} board`, g.gravity ? "gravity" : "free placement"];
  if (S.config.opponent === "ai") parts.push(`AI: ${S.config.level}`);
  if (S.online.role) parts.push(`room ${S.online.code}`);
  if (S.tally.draw) parts.push(`${S.tally.draw} draw${S.tally.draw > 1 ? "s" : ""}`);
  dom.gameMeta.textContent = parts.join(" · ");
  dom.cameraSection.classList.toggle("hidden", S.ui.layout !== "stack" || S.config.display === "blind");
  document.querySelectorAll("[data-coord-form] input").forEach((i) => { i.placeholder = `${coordTemplate()}  e.g. ${exampleCoord()}`; });
  dom.blindHint.textContent = `Type ${coordTemplate()} (1-based, 1–${g.size})${g.gravity ? "; the stone drops to the lowest free z" : ""}.`;
  dom.hintsToggle.checked = S.ui.hints;
}

function exampleCoord() {
  const g = S.game;
  const n = Math.min(2, g.size);
  return Array.from({ length: g.dims - (g.gravity ? 1 : 0) }, (_, i) => [n, g.size - 1, 1, 2][i]).join(",");
}

function fmtCell(cell) {
  return `(${S.game.geo.coords[cell].map((v) => v + 1).join(",")})`;
}

function renderLog() {
  const g = S.game;
  const rows = g.moves.map((c, i) => {
    const p = g.board[c];
    return `<li><span class="n">${i + 1}.</span><i class="stone s${p}"></i>${fmtCell(c)}</li>`;
  });
  dom.moveLog.innerHTML = rows.length ? rows.join("") : `<li class="empty">No moves yet.</li>`;
  dom.moveLog.scrollTop = dom.moveLog.scrollHeight;
  dom.blindLog.innerHTML = rows.length ? rows.slice(-8).reverse().join("") : `<li class="empty">No moves yet.</li>`;
}

function renderEnd() {
  const g = S.game;
  const promptOpen = !dom.promptCard.classList.contains("hidden");
  const show = g.isOver && !S.ui.reviewing && !promptOpen;
  dom.endCard.classList.toggle("hidden", !show);
  if (!show) return;
  const who = g.winner ? S.sides[g.winner] : null;
  let title;
  if (!g.winner) title = "Draw — the board is full.";
  else if (who === "me") title = "You win! 🎉";
  else if (who === "ai") title = "The AI wins this one.";
  else if (who === "remote") title = "Your friend wins.";
  else title = `${COLORS[g.winner]} wins!`;
  dom.endText.innerHTML = (g.winner ? `<i class="stone s${g.winner}"></i>` : "") + escapeHtml(title);
  const score = `${playerName(1)} ${S.tally[1]} – ${S.tally[2]} ${playerName(2)}`;
  const line = g.winLine ? `Line: ${g.winLine.map(fmtCell).join(" → ")}` : "";
  dom.endSub.textContent = [score, line].filter(Boolean).join(" · ");
  dom.rematchBtn.textContent = S.config.opponent === "ai" ? "Rematch (swap sides)" : S.online.role ? "Rematch" : "Play again";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function toggleLayout() {
  if (!S.config || S.config.display === "blind") return;
  S.ui.layout = S.ui.layout === "stack" ? "flat" : "stack";
  S.ui.layoutChosen = true;
  renderAll();
}

function setDrawer(open) {
  S.ui.drawerOpen = open;
  dom.drawer.classList.toggle("hidden", !open);
  dom.gameScreen.classList.toggle("drawer-open", open);
  dom.menuBtn.setAttribute("aria-expanded", String(open));
  // On wide screens the drawer docks beside the board, so the flat grid re-flows.
  if (S.game && S.ui.layout === "flat" && S.config.display !== "blind") renderBoard(true);
}

/** Build (if needed) and update the board DOM. */
function renderBoard(forceRebuild = false) {
  const g = S.game;
  const blind = S.config.display === "blind";
  dom.blindPanel.classList.toggle("hidden", !blind);
  dom.boardContainer.classList.toggle("hidden", blind);
  if (blind) return;

  const layout = S.ui.layout;
  const key = `${layout}:${g.size}:${g.dims}`;
  if (forceRebuild || key !== S.board.key) {
    buildBoard(layout);
    S.board.key = key;
  }
  dom.boardArea.classList.toggle("flat-mode", layout === "flat");
  dom.boardContainer.classList.toggle("stack-mode", layout === "stack");
  dom.boardContainer.classList.toggle("has-winner", !!g.winner);
  updateCells();
  if (layout === "stack") applyViewTransform();
}

function makeCell(cell) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cell";
  b.dataset.cell = String(cell);
  S.board.cellEls[cell] = b;
  return b;
}

function buildBoard(layout) {
  const g = S.game;
  const n = g.size;
  const bc = dom.boardContainer;
  bc.innerHTML = "";
  S.board.cellEls = new Array(g.geo.cells);
  S.board.layerEls = []; // [w][z] -> element
  const wCount = g.dims === 4 ? n : 1;

  if (layout === "stack") {
    const is4D = g.dims === 4;
    const cellPx = is4D ? 30 : 38;
    const gap = is4D ? 3 : 4;
    bc.style.setProperty("--cell", `${cellPx}px`);
    const holder = document.createElement("div");
    holder.className = is4D ? "w-grid" : "";
    for (let w = 0; w < wCount; w += 1) {
      S.board.layerEls[w] = [];
      const boardW = n * cellPx + (n - 1) * gap + 16;
      const total = boardW + (n - 1) * LAYER_DRIFT;
      const layers = document.createElement("div");
      layers.className = "layers";
      layers.style.width = `${total}px`;
      layers.style.height = `${total}px`;
      for (let z = 0; z < n; z += 1) {
        const layer = document.createElement("div");
        layer.className = "layer";
        layer.style.gap = `${gap}px`;
        layer.style.gridTemplateColumns = `repeat(${n}, ${cellPx}px)`;
        layer.style.transform = `translate3d(${z * LAYER_DRIFT}px, ${-z * LAYER_DRIFT}px, ${z * LAYER_SPACING}px)`;
        for (let y = 0; y < n; y += 1) {
          for (let x = 0; x < n; x += 1) layer.appendChild(makeCell(g.geo.index([x, y, z, w].slice(0, g.dims))));
        }
        const label = document.createElement("div");
        label.className = "layer-label";
        label.textContent = `z=${z + 1}`;
        layer.appendChild(label);
        layers.appendChild(layer);
        S.board.layerEls[w][z] = layer;
      }
      if (is4D) {
        const section = document.createElement("div");
        section.className = "w-section";
        section.appendChild(layers);
        const lbl = document.createElement("div");
        lbl.className = "w-label";
        lbl.textContent = `w = ${w + 1}`;
        section.appendChild(lbl);
        holder.appendChild(section);
      } else {
        holder.appendChild(layers);
      }
    }
    bc.appendChild(is4D ? holder : holder.firstChild);
    return;
  }

  // Flat layout: every z-layer as a 2D grid, side by side (one row per w in 4D).
  const avail = Math.max(280, dom.boardArea.clientWidth - 32);
  const gapPx = 3;
  let cellPx = 22;
  for (let perRow = n; perRow >= 1; perRow -= 1) {
    const room = (avail - (perRow - 1) * 16 - perRow * 18) / perRow; // per-layer width
    cellPx = Math.floor((room - (n - 1) * gapPx) / n);
    if (cellPx >= 26 || perRow === 1) break;
  }
  if (g.dims === 4) {
    // Keep a 4D board on as few screens as possible.
    const availH = Math.max(320, dom.boardArea.clientHeight - 90);
    const byHeight = Math.floor((availH / n - 34 - (n - 1) * gapPx) / n);
    cellPx = Math.max(18, Math.min(cellPx, byHeight));
  }
  cellPx = Math.max(18, Math.min(44, cellPx));
  bc.style.setProperty("--cell", `${cellPx}px`);

  const flat = document.createElement("div");
  flat.className = "flat";
  for (let w = 0; w < wCount; w += 1) {
    S.board.layerEls[w] = [];
    const row = document.createElement("div");
    row.className = "flat-row";
    const layersEl = document.createElement("div");
    layersEl.className = "flat-layers";
    for (let z = 0; z < n; z += 1) {
      const box = document.createElement("div");
      box.className = "flat-layer";
      const grid = document.createElement("div");
      grid.className = "flat-grid";
      grid.style.gridTemplateColumns = `repeat(${n}, ${cellPx}px)`;
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) grid.appendChild(makeCell(g.geo.index([x, y, z, w].slice(0, g.dims))));
      }
      const label = document.createElement("div");
      label.className = "flat-label";
      label.textContent = g.dims === 4 ? `z=${z + 1}` : `z = ${z + 1}${z === 0 ? " (bottom)" : z === n - 1 ? " (top)" : ""}`;
      box.append(grid, label);
      layersEl.appendChild(box);
      S.board.layerEls[w][z] = box;
    }
    if (g.dims === 4) {
      const lbl = document.createElement("div");
      lbl.className = "w-label";
      lbl.textContent = `w = ${w + 1}`;
      row.appendChild(lbl);
    }
    row.appendChild(layersEl);
    flat.appendChild(row);
  }
  bc.appendChild(flat);
}

function updateCells() {
  const g = S.game;
  const els = S.board.cellEls;
  const last = g.moves.length ? g.moves[g.moves.length - 1] : -1;
  const winSet = new Set(g.winLine || []);
  const threat = [null, new Set(), new Set()];
  if (S.ui.hints && !g.isOver) {
    for (const p of [1, 2]) for (const c of g.threatCells(p)) threat[p].add(c);
  }
  const interactive = canActLocally();
  for (let c = 0; c < els.length; c += 1) {
    const el = els[c];
    const v = g.board[c];
    let cls = "cell";
    if (v) cls += ` p${v}`;
    if (c === last) cls += " last";
    if (winSet.has(c)) cls += " win";
    if (!v && threat[1].has(c)) cls += " threat-1";
    if (!v && threat[2].has(c)) cls += " threat-2";
    if (!interactive || (!g.gravity && v)) cls += " blocked";
    el.className = cls;
    el.setAttribute("aria-label", `${fmtCell(c)} ${v ? COLORS[v] : "empty"}`);
  }
  const anim = S.board.anim;
  if (anim && els[anim.cell]) {
    const el = els[anim.cell];
    if (S.ui.layout === "stack" && anim.dz !== undefined) {
      el.style.setProperty("--drop-from-x", `${anim.dx}px`);
      el.style.setProperty("--drop-from-y", `${anim.dy}px`);
      el.style.setProperty("--drop-from-z", `${anim.dz}px`);
      el.classList.add("drop-in");
    } else {
      el.classList.add("pop-in");
    }
    S.board.anim = null;
  }
  applyHover();
}

// ─── Hover preview ────────────────────────────────────────────────────────

function onBoardHover(e) {
  const el = e.target.closest(".cell");
  setHover(el ? Number(el.dataset.cell) : -1);
}

function setHover(cell) {
  if (S.ui.hover === cell) return;
  S.ui.hover = cell;
  applyHover();
}

function applyHover() {
  const g = S.game;
  const els = S.board.cellEls;
  dom.boardContainer.querySelectorAll(".col-hl, .ghost-1, .ghost-2").forEach((el) => el.classList.remove("col-hl", "ghost-1", "ghost-2"));
  dom.boardContainer.querySelectorAll(".layer-hl").forEach((el) => el.classList.remove("layer-hl"));
  const cell = S.ui.hover;
  if (!g || cell < 0 || !els[cell]) {
    dom.coordReadout.classList.remove("show");
    return;
  }
  const target = g.resolveTarget(cell);
  const shown = target >= 0 ? target : cell;
  const [, , z, w = 0] = g.geo.coords[shown];
  S.board.layerEls[w]?.[z]?.classList.add("layer-hl");
  if (g.gravity) {
    for (const c of g.geo.colCells[g.geo.columnOf[cell]]) els[c].classList.add("col-hl");
  }
  if (canActLocally() && target >= 0 && g.isPlayable(target)) els[target].classList.add(`ghost-${g.toMove}`);
  dom.coordReadout.textContent = `${coordNames()} = ${fmtCell(shown)}${g.gravity && target < 0 ? " · column full" : ""}`;
  dom.coordReadout.classList.add("show");
}

function coordNames() {
  return S.game.dims === 4 ? "(x,y,z,w)" : "(x,y,z)";
}

function onBoardClick(e) {
  if (S.drag.suppressClick) {
    S.drag.suppressClick = false;
    return;
  }
  const el = e.target.closest(".cell");
  if (!el) return;
  attemptMove(Number(el.dataset.cell));
}

// ─── Camera (stacked view) ────────────────────────────────────────────────

function onSliders() {
  S.view.rotX = Number(dom.rotXInput.value);
  S.view.rotZ = Number(dom.rotZInput.value);
  S.view.distance = Number(dom.zoomInput.value);
  applyViewTransform();
}

/** Default camera, pulled back on small screens so the whole stack fits. */
function fittedView() {
  const v = { ...DEFAULT_VIEW };
  const short = Math.min(window.innerWidth, window.innerHeight);
  const size = S.game ? S.game.size : 5;
  if (S.game && S.game.dims === 4) v.distance = short < 700 ? -260 : window.innerWidth < 1200 ? -120 : -40;
  else if (short < 700) v.distance = clamp(-60 - (700 - short) * 0.55 - (size - 4) * 40, -260, 60);
  else if (size === 6) v.distance = 40;
  return v;
}

function resetView() {
  S.view = fittedView();
  applyViewTransform();
}

function applyViewTransform() {
  dom.rotXInput.value = String(Math.round(S.view.rotX));
  dom.rotZInput.value = String(Math.round(S.view.rotZ));
  dom.zoomInput.value = String(Math.round(S.view.distance));
  const shift = S.game && S.game.dims === 4 ? 40 : 88 + Math.max(0, (S.game?.size || 5) - 5) * 28;
  dom.boardContainer.querySelectorAll(".layers").forEach((el) => {
    el.style.setProperty("--rot-x", `${S.view.rotX}deg`);
    el.style.setProperty("--rot-z", `${S.view.rotZ}deg`);
    el.style.setProperty("--camera-z", `${S.view.distance}px`);
    el.style.setProperty("--board-shift-y", `${shift}px`);
  });
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function onPointerDown(e) {
  if (S.ui.layout !== "stack" || S.config?.display === "blind") return;
  if (e.pointerType === "mouse" && e.target.closest(".cell")) return;
  const d = S.drag;
  d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  d.active = true;
  if (d.pointers.size === 1) {
    d.moved = false;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  } else if (d.pointers.size === 2) {
    const [a, b] = [...d.pointers.values()];
    d.pinchStart = dist2D(a, b);
    d.pinchCamera = S.view.distance;
  }
  dom.boardContainer.classList.add("dragging");
}

function onPointerMove(e) {
  const d = S.drag;
  if (!d.active || !d.pointers.has(e.pointerId)) return;
  d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (d.pointers.size === 1) {
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    S.view.rotZ = clamp(S.view.rotZ + dx * 0.35, -85, 20);
    S.view.rotX = clamp(S.view.rotX - dy * 0.35, 25, 85);
  } else {
    const [a, b] = [...d.pointers.values()];
    const cur = dist2D(a, b);
    if (!d.pinchStart) { d.pinchStart = cur; d.pinchCamera = S.view.distance; }
    S.view.distance = clamp(d.pinchCamera + (cur - d.pinchStart) * 0.8, -260, 360);
    d.moved = true;
  }
  applyViewTransform();
  if (e.pointerType !== "mouse") e.preventDefault();
}

function onPointerUp(e) {
  const d = S.drag;
  if (!d.active) return;
  d.pointers.delete(e.pointerId);
  if (d.pointers.size === 1) {
    const [only] = [...d.pointers.values()];
    d.lastX = only.x;
    d.lastY = only.y;
    d.pinchStart = 0;
  }
  if (d.pointers.size === 0) {
    d.active = false;
    d.suppressClick = d.moved;
    d.pinchStart = 0;
    dom.boardContainer.classList.remove("dragging");
    // A click only follows if the pointer was released over the board.
    setTimeout(() => { S.drag.suppressClick = false; }, 0);
  }
}

function onWheel(e) {
  if (S.ui.layout !== "stack") return;
  e.preventDefault();
  S.view.distance = clamp(S.view.distance - Math.sign(e.deltaY) * 12, -260, 360);
  applyViewTransform();
}

function onKey(e) {
  if (dom.gameScreen.classList.contains("hidden")) return;
  if (e.target.closest("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "u") requestUndo();
  else if (k === "v") toggleLayout();
  else if (k === "h") { S.ui.hints = !S.ui.hints; renderAll(); toast(S.ui.hints ? "Threat hints on" : "Threat hints off"); }
  else if (k === "r") resetView();
  else if (k === "c") setDrawer(!S.ui.drawerOpen);
  else if (k === "n" && S.game?.isOver) requestRestart();
  else if (k === "escape") { setDrawer(false); if (S.game?.isOver) { S.ui.reviewing = true; renderEnd(); } }
  else return;
  e.preventDefault();
}

let toastTimer = 0;
function toast(msg, ms = 1800) {
  dom.toast.textContent = msg;
  dom.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.add("hidden"), ms);
}

// ─── Online play ──────────────────────────────────────────────────────────
//
// Trust model: the host's state is authoritative, but every message from the peer
// is untrusted input — each field is validated, requests that change the game
// (undo, restart) need the other player's consent, and an unexpected message is
// ignored rather than acted on. Transport-level limits live in net.js.
//
// Messages (all carry `t`):
//   hello       guest → host  { v, token }  first message; token = seat token from an earlier visit
//   welcome     host → guest  { token }  seat granted; the guest keeps the token to rejoin
//   reject      host → guest  { reason: "full" | "declined" }
//   sync        host → guest  { config, moves, gameNo, tally }  full state
//   sync-req    guest → host  ask for the full state (on join, after a rejected message)
//   move        both          { cell, n }  n = move count before the move
//   undo-req    both          { n }  undo the sender's last move; reply undo-ok { n } | undo-no
//   rematch     both          { gameNo }  next game after a finished one (no consent needed)
//   restart-req both          { gameNo }  abandon an unfinished game; reply restart-ok | restart-no
//   bye         both          leaving the room
// Who plays orange alternates by game number: odd games the host does.

const SEAT_KEY = (code) => `fiar-seat-${code}`;
const MAX_GAME_NO = 1e6;
const SYNC_MIN_INTERVAL_MS = 800;
const REQUEST_COOLDOWN_MS = 1500;

/** Integer in [lo, hi], or null. */
function intIn(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

function mySide() {
  return S.sides[1] === "me" ? 1 : 2;
}

function hostSideFor(gameNo) {
  return gameNo % 2 === 1 ? 1 : 2;
}

function sidesFor(role, gameNo) {
  const hs = hostSideFor(gameNo);
  const mine = role === "host" ? hs : 3 - hs;
  return { [mine]: "me", [3 - mine]: "remote" };
}

function freshOnline(role, code) {
  return {
    role, code, connected: false, gameNo: 1,
    guestToken: null, // host: seat token issued to the current guest
    pendingUndo: null, // { n } while my undo request is outstanding
    pendingRestart: null, // { gameNo } while my restart request is outstanding
    lastSync: -Infinity,
    lastRequest: -Infinity, // last time the peer's request opened a prompt
  };
}

async function hostOnline(config) {
  leaveOnline();
  S.online = freshOnline("host", null);
  startGame(config, sidesFor("host", 1));
  dom.onlineCard.classList.remove("hidden");
  dom.shareLink.value = "Creating room…";
  setOnlineStatus("Registering with the matchmaking server…", true);
  try {
    const code = await Net.host(onNetEvent, authorizeGuest);
    if (S.online.role !== "host") return;
    S.online.code = code;
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", code);
    for (const k of ["peerHost", "peerPort", "peerPath", "peerSecure"]) {
      const v = new URLSearchParams(location.search).get(k);
      if (v) url.searchParams.set(k, v); // only honoured on localhost (see net.js)
    }
    dom.shareLink.value = url.toString();
    setOnlineStatus("Waiting for your friend…", true);
    renderDrawer();
  } catch (err) {
    dom.shareLink.value = "";
    setOnlineStatus(err.message, false);
  }
}

function setOnlineStatus(text, pulsing) {
  dom.onlineStatus.textContent = "";
  if (pulsing) {
    const dot = document.createElement("span");
    dot.className = "pulse";
    dom.onlineStatus.appendChild(dot);
  }
  dom.onlineStatus.appendChild(document.createTextNode(text));
}

/** Host: decide whether a connecting browser gets the guest seat. */
function authorizeGuest(hello) {
  const token = typeof hello.token === "string" && /^[0-9a-f]{32}$/.test(hello.token) ? hello.token : null;
  const grant = () => {
    S.online.guestToken = Net.randomToken();
    return { ok: true, welcome: { t: "welcome", token: S.online.guestToken } };
  };
  if (S.online.role !== "host") return { ok: false, reason: "declined" };
  if (S.online.guestToken && token === S.online.guestToken) return { ok: true }; // same friend rejoining
  if (!S.online.guestToken) return grant(); // first guest
  if (Net.connected) return { ok: false, reason: "full" };
  if (!dom.promptCard.classList.contains("hidden")) return { ok: false, reason: "declined" };
  // The seat is free but was given to someone else: let the host decide.
  return new Promise((resolve) => {
    showPrompt(
      "Someone opened your game link from a new browser. Let them take your friend's seat?",
      "Let them in", "Keep them out",
      () => resolve(grant()),
      () => resolve({ ok: false, reason: "declined" })
    );
  });
}

async function joinOnline(code) {
  leaveOnline();
  S.online = freshOnline("guest", code);
  S.game = null;
  S.config = null;
  dom.setupScreen.classList.add("hidden");
  dom.gameScreen.classList.remove("hidden");
  dom.statusStone.className = "stone hidden";
  dom.statusText.textContent = "Connecting…";
  dom.blindPanel.classList.add("hidden");
  dom.boardContainer.textContent = "";
  S.board.key = "";
  let token = null;
  try { token = localStorage.getItem(SEAT_KEY(code)); } catch (_) { /* ignore */ }
  try {
    await Net.join(code, onNetEvent, { t: "hello", v: 3, token: token || "" });
    S.online.connected = true;
    dom.statusText.textContent = "Connected — waiting for the host…";
    // Ask for the game state; repeat a few times in case the first exchange is lost
    // while the channel is still settling (the host ignores these until admitted).
    for (let i = 0; i < 6 && S.online.role === "guest" && !S.game && Net.connected; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!S.game) Net.send({ t: "sync-req" });
    }
  } catch (err) {
    S.online.role = null;
    dom.statusText.textContent = "Couldn't join";
    showPrompt(err.message, "Back to setup", null, () => backToSetup());
  }
}

function leaveOnline() {
  if (S.online.role) Net.leave(true);
  S.online = freshOnline(null, null);
  dom.onlineCard.classList.add("hidden");
}

function sendSync(force = false) {
  const now = performance.now();
  if (!force && now - S.online.lastSync < SYNC_MIN_INTERVAL_MS) return; // no sync amplification
  S.online.lastSync = now;
  Net.send({
    t: "sync",
    v: 3,
    config: { dims: S.config.dims, size: S.config.size, gravity: S.config.gravity, display: S.config.display },
    moves: S.game.moves.slice(),
    gameNo: S.online.gameNo,
    tally: { 1: S.tally[1], 2: S.tally[2], draw: S.tally.draw },
  });
}

/** Positions diverged (e.g. a message crossed a reconnect): the host's state wins. */
function resync() {
  if (S.online.role === "host") sendSync();
  else Net.send({ t: "sync-req" });
}

function startOnlineRound(gameNo) {
  S.online.gameNo = gameNo;
  S.online.pendingRestart = null;
  startGame(S.config, sidesFor(S.online.role, gameNo));
}

function onNetEvent(type, data) {
  const role = S.online.role;
  if (!role) return;
  if (type === "connected") {
    S.online.connected = true;
    if (role === "host") {
      dom.onlineCard.classList.add("hidden");
      sendSync(true);
      toast("Your friend joined!");
    }
    if (S.game && S.config) renderAll();
  } else if (type === "disconnected") {
    S.online.connected = false;
    S.online.pendingUndo = null;
    S.online.pendingRestart = null;
    if (S.game) renderAll();
    if (data?.reason === "flood") toast("Dropped the other player: their browser was flooding messages", 4000);
    else toast(role === "host" ? "Your friend disconnected — they can reopen the same link" : "Lost connection to the host", 3500);
  } else if (type === "error") {
    toast(data?.message || "Connection problem", 3000);
  } else if (type === "message") {
    handleNetMessage(data);
  }
}

/** Throttle prompts the peer can trigger; returns false if this request must be refused. */
function admitPeerRequest() {
  const now = performance.now();
  if (!dom.promptCard.classList.contains("hidden")) return false;
  if (now - S.online.lastRequest < REQUEST_COOLDOWN_MS) return false;
  S.online.lastRequest = now;
  return true;
}

function handleNetMessage(m) {
  const g = S.game;
  const role = S.online.role;
  switch (m.t) {
    case "welcome": {
      if (role !== "guest" || typeof m.token !== "string" || !/^[0-9a-f]{32}$/.test(m.token)) return;
      try { localStorage.setItem(SEAT_KEY(S.online.code), m.token); } catch (_) { /* ignore */ }
      break;
    }
    case "reject": {
      if (role !== "guest") return;
      const text = m.reason === "full"
        ? "This game already has two players."
        : "The host didn't let this browser join. Ask them for a new link.";
      leaveOnline();
      showPrompt(text, "Back to setup", null, () => backToSetup());
      break;
    }
    case "sync": {
      if (role !== "guest") return;
      const c = m.config && typeof m.config === "object" ? m.config : {};
      const dims = c.dims === 4 ? 4 : 3;
      const size = intIn(c.size, 4, dims === 4 ? 5 : 6) ?? 5;
      const config = {
        dims, size,
        gravity: c.gravity === true,
        display: c.display === "blind" ? "blind" : "visual",
        opponent: "online",
        level: "medium",
      };
      const gameNo = intIn(m.gameNo, 1, MAX_GAME_NO) ?? 1;
      const t = m.tally && typeof m.tally === "object" ? m.tally : {};
      const tmp = new FourEngine.Game(size, dims, config.gravity);
      const raw = Array.isArray(m.moves) ? m.moves.slice(0, tmp.geo.cells) : [];
      const moves = [];
      for (const cell of raw) {
        if (tmp.isOver || intIn(cell, 0, tmp.geo.cells - 1) === null || !tmp.isPlayable(cell)) break;
        tmp.play(cell);
        moves.push(cell);
      }
      S.online.gameNo = gameNo;
      S.tally = { 1: intIn(t[1], 0, MAX_GAME_NO) ?? 0, 2: intIn(t[2], 0, MAX_GAME_NO) ?? 0, draw: intIn(t.draw, 0, MAX_GAME_NO) ?? 0 };
      const first = !S.game;
      startGame(config, sidesFor("guest", gameNo), moves);
      S.scoredGame = tmp.isOver; // the host's tally already counts a finished game
      renderAll();
      if (first) toast("Connected — have fun!");
      break;
    }
    case "sync-req":
      if (role === "host" && S.game) sendSync();
      break;
    case "move": {
      const n = intIn(m.n, 0, MAX_GAME_NO);
      const cell = g ? intIn(m.cell, 0, g.geo.cells - 1) : null;
      if (!g || n === null || cell === null || n !== g.moves.length || S.sides[g.toMove] !== "remote" || !g.isPlayable(cell)) {
        resync();
        return;
      }
      applyMove(cell, "remote");
      break;
    }
    case "undo-req": {
      // The peer may only ask to take back their own moves, at the current position.
      const theirs = 3 - mySide();
      const n = intIn(m.n, 1, MAX_GAME_NO);
      if (!g || n !== g.moves.length || !g.moves.some((c) => g.board[c] === theirs)) {
        Net.send({ t: "undo-no" });
        return;
      }
      if (!admitPeerRequest()) { Net.send({ t: "undo-no", busy: true }); return; }
      showPrompt("Your friend asks to undo their last move.", "Allow", "Decline", () => {
        if (!S.game || n !== S.game.moves.length) { Net.send({ t: "undo-no" }); return; }
        undoToSide(theirs);
        Net.send({ t: "undo-ok", n });
        renderAll();
      }, () => Net.send({ t: "undo-no" }));
      break;
    }
    case "undo-ok": {
      const p = S.online.pendingUndo;
      S.online.pendingUndo = null;
      if (!g || !p || m.n !== p.n || p.n !== g.moves.length) { if (p) resync(); return; }
      undoToSide(mySide());
      renderAll();
      toast("Undo accepted");
      break;
    }
    case "undo-no":
      if (!S.online.pendingUndo) return;
      S.online.pendingUndo = null;
      toast(m.busy === true ? "Your friend is busy — try again in a moment" : "Your friend declined the undo");
      break;
    case "rematch": {
      // Only valid as the next game after a finished one.
      const next = intIn(m.gameNo, 2, MAX_GAME_NO);
      if (!g || next !== S.online.gameNo + 1) return;
      if (!g.isOver) { resync(); return; }
      startOnlineRound(next);
      toast("New game!");
      break;
    }
    case "restart-req": {
      const next = intIn(m.gameNo, 2, MAX_GAME_NO);
      if (!g || next !== S.online.gameNo + 1) { Net.send({ t: "restart-no" }); return; }
      if (!admitPeerRequest()) { Net.send({ t: "restart-no", busy: true }); return; }
      showPrompt("Your friend wants to abandon this game and start a new one.", "Start new game", "Keep playing", () => {
        if (S.online.gameNo + 1 !== next) return;
        Net.send({ t: "restart-ok", gameNo: next });
        startOnlineRound(next);
      }, () => Net.send({ t: "restart-no" }));
      break;
    }
    case "restart-ok": {
      const p = S.online.pendingRestart;
      if (!p || m.gameNo !== p.gameNo) return;
      startOnlineRound(p.gameNo);
      toast("New game!");
      break;
    }
    case "restart-no":
      if (!S.online.pendingRestart) return;
      S.online.pendingRestart = null;
      toast(m.busy === true ? "Your friend is busy — try again in a moment" : "Your friend wants to keep playing");
      break;
    case "bye":
      S.online.connected = false;
      if (S.game) renderAll();
      toast(role === "host" ? "Your friend left the game" : "The host ended the game", 3500);
      break;
    default:
      break;
  }
}

function showPrompt(text, yesLabel, noLabel, onYes, onNo) {
  dom.promptText.textContent = text;
  dom.promptYes.textContent = yesLabel;
  dom.promptNo.textContent = noLabel || "";
  dom.promptNo.classList.toggle("hidden", !noLabel);
  dom.promptCard.classList.remove("hidden");
  dom.endCard.classList.add("hidden");
  const close = () => {
    dom.promptCard.classList.add("hidden");
    dom.promptYes.onclick = null;
    dom.promptNo.onclick = null;
  };
  dom.promptYes.onclick = () => { close(); onYes && onYes(); };
  dom.promptNo.onclick = () => { close(); onNo && onNo(); if (S.game) renderEnd(); };
}

async function copyShareLink() {
  const link = dom.shareLink.value;
  if (!link.startsWith("http")) return;
  try {
    await navigator.clipboard.writeText(link);
    dom.copyLinkBtn.textContent = "Copied!";
  } catch (_) {
    dom.shareLink.focus();
    dom.shareLink.select();
    dom.copyLinkBtn.textContent = "Press ⌘C";
  }
  setTimeout(() => { dom.copyLinkBtn.textContent = "Copy"; }, 1600);
}

// Start last, so every top-level constant above is initialised first.
boot();
