"use strict";

/**
 * Selfo — main application logic.
 *
 * Game phases:
 *   'mode-select' -> 'setup' -> 'playing' -> 'ended'
 *
 * NOTE on future extensibility (per spec, not exposed in UI yet):
 *   RULES.maxStepsPerMove  — a piece could move several cells in one
 *                            straight hop instead of exactly 1.
 *   RULES.movesPerTurn     — a player could chain up to N moves in a turn.
 *   Both are read by isValidMove()/the turn loop so a future UI only has
 *   to change these values and add controls for them.
 */

// ---------------------------------------------------------------------
// Configuration & rules (future-proofed)
// ---------------------------------------------------------------------
const CONFIG = {
  MIN_RADIUS: 2,
  MAX_RADIUS: 6,
  DEFAULT_RADIUS: 3,
  CELL_SIZE: 30, // px, constant regardless of board radius
};

const RULES = {
  maxStepsPerMove: 1, // future: allow moving N cells in a straight line
  movesPerTurn: 1,    // future: allow chaining N moves per turn
};

// ---------------------------------------------------------------------
// Global mutable game state
// ---------------------------------------------------------------------
const Game = {
  phase: "mode-select", // 'mode-select' | 'setup' | 'playing' | 'ended'
  mode: null,            // 'local2p' | 'online2p' | 'vscomputer' | 'computerself'

  radius: CONFIG.DEFAULT_RADIUS,
  piecesPerColor: 0,

  cells: new Map(),      // key "q,r" -> { q, r, color: null|'black'|'white' }
  neighborKeys: new Map(),// key -> array of neighbor keys that exist on board

  turn: "black",
  pieRuleAvailable: false, // true only right before white's first move
  selectedKey: null,
  lastMove: null,          // { from, to } for highlight
  winner: null,             // 'black' | 'white' | null
  drawOffered: null,        // color that offered a draw, or null

  players: {
    black: { name: "Player 1", isLocal: true },
    white: { name: "Player 2", isLocal: true },
  },
  localColor: null, // in online mode, which color this browser controls

  // online play
  gameId: null,
  isHost: false,
  peer: null,
  conn: null,
};

