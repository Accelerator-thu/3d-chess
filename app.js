const WIN_LENGTH = 4;
const LAYER_SPACING = 72;
const LAYER_DRIFT = 18;
const AI_NOISE = 50;   // small noise for regular vsAI play (±25 on leaf eval)
const SIM_NOISE = 150; // higher noise for simulation to produce varied games

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
  setupMode: "visual",
  setupGravity: false,
  vsAI: false,
  aiThinking: false,
  setupVsAI: false,
  aiGeneration: 0,
  is4D: false,
  setup4D: false,
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
    pointers: new Map(),
    pinchStartDistance: 0,
    pinchStartCamera: 0,
  },
};

const dirs3D = buildDirections3D();
const dirs4D = buildDirections4D();

const dom = {
  setupScreen: document.getElementById("setupScreen"),
  gameScreen: document.getElementById("gameScreen"),
  setupBoardSize: document.getElementById("setupBoardSize"),
  setupVisualModeBtn: document.getElementById("setupVisualModeBtn"),
  setupCoordModeBtn: document.getElementById("setupCoordModeBtn"),
  setupGravityToggle: document.getElementById("setupGravityToggle"),
  setupTwoPlayerBtn: document.getElementById("setupTwoPlayerBtn"),
  setupVsAIBtn: document.getElementById("setupVsAIBtn"),
  setup3DBtn: document.getElementById("setup3DBtn"),
  setup4DBtn: document.getElementById("setup4DBtn"),
  dimHint: document.getElementById("dimHint"),
  startGameBtn: document.getElementById("startGameBtn"),
  backToSetupBtn: document.getElementById("backToSetupBtn"),
  toggleControlsBtn: document.getElementById("toggleControlsBtn"),
  boardSize: document.getElementById("boardSize"),
  appRoot: document.getElementById("appRoot"),
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
  legendP2:   document.getElementById("legendP2"),
  simBtn:     document.getElementById("simBtn"),
  simResults: document.getElementById("simResults"),
};

boot();

function boot() {
  wireEvents();
  initializeSetupScreen();
  enterSetupPhase();
}

function wireEvents() {
  dom.startGameBtn.addEventListener("click", startConfiguredGame);
  dom.backToSetupBtn.addEventListener("click", enterSetupPhase);
  dom.toggleControlsBtn.addEventListener("click", () =>
    setGameControlsOpen(dom.appRoot.classList.contains("game-controls-hidden"))
  );
  dom.setupVisualModeBtn.addEventListener("click", () => setSetupMode("visual"));
  dom.setupCoordModeBtn.addEventListener("click", () => setSetupMode("coord"));
  dom.setupTwoPlayerBtn.addEventListener("click", () => setSetupOpponent("human"));
  dom.setupVsAIBtn.addEventListener("click", () => setSetupOpponent("ai"));
  dom.setup3DBtn.addEventListener("click", () => setSetup4D(false));
  dom.setup4DBtn.addEventListener("click", () => setSetup4D(true));
  dom.setupGravityToggle.addEventListener("change", () => {
    state.setupGravity = dom.setupGravityToggle.checked;
  });

  dom.newGameBtn.addEventListener("click", () => newGame(state.size));
  dom.resetBtn.addEventListener("click", () => newGame(state.size));
  dom.undoBtn.addEventListener("click", undoMove);

  dom.rotXInput.addEventListener("input", handleViewChange);
  dom.rotZInput.addEventListener("input", handleViewChange);
  dom.zoomInput.addEventListener("input", handleViewChange);
  dom.resetViewBtn.addEventListener("click", resetView);
  dom.boardContainer.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  dom.boardContainer.addEventListener("wheel", onWheelZoom, { passive: false });
  dom.boardContainer.addEventListener("click", suppressClickAfterDrag, true);

  dom.placeCoordBtn.addEventListener("click", tryPlaceFromInput);
  dom.simBtn.addEventListener("click", runBattleSimulation);
  dom.coordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryPlaceFromInput();
  });
}

function initializeSetupScreen() {
  dom.setupBoardSize.value = String(state.size);
  setSetupMode(state.setupMode);
  dom.setupGravityToggle.checked = state.setupGravity;
  setSetup4D(state.setup4D);
  updateViewInputs();
}

