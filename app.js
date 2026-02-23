const WIN_LENGTH = 4;
const LAYER_SPACING = 72;
const LAYER_DRIFT = 18;

const state = {
  size: 5,
  board: [],
  currentPlayer: 1,
  winner: null,
  moves: [],
  winningLine: [],
  mode: "visual",
  gravity: false,
  gravityLocked: false,
  pendingDropAnim: null,
  view: {
    rotX: 58,
    rotZ: -34,
    distance: 120,
  },
  drag: {
    active: false,
    moved: false,
    suppressNextClick: false,
    lastX: 0,
    lastY: 0,
  },
};

const dirs = buildDirections();

const dom = {
  boardSize: document.getElementById("boardSize"),
  newGameBtn: document.getElementById("newGameBtn"),
  visualModeBtn: document.getElementById("visualModeBtn"),
  coordModeBtn: document.getElementById("coordModeBtn"),
  gravityToggle: document.getElementById("gravityToggle"),
  gravityHint: document.getElementById("gravityHint"),
  cameraPanel: document.getElementById("cameraPanel"),
  rotXInput: document.getElementById("rotXInput"),
  rotZInput: document.getElementById("rotZInput"),
  zoomInput: document.getElementById("zoomInput"),
  resetViewBtn: document.getElementById("resetViewBtn"),
  coordPanel: document.getElementById("coordPanel"),
  coordLabel: document.getElementById("coordLabel"),
  coordInput: document.getElementById("coordInput"),
  placeCoordBtn: document.getElementById("placeCoordBtn"),
  undoBtn: document.getElementById("undoBtn"),
  resetBtn: document.getElementById("resetBtn"),
  turnText: document.getElementById("turnText"),
  messageText: document.getElementById("messageText"),
  moveLog: document.getElementById("moveLog"),
  boardPanel: document.getElementById("boardPanel"),
  boardContainer: document.getElementById("boardContainer"),
};

boot();

function boot() {
  wireEvents();
  newGame(state.size);
  updateViewInputs();
  updateGravityUi();
}

function wireEvents() {
  dom.newGameBtn.addEventListener("click", () => {
    const size = Number(dom.boardSize.value);
    if (!Number.isInteger(size) || size < 4 || size > 6) {
      setMessage("Board size must be an integer between 4 and 6.");
      return;
    }
    newGame(size);
  });

  dom.resetBtn.addEventListener("click", () => newGame(state.size));
  dom.undoBtn.addEventListener("click", undoMove);

  dom.visualModeBtn.addEventListener("click", () => setMode("visual"));
  dom.coordModeBtn.addEventListener("click", () => setMode("coord"));
  dom.gravityToggle.addEventListener("change", () =>
    setGravityMode(dom.gravityToggle.checked)
  );

  dom.rotXInput.addEventListener("input", handleViewChange);
  dom.rotZInput.addEventListener("input", handleViewChange);
  dom.zoomInput.addEventListener("input", handleViewChange);
  dom.resetViewBtn.addEventListener("click", resetView);
  dom.boardContainer.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  dom.boardContainer.addEventListener("wheel", onWheelZoom, { passive: false });
  dom.boardContainer.addEventListener("click", suppressClickAfterDrag, true);

  dom.placeCoordBtn.addEventListener("click", tryPlaceFromInput);
  dom.coordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryPlaceFromInput();
  });
}

function setMode(mode) {
  state.mode = mode;
  dom.visualModeBtn.classList.toggle("active", mode === "visual");
  dom.coordModeBtn.classList.toggle("active", mode === "coord");
  dom.coordPanel.classList.toggle("hidden", mode !== "coord");
  dom.cameraPanel.classList.toggle("hidden", mode !== "visual");
  dom.boardPanel.classList.toggle("hidden", mode === "coord");
  setMessage(
    mode === "coord"
      ? state.gravity
        ? "Blind coordinate mode on. Enter x,y only."
        : "Blind coordinate mode on. Enter x,y,z."
      : "Visual mode on. Click a cell to place."
  );
  updateCoordInputUi();
  renderBoard();
}

function setGravityMode(enabled) {
  if (state.gravityLocked) {
    dom.gravityToggle.checked = state.gravity;
    setMessage("Gravity mode is locked for this game. Start a new game to change it.");
    return;
  }
  state.gravity = enabled;
  updateGravityUi();
  updateCoordInputUi();
  setMessage(
    enabled
      ? "Gravity mode on. Select (x,y), then piece drops to the next z."
      : "Gravity mode off. Place directly at (x,y,z)."
  );
  renderBoard();
}

