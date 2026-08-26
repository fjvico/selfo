"use strict";

/**
 * Selfo — main application logic.
 *
 * Game phases:
 *   'setup' -> 'playing' -> 'ended' -> 'setup' (auto, new game) -> ...
 *
 * There's no "nothing configured yet" state: a mode is always active (see
 * CONFIG.DEFAULT_MODE) and the board always shows a live preview of what a
 * new game with the current settings would look like. Changing the mode
 * or a board parameter while in 'setup' just regenerates that preview.
 * The game actually begins ('setup' -> 'playing') the moment a piece
 * moves — no separate "Start" button. Ending a game (by connecting all
 * pieces, resigning, or agreeing a draw) enters 'ended', which shows the
 * final board for CONFIG.ENDED_PAUSE_MS and then automatically returns to
 * 'setup' with a fresh preview — using whatever mode/parameters are
 * current at that moment, since the setup controls stay live during the
 * pause too. Picking a mode (including the one already active) at any
 * time abandons the current game, if any, and jumps straight to a fresh
 * preview for it.
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
  DEFAULT_CPU_TIME_SECONDS: 5,
  DEFAULT_CPU_DEPTH: 2,
  TOUCH_LONG_PRESS_MS: 220,   // touch: hold-still time before a drag is "armed" (and page panning gets locked)
  TOUCH_LONG_PRESS_TOLERANCE_PX: 10, // touch: movement beyond this before arming cancels the drag and lets the page scroll instead
  MOUSE_HOVER_MOVE_MS: 550,  // desktop: dwell time hovering a piece/cell before it counts as a click
  DEFAULT_MODE: "local2p",   // a mode (and its board preview) is always active — there's no empty/unselected state
  ENDED_PAUSE_MS: 4500,      // how long the finished board stays on screen before the next game auto-begins
  CPU_FIRST_MOVE_GRACE_MS: 3000, // vs-computer with the CPU moving first: how long to wait, controls live, before it actually moves
};

const RULES = {
  maxStepsPerMove: 1, // future: allow moving N cells in a straight line
  movesPerTurn: 1,    // future: allow chaining N moves per turn
};

// ---------------------------------------------------------------------
// Global mutable game state
// ---------------------------------------------------------------------
const Game = {
  phase: "setup", // 'setup' | 'playing' | 'ended' — see file header for the flow
  mode: CONFIG.DEFAULT_MODE, // 'local2p' | 'online2p' | 'vscomputer' | 'computerself' — always set

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
  endReason: null,          // 'connection' | 'resign' | 'no-moves' | 'draw' | null
  moveLog: [],              // [{ color, from, to }, ...] for the download button

  players: {
    black: { name: "Player 1", isLocal: true },
    white: { name: "Player 2", isLocal: true },
  },
  localColor: null, // in online mode, which color this browser controls
  humanColor: "black", // in vscomputer mode, which color the human plays
  localNickname: null, // set by editing the "You" name label directly; null means "use the default"

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
  editIconBlack: document.getElementById("editIconBlack"),
  editIconWhite: document.getElementById("editIconWhite"),
  playerYouBlack: document.getElementById("playerYouBlack"),
  playerYouWhite: document.getElementById("playerYouWhite"),
  playerBadgeBlack: document.getElementById("playerBadgeBlack"),
  playerBadgeWhite: document.getElementById("playerBadgeWhite"),
  playerRowBlack: document.getElementById("playerRowBlack"),
  playerRowWhite: document.getElementById("playerRowWhite"),

  swapColorBtn: document.getElementById("swapColorBtn"),
  offerDrawBtn: document.getElementById("offerDrawBtn"),
  resignBtn: document.getElementById("resignBtn"),
  messageBox: document.getElementById("messageBox"),

  boardSvg: document.getElementById("boardSvg"),

  modeSelectBlock: document.getElementById("modeSelectBlock"),
  modeButtons: Array.from(document.querySelectorAll(".mode-btn[data-mode]")),

  onlineBlock: document.getElementById("onlineBlock"),
  createGameBtn: document.getElementById("createGameBtn"),
  joinGameBtn: document.getElementById("joinGameBtn"),
  joinCodeWrap: document.getElementById("joinCodeWrap"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  joinCodeSubmit: document.getElementById("joinCodeSubmit"),
  onlineStatus: document.getElementById("onlineStatus"),

  colorChoiceBlock: document.getElementById("colorChoiceBlock"),
  colorButtons: Array.from(document.querySelectorAll(".color-btn")),

  boardParamsBlock: document.getElementById("boardParamsBlock"),
  radiusRange: document.getElementById("radiusRange"),
  radiusValue: document.getElementById("radiusValue"),
  piecesRange: document.getElementById("piecesRange"),
  piecesValue: document.getElementById("piecesValue"),
  cpuParamsBlock: document.getElementById("cpuParamsBlock"),
  cpuTimeRange: document.getElementById("cpuTimeRange"),
  cpuTimeValue: document.getElementById("cpuTimeValue"),
  cpuDepthRange: document.getElementById("cpuDepthRange"),
  cpuDepthValue: document.getElementById("cpuDepthValue"),

  boardFlash: document.getElementById("boardFlash"),

  onboardingOverlay: document.getElementById("onboardingOverlay"),
  onboardingDontShow: document.getElementById("onboardingDontShow"),
  onboardingCloseBtn: document.getElementById("onboardingCloseBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
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

/** 'setup' (the live preview) and 'playing' both accept clicks/drags on
 *  pieces — moving a piece during 'setup' is exactly what starts the
 *  game. Only 'ended' (showing the finished board) is non-interactive. */