function setSetupMode(mode) {
  state.setupMode = mode;
  dom.setupVisualModeBtn.classList.toggle("active", mode === "visual");
  dom.setupCoordModeBtn.classList.toggle("active", mode === "coord");
}

function setSetup4D(enabled) {
  state.setup4D = enabled;
  dom.setup3DBtn.classList.toggle("active", !enabled);
  dom.setup4DBtn.classList.toggle("active", enabled);
  if (enabled && Number(dom.setupBoardSize.value) > 5) {
    dom.setupBoardSize.value = "5";
  }
  dom.setupBoardSize.max = enabled ? "5" : "6";
  dom.dimHint.textContent = enabled
    ? "4D: N slices of N×N×N boards — 40 win directions. Brain-burning."
    : "3D: one N×N×N board — 13 win directions.";
}

function setSetupOpponent(opponent) {
  state.setupVsAI = opponent === "ai";
  dom.setupTwoPlayerBtn.classList.toggle("active", opponent === "human");
  dom.setupVsAIBtn.classList.toggle("active", opponent === "ai");
}

function startConfiguredGame() {
  const size = Number(dom.setupBoardSize.value);
  const maxSize = state.setup4D ? 5 : 6;
  if (!Number.isInteger(size) || size < 4 || size > maxSize) {
    dom.setupBoardSize.focus();
    return;
  }

  state.is4D = state.setup4D;
  state.setupGravity = dom.setupGravityToggle.checked;
  state.gravity = state.setupGravity;
  state.gravityLocked = false;
  dom.gravityToggle.checked = state.gravity;
  updateGravityUi();

  state.vsAI = state.setupVsAI || false;
  state.aiThinking = false;
  state.aiGeneration++;
  dom.legendP2.textContent = state.vsAI ? "AI (O)" : "Player 2 (O)";

  newGame(size);
  setMode(state.setupMode);
  enterGamePhase();
  setGameControlsOpen(state.mode === "coord");
}

function enterSetupPhase() {
  state.aiGeneration++;
  state.aiThinking = false;
  dom.setupScreen.classList.remove("hidden");
  dom.gameScreen.classList.add("hidden");
  dom.setupBoardSize.value = String(state.size);
  setSetupMode(state.mode);
  dom.setupGravityToggle.checked = state.gravity;
  setSetupOpponent(state.vsAI ? "ai" : "human");
  setSetup4D(state.is4D);
}

function enterGamePhase() {
  dom.setupScreen.classList.add("hidden");
  dom.gameScreen.classList.remove("hidden");
  renderBoard();
}

function setGameControlsOpen(open) {
  dom.appRoot.classList.toggle("game-controls-hidden", !open);
  dom.toggleControlsBtn.textContent = open ? "Hide Controls" : "Show Controls";
}

function setMode(mode) {
  state.mode = mode;
  dom.visualModeBtn.classList.toggle("active", mode === "visual");
  dom.coordModeBtn.classList.toggle("active", mode === "coord");
  dom.coordPanel.classList.toggle("hidden", mode !== "coord");
  dom.cameraPanel.classList.toggle("hidden", mode !== "visual");
  dom.boardPanel.classList.toggle("hidden", mode === "coord");

  let msg;
  if (mode === "coord") {
    if (state.gravity) {
      msg = state.is4D
        ? "Blind mode on. Enter x,y,w."
        : "Blind coordinate mode on. Enter x,y only.";
    } else {
      msg = state.is4D
        ? "Blind mode on. Enter x,y,z,w."
        : "Blind coordinate mode on. Enter x,y,z.";
    }
  } else {
    msg = "Visual mode on. Click a cell to place.";
  }
  setMessage(msg);
  updateCoordInputUi();
  if (mode === "coord" && !dom.gameScreen.classList.contains("hidden")) {
    setGameControlsOpen(true);
  }
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
  if (enabled) {
    setMessage(
      state.is4D
        ? "Gravity on. Select (x,y,w), piece drops to next available z."
        : "Gravity mode on. Select (x,y), then piece drops to the next z."
    );
  } else {
    setMessage(
      state.is4D
        ? "Gravity off. Place directly at (x,y,z,w)."
        : "Gravity mode off. Place directly at (x,y,z)."
    );
  }
  renderBoard();
}

