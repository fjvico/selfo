"use strict";

/**
 * AiStrategies (WebAssembly-backed)
 * ---------------------------------
 * Drop-in replacement for the original aistrategies.js. Same public API
 * (AiStrategies.strategies / activeStrategy / pickMove / getLegalMoves /
 * applyMove / isGroupFullyConnected / evaluatePosition), same state and
 * options shapes, same return shape, same Web Worker message protocol.
 * Both strategies (minimaxAlphaBetaID and the slower minimaxAlphaBetaCloning
 * baseline) are compiled from src/engine.c; the search — move generation,
 * legality incl. the "No enclosure" rule, make/unmake, Zobrist hashing,
 * transposition table, iterative deepening, mate-distance scoring and the
 * lost-position tie-break — runs entirely inside WebAssembly. JS only
 * marshals the board in and the chosen move out.
 *
 * State shape (unchanged):
 *   { cells: Map<key,{q,r,color}>, neighborKeys: Map<key,key[]>, color, enclosureAllowed }
 * Options (unchanged): { maxDepth, maxTimeSeconds }
 *
 * Score scale: the wasm engine works in half-points (see engine.c); this file
 * converts back, so returned scores are the same numbers as before.
 *
 * Loading: the worker entry at the bottom pulls in wasmengine.js itself (see
 * importScripts). On the page, include wasmengine.js BEFORE this file.
 * Main-thread caveat: in Chrome, `await WasmEngine.ready` once before the
 * first call (see wasmengine.js). Inside a Worker nothing extra is needed.
 */
if (typeof importScripts === "function") {
  importScripts("wasmengine.js");
}