// ---------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------
const dom = {
  gameIdValue: document.getElementById("gameIdValue"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  turnIndicator: document.getElementById("turnIndicator"),

  playerNameBlack: document.getElementById("playerNameBlack"),
  playerNameWhite: document.getElementById("playerNameWhite"),
  playerYouBlack: document.getElementById("playerYouBlack"),
  playerYouWhite: document.getElementById("playerYouWhite"),
  playerRowBlack: document.getElementById("playerRowBlack"),
  playerRowWhite: document.getElementById("playerRowWhite"),

  swapColorBtn: document.getElementById("swapColorBtn"),
  offerDrawBtn: document.getElementById("offerDrawBtn"),
  resignBtn: document.getElementById("resignBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  messageBox: document.getElementById("messageBox"),

  boardSvg: document.getElementById("boardSvg"),

  modeSelectBlock: document.getElementById("modeSelectBlock"),
  modeButtons: Array.from(document.querySelectorAll(".mode-btn")),

  onlineBlock: document.getElementById("onlineBlock"),
  createGameBtn: document.getElementById("createGameBtn"),
  joinGameBtn: document.getElementById("joinGameBtn"),
  joinCodeWrap: document.getElementById("joinCodeWrap"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  joinCodeSubmit: document.getElementById("joinCodeSubmit"),
  onlineStatus: document.getElementById("onlineStatus"),

  nicknameBlock: document.getElementById("nicknameBlock"),
  nicknameInput: document.getElementById("nicknameInput"),

  paramsBlock: document.getElementById("paramsBlock"),
  radiusRange: document.getElementById("radiusRange"),
  radiusValue: document.getElementById("radiusValue"),
  piecesRange: document.getElementById("piecesRange"),
  piecesValue: document.getElementById("piecesValue"),
  cpuParamsBlock: document.getElementById("cpuParamsBlock"),
  cpuTimeRange: document.getElementById("cpuTimeRange"),
  cpuTimeValue: document.getElementById("cpuTimeValue"),
  cpuDepthRange: document.getElementById("cpuDepthRange"),
  cpuDepthValue: document.getElementById("cpuDepthValue"),

  startBlock: document.getElementById("startBlock"),
  startGameBtn: document.getElementById("startGameBtn"),
  backToModeBtn: document.getElementById("backToModeBtn"),

  winnerOverlay: document.getElementById("winnerOverlay"),
  winnerTitle: document.getElementById("winnerTitle"),
  winnerText: document.getElementById("winnerText"),
  winnerCloseBtn: document.getElementById("winnerCloseBtn"),

  onboardingOverlay: document.getElementById("onboardingOverlay"),
  onboardingDontShow: document.getElementById("onboardingDontShow"),
  onboardingCloseBtn: document.getElementById("onboardingCloseBtn"),
  helpBtn: document.getElementById("helpBtn"),
};

// =======================================================================
// Utility helpers
// =======================================================================

function randomGameId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function showMessage(text) {
  dom.messageBox.textContent = text;
}

function opponentOf(color) {
  return color === "black" ? "white" : "black";
}

// =======================================================================
// Board generation & piece placement
// =======================================================================

/** Fisher-Yates shuffle, returns a new shuffled array (does not mutate input). */
function shuffled(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Splits all cells of a board into 3 "color classes" using (q - r) mod 3.
 * On a hex grid, any two adjacent cells always fall into different classes
 * (their (q - r) value always changes by +1 or +2 mod 3 across an edge),
 * so each class is, by construction, an independent set: no two cells
 * within the same class are ever adjacent. This is what lets us guarantee
 * "no two same-color pieces on adjacent cells" purely by picking pieces
 * from a single class per color.
 */
function classifyCellsByIndependentSet(rawCells) {
  const classes = [[], [], []];
  for (const c of rawCells) {
    const idx = ((c.q - c.r) % 3 + 3) % 3;
    classes[idx].push(c);
  }
  return classes;
}

/** Min/max pieces per color allowed for a given radius, respecting the
 *  no-adjacent-same-color constraint (max = size of the smaller of the
 *  two independent-set classes used for black and white). */
function pieceRangeForRadius(radius) {
  const { cells } = BoardInit.init(radius);
  const rawCells = Array.from(cells.values());
  const classes = classifyCellsByIndependentSet(rawCells);
  const sizes = classes.map((c) => c.length).sort((a, b) => b - a);
  const maxPerColor = Math.max(1, sizes[1]); // 2nd-largest: the smaller of the 2 pools we'll actually use
  const minPerColor = Math.max(1, Math.min(maxPerColor, 2));
  return { min: minPerColor, max: maxPerColor };
}

/**
 * Build a fresh board of the given radius and randomly scatter
 * `piecesPerColor` black and white pieces so that no two pieces of the
 * same color ever sit on adjacent cells. The empty grid itself comes from
 * BoardInit (see boardinit.js), which is where alternative grid-generation
 * strategies live; this function only handles piece placement. Each
 * color's pieces are drawn from one of the 3 independent-set classes of
 * the hex grid (see classifyCellsByIndependentSet), so the constraint
 * holds by construction — not by trial and error — and the layout is
 * re-randomized every game.
 */
function buildBoard(radius, piecesPerColor) {
  const { cells, neighborKeys } = BoardInit.init(radius);
  const rawCells = Array.from(cells.values());

  // pick the 2 largest independent-set classes and randomly assign one to
  // each color (order shuffled so the same board size doesn't always put
  // black on the same class)
  const classes = classifyCellsByIndependentSet(rawCells)
    .slice()
    .sort((a, b) => b.length - a.length);
  const [blackPool, whitePool] = shuffled([classes[0], classes[1]]);

  const blackCells = shuffled(blackPool).slice(0, piecesPerColor);
  const whiteCells = shuffled(whitePool).slice(0, piecesPerColor);

  for (const c of blackCells) cells.get(HexGeometry.key(c.q, c.r)).color = "black";
  for (const c of whiteCells) cells.get(HexGeometry.key(c.q, c.r)).color = "white";

  return { cells, neighborKeys };
}

// =======================================================================
// Connectivity check (win condition)
// =======================================================================

/** True if every piece of `color` can reach every other piece of `color`
 *  through adjacent same-color cells (i.e. they form a single group). */
function isFullyConnected(color) {
  const ownKeys = [];
  for (const [k, cell] of Game.cells) {
    if (cell.color === color) ownKeys.push(k);
  }
  if (ownKeys.length <= 1) return ownKeys.length === 1; // 0 pieces = trivially not a win
  const start = ownKeys[0];
  const visited = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const k = stack.pop();
    for (const nk of Game.neighborKeys.get(k)) {
      if (visited.has(nk)) continue;
      const nCell = Game.cells.get(nk);
      if (nCell.color === color) {
        visited.add(nk);
        stack.push(nk);
      }
    }
  }
  return visited.size === ownKeys.length;
}

// =======================================================================
// Rendering
// =======================================================================

function renderBoard() {
  const svg = dom.boardSvg;
  svg.innerHTML = "";

  const size = CONFIG.CELL_SIZE;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const positions = new Map();
  for (const [k, cell] of Game.cells) {
    const p = HexGeometry.axialToPixel(cell.q, cell.r, size);
    positions.set(k, p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const pad = size * 1.4;
  const vbX = minX - pad, vbY = minY - pad;
  const vbW = (maxX - minX) + pad * 2, vbH = (maxY - minY) + pad * 2;
  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.setAttribute("width", Math.round(vbW));
  svg.setAttribute("height", Math.round(vbH));

  // gradients for pieces (defined once per render, cheap enough)
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <radialGradient id="pieceBlackGrad" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#4b5158"/>
      <stop offset="100%" stop-color="#05060a"/>
    </radialGradient>
    <radialGradient id="pieceWhiteGrad" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#aeb8c0"/>
    </radialGradient>`;
  svg.appendChild(defs);

  const cellsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  cellsGroup.setAttribute("id", "cellsGroup");
  const piecesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  piecesGroup.setAttribute("id", "piecesGroup");

  for (const [k, cell] of Game.cells) {
    const p = positions.get(k);
    const corners = HexGeometry.hexCorners(p.x, p.y, size);
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", corners.map((pt) => pt.join(",")).join(" "));
    poly.setAttribute("class", "hex-cell");
    poly.dataset.key = k;
    poly.addEventListener("click", () => onCellClick(k));
    cellsGroup.appendChild(poly);
  }

  svg.appendChild(cellsGroup);
  svg.appendChild(piecesGroup);

  renderPieces(positions);
  applyHighlights();
}

function renderPieces(positions) {
  const piecesGroup = document.getElementById("piecesGroup");
  piecesGroup.innerHTML = "";
  const r = CONFIG.CELL_SIZE * 0.62;

  for (const [k, cell] of Game.cells) {
    if (!cell.color) continue;
    const p = positions.get(k) || HexGeometry.axialToPixel(cell.q, cell.r, CONFIG.CELL_SIZE);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
    circle.setAttribute("r", r);
    circle.setAttribute("class", `piece piece-${cell.color}`);
    circle.dataset.key = k;

    const canDrag = Game.phase === "playing" && cell.color === Game.turn && isMyTurnLocally();
    if (canDrag) {
      circle.classList.add("own-piece", "draggable");
      circle.addEventListener("pointerdown", (ev) => onPieceDragStart(ev, k));
    }
    circle.addEventListener("click", (ev) => { ev.stopPropagation(); onCellClick(k); });

    piecesGroup.appendChild(circle);
  }
}

function applyHighlights() {
  const polys = dom.boardSvg.querySelectorAll(".hex-cell");
  const selected = Game.selectedKey;
  const targets = selected ? Game.neighborKeys.get(selected).filter((nk) => !Game.cells.get(nk).color) : [];

  polys.forEach((poly) => {
    const k = poly.dataset.key;
    poly.classList.remove("selected", "move-target", "selectable", "last-move");
    const cell = Game.cells.get(k);

    if (Game.phase === "playing" && isMyTurnLocally()) {
      if (cell.color === Game.turn) poly.classList.add("selectable");
      if (targets.includes(k)) poly.classList.add("selectable", "move-target");
    }
    if (k === selected) poly.classList.add("selected");
    if (Game.lastMove && (k === Game.lastMove.from || k === Game.lastMove.to)) {
      poly.classList.add("last-move");
    }
  });

  dom.boardSvg.querySelectorAll(".piece").forEach((p) => {
    p.classList.toggle("selected-piece", p.dataset.key === selected);
  });
}

// =======================================================================
// Interaction: click-click move
// =======================================================================

function onCellClick(key) {
  if (Game.phase !== "playing" || !isMyTurnLocally()) return;
  const cell = Game.cells.get(key);

  if (Game.selectedKey === null) {
    if (cell.color === Game.turn) {
      Game.selectedKey = key;
      applyHighlights();
    }
    return;
  }

  if (key === Game.selectedKey) {
    Game.selectedKey = null; // deselect
    applyHighlights();
    return;
  }

  const targets = Game.neighborKeys.get(Game.selectedKey).filter((nk) => !Game.cells.get(nk).color);
  if (targets.includes(key)) {
    performMove(Game.selectedKey, key);
    return;
  }

  // clicked a different own piece -> reselect; anything else -> deselect
  if (cell.color === Game.turn) {
    Game.selectedKey = key;
  } else {
    Game.selectedKey = null;
  }
  applyHighlights();
}

// =======================================================================
// Interaction: drag & drop move
// =======================================================================

let dragState = null;

function svgUserPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

function onPieceDragStart(ev, key) {
  if (Game.phase !== "playing" || !isMyTurnLocally()) return;
  const cell = Game.cells.get(key);
  if (cell.color !== Game.turn) return;
  ev.preventDefault();

  Game.selectedKey = key;
  applyHighlights();

  const svg = dom.boardSvg;
  const circle = ev.currentTarget;
  circle.setPointerCapture(ev.pointerId);
  circle.classList.add("dragging");

  dragState = { key, circle, pointerId: ev.pointerId };

  const onMove = (mv) => {
    const p = svgUserPoint(svg, mv.clientX, mv.clientY);
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
  };

  const onUp = (up) => {
    circle.removeEventListener("pointermove", onMove);
    circle.removeEventListener("pointerup", onUp);
    circle.classList.remove("dragging");

    const p = svgUserPoint(svg, up.clientX, up.clientY);
    const axial = HexGeometry.pixelToAxial(p.x, p.y, CONFIG.CELL_SIZE);
    const targetKey = HexGeometry.key(axial.q, axial.r);
    const targets = Game.neighborKeys.get(key) ? Game.neighborKeys.get(key).filter((nk) => !Game.cells.get(nk).color) : [];

    if (targets.includes(targetKey)) {
      performMove(key, targetKey);
    } else {
      renderPieces(currentPositions()); // snap back
      applyHighlights();
    }
    dragState = null;
  };

  circle.addEventListener("pointermove", onMove);
  circle.addEventListener("pointerup", onUp);
}

function currentPositions() {
  const positions = new Map();
  for (const [k, cell] of Game.cells) {
    positions.set(k, HexGeometry.axialToPixel(cell.q, cell.r, CONFIG.CELL_SIZE));
  }
  return positions;
}

// =======================================================================
// Move execution, turn flow, win/draw handling
// =======================================================================

function isMyTurnLocally() {
  if (Game.mode === "online2p") return Game.turn === Game.localColor;
  return true; // local2p: both colors are played on this device
}

/** Applies a move to the model, re-renders, checks for a win, advances turn. */
function performMove(fromKey, toKey, opts = {}) {
  const { fromRemote = false } = opts;
  const fromCell = Game.cells.get(fromKey);
  const toCell = Game.cells.get(toKey);
  const color = fromCell.color;

  toCell.color = color;
  fromCell.color = null;
  Game.selectedKey = null;
  Game.lastMove = { from: fromKey, to: toKey };
  // the pie-rule swap is only ever offered on white's very first move, so a
  // black move must never cancel it — only white moving normally does.
  if (color === "white") Game.pieRuleAvailable = false;
  Game.drawOffered = null;

  if (Game.mode === "online2p" && !fromRemote) {
    sendToRemote({ type: "move", from: fromKey, to: toKey });
  }

  renderBoard();

  if (isFullyConnected(color)) {
    endGame(color, "connection");
    return;
  }

  Game.turn = opponentOf(color);
  updateStatusUI();
}

function endGame(winnerColor, reason) {
  Game.phase = "ended";
  Game.winner = winnerColor;
  renderBoard();
  updateButtonsForPhase();

  dom.winnerOverlay.hidden = false;
  if (reason === "resign") {
    dom.winnerTitle.textContent = "Victory by resignation";
  } else if (reason === "draw") {
    dom.winnerTitle.textContent = "Draw agreed";
    dom.winnerText.textContent = "Both players agreed to end the game.";
    dom.winnerOverlay.hidden = false;
    updateStatusUI();
    return;
  } else {
    dom.winnerTitle.textContent = "Connection complete!";
  }
  const name = Game.players[winnerColor].name;
  dom.winnerText.textContent = reason === "resign"
    ? `${name} (${winnerColor}) wins — their opponent resigned.`
    : `${name} (${winnerColor}) connected all of their pieces.`;
  showMessage("Game finished. Press \u201cNew game\u201d to play again.");
  updateStatusUI();
}

function endGameDraw() {
  Game.phase = "ended";
  Game.winner = null;
  updateButtonsForPhase();
  dom.winnerOverlay.hidden = false;
  dom.winnerTitle.textContent = "Draw agreed";
  dom.winnerText.textContent = "Both players agreed to end the game.";
  showMessage("Game finished. Press \u201cNew game\u201d to play again.");
  updateStatusUI();
}

// =======================================================================
// Pie rule (swap colors on white's first move)
// =======================================================================

function swapColors() {
  if (Game.phase !== "playing" || !Game.pieRuleAvailable) return;
  if (Game.turn !== "white") return;

  for (const cell of Game.cells.values()) {
    if (cell.color === "black") cell.color = "white";
    else if (cell.color === "white") cell.color = "black";
  }
  const tmp = Game.players.black;
  Game.players.black = Game.players.white;
  Game.players.white = tmp;
  if (Game.localColor) Game.localColor = opponentOf(Game.localColor === "black" ? "white" : "black");

  Game.pieRuleAvailable = false;
  Game.turn = "black"; // after the swap, it's black's (formerly white's opponent) turn

  if (Game.mode === "online2p" && Game.isHost) {
    sendToRemote({ type: "swap" });
  }

  renderBoard();
  updateStatusUI();
  updatePlayersUI();
}

// =======================================================================
// Resign / draw
// =======================================================================

function resign() {
  if (Game.phase !== "playing") return;
  if (!confirm("Resign this game?")) return;
  const resigningColor = isMyTurnLocally() ? Game.turn : opponentOf(Game.turn);
  const localPlayerColor = Game.mode === "online2p" ? Game.localColor : Game.turn;
  if (Game.mode === "online2p") {
    sendToRemote({ type: "resign", color: localPlayerColor });
    endGame(opponentOf(localPlayerColor), "resign");
  } else {
    endGame(opponentOf(resigningColor), "resign");
  }
}

function offerDraw() {
  if (Game.phase !== "playing") return;
  if (Game.mode === "online2p") {
    Game.drawOffered = Game.localColor;
    sendToRemote({ type: "draw-offer" });
    showMessage("Draw offer sent. Waiting for opponent...");
  } else {
    if (confirm("Both players agree to a draw?")) {
      endGameDraw();
    }
  }
}

// =======================================================================
// UI state / phase management
// =======================================================================

function setPhase(phase) {
  Game.phase = phase;
  dom.modeSelectBlock.hidden = phase !== "mode-select";
  dom.onlineBlock.hidden = !(phase === "setup" && Game.mode === "online2p");
  dom.nicknameBlock.hidden = phase === "mode-select";
  dom.paramsBlock.hidden = phase === "mode-select";
  dom.startBlock.hidden = phase === "mode-select";
  updateButtonsForPhase();

  if (phase === "mode-select") {
    showMessage("Choose a mode on the right to begin: two players on this device, or online with a code.");
  } else if (phase === "setup") {
    showMessage("Set up your board on the right, then press \u201cStart game\u201d.");
  }
}

function updateButtonsForPhase() {
  const playing = Game.phase === "playing";
  dom.swapColorBtn.disabled = !(playing && Game.pieRuleAvailable && Game.turn === "white" && isMyTurnLocally());
  dom.offerDrawBtn.disabled = !playing;
  dom.resignBtn.disabled = !playing;
  // "New game" only makes sense once a game is actually running or over —
  // during mode-select/setup there is nothing to abandon, and having it
  // active then reads as competing with the "Start game" button.
  dom.newGameBtn.disabled = !(Game.phase === "playing" || Game.phase === "ended");
  dom.startGameBtn.disabled = !canStartGame();
}

function canStartGame() {
  if (Game.phase !== "setup") return false;
  if (Game.mode === "online2p") {
    return Boolean(Game.conn && Game.conn.open) && Game.isHost;
  }
  return true;
}

function updateStatusUI() {
  const ind = dom.turnIndicator;
  ind.classList.remove("turn-black", "turn-white", "turn-over");
  if (Game.phase === "mode-select") {
    ind.textContent = "SELECT MODE";
  } else if (Game.phase === "setup") {
    ind.textContent = "SETTING UP...";
  } else if (Game.phase === "playing") {
    const name = Game.players[Game.turn].name;
    ind.textContent = `${name.toUpperCase()} TO MOVE (${Game.turn.toUpperCase()})`;
    ind.classList.add(Game.turn === "black" ? "turn-black" : "turn-white");
  } else if (Game.phase === "ended") {
    ind.textContent = Game.winner ? `${Game.players[Game.winner].name.toUpperCase()} WINS` : "DRAW";
    ind.classList.add("turn-over");
  }
  updatePlayersUI();
  updateButtonsForPhase();
}

function updatePlayersUI() {
  dom.playerNameBlack.textContent = Game.players.black.name;
  dom.playerNameWhite.textContent = Game.players.white.name;
  dom.playerYouBlack.textContent = Game.mode === "online2p" && Game.localColor === "black" ? "(you)" : "";
  dom.playerYouWhite.textContent = Game.mode === "online2p" && Game.localColor === "white" ? "(you)" : "";
  dom.playerRowBlack.classList.toggle("active-turn", Game.phase === "playing" && Game.turn === "black");
  dom.playerRowWhite.classList.toggle("active-turn", Game.phase === "playing" && Game.turn === "white");
}

// =======================================================================
// Setup panel wiring
// =======================================================================

function refreshPieceRangeUI() {
  const { min, max } = pieceRangeForRadius(Game.radius);
  dom.piecesRange.min = String(min);
  dom.piecesRange.max = String(max);
  const mid = Math.round((min + max) / 2);
  dom.piecesRange.value = String(Math.min(max, Math.max(min, mid)));
  dom.piecesValue.textContent = `${dom.piecesRange.value} (${min}-${max})`;
}

dom.radiusRange.addEventListener("input", () => {
  Game.radius = Number(dom.radiusRange.value);
  dom.radiusValue.textContent = String(Game.radius);
  refreshPieceRangeUI();
});
dom.piecesRange.addEventListener("input", () => {
  const { min, max } = pieceRangeForRadius(Game.radius);
  dom.piecesValue.textContent = `${dom.piecesRange.value} (${min}-${max})`;
});
dom.cpuTimeRange.addEventListener("input", () => {
  dom.cpuTimeValue.textContent = dom.cpuTimeRange.value;
});
dom.cpuDepthRange.addEventListener("input", () => {
  dom.cpuDepthValue.textContent = dom.cpuDepthRange.value;
});

dom.modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    dom.modeButtons.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectMode(btn.dataset.mode);
  });
});

function selectMode(mode) {
  Game.mode = mode;
  Game.isHost = mode === "online2p" ? true : Game.isHost; // default assumption until join overrides
  Game.gameId = null;
  dom.gameIdValue.textContent = "\u2014";
  dom.copyLinkBtn.disabled = true;
  dom.onlineStatus.textContent = "";
  dom.onlineStatus.className = "online-status";
  dom.joinCodeWrap.hidden = true;

  refreshPieceRangeUI();
  dom.radiusValue.textContent = String(Game.radius);

  setPhase("setup");

  if (mode === "local2p") {
    dom.nicknameBlock.hidden = true; // both players share this device, defaults are used
    dom.startGameBtn.disabled = false;
  } else if (mode === "online2p") {
    dom.nicknameBlock.hidden = false;
    dom.nicknameInput.placeholder = "Your nickname";
    dom.startGameBtn.disabled = true; // enabled once connected
  }
  updateButtonsForPhase();
}

dom.backToModeBtn.addEventListener("click", () => {
  teardownOnline();
  dom.modeButtons.forEach((b) => b.classList.remove("selected"));
  Game.mode = null;
  setPhase("mode-select");
  updateStatusUI();
});

dom.newGameBtn.addEventListener("click", () => {
  if (Game.phase === "playing" && !confirm("Abandon the current game?")) return;
  teardownOnline();
  dom.winnerOverlay.hidden = true;
  dom.modeButtons.forEach((b) => b.classList.remove("selected"));
  Game.mode = null;
  Game.winner = null;
  setPhase("mode-select");
  updateStatusUI();
  showMessage("");
});

dom.winnerCloseBtn.addEventListener("click", () => dom.newGameBtn.click());

dom.swapColorBtn.addEventListener("click", swapColors);
dom.offerDrawBtn.addEventListener("click", offerDraw);
dom.resignBtn.addEventListener("click", resign);

// =======================================================================
// Starting a local game
// =======================================================================

dom.startGameBtn.addEventListener("click", () => {
  if (!canStartGame()) return;
  const nick = dom.nicknameInput.value.trim();

  if (Game.mode === "local2p") {
    Game.players.black = { name: "Player 1", isLocal: true };
    Game.players.white = { name: "Player 2", isLocal: true };
    Game.gameId = randomGameId();
    startNewGame();
  } else if (Game.mode === "online2p") {
    // host confirms start; broadcast the board so both sides match
    Game.players[Game.localColor] = { name: nick || "Player", isLocal: true };
    startNewGame();
    sendToRemote({
      type: "start",
      radius: Game.radius,
      piecesPerColor: Game.piecesPerColor,
      cells: Array.from(Game.cells.values()),
      players: Game.players,
      hostColor: Game.localColor,
    });
  }
});

function startNewGame() {
  Game.radius = Number(dom.radiusRange.value);
  Game.piecesPerColor = Number(dom.piecesRange.value);
  const built = buildBoard(Game.radius, Game.piecesPerColor);
  Game.cells = built.cells;
  Game.neighborKeys = built.neighborKeys;
  Game.turn = "black";
  Game.pieRuleAvailable = true;
  Game.selectedKey = null;
  Game.lastMove = null;
  Game.winner = null;
  Game.drawOffered = null;

  dom.gameIdValue.textContent = Game.gameId || "\u2014";
  dom.copyLinkBtn.disabled = !Game.gameId;

  setPhase("playing");
  renderBoard();
  updateStatusUI();
  showMessage(
    Game.mode === "local2p"
      ? "Black moves first. White may swap colors instead of moving, on their first turn only."
      : "Game started."
  );
}

// =======================================================================
// Online play (PeerJS) — host creates a room, guest joins with the code
// =======================================================================

function teardownOnline() {
  if (Game.conn) { try { Game.conn.close(); } catch (e) {} Game.conn = null; }
  if (Game.peer) { try { Game.peer.destroy(); } catch (e) {} Game.peer = null; }
  Game.localColor = null;
}

function sendToRemote(payload) {
  if (Game.conn && Game.conn.open) Game.conn.send(payload);
}

function wireConnection(conn) {
  Game.conn = conn;
  conn.on("open", () => {
    dom.onlineStatus.textContent = Game.isHost
      ? "Opponent connected. Ready to start."
      : "Connected. Waiting for the host to start the game.";
    dom.onlineStatus.className = "online-status ok";
    const myName = dom.nicknameInput.value.trim() || (Game.isHost ? "Player 1" : "Player 2");
    sendToRemote({ type: "nickname", color: Game.localColor, name: myName });
    updateButtonsForPhase();
  });
  conn.on("data", (payload) => handleRemoteMessage(payload));
  conn.on("close", () => {
    dom.onlineStatus.textContent = "Opponent disconnected.";
    dom.onlineStatus.className = "online-status err";
    showMessage("Your opponent disconnected.");
  });
  conn.on("error", (err) => {
    dom.onlineStatus.textContent = "Connection error.";
    dom.onlineStatus.className = "online-status err";
  });
}

function handleRemoteMessage(msg) {
  switch (msg.type) {
    case "start": {
      Game.radius = msg.radius;
      Game.piecesPerColor = msg.piecesPerColor;
      const cells = new Map();
      for (const c of msg.cells) cells.set(HexGeometry.key(c.q, c.r), { q: c.q, r: c.r, color: c.color });
      const neighborKeys = BoardInit.buildNeighborMap(cells);
      Game.cells = cells;
      Game.neighborKeys = neighborKeys;
      Game.turn = "black";
      Game.pieRuleAvailable = true;
      Game.selectedKey = null;
      Game.lastMove = null;
      Game.winner = null;
      Game.players = msg.players;
      setPhase("playing");
      renderBoard();
      updateStatusUI();
      showMessage("Game started.");
      break;
    }
    case "move": {
      performMove(msg.from, msg.to, { fromRemote: true });
      break;
    }
    case "swap": {
      const tmp = Game.players.black;
      Game.players.black = Game.players.white;
      Game.players.white = tmp;
      Game.localColor = opponentOf(Game.localColor);
      for (const cell of Game.cells.values()) {
        if (cell.color === "black") cell.color = "white";
        else if (cell.color === "white") cell.color = "black";
      }
      Game.pieRuleAvailable = false;
      Game.turn = "black";
      renderBoard();
      updateStatusUI();
      updatePlayersUI();
      break;
    }
    case "resign": {
      endGame(opponentOf(msg.color), "resign");
      break;
    }
    case "draw-offer": {
      if (confirm("Your opponent offers a draw. Accept?")) {
        sendToRemote({ type: "draw-accept" });
        endGameDraw();
      } else {
        sendToRemote({ type: "draw-decline" });
      }
      break;
    }
    case "draw-accept": {
      endGameDraw();
      break;
    }
    case "draw-decline": {
      showMessage("Your opponent declined the draw offer.");
      break;
    }
    case "nickname": {
      if (Game.players[msg.color]) {
        Game.players[msg.color] = { name: msg.name, isLocal: false };
        updatePlayersUI();
      }
      break;
    }
  }
}

dom.createGameBtn.addEventListener("click", () => {
  teardownOnline();
  Game.isHost = true;
  Game.localColor = "black";
  const id = "selfo-" + randomGameId();
  Game.gameId = id.replace("selfo-", "");
  dom.onlineStatus.textContent = "Opening room...";
  dom.onlineStatus.className = "online-status";

  Game.peer = new Peer(id);
  Game.peer.on("open", () => {
    dom.gameIdValue.textContent = Game.gameId;
    dom.copyLinkBtn.disabled = false;
    dom.onlineStatus.textContent = `Room open. Share code ${Game.gameId} with your opponent.`;
    dom.onlineStatus.className = "online-status ok";
  });
  Game.peer.on("connection", (conn) => {
    wireConnection(conn);
  });
  Game.peer.on("error", (err) => {
    dom.onlineStatus.textContent = "Could not open room (network/relay issue).";
    dom.onlineStatus.className = "online-status err";
  });

  dom.joinCodeWrap.hidden = true;
  updatePlayersUI();
});

dom.joinGameBtn.addEventListener("click", () => {
  dom.joinCodeWrap.hidden = false;
  const urlCode = new URLSearchParams(location.search).get("join");
  if (urlCode) dom.joinCodeInput.value = urlCode;
});

dom.joinCodeSubmit.addEventListener("click", () => {
  const code = dom.joinCodeInput.value.trim();
  if (!code) return;
  teardownOnline();
  Game.isHost = false;
  Game.localColor = "white";
  Game.gameId = code;
  dom.gameIdValue.textContent = code;

  dom.onlineStatus.textContent = "Connecting...";
  dom.onlineStatus.className = "online-status";

  Game.peer = new Peer();
  Game.peer.on("open", () => {
    const conn = Game.peer.connect("selfo-" + code, { reliable: true });
    wireConnection(conn);
  });
  Game.peer.on("error", () => {
    dom.onlineStatus.textContent = "Could not connect. Check the code.";
    dom.onlineStatus.className = "online-status err";
  });
  updatePlayersUI();
});

dom.copyLinkBtn.addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?join=${Game.gameId}`;
  navigator.clipboard?.writeText(url).then(
    () => showMessage("Invite link copied to clipboard."),
    () => showMessage(`Invite link: ${url}`)
  );
});

// =======================================================================
// First-run onboarding
// =======================================================================

const ONBOARDING_KEY = "selfo_hide_onboarding";

function showOnboarding() {
  dom.onboardingOverlay.hidden = false;
}

function closeOnboarding() {
  dom.onboardingOverlay.hidden = true;
  if (dom.onboardingDontShow.checked) {
    try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch (e) { /* file:// or private mode: ignore */ }
  }
}

dom.onboardingCloseBtn.addEventListener("click", closeOnboarding);
dom.helpBtn.addEventListener("click", showOnboarding);

// =======================================================================
// Boot
// =======================================================================

function boot() {
  refreshPieceRangeUI();
  dom.radiusValue.textContent = String(Game.radius);
  setPhase("mode-select");
  updateStatusUI();

  let hideOnboarding = false;
  try { hideOnboarding = localStorage.getItem(ONBOARDING_KEY) === "1"; } catch (e) { /* ignore */ }
  if (!hideOnboarding) showOnboarding();

  // if the page was opened from an invite link, pre-select online mode
  const urlCode = new URLSearchParams(location.search).get("join");
  if (urlCode) {
    dom.modeButtons.find((b) => b.dataset.mode === "online2p")?.click();
    dom.joinGameBtn.click();
  }
}

boot();