"use strict";

/**
 * MoveRules
 * ---------
 * Shared "is this move legal" logic — specifically the "Allow enclosure"
 * rule (see FeatureConfig.allow_enclosure in config.js): whether a move
 * that would trap an opponent piece is offered at all, with the one
 * exception that a move which fully connects the mover's own pieces (an
 * outright win) is never blocked by it.
 *
 * This lives in its own dependency-free file, rather than inside
 * script.js, because it has two very different callers that must agree
 * on exactly the same rule:
 *
 *  - script.js: human move highlighting/click/drag, and buildBoard's own
 *    setup validation (see hasAnyLegalMove there).
 *  - aistrategies.js: the CPU's move search, both on the main thread and
 *    inside its Web Worker (which loads this file via `importScripts`,
 *    since a worker doesn't share the page's already-loaded scripts —
 *    see the importScripts call near the top of aistrategies.js).
 *
 * If the CPU used a different (or no) notion of "legal move" than the
 * human UI, computer vs computer (and vs computer) games would silently
 * ignore the enclosure toggle instead of respecting it like every other
 * mode. Keeping one shared implementation is what guarantees they can't
 * drift apart.
 *
 * Every function here takes `cells`/`neighborKeys` explicitly (never a
 * global board state), so it works the same whether the board in
 * question is the live Game, a hypothetical board being validated before
 * it's ever assigned to Game, or a cloned node deep in the CPU's search
 * tree.
 */