function isInteractivePhase() {
  return Game.phase === "setup" || Game.phase === "playing";
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
    attachHoverDwellClick(poly, k);
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

    const canDrag = isInteractivePhase() && cell.color === Game.turn && isMyTurnLocally();
    if (canDrag) {
      circle.classList.add("own-piece", "draggable");
      circle.addEventListener("pointerdown", (ev) => onPieceDragStart(ev, k));
    }
    circle.addEventListener("click", (ev) => { ev.stopPropagation(); onCellClick(k); });
    attachHoverDwellClick(circle, k);

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

    if (isInteractivePhase() && isMyTurnLocally()) {
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
  if (!isInteractivePhase() || !isMyTurnLocally()) return;
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
//
// Mouse/pen: drag starts immediately on pointerdown (no scrolling to
// conflict with on a desktop).
//
// Touch: starting the drag immediately — and locking page panning for
// it — made any touch that merely swept across a piece while scrolling
// get hijacked into a drag, which fought with the page's own scroll
// gesture (worse on a diagonal swipe, since the vertical component kept
// racing the native scroll). Instead, a touch on a piece "arms" a
// possible drag; if the finger lifts or moves more than a few pixels
// before a short hold completes, it's treated as an ordinary
// scroll/tap and nothing about page panning is touched. Only once the
// hold is confirmed does the drag actually begin — from that moment
// page panning is locked (via touch-action) until the piece is
// dropped, at which point it's unlocked immediately.

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
  if (!isInteractivePhase() || !isMyTurnLocally()) return;
  if (dragState) return; // a drag is already in progress
  const cell = Game.cells.get(key);
  if (cell.color !== Game.turn) return;

  const circle = ev.currentTarget;

  if (ev.pointerType !== "touch") {
    // mouse / pen: no page-scroll conflict, so start dragging right away
    ev.preventDefault();
    beginDrag(ev, key, circle);
    return;
  }

  armTouchDrag(ev, key, circle);
}

/** Touch only: waits for a short, still hold before treating the touch as
 *  a drag. A quick tap or a swipe that moves before the hold completes
 *  is left completely alone — the browser scrolls the page as normal,
 *  since nothing here ever called preventDefault() or touched
 *  touch-action for it. */
function armTouchDrag(ev, key, circle) {
  const pointerId = ev.pointerId;
  const startX = ev.clientX;
  const startY = ev.clientY;
  let settled = false;

  const cleanup = () => {
    settled = true;
    clearTimeout(armTimer);
    circle.removeEventListener("pointermove", onEarlyMove);
    circle.removeEventListener("pointerup", onEarlyEnd);
    circle.removeEventListener("pointercancel", onEarlyEnd);
  };

  const onEarlyMove = (mv) => {
    if (mv.pointerId !== pointerId || settled) return;
    const dx = mv.clientX - startX;
    const dy = mv.clientY - startY;
    if (Math.hypot(dx, dy) > CONFIG.TOUCH_LONG_PRESS_TOLERANCE_PX) {
      cleanup(); // moved too much before the hold completed: let it scroll
    }
  };
  const onEarlyEnd = () => cleanup(); // lifted (or interrupted) before the hold completed

  const armTimer = setTimeout(() => {
    if (settled) return;
    cleanup();
    // Hold confirmed and the finger hasn't wandered: safe to lock page
    // panning now and hand off to the normal drag flow.
    beginDrag(ev, key, circle);
  }, CONFIG.TOUCH_LONG_PRESS_MS);

  circle.addEventListener("pointermove", onEarlyMove);
  circle.addEventListener("pointerup", onEarlyEnd);
  circle.addEventListener("pointercancel", onEarlyEnd);
}

/** Shared by both entry points above: actually engages the drag. For
 *  touch, this is also the moment page panning gets locked (via
 *  touch-action on the dragged piece), released again in onUp. */
function beginDrag(ev, key, circle) {
  Game.selectedKey = key;
  applyHighlights();

  const svg = dom.boardSvg;
  circle.setPointerCapture(ev.pointerId);
  circle.classList.add("dragging");
  circle.style.touchAction = "none"; // lock page panning for the duration of this drag

  dragState = { key, circle, pointerId: ev.pointerId };

  const onMove = (mv) => {
    const p = svgUserPoint(svg, mv.clientX, mv.clientY);
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
  };

  const onUp = (up) => {
    circle.removeEventListener("pointermove", onMove);
    circle.removeEventListener("pointerup", onUp);
    circle.removeEventListener("pointercancel", onUp);
    circle.classList.remove("dragging");
    circle.style.touchAction = ""; // unlock page panning again, right away

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
  circle.addEventListener("pointercancel", onUp);
}

// =======================================================================
// Interaction: hover-to-click (desktop mouse only)
// -----------------------------------------------------------------------
// Resting the mouse over a piece or cell for a short dwell acts exactly
// like clicking it — so hovering a piece selects it, then hovering an
// adjacent cell completes the move, all without pressing a button.
// Scoped to pointerType "mouse" only: touch devices don't have a real
// hover, and this must never interfere with the touch drag logic above.
// =======================================================================

function attachHoverDwellClick(el, key) {
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };

  el.addEventListener("pointerenter", (ev) => {
    if (ev.pointerType !== "mouse") return;
    if (!isInteractivePhase() || !isMyTurnLocally()) return;
    cancel();
    timer = setTimeout(() => { timer = null; onCellClick(key); }, CONFIG.MOUSE_HOVER_MOVE_MS);
  });
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointerdown", cancel); // an actual click/drag shouldn't also fire the pending hover timer
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
  if (Game.mode === "vscomputer" || Game.mode === "computerself") {
    return Boolean(Game.players[Game.turn] && Game.players[Game.turn].isLocal);
  }
  return true; // local2p: both colors are played on this device
}

/** Applies a move to the model, re-renders, checks for a win, advances turn.
 *  If this is called while still in "setup" (the live preview), this is
 *  the move that actually starts the game — for both the mover and, via
 *  the identical "move" message, the remote peer in online play. */
function performMove(fromKey, toKey, opts = {}) {
  const { fromRemote = false } = opts;

  if (Game.phase === "setup") {
    Game.phase = "playing";
    updateSetupVisibility();
    flashBoardStart();
  }

  const fromCell = Game.cells.get(fromKey);
  const toCell = Game.cells.get(toKey);
  const color = fromCell.color;

  toCell.color = color;
  fromCell.color = null;
  Game.selectedKey = null;
  Game.lastMove = { from: fromKey, to: toKey };
  Game.moveLog.push({ color, from: fromKey, to: toKey });
  // the pie-rule swap is only ever offered on white's very first move, so a
  // black move must never cancel it — only white moving normally does.
  if (color === "white") Game.pieRuleAvailable = false;
  Game.drawOffered = null;

  if (Game.mode === "online2p" && !fromRemote) {
    sendToRemote({ type: "move", from: fromKey, to: toKey });
  }

  if (isFullyConnected(color)) {
    endGame(color, "connection"); // endGame() renders the finished board itself
    return;
  }

  // Advance the turn *before* re-rendering: renderPieces() decides which
  // pieces get drag handlers based on Game.turn, so rendering while it
  // still held the color that just moved left the wrong pieces draggable
  // (and the pieces that should now be draggable never got the handler).
  Game.turn = opponentOf(color);
  renderBoard();
  updateStatusUI();
  maybeTriggerCpuMove();
}

function endGame(winnerColor, reason) {
  cancelScheduledCpuMove();
  Game.phase = "ended";
  Game.winner = winnerColor;
  Game.endReason = reason;
  Game.lastMove = null; // the finished board doesn't need the last-move trail highlighted anymore
  updateSetupVisibility();
  renderBoard();
  updateButtonsForPhase();
  updateStatusUI();
  flashBoardEnd();
  dom.downloadBtn.disabled = false;
  showMessage("");
  scheduleEndedAutoRestart();
}

function endGameDraw() {
  cancelScheduledCpuMove();
  Game.phase = "ended";
  Game.winner = null;
  Game.endReason = "draw";
  Game.lastMove = null;
  updateSetupVisibility();
  renderBoard();
  updateButtonsForPhase();
  updateStatusUI();
  flashBoardEnd();
  dom.downloadBtn.disabled = false;
  showMessage("");
  scheduleEndedAutoRestart();
}

/** How long the finished board stays on screen before a fresh preview
 *  (using whatever mode/parameters are current at that moment — the
 *  setup controls stay live during this pause) automatically appears. */
let endedAutoRestartTimer = null;

function scheduleEndedAutoRestart() {
  cancelEndedAutoRestart();
  endedAutoRestartTimer = setTimeout(() => {
    endedAutoRestartTimer = null;
    if (Game.phase !== "ended") return; // state moved on already (mode switch, etc.)
    beginSetupPreview();
  }, CONFIG.ENDED_PAUSE_MS);
}

function cancelEndedAutoRestart() {
  if (endedAutoRestartTimer !== null) {
    clearTimeout(endedAutoRestartTimer);
    endedAutoRestartTimer = null;
  }
}

/** Brief, non-blocking glow across the board to mark that the game just
 *  ended — retriggerable, since the class is removed once the animation
 *  finishes (or after a timeout fallback, in case animationend doesn't
 *  fire for some reason). */
function flashBoardEnd() {
  const el = dom.boardFlash;
  if (!el) return;
  el.classList.remove("flashing");
  // force reflow so re-adding the class restarts the animation even if
  // the previous flash hadn't finished yet
  void el.offsetWidth;
  el.classList.add("flashing");
  const clear = () => el.classList.remove("flashing");
  el.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, 1200);
}