function newGame(size) {
  state.size = size;
  state.board = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Array.from({ length: size }, () => 0))
  );
  state.currentPlayer = 1;
  state.winner = null;
  state.moves = [];
  state.winningLine = [];
  state.gravityLocked = false;
  state.pendingDropAnim = null;
  dom.boardSize.value = String(size);
  updateGravityUi();
  renderBoard();
  renderStatus();
  renderMoveLog();
  setMessage("New game started.");
}

function tryPlaceFromInput() {
  if (state.winner) return;
  const expectedCount = state.gravity ? 2 : 3;
  const parsed = parseCoord(dom.coordInput.value, expectedCount);
  if (!parsed) {
    setMessage(
      state.gravity
        ? "Invalid input. Use x,y like 2,4."
        : "Invalid input. Use x,y,z like 2,4,1."
    );
    return;
  }
  if (state.gravity) {
    const [x, y] = parsed;
    placeMoveWithGravity(x, y);
  } else {
    const [x, y, z] = parsed;
    placeMove(x, y, z);
  }
}

function parseCoord(text, expectedCount) {
  const parts = text
    .split(/[,\s]+/)
    .map((v) => Number(v.trim()))
    .filter((v) => !Number.isNaN(v));
  if (parts.length !== expectedCount) return null;
  return parts.map((v) => v - 1);
}

function placeMoveWithGravity(x, y) {
  if (state.winner) {
    setMessage("Game is over. Start a new game.");
    return;
  }
  if (!inBounds(x, y, 0, state.size)) {
    setMessage(`Out of bounds. Coordinates must be 1..${state.size}.`);
    return;
  }
  const z = getDropZ(x, y);
  if (z === -1) {
    setMessage(`Column (${x + 1},${y + 1}) is full.`);
    return;
  }
  state.pendingDropAnim = {
    x,
    y,
    z,
    dx: (state.size - 1 - z) * LAYER_DRIFT,
    dy: -1 * (state.size - 1 - z) * LAYER_DRIFT,
    dz: (state.size - 1 - z) * LAYER_SPACING,
  };
  placeMove(x, y, z);
}

function placeMove(x, y, z) {
  if (state.winner) {
    setMessage("Game is over. Start a new game.");
    return;
  }
  if (!inBounds(x, y, z, state.size)) {
    setMessage(`Out of bounds. Coordinates must be 1..${state.size}.`);
    return;
  }
  if (state.board[z][y][x] !== 0) {
    setMessage("That cell is already occupied.");
    return;
  }

  const player = state.currentPlayer;
  state.board[z][y][x] = player;
  state.moves.push({ x, y, z, player });
  if (state.moves.length === 1) {
    state.gravityLocked = true;
    updateGravityUi();
  }

  const winLine = findWinningLineFrom(x, y, z, player);
  if (winLine.length) {
    state.winner = player;
    state.winningLine = winLine;
    setMessage(`Player ${player} wins with 4 in a line.`);
  } else {
    state.currentPlayer = player === 1 ? 2 : 1;
    setMessage(`Placed at (${x + 1},${y + 1},${z + 1}).`);
  }

  renderBoard();
  renderStatus();
  renderMoveLog();
  dom.coordInput.value = "";
}

function undoMove() {
  if (!state.moves.length) {
    setMessage("No moves to undo.");
    return;
  }
  const last = state.moves.pop();
  state.board[last.z][last.y][last.x] = 0;
  state.winner = null;
  state.winningLine = [];
  state.currentPlayer = last.player;
  setMessage(`Undid move at (${last.x + 1},${last.y + 1},${last.z + 1}).`);
  renderBoard();
  renderStatus();
  renderMoveLog();
}

function renderStatus() {
  if (state.winner) {
    dom.turnText.textContent = `Winner: Player ${state.winner}`;
  } else {
    dom.turnText.textContent = `Turn: Player ${state.currentPlayer}`;
  }
}

function setMessage(message) {
  dom.messageText.textContent = message;
}

function updateGravityUi() {
  dom.gravityToggle.checked = state.gravity;
  dom.gravityToggle.disabled = state.gravityLocked;
  if (state.gravityLocked) {
    dom.gravityHint.textContent = state.gravity
      ? "LOCKED ON for this game. Start a new game to change."
      : "LOCKED OFF for this game. Start a new game to change.";
    return;
  }
  dom.gravityHint.textContent = state.gravity
    ? "ON: choose (x,y), piece drops to next available z"
    : "OFF: place directly at (x,y,z)";
}