function newGame(size) {
  state.aiGeneration++;
  state.aiThinking = false;
  state.size = size;
  if (state.is4D) {
    state.board = Array.from({ length: size }, () =>
      Array.from({ length: size }, () =>
        Array.from({ length: size }, () => Array.from({ length: size }, () => 0))
      )
    );
  } else {
    state.board = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => Array.from({ length: size }, () => 0))
    );
  }
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
  if (state.aiThinking) return;
  if (state.winner) return;

  let expectedCount;
  if (state.is4D) {
    expectedCount = state.gravity ? 3 : 4;
  } else {
    expectedCount = state.gravity ? 2 : 3;
  }

  const parsed = parseCoord(dom.coordInput.value, expectedCount);
  if (!parsed) {
    if (state.is4D) {
      setMessage(
        state.gravity
          ? "Invalid input. Use x,y,w like 2,4,1."
          : "Invalid input. Use x,y,z,w like 2,4,1,3."
      );
    } else {
      setMessage(
        state.gravity
          ? "Invalid input. Use x,y like 2,4."
          : "Invalid input. Use x,y,z like 2,4,1."
      );
    }
    return;
  }

  if (state.is4D) {
    if (state.gravity) {
      const [x, y, w] = parsed;
      placeMoveWithGravity(x, y, w);
    } else {
      const [x, y, z, w] = parsed;
      placeMove(x, y, z, w);
    }
  } else {
    if (state.gravity) {
      const [x, y] = parsed;
      placeMoveWithGravity(x, y, 0);
    } else {
      const [x, y, z] = parsed;
      placeMove(x, y, z, 0);
    }
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

function placeMoveWithGravity(x, y, w = 0) {
  if (state.winner) {
    setMessage("Game is over. Start a new game.");
    return;
  }
  if (!inBounds(x, y, 0, state.size, state.is4D ? w : undefined)) {
    setMessage(`Out of bounds. Coordinates must be 1..${state.size}.`);
    return;
  }
  const z = getDropZ(x, y, w);
  if (z === -1) {
    const colLabel = state.is4D ? `(${x + 1},${y + 1},w=${w + 1})` : `(${x + 1},${y + 1})`;
    setMessage(`Column ${colLabel} is full.`);
    return;
  }
  state.pendingDropAnim = {
    x,
    y,
    z,
    w,
    dx: (state.size - 1 - z) * LAYER_DRIFT,
    dy: -1 * (state.size - 1 - z) * LAYER_DRIFT,
    dz: (state.size - 1 - z) * LAYER_SPACING,
  };
  placeMove(x, y, z, w);
}

function placeMove(x, y, z, w = 0) {
  if (state.winner) {
    setMessage("Game is over. Start a new game.");
    return;
  }
  if (!inBounds(x, y, z, state.size, state.is4D ? w : undefined)) {
    setMessage(`Out of bounds. Coordinates must be 1..${state.size}.`);
    return;
  }
  if (boardGet(state.board, x, y, z, w) !== 0) {
    setMessage("That cell is already occupied.");
    return;
  }

  const player = state.currentPlayer;
  boardSet(state.board, x, y, z, w, player);
  const move = { x, y, z, player };
  if (state.is4D) move.w = w;
  state.moves.push(move);
  if (state.moves.length === 1) {
    state.gravityLocked = true;
    updateGravityUi();
  }

  const winLine = findWinningLineFrom(x, y, z, w, player);
  if (winLine.length) {
    state.winner = player;
    state.winningLine = winLine;
    setMessage(`Player ${player} wins with 4 in a line!`);
  } else {
    state.currentPlayer = player === 1 ? 2 : 1;
    const coord = state.is4D
      ? `(${x + 1},${y + 1},${z + 1},${w + 1})`
      : `(${x + 1},${y + 1},${z + 1})`;
    setMessage(`Placed at ${coord}.`);
  }

  renderBoard();
  renderStatus();
  renderMoveLog();
  dom.coordInput.value = "";

  if (state.vsAI && !state.winner && state.currentPlayer === 2) {
    scheduleAIMove();
  }
}

function undoMove() {
  if (state.aiThinking) return;
  if (!state.moves.length) {
    setMessage("No moves to undo.");
    return;
  }
  if (state.vsAI && state.moves.length >= 2 && state.currentPlayer === 1) {
    const aiM = state.moves.pop();
    boardSet(state.board, aiM.x, aiM.y, aiM.z, aiM.w ?? 0, 0);
    state.winner = null;
    state.winningLine = [];
    state.currentPlayer = 2;
  }
  const last = state.moves.pop();
  const lastW = last.w ?? 0;
  boardSet(state.board, last.x, last.y, last.z, lastW, 0);
  state.winner = null;
  state.winningLine = [];
  state.currentPlayer = last.player;
  const coord = state.is4D
    ? `(${last.x + 1},${last.y + 1},${last.z + 1},${lastW + 1})`
    : `(${last.x + 1},${last.y + 1},${last.z + 1})`;
  setMessage(`Undid move at ${coord}.`);
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
  if (state.is4D) {
    dom.coordLabel.textContent = state.gravity
      ? "Place at x,y,w (1-based)"
      : "Place at x,y,z,w (1-based)";
    dom.coordInput.placeholder = state.gravity ? "e.g. 2,4,1" : "e.g. 2,4,1,3";
  } else {
    dom.coordLabel.textContent = state.gravity
      ? "Place at x,y (1-based)"
      : "Place at x,y,z (1-based)";
    dom.coordInput.placeholder = state.gravity ? "e.g. 2,4" : "e.g. 2,4,1";
  }
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
  if (!dom.boardContainer.contains(e.target)) return;
  if (e.pointerType === "mouse" && e.target.closest(".cell")) return;
  state.drag.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  state.drag.active = true;
  if (state.drag.pointers.size === 1) {
    state.drag.moved = false;
    state.drag.lastX = e.clientX;
    state.drag.lastY = e.clientY;
  } else if (state.drag.pointers.size === 2) {
    const [a, b] = [...state.drag.pointers.values()];
    state.drag.pinchStartDistance = distance2D(a, b);
    state.drag.pinchStartCamera = state.view.distance;
  }
  dom.boardContainer.classList.add("dragging");
  if (e.pointerType !== "mouse") e.preventDefault();
}

function onPointerMove(e) {
  if (!state.drag.active || state.mode !== "visual") return;
  if (!state.drag.pointers.has(e.pointerId)) return;
  state.drag.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (state.drag.pointers.size === 1) {
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
  } else if (state.drag.pointers.size >= 2) {
    const [a, b] = [...state.drag.pointers.values()];
    const currentDistance = distance2D(a, b);
    if (state.drag.pinchStartDistance === 0) {
      state.drag.pinchStartDistance = currentDistance;
      state.drag.pinchStartCamera = state.view.distance;
    }
    const delta = currentDistance - state.drag.pinchStartDistance;
    state.view.distance = clamp(state.drag.pinchStartCamera + delta * 0.8, -260, 360);
    state.drag.moved = true;
    updateViewInputs();
    applyViewTransform();
  }
  if (e.pointerType !== "mouse") e.preventDefault();
}

function onPointerUp(e) {
  if (!state.drag.active) return;
  state.drag.pointers.delete(e.pointerId);

  if (state.drag.pointers.size === 1) {
    const [only] = [...state.drag.pointers.values()];
    state.drag.lastX = only.x;
    state.drag.lastY = only.y;
    state.drag.pinchStartDistance = 0;
  }

  if (state.drag.pointers.size === 0) {
    state.drag.active = false;
    state.drag.suppressNextClick = state.drag.moved;
    state.drag.pinchStartDistance = 0;
    dom.boardContainer.classList.remove("dragging");
  }
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
  const allLayers = dom.boardContainer.querySelectorAll(".layers");
  allLayers.forEach((layers) => {
    layers.style.setProperty("--rot-x", `${state.view.rotX}deg`);
    layers.style.setProperty("--rot-z", `${state.view.rotZ}deg`);
    layers.style.setProperty("--camera-z", `${state.view.distance}px`);
    layers.style.setProperty("--board-shift-y", `${getBoardShiftY()}px`);
  });
}

function renderMoveLog() {
  if (!state.moves.length) {
    dom.moveLog.innerHTML = "<div class='log-row'>No moves yet.</div>";
    return;
  }
  const rows = state.moves.map((m, i) => {
    const p = `P${m.player}`;
    const coord = state.is4D
      ? `(${m.x + 1},${m.y + 1},${m.z + 1},${(m.w ?? 0) + 1})`
      : `(${m.x + 1},${m.y + 1},${m.z + 1})`;
    return `<div class="log-row">${String(i + 1).padStart(2, "0")}. ${p} @ ${coord}</div>`;
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
  const root = dom.boardContainer.firstElementChild;
  const expectedClass = state.is4D ? "boards-4d" : "layers";
  const expectedDims = state.is4D ? "4" : "3";
  if (
    root &&
    Number(root.dataset.size) === size &&
    root.classList.contains(expectedClass) &&
    root.dataset.dims === expectedDims
  )
    return;

  dom.boardContainer.innerHTML = "";
  dom.boardContainer.classList.toggle("mode-4d", state.is4D);

  if (state.is4D) {
    const wrapper = document.createElement("div");
    wrapper.className = "boards-4d";
    wrapper.dataset.size = String(size);
    wrapper.dataset.dims = "4";

    for (let w = 0; w < size; w += 1) {
      const section = document.createElement("div");
      section.className = "w-section";

      section.appendChild(createLayersForSlice(size, w));

      const label = document.createElement("div");
      label.className = "w-section-label";
      label.textContent = `w=${w + 1}`;
      section.appendChild(label);
      wrapper.appendChild(section);
    }

    dom.boardContainer.appendChild(wrapper);
  } else {
    const layers = createLayersForSlice(size, null);
    layers.dataset.size = String(size);
    layers.dataset.dims = "3";
    dom.boardContainer.appendChild(layers);
  }
}

function createLayersForSlice(size, w) {
  const is4D = state.is4D;
  const cellSize = is4D ? 32 : 38;
  const cellGap = is4D ? 3 : 4;
  const boardPad = is4D ? 12 : 16;
  const boardWidth = size * cellSize + (size - 1) * cellGap + boardPad;
  const totalSize = boardWidth + (size - 1) * LAYER_DRIFT;

  const layers = document.createElement("div");
  layers.className = "layers";
  if (w !== null) layers.dataset.w = String(w);

  for (let z = 0; z < size; z += 1) {
    const layer = document.createElement("div");
    layer.className = "layer";
    layer.style.gridTemplateColumns = `repeat(${size}, ${cellSize}px)`;
    layer.style.transform = `translate3d(${z * LAYER_DRIFT}px, ${-z * LAYER_DRIFT}px, ${z * LAYER_SPACING}px)`;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const btn = document.createElement("button");
        btn.className = "cell";
        btn.dataset.x = String(x);
        btn.dataset.y = String(y);
        btn.dataset.z = String(z);
        if (w !== null) btn.dataset.w = String(w);
        const wVal = w !== null ? w : 0;
        btn.addEventListener("click", () => {
          if (state.aiThinking) return;
          if (state.gravity) {
            placeMoveWithGravity(x, y, wVal);
          } else {
            placeMove(x, y, z, wVal);
          }
        });
        layer.appendChild(btn);
      }
    }

    const layerLabel = document.createElement("div");
    layerLabel.className = "layer-label";
    layerLabel.textContent = `z=${z + 1}`;
    layer.appendChild(layerLabel);
    layers.appendChild(layer);
  }

  layers.style.width = `${totalSize}px`;
  layers.style.height = `${totalSize}px`;
  return layers;
}

function updateBoardCells() {
  const cells = dom.boardContainer.querySelectorAll(".cell");
  let didApplyDropAnim = false;
  cells.forEach((btn) => {
    const x = Number(btn.dataset.x);
    const y = Number(btn.dataset.y);
    const z = Number(btn.dataset.z);
    const w = btn.dataset.w !== undefined ? Number(btn.dataset.w) : 0;
    const v = boardGet(state.board, x, y, z, w);

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

    if (isWinningCoord(x, y, z, w)) {
      btn.classList.add("win");
    }

    const anim = state.pendingDropAnim;
    if (
      anim &&
      !didApplyDropAnim &&
      x === anim.x &&
      y === anim.y &&
      z === anim.z &&
      w === (anim.w ?? 0)
    ) {
      btn.style.setProperty("--drop-from-x", `${anim.dx}px`);
      btn.style.setProperty("--drop-from-y", `${anim.dy}px`);
      btn.style.setProperty("--drop-from-z", `${anim.dz}px`);
      btn.classList.add("drop-in");
      didApplyDropAnim = true;
    }

    btn.disabled = state.winner ? true : !state.gravity && v !== 0;
  });
  if (didApplyDropAnim) {
    state.pendingDropAnim = null;
  }
}

function isWinningCoord(x, y, z, w = 0) {
  return state.winningLine.some(
    (c) => c.x === x && c.y === y && c.z === z && (state.is4D ? c.w === w : true)
  );
}

function findWinningLineFrom(x, y, z, w, player) {
  w = w ?? 0;
  const dirs = getDirs();
  for (const dir of dirs) {
    const [dx, dy, dz, dw = 0] = dir;
    const line = [{ x, y, z, w }];

    for (let step = 1; step < WIN_LENGTH; step += 1) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      const nz = z + dz * step;
      const nw = w + dw * step;
      if (!inBounds(nx, ny, nz, state.size, state.is4D ? nw : undefined)) break;
      if (boardGet(state.board, nx, ny, nz, nw) !== player) break;
      line.push({ x: nx, y: ny, z: nz, w: nw });
    }

    for (let step = 1; step < WIN_LENGTH; step += 1) {
      const nx = x - dx * step;
      const ny = y - dy * step;
      const nz = z - dz * step;
      const nw = w - dw * step;
      if (!inBounds(nx, ny, nz, state.size, state.is4D ? nw : undefined)) break;
      if (boardGet(state.board, nx, ny, nz, nw) !== player) break;
      line.unshift({ x: nx, y: ny, z: nz, w: nw });
    }

    if (line.length >= WIN_LENGTH) {
      for (let i = 0; i <= line.length - WIN_LENGTH; i += 1) {
        const slice = line.slice(i, i + WIN_LENGTH);
        if (slice.some((c) => c.x === x && c.y === y && c.z === z && (c.w ?? 0) === w)) {
          return slice;
        }
      }
      return line.slice(0, WIN_LENGTH);
    }
  }

  return [];
}