/** Same idea as flashBoardEnd(), but green instead of cyan, and fired the
 *  moment "setup" (the live preview) becomes "playing" — i.e. right when
 *  a game actually begins, whichever side made the first move. */
function flashBoardStart() {
  const el = dom.boardFlash;
  if (!el) return;
  el.classList.remove("flashing-start");
  void el.offsetWidth;
  el.classList.add("flashing-start");
  const clear = () => el.classList.remove("flashing-start");
  el.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, 1000);
}

// =======================================================================
// Pie rule (swap colors on white's first move)
// =======================================================================

function swapColors() {
  if (Game.phase !== "playing" || !Game.pieRuleAvailable) return;
  if (Game.turn !== "white") return;

  // The pie rule reassigns *who controls which color*, not the pieces
  // already on the board: the player who was "white" takes over the
  // black pieces/position exactly as they stand right now, and the
  // player who was "black" becomes "white" for the rest of the game.
  // The board itself (Game.cells) must NOT be touched.
  const tmp = Game.players.black;
  Game.players.black = Game.players.white;
  Game.players.white = tmp;
  if (Game.localColor) Game.localColor = opponentOf(Game.localColor);

  Game.pieRuleAvailable = false;
  // swapping takes the place of white's move, so the turn slot that's
  // next is still "white" — now played by whoever was just reassigned
  // to that seat (the original black player).
  Game.turn = "white";

  if (Game.mode === "online2p" && Game.isHost) {
    sendToRemote({ type: "swap" });
  }

  renderBoard();
  updateStatusUI();
  updatePlayersUI();
  maybeTriggerCpuMove();
}

// =======================================================================
// Resign / draw
// =======================================================================

function resign() {
  if (Game.phase !== "playing") return;
  if (!confirm("Resign this game?")) return;
  cancelScheduledCpuMove();
  let resigningColor;
  if (Game.mode === "online2p") {
    resigningColor = Game.localColor;
  } else if (Game.mode === "vscomputer") {
    // find whichever color the human currently controls (a pie-rule swap
    // may have changed this since the game started), and resign as them
    // regardless of whose turn it currently is
    resigningColor = Game.players.black.isLocal ? "black" : "white";
  } else {
    resigningColor = isMyTurnLocally() ? Game.turn : opponentOf(Game.turn);
  }
  if (Game.mode === "online2p") {
    sendToRemote({ type: "resign", color: resigningColor });
  }
  endGame(opponentOf(resigningColor), "resign");
}

