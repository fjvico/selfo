"use strict";

/**
 * BoardInit
 * ---------
 * Board *initialization* strategies: each one builds the empty hex grid
 * (cells with no pieces yet) and its adjacency map for a given radius.
 * Piece placement (scattering black/white pieces) is a separate concern,
 * handled in script.js after the grid is created.
 *
 * Every strategy has the same signature and return shape:
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

  return { strategies, activeStrategy, init, buildNeighborMap };
})();