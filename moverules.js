"use strict";

/**
 * MoveRules (WebAssembly-backed)
 * ------------------------------
 * Drop-in replacement for the original moverules.js: same function names,
 * same arguments (`cells` / `neighborKeys` Maps, color strings, keys), same
 * results — including the "No enclosure" rule and its "a winning move is
 * never blocked" exception. The rule logic itself (couldPossiblyCut,
 * wouldIsolateOpponentPiece, wouldFullyConnectOwnColor, legalMoveTargets,
 * hasAnyLegalMove, getEnclosedCells, hasEnclosedPiece) is compiled from
 * src/engine.c; each call copies the board into the wasm module first
 * (O(cells), negligible next to the flood fills it saves).
 *
 * Two helpers are deliberately kept in JS because they take arbitrary JS
 * predicates (`include`) that cannot cross into wasm: floodFillKeys and
 * partitionIntoComponents. The engine no longer calls them internally (its
 * own wasm versions of those steps are specialised to the rule set), they
 * remain only for API compatibility.
 *
 * Needs wasmengine.js to have been loaded first.
 */
const MoveRules = (() => {

  function opponentOf(color) {
    return color === "black" ? "white" : "black";
  }

  /** Generic flood fill with a JS predicate (kept in JS — see header). */
  function floodFillKeys(neighborKeys, startKey, include) {
    const visited = new Set([startKey]);
    const stack = [startKey];
    while (stack.length) {
      const k = stack.pop();
      for (const nk of neighborKeys.get(k)) {
        if (visited.has(nk) || !include(nk)) continue;
        visited.add(nk);
        stack.push(nk);
      }
    }
    return visited;
  }

  /** Connected components of `keys` under `include`, largest first (kept in JS — see header). */
  function partitionIntoComponents(neighborKeys, keys, include) {
    const keySet = new Set(keys);
    const unclassified = new Set(keys);
    const components = [];
    while (unclassified.size > 0) {
      const seed = unclassified.values().next().value;
      const reached = floodFillKeys(neighborKeys, seed, include);
      const component = new Set();
      for (const k of reached) {
        if (keySet.has(k)) {
          component.add(k);
          unclassified.delete(k);
        }
      }
      components.push(component);
    }
    components.sort((a, b) => b.size - a.size);
    return components;
  }

  const code = (c) => WasmEngine.colorCode(c);

  /** Cheap local pre-filter: true if occupying `to` (with `from` vacated) MIGHT disconnect something. */
  function couldPossiblyCut(cells, neighborKeys, to, from, moverColor) {
    const { index } = WasmEngine.uploadBoard(cells, neighborKeys);
    return WasmEngine.ex().mr_could_cut(index.get(to), index.get(from), code(moverColor)) === 1;
  }

  /** True if placing a piece of `moverColor` on `to` (vacating `from`) would cut an opponent piece off. */
  function wouldIsolateOpponentPiece(cells, neighborKeys, from, to, moverColor) {
    const { index } = WasmEngine.uploadBoard(cells, neighborKeys);
    return WasmEngine.ex().mr_would_isolate(index.get(from), index.get(to), code(moverColor)) === 1;
  }

  /** True if that exact move leaves all of `moverColor`'s pieces in one group (an outright win). */
  function wouldFullyConnectOwnColor(cells, neighborKeys, from, to, moverColor) {
    const { index } = WasmEngine.uploadBoard(cells, neighborKeys);
    return WasmEngine.ex().mr_would_fully_connect(index.get(from), index.get(to), code(moverColor)) === 1;
  }

  /** Empty neighbor cells of `fromKey` that are legal destinations (same order as neighborKeys.get(fromKey)). */
  function legalMoveTargets(cells, neighborKeys, fromKey, enclosureAllowed) {
    const { keys, index } = WasmEngine.uploadBoard(cells, neighborKeys);
    const ex = WasmEngine.ex();
    const n = ex.mr_legal_targets(index.get(fromKey), enclosureAllowed ? 1 : 0);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = keys[ex.mr_target(i)];
    return out;
  }

  /** True if `color` has at least one legal move on this board. */
  function hasAnyLegalMove(cells, neighborKeys, color, enclosureAllowed) {
    WasmEngine.uploadBoard(cells, neighborKeys);
    return WasmEngine.ex().mr_has_any_legal_move(code(color), enclosureAllowed ? 1 : 0) === 1;
  }

  /** Keys of every cell in a pocket sealed off by `wallColor` that holds an opponent piece (empty Set if none). */
  function getEnclosedCells(cells, neighborKeys, wallColor) {
    const { keys } = WasmEngine.uploadBoard(cells, neighborKeys);
    const ex = WasmEngine.ex();
    const out = new Set();
    if (ex.mr_enclosed_cells(code(wallColor)) > 0) {
      for (let i = 0; i < keys.length; i++) if (ex.mr_enclosed_mark(i)) out.add(keys[i]);
    }
    return out;
  }

  /** True if the CURRENT board has an opponent piece of `wallColor` cut off by `wallColor`'s pieces. */
  function hasEnclosedPiece(cells, neighborKeys, wallColor) {
    WasmEngine.uploadBoard(cells, neighborKeys);
    return WasmEngine.ex().mr_has_enclosed(code(wallColor)) === 1;
  }

  return {
    opponentOf,
    floodFillKeys,
    partitionIntoComponents,
    couldPossiblyCut,
    wouldIsolateOpponentPiece,
    wouldFullyConnectOwnColor,
    legalMoveTargets,
    hasAnyLegalMove,
    getEnclosedCells,
    hasEnclosedPiece,
  };
})();