function offerDraw() {
  if (Game.phase !== "playing") return;
  if (Game.mode === "online2p") {
    Game.drawOffered = Game.localColor;
    sendToRemote({ type: "draw-offer" });
    showMessage("Draw offer sent. Waiting for opponent...");
  } else if (Game.mode === "vscomputer" || Game.mode === "computerself") {
    return; // draw offers don't apply against/between computer players
  } else {
    if (confirm("Both players agree to a draw?")) {
      endGameDraw();
    }
  }
}

// =======================================================================
// Computer play (vs computer / computer vs computer)
// -----------------------------------------------------------------------
// The alpha-beta search normally runs off the main thread in a Web
// Worker (aistrategies.js doubles as the worker script — see its bottom
// section), so a slow/deep search never freezes the page. Some
// environments block Workers entirely — notably opening the page via
// `file://` instead of `http(s)://`, which several browsers refuse for
// security reasons (same-origin restrictions don't apply cleanly to
// local files). When that happens this falls back to running the exact
// same search synchronously on the main thread instead of leaving the
// CPU stuck forever — the trade-off is that the tab will briefly stop
// responding while it thinks, same as before Workers were added. See
// the readme for how to serve the page so that trade-off never applies.
// =======================================================================

let cpuWorker = null;             // the Worker instance, created lazily
let cpuWorkerUnavailable = false; // set once Workers are known not to work
                                   // here, so we stop retrying them
let cpuRequestId = 0;             // bumped on every dispatch/cancel so
                                   // stale replies (e.g. after New game)
                                   // are detected and ignored
let cpuPendingRequest = null;     // { requestId, color, state, options }
                                   // for the outstanding request, kept
                                   // around so a Worker failure can be
                                   // retried locally without recomputing
let cpuThinkDelayId = null;       // setTimeout id for the pre-dispatch pause

function ensureCpuWorker() {
  if (cpuWorkerUnavailable) return null;
  if (!cpuWorker) {
    try {
      cpuWorker = new Worker("aistrategies.js");
      cpuWorker.onmessage = onCpuWorkerMessage;
      cpuWorker.onerror = onCpuWorkerError;
    } catch (err) {
      console.warn("Web Worker unavailable, falling back to main-thread CPU search:", err);
      cpuWorkerUnavailable = true;
      cpuWorker = null;
      return null;
    }
  }
  return cpuWorker;
}

function onCpuWorkerMessage(e) {
  const { requestId, ok, move, error } = e.data || {};
  if (!cpuPendingRequest || requestId !== cpuPendingRequest.requestId) return; // stale reply
  const color = cpuPendingRequest.color;
  cpuPendingRequest = null;

  if (!ok) {
    console.error("CPU search failed:", error);
    showMessage("The computer player hit an error \u2014 check the console.");
    return;
  }
  applyCpuResult(color, move);
}

function onCpuWorkerError(err) {
  // The Worker script itself failed to load/run (e.g. blocked under
  // file://, or a restrictive Content-Security-Policy). Stop trying to
  // use Workers for the rest of the session and, if a request was in
  // flight, run it locally instead of leaving the CPU stuck.
  console.warn("Web Worker failed \u2014 blocked by the browser (often happens under file://); falling back to running the search on the main thread. Serve the page over http(s) to avoid this.", err);
  cpuWorkerUnavailable = true;
  if (cpuWorker) {
    try { cpuWorker.terminate(); } catch (e) { /* already gone */ }
    cpuWorker = null;
  }
  if (cpuPendingRequest) {
    runCpuSearchLocally(cpuPendingRequest);
  }
}

/** Fallback path: runs AiStrategies.pickMove() directly (aistrategies.js
 *  is already loaded on the main thread via <script>), used only when
 *  Web Workers aren't available. Freezes the tab for up to the chosen
 *  think-time budget, same as a build with no Worker support at all. */
function runCpuSearchLocally(req) {
  showMessage(`${Game.players[req.color].name} is thinking... (running locally \u2014 serve over http(s) for a smoother experience)`);
  // brief delay so the message above actually paints before the
  // synchronous, blocking search starts
  setTimeout(() => {
    if (!cpuPendingRequest || req.requestId !== cpuPendingRequest.requestId) return;
    if (Game.phase !== "playing" || Game.turn !== req.color) return;
    cpuPendingRequest = null;
    try {
      const result = AiStrategies.pickMove(req.state, req.options);
      applyCpuResult(req.color, result.move);
    } catch (err) {
      console.error("CPU local search failed:", err);
      showMessage("The computer player hit an error \u2014 check the console.");
    }
  }, 30);
}

/** Shared by both the Worker and local-fallback paths once a move (or
 *  lack thereof) has actually been decided. */
function applyCpuResult(color, move) {
  if (Game.phase !== "playing" || Game.turn !== color) return; // state moved on
  if (move) {
    performMove(move.from, move.to);
  } else {
    // no legal move for this color (shouldn't normally happen on a
    // freshly-generated board, but handle it rather than freezing)
    endGame(opponentOf(color), "no-moves");
  }
}

/** Stops any pending or in-flight CPU move: cancels the pre-dispatch
 *  delay, drops the outstanding request (so a late reply is ignored),
 *  and terminates the worker so an actually-running search stops
 *  burning CPU right away. Used whenever the game state is reset or
 *  ended out from under a scheduled move (new game, resign, back to
 *  mode select, etc.). A fresh worker is created on the next request
 *  (unless Workers were already found to be unavailable this session). */