function buildDirections3D() {
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

function buildDirections4D() {
  const out = [];
  for (let dw = -1; dw <= 1; dw += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0 && dz === 0 && dw === 0) continue;
          // canonical half-space: first non-zero component must be positive
          const first = [dw, dz, dy, dx].find((v) => v !== 0);
          if (first < 0) continue;
          out.push([dx, dy, dz, dw]);
        }
      }
    }
  }
  return out;
}

function getDirs() {
  return state.is4D ? dirs4D : dirs3D;
}

function boardGet(board, x, y, z, w) {
  return state.is4D ? board[w][z][y][x] : board[z][y][x];
}

function boardSet(board, x, y, z, w, val) {
  if (state.is4D) board[w][z][y][x] = val;
  else board[z][y][x] = val;
}

function inBounds(x, y, z, size, w) {
  const base = x >= 0 && x < size && y >= 0 && y < size && z >= 0 && z < size;
  if (w === undefined) return base;
  return base && w >= 0 && w < size;
}

function getDropZ(x, y, w = 0) {
  for (let z = 0; z < state.size; z += 1) {
    if (boardGet(state.board, x, y, z, w) === 0) return z;
  }
  return -1;
}

function getBoardShiftY() {
  return 88 + Math.max(0, state.size - 5) * 28;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── AI ──────────────────────────────────────────────────────────────────────

function copyBoard(board) {
  if (state.is4D) {
    return board.map((wSlice) => wSlice.map((zSlice) => zSlice.map((row) => row.slice())));
  }
  return board.map((zSlice) => zSlice.map((row) => row.slice()));
}

function checkWinOnBoard(board, x, y, z, player, w = 0) {
  const dirs = getDirs();
  const size = state.size;
  for (const dir of dirs) {
    const [dx, dy, dz, dw = 0] = dir;
    let count = 1;
    for (let s = 1; s < WIN_LENGTH; s++) {
      const nx = x + dx * s, ny = y + dy * s, nz = z + dz * s, nw = w + dw * s;
      if (!inBounds(nx, ny, nz, size, state.is4D ? nw : undefined)) break;
      if (boardGet(board, nx, ny, nz, nw) !== player) break;
      count++;
    }
    for (let s = 1; s < WIN_LENGTH; s++) {
      const nx = x - dx * s, ny = y - dy * s, nz = z - dz * s, nw = w - dw * s;
      if (!inBounds(nx, ny, nz, size, state.is4D ? nw : undefined)) break;
      if (boardGet(board, nx, ny, nz, nw) !== player) break;
      count++;
    }
    if (count >= WIN_LENGTH) return true;
  }
  return false;
}

function evaluateBoard(board, noiseLevel = 0) {
  const size = state.size;
  const mid = (size - 1) / 2;
  let score = 0;
  const wRange = state.is4D ? size : 1;

  for (const dir of getDirs()) {
    const [dx, dy, dz, dw = 0] = dir;
    for (let w = 0; w < wRange; w++) {
      for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            let ai = 0, opp = 0;
            let valid = true;
            for (let s = 0; s < WIN_LENGTH; s++) {
              const nx = x + dx * s, ny = y + dy * s, nz = z + dz * s, nw = w + dw * s;
              if (!inBounds(nx, ny, nz, size, state.is4D ? nw : undefined)) {
                valid = false;
                break;
              }
              const v = boardGet(board, nx, ny, nz, nw);
              if (v === 2) ai++;
              else if (v === 1) opp++;
            }
            if (!valid) continue;
            if (ai > 0 && opp > 0) continue;
            if (ai === 4) score += 100000;
            else if (ai === 3) score += 500;
            else if (ai === 2) score += 50;
            else if (ai === 1) score += 5;
            if (opp === 4) score -= 100000;
            else if (opp === 3) score -= 600;
            else if (opp === 2) score -= 60;
            else if (opp === 1) score -= 5;
          }
        }
      }
    }
  }

  // center bonus
  for (let w = 0; w < wRange; w++) {
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = boardGet(board, x, y, z, w);
          if (v === 0) continue;
          let d =
            (mid - Math.abs(x - mid)) * (mid - Math.abs(y - mid)) * (mid - Math.abs(z - mid));
          if (state.is4D) d *= mid - Math.abs(w - mid);
          score += (v === 2 ? 1 : -1) * d * 0.5;
        }
      }
    }
  }

  score += (Math.random() - 0.5) * noiseLevel;
  return score;
}