function updateCoordInputUi() {
  dom.coordLabel.textContent = state.gravity
    ? "Place at x,y (1-based)"
    : "Place at x,y,z (1-based)";
  dom.coordInput.placeholder = state.gravity ? "e.g. 2,4" : "e.g. 2,4,1";
}

function handleViewChange() {
  state.view.rotX = Number(dom.rotXInput.value);
  state.view.rotZ = Number(dom.rotZInput.value);
  state.view.distance = Number(dom.zoomInput.value);
  applyViewTransform();
}

function resetView() {
  state.view.rotX = 58;
  state.view.rotZ = -34;
  state.view.distance = 120;
  updateViewInputs();
  applyViewTransform();
  setMessage("View reset.");
}

function updateViewInputs() {
  dom.rotXInput.value = String(Math.round(state.view.rotX));
  dom.rotZInput.value = String(Math.round(state.view.rotZ));
  dom.zoomInput.value = String(Math.round(state.view.distance));
}

function onPointerDown(e) {
  if (state.mode !== "visual") return;
  state.drag.active = true;
  state.drag.moved = false;
  state.drag.lastX = e.clientX;
  state.drag.lastY = e.clientY;
  dom.boardContainer.classList.add("dragging");
}

function onPointerMove(e) {
  if (!state.drag.active || state.mode !== "visual") return;
  const dx = e.clientX - state.drag.lastX;
  const dy = e.clientY - state.drag.lastY;
  if (Math.abs(dx) + Math.abs(dy) > 2) {
    state.drag.moved = true;
  }
  state.drag.lastX = e.clientX;
  state.drag.lastY = e.clientY;

  state.view.rotZ = clamp(state.view.rotZ + dx * 0.35, -85, 20);
  state.view.rotX = clamp(state.view.rotX - dy * 0.35, 25, 85);
  updateViewInputs();
  applyViewTransform();
}

function onPointerUp() {
  if (!state.drag.active) return;
  state.drag.active = false;
  state.drag.suppressNextClick = state.drag.moved;
  dom.boardContainer.classList.remove("dragging");
}

function suppressClickAfterDrag(e) {
  if (!state.drag.suppressNextClick) return;
  e.preventDefault();
  e.stopPropagation();
  state.drag.suppressNextClick = false;
  state.drag.moved = false;
}

function onWheelZoom(e) {
  if (state.mode !== "visual") return;
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  state.view.distance = clamp(state.view.distance - delta * 12, -260, 360);
  updateViewInputs();
  applyViewTransform();
}

function applyViewTransform() {
  const layers = dom.boardContainer.querySelector(".layers");
  if (!layers) return;
  layers.style.setProperty("--rot-x", `${state.view.rotX}deg`);
  layers.style.setProperty("--rot-z", `${state.view.rotZ}deg`);
  layers.style.setProperty("--camera-z", `${state.view.distance}px`);
  layers.style.setProperty("--board-shift-y", `${getBoardShiftY()}px`);
}

function renderMoveLog() {
  if (!state.moves.length) {
    dom.moveLog.innerHTML = "<div class='log-row'>No moves yet.</div>";
    return;
  }
  const rows = state.moves.map((m, i) => {
    const p = `P${m.player}`;
    return `<div class="log-row">${String(i + 1).padStart(2, "0")}. ${p} @ (${m.x + 1},${m.y + 1},${m.z + 1})</div>`;
  });
  dom.moveLog.innerHTML = rows.join("");
}

function renderBoard() {
  if (state.mode === "coord") {
    return;
  }
  const size = state.size;
  ensureBoardStructure(size);
  updateBoardCells();
  applyViewTransform();
}

