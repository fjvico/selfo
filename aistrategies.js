"use strict";

/**
 * AiStrategies
 * ------------
 * Computer-player decision strategies. Each strategy is a pure function
 * that receives a board state and search options, and returns the move it
 * thinks is best — no DOM, no dependency on script.js, so it can be
 * tested, benchmarked, or swapped independently. It does depend on
 * MoveRules (moverules.js) for move legality — see the importScripts
 * call just below — so the CPU always agrees with the human UI on what
 * counts as a legal move, in particular the "Allow enclosure" rule (see
 * FeatureConfig.allow_enclosure in config.js): a computer vs computer (or
 * vs computer) game respects it exactly the same way a human player's
 * moves do, since both paths call MoveRules.legalMoveTargets.
 *
 * State shape expected by every strategy:
 *   {
 *     cells:           Map<string, { q, r, color: 'black'|'white'|null }>,
 *     neighborKeys:    Map<string, string[]>,
 *     color:           'black' | 'white'   // the color the AI is playing
 *     enclosureAllowed: boolean            // mirrors the "Allow enclosure" toggle
 *   }
 *
 * Options shape (all optional, strategies may ignore fields they don't use):
 *   {
 *     maxDepth:      number, // hard ply limit (future UI: 1-5)
 *     maxTimeSeconds: number  // wall-clock budget (future UI: think time)
 *   }
 *
 * Return shape:
 *   { move: { from, to } | null, score: number }
 *
 * New algorithms are added the same way as in boardinit.js: register a
 * function under AiStrategies.strategies["name"], then either set it as
 * AiStrategies.activeStrategy or pass the name explicitly to pickMove().
 */