function cancelScheduledCpuMove() {
  if (cpuThinkDelayId !== null) {
    clearTimeout(cpuThinkDelayId);
    cpuThinkDelayId = null;
  }
  cpuRequestId += 1;
  cpuPendingRequest = null;
  if (cpuWorker) {
    cpuWorker.terminate();
    cpuWorker = null;
  }
}

/** Call after any turn change: schedules a CPU move if the color now on
 *  the move is computer-controlled. No-op for human-controlled turns or
 *  outside vscomputer/computerself. */
function maybeTriggerCpuMove() {
  if (Game.phase !== "playing") return;
  if (Game.mode !== "vscomputer" && Game.mode !== "computerself") return;
  if (Game.players[Game.turn] && Game.players[Game.turn].isLocal) return;
  scheduleCpuMove();
}

function scheduleCpuMove() {
  const color = Game.turn;
  showMessage(`${Game.players[color].name} is thinking...`);

  // small delay so the "thinking" message paints and moves don't feel
  // instantaneous/robotic; the actual search then runs in the worker
  // (off the main thread), so this is purely cosmetic pacing
  cpuThinkDelayId = setTimeout(() => {
    cpuThinkDelayId = null;
    // guard: game state may have moved on while we were waiting
    // (new game started, resign, mode switch, etc.)
    if (Game.phase !== "playing" || Game.turn !== color) return;
    if (Game.players[color] && Game.players[color].isLocal) return;

    const maxDepth = Number(dom.cpuDepthRange.value);
    const maxTimeSeconds = Number(dom.cpuTimeRange.value);
    const state = { cells: Game.cells, neighborKeys: Game.neighborKeys, color };

    cpuRequestId += 1;
    const req = { requestId: cpuRequestId, color, state, options: { maxDepth, maxTimeSeconds } };
    cpuPendingRequest = req;

    const worker = ensureCpuWorker();
    if (!worker) {
      runCpuSearchLocally(req);
      return;
    }
    try {
      worker.postMessage({ requestId: req.requestId, state: req.state, options: req.options });
    } catch (err) {
      console.warn("Failed to dispatch to CPU worker, falling back to main thread:", err);
      cpuWorkerUnavailable = true;
      runCpuSearchLocally(req);
    }
  }, 350);
}

// =======================================================================
// UI state / phase management
// =======================================================================

/** Shows/hides the setup controls based on the current mode. Board
 *  radius/pieces and the mode buttons are always visible, in a fixed
 *  position, in every phase — including while a game is being played,
 *  so the player never loses access to them (e.g. while the CPU is
 *  thinking). Changing any of them mid-game asks for confirmation
 *  first — see the confirmSettingChange() helper and each control's
 *  listeners below. Mode-specific blocks (online connection, nickname,
 *  CPU search settings, color choice) show/hide purely based on the
 *  current mode, in every phase, for the same reason. */
function updateSetupVisibility() {
  const isCpuMode = Game.mode === "vscomputer" || Game.mode === "computerself";
  const guestOnline = Game.mode === "online2p" && !Game.isHost;

  dom.onlineBlock.hidden = Game.mode !== "online2p";
  dom.colorChoiceBlock.hidden = Game.mode !== "vscomputer";
  dom.cpuParamsBlock.hidden = !isCpuMode;

  // a guest doesn't control the host's board — visible (fixed position),
  // just inert
  dom.radiusRange.disabled = guestOnline;
  dom.piecesRange.disabled = guestOnline;

  updateButtonsForPhase();
}

function updateButtonsForPhase() {
  const playing = Game.phase === "playing";
  dom.swapColorBtn.disabled = !(playing && Game.pieRuleAvailable && Game.turn === "white" && isMyTurnLocally());
  dom.offerDrawBtn.disabled = !playing || Game.mode === "vscomputer" || Game.mode === "computerself";
  dom.resignBtn.disabled = !playing || Game.mode === "computerself";
}

function updateStatusUI() {
  const ind = dom.turnIndicator;
  ind.classList.remove("turn-black", "turn-white", "turn-over");
  if (Game.phase === "setup" || Game.phase === "playing") {
    ind.hidden = false;
    const name = Game.players[Game.turn].name;
    ind.textContent = `${name.toUpperCase()} TO MOVE (${Game.turn.toUpperCase()})`;
    ind.classList.add(Game.turn === "black" ? "turn-black" : "turn-white");
  } else {
    ind.hidden = true;
    ind.textContent = "";
  }
  updatePlayersUI();
  updateButtonsForPhase();
}

function updatePlayersUI() {
  if (document.activeElement !== dom.playerNameBlack) dom.playerNameBlack.textContent = Game.players.black.name;
  if (document.activeElement !== dom.playerNameWhite) dom.playerNameWhite.textContent = Game.players.white.name;
  dom.playerYouBlack.textContent = Game.mode === "online2p" && Game.localColor === "black" ? "(you)" : "";
  dom.playerYouWhite.textContent = Game.mode === "online2p" && Game.localColor === "white" ? "(you)" : "";
  dom.playerRowBlack.classList.toggle("active-turn", Game.phase === "playing" && Game.turn === "black");
  dom.playerRowWhite.classList.toggle("active-turn", Game.phase === "playing" && Game.turn === "white");

  const blackWon = Game.phase === "ended" && Game.winner === "black";
  const whiteWon = Game.phase === "ended" && Game.winner === "white";
  const isDraw = Game.phase === "ended" && Game.winner === null;
  dom.playerRowBlack.classList.toggle("winner", blackWon);
  dom.playerRowWhite.classList.toggle("winner", whiteWon);
  dom.playerBadgeBlack.textContent = blackWon ? "\u{1F3C6}" : isDraw ? "Draw" : "";
  dom.playerBadgeWhite.textContent = whiteWon ? "\u{1F3C6}" : isDraw ? "Draw" : "";
  dom.playerBadgeBlack.title = blackWon ? "Winner" : "";
  dom.playerBadgeWhite.title = whiteWon ? "Winner" : "";

  updateNameEditability();
}