const AiStrategies = (() => {

  const strategies = {};

  function otherColor(color) {
    return color === "black" ? "white" : "black";
  }

  // -----------------------------------------------------------------------
  // Zobrist keys. Random 32-bit ints per (cell key, color), generated lazily
  // and kept for the page session, exactly like the JS version, then handed
  // to wasm per search. `testHooks` lets a test harness substitute
  // deterministic values so two engines can be compared node-for-node.
  // -----------------------------------------------------------------------
  const testHooks = { zobrist: null, sideKey: null };
  const zobristTable = new Map();
  function rand32() { return (Math.random() * 0x100000000) | 0; }
  const RANDOM_SIDE_KEY = rand32() || 1;
  function zobristFor(key) {
    if (testHooks.zobrist) return { black: testHooks.zobrist(key, "black") | 0, white: testHooks.zobrist(key, "white") | 0 };
    let entry = zobristTable.get(key);
    if (!entry) { entry = { black: rand32(), white: rand32() }; zobristTable.set(key, entry); }
    return entry;
  }

  /** Copies the board + hashing keys into wasm. */
  function load(state) {
    const ex = WasmEngine.ex();
    const board = WasmEngine.uploadBoard(state.cells, state.neighborKeys);
    for (let i = 0; i < board.keys.length; i++) {
      const z = zobristFor(board.keys[i]);
      ex.set_zobrist(i, z.black, z.white);
    }
    ex.set_side_key(testHooks.sideKey !== null ? testHooks.sideKey | 0 : RANDOM_SIDE_KEY);
    return board;
  }

  // Same option handling as the JS engine (0/undefined = uncapped, 1-5 = cap; >= 200 ms budget).
  function searchLimits(options, noDepthCap) {
    const requestedDepth = options.maxDepth;
    const hasDepthCap = Number.isFinite(requestedDepth) && requestedDepth > 0;
    const maxDepth = hasDepthCap ? Math.max(1, Math.min(5, requestedDepth)) : noDepthCap;
    const maxTimeMs = Math.max(200, (options.maxTimeSeconds ?? 5) * 1000);
    return { maxDepth: Math.floor(maxDepth), maxTimeMs };
  }

  function readMove(ex, keys) {
    const f = ex.ai_res_from();
    return f < 0 ? null : { from: keys[f], to: keys[ex.ai_res_to()] };
  }

  const WIN = 10000;
  const MATE_THRESHOLD = WIN - 40; // NO_DEPTH_CAP_LIMIT

  function minimaxAlphaBetaID(state, options = {}) {
    const ex = WasmEngine.ex();
    const { keys } = load(state);
    const { maxDepth, maxTimeMs } = searchLimits(options, ex.ai_no_depth_cap());
    const colorCode = WasmEngine.colorCode(state.color);
    ex.ai_search_id(colorCode, state.enclosureAllowed ? 1 : 0, maxDepth, maxTimeMs);
    const score = ex.ai_res_score2() / 2;
    const magnitude = Math.abs(score);
    const mateDistance = magnitude >= MATE_THRESHOLD ? WIN - magnitude : null;
    return {
      move: readMove(ex, keys),
      score,
      nodesEvaluated: ex.ai_res_nodes(),
      depthReached: ex.ai_res_depth(),
      forcedWinInPlies: mateDistance !== null && score > 0 ? mateDistance : null,
      forcedLossInPlies: mateDistance !== null && score < 0 ? mateDistance : null,
    };
  }
  strategies.minimaxAlphaBetaID = minimaxAlphaBetaID;

  /** Slower pre-optimization baseline, kept for A/B comparison (no mate-distance fields, as before). */
  function minimaxAlphaBetaCloning(state, options = {}) {
    const ex = WasmEngine.ex();
    const { keys } = load(state);
    const { maxDepth, maxTimeMs } = searchLimits(options, ex.ai_no_depth_cap());
    ex.ai_search_clone(WasmEngine.colorCode(state.color), state.enclosureAllowed ? 1 : 0, maxDepth, maxTimeMs);
    return {
      move: readMove(ex, keys),
      score: ex.ai_res_score2() / 2,
      nodesEvaluated: ex.ai_res_nodes(),
      depthReached: ex.ai_res_depth(),
    };
  }
  strategies.minimaxAlphaBetaCloning = minimaxAlphaBetaCloning;

  const activeStrategy = "minimaxAlphaBetaID";

  /** Pick a move using the named strategy (defaults to the active one). */
  function pickMove(state, options, strategyName = activeStrategy) {
    const strategy = strategies[strategyName];
    if (!strategy) throw new Error(`Unknown AI strategy: "${strategyName}"`);
    return strategy(state, options);
  }

  // ---- small public helpers (same behavior as before) ----------------------

  /** All legal moves for `color`, in generation order (Map order of pieces, then neighbor order). */
  function getLegalMoves(cells, neighborKeys, color, enclosureAllowed) {
    const ex = WasmEngine.ex();
    const { keys } = WasmEngine.uploadBoard(cells, neighborKeys);
    const n = ex.ai_gen_moves(WasmEngine.colorCode(color), enclosureAllowed ? 1 : 0);
    const moves = new Array(n);
    for (let i = 0; i < n; i++) moves[i] = { from: keys[ex.ai_move_from(i)], to: keys[ex.ai_move_to(i)] };
    return moves;
  }

  /** Returns a *new* board with the move applied (does not mutate input). */
  function applyMove(cells, from, to) {
    const next = new Map();
    for (const [k, cell] of cells) next.set(k, { q: cell.q, r: cell.r, color: cell.color });
    const moving = next.get(from);
    next.get(to).color = moving.color;
    moving.color = null;
    return next;
  }

  /** True if every piece of `color` belongs to a single connected group (0 pieces -> false). */
  function isGroupFullyConnected(cells, neighborKeys, color) {
    WasmEngine.uploadBoard(cells, neighborKeys);
    return WasmEngine.ex().ai_connected(WasmEngine.colorCode(color)) === 1;
  }

  /** Own score minus opponent's (positive favors `color`). */
  function evaluatePosition(cells, neighborKeys, color, opponentColor) {
    const ex = WasmEngine.ex();
    WasmEngine.uploadBoard(cells, neighborKeys);
    return (ex.ai_color_score2(WasmEngine.colorCode(color)) - ex.ai_color_score2(WasmEngine.colorCode(opponentColor))) / 2;
  }

  return {
    strategies,
    activeStrategy,
    pickMove,
    getLegalMoves,
    applyMove,
    isGroupFullyConnected,
    evaluatePosition,
    testHooks,
  };
})();

// =========================================================================
// Worker entry point — same message protocol as the original aistrategies.js:
//   in  -> { requestId, state: { cells, neighborKeys, color, enclosureAllowed }, options, strategyName }
//   out -> { requestId, ok: true, move, score, nodesEvaluated, depthReached,
//            forcedWinInPlies, forcedLossInPlies }
//        | { requestId, ok: false, error }
// =========================================================================
if (typeof importScripts === "function") {
  self.onmessage = function (e) {
    const { requestId, state, options, strategyName } = e.data || {};
    WasmEngine.ready.then(() => {
      try {
        const result = AiStrategies.pickMove(state, options, strategyName);
        self.postMessage({
          requestId,
          ok: true,
          move: result.move,
          score: result.score,
          nodesEvaluated: result.nodesEvaluated,
          depthReached: result.depthReached,
          forcedWinInPlies: result.forcedWinInPlies,
          forcedLossInPlies: result.forcedLossInPlies,
        });
      } catch (err) {
        self.postMessage({ requestId, ok: false, error: (err && err.message) || String(err) });
      }
    });
  };
}
