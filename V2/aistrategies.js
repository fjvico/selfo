"use strict";

/**
 * AiStrategies
 * ------------
 * Computer-player decision strategies. Each strategy is a pure function
 * that receives a board state and search options, and returns the move it
 * thinks is best — no DOM, no globals besides Fitness (see below), so it
 * can be tested, benchmarked, or swapped independently.
 *
 * State shape expected by every strategy:
 *   {
 *     cells:        Map<string, { q, r, color: 'black'|'white'|null }>,
 *     neighborKeys: Map<string, string[]>,
 *     color:        'black' | 'white'   // the color the AI is playing
 *   }
 *
 * Options shape (all optional, strategies may ignore fields they don't use):
 *   {
 *     maxDepth:       number, // hard ply limit (UI: 1-12)
 *     maxTimeSeconds: number, // wall-clock budget (UI: think time)
 *     lmrFullWidth:   number, // see "Late Move Reduction" below
 *     lmrMinDepth:    number,
 *   }
 *
 * Return shape (pickMove is async — returns a Promise of this):
 *   { move: { from, to } | null, score: number }
 *
 * -------------------------------------------------------------------------
 * Performance notes (why this file looks the way it does)
 * -------------------------------------------------------------------------
 * Three independent changes, each attacking a different bottleneck of the
 * original fixed-depth-5 minimax, combine to make depth > 5 reachable in
 * real time:
 *
 * 1. Evaluation quality (Fitness / MST). `colorScore` used to be just
 *    "largest connected group + adjacency pairs" — a signal that's flat
 *    (gives no gradient at all) whenever pieces aren't touching yet. It
 *    now adds the geometric MST "excess" from fitness.js: a smooth,
 *    board-wide measure of how much distance is left to close, cheap
 *    enough (O(n^2 log n) in piece count, not cell count) to compute at
 *    every leaf. A smoother evaluation gives alpha-beta tighter bounds
 *    sooner, which is what actually produces more pruning — not the
 *    metric by itself.
 *
 * 2. Move ordering. The single biggest lever for alpha-beta efficiency:
 *    with perfect ordering the search approaches O(b^(d/2)) instead of
 *    O(b^d). `orderMoves` now ranks moves both by immediate ally contact
 *    (cheap, as before) and by how much they shrink the moved piece's
 *    distance to its nearest ally (cheap, O(n) per move, same distance
 *    family as the MST fitness above) — a much stronger ordering signal
 *    than adjacency alone, since most of the board most of the time has
 *    zero adjacency to rank by.
 *
 * 3. No more per-node cloning. `applyMove`/`cloneCells` copied the *whole*
 *    board (all cells, not just pieces) at every single tree node — for a
 *    concentric board that's usually far more expensive than anything
 *    above. The search now mutates the *same* cells Map in place and
 *    undoes each move with a plain try/finally, so undo always runs even
 *    when a SearchTimeoutError unwinds the stack mid-search. `applyMove`
 *    is kept and still exported for external reuse/tests, but the hot
 *    path no longer calls it.
 *
 * 4. Late Move Reduction (LMR). A standard game-tree technique, made
 *    effective here specifically *because* of (2): the first
 *    `lmrFullWidth` moves (already the most promising, thanks to
 *    ordering) are searched at full depth; the rest are searched one ply
 *    shallower first, and only re-searched at full depth if that shallow
 *    look suggests they might actually beat the current bound. This cuts
 *    the effective branching factor for the "probably not the best move"
 *    tail of the move list, which is most of it.
 *
 * Together these let the same iterative-deepening + wall-clock-deadline
 * driver (unchanged) reach noticeably higher completed depths within the
 * same time budget — so `maxDepth` > 5 becomes something the time budget
 * actually gets to use, not just a number that times out immediately.
 *
 * NOT done here (possible future step, more invasive): maintaining the
 * MST's pairwise-distance matrix incrementally across the whole search
 * path (updating only the moved piece's row/column instead of rebuilding
 * from scratch at every leaf) — this would remove the residual
 * O(n^2 log n)-per-leaf cost. Not implemented because it requires
 * threading extra state through every recursive call and undoing it
 * symmetrically on backtrack; worth it only if profiling shows leaf
 * evaluation, rather than tree size, is still the bottleneck.
 *
 * Dependency: this file needs `Fitness` (fitness.js) in scope. On the
 * main thread, load fitness.js before aistrategies.js with a <script>
 * tag; inside a Worker, importScripts pulls it in automatically (below).
 */