/** A player's own name label (next to their piece color) doubles as the
 *  nickname field: it's directly editable, but only for your own row,
 *  and only before the game actually starts — there's no separate
 *  "your nickname" input anymore. */
function updateNameEditability() {
  for (const color of ["black", "white"]) {
    const el = color === "black" ? dom.playerNameBlack : dom.playerNameWhite;
    const icon = color === "black" ? dom.editIconBlack : dom.editIconWhite;
    const editable = Game.phase === "setup"
      && Boolean(Game.players[color] && Game.players[color].isLocal)
      && (Game.mode === "online2p" || Game.mode === "vscomputer");
    icon.hidden = !editable;
    if (editable) {
      if (el.getAttribute("contenteditable") !== "true") el.setAttribute("contenteditable", "true");
      el.title = "Click to rename";
    } else {
      if (el.hasAttribute("contenteditable")) {
        if (document.activeElement === el) el.blur();
        el.removeAttribute("contenteditable");
      }
      el.removeAttribute("title");
    }
  }
}

/** Wires the actual click-to-edit behavior for one player-name label:
 *  select-all on focus (so typing replaces the placeholder immediately),
 *  Enter commits, Escape reverts, and losing focus either way commits
 *  whatever's there (falling back to "You" if left empty). */
function wireEditableName(el, color) {
  let previousText = "";

  el.addEventListener("focus", () => {
    if (el.getAttribute("contenteditable") !== "true") return;
    previousText = el.textContent;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); el.blur(); }
    else if (ev.key === "Escape") { ev.preventDefault(); el.textContent = previousText; el.blur(); }
  });

  el.addEventListener("blur", () => {
    if (el.getAttribute("contenteditable") !== "true") return;
    const nick = el.textContent.replace(/\s+/g, " ").trim().slice(0, 18);
    const finalName = nick || "You";
    el.textContent = finalName;
    Game.localNickname = finalName === "You" ? null : finalName;
    if (Game.players[color]) Game.players[color].name = finalName;
    if (Game.mode === "online2p" && Game.conn && Game.conn.open) {
      sendToRemote({ type: "nickname", color, name: finalName });
    }
    updatePlayersUI();
  });
}

wireEditableName(dom.playerNameBlack, "black");
wireEditableName(dom.playerNameWhite, "white");
dom.editIconBlack.addEventListener("click", () => dom.playerNameBlack.focus());
dom.editIconWhite.addEventListener("click", () => dom.playerNameWhite.focus());

// =======================================================================
// Setup panel wiring
// =======================================================================

function refreshPieceRangeUI(radius = Game.radius) {
  const { min, max } = pieceRangeForRadius(radius);
  dom.piecesRange.min = String(min);
  dom.piecesRange.max = String(max);
  const mid = Math.round((min + max) / 2);
  dom.piecesRange.value = String(Math.min(max, Math.max(min, mid)));
  dom.piecesValue.textContent = `${dom.piecesRange.value} (${min}-${max})`;
}

/** Used by every control that defines the board itself (radius, pieces,
 *  color choice) when changed while a game is in progress: asks whether
 *  to abandon the current game and start a fresh one with the new
 *  value. Returns true if the change should go ahead (not playing, or
 *  confirmed); false if the caller must revert its control back to the
 *  last committed value. CPU think-time/depth deliberately skip this —
 *  they don't affect the board, so they just apply to the CPU's next
 *  move without needing to restart anything. */
function confirmSettingChange() {
  if (Game.phase !== "playing") return true;
  return confirm("End the current game and start a new one with these settings?");
}

dom.radiusRange.addEventListener("input", () => {
  // live label/bounds feedback while dragging, even before it's
  // committed (during play, committing only happens on release — see
  // the "change" listener below)
  dom.radiusValue.textContent = dom.radiusRange.value;
  refreshPieceRangeUI(Number(dom.radiusRange.value));
  if (Game.phase !== "playing") beginSetupPreview();
});
dom.radiusRange.addEventListener("change", () => {
  if (Game.phase !== "playing") return; // already applied live above
  if (confirmSettingChange()) {
    beginSetupPreview();
  } else {
    dom.radiusRange.value = String(Game.radius);
    dom.radiusValue.textContent = String(Game.radius);
    refreshPieceRangeUI(Game.radius);
  }
});
dom.piecesRange.addEventListener("input", () => {
  const { min, max } = pieceRangeForRadius(Game.phase === "playing" ? Game.radius : Number(dom.radiusRange.value));
  dom.piecesValue.textContent = `${dom.piecesRange.value} (${min}-${max})`;
  if (Game.phase !== "playing") beginSetupPreview();
});
dom.piecesRange.addEventListener("change", () => {
  if (Game.phase !== "playing") return;
  if (confirmSettingChange()) {
    beginSetupPreview();
  } else {
    dom.piecesRange.value = String(Game.piecesPerColor);
    const { min, max } = pieceRangeForRadius(Game.radius);
    dom.piecesValue.textContent = `${dom.piecesRange.value} (${min}-${max})`;
  }
});

// CPU think-time/depth don't define the board, so they apply live to the
// CPU's *next* move — no need to interrupt or restart the game for these.
dom.cpuTimeRange.addEventListener("input", () => {
  dom.cpuTimeValue.textContent = dom.cpuTimeRange.value;
});
dom.cpuDepthRange.addEventListener("input", () => {
  dom.cpuDepthValue.textContent = dom.cpuDepthRange.value;
});

dom.modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    selectMode(btn.dataset.mode);
  });
});

/** Switches to (or restarts) a mode: abandons any game in progress (with
 *  confirmation), tears down any online connection, and immediately
 *  shows a fresh live preview for the chosen mode. Mode buttons are
 *  always visible/clickable, including the one already active — clicking
 *  it again is how you get a fresh board without changing anything. */