const MoveRules = (() => {

  function opponentOf(color) {
    return color === "black" ? "white" : "black";
  }

  /** Flood-fills from `startKey` over cells that satisfy `include(key)`,
   *  moving only through board adjacency (`neighborKeys`). Returns the
   *  Set of every key reached (including startKey itself). */
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

  /**
   * True if placing a piece of `moverColor` on `to` (vacating `from`)
   * would cut some opponent piece off from part of the board it could
   * currently reach — whether that piece ends up directly boxed in, or
   * shut inside a pocket of empty cells and/or other same-color pieces
   * with no way out. Checking only `to`'s immediate neighbors isn't
   * enough: a piece one step further away, sitting in a small
   * closed-off room, is just as trapped.
   *
   * Method: `to` is currently empty, so before the move it sits in some
   * connected region of non-`moverColor` cells (empty + opponent
   * pieces). If that region contains no opponent piece at all, this move
   * can't trap anyone — bail out early. Otherwise, check whether the
   * rest of that region (everything but `to`) stays in one piece once
   * `to` is occupied — `from` becomes empty and can act as a detour,
   * since it's always adjacent to `to`. This is done by partitioning
   * that "rest of the region" into its post-move connected components
   * (not by picking one arbitrary cell and checking who can still reach
   * it: if that pick happened to be the very piece getting trapped, it
   * trivially "reaches itself" and the split goes unnoticed — an early
   * version of this function had exactly that bug). If the region splits
   * into more than one component and at least one of them still holds an
   * opponent piece, that piece has been cut off from the rest — the move
   * is disallowed. Gated by the "Allow enclosure" setup toggle — see
   * legalMoveTargets.
   */
  function wouldIsolateOpponentPiece(cells, neighborKeys, from, to, moverColor) {
    const opponentColor = opponentOf(moverColor);
    const preColor = (key) => cells.get(key).color;

    const regionBefore = floodFillKeys(neighborKeys, to, (k) => preColor(k) !== moverColor);
    const hasOpponentNearby = [...regionBefore].some((k) => preColor(k) === opponentColor);
    if (!hasOpponentNearby) return false;

    const mustStayConnected = [...regionBefore].filter((k) => k !== to);
    if (mustStayConnected.length === 0) return false; // nothing else in the region to disconnect

    const postColor = (key) => {
      if (key === to) return moverColor;
      if (key === from) return null;
      return cells.get(key).color;
    };

    // Partition mustStayConnected into its post-move connected
    // components (roaming freely through any non-moverColor cell while
    // flood-filling, not just members of mustStayConnected, so a detour
    // through `from` still counts as one path).
    const unclassified = new Set(mustStayConnected);
    let componentCount = 0;
    let opponentComponentCount = 0;
    while (unclassified.size > 0) {
      const seed = unclassified.values().next().value;
      const reached = floodFillKeys(neighborKeys, seed, (k) => postColor(k) !== moverColor);
      let hasOpponent = false;
      for (const k of [...unclassified]) {
        if (reached.has(k)) {
          unclassified.delete(k);
          if (preColor(k) === opponentColor) hasOpponent = true;
        }
      }
      componentCount++;
      if (hasOpponent) opponentComponentCount++;
    }

    return componentCount > 1 && opponentComponentCount > 0;
  }

  /** True if moving `moverColor`'s piece from `from` to `to` would leave
   *  every one of `moverColor`'s own pieces in a single connected group —
   *  i.e. this exact move wins the game outright. Checked hypothetically
   *  (via the same to/from color-override trick as
   *  wouldIsolateOpponentPiece) rather than by mutating `cells`, since
   *  it's only used to decide whether a move should be *allowed*, before
   *  it's actually made. Used to carve out the one case where enclosing
   *  an opponent piece is fine anyway: if it's the move that completes
   *  your own connection, winning the game can never be the wrong
   *  choice, so the enclosure rule steps aside for it. */
  function wouldFullyConnectOwnColor(cells, neighborKeys, from, to, moverColor) {
    const effectiveColor = (key) => {
      if (key === to) return moverColor;
      if (key === from) return null;
      return cells.get(key).color;
    };

    const ownKeys = [];
    for (const [k] of cells) if (effectiveColor(k) === moverColor) ownKeys.push(k);
    if (ownKeys.length <= 1) return true; // 0 or 1 piece is trivially "one group"

    const visited = new Set([ownKeys[0]]);
    const stack = [ownKeys[0]];
    while (stack.length) {
      const k = stack.pop();
      for (const nk of neighborKeys.get(k)) {
        if (visited.has(nk)) continue;
        if (effectiveColor(nk) === moverColor) { visited.add(nk); stack.push(nk); }
      }
    }
    return visited.size === ownKeys.length;
  }

  /**
   * Empty neighbor cells of `fromKey` that are legal move destinations:
   * always excludes occupied cells. When `enclosureAllowed` is false
   * (the "Allow enclosure" setup toggle, off by default — see
   * FeatureConfig.allow_enclosure in config.js), it also excludes any
   * destination that would trap an opponent piece — directly boxed in
   * or sealed inside an enclosed pocket — *unless* that exact move is
   * the one that fully connects the mover's own pieces (see
   * wouldFullyConnectOwnColor): a winning move is never blocked by this
   * rule, enclosure toggle or not. Shared by human highlighting,
   * click-to-move, drag-to-move, buildBoard's own setup validation, and
   * the CPU's move search, so all of them agree on what counts as a
   * legal move.
   */
  function legalMoveTargets(cells, neighborKeys, fromKey, enclosureAllowed) {
    const moverColor = cells.get(fromKey).color;
    return neighborKeys.get(fromKey).filter((nk) => {
      if (cells.get(nk).color) return false;
      if (!enclosureAllowed && wouldIsolateOpponentPiece(cells, neighborKeys, fromKey, nk, moverColor)) {
        return wouldFullyConnectOwnColor(cells, neighborKeys, fromKey, nk, moverColor);
      }
      return true;
    });
  }

  /** True if `color` has at least one legal move on this board — used by
   *  buildBoard to make sure a freshly-generated layout is actually
   *  playable before it's accepted. */
  function hasAnyLegalMove(cells, neighborKeys, color, enclosureAllowed) {
    for (const [k, cell] of cells) {
      if (cell.color === color && legalMoveTargets(cells, neighborKeys, k, enclosureAllowed).length > 0) return true;
    }
    return false;
  }

  return {
    opponentOf,
    floodFillKeys,
    wouldIsolateOpponentPiece,
    wouldFullyConnectOwnColor,
    legalMoveTargets,
    hasAnyLegalMove,
  };
})();