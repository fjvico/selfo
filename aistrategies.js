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
 * counts as a legal move, in particular the "No enclosure" rule (see
 * FeatureConfig.no_enclosure in config.js): a computer vs computer (or
 * vs computer) game respects it exactly the same way a human player's
 * moves do, since both paths call MoveRules.legalMoveTargets.
 *
 * State shape expected by every strategy:
 *   {
 *     cells:            Map<string, { q, r, color: 'black'|'white'|null }>,
 *     neighborKeys:     Map<string, string[]>,
 *     color:            'black' | 'white'   // the color the AI is playing
 *     enclosureAllowed: boolean             // !Game.noEnclosure — see moverules.js
 *   }
 *
 * Options shape (all optional, strategies may ignore fields they don't use):
 *   {
 *     maxDepth:      number, // hard ply limit (future UI: 1-5)
 *     maxTimeSeconds: number  // wall-clock budget (future UI: think time)
 *   }
 *
 * Return shape:
 *   { move: { from, to } | null, score: number, nodesEvaluated: number, depthReached: number }
 *   (nodesEvaluated/depthReached are search-stats for the ?showAdvanced=
 *   true CPU log in script.js — see minimaxAlphaBetaID()'s own doc comment
 *   below for exactly what each counts. A strategy that doesn't do a
 *   depth-limited tree search at all is free to omit them; script.js
 *   treats both as optional and simply doesn't log a line it can't fill.)
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
   *  either (see the "No enclosure" toggle). */
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

  /** Returns a *new* board with the move applied (does not mutate input).
   *  Kept as the stable, easy-to-reason-about public API (see the
   *  `strategies`/`pickMove` export below) — a strategy that doesn't
   *  need the speed of makeMove/undo (e.g. a simple one-ply evaluator,
   *  or a future strategy with a much shallower tree) can just use this
   *  and not worry about make/unmake bookkeeping at all. minimaxAlphaBetaID
   *  itself no longer calls this internally — see makeMove() just below. */
  function applyMove(cells, from, to) {
    const next = cloneCells(cells);
    const moving = next.get(from);
    next.get(to).color = moving.color;
    moving.color = null;
    return next;
  }

  /**
   * In-place "make" half of a make/unmake move pair, for the hot search
   * path (minimax/searchAtDepth below) — mutates `cells` directly instead
   * of cloning a new board per node (see applyMove() above for the
   * clone-based alternative kept for other callers). Returns an `undo()`
   * closure that restores both the board *and* `connState` (see below) to
   * exactly how they were before this call; callers MUST invoke it
   * exactly once, in a `finally` block, so the board is correctly
   * restored even when a SearchTimeoutError unwinds the recursion
   * mid-search (see minimax()'s deadline check) — otherwise the next
   * sibling move explored, or the next iterative-deepening depth, would
   * silently start from a corrupted board.
   *
   * `connState` — { black: boolean, white: boolean }, "is this color
   * currently one fully-connected group" — is the incremental-connectivity
   * piece: moving a piece can only change *its own* color's connectivity
   * (the opponent's pieces don't move), so only that one color is
   * recomputed here (still an O(n) scan — see isGroupFullyConnected — but
   * exactly one of the two BFS calls minimax() used to always do
   * unconditionally at every node, not both).
   */
  function makeMove(cells, neighborKeys, from, to, connState) {
    const color = cells.get(from).color;
    const prevConn = connState[color];
    cells.get(from).color = null;
    cells.get(to).color = color;
    connState[color] = isGroupFullyConnected(cells, neighborKeys, color);
    return function undoMove() {
      cells.get(to).color = null;
      cells.get(from).color = color;
      connState[color] = prevConn;
    };
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
  // color is actually choosing a move at this node. `counter` is a
  // { nodes } object shared (by reference) across one entire
  // minimaxAlphaBetaID() call — every candidate move actually expanded
  // (root-level, in searchAtDepth, or here) increments it once, so the
  // caller ends up with a true "moves evaluated" total across all of
  // iterative deepening's depths, not just the deepest/last one. Used to
  // surface search stats in the UI — see minimaxAlphaBetaID()'s return
  // value below and updateSetupVisibility()/logCpuSearch() in script.js,
  // which only ever displays this behind ?showAdvanced=true.
  //
  // PERFORMANCE: this walks the tree via make/unmake (see makeMove()
  // above) instead of cloning a new board per node, and reads
  // connState[color] instead of re-running isGroupFullyConnected() for
  // both colors at every single node — see makeMove()'s comment for why
  // only the mover's color ever needs recomputing. `cells` is mutated
  // and restored in place across the whole call; nothing here is safe to
  // call concurrently against the same `cells`/`connState` pair.
  // ---------------------------------------------------------------------
  function minimax(cells, neighborKeys, moverColor, rootColor, depth, alpha, beta, deadline, enclosureAllowed, counter, connState) {
    if (nowMs() > deadline) throw new SearchTimeoutError();

    const opponentOfRoot = otherColor(rootColor);
    // instant win/loss short-circuits the search at any depth
    if (connState[rootColor]) return SCORE.WIN + depth;
    if (connState[opponentOfRoot]) return -(SCORE.WIN + depth);

    if (depth === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const legalMoves = getLegalMoves(cells, neighborKeys, moverColor, enclosureAllowed);
    if (legalMoves.length === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const ordered = orderMoves(legalMoves, cells, neighborKeys, moverColor);
    const maximizing = moverColor === rootColor;
    let value = maximizing ? -Infinity : Infinity;

    for (const move of ordered) {
      counter.nodes++;
      const undo = makeMove(cells, neighborKeys, move.from, move.to, connState);
      let childValue;
      try {
        childValue = minimax(cells, neighborKeys, otherColor(moverColor), rootColor, depth - 1, alpha, beta, deadline, enclosureAllowed, counter, connState);
      } finally {
        undo(); // always restore, even if the line above threw SearchTimeoutError
      }

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
   *  best move found (root is always the maximizing side). `counter`/
   *  `connState` — see minimax() above; same make/unmake-in-`finally`
   *  discipline applies here at the root level too. */
  function searchAtDepth(cells, neighborKeys, rootColor, depth, deadline, enclosureAllowed, counter, connState) {
    const opponentColor = otherColor(rootColor);
    const rootMoves = orderMoves(getLegalMoves(cells, neighborKeys, rootColor, enclosureAllowed), cells, neighborKeys, rootColor);

    let bestMove = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const move of rootMoves) {
      counter.nodes++;
      const undo = makeMove(cells, neighborKeys, move.from, move.to, connState);
      let score;
      try {
        score = minimax(cells, neighborKeys, opponentColor, rootColor, depth - 1, alpha, beta, deadline, enclosureAllowed, counter, connState);
      } finally {
        undo();
      }
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
   *
   * Returns { move, score, nodesEvaluated, depthReached } — the latter
   * two purely for display (see the file-header comment and script.js's
   * ?showAdvanced=true CPU search log): nodesEvaluated is the total
   * candidate moves expanded across *every* depth tried this call (a
   * fresh search each depth, no move/transposition caching between
   * them), and depthReached is the last depth that actually completed
   * before the time budget ran out (which can be less than
   * options.maxDepth on a tight budget, or on a big/complex board).
   *
   * connState (see makeMove()) is computed once here, from the actual
   * root position, and then threaded through every depth's search —
   * each depth's own make/unmake calls fully unwind back to this same
   * root state (via the `finally` blocks in minimax()/searchAtDepth())
   * before the next depth starts, so recomputing it per depth would be
   * redundant.
   */
  function minimaxAlphaBetaID(state, options = {}) {
    const { cells, neighborKeys, color, enclosureAllowed } = state;
    const maxDepth = Math.max(1, Math.min(5, options.maxDepth ?? 2));
    const maxTimeMs = Math.max(200, (options.maxTimeSeconds ?? 5) * 1000);
    const deadline = nowMs() + maxTimeMs;

    const counter = { nodes: 0 };
    const connState = {
      black: isGroupFullyConnected(cells, neighborKeys, "black"),
      white: isGroupFullyConnected(cells, neighborKeys, "white"),
    };
    let best = { move: null, score: -Infinity };
    let depthReached = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      let result;
      try {
        result = searchAtDepth(cells, neighborKeys, color, depth, deadline, enclosureAllowed, counter, connState);
      } catch (err) {
        if (err instanceof SearchTimeoutError) break; // keep the previous depth's result
        throw err;
      }
      if (result.move) { best = result; depthReached = depth; }
      if (Math.abs(best.score) >= SCORE.WIN) break; // forced win/loss found, deeper search won't help
      if (nowMs() > deadline) break;
    }

    // safety net: if even depth 1 never completed (pathologically small
    // time budget), fall back to any legal move rather than passing.
    if (!best.move) {
      const fallback = getLegalMoves(cells, neighborKeys, state.color, enclosureAllowed)[0] || null;
      best = { move: fallback, score: 0 };
    }
    return { move: best.move, score: best.score, nodesEvaluated: counter.nodes, depthReached };
  }

  strategies.minimaxAlphaBetaID = minimaxAlphaBetaID;

  // -----------------------------------------------------------------------
  // Second, slower strategy: the pre-optimization implementation, kept
  // deliberately alongside the current one (not deleted) so the two can be
  // pitted against each other on demand — see FeatureConfig.
  // computerself_strategies / DEFAULT_CPU_STRATEGY / difficulty_levels'
  // cpuStrategy field (all in config.js) and resolveCpuStrategy() in
  // script.js for how a game picks which of the two actually runs.
  //
  // Identical algorithm and evaluation to minimaxAlphaBetaID above — same
  // helpers (getLegalMoves/orderMoves/evaluatePosition/SCORE/etc.), same
  // iterative deepening driver shape, same return shape — differing only
  // in how it walks the tree:
  //   - clones the whole board per node (applyMove()) instead of
  //     make/unmake in place (makeMove()/undo()).
  //   - re-checks isGroupFullyConnected() for BOTH colors at every node,
  //     instead of caching one boolean per color and only recomputing the
  //     side that just moved (connState).
  // See README.md's "CPU search performance" section for the full
  // writeup and benchmark notes from when minimaxAlphaBetaID replaced
  // this as the default.
  // -----------------------------------------------------------------------
  function minimaxCloning(cells, neighborKeys, moverColor, rootColor, depth, alpha, beta, deadline, enclosureAllowed, counter) {
    if (nowMs() > deadline) throw new SearchTimeoutError();

    const opponentOfRoot = otherColor(rootColor);
    if (isGroupFullyConnected(cells, neighborKeys, rootColor)) return SCORE.WIN + depth;
    if (isGroupFullyConnected(cells, neighborKeys, opponentOfRoot)) return -(SCORE.WIN + depth);

    if (depth === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const legalMoves = getLegalMoves(cells, neighborKeys, moverColor, enclosureAllowed);
    if (legalMoves.length === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const ordered = orderMoves(legalMoves, cells, neighborKeys, moverColor);
    const maximizing = moverColor === rootColor;
    let value = maximizing ? -Infinity : Infinity;

    for (const move of ordered) {
      counter.nodes++;
      const child = applyMove(cells, move.from, move.to);
      const childValue = minimaxCloning(child, neighborKeys, otherColor(moverColor), rootColor, depth - 1, alpha, beta, deadline, enclosureAllowed, counter);

      if (maximizing) {
        if (childValue > value) value = childValue;
        if (value > alpha) alpha = value;
      } else {
        if (childValue < value) value = childValue;
        if (value < beta) beta = value;
      }
      if (alpha >= beta) break;
    }
    return value;
  }

  function searchAtDepthCloning(cells, neighborKeys, rootColor, depth, deadline, enclosureAllowed, counter) {
    const opponentColor = otherColor(rootColor);
    const rootMoves = orderMoves(getLegalMoves(cells, neighborKeys, rootColor, enclosureAllowed), cells, neighborKeys, rootColor);

    let bestMove = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const move of rootMoves) {
      counter.nodes++;
      const child = applyMove(cells, move.from, move.to);
      const score = minimaxCloning(child, neighborKeys, opponentColor, rootColor, depth - 1, alpha, beta, deadline, enclosureAllowed, counter);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      if (bestScore > alpha) alpha = bestScore;
    }
    return { move: bestMove, score: bestScore };
  }

  function minimaxAlphaBetaCloning(state, options = {}) {
    const { cells, neighborKeys, color, enclosureAllowed } = state;
    const maxDepth = Math.max(1, Math.min(5, options.maxDepth ?? 2));
    const maxTimeMs = Math.max(200, (options.maxTimeSeconds ?? 5) * 1000);
    const deadline = nowMs() + maxTimeMs;

    const counter = { nodes: 0 };
    let best = { move: null, score: -Infinity };
    let depthReached = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      let result;
      try {
        result = searchAtDepthCloning(cells, neighborKeys, color, depth, deadline, enclosureAllowed, counter);
      } catch (err) {
        if (err instanceof SearchTimeoutError) break;
        throw err;
      }
      if (result.move) { best = result; depthReached = depth; }
      if (Math.abs(best.score) >= SCORE.WIN) break;
      if (nowMs() > deadline) break;
    }

    if (!best.move) {
      const fallback = getLegalMoves(cells, neighborKeys, state.color, enclosureAllowed)[0] || null;
      best = { move: fallback, score: 0 };
    }
    return { move: best.move, score: best.score, nodesEvaluated: counter.nodes, depthReached };
  }

  strategies.minimaxAlphaBetaCloning = minimaxAlphaBetaCloning;

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
//   in  -> { requestId, state: { cells, neighborKeys, color, enclosureAllowed }, options, strategyName }
//   out -> { requestId, ok: true,  move, score, nodesEvaluated, depthReached }
//        | { requestId, ok: false, error }
// strategyName is optional — omitting it (or passing undefined) uses
// AiStrategies.activeStrategy, same as calling pickMove() with only two
// arguments. See config.js's DEFAULT_CPU_STRATEGY/computerself_strategies/
// difficulty_levels' cpuStrategy for how script.js decides what to send.
// =========================================================================
if (typeof importScripts === "function") {
  self.onmessage = function (e) {
    const { requestId, state, options, strategyName } = e.data || {};
    try {
      const result = AiStrategies.pickMove(state, options, strategyName);
      self.postMessage({
        requestId,
        ok: true,
        move: result.move,
        score: result.score,
        nodesEvaluated: result.nodesEvaluated,
        depthReached: result.depthReached,
      });
    } catch (err) {
      self.postMessage({ requestId, ok: false, error: (err && err.message) || String(err) });
    }
  };
}