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
 * moves do, since both paths call MoveRules.legalMoveTargets. It also
 * reuses MoveRules.couldPossiblyCut/hasEnclosedPiece directly (not just
 * through legalMoveTargets) to track each color's enclosure status
 * incrementally across the search tree — see makeMove() below.
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
 *     maxDepth:       number, // ply cap — 0/undefined = no cap (time-governed
 *                             // only; see minimaxAlphaBetaID()'s doc comment),
 *                             // 1-5 = an explicit fixed cap (see
 *                             // GAME_PARAM_RANGES.cpuDepth in config.js)
 *     maxTimeSeconds: number  // wall-clock budget (UI: think time)
 *   }
 *
 * Return shape:
 *   { move: { from, to } | null, score: number, nodesEvaluated: number, depthReached: number,
 *     forcedWinInPlies: number | null, forcedLossInPlies: number | null }
 *   (nodesEvaluated/depthReached are search-stats for the ?showAdvanced=
 *   true CPU log in script.js — see minimaxAlphaBetaID()'s own doc comment
 *   below for exactly what each counts. forcedWinInPlies/forcedLossInPlies
 *   are set only once the search has *proven* a forced result (see
 *   MATE_THRESHOLD below) — they feed that same ?showAdvanced=true log and
 *   the search's own early-exit decision. forcedWinInPlies stays internal:
 *   script.js must not surface it in the player-facing UI, since telling
 *   the player the outcome is already decided would spoil a position the
 *   game is deliberately still playing out. forcedLossInPlies is the one
 *   deliberate exception: script.js's applyCpuResult()/updateCompactBar()
 *   use it to lay the android icon down while the CPU knows it has lost
 *   (and stand it back up if a later search no longer sees a forced
 *   loss). A strategy that doesn't do a
 *   depth-limited tree search at all — or, like minimaxAlphaBetaCloning
 *   below, doesn't track mate distance — is free to omit any of these
 *   four fields; script.js treats them all as optional and simply
 *   doesn't log a line/field it can't fill.)
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

  // -----------------------------------------------------------------------
  // Zobrist hashing, for the transposition table (see the TT section
  // below and `tt` in minimax()/searchAtDepth()/minimaxAlphaBetaID()).
  // One random 32-bit int per (cell key, color) pair, generated lazily
  // the first time a given cell key is ever seen — board radius (hence
  // which keys exist) can differ between games in the same page session,
  // so this can't be precomputed up front for "the board". The table
  // itself has no dependency on any particular board's *contents*, only
  // its *keys*, so it's safe to keep (and reuse) at module scope across
  // every search this page ever runs, unlike `tt` itself which is fresh
  // per pickMove() call — see minimaxAlphaBetaID()'s doc comment for why.
  //
  // Full 32 bits (not 31) — see the TT section below for why the extra
  // bit is worth having now that every entry is verified against its
  // full stored key on read, rather than trusted purely by table index.
  // -----------------------------------------------------------------------
  const zobristTable = new Map(); // cell key -> { black: number, white: number }
  function rand32() {
    return (Math.random() * 0x100000000) | 0; // full-width signed int32
  }
  function zobristFor(key) {
    let entry = zobristTable.get(key);
    if (!entry) {
      entry = { black: rand32(), white: rand32() };
      zobristTable.set(key, entry);
    }
    return entry;
  }

  /** Zobrist hash of the *current* contents of `cells` — XOR of one random
   *  number per occupied cell (see zobristFor() above). Computed once, up
   *  front, per minimaxAlphaBetaID() call; every make/unmake incrementally
   *  updates it from there (see makeMove() below) rather than recomputing
   *  it from scratch at every node. */
  function computeHash(cells) {
    let hash = 0;
    for (const [k, cell] of cells) {
      if (cell.color) hash ^= zobristFor(k)[cell.color];
    }
    return hash;
  }

  /** One more random 32-bit value, XORed into the transposition-table key
   *  when it is WHITE's turn to move at the node (see ttKeyFor()). The
   *  board hash alone (computeHash() above) only says where the pieces
   *  are, not whose turn it is — and the same arrangement CAN recur with
   *  the other side to move (e.g. one color walks a piece around a
   *  three-cell triangle while the other steps a piece out and back: five
   *  plies, same pieces on the same cells, turn flipped). Without the
   *  side to move in the key such a node reads the wrong side's stored
   *  score and best move, which quietly corrupts results — including the
   *  exact win/loss distances that both the forced-loss detection and the
   *  choice among lost moves (see searchAtDepth()) depend on. `|| 1` so
   *  the (astronomically unlikely) all-zero draw can't turn it into a
   *  no-op. */
  const SIDE_TO_MOVE_KEY = rand32() || 1;

  /** Transposition-table key for a node: the incremental board hash plus
   *  who is to move there. */
  function ttKeyFor(boardHash, moverColor) {
    return moverColor === "white" ? boardHash ^ SIDE_TO_MOVE_KEY : boardHash;
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
   * closure that restores the board, `connState`, `enclosureState`, and
   * `hashState` (see below) to exactly how they were before this call;
   * callers MUST invoke it exactly once, in a `finally` block, so
   * everything is correctly restored even when a SearchTimeoutError
   * unwinds the recursion mid-search (see minimax()'s deadline check) —
   * otherwise the next sibling move explored, or the next
   * iterative-deepening depth, would silently start from a corrupted
   * board.
   *
   * `connState` — { black: boolean, white: boolean }, "is this color
   * currently one fully-connected group" — is the incremental-connectivity
   * piece: moving a piece can only change *its own* color's connectivity
   * (the opponent's pieces don't move), so only that one color is
   * recomputed here (still an O(n) scan — see isGroupFullyConnected — but
   * exactly one of the two BFS calls minimax() used to always do
   * unconditionally at every node, not both).
   *
   * `enclosureState` — { black: boolean, white: boolean }, "is this
   * color currently walling at least one opponent piece into a sealed
   * pocket" (see MoveRules.hasEnclosedPiece) — is the same idea applied
   * to the mutual-enclosure draw rule: only `color`'s own move can
   * change whether *its* pieces wall someone in, so only that color is
   * touched. Unlike connState, the full check (a flood fill over the
   * board) is real work, so it's only run when it could actually have
   * changed — either a wall already existed before this move (moving
   * away might have broken it) or MoveRules.couldPossiblyCut says the
   * new position might create one. On the common move that neither
   * breaks nor creates a wall, this is an O(1) carry-forward. Entirely
   * skipped (stays false/false) when enclosureAllowed is false, since
   * "No enclosure" makes the draw unreachable in the first place — see
   * MoveRules.legalMoveTargets and minimax()'s own draw check below.
   *
   * `hashState` — { value: number }, the current position's Zobrist hash
   * (see computeHash() above) — is the transposition-table piece: moving
   * a piece just XORs out its old (key, color) contribution and XORs in
   * the new one, incrementally, rather than rehashing the whole board.
   * XOR being its own inverse is exactly what makes the undo side trivial.
   */
  function makeMove(cells, neighborKeys, from, to, connState, enclosureState, hashState, enclosureAllowed) {
    const color = cells.get(from).color;
    const prevConn = connState[color];
    const prevEnclosure = enclosureState[color];
    const fromZ = zobristFor(from)[color];
    const toZ = zobristFor(to)[color];
    cells.get(from).color = null;
    cells.get(to).color = color;
    connState[color] = isGroupFullyConnected(cells, neighborKeys, color);
    if (enclosureAllowed &&
        (prevEnclosure || MoveRules.couldPossiblyCut(cells, neighborKeys, to, from, color))) {
      enclosureState[color] = MoveRules.hasEnclosedPiece(cells, neighborKeys, color);
    } else {
      enclosureState[color] = prevEnclosure; // provably unchanged — see comment above
    }
    hashState.value ^= fromZ ^ toZ;
    return function undoMove() {
      cells.get(to).color = null;
      cells.get(from).color = color;
      connState[color] = prevConn;
      enclosureState[color] = prevEnclosure;
      hashState.value ^= fromZ ^ toZ; // XOR is its own inverse
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

  /** Straight hex distance between two cells (cube coordinates, s = -q-r —
   *  same formula as Fitness.cubeDistance, repeated here so the search
   *  doesn't depend on fitness.js, which the Worker doesn't load). */
  function hexDistance(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }

  /** Size of the largest connected group of `color`, plus a cohesion bonus
   *  counting each ally-ally adjacency once (pairs of touching same-color
   *  pieces) — used to reward clustering even before a full connection —
   *  plus `looseGap`: how far the color's OTHER groups still are from its
   *  largest one.
   *
   *  looseGap, per loose group: (hex distance from that group to the
   *  largest group) - 1, i.e. how many empty cells still have to be
   *  bridged (two separate groups are never adjacent, so this is >= 1);
   *  summed over every loose group, and 0 when the color is already one
   *  group. Group size and adjacency only change when a piece actually
   *  touches the group, so on their own they can't tell "one stray piece
   *  three cells away" from "one stray piece three cells away, one step
   *  closer": every quiet move scores the same and the search has nothing
   *  to steer by — it can shuffle pieces inside the group indefinitely
   *  instead of bringing the last one in. This term is that missing
   *  slope. It is plain geometric distance (ignores pieces in the way,
   *  like Fitness's "geometric" mode) and costs nothing when there are no
   *  loose groups, the usual case for a color that's close to winning. */
  function analyzeColor(cells, neighborKeys, color) {
    const visited = new Set();
    let largestGroup = 0;
    let largestStart = 0;
    let allyAdjacencyPairs = 0;
    const pieces = [];       // the color's pieces, one connected group after another
    const groupStarts = [];  // where each group begins in `pieces`

    for (const [k, cell] of cells) {
      if (cell.color !== color || visited.has(k)) continue;
      const start = pieces.length;
      groupStarts.push(start);
      const stack = [k];
      visited.add(k);
      while (stack.length) {
        const ck = stack.pop();
        pieces.push(cells.get(ck));
        for (const nk of neighborKeys.get(ck)) {
          if (cells.get(nk).color !== color) continue;
          allyAdjacencyPairs += 0.5; // each pair is seen from both sides
          if (!visited.has(nk)) { visited.add(nk); stack.push(nk); }
        }
      }
      const size = pieces.length - start;
      if (size > largestGroup) { largestGroup = size; largestStart = start; }
    }

    let looseGap = 0;
    if (groupStarts.length > 1) {
      const largestEnd = largestStart + largestGroup;
      for (let g = 0; g < groupStarts.length; g++) {
        const from = groupStarts[g];
        if (from === largestStart) continue;
        const to = g + 1 < groupStarts.length ? groupStarts[g + 1] : pieces.length;
        let nearest = Infinity;
        for (let i = from; i < to && nearest > 2; i++) {
          for (let j = largestStart; j < largestEnd; j++) {
            const d = hexDistance(pieces[i], pieces[j]);
            if (d < nearest) nearest = d;
          }
        }
        looseGap += nearest - 1; // (2 is the closest two separate groups can be)
      }
    }
    return { largestGroup, allyAdjacencyPairs, looseGap };
  }

  /** Effective depth cap used when maxDepth is left at 0/unspecified (see
   *  minimaxAlphaBetaID()'s doc comment) — deliberately a large *finite*
   *  number, not Infinity. Recursion depth is real call-stack depth in
   *  JS — a truly unbounded search could risk a stack overflow on a
   *  genuinely low-branching, slow-to-resolve position, particularly
   *  inside a Worker, which isn't guaranteed the same stack size as the
   *  main thread. (An earlier version of this file also needed this cap
   *  to stop a "depth" component of the win/loss score from blowing up
   *  the score's scale on some positions; now that win/loss scores are
   *  based on ply-from-root instead — see MATE_THRESHOLD/toTT/fromTT
   *  below — that particular risk is gone, but the stack-depth reason
   *  alone is enough to keep this.) 40 plies is already far beyond
   *  anything the time budget realistically lets a real board reach
   *  (this game's actual move generation/evaluation cost, unlike a
   *  synthetic benchmark, makes even depth 10-15 slow on a non-trivial
   *  board) — "unreachable in practice" per GAME_PARAM_RANGES.cpuDepth's
   *  doc comment in config.js, just as a generous finite ceiling instead
   *  of true Infinity. */
  const NO_DEPTH_CAP_LIMIT = 40;

  /** Upper bound on the extra confirmation searches searchAtDepth() may
   *  run to break a tie between equally-lost root moves — see its
   *  "Choosing among LOST root moves" comment. */
  const MAX_TIE_CONFIRMATIONS = 6;

  /** How many plies deep the search must have completed before it may stop
   *  because the position merely looks good (SCORE.GOOD_ENOUGH) or
   *  provably lost. 3 = its own move, the reply, its next move: enough to
   *  see any win that is one or two of its own moves away (and to find
   *  the most stubborn defense when losing), while still being a tiny
   *  fraction of the cost of a full-depth search. */
  const MIN_DEPTH_BEFORE_EARLY_EXIT = 3;

  // Weights for the static evaluation (tunable without touching the search).
  const SCORE = {
    WIN: 10000,
    GROUP_SIZE_WEIGHT: 100,
    ADJACENCY_WEIGHT: 5,
    // Per empty cell still to bridge between a color's loose groups and its
    // largest group — see analyzeColor()'s looseGap. Deliberately above
    // ADJACENCY_WEIGHT so that bringing a stray piece a step closer beats
    // shuffling pieces around inside the group (which can only ever move
    // the adjacency count), and far below GROUP_SIZE_WEIGHT so that
    // actually joining the group (+100 per piece) always outweighs it.
    PROXIMITY_WEIGHT: 15,
    // "Confidently ahead, stop searching and just play it" threshold — see
    // minimaxAlphaBetaID()'s early-exit checks below.
    // Exists specifically for cpuDepth left at "Auto" (see
    // GAME_PARAM_RANGES.cpuDepth in config.js): without it, a
    // time-governed search with no depth cap would always spend the
    // *entire* cpuTime budget every single move, even once the position
    // is already clearly decided — which is exactly the slow, sluggish
    // feel a low/predictable response time is meant to avoid.
    // It is only ever applied AFTER the search has looked at least
    // MIN_DEPTH_BEFORE_EARLY_EXIT moves deep, and only ever ends the
    // *iterative deepening*, never the comparison of root moves inside one
    // depth (see searchAtDepth()). Applied any earlier or any looser, it
    // makes the CPU play the first "fine-looking" move it generates: with
    // a nearly-connected group almost every quiet move scores above this
    // bar, so it would shuffle a piece back and forth inside the group
    // forever — and even walk past a win one step away — because it never
    // got as far as looking at the winning move.
    // A rough sense of scale: colorScore() is (largest connected group)
    // * GROUP_SIZE_WEIGHT (100) + (adjacent-ally pairs) * ADJACENCY_WEIGHT
    // (5) - (gap to loose groups) * PROXIMITY_WEIGHT (15), and
    // evaluatePosition() is that minus the opponent's own score — so this
    // threshold corresponds to roughly a 4-piece larger connected group
    // than the opponent's, with some cohesion bonus on top. Tune this
    // constant directly if actual play shows it stopping too eagerly
    // (weak moves accepted) or not eagerly enough (still burning the full
    // time budget on already-decided positions).
    GOOD_ENOUGH: 450,
  };

  // A score at or beyond this magnitude is a *proven* forced win/loss,
  // not just a strong static evaluation — evaluatePosition() never gets
  // close (see colorScore()'s comment above: even a huge material/cohesion
  // lead tops out far below this), so there's no risk of a merely-good
  // position being mistaken for a proven one. Used to: (a) decide when a
  // TT-stored score needs the ply-adjustment round-trip below, and (b)
  // let minimaxAlphaBetaID() stop early on a provably lost position — see
  // its own doc comment.
  const MATE_THRESHOLD = SCORE.WIN - NO_DEPTH_CAP_LIMIT;

  /**
   * Win/loss scores are expressed as SCORE.WIN minus the number of plies
   * from the *root* of the current search to the win — see minimax()'s
   * terminal checks below — so that a faster forced win always scores
   * higher than a slower one, and a slower forced loss always scores
   * higher (less bad) than a faster one, at any point in the tree.
   *
   * That "plies from root" framing is exactly what makes a score
   * *unsafe* to cache in the transposition table as-is: the same
   * position can be reached again by transposition at a *different*
   * ply-from-root, and a stored value tied to the wrong ply would be
   * silently wrong. The standard fix is to store mate scores relative to
   * the *node* instead (distance-to-mate from there, independent of how
   * the node was reached), and convert back to root-relative on read:
   *
   *   toTT(value, ply)   — root-relative score seen while returning from
   *                        a node at `ply` plies deep -> node-relative,
   *                        for storage.
   *   fromTT(stored, ply) — node-relative score read back out of the TT
   *                        at a (possibly different) `ply` -> the correct
   *                        root-relative score for *this* occurrence.
   *
   * Ordinary (non-mate) evaluation scores are always well under
   * MATE_THRESHOLD in magnitude (see its own comment) and pass through
   * both functions unchanged.
   */
  function toTT(value, ply) {
    if (value >= MATE_THRESHOLD) return value + ply;
    if (value <= -MATE_THRESHOLD) return value - ply;
    return value;
  }
  function fromTT(stored, ply) {
    if (stored >= MATE_THRESHOLD) return stored - ply;
    if (stored <= -MATE_THRESHOLD) return stored + ply;
    return stored;
  }

  /** Static value of a color's position: group-size + adjacency-cohesion
   *  minus how far its loose groups still are from the main one (see
   *  analyzeColor()), weighted. Does NOT check for a win — callers check
   *  that separately so a win can short-circuit the search at any depth,
   *  not just depth 0. */
  function colorScore(cells, neighborKeys, color) {
    const { largestGroup, allyAdjacencyPairs, looseGap } = analyzeColor(cells, neighborKeys, color);
    return largestGroup * SCORE.GROUP_SIZE_WEIGHT
      + allyAdjacencyPairs * SCORE.ADJACENCY_WEIGHT
      - looseGap * SCORE.PROXIMITY_WEIGHT;
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

  /** Moves `ttMove` (this position's best move from a previous, shallower
   *  iterative-deepening depth — see the transposition table, `tt`, in
   *  minimax()/searchAtDepth() below) to the front of an already-ordered
   *  move list, if it's in there at all. Trying the previously-best move
   *  first is the single biggest lever for how much of the tree alpha-beta
   *  gets to prune, since it tends to establish a strong bound immediately
   *  instead of after examining every other candidate first. Returns the
   *  same array unchanged if `ttMove` is missing or already first — never
   *  mutates the input array either way. */
  function putMoveFirst(moves, ttMove) {
    if (!ttMove) return moves;
    const idx = moves.findIndex((m) => m.from === ttMove.from && m.to === ttMove.to);
    if (idx <= 0) return moves;
    const reordered = moves.slice();
    const [m] = reordered.splice(idx, 1);
    reordered.unshift(m);
    return reordered;
  }

  // -----------------------------------------------------------------------
  // Transposition table.
  //
  // A fixed-size, two-slot-per-bucket table instead of an unbounded Map:
  // bucket index is `(hash >>> 0) & TT_MASK`; each bucket holds two
  // entries, [0] kept under depth-preferred replacement (only overwritten
  // by an entry at least as deep, so a shallow probe within the same
  // iterative-deepening depth can't evict a hard-won deep result) and [1]
  // always-replace (so a bucket under heavy traffic still tracks whatever
  // was seen most recently, rather than getting stuck).
  //
  // Every entry stores its own full 32-bit hash (`key`) and ttGet()
  // compares it before trusting the entry — two different positions that
  // happen to land in the same bucket (a certainty at this table size,
  // not just a rare accident) are never treated as the same position.
  // This is what makes 32 bits enough: correctness comes from the
  // full-key comparison on every read, not from the index alone, so
  // there's no need for a wider (or BigInt-based) hash just to keep
  // collisions rare — a stale/foreign entry is simply detected and
  // treated as a miss.
  //
  // Freshly allocated per minimaxAlphaBetaID() call (see its own doc
  // comment for why: the board, the no-enclosure rule, and even which
  // color is thinking can all differ from one call to the next, and
  // reusing a table across calls risks a wrong-but-plausible stale hit
  // being worse than the modest cost of rebuilding it).
  // -----------------------------------------------------------------------
  const TT_SIZE_BITS = 16;
  const TT_SIZE = 1 << TT_SIZE_BITS;
  const TT_MASK = TT_SIZE - 1;

  function ttCreate() {
    return new Array(TT_SIZE * 2).fill(null);
  }
  function ttBucket(hash) {
    return ((hash >>> 0) & TT_MASK) * 2;
  }
  function ttGet(tt, hash) {
    const i = ttBucket(hash);
    const depthSlot = tt[i];
    if (depthSlot && depthSlot.key === hash) return depthSlot;
    const freshSlot = tt[i + 1];
    if (freshSlot && freshSlot.key === hash) return freshSlot;
    return null;
  }
  function ttSet(tt, hash, entry) {
    entry.key = hash;
    const i = ttBucket(hash);
    const depthSlot = tt[i];
    if (!depthSlot || entry.depth >= depthSlot.depth) {
      tt[i] = entry;
    } else {
      tt[i + 1] = entry;
    }
  }

  // ---------------------------------------------------------------------
  // Minimax with alpha-beta pruning (single fixed-depth search).
  // `rootColor` never changes across the recursion: it's whose
  // perspective the evaluation is scored from. `moverColor` is whichever
  // color is actually choosing a move at this node. `ply` is how many
  // moves have been made since the actual root position (used only for
  // mate-score scaling — see toTT/fromTT above). `counter` is a
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
  // above) instead of cloning a new board per node, reads
  // connState[color]/enclosureState[color] instead of re-deriving them
  // for both colors at every single node (see makeMove()'s comment for
  // why only the mover's color ever needs recomputing), and consults a
  // transposition table (`tt`, keyed by hashState.value plus the side to
  // move — see makeMove()/computeHash()/ttKeyFor() above) both to
  // short-circuit a node outright
  // when a deep-enough cached result already settles it, and — even when
  // it doesn't — to try that position's previously-best move first (see
  // putMoveFirst()), which is normally the single biggest lever on how
  // much alpha-beta gets to prune. `cells` is mutated and restored in
  // place across the whole call; nothing here is safe to call
  // concurrently against the same `cells`/`connState`/`enclosureState`/
  // `hashState` tuple.
  //
  // Standard fail-soft alpha-beta + TT: `flagOf(value, alphaOrig, beta)`
  // records whether the returned value is exact, or only a bound (because
  // this node cut off early against the *caller's* window rather than
  // fully resolving) — see TT_EXACT/TT_LOWER/TT_UPPER just below.
  // ---------------------------------------------------------------------
  const TT_EXACT = 0; // value is this node's true minimax value
  const TT_LOWER = 1; // value is a lower bound (search cut off on a fail-high / beta cutoff)
  const TT_UPPER = 2; // value is an upper bound (nothing beat alpha)

  function minimax(cells, neighborKeys, moverColor, rootColor, depth, ply, alpha, beta, deadline, enclosureAllowed, counter, connState, enclosureState, hashState, tt) {
    if (nowMs() > deadline) throw new SearchTimeoutError();

    const opponentOfRoot = otherColor(rootColor);
    // Win/loss short-circuits the search at any depth. Checked before the
    // mutual-enclosure draw just below, matching performMove()'s own
    // precedence in script.js: a move that simultaneously completes the
    // mover's connection AND would enclose an opponent is a win, never a
    // draw — MoveRules.wouldFullyConnectOwnColor already exempts a
    // winning move from the "No enclosure" rule itself, so this exact
    // situation is reachable (a move that both wins and walls someone in)
    // even with the toggle on, and the order here has to agree.
    if (connState[rootColor]) return SCORE.WIN - ply;
    if (connState[opponentOfRoot]) return -(SCORE.WIN - ply);

    // Mutual-enclosure draw — see performMove()'s own version of this
    // check in script.js, which this mirrors exactly. Only reachable at
    // all when enclosureAllowed: with "No enclosure" on, an enclosing
    // move is only ever offered when it's also the winning move (see
    // above), so enclosureState never goes true in the first place — see
    // makeMove()'s own enclosureAllowed gate.
    if (enclosureAllowed && enclosureState.black && enclosureState.white) return 0;

    if (depth === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const alphaOrig = alpha;
    const ttKey = ttKeyFor(hashState.value, moverColor);
    const ttEntry = ttGet(tt, ttKey);
    let ttMove = null;
    if (ttEntry) {
      ttMove = ttEntry.move;
      if (ttEntry.depth >= depth) {
        const score = fromTT(ttEntry.score, ply);
        if (ttEntry.flag === TT_EXACT) return score;
        if (ttEntry.flag === TT_LOWER && score > alpha) alpha = score;
        else if (ttEntry.flag === TT_UPPER && score < beta) beta = score;
        if (alpha >= beta) return score;
      }
    }

    const legalMoves = getLegalMoves(cells, neighborKeys, moverColor, enclosureAllowed);
    if (legalMoves.length === 0) return evaluatePosition(cells, neighborKeys, rootColor, opponentOfRoot);

    const ordered = putMoveFirst(orderMoves(legalMoves, cells, neighborKeys, moverColor), ttMove);
    const maximizing = moverColor === rootColor;
    let value = maximizing ? -Infinity : Infinity;
    let bestMoveHere = null;

    for (const move of ordered) {
      counter.nodes++;
      const undo = makeMove(cells, neighborKeys, move.from, move.to, connState, enclosureState, hashState, enclosureAllowed);
      let childValue;
      try {
        childValue = minimax(cells, neighborKeys, otherColor(moverColor), rootColor, depth - 1, ply + 1, alpha, beta, deadline, enclosureAllowed, counter, connState, enclosureState, hashState, tt);
      } finally {
        undo(); // always restore, even if the line above threw SearchTimeoutError
      }

      if (maximizing) {
        if (childValue > value) { value = childValue; bestMoveHere = move; }
        if (value > alpha) alpha = value;
      } else {
        if (childValue < value) { value = childValue; bestMoveHere = move; }
        if (value < beta) beta = value;
      }
      if (alpha >= beta) break; // alpha-beta cutoff: rest of this branch can't change the outcome
    }

    // A SearchTimeoutError thrown above skips this store entirely (the
    // function exits via the exception, never reaching here) — exactly
    // right, since `value` would only reflect the moves tried so far,
    // not a legitimate bound for the full node.
    const flag = value <= alphaOrig ? TT_UPPER : value >= beta ? TT_LOWER : TT_EXACT;
    ttSet(tt, ttKey, { depth, score: toTT(value, ply), move: bestMoveHere, flag });

    return value;
  }

  /** One full-width search at a fixed depth from the root, returning the
   *  best move found (root is always the maximizing side). `counter`/
   *  `connState`/`enclosureState`/`hashState`/`tt` — see minimax() above;
   *  same make/unmake-in-`finally` discipline applies here at the root
   *  level too. The root search always uses a full (-Infinity, Infinity)
   *  window, so its own result is always an exact value UNLESS it broke
   *  out of the root-move loop early (see brokeEarly below) — in that
   *  case only a lower bound was actually established, and the TT entry
   *  must say so, or a later, larger-window probe could wrongly trust an
   *  incomplete comparison as if every root move had been checked.
   *
   *  Every root move is compared at every depth: the move returned is the
   *  best of them all, not the first one that looks good enough. The one
   *  exception is a win in ONE move (score SCORE.WIN - 1) — nothing can
   *  beat that, so the remaining root moves are skipped. (A forced win
   *  further away is still compared against the rest: a faster win, if
   *  there is one, has to win the comparison — and since iterative
   *  deepening stops at the first depth that finds any win, the winning
   *  move it returns is the fastest one there is.) An earlier version
   *  stopped at the first root move to clear SCORE.GOOD_ENOUGH, which
   *  handed the move to whichever quiet move came first in the ordering —
   *  see that constant's comment for what that looked like in play.
   *
   *  Choosing among LOST root moves. Once the best root score found is a
   *  proven loss (<= -MATE_THRESHOLD), the move played is picked in two
   *  steps, so the CPU looks like it is still fighting instead of handing
   *  the game over (the human may well not have seen the winning line
   *  yet):
   *    1. the move that loses LATEST — already what a plain max over
   *       win/loss-by-ply scores gives (a slower forced loss scores
   *       higher, see MATE_THRESHOLD/toTT/fromTT above);
   *    2. among moves that lose equally late, the one that leaves the CPU
   *       the best static position (evaluatePosition() right after the
   *       move: its own connected group and cohesion minus the
   *       opponent's) — the position it is best placed to build on if
   *       the human slips. Before, such ties fell to whichever came
   *       first in the move ordering (orderMoves()/the previous depth's
   *       best), which is what could make the play look arbitrary.
   *  Step 2 costs almost nothing, on purpose (the CPU must keep
   *  answering as fast as it did): the main loop is unchanged, and only
   *  notes which root moves *came back* equal to the best score (a move
   *  whose true value is at or below alpha only comes back as a bound
   *  <= alpha, so "came back equal" means "might tie", not "ties") along
   *  with their static evaluation. Afterwards those candidates are tried
   *  best-evaluation first, each confirmed with one search using a window
   *  lowered by a point (alpha - 1: a child worth exactly the best score
   *  then comes back exact, anything worse still comes back lower), and
   *  the first confirmed tie wins. The move that actually set the best
   *  score needs no confirmation, so when it is also the best-evaluated
   *  candidate — or there is no other candidate — nothing extra is
   *  searched at all. At most MAX_TIE_CONFIRMATIONS extra searches are
   *  ever run, and if the time budget runs out during one, the search
   *  simply keeps the move it already had: the iteration itself is
   *  complete by then, so a timeout here never throws the proven loss
   *  away. */
  function searchAtDepth(cells, neighborKeys, rootColor, depth, deadline, enclosureAllowed, counter, connState, enclosureState, hashState, tt) {
    const opponentColor = otherColor(rootColor);
    const ttKey = ttKeyFor(hashState.value, rootColor);
    const ttEntry = ttGet(tt, ttKey);
    const ttMove = ttEntry ? ttEntry.move : null;
    const rootMoves = putMoveFirst(orderMoves(getLegalMoves(cells, neighborKeys, rootColor, enclosureAllowed), cells, neighborKeys, rootColor), ttMove);

    let bestMove = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    let brokeEarly = false;
    // Only filled while bestScore is a proven loss (see the doc comment
    // above): root moves that came back equal to bestScore — plus the move
    // that set it, `exact: true` — each with the static evaluation of the
    // position it leaves.
    let lostCandidates = [];

    for (const move of rootMoves) {
      counter.nodes++;
      const undo = makeMove(cells, neighborKeys, move.from, move.to, connState, enclosureState, hashState, enclosureAllowed);
      let score;
      let moveEval = null;
      try {
        score = minimax(cells, neighborKeys, opponentColor, rootColor, depth - 1, 1, alpha, beta, deadline, enclosureAllowed, counter, connState, enclosureState, hashState, tt);
        // While the move is still made: rate the position it leaves — only
        // for a lost move at least as good as the best so far, the only
        // kind the tie-break can ever pick.
        if (score <= -MATE_THRESHOLD && score >= bestScore) {
          moveEval = evaluatePosition(cells, neighborKeys, rootColor, opponentColor);
        }
      } finally {
        undo();
      }
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
        // a new best always came back exact (it beat alpha inside the window)
        lostCandidates = moveEval !== null ? [{ move, moveEval, exact: true }] : [];
      } else if (score === bestScore && moveEval !== null) {
        lostCandidates.push({ move, moveEval, exact: false }); // "might tie" — confirmed below
      }
      if (bestScore > alpha) alpha = bestScore;
      if (bestScore >= SCORE.WIN - 1) { brokeEarly = true; break; } // a win in one move can't be beaten — see doc comment above
    }

    // Tie-break among equally-lost moves — see "Choosing among LOST root moves".
    if (lostCandidates.length > 1) {
      lostCandidates.sort((a, b) => b.moveEval - a.moveEval); // stable: equal evaluations keep search order
      let confirmations = 0;
      for (const c of lostCandidates) {
        if (c.exact) { bestMove = c.move; break; } // nobody better-evaluated tied after all
        if (confirmations++ >= MAX_TIE_CONFIRMATIONS) break; // keep bestMove as it is
        const undo = makeMove(cells, neighborKeys, c.move.from, c.move.to, connState, enclosureState, hashState, enclosureAllowed);
        let value;
        try {
          value = minimax(cells, neighborKeys, opponentColor, rootColor, depth - 1, 1, bestScore - 1, beta, deadline, enclosureAllowed, counter, connState, enclosureState, hashState, tt);
        } catch (err) {
          if (err instanceof SearchTimeoutError) break; // out of time: keep bestMove, the iteration itself is complete
          throw err;
        } finally {
          undo();
        }
        if (value === bestScore) { bestMove = c.move; break; } // confirmed tie, best evaluation among the true ties
      }
    }
    ttSet(tt, ttKey, { depth, score: toTT(bestScore, 0), move: bestMove, flag: brokeEarly ? TT_LOWER : TT_EXACT });
    return { move: bestMove, score: bestScore };
  }

  /**
   * Iterative deepening driver: searches depth 1, 2, 3... until one of
   * four things stops it — options.maxDepth is reached (if it's set to
   * an explicit cap at all: see below), the time budget runs out, the
   * position is already good enough that further search wouldn't change
   * what gets played, or the position is a *proven* forced loss — keeping
   * the best move found at each *completed* depth. If the time budget
   * runs out mid-search at some depth, that depth's (incomplete,
   * unreliable) result is discarded and the last fully-completed depth's
   * move is returned instead.
   *
   * options.maxDepth of 0 or undefined means NO fixed ply cap — the loop
   * only stops on time or on one of the two decided-position cases below,
   * not on a depth ceiling (see GAME_PARAM_RANGES.cpuDepth's doc comment
   * in config.js for why this is the default: response time is the thing
   * a player actually feels turn to turn, so cpuTime alone should govern
   * search strength for a predictable, low-latency feel — a separate
   * depth dial fighting against that same time budget just adds a way to
   * *accidentally* make the CPU slower or weaker than the time budget
   * alone would). Passing an explicit 1-5 still works as a hard cap, for
   * anyone who wants a fixed, reproducible search depth regardless of
   * how much time is available (e.g. benchmarking, or comparing two
   * AiStrategies implementations at an identical depth).
   *
   * Three conditions end the search early, before either the depth cap
   * (if any) or the time budget is actually exhausted:
   *   - SCORE.GOOD_ENOUGH (see its own comment) on the winning side — not
   *     a proven win, but confidently ahead. Continuing to deepen would
   *     mostly just spend time budget confirming what's already a clearly
   *     fine choice. Only once MIN_DEPTH_BEFORE_EARLY_EXIT plies have been
   *     searched, so the wins that are a move or two away have been
   *     looked for first — and note that the depth just finished has
   *     already compared every root move (see searchAtDepth()).
   *   - a forced win (score >= MATE_THRESHOLD, at any depth) — deeper
   *     search literally cannot change a proven outcome, and because that
   *     depth compared every root move, the move returned is the fastest
   *     win available.
   *   - a *forced loss* (score <= -MATE_THRESHOLD, i.e. the search has
   *     proven every line loses — see MATE_THRESHOLD/toTT/fromTT above):
   *     the CPU still plays the position out (it does not resign — see
   *     script.js's applyCpuResult()), but there is no reason to spend
   *     the rest of the time budget confirming a loss that's already
   *     certain, so this shortens the wait the same way the
   *     GOOD_ENOUGH break does for a win. Gated on MIN_DEPTH_BEFORE_EARLY_EXIT so
   *     the search has had a genuine chance to find the *most resistant*
   *     losing line rather than latching onto the first one seen at a
   *     shallow depth — deeper search, when there's time for it, finds a
   *     less-bad (less negative) score for a longer forced loss, which is
   *     the better move to actually play even though the outcome doesn't
   *     change. Which lost move is played — the one that loses latest,
   *     and among equals the one with the best resulting position — is
   *     decided in searchAtDepth() (see its "Choosing among LOST root
   *     moves" comment), at no extra time cost.
   *
   * Returns { move, score, nodesEvaluated, depthReached, forcedWinInPlies,
   * forcedLossInPlies } — the first four purely for display/diagnostics
   * (see the file-header comment and script.js's ?showAdvanced=true CPU
   * search log): nodesEvaluated is the total candidate moves expanded
   * across *every* depth tried this call, depthReached is the last depth
   * that actually completed before the search stopped for any of the
   * reasons above. forcedWinInPlies/forcedLossInPlies are non-null only
   * once the final score has crossed MATE_THRESHOLD, and are internal
   * diagnostics — see the file-header Return shape comment for what
   * script.js does (and must not) show the player.
   *
   * connState (see makeMove()) and enclosureState (see makeMove()) and
   * hashState (see computeHash()) are computed once here, from the
   * actual root position, and then threaded through every depth's
   * search — each depth's own make/unmake calls fully unwind back to
   * this same root state (via the `finally` blocks in
   * minimax()/searchAtDepth()) before the next depth starts, so
   * recomputing any of them would be redundant.
   *
   * `tt` (the transposition table — see the TT section above) is
   * likewise created fresh here and shared across every depth this call
   * tries — unlike connState/enclosureState/hashState it's deliberately
   * *not* reset between depths, since reusing a shallower depth's
   * results (as a cutoff, or at minimum as move ordering — see
   * minimax()) is the entire point of iterative deepening plus a TT
   * together. It's also deliberately *not* persisted beyond this one
   * call (a fresh table every time minimaxAlphaBetaID() runs, not a
   * module-level one reused across separate CPU moves) — see ttCreate()'s
   * own doc comment for why.
   */
  function minimaxAlphaBetaID(state, options = {}) {
    const { cells, neighborKeys, color, enclosureAllowed } = state;
    const requestedDepth = options.maxDepth;
    const hasDepthCap = Number.isFinite(requestedDepth) && requestedDepth > 0;
    const maxDepth = hasDepthCap ? Math.max(1, Math.min(5, requestedDepth)) : NO_DEPTH_CAP_LIMIT;
    const maxTimeMs = Math.max(200, (options.maxTimeSeconds ?? 5) * 1000);
    const deadline = nowMs() + maxTimeMs;

    const counter = { nodes: 0 };
    const connState = {
      black: isGroupFullyConnected(cells, neighborKeys, "black"),
      white: isGroupFullyConnected(cells, neighborKeys, "white"),
    };
    const enclosureState = enclosureAllowed
      ? {
          black: MoveRules.hasEnclosedPiece(cells, neighborKeys, "black"),
          white: MoveRules.hasEnclosedPiece(cells, neighborKeys, "white"),
        }
      : { black: false, white: false };
    const hashState = { value: computeHash(cells) };
    const tt = ttCreate();
    let best = { move: null, score: -Infinity };
    let depthReached = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      let result;
      try {
        result = searchAtDepth(cells, neighborKeys, color, depth, deadline, enclosureAllowed, counter, connState, enclosureState, hashState, tt);
      } catch (err) {
        if (err instanceof SearchTimeoutError) break; // keep the previous depth's result
        throw err;
      }
      if (result.move) { best = result; depthReached = depth; }
      if (best.score >= MATE_THRESHOLD) break; // forced win — see doc comment above
      if (best.score >= SCORE.GOOD_ENOUGH && depthReached >= MIN_DEPTH_BEFORE_EARLY_EXIT) break; // confidently ahead — see doc comment above
      if (best.score <= -MATE_THRESHOLD && depthReached >= MIN_DEPTH_BEFORE_EARLY_EXIT) break; // proven forced loss — see doc comment above
      if (nowMs() > deadline) break;
    }

    // safety net: if even depth 1 never completed (pathologically small
    // time budget), fall back to any legal move rather than passing.
    if (!best.move) {
      const fallback = getLegalMoves(cells, neighborKeys, state.color, enclosureAllowed)[0] || null;
      best = { move: fallback, score: 0 };
    }

    const magnitude = Math.abs(best.score);
    const mateDistance = magnitude >= MATE_THRESHOLD ? SCORE.WIN - magnitude : null;

    return {
      move: best.move,
      score: best.score,
      nodesEvaluated: counter.nodes,
      depthReached,
      forcedWinInPlies: mateDistance !== null && best.score > 0 ? mateDistance : null,
      forcedLossInPlies: mateDistance !== null && best.score < 0 ? mateDistance : null,
    };
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
  // iterative deepening driver shape, same return shape (minus the mate-
  // distance fields — see below) — differing only in how it walks the
  // tree:
  //   - clones the whole board per node (applyMove()) instead of
  //     make/unmake in place (makeMove()/undo()).
  //   - re-checks isGroupFullyConnected() for BOTH colors, and (when
  //     enclosureAllowed) MoveRules.hasEnclosedPiece() for both colors,
  //     at every node, instead of caching one boolean per color and only
  //     recomputing the side that just moved (connState/enclosureState).
  //   - has no transposition table at all, so no mate-score ply-scaling
  //     concern either — depth-relative WIN scores (SCORE.WIN + depth)
  //     are fine here since nothing caches them across different depths.
  //     This also means it has no forced-loss fast-exit: the mutual-
  //     enclosure draw rule below is a game-rules correctness fix that
  //     has to hold regardless of which engine is selected to actually
  //     play, but the ply-adjusted mate scoring and early loss-exit in
  //     minimaxAlphaBetaID are deliberate *performance* behavior this
  //     baseline exists to hold constant for A/B comparison — see
  //     README.md's "CPU search performance" section for the full
  //     writeup and benchmark notes from when minimaxAlphaBetaID replaced
  //     this as the default.
  // -----------------------------------------------------------------------
  function minimaxCloning(cells, neighborKeys, moverColor, rootColor, depth, alpha, beta, deadline, enclosureAllowed, counter) {
    if (nowMs() > deadline) throw new SearchTimeoutError();

    const opponentOfRoot = otherColor(rootColor);
    if (isGroupFullyConnected(cells, neighborKeys, rootColor)) return SCORE.WIN + depth;
    if (isGroupFullyConnected(cells, neighborKeys, opponentOfRoot)) return -(SCORE.WIN + depth);

    // Mutual-enclosure draw — see minimax()'s version of this check
    // above for the full rationale; this engine just recomputes both
    // colors' wall status from scratch every node instead of caching it,
    // matching its documented always-recompute style (see the file
    // comment just above).
    if (enclosureAllowed &&
        MoveRules.hasEnclosedPiece(cells, neighborKeys, "black") &&
        MoveRules.hasEnclosedPiece(cells, neighborKeys, "white")) {
      return 0;
    }

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
    // Same maxDepth=0/undefined-means-uncapped convention as
    // minimaxAlphaBetaID() (see its doc comment) — needed here too so
    // this engine behaves sanely when selected via
    // FeatureConfig.computerself_strategies while cpuDepth is left at
    // its "Auto" default (see GAME_PARAM_RANGES.cpuDepth in config.js);
    // without this, 0 would previously clamp straight to a depth-1-only
    // search. This engine intentionally does NOT get the good-enough
    // early stop from minimaxAlphaBetaID()/searchAtDepth() though — it's
    // kept as an unmoving pre-optimization baseline (see README.md), so
    // it always finishes each depth completely and only stops on a
    // proven win/loss or the time budget, same as it always has.
    const requestedDepth = options.maxDepth;
    const hasDepthCap = Number.isFinite(requestedDepth) && requestedDepth > 0;
    const maxDepth = hasDepthCap ? Math.max(1, Math.min(5, requestedDepth)) : NO_DEPTH_CAP_LIMIT;
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
//   out -> { requestId, ok: true,  move, score, nodesEvaluated, depthReached,
//            forcedWinInPlies, forcedLossInPlies }
//        | { requestId, ok: false, error }
// forcedWinInPlies/forcedLossInPlies are internal diagnostics — see the
// file-header Return shape comment — and are undefined when the chosen
// strategy doesn't report them (e.g. minimaxAlphaBetaCloning).
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
        forcedWinInPlies: result.forcedWinInPlies,
        forcedLossInPlies: result.forcedLossInPlies,
      });
    } catch (err) {
      self.postMessage({ requestId, ok: false, error: (err && err.message) || String(err) });
    }
  };
}