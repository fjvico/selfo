"use strict";

/**
 * MoveRules
 * ---------
 * Shared "is this move legal" logic — specifically the "No enclosure"
 * rule (see FeatureConfig.no_enclosure in config.js): whether a move
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
 *    see the importScripts call near the top of aistrategies.js). It
 *    also reuses couldPossiblyCut() and hasEnclosedPiece() directly, to
 *    track each color's "is it currently walling an opponent piece in"
 *    status incrementally across the search tree (see makeMove() there)
 *    for the mutual-enclosure draw rule.
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
 * it's ever assigned to Game, or a cloned/mutated node deep in the CPU's
 * search tree.
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
   * Splits `keys` into its connected components under `include` (only
   * moving between two keys when `include` is true for the one being
   * entered), returned as an array of Sets ordered from **largest to
   * smallest**.
   *
   * `include`-connectivity is allowed to roam through cells that aren't
   * in `keys` at all (e.g. a detour through the moving piece's vacated
   * origin cell) — floodFillKeys explores the *whole* reachable region,
   * and this only keeps the members of `keys` that land in it. Because
   * of that, each pass over `reached` (a region, often a small sealed
   * pocket) is cheaper than scanning the full remaining `keys` set on
   * every component, which is why the loop below intersects against
   * `reached` rather than the other way around.
   *
   * The size ordering matters to every caller: when some cells end up
   * cut off from the rest, the largest resulting piece is treated as
   * "the main, still-open part of the board" and every other (smaller)
   * piece as a sealed-off pocket. Without singling out one component as
   * the non-trapped one, a check like "does any component contain an
   * opponent piece?" is satisfied by the big, perfectly normal main area
   * too — since it almost always still holds an opponent piece — which
   * flags the split as an enclosure even when the only thing actually
   * sealed off was empty space. That was the exact bug in an earlier
   * version of both wouldIsolateOpponentPiece and hasEnclosedPiece: a
   * move (or position) that boxed in nothing but empty cells still
   * counted as trapping a piece, because the untouched main region
   * "still holding an opponent piece" was wrongly read as evidence of
   * entrapment instead of being the one region that was never isolated.
   */
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

  // Canonical cube/axial hex directions, in cyclic order (matches the
  // cube-coordinate convention s = -q - r used elsewhere, e.g.
  // fitness.js's cubeDistance). Two entries that are adjacent in this
  // cyclic order are themselves directly adjacent hexes — every pair of
  // consecutive neighbors of a cell shares an edge with each other too,
  // forming the small triangle that tiles a hex grid. couldPossiblyCut()
  // below relies on exactly this property.
  const HEX_DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  function directionIndex(dq, dr) {
    for (let i = 0; i < 6; i++) {
      if (HEX_DIRECTIONS[i][0] === dq && HEX_DIRECTIONS[i][1] === dr) return i;
    }
    return -1;
  }

  /**
   * Cheap local pre-filter for wouldIsolateOpponentPiece: true if
   * occupying `to` (with `from` vacated) *might* disconnect something,
   * false if it provably cannot — safe to skip the expensive check
   * entirely when this returns false.
   *
   * Method: walk `to`'s six neighbors in cyclic hex order and count how
   * many separate runs of "passable" cells there are — passable meaning
   * on-board, and either `from` (always free once the move is made) or
   * any cell not colored `moverColor`. Because cyclically-consecutive
   * neighbors of a hex are themselves mutually adjacent (see
   * HEX_DIRECTIONS above), a single run means every passable neighbor
   * can already reach every other one *without* going through `to` — so
   * `to` isn't the sole connector between any two things next to it, and
   * therefore can't be the sole connector for anything farther away
   * either (a path that used `to` as one hop can always be rerouted
   * around the ring instead). More than one run doesn't prove a cut,
   * just that one might exist — exactly the case where the full
   * wouldIsolateOpponentPiece check below is worth running.
   *
   * If a neighbor's offset doesn't match one of the six canonical
   * directions (shouldn't happen on a standard hex board), this bails
   * out conservatively (true) rather than risk a false negative.
   */
  function couldPossiblyCut(cells, neighborKeys, to, from, moverColor) {
    const center = cells.get(to);
    const passable = [false, false, false, false, false, false];
    for (const nk of neighborKeys.get(to)) {
      const n = cells.get(nk);
      const idx = directionIndex(n.q - center.q, n.r - center.r);
      if (idx === -1) return true; // unexpected geometry — don't risk it
      passable[idx] = nk === from || n.color !== moverColor;
    }
    let runs = 0;
    for (let d = 0; d < 6; d++) {
      if (passable[d] && !passable[(d + 5) % 6]) runs++;
    }
    return runs > 1;
  }

  /**
   * True if placing a piece of `moverColor` on `to` (vacating `from`)
   * would cut some opponent piece off from part of the board it could
   * currently reach — whether that piece ends up directly boxed in, or
   * shut inside a pocket of empty cells and/or other same-color pieces
   * with no way out. Checking only `to`'s immediate neighbors isn't
   * enough: a piece one step further away, sitting in a small
   * closed-off room, is just as trapped. Callers on a hot path should
   * try couldPossiblyCut() first — see legalMoveTargets below — since
   * this does real work (two flood fills over the board) every time.
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
   * into more than one component, the largest is treated as the
   * still-open main area and every other (smaller) component as a
   * sealed-off pocket — see partitionIntoComponents. If one of those
   * pockets holds an opponent piece, that piece has been cut off from
   * the rest — the move is disallowed. A pocket holding nothing but
   * empty cells does not count: no piece was actually trapped, so there
   * is nothing here for the "No enclosure" rule to object to. Gated by
   * the "No enclosure" setup toggle — see legalMoveTargets.
   */
  function wouldIsolateOpponentPiece(cells, neighborKeys, from, to, moverColor) {
    const opponentColor = opponentOf(moverColor);
    const preColor = (key) => cells.get(key).color;

    const regionBefore = floodFillKeys(neighborKeys, to, (k) => preColor(k) !== moverColor);

    let hasOpponentNearby = false;
    const mustStayConnected = [];
    for (const k of regionBefore) {
      if (preColor(k) === opponentColor) hasOpponentNearby = true;
      if (k !== to) mustStayConnected.push(k);
    }
    if (!hasOpponentNearby) return false;
    if (mustStayConnected.length === 0) return false; // nothing else in the region to disconnect

    const postColor = (key) => {
      if (key === to) return moverColor;
      if (key === from) return null;
      return cells.get(key).color;
    };

    // Partition mustStayConnected into its post-move connected
    // components (roaming freely through any non-moverColor cell while
    // flood-filling, not just members of mustStayConnected, so a detour
    // through `from` still counts as one path). The largest component is
    // the main area that stayed open; only opponent pieces in one of the
    // smaller, actually-sealed-off components count as trapped.
    const components = partitionIntoComponents(neighborKeys, mustStayConnected, (k) => postColor(k) !== moverColor);
    if (components.length <= 1) return false;

    for (let i = 1; i < components.length; i++) {
      for (const k of components[i]) {
        if (preColor(k) === opponentColor) return true;
      }
    }
    return false;
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
   *  choice, so the enclosure rule steps aside for it — a move that both
   *  wins AND encloses is a win, never blocked, and never later scored
   *  as a mutual-enclosure draw (see performMove in script.js and
   *  aistrategies.js's own terminal-condition ordering, which both check
   *  connection before enclosure for exactly this reason). */
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
   * (i.e. the "No enclosure" setup toggle is checked — on by default,
   * see FeatureConfig.no_enclosure in config.js; callers pass
   * `!Game.noEnclosure`), it also excludes any
   * destination that would trap an opponent piece — directly boxed in
   * or sealed inside an enclosed pocket — *unless* that exact move is
   * the one that fully connects the mover's own pieces (see
   * wouldFullyConnectOwnColor): a winning move is never blocked by this
   * rule, enclosure toggle or not. couldPossiblyCut() is tried first as
   * a cheap local filter — if it says a destination provably can't trap
   * anything, wouldIsolateOpponentPiece's full board-wide check is
   * skipped entirely, which is what most destinations hit in practice.
   * Shared by human highlighting, click-to-move, drag-to-move,
   * buildBoard's own setup validation, and the CPU's move search, so all
   * of them agree on what counts as a legal move.
   */
  function legalMoveTargets(cells, neighborKeys, fromKey, enclosureAllowed) {
    const moverColor = cells.get(fromKey).color;
    return neighborKeys.get(fromKey).filter((nk) => {
      if (cells.get(nk).color) return false;
      if (!enclosureAllowed &&
          couldPossiblyCut(cells, neighborKeys, nk, fromKey, moverColor) &&
          wouldIsolateOpponentPiece(cells, neighborKeys, fromKey, nk, moverColor)) {
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

  /**
   * Keys of every cell presently sealed off from the main open area by
   * `wallColor`'s pieces *and* holding at least one `wallColor`-opponent
   * piece somewhere in that same sealed-off pocket — i.e. the full pocket
   * (pieces and empty cells alike), not just the trapped piece's own
   * cell, for every pocket that actually traps someone. Pockets holding
   * nothing but empty cells are not included (see partitionIntoComponents
   * for why "empty-only" must never count as an enclosure). Returns an
   * empty Set if nothing is enclosed.
   *
   * hasEnclosedPiece is defined in terms of this (see below) so the two
   * can never disagree about what counts as an enclosure; UI code that
   * wants to *show* the enclosed area (e.g. tinting those cells at the
   * end of a mutual-enclosure draw) should call this directly rather
   * than re-deriving it.
   */
  function getEnclosedCells(cells, neighborKeys, wallColor) {
    const trappedColor = opponentOf(wallColor);
    const nonWallKeys = [];
    for (const [k, cell] of cells) if (cell.color !== wallColor) nonWallKeys.push(k);
    if (nonWallKeys.length === 0) return new Set();

    const components = partitionIntoComponents(neighborKeys, nonWallKeys, (k) => cells.get(k).color !== wallColor);
    const enclosed = new Set();
    for (let i = 1; i < components.length; i++) {
      const hasTrapped = [...components[i]].some((k) => cells.get(k).color === trappedColor);
      if (hasTrapped) for (const k of components[i]) enclosed.add(k);
    }
    return enclosed;
  }

  /** True if the CURRENT board (no hypothetical move — this checks the
   *  position as it actually stands, after a move has already been
   *  applied) has at least one `wallColor`-opponent piece cut off from
   *  the rest of the board by `wallColor`'s pieces. Same underlying idea
   *  as wouldIsolateOpponentPiece's region-fragmentation check, but
   *  static — see getEnclosedCells, which this is a thin boolean wrapper
   *  around so the two can never disagree.
   *
   *  Used for the "mutual enclosure" draw rule (see performMove): when
   *  "No enclosure" is off, a single move can leave BOTH colors with a
   *  piece enclosed by the other at once (e.g. two pieces sealing each
   *  other's only exits shut in the same move) — neither side can ever
   *  undo that, so the game is a draw rather than staying stuck. Also
   *  called by aistrategies.js to keep its own incremental
   *  enclosureState in sync during search — see makeMove() there. */
  function hasEnclosedPiece(cells, neighborKeys, wallColor) {
    return getEnclosedCells(cells, neighborKeys, wallColor).size > 0;
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