function getMoves(board) {
  const size = state.size;
  const gravity = state.gravity;
  const moves = [];
  const mid = (size - 1) / 2;
  const wRange = state.is4D ? size : 1;

  if (gravity) {
    for (let w = 0; w < wRange; w++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let z = -1;
          for (let zi = 0; zi < size; zi++) {
            if (boardGet(board, x, y, zi, w) === 0) {
              z = zi;
              break;
            }
          }
          if (z === -1) continue;
          let d = (mid - Math.abs(x - mid)) * (mid - Math.abs(y - mid));
          if (state.is4D) d *= mid - Math.abs(w - mid);
          moves.push({ x, y, z, w, centerDist: -d });
        }
      }
    }
  } else {
    for (let w = 0; w < wRange; w++) {
      for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (boardGet(board, x, y, z, w) !== 0) continue;
            let d =
              (mid - Math.abs(x - mid)) *
              (mid - Math.abs(y - mid)) *
              (mid - Math.abs(z - mid));
            if (state.is4D) d *= mid - Math.abs(w - mid);
            moves.push({ x, y, z, w, centerDist: -d });
          }
        }
      }
    }
  }

  moves.sort((a, b) => a.centerDist - b.centerDist);
  return moves;
}

function minimax(board, depth, alpha, beta, isMaximizing, noiseLevel = 0) {
  const moves = getMoves(board);
  if (moves.length === 0 || depth === 0) {
    return { score: evaluateBoard(board, noiseLevel), move: null };
  }

  const player = isMaximizing ? 2 : 1;
  let bestMove = null;
  let bestScore = isMaximizing ? -Infinity : Infinity;

  for (const move of moves) {
    const { x, y, z, w } = move;
    boardSet(board, x, y, z, w ?? 0, player);

    let score;
    if (checkWinOnBoard(board, x, y, z, player, w ?? 0)) {
      score = isMaximizing ? 100000 + depth : -(100000 + depth);
    } else if (depth === 1) {
      score = evaluateBoard(board, noiseLevel);
    } else {
      score = minimax(board, depth - 1, alpha, beta, !isMaximizing, noiseLevel).score;
    }

    boardSet(board, x, y, z, w ?? 0, 0);

    if (isMaximizing) {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
      beta = Math.min(beta, bestScore);
    }

    if (beta <= alpha) break;
  }

  return { score: bestScore, move: bestMove };
}

