"use strict";

/**
 * BoardInit
 * ---------
 * Board *initialization* strategies. Originally this covered only the
 * empty-grid + adjacency step (cells with no pieces yet); piece placement
 * lived entirely in script.js. It now also owns an *equitable* piece
 * scatter (`scatterPieces` / `initWithPieces`, below), built on the same
 * shared Fitness measure aistrategies.js uses for its evaluation — a
 * "fair start" and "good position mid-game" are the same underlying
 * question (how much MST-excess distance does each color have to close?),
 * so it made sense to answer both with one module instead of two.
 *
 * Grid strategies all share this signature and return shape:
 *   (radius: number) => {
 *     cells: Map<string, { q: number, r: number, color: null }>,
 *     neighborKeys: Map<string, string[]>
 *   }
 *
 * Strategies are registered in BoardInit.strategies under a name, so any
 * of them can be selected explicitly by that name. New alternatives can be
 * added the same way without touching the rest of the game logic — only
 * BoardInit.activeStrategy (or an explicit name passed to BoardInit.init)
 * needs to change to switch which one is actually used.
 *
 * Dependency: `scatterPieces`/`initWithPieces` need `Fitness` (fitness.js)
 * in scope — load fitness.js before boardinit.js. The pure grid functions
 * (`init`, `strategies.*`) don't need it, only HexGeometry.
 */