function selectMode(mode) {
  if (!confirmSettingChange()) {
    syncModeButtonsSelection();
    return;
  }

  cancelScheduledCpuMove();
  cancelEndedAutoRestart();
  teardownOnline();

  Game.mode = mode;
  Game.isHost = mode === "online2p" ? true : Game.isHost; // default assumption until join overrides
  Game.gameId = null;
  dom.gameIdValue.textContent = "\u2014";
  dom.copyLinkBtn.disabled = true;
  dom.onlineStatus.textContent = "";
  dom.onlineStatus.className = "online-status";
  dom.joinCodeWrap.hidden = true;

  syncModeButtonsSelection();
  beginSetupPreview();
}

function syncModeButtonsSelection() {
  dom.modeButtons.forEach((b) => b.classList.toggle("selected", b.dataset.mode === Game.mode));
}

dom.colorButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.color === Game.humanColor) return; // no actual change
    if (!confirmSettingChange()) {
      syncColorButtonsSelection();
      return;
    }
    Game.humanColor = btn.dataset.color;
    syncColorButtonsSelection();
    if (Game.mode === "vscomputer") beginSetupPreview();
  });
});

function syncColorButtonsSelection() {
  dom.colorButtons.forEach((b) => b.classList.toggle("selected", b.dataset.color === Game.humanColor));
}

dom.swapColorBtn.addEventListener("click", swapColors);
dom.offerDrawBtn.addEventListener("click", offerDraw);
dom.resignBtn.addEventListener("click", resign);

// =======================================================================
// The live preview / game start
// -----------------------------------------------------------------------
// There's no explicit "Start" step: (re)building the board here is what
// "always shows the current configuration" means, and the game actually
// begins the moment a piece moves (see performMove()) — except when the
// color to move is computer-controlled, in which case there's no human
// gesture to wait for and play begins immediately (maybeAutoStartFromSetup).
// =======================================================================

function beginSetupPreview() {
  cancelScheduledCpuMove();
  cancelEndedAutoRestart();
  cancelAutoStartGrace();

  Game.phase = "setup";
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
  Game.endReason = null;
  Game.drawOffered = null;
  Game.moveLog = [];
  if (Game.mode !== "online2p") Game.gameId = randomGameId(); // online2p keeps its room code, if any

  assignPreviewPlayers();
  syncColorButtonsSelection();

  dom.gameIdValue.textContent = Game.gameId || "\u2014";
  dom.copyLinkBtn.disabled = !Game.gameId;
  dom.downloadBtn.disabled = true;

  updateSetupVisibility();
  renderBoard();
  updateStatusUI();
  showMessage(setupMessageForMode());

  if (Game.mode === "online2p" && Game.isHost) broadcastPreview();

  maybeAutoStartFromSetup();
}

/** Fills in Game.players for whatever the current mode is. Re-run every
 *  time the preview regenerates, so nickname/color-choice edits and
 *  (for online play) newly-known opponent names all stay reflected. */
function assignPreviewPlayers() {
  if (Game.mode === "local2p") {
    Game.players.black = { name: "Player 1", isLocal: true };
    Game.players.white = { name: "Player 2", isLocal: true };
  } else if (Game.mode === "online2p") {
    if (Game.localColor) {
      Game.players[Game.localColor] = { name: Game.localNickname || "You", isLocal: true };
      const other = opponentOf(Game.localColor);
      if (!Game.players[other] || Game.players[other].isLocal) {
        Game.players[other] = { name: "Waiting\u2026", isLocal: false };
      }
    } else {
      Game.players.black = { name: Game.localNickname || "You", isLocal: true };
      Game.players.white = { name: "Waiting\u2026", isLocal: false };
    }
  } else if (Game.mode === "vscomputer") {
    const human = Game.humanColor || "black";
    const cpu = opponentOf(human);
    Game.players[human] = { name: Game.localNickname || "You", isLocal: true };
    Game.players[cpu] = { name: "CPU", isLocal: false };
  } else if (Game.mode === "computerself") {
    Game.players.black = { name: "CPU \u00b7 Black", isLocal: false };
    Game.players.white = { name: "CPU \u00b7 White", isLocal: false };
  }
}

function setupMessageForMode() {
  if (Game.mode === "local2p") {
    return "Move a piece to begin \u2014 black moves first. White may swap colors instead of moving, on their first turn only.";
  }
  if (Game.mode === "online2p") {
    if (!Game.conn || !Game.conn.open) return "Create a game to host, or join one with a code.";
    return Game.isHost ? "Move a piece to begin." : "Waiting for the host to move first.";
  }
  if (Game.mode === "vscomputer") return `You are playing ${Game.humanColor}. Move a piece to begin.`;
  if (Game.mode === "computerself") return "Two computer players will begin automatically.";
  return "";
}

/** If the color due to move first is computer-controlled, there's no
 *  human move to wait for indefinitely. "Computer vs computer" begins
 *  immediately — nothing for a human to configure once it's running.
 *  "Vs computer" with the CPU moving first (human chose white) instead
 *  waits a short grace period, controls fully live the whole time, so
 *  there's a real chance to change something before it commits — this
 *  also fixes the CPU-first case never showing its controls again. */
let autoStartGraceTimer = null;

function cancelAutoStartGrace() {
  if (autoStartGraceTimer !== null) {
    clearTimeout(autoStartGraceTimer);
    autoStartGraceTimer = null;
  }
}