function getAIMove(noiseLevel = 0) {
  const board = copyBoard(state.board);
  const depth = state.is4D ? 1 : { 4: 4, 5: 3, 6: 2 }[state.size] || 2;
  return minimax(board, depth, -Infinity, Infinity, true, noiseLevel).move;
}

function scheduleAIMove() {
  const gen = ++state.aiGeneration;
  state.aiThinking = true;
  setAIThinkingUI(true);
  setTimeout(() => {
    if (gen !== state.aiGeneration) return;
    const move = getAIMove(AI_NOISE);
    state.aiThinking = false;
    setAIThinkingUI(false);
    if (move && !state.winner && state.currentPlayer === 2) {
      if (state.gravity) {
        placeMoveWithGravity(move.x, move.y, move.w ?? 0);
      } else {
        placeMove(move.x, move.y, move.z, move.w ?? 0);
      }
    }
  }, 50);
}

function setAIThinkingUI(thinking) {
  if (thinking) {
    dom.turnText.textContent = "AI is thinking\u2026";
    dom.boardContainer.style.opacity = "0.7";
    dom.boardContainer.style.pointerEvents = "none";
  } else {
    dom.boardContainer.style.opacity = "";
    dom.boardContainer.style.pointerEvents = "";
    renderStatus();
  }
}