// A Web Worker doesn't share the page's already-loaded <script> tags, so
// when this file runs inside one (see the worker entry point at the
// bottom), it has to pull MoveRules in itself. On the main thread,
// `importScripts` doesn't exist and moverules.js is already loaded via
// index.html, so this is a no-op there.
if (typeof importScripts === "function") {
  importScripts("moverules.js");
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

  /** All legal moves for `color`: one own piece moving to one empty
   *  adjacent cell (future variants: multi-step moves, see RULES in
   *  script.js — this function is the single place that would need to
   *  grow to support them), filtered through MoveRules.legalMoveTargets
   *  so the CPU never considers a move a human wouldn't be offered
   *  either (see the "Allow enclosure" toggle). */
  function getLegalMoves(cells, neighborKeys, color, enclosureAllowed) {
    const moves = [];
    for (const [k, cell] of cells) {
      if (cell.color !== color) continue;
      for (const nk of MoveRules.legalMoveTargets(cells, neighborKeys, k, enclosureAllowed)) {
        moves.push({ from: k, to: nk });
      }
    }
    return moves;
  }

  /** Deep-enough clone: new Map, new cell objects (so mutating the clone
   *  never touches the parent node's board while walking the tree). */
  function cloneCells(cells) {
    const copy = new Map();
    for (const [k, cell] of cells) copy.set(k, { q: cell.q, r: cell.r, color: cell.color });
    return copy;
  }

  /** Returns a *new* board with the move applied (does not mutate input). */
  function applyMove(cells, from, to) {
    const next = cloneCells(cells);
    const moving = next.get(from);
    next.get(to).color = moving.color;
    moving.color = null;
    return next;
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
  };

  /** Static value of a color's position: group-size + adjacency-cohesion,
   *  weighted. Does NOT check for a win — callers check that separately
   *  so a win can short-circuit the search at any depth, not just depth 0. */
  function colorScore(cells, neighborKeys, color) {
    const { largestGroup, allyAdjacencyPairs } = analyzeColor(cells, neighborKeys, color);
    return largestGroup * SCORE.GROUP_SIZE_WEIGHT + allyAdjacencyPairs * SCORE.ADJACENCY_WEIGHT;
  }

  /** Relative evaluation: own score minus the opponent's — positive favors
   *  `color`, negative favors the opponent. */
  function evaluatePosition(cells, neighborKeys, color, opponentColor) {
    return colorScore(cells, neighborKeys, color) - colorScore(cells, neighborKeys, opponentColor);
  }

  /** How many *other* allied pieces would end up touching the moved piece
   *  at its destination (excluding the origin cell, which becomes empty
   *  once the move is made). Used purely for move ordering. */
  function allyContactAfterMove(cells, neighborKeys, move, color) {
    let count = 0;
    for (const nk of neighborKeys.get(move.to)) {
      if (nk === move.from) continue; // that cell will be empty after moving
      if (cells.get(nk).color === color) count++;
    }
    return count;
  }

  /**
   * Move ordering heuristic: try moves that land a piece next to an ally
   * first. Better moves examined first means alpha-beta finds strong
   * bounds sooner and prunes far more of the remaining tree.
   */
  function orderMoves(moves, cells, neighborKeys, color) {
    return moves
      .map((m) => ({ m, score: allyContactAfterMove(cells, neighborKeys, m, color) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  }

  // ---------------------------------------------------------------------
  // Minimax with alpha-beta pruning (single fixed-depth search).
  // `rootColor` never changes across the recursion: it's whose
  // perspective the evaluation is scored from. `moverColor` is whichever
  // color is actually choosing a move at this node.
  // ---------------------------------------------------------------------
  function minimax(cells, neighborKeys, moverColor, rootColor, depth, alpha, beta, deadline, enclosureAllowed) {
    if (nowMs() > deadline) throw new SearchTimeoutError();

    const opponentOfRoot = otherColor(rootColor);
    // instant win/loss short-circuits the search at any depth
    if (isGroupFullyConnected(cells, neighborKeys, rootColor)) return SCORE.WIN + depth;
    if (isGroupFullyConnected(cells, neighborKeys, opponentOfRoot)) return -(SCORE.WIN + depth);

    if (depth === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const legalMoves = getLegalMoves(cells, neighborKeys, moverColor, enclosureAllowed);
    if (legalMoves.length === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const ordered = orderMoves(legalMoves, cells, neighborKeys, moverColor);
    const maximizing = moverColor === rootColor;
    let value = maximizing ? -Infinity : Infinity;

    for (const move of ordered) {
      const child = applyMove(cells, move.from, move.to);
      const childValue = minimax(child, neighborKeys, otherColor(moverColor), rootColor, depth - 1, alpha, beta, deadline, enclosureAllowed);

      if (maximizing) {
        if (childValue > value) value = childValue;
        if (value > alpha) alpha = value;
      } else {
        if (childValue < value) value = childValue;
        if (value < beta) beta = value;
      }
      if (alpha >= beta) break; // alpha-beta cutoff: rest of this branch can't change the outcome
    }
    return value;
  }

  /** One full-width search at a fixed depth from the root, returning the
   *  best move found (root is always the maximizing side). */
  function searchAtDepth(cells, neighborKeys, rootColor, depth, deadline, enclosureAllowed) {
    const opponentColor = otherColor(rootColor);
    const rootMoves = orderMoves(getLegalMoves(cells, neighborKeys, rootColor, enclosureAllowed), cells, neighborKeys, rootColor);

    let bestMove = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const move of rootMoves) {
      const child = applyMove(cells, move.from, move.to);
      const score = minimax(child, neighborKeys, opponentColor, rootColor, depth - 1, alpha, beta, deadline, enclosureAllowed);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      if (bestScore > alpha) alpha = bestScore;
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
   */
  function minimaxAlphaBetaID(state, options = {}) {
    const { cells, neighborKeys, color, enclosureAllowed } = state;
    const maxDepth = Math.max(1, Math.min(5, options.maxDepth ?? 2));
    const maxTimeMs = Math.max(200, (options.maxTimeSeconds ?? 5) * 1000);
    const deadline = nowMs() + maxTimeMs;

    let best = { move: null, score: -Infinity };

    for (let depth = 1; depth <= maxDepth; depth++) {
      let result;
      try {
        result = searchAtDepth(cells, neighborKeys, color, depth, deadline, enclosureAllowed);
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
      const fallback = getLegalMoves(cells, neighborKeys, state.color, enclosureAllowed)[0] || null;
      best = { move: fallback, score: 0 };
    }
    return best;
  }

  strategies.minimaxAlphaBetaID = minimaxAlphaBetaID;

  // Name of the strategy used when none is explicitly requested.
  const activeStrategy = "minimaxAlphaBetaID";

  /** Pick a move using the named strategy (defaults to the active one). */
  function pickMove(state, options, strategyName = activeStrategy) {
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
//      AiStrategies (moverules.js already loaded separately), nothing
//      below this point runs.
//   2. `new Worker("aistrategies.js")` from script.js — runs inside a
//      dedicated Web Worker, so the (possibly slow, time-boxed) search
//      never blocks the page's main thread. `importScripts` only exists
//      in worker contexts, so it doubles as the "am I in a worker?" check
//      (reused near the top of this file to also pull in moverules.js,
//      since a worker doesn't share the page's already-loaded scripts)
//      and lets one file serve both roles instead of needing a second
//      wrapper file.
//
// Message protocol (plain postMessage — Map/Array/Object are all
// structured-cloneable, no transferables needed):
//   in  -> { requestId, state: { cells, neighborKeys, color, enclosureAllowed }, options }
//   out -> { requestId, ok: true,  move, score }
//        | { requestId, ok: false, error }
// =========================================================================
if (typeof importScripts === "function") {
  self.onmessage = function (e) {
    const { requestId, state, options } = e.data || {};
    try {
      const result = AiStrategies.pickMove(state, options);
      self.postMessage({ requestId, ok: true, move: result.move, score: result.score });
    } catch (err) {
      self.postMessage({ requestId, ok: false, error: (err && err.message) || String(err) });
    }
  };
}