const BoardInit = (() => {

  const strategies = {};

  /** Shared helper: derive the adjacency map for a set of cells, keeping
   *  only neighbor keys that actually exist on the board. */
  function buildNeighborMap(cells) {
    const neighborKeys = new Map();
    for (const [k, cell] of cells) {
      const nbs = HexGeometry.neighbors(cell.q, cell.r)
        .map((n) => HexGeometry.key(n.q, n.r))
        .filter((nk) => cells.has(nk));
      neighborKeys.set(k, nbs);
    }
    return neighborKeys;
  }

  // ---------------------------------------------------------------------
  // Strategy: "axialRangeLoop"
  // ---------------------------------------------------------------------
  // Generates the axial rhombus-clipped hex grid with a classic double
  // for-loop (q outer, r inner clipped to stay within radius), the same
  // technique used by Red Blob Games-style implementations:
  //
  //   for (let q = -R; q <= R; q++) {
  //     const r1 = Math.max(-R, -q - R);
  //     const r2 = Math.min(R, -q + R);
  //     for (let r = r1; r <= r2; r++) { ... }
  //   }
  //
  // then derives the neighbor map from the 6 axial directions. This is
  // the strategy currently used to initialize new games.
  strategies.axialRangeLoop = function axialRangeLoop(radius) {
    const cells = new Map();
    const R = radius - 1;
    for (let q = -R; q <= R; q++) {
      const r1 = Math.max(-R, -q - R);
      const r2 = Math.min(R, -q + R);
      for (let r = r1; r <= r2; r++) {
        cells.set(HexGeometry.key(q, r), { q, r, color: null });
      }
    }
    const neighborKeys = buildNeighborMap(cells);
    return { cells, neighborKeys };
  };

  // ---------------------------------------------------------------------
  // Strategy: "ringExpansion"
  // ---------------------------------------------------------------------
  // Builds the same set of cells via HexGeometry.generateCells (which
  // walks the grid the same way, exposed as a reusable helper) and sorts
  // them ring-by-ring, angle-by-angle first. Produces an identical board
  // shape to "axialRangeLoop"; kept as a second named alternative and as
  // a basis for future strategies that care about deterministic cell
  // ordering (e.g. ring-aware piece placement).
  strategies.ringExpansion = function ringExpansion(radius) {
    const cells = new Map();
    const ordered = HexGeometry.sortByRingThenAngle(HexGeometry.generateCells(radius));
    for (const c of ordered) {
      cells.set(HexGeometry.key(c.q, c.r), { q: c.q, r: c.r, color: null });
    }
    const neighborKeys = buildNeighborMap(cells);
    return { cells, neighborKeys };
  };

  // Name of the strategy used when none is explicitly requested.
  const activeStrategy = "axialRangeLoop";

  /** Build a fresh empty board using the named strategy (defaults to the
   *  active one). Throws if the name isn't registered. */
  function init(radius, strategyName = activeStrategy) {
    const strategy = strategies[strategyName];
    if (!strategy) {
      throw new Error(`Unknown board init strategy: "${strategyName}"`);
    }
    return strategy(radius);
  }

  // ---------------------------------------------------------------------
  // Equitable piece scatter
  // ---------------------------------------------------------------------
  // Random placement alone can easily hand one color a much better
  // starting shape than the other (e.g. its pieces happen to land closer
  // together, or nearer the board's connective corridors). This does two
  // passes to fix that:
  //
  //   1. Try several independent random scatters, keep whichever leaves
  //      black and white closest in Fitness.fitness() — i.e. smallest
  //      |excess(black) - excess(white)|.
  //   2. Local search on top of that: repeatedly swap the contents of two
  //      random cells (piece<->piece or piece<->empty) and keep the swap
  //      only if it doesn't widen the gap. Sideways moves (gap unchanged)
  //      are accepted too, so the search can cross plateaus instead of
  //      getting stuck at the first local optimum.
  //
  // Both passes reuse the exact same Fitness measure the AI uses to judge
  // positions mid-game, so "equitable start" and "good position" are
  // evaluated the same way throughout the game, not by two unrelated
  // heuristics that might disagree.
  // ---------------------------------------------------------------------

  /**
   * Mutates `cells` in place, assigning 'black'/'white'/null to every
   * cell so the two colors' starting Fitness is as close as possible.
   * Returns { cells, neighborKeys, imbalance } — `imbalance` is the final
   * |excess(black) - excess(white)| achieved, handy for logging/tests.
   *
   * options:
   *   pieceRatio   fraction of cells that get a piece at all (the rest
   *                stay empty — room to move into). Default 0.6.
   *   colorSplit   fraction of placed pieces that are 'black' (rest
   *                'white'). Default 0.5 (even split).
   *   attempts     independent random scatters to try before local
   *                search; keeps the most balanced one. Default 40.
   *   improveIters swap-based local-search steps run afterwards, trying
   *                to shrink the gap further. Default 200.
   *   fitnessMode  "geometric" (fast, default — plenty for the handful of
   *                calls this makes) or "bfs" (slower, respects the real
   *                movement graph; a more faithful "equitable" on a
   *                concentric board where inner rings bottleneck).
   *   rng          () => [0,1) random source; override for deterministic
   *                tests. Defaults to Math.random.
   */
  function scatterPieces(cells, neighborKeys, options = {}) {
    if (typeof Fitness === "undefined") {
      throw new Error("BoardInit.scatterPieces needs fitness.js loaded before boardinit.js");
    }

    const {
      pieceRatio = 0.6,
      colorSplit = 0.5,
      attempts = 40,
      improveIters = 200,
      fitnessMode = "geometric",
      rng = Math.random,
    } = options;

    const keys = [...cells.keys()];
    const total = keys.length;
    const nPieces = Math.min(total, Math.max(2, Math.round(total * pieceRatio)));
    const nBlack = Math.max(1, Math.round(nPieces * colorSplit));
    const nWhite = Math.max(1, nPieces - nBlack);

    function shuffledKeys() {
      const arr = [...keys];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    function applyAssignment(order) {
      for (let i = 0; i < order.length; i++) {
        const cell = cells.get(order[i]);
        if (i < nBlack) cell.color = "black";
        else if (i < nBlack + nWhite) cell.color = "white";
        else cell.color = null;
      }
    }

    function snapshotColors() {
      return keys.map((k) => cells.get(k).color);
    }

    function restoreColors(snapshot) {
      for (let i = 0; i < keys.length; i++) cells.get(keys[i]).color = snapshot[i];
    }

    function imbalanceNow() {
      return Fitness.imbalance(cells, neighborKeys, "black", "white", { mode: fitnessMode });
    }

    // Pass 1: several independent random scatters, keep the best.
    let bestSnapshot = null;
    let bestImbalance = Infinity;
    for (let a = 0; a < attempts; a++) {
      applyAssignment(shuffledKeys());
      const imb = imbalanceNow();
      if (imb < bestImbalance) {
        bestImbalance = imb;
        bestSnapshot = snapshotColors();
      }
    }
    restoreColors(bestSnapshot);

    // Pass 2: swap-based local search, non-worsening moves accepted
    // (including sideways, to escape plateaus).
    for (let it = 0; it < improveIters; it++) {
      const i = Math.floor(rng() * keys.length);
      let j = Math.floor(rng() * keys.length);
      if (j === i) j = (j + 1) % keys.length;
      const cellA = cells.get(keys[i]);
      const cellB = cells.get(keys[j]);
      if (cellA.color === cellB.color) continue; // no-op swap

      const before = imbalanceNow();
      const tmp = cellA.color;
      cellA.color = cellB.color;
      cellB.color = tmp;
      const after = imbalanceNow();

      if (after > before) {
        // revert — this swap made the two colors less equal
        const tmp2 = cellA.color;
        cellA.color = cellB.color;
        cellB.color = tmp2;
      } else {
        bestImbalance = after;
      }
    }

    return { cells, neighborKeys, imbalance: bestImbalance };
  }

  /** Convenience one-shot: build the empty grid, then scatter pieces
   *  equitably onto it. `boardStrategy` selects the grid strategy (see
   *  `strategies`); everything else in `options` is forwarded to
   *  `scatterPieces`. */
  function initWithPieces(radius, options = {}) {
    const { boardStrategy = activeStrategy, ...scatterOptions } = options;
    const { cells, neighborKeys } = init(radius, boardStrategy);
    const { imbalance } = scatterPieces(cells, neighborKeys, scatterOptions);
    return { cells, neighborKeys, imbalance };
  }

  return { strategies, activeStrategy, init, buildNeighborMap, scatterPieces, initWithPieces };
})();