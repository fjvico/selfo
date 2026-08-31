"use strict";

/**
 * Fitness
 * -------
 * Shared "goodness of connection" measure for a color's pieces, used both
 * by AiStrategies (position evaluation / move ordering during search) and
 * by BoardInit (to judge how balanced a random starting scatter is).
 *
 * Core idea: a group of pieces is "well connected" when a Minimum
 * Spanning Tree (MST) over their pairwise distances is small. If a color
 * has n pieces and they already form one connected group (every MST edge
 * has length 1), the MST weight is exactly n-1 -- the theoretical
 * minimum for n points. Anything above that is "excess" distance that
 * still has to be closed by future moves, so lower excess = better:
 *
 *   excess(color) = mstWeight(color) - (n_color - 1)      [>= 0, 0 = fully connected]
 *
 * Two distance functions are provided, deliberately kept apart because
 * they have very different cost profiles:
 *
 *  - "geometric" (fast, O(n^2) pairwise + O(n^2 log n) Kruskal): straight
 *    hex distance, ignoring who's standing where. Cheap enough to call at
 *    every leaf of a deep game-tree search. Independent of a HexGeometry
 *    dependency on purpose (this file has none), so it can be pulled into
 *    a Worker with a single importScripts call.
 *
 *  - "bfs" (accurate, O(n * cells)): shortest path on the actual movement
 *    graph, treating opponent pieces as blocked cells. Reflects real
 *    board bottlenecks (important on a concentric board, where inner
 *    rings have few connecting corridors) but is too expensive to run at
 *    every node of a deep search. Meant for low-frequency evaluation:
 *    judging a candidate initial scatter (BoardInit), or a one-off sanity
 *    check on a chosen move -- not the search hot loop.
 *
 * Neither function depends on HexGeometry or on AiStrategies/BoardInit,
 * so it can be loaded standalone (browser <script>, or `importScripts`
 * inside a Worker) by whichever of the two callers needs it.
 */
const Fitness = (() => {

  // ---- shared small helpers -------------------------------------------------

  function otherColor(color) {
    return color === "black" ? "white" : "black";
  }

  function piecesOf(cells, color) {
    const out = [];
    for (const [k, cell] of cells) if (cell.color === color) out.push(k);
    return out;
  }

  /** Straight hex distance between two axial cells (cube-coordinate
   *  formula). Duplicated here rather than imported from HexGeometry so
   *  this file has zero dependencies. */
  function cubeDistance(q1, r1, q2, r2) {
    const s1 = -q1 - r1;
    const s2 = -q2 - r2;
    return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(s1 - s2));
  }

  /** Kruskal's algorithm over an explicit weighted edge list. Returns the
   *  total MST weight (or spanning-forest weight, which never happens
   *  here since every graph we build is complete/connected). */
  function mstWeight(nodeKeys, edges) {
    if (nodeKeys.length <= 1) return 0;
    const parent = new Map(nodeKeys.map((k) => [k, k]));
    function find(x) {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra === rb) return false;
      parent.set(ra, rb);
      return true;
    }
    edges.sort((a, b) => a.w - b.w);
    let total = 0, used = 0;
    for (const e of edges) {
      if (used === nodeKeys.length - 1) break;
      if (union(e.a, e.b)) { total += e.w; used++; }
    }
    return total;
  }

  // ---- geometric (obstacle-free) MST -----------------------------------------

  function geometricEdges(cells, keys) {
    const edges = [];
    for (let i = 0; i < keys.length; i++) {
      const a = cells.get(keys[i]);
      for (let j = i + 1; j < keys.length; j++) {
        const b = cells.get(keys[j]);
        edges.push({ a: keys[i], b: keys[j], w: cubeDistance(a.q, a.r, b.q, b.r) });
      }
    }
    return edges;
  }

  function geometricMSTWeight(cells, color) {
    const keys = piecesOf(cells, color);
    return { weight: mstWeight(keys, geometricEdges(cells, keys)), count: keys.length };
  }

  // ---- BFS (obstacle-aware) MST ----------------------------------------------

  /** Single-source BFS from `startKey` over the real movement graph: own
   *  pieces and empty cells cost 1 to enter, opponent-colored cells are
   *  walls. Returns Map<key, distance> for every reachable key. */
  function bfsDistances(cells, neighborKeys, startKey, blockedColor) {
    const dist = new Map([[startKey, 0]]);
    const queue = [startKey];
    let head = 0;
    while (head < queue.length) {
      const k = queue[head++];
      const d = dist.get(k);
      for (const nk of neighborKeys.get(k)) {
        if (dist.has(nk)) continue;
        if (cells.get(nk).color === blockedColor) continue; // opponent piece blocks
        dist.set(nk, d + 1);
        queue.push(nk);
      }
    }
    return dist;
  }

  function bfsEdges(cells, neighborKeys, keys, blockedColor) {
    const edges = [];
    for (let i = 0; i < keys.length; i++) {
      const distances = bfsDistances(cells, neighborKeys, keys[i], blockedColor);
      for (let j = i + 1; j < keys.length; j++) {
        const d = distances.get(keys[j]);
        // Unreachable (fully walled off) -> large-but-finite penalty
        // instead of Infinity, so the MST sum stays a usable number.
        edges.push({ a: keys[i], b: keys[j], w: d === undefined ? cells.size : d });
      }
    }
    return edges;
  }

  function bfsMSTWeight(cells, neighborKeys, color) {
    const keys = piecesOf(cells, color);
    const blockedColor = otherColor(color);
    return { weight: mstWeight(keys, bfsEdges(cells, neighborKeys, keys, blockedColor)), count: keys.length };
  }

  // ---- public API -------------------------------------------------------------

  function excessFromWeight({ weight, count }) {
    return count <= 1 ? 0 : weight - (count - 1);
  }

  /**
   * fitness(cells, neighborKeys, color, options)
   * Lower is better -- it's an "excess distance still to close" measure,
   * not a score to maximize. Callers that want a maximize-me score
   * should negate it (see AiStrategies.colorScore).
   *
   * options.mode: "geometric" (default, fast, ignores obstacles) or
   *               "bfs" (accurate, respects opponent pieces as walls).
   */
  function fitness(cells, neighborKeys, color, options = {}) {
    const mode = options.mode || "geometric";
    const result = mode === "bfs"
      ? bfsMSTWeight(cells, neighborKeys, color)
      : geometricMSTWeight(cells, color);
    return excessFromWeight(result);
  }

  /** How unbalanced two colors' positions are (0 = perfectly symmetric
   *  difficulty). Used by BoardInit to judge/optimize a starting scatter,
   *  and reusable by AiStrategies for diagnostics. */
  function imbalance(cells, neighborKeys, colorA, colorB, options = {}) {
    return Math.abs(
      fitness(cells, neighborKeys, colorA, options) - fitness(cells, neighborKeys, colorB, options)
    );
  }

  return {
    otherColor,
    piecesOf,
    cubeDistance,
    mstWeight,
    geometricMSTWeight,
    bfsMSTWeight,
    excessFromWeight,
    fitness,
    imbalance,
  };
})();