function ensureBoardStructure(size) {
  const current = dom.boardContainer.querySelector(".layers");
  if (current && Number(current.dataset.size) === size) return;

  dom.boardContainer.innerHTML = "";
  const layers = document.createElement("div");
  layers.className = "layers";
  layers.dataset.size = String(size);

  const spacing = LAYER_SPACING;
  const boardWidth = size * 42 + 20;

  for (let z = 0; z < size; z += 1) {
    const layer = document.createElement("div");
    layer.className = "layer";
    layer.style.gridTemplateColumns = `repeat(${size}, 38px)`;
    layer.style.transform = `translate3d(${z * LAYER_DRIFT}px, ${-z * LAYER_DRIFT}px, ${z * spacing}px)`;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const btn = document.createElement("button");
        btn.className = "cell";
        btn.dataset.x = String(x);
        btn.dataset.y = String(y);
        btn.dataset.z = String(z);
        btn.addEventListener("click", () => {
          if (state.gravity) {
            placeMoveWithGravity(x, y);
          } else {
            placeMove(x, y, z);
          }
        });
        layer.appendChild(btn);
      }
    }

    const label = document.createElement("div");
    label.className = "layer-label";
    label.textContent = `z=${z + 1}`;
    layer.appendChild(label);
    layers.appendChild(layer);
  }

  layers.style.width = `${boardWidth + (size - 1) * 18}px`;
  layers.style.height = `${boardWidth + (size - 1) * 18}px`;
  dom.boardContainer.appendChild(layers);
}

function updateBoardCells() {
  const cells = dom.boardContainer.querySelectorAll(".cell");
  let didApplyDropAnim = false;
  cells.forEach((btn) => {
    const x = Number(btn.dataset.x);
    const y = Number(btn.dataset.y);
    const z = Number(btn.dataset.z);
    const v = state.board[z][y][x];

    btn.classList.remove("p1", "p2", "win", "drop-in");
    if (v === 1) {
      btn.classList.add("p1");
      btn.textContent = "X";
    } else if (v === 2) {
      btn.classList.add("p2");
      btn.textContent = "O";
    } else {
      btn.textContent = "·";
    }

    if (isWinningCoord(x, y, z)) {
      btn.classList.add("win");
    }

    if (
      state.pendingDropAnim &&
      !didApplyDropAnim &&
      x === state.pendingDropAnim.x &&
      y === state.pendingDropAnim.y &&
      z === state.pendingDropAnim.z
    ) {
      btn.style.setProperty("--drop-from-x", `${state.pendingDropAnim.dx}px`);
      btn.style.setProperty("--drop-from-y", `${state.pendingDropAnim.dy}px`);
      btn.style.setProperty("--drop-from-z", `${state.pendingDropAnim.dz}px`);
      btn.classList.add("drop-in");
      didApplyDropAnim = true;
    }

    btn.disabled = state.winner ? true : !state.gravity && v !== 0;
  });
  if (didApplyDropAnim) {
    state.pendingDropAnim = null;
  }
}

function isWinningCoord(x, y, z) {
  return state.winningLine.some((c) => c.x === x && c.y === y && c.z === z);
}

function findWinningLineFrom(x, y, z, player) {
  for (const [dx, dy, dz] of dirs) {
    const line = [{ x, y, z }];

    for (let step = 1; step < WIN_LENGTH; step += 1) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      const nz = z + dz * step;
      if (!inBounds(nx, ny, nz, state.size)) break;
      if (state.board[nz][ny][nx] !== player) break;
      line.push({ x: nx, y: ny, z: nz });
    }

    for (let step = 1; step < WIN_LENGTH; step += 1) {
      const nx = x - dx * step;
      const ny = y - dy * step;
      const nz = z - dz * step;
      if (!inBounds(nx, ny, nz, state.size)) break;
      if (state.board[nz][ny][nx] !== player) break;
      line.unshift({ x: nx, y: ny, z: nz });
    }

    if (line.length >= WIN_LENGTH) {
      for (let i = 0; i <= line.length - WIN_LENGTH; i += 1) {
        const slice = line.slice(i, i + WIN_LENGTH);
        if (slice.some((c) => c.x === x && c.y === y && c.z === z)) {
          return slice;
        }
      }
      return line.slice(0, WIN_LENGTH);
    }
  }

  return [];
}

function buildDirections() {
  const out = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        if (dx < 0) continue;
        if (dx === 0 && dy < 0) continue;
        if (dx === 0 && dy === 0 && dz < 0) continue;
        out.push([dx, dy, dz]);
      }
    }
  }
  return out;
}

function inBounds(x, y, z, size) {
  return (
    x >= 0 &&
    x < size &&
    y >= 0 &&
    y < size &&
    z >= 0 &&
    z < size
  );
}

function getDropZ(x, y) {
  for (let z = 0; z < state.size; z += 1) {
    if (state.board[z][y][x] === 0) return z;
  }
  return -1;
}

function getBoardShiftY() {
  return 88 + Math.max(0, state.size - 5) * 28;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