// ─── Battle Simulator ────────────────────────────────────────────────────────

function simulateGame({ size, gravity, noiseLevel }) {
  const savedSize = state.size, savedGravity = state.gravity, savedIs4D = state.is4D;
  state.size = size;
  state.gravity = gravity;
  state.is4D = false;

  const board = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => Array(size).fill(0))
  );
  const depth = { 4: 4, 5: 3, 6: 2 }[size] || 2;
  let player = 1;

  for (let i = 0; i < size ** 3; i++) {
    const isMax = player === 2;
    const result = minimax(board, depth, -Infinity, Infinity, isMax, noiseLevel);
    if (!result.move) break;
    const { x, y, z } = result.move;
    boardSet(board, x, y, z, 0, player);
    if (checkWinOnBoard(board, x, y, z, player)) {
      state.size = savedSize; state.gravity = savedGravity; state.is4D = savedIs4D;
      return player;
    }
    player = player === 1 ? 2 : 1;
  }

  state.size = savedSize; state.gravity = savedGravity; state.is4D = savedIs4D;
  return 0;
}

async function runBattleSimulation() {
  const GAMES = 10;
  const configs = [
    { size: 4, gravity: false },
    { size: 4, gravity: true },
    { size: 5, gravity: false },
    { size: 5, gravity: true },
    { size: 6, gravity: false },
    { size: 6, gravity: true },
  ];

  dom.simBtn.disabled = true;
  dom.simResults.innerHTML = "<em>Running\u2026</em>";

  const rows = [];
  for (const cfg of configs) {
    let p1 = 0, p2 = 0, draws = 0;
    for (let g = 0; g < GAMES; g++) {
      const winner = simulateGame({ ...cfg, noiseLevel: SIM_NOISE });
      if (winner === 1) p1++;
      else if (winner === 2) p2++;
      else draws++;
      await new Promise((r) => setTimeout(r, 0));
    }
    rows.push({ cfg, p1, p2, draws, total: GAMES });
    renderSimResults(rows);
  }

  dom.simBtn.disabled = false;
}

function renderSimResults(rows) {
  const label = (cfg) =>
    `${cfg.size}\xd7${cfg.size}\xd7${cfg.size}${cfg.gravity ? " +grav" : ""}`;
  const thead = `<tr><th>Config</th><th>P1 wins</th><th>P2 wins</th><th>Draws</th><th>P1 adv.</th></tr>`;
  const tbody = rows
    .map(({ cfg, p1, p2, draws, total }) => {
      const adv = (((p1 - p2) / total) * 100).toFixed(0);
      const sign = Number(adv) > 0 ? "+" : "";
      return `<tr><td>${label(cfg)}</td><td>${p1}</td><td>${p2}</td><td>${draws}</td><td>${sign}${adv}%</td></tr>`;
    })
    .join("");
  dom.simResults.innerHTML = `<table class="sim-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