function maybeAutoStartFromSetup() {
  cancelAutoStartGrace();
  if (Game.phase !== "setup") return;
  if (Game.mode !== "vscomputer" && Game.mode !== "computerself") return;
  const mover = Game.players[Game.turn];
  if (!mover || mover.isLocal) return; // a human moves first — just wait for them

  if (Game.mode === "computerself") {
    commitPlayingAndTriggerCpu();
    return;
  }

  const graceSeconds = Math.round(CONFIG.CPU_FIRST_MOVE_GRACE_MS / 1000);
  showMessage(`The CPU moves first in ${graceSeconds}s\u2026 change any setting above to adjust before it does.`);
  autoStartGraceTimer = setTimeout(() => {
    autoStartGraceTimer = null;
    if (Game.phase !== "setup") return; // state moved on already (mode/param change, etc.)
    commitPlayingAndTriggerCpu();
  }, CONFIG.CPU_FIRST_MOVE_GRACE_MS);
}

function commitPlayingAndTriggerCpu() {
  Game.phase = "playing";
  updateSetupVisibility();
  updateStatusUI();
  flashBoardStart();
  maybeTriggerCpuMove();
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
      ? "Opponent connected."
      : "Connected. Waiting for the host's board.";
    dom.onlineStatus.className = "online-status ok";
    const myName = Game.localNickname || "You";
    sendToRemote({ type: "nickname", color: Game.localColor, name: myName });
    if (Game.isHost) broadcastPreview();
    updateStatusUI();
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

/** Host only: sends the current live preview board (and player names) to
 *  the connected guest, so their screen matches — sent once on connect,
 *  and again any time the host changes radius/pieces while still in
 *  "setup". The actual game start is a "move" message, same as any other
 *  move, once the host (always black, moving first) actually moves. */
function broadcastPreview() {
  sendToRemote({
    type: "preview",
    radius: Game.radius,
    piecesPerColor: Game.piecesPerColor,
    cells: Array.from(Game.cells.values()),
    players: Game.players,
  });
}

function handleRemoteMessage(msg) {
  switch (msg.type) {
    case "preview": {
      Game.radius = msg.radius;
      Game.piecesPerColor = msg.piecesPerColor;
      const cells = new Map();
      for (const c of msg.cells) cells.set(HexGeometry.key(c.q, c.r), { q: c.q, r: c.r, color: c.color });
      Game.cells = cells;
      Game.neighborKeys = BoardInit.buildNeighborMap(cells);
      Game.turn = "black";
      Game.pieRuleAvailable = true;
      Game.selectedKey = null;
      Game.lastMove = null;
      Game.winner = null;
      Game.endReason = null;
      // Only adopt the sender's info for the *other* color. Never let an
      // incoming preview clobber our own name/isLocal — msg.players was
      // built from the sender's point of view, where our color is just
      // a "Waiting..." placeholder (a race: they broadcast before
      // hearing our own nickname), so blindly replacing Game.players
      // wholesale wiped out our own chosen name and made it stop being
      // editable (isLocal flipped to false).
      const otherColor = opponentOf(Game.localColor);
      if (msg.players && msg.players[otherColor]) {
        Game.players[otherColor] = { name: msg.players[otherColor].name, isLocal: false };
      }
      Game.phase = "setup";
      updateSetupVisibility();
      renderBoard();
      updateStatusUI();
      showMessage(setupMessageForMode());
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
      Game.pieRuleAvailable = false;
      Game.turn = "white";
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
  if (!confirmSettingChange()) return;
  teardownOnline();
  Game.isHost = true;
  Game.localColor = "black";
  const id = "selfo-" + randomGameId();
  Game.gameId = id.replace("selfo-", "");
  beginSetupPreview(); // Game.gameId is preserved (online2p keeps its own id) — this just refreshes players/message
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
  if (!confirmSettingChange()) return;
  teardownOnline();
  Game.isHost = false;
  Game.localColor = "white";
  Game.gameId = code;
  beginSetupPreview(); // a local placeholder, replaced the moment the host's "preview" message arrives
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

// =======================================================================
// Download finished game summary
// =======================================================================

dom.downloadBtn.addEventListener("click", () => {
  if (dom.downloadBtn.disabled || Game.phase !== "ended") return;

  const summary = {
    game: "Selfo",
    gameId: Game.gameId,
    mode: Game.mode,
    radius: Game.radius,
    piecesPerColor: Game.piecesPerColor,
    players: {
      black: Game.players.black.name,
      white: Game.players.white.name,
    },
    result: Game.winner ? `${Game.winner} wins` : "draw",
    endReason: Game.endReason,
    moveCount: Game.moveLog.length,
    moves: Game.moveLog,
    finishedAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `selfo-game-${Game.gameId || "summary"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// =======================================================================
// Boot
// =======================================================================

function boot() {
  resetAllRangeInputs();
  Game.mode = CONFIG.DEFAULT_MODE;
  syncModeButtonsSelection();
  beginSetupPreview();

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

/** Forces every slider's actual DOM value (not just its number label) back
 *  to its intended default, and syncs the label from that same value.
 *
 * Why this is needed: browsers can restore <input type="range"> values
 * left over from a previous visit/reload (form/session restoration),
 * independently of the page's own JS state. Without this, the on-screen
 * number (set from a hardcoded JS default) could disagree with the
 * slider's real, browser-restored position — showing e.g. "3" while the
 * thumb actually sits at 4, which then visibly "jumps" the moment the
 * user first touches it. Setting both the DOM value and the label here,
 * together, from the same source, guarantees they start in sync. */
function resetAllRangeInputs() {
  Game.radius = CONFIG.DEFAULT_RADIUS;
  dom.radiusRange.value = String(Game.radius);
  dom.radiusValue.textContent = String(Game.radius);
  refreshPieceRangeUI(); // also forces piecesRange's value + label together, from Game.radius

  dom.cpuTimeRange.value = String(CONFIG.DEFAULT_CPU_TIME_SECONDS);
  dom.cpuTimeValue.textContent = String(CONFIG.DEFAULT_CPU_TIME_SECONDS);
  dom.cpuDepthRange.value = String(CONFIG.DEFAULT_CPU_DEPTH);
  dom.cpuDepthValue.textContent = String(CONFIG.DEFAULT_CPU_DEPTH);
}

boot();