// Worker contexts don't get the page's <script> tags, so pull in the
// shared module explicitly. Harmless/no-op on the main thread, where
// `importScripts` doesn't exist and Fitness is expected to already be a
// global from its own <script> tag.
if (typeof importScripts === "function") {
  importScripts("fitness.js");
}

const AiStrategies = (() => {

  const strategies = {};

  // ---------------------------------------------------------------------
  // Small, self-contained board helpers (kept local so this file has no
  // dependency on script.js / HexGeometry and can run standalone).
  // ---------------------------------------------------------------------

  function otherColor(color) {
    return color === "black" ? "white" : "black";
  }

  function nowMs() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  /** Thrown internally to unwind the recursion as soon as the time budget
   *  for the *current* depth runs out; the depth is then discarded so the
   *  caller keeps the previous (fully-searched) depth's result. */
  class SearchTimeoutError extends Error {}

  // How often (ms of continuous work) the root-move loop hands control
  // back to the host event loop — see searchAtDepth. Needed because the
  // search can otherwise run fully synchronously for the entire
  // maxTimeSeconds budget (up to 30s): even inside a Worker, that trips
  // Firefox's (and other browsers') "this page/script is unresponsive"
  // warning, since it monitors worker threads for hangs too, not just the
  // main thread. Kept short relative to typical hang thresholds (~5-10s)
  // so it never gets close, while being long enough that the
  // setTimeout-based yield itself is negligible overhead over a 30s search.
  const YIELD_INTERVAL_MS = 400;

  /** Hands control back to the host event loop for one macrotask tick. */
  function yieldToEventLoop() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** All legal moves for `color`: one own piece moving to one empty
   *  adjacent cell (future variants: multi-step moves, see RULES in
   *  script.js — this function is the single place that would need to
   *  grow to support them). */
  function getLegalMoves(cells, neighborKeys, color) {
    const moves = [];
    for (const [k, cell] of cells) {
      if (cell.color !== color) continue;
      for (const nk of neighborKeys.get(k)) {
        if (cells.get(nk).color === null) moves.push({ from: k, to: nk });
      }
    }
    return moves;
  }

  /** Deep-enough clone: new Map, new cell objects (so mutating the clone
   *  never touches the parent node's board). Kept for external reuse and
   *  tests; the search below no longer calls this on its hot path (see
   *  makeMove/undoMove instead). */
  function cloneCells(cells) {
    const copy = new Map();
    for (const [k, cell] of cells) copy.set(k, { q: cell.q, r: cell.r, color: cell.color });
    return copy;
  }

  /** Returns a *new* board with the move applied (does not mutate input).
   *  Kept for external reuse/tests — see makeMove/undoMove for the
   *  mutate-in-place version the search itself uses. */
  function applyMove(cells, from, to) {
    const next = cloneCells(cells);
    const moving = next.get(from);
    next.get(to).color = moving.color;
    moving.color = null;
    return next;
  }

  /** Mutates `cells` in place, applying the move, and returns a small
   *  record `undoMove` needs to reverse it exactly. O(1) — no cloning. */
  function makeMove(cells, from, to) {
    const fromCell = cells.get(from);
    const color = fromCell.color;
    fromCell.color = null;
    cells.get(to).color = color;
    return { from, to, color };
  }

  /** Reverses exactly what makeMove did, using its return record. */
  function undoMove(cells, record) {
    cells.get(record.to).color = null;
    cells.get(record.from).color = record.color;
  }

  /** True if every piece of `color` belongs to a single connected group. */
  function isGroupFullyConnected(cells, neighborKeys, color) {
    const ownKeys = [];
    for (const [k, cell] of cells) if (cell.color === color) ownKeys.push(k);
    if (ownKeys.length <= 1) return ownKeys.length === 1;
    const visited = new Set([ownKeys[0]]);
    const stack = [ownKeys[0]];
    while (stack.length) {
      const k = stack.pop();
      for (const nk of neighborKeys.get(k)) {
        if (visited.has(nk)) continue;
        if (cells.get(nk).color === color) { visited.add(nk); stack.push(nk); }
      }
    }
    return visited.size === ownKeys.length;
  }

  /** Size of the largest connected group of `color`, plus a cohesion bonus
   *  counting each ally-ally adjacency once (pairs of touching same-color
   *  pieces) — used to reward clustering even before a full connection. */
  function analyzeColor(cells, neighborKeys, color) {
    const visited = new Set();
    let largestGroup = 0;
    let allyAdjacencyPairs = 0;

    for (const [k, cell] of cells) {
      if (cell.color !== color || visited.has(k)) continue;
      let size = 0;
      const stack = [k];
      visited.add(k);
      while (stack.length) {
        const ck = stack.pop();
        size++;
        for (const nk of neighborKeys.get(ck)) {
          if (cells.get(nk).color !== color) continue;
          allyAdjacencyPairs += 0.5; // each pair is seen from both sides
          if (!visited.has(nk)) { visited.add(nk); stack.push(nk); }
        }
      }
      if (size > largestGroup) largestGroup = size;
    }
    return { largestGroup, allyAdjacencyPairs };
  }

  // Weights for the static evaluation (tunable without touching the search).
  const SCORE = {
    WIN: 10000,
    GROUP_SIZE_WEIGHT: 100,
    ADJACENCY_WEIGHT: 5,
    // Rewards shrinking the geometric MST "excess" (see fitness.js) even
    // before pieces are close enough to touch or share a component — the
    // signal that used to be completely flat / uninformative.
    FITNESS_WEIGHT: 15,
  };

  /** Static value of a color's position: group-size + adjacency-cohesion
   *  + MST-excess, weighted. Does NOT check for a win — callers check
   *  that separately so a win can short-circuit the search at any depth,
   *  not just depth 0. */
  function colorScore(cells, neighborKeys, color) {
    const { largestGroup, allyAdjacencyPairs } = analyzeColor(cells, neighborKeys, color);
    const excess = Fitness.fitness(cells, neighborKeys, color, { mode: "geometric" });
    return largestGroup * SCORE.GROUP_SIZE_WEIGHT
         + allyAdjacencyPairs * SCORE.ADJACENCY_WEIGHT
         - excess * SCORE.FITNESS_WEIGHT;
  }

  /** Relative evaluation: own score minus the opponent's — positive favors
   *  `color`, negative favors the opponent. */
  function evaluatePosition(cells, neighborKeys, color, opponentColor) {
    return colorScore(cells, neighborKeys, color) - colorScore(cells, neighborKeys, opponentColor);
  }

  /** How many *other* allied pieces would end up touching the moved piece
   *  at its destination (excluding the origin cell, which becomes empty
   *  once the move is made). */
  function allyContactAfterMove(cells, neighborKeys, move, color) {
    let count = 0;
    for (const nk of neighborKeys.get(move.to)) {
      if (nk === move.from) continue; // that cell will be empty after moving
      if (cells.get(nk).color === color) count++;
    }
    return count;
  }

  /** Distance (geometric, obstacle-free) from cell `key` to the nearest
   *  *other* piece of `color`, skipping `excludeKey` (the piece's own
   *  origin, so it doesn't count itself while still sitting there). O(n)
   *  in piece count — cheap enough to run per candidate move. */
  function nearestAllyDistance(cells, color, key, excludeKey) {
    const origin = cells.get(key);
    let best = Infinity;
    for (const [k, cell] of cells) {
      if (k === key || k === excludeKey) continue;
      if (cell.color !== color) continue;
      const d = Fitness.cubeDistance(origin.q, origin.r, cell.q, cell.r);
      if (d < best) best = d;
    }
    return best === Infinity ? 0 : best;
  }

  /**
   * Move ordering heuristic, used both for the raw candidate order and to
   * decide which moves get a Late Move Reduction (see file header). Ranks
   * by (1) immediate ally contact at the destination, then (2) how much
   * closer the move gets the piece to its nearest ally overall — a much
   * more informative signal than contact alone, since most legal moves in
   * a spread-out midgame touch zero allies either way.
   */
  function orderMoves(moves, cells, neighborKeys, color) {
    return moves
      .map((m) => {
        const contact = allyContactAfterMove(cells, neighborKeys, m, color);
        const distBefore = nearestAllyDistance(cells, color, m.from, m.from);
        const distAfter = nearestAllyDistance(cells, color, m.to, m.from);
        const improvement = distBefore - distAfter; // positive = closing distance
        return { m, score: contact * 1000 + improvement * 10 };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  }

  // Late Move Reduction tuning defaults (overridable via options, see
  // minimaxAlphaBetaID below).
  const DEFAULT_LMR_MIN_DEPTH = 3;  // only reduce when there's depth left for it to matter
  const DEFAULT_LMR_FULL_WIDTH = 4; // this many best-ranked moves always get full-depth search

  // ---------------------------------------------------------------------
  // Minimax with alpha-beta pruning, Late Move Reduction, and in-place
  // make/undo (no per-node cloning). `rootColor` never changes across the
  // recursion: it's whose perspective the evaluation is scored from.
  // `moverColor` is whichever color is actually choosing a move here.
  // ---------------------------------------------------------------------
  function minimax(cells, neighborKeys, moverColor, rootColor, depth, alpha, beta, deadline, tuning) {
    if (nowMs() > deadline) throw new SearchTimeoutError();

    const opponentOfRoot = otherColor(rootColor);
    // instant win/loss short-circuits the search at any depth
    if (isGroupFullyConnected(cells, neighborKeys, rootColor)) return SCORE.WIN + depth;
    if (isGroupFullyConnected(cells, neighborKeys, opponentOfRoot)) return -(SCORE.WIN + depth);

    if (depth === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const legalMoves = getLegalMoves(cells, neighborKeys, moverColor);
    if (legalMoves.length === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const ordered = orderMoves(legalMoves, cells, neighborKeys, moverColor);
    const maximizing = moverColor === rootColor;
    const nextColor = otherColor(moverColor);
    let value = maximizing ? -Infinity : Infinity;

    for (let i = 0; i < ordered.length; i++) {
      const move = ordered[i];
      const record = makeMove(cells, move.from, move.to);
      let childValue;
      try {
        let reduction = 0;
        if (depth >= tuning.lmrMinDepth && i >= tuning.lmrFullWidth) reduction = 1;

        childValue = minimax(cells, neighborKeys, nextColor, rootColor, depth - 1 - reduction, alpha, beta, deadline, tuning);

        if (reduction > 0) {
          const mightBeBest = maximizing ? childValue > alpha : childValue < beta;
          if (mightBeBest) {
            // the shallow look says this move might actually matter —
            // confirm it at the full depth before trusting the value
            childValue = minimax(cells, neighborKeys, nextColor, rootColor, depth - 1, alpha, beta, deadline, tuning);
          }
        }
      } finally {
        // always undo, even if the recursive call threw a timeout —
        // this is what keeps `cells` valid for the next iterative-
        // deepening depth (or the next root move) after a timeout.
        undoMove(cells, record);
      }

      if (maximizing) {
        if (childValue > value) value = childValue;
        if (value > alpha) alpha = value;
      } else {
        if (childValue < value) value = childValue;
        if (value < beta) beta = value;
      }
      if (alpha >= beta) break; // alpha-beta cutoff
    }
    return value;
  }

  /** One full-width search at a fixed depth from the root, returning the
   *  best move found (root is always the maximizing side). Async: yields
   *  to the event loop periodically between root moves (see
   *  YIELD_INTERVAL_MS) so a slow depth can't block the thread it's
   *  running on continuously for the whole search — individual `minimax`
   *  calls stay fully synchronous (adding an await at every recursive
   *  node would be far too costly), so this is a best-effort granularity:
   *  it can't interrupt a single very slow root move mid-flight, only
   *  between them, but with move ordering + alpha-beta that's frequent
   *  enough in practice to keep any one stretch well under typical
   *  browser hang thresholds. */
  async function searchAtDepth(cells, neighborKeys, rootColor, depth, deadline, tuning) {
    const opponentColor = otherColor(rootColor);
    const rootMoves = orderMoves(getLegalMoves(cells, neighborKeys, rootColor), cells, neighborKeys, rootColor);

    let bestMove = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    let lastYield = nowMs();
    for (const move of rootMoves) {
      const record = makeMove(cells, move.from, move.to);
      let score;
      try {
        score = minimax(cells, neighborKeys, opponentColor, rootColor, depth - 1, alpha, beta, deadline, tuning);
      } finally {
        undoMove(cells, record);
      }
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      if (bestScore > alpha) alpha = bestScore;

      const now = nowMs();
      if (now - lastYield > YIELD_INTERVAL_MS) {
        if (now > deadline) throw new SearchTimeoutError();
        await yieldToEventLoop();
        lastYield = nowMs();
      }
    }
    return { move: bestMove, score: bestScore };
  }

  /**
   * Iterative deepening driver: searches depth 1, 2, 3... up to
   * options.maxDepth, keeping the best move found at each *completed*
   * depth. If the time budget runs out mid-search at some depth, that
   * depth's (incomplete, unreliable) result is discarded and the last
   * fully-completed depth's move is returned instead. Stops early if a
   * forced win/loss is already found, since deeper search can't change it.
   *
   * maxDepth now goes up to 12 (was 5) — reachable in practice within a
   * normal think-time budget thanks to the pruning/ordering/no-clone
   * changes described in the file header, not just because the cap moved.
   *
   * Async: awaits searchAtDepth's periodic event-loop yields (see
   * YIELD_INTERVAL_MS), so this returns a Promise<{move, score}> now
   * rather than the value directly — callers need `await`/`.then()`.
   */
  async function minimaxAlphaBetaID(state, options = {}) {
    if (typeof Fitness === "undefined") {
      throw new Error("AiStrategies needs fitness.js loaded before aistrategies.js");
    }

    const { cells, neighborKeys, color } = state;
    const maxDepth = Math.max(1, Math.min(12, options.maxDepth ?? 2));
    const maxTimeMs = Math.max(200, (options.maxTimeSeconds ?? 5) * 1000);
    const deadline = nowMs() + maxTimeMs;
    const tuning = {
      lmrMinDepth: options.lmrMinDepth ?? DEFAULT_LMR_MIN_DEPTH,
      lmrFullWidth: options.lmrFullWidth ?? DEFAULT_LMR_FULL_WIDTH,
    };

    let best = { move: null, score: -Infinity };

    for (let depth = 1; depth <= maxDepth; depth++) {
      let result;
      try {
        result = await searchAtDepth(cells, neighborKeys, color, depth, deadline, tuning);
      } catch (err) {
        if (err instanceof SearchTimeoutError) break; // keep the previous depth's result
        throw err;
      }
      if (result.move) best = result;
      if (Math.abs(best.score) >= SCORE.WIN) break; // forced win/loss found, deeper search won't help
      if (nowMs() > deadline) break;
    }

    // safety net: if even depth 1 never completed (pathologically small
    // time budget), fall back to any legal move rather than passing.
    if (!best.move) {
      const fallback = getLegalMoves(cells, neighborKeys, state.color)[0] || null;
      best = { move: fallback, score: 0 };
    }
    return best;
  }

  strategies.minimaxAlphaBetaID = minimaxAlphaBetaID;

  // Name of the strategy used when none is explicitly requested.
  const activeStrategy = "minimaxAlphaBetaID";

  /** Pick a move using the named strategy (defaults to the active one).
   *  Async — returns a Promise<{move, score}>, since the strategy itself
   *  (minimaxAlphaBetaID) now yields to the event loop periodically. */
  async function pickMove(state, options, strategyName = activeStrategy) {
    const strategy = strategies[strategyName];
    if (!strategy) throw new Error(`Unknown AI strategy: "${strategyName}"`);
    return strategy(state, options);
  }

  return {
    strategies,
    activeStrategy,
    pickMove,
    // exposed for testing / reuse by other strategies:
    getLegalMoves,
    applyMove,
    isGroupFullyConnected,
    evaluatePosition,
  };
})();

// =========================================================================
// Worker entry point
// -------------------------------------------------------------------------
// This file is loaded two different ways:
//   1. `<script src="aistrategies.js">` on the main page — just defines
//      AiStrategies, nothing below this point runs.
//   2. `new Worker("aistrategies.js")` from script.js — runs inside a
//      dedicated Web Worker, so the (possibly slow, time-boxed) search
//      never blocks the page's main thread. `importScripts` only exists
//      in worker contexts, so it doubles as the "am I in a worker?" check
//      and lets one file serve both roles instead of needing a second
//      wrapper file.
//
// Message protocol (plain postMessage — Map/Array/Object are all
// structured-cloneable, no transferables needed):
//   in  -> { requestId, state: { cells, neighborKeys, color }, options }
//   out -> { requestId, ok: true,  move, score }
//        | { requestId, ok: false, error }
// =========================================================================
if (typeof importScripts === "function") {
  self.onmessage = async function (e) {
    const { requestId, state, options } = e.data || {};
    try {
      const result = await AiStrategies.pickMove(state, options);
      self.postMessage({ requestId, ok: true, move: result.move, score: result.score });
    } catch (err) {
      self.postMessage({ requestId, ok: false, error: (err && err.message) || String(err) });
    }
  };
}