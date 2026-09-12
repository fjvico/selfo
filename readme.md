# Selfo — developer README

This covers `config.js` (what a deployer/developer is expected to edit) and the
handful of related conventions in `script.js`/`index.html` that `config.js`
plugs into. It's not a player-facing document.

## Files

| File         | Role |
|--------------|------|
| `index.html` | Markup + `<script>` load order. `config.js` loads **first**, before `script.js` and the supporting modules below, so everything else can read `FeatureConfig`/`URL_PARAMS`/`HELP_URL_EXAMPLE` at top-level. |
| `style.css`  | All styling. |
| `config.js`  | **The one file meant to be edited per-deployment.** Game-rule toggles, the difficulty presets, and the URL-parameter documentation shown in the in-app help panel. See below. |
| `script.js`  | Application logic: game state, UI wiring, board rendering, online play (PeerJS), URL config parsing. `CONFIG` (a different object from `FeatureConfig` — see [CONFIG vs FeatureConfig](#config-vs-featureconfig)) lives here, near the top. |
| `hexgeometry.js`, `boardinit.js`, `moverules.js`, `fitness.js`, `aistrategies.js` | Supporting modules loaded after `config.js`/before `script.js`. Judging by what `script.js` calls on them: `HexGeometry` (hex-grid math — axial↔pixel, corners, cell keys), `BoardInit` (board/cell/neighbor-map construction), `MoveRules` (legal-move and enclosure logic), `Fitness` (position evaluation), `AiStrategies` (CPU move selection). Consult each file directly for its actual implementation — this README doesn't cover their internals. |

## `config.js`

`config.js` exports five top-level `const`s. All of them are read once, early,
and nothing else in the app is supposed to define game rules, difficulty
tiers, parameter ranges, or URL-parameter docs outside of this file.

### `GAME_PARAM_RANGES`

```js
{ min, max, default }
```

per numeric parameter: currently `radius`, `cpuTime`, `cpuDepth`. The
single source of truth for each one's slider bounds and starting value —
`script.js`'s `CONFIG.MIN_RADIUS`/`MAX_RADIUS`/`DEFAULT_RADIUS`/
`DEFAULT_CPU_TIME_SECONDS`/`DEFAULT_CPU_DEPTH` are all just copies of
these, read once at load (see the `CONFIG` object's own comment), and
`applyGameParamRanges()` sets the matching `<input type="range">`
elements' `min`/`max`/`value` attributes from the same values. Change a
number here and both follow — no second copy to keep in sync by hand.

`index.html` also hardcodes matching literal attributes on those same
three inputs, purely so the very first paint (before any JS runs) already
shows correct values instead of flashing to them once `script.js` catches
up — see the FOUC-prevention notes elsewhere in this file/the codebase.
If you change a range here, update those literals too, or the page will
briefly show the *old* range before `applyGameParamRanges()` corrects it.

**"Pieces per player" is deliberately not here.** Unlike radius/cpuTime/
cpuDepth, it isn't an independent parameter with a fixed range — its
valid range depends on whatever radius is currently selected (see
`pieceRangeForRadius()` in `script.js`).

### `FeatureConfig.no_enclosure`

```js
no_enclosure: [show_in_ui, default_value],
```

Governs the "No enclosure" rule (blocking moves that would trap an opponent
piece — see `MoveRules.legalMoveTargets` in `moverules.js`) and its checkbox
in the setup panel.

- `show_in_ui` (`boolean`) — whether the checkbox is ever rendered at all.
  When `false`, the rule is pinned at `default_value` for the whole session
  with no way for the player to change it back, and `?noEnclosure=` in the
  URL is also ignored (see [`applyUrlConfig()`](#url_params)).
  When `true`, the checkbox is still only actually *shown* if the session is
  also running with `?showAdvanced=true` — `show_in_ui` and `showAdvanced`
  are ANDed together (`updateSetupVisibility()` in `script.js`).
- `default_value` (`boolean`) — `true` = enclosure blocked by default
  (checkbox starts checked), `false` = enclosure allowed by default.

This is the template for any *new* on/off gameplay toggle you add later: same
`[show_in_ui, default_value]` shape, same "hide the control or let the player
touch it" split. Search `script.js` for `no_enclosure` to see every place a
toggle like this needs to be wired in (the checkbox itself, its `hidden`/
`disabled` state, the URL param, and `beginSetupPreview()` reading it into
`Game.*`).

### `FeatureConfig.difficulty_levels`

The presets behind the vertical "Difficulty" slider in the top bar (between
the mode selector and Share). Each entry:

```js
{ label, r, f, cpuTime, cpuDepth, noEnclosure, cpuStrategy }
```

| Key | Required | Meaning |
|-----|----------|---------|
| `label` | yes | Tooltip / accessible name for that step on the slider only. **Never shown as text anywhere in the picker** — selecting a level tells the player nothing about board size, piece count, or CPU strength, just its position from easiest to hardest. Don't put numbers in it that would leak that. |
| `r` | yes | Board radius. Must be within `CONFIG.MIN_RADIUS`–`CONFIG.MAX_RADIUS` (`script.js`; currently 2–5). |
| `f` | yes | Pieces per color. Should fit `pieceRangeForRadius(r)` (`script.js`) for that same `r` — an out-of-range value is **silently clamped**, not rejected, when the level is applied. Keep `r`/`f` matched on purpose so a level doesn't quietly do something other than what its position in the list implies. |
| `cpuTime` | no | Computer's max think time in seconds, clamped to 1–30. |
| `cpuDepth` | no | Computer's search depth, clamped to 1–5. |
| `noEnclosure` | no | Boolean. Unlike `cpuTime`/`cpuDepth`, omitting this **resets** it to the `no_enclosure` default rather than leaving it as-is — see below. Still subject to `no_enclosure` above existing as a rule at all — this can't turn it on if the `show_in_ui` chain means the rule isn't in play. |
| `cpuStrategy` | no | Name of an `AiStrategies.strategies` entry (`aistrategies.js`) — see [CPU search performance](#cpu-search-performance-aistrategiesjs) below. Same override-if-present behavior as `cpuTime`/`cpuDepth`. |

**`cpuTime`/`cpuDepth` are override-if-present, not override-always.**
Omitting one of them leaves whatever was already in effect (session
default, a `?cpuTime=`/`?cpuDepth=` URL param, or a manual edit in the
advanced panel) untouched — it does **not** reset to some baseline.

**`noEnclosure` is different: it's always resolved, never left stale.**
Selecting *any* level — or, in the advanced panel, dragging the
radius/pieces sliders directly — sets it to that level's `noEnclosure` if
defined, or back to the `no_enclosure` default if not. A manually-checked
"No enclosure" that silently kept surviving a board change with no visible
cause was confusing enough that it doesn't get the same "leave it alone"
treatment as `cpuTime`/`cpuDepth`. See `applyDifficultyLevel()` and the
`radiusRange`/`piecesRange` `"input"` listeners in `script.js`.

**Ordering is meaningful and load-bearing:** the array **must** be listed
easiest first, hardest last. The slider renders levels in exactly that
order (index 0 = bottom of the slider = easiest) with no other cue to
relative difficulty — reordering the array *is* changing the difficulty
curve.

**Avoid two levels with identical `r`/`f`/`cpuTime`/`cpuDepth` that differ
only by one having `noEnclosure` set and the other not.** The app does track
which level was actually picked (`lastAppliedDifficultyIndex` in
`script.js`) so the slider generally still shows the right one, but a level
that *omits* `cpuTime`/`cpuDepth` matches *any* value of that particular
field (unlike `noEnclosure`, which is always resolved to a definite value —
see above) — so an earlier, less-specific level can still end up looking
selected if the state happens to coincide after something else changes it
(a manual slider tweak, a URL param, an online host's custom setup). Give
genuinely distinct levels at least one differing defined field to avoid
this ambiguity entirely.

`FeatureConfig.DEFAULT_DIFFICULTY_INDEX` is the index into this array applied
at the start of every fresh session (see `resetAllRangeInputs()`), before the
player touches the slider. A `?radius=`/`?pieces=`/etc. URL param, if
present, still overrides it.

### `HELP_URL_EXAMPLE`

```js
const HELP_URL_EXAMPLE = "https://selfo.games?mode=vscomputer&radius=3&cpuTime=15";
```

One example URL shown verbatim in the "?" help panel (see [URL_PARAMS](#url_params)
below) to illustrate the query-string format. Purely illustrative text — not
parsed or validated against the params it names. Update the domain here if
the game moves.

### `URL_PARAMS`

```js
{ param, description }
```

Documents every `?param=value` the app's own URL parser
(`applyUrlConfig()` in `script.js`) understands. This list **is** the
content of the "?" help panel (`buildHelpParamsList()` renders it directly),
so it and what the URL actually accepts must never drift apart — **any time
you add, remove, or change a `params.get(...)` call in `applyUrlConfig()`,
add/remove/update the matching entry here in the same commit.** Order here
should match the order `applyUrlConfig()` reads them, purely so the two stay
easy to eyeball against each other.

The current params, for reference (see `applyUrlConfig()` for the exact
parsing/validation of each): `showAdvanced`, `mode`, `radius`, `pieces`,
`noEnclosure`, `color`, `cpuTime`, `cpuDepth`, `name`, `join`.

#### Opening the help panel

There's no visible "?" button — it's opened by pressing the **`?` key**
(ignored while a text field has focus). This is deliberate: the panel is a
dev/power-user tool for building preconfigured links, not something an
everyday player is meant to stumble onto. Keep it that way when touching
this area — don't add a discoverable button for it.

## `CONFIG` vs `FeatureConfig`/`GAME_PARAM_RANGES`

Two different objects, two different files, on purpose:

- **`config.js`** (`FeatureConfig`, `GAME_PARAM_RANGES`, `URL_PARAMS`,
  `HELP_URL_EXAMPLE`) — the deployer-facing knobs: which optional rules
  exist and their defaults, every numeric parameter's range/default, the
  difficulty presets, and the URL-parameter docs. This is the file meant
  to be edited without needing to read the rest of the app.
- **`CONFIG`** (top of `script.js`) — engine/UI constants that aren't
  meant to vary per-deployment in the same way: `CELL_SIZE`,
  `CPU_FIRST_MOVE_DEPTH`, touch/mouse interaction timing, timing for the
  end-of-game flash/pause/fade, and `DEFAULT_MODE`. `MIN_RADIUS`/
  `MAX_RADIUS`/`DEFAULT_RADIUS`/`DEFAULT_CPU_TIME_SECONDS`/
  `DEFAULT_CPU_DEPTH` still live on this object too, for every existing
  call site's sake, but are only ever *copies* — see `GAME_PARAM_RANGES`
  above for where their actual values come from. For anything else on
  `CONFIG`: you *can* edit these, but they're closer to "engine tuning"
  than "which rules/ranges does this deployment offer" — if in doubt
  about which file a new constant belongs in, ask whether a
  non-technical deployer would plausibly want to change it without
  reading `script.js`; if yes, it probably belongs in `config.js` instead.

`FeatureConfig.difficulty_levels` entries' `r`/`cpuTime`/`cpuDepth` values
must fit inside `GAME_PARAM_RANGES.radius`/`cpuTime`/`cpuDepth` — there's
no runtime check tying the two together beyond the clamping already
described in `difficulty_levels`' own doc comment, so a level built
against a wider range than `GAME_PARAM_RANGES` currently allows will just
have its out-of-range values silently clamped, not rejected.

## Adding things

**A new on/off gameplay rule** (like `no_enclosure`): add a
`[show_in_ui, default_value]` entry to `FeatureConfig`, then wire it into
`script.js` the same way `no_enclosure` is wired — a setup-panel control,
its `hidden`/`disabled` state, a `Game.*` field read from that control in
`beginSetupPreview()`, and (if it should be linkable) a `params.get(...)`
case in `applyUrlConfig()` plus a `URL_PARAMS` entry.

**A new difficulty level**: insert it into `difficulty_levels` at the
correct easy→hard position — not necessarily at the end. Give it `r`/`f`
that fit each other (see the table above), and only the `cpuTime`/
`cpuDepth`/`noEnclosure` you actually want that level to override.

**A new URL parameter**: add the `params.get(...)` parsing/validation to
`applyUrlConfig()` in `script.js`, and add the matching `{ param,
description }` to `URL_PARAMS` in the same change. If the parameter should
round-trip through "Copy link" / the share menu, also add it to
`buildSetupUrl()` in `script.js`.

## CPU search performance (`aistrategies.js`)

`minimaxAlphaBetaID()` is a fairly standard alpha-beta minimax with
iterative deepening (see its own doc comment for the algorithm itself).
Four optimizations are already in place; two more are identified but
deliberately not attempted yet (see "Not done" for why). Both lists exist
so a future pass doesn't have to re-derive them from scratch.

### Done

- **Make/unmake instead of cloning the board per node.** The search used
  to call `applyMove()`, which builds a brand-new `Map` + new cell objects
  for every single node visited (tens of thousands of allocations per CPU
  move at deeper depths/bigger boards). `minimax()`/`searchAtDepth()` now
  mutate the *same* `cells` object in place via `makeMove()`, which
  returns an `undo()` closure — always called from a `finally` block, so
  the board is correctly restored even when a `SearchTimeoutError` unwinds
  the recursion mid-search (see `nowMs() > deadline`). `applyMove()`
  itself is untouched and still exported, for any future strategy that
  wants a simple, non-mutating API instead of make/unmake bookkeeping.
- **Halved the win/loss connectivity check.** `isGroupFullyConnected()`
  used to be called twice per node (once per color), unconditionally,
  even though a single move can only ever change *the mover's own*
  color's connectivity — the color that didn't move hasn't changed at
  all since its parent node. `connState` (`{ black, white }`, cached
  booleans) is now computed once from the root position and updated for
  only the moving color inside `makeMove()`; `minimax()` just reads
  `connState[color]` instead of re-scanning. Still an O(n) BFS per move
  (not O(1) incremental — see "Not done" below), just one of them instead
  of two.
- **Transposition table.** A `Map` keyed by an incrementally-maintained
  Zobrist hash (see `zobristFor()`/`computeHash()`/`hashState` in
  `makeMove()`) of `{ depth, score, move, flag }`, standard fail-soft
  alpha-beta semantics (`TT_EXACT`/`TT_LOWER`/`TT_UPPER`). Two effects:
  a deep-enough cached entry can resolve or tighten a node immediately,
  and — even when it can't — that position's previously-best move gets
  tried first (see the next point). Deliberately scoped fresh to one
  `minimaxAlphaBetaID()` call (a new `Map` every time, not a module-level
  one reused across separate CPU moves): the board, the no-enclosure rule,
  and even which color is thinking can all differ between moves, and a
  stale cross-call entry being subtly wrong is a worse failure mode than
  rebuilding the table once per move. It *is* shared across all of one
  call's iterative-deepening depths, which is exactly where most of the
  value is — a shallow depth's results inform the next depth immediately.
- **Move ordering seeded from the transposition table** (`putMoveFirst()`)
  rather than only the static `allyContactAfterMove` heuristic — a
  position's previously-best move (from a shallower depth, or from
  reaching the same position by a different move order) is tried first,
  which is normally the single biggest lever on how much alpha-beta gets
  to prune. Folded into the TT work above rather than a separate
  "remember the root's last-best-move" mechanism, since the TT already
  captures this more generally (every node, not just the root).

All four were verified against the pre-optimization algorithm
(reconstructed/kept standalone — see `minimaxAlphaBetaCloning` — and run
side-by-side on identical synthetic boards across several board sizes,
piece layouts, depths, and both colors): **identical scores** at every
depth tested (the chosen *move* can legitimately differ when several tie
on score, since move ordering itself changed — that's expected, not a
bug), and the board is provably back to its exact original state after
any search, including ones repeatedly interrupted mid-depth by the time
budget. On that same test sweep, the current engine ran in under half the
time and visited noticeably fewer nodes than the pre-optimization one at
identical depths — the exact improvement will vary a lot by board/position
in real play, but the direction and rough magnitude held consistently
across every test board tried.

### Switching engines / comparing them head-to-head

The pre-optimization algorithm wasn't deleted — it's registered
side-by-side with the current one as a second `AiStrategies.strategies`
entry, `minimaxAlphaBetaCloning` (the current, default one is
`minimaxAlphaBetaID`, and only it has the four optimizations above —
`minimaxAlphaBetaCloning` is kept exactly as it originally was, on
purpose, as an unmoving baseline to compare against). `pickMove(state,
options, strategyName)` already took an optional third argument for
exactly this; nothing new needed on that side.

Three `config.js` knobs control which one actually runs, resolved in this
order by `resolveCpuStrategy()` in `script.js`:

1. **`FeatureConfig.computerself_strategies`** — computerself ("AI vs AI")
   only, an optional per-color override (`{ black, white }`). This is the
   one built specifically for comparing the two engines: set one color to
   `"minimaxAlphaBetaID"` and the other to `"minimaxAlphaBetaCloning"` and
   watch them play each other, with the `?showAdvanced=true` CPU log
   showing each move's engine name alongside its depth/node count so the
   two are easy to tell apart live. Both default to the current engine, so
   this changes nothing until edited.
2. **A difficulty level's own `cpuStrategy`** (see `difficulty_levels`
   above) — same override-if-present behavior as `cpuTime`/`cpuDepth`.
3. **`FeatureConfig.DEFAULT_CPU_STRATEGY`** — the fallback, and in
   practice what almost every game actually uses, since none of the
   shipped levels override it.

`computerself_strategies` wins over a level's `cpuStrategy` when both
would apply (i.e. in computerself with both set) — it's the more specific,
more deliberately-a-comparison setting of the two.

### Not done

- **Bitboard representation.** `cells` is a `Map<string, {q,r,color}>` —
  for `CONFIG.MAX_RADIUS` (5, 91 cells) that still fits in a 128-bit (two
  64-bit) bitmask per color. Move generation, adjacency checks, and even
  connectivity could all become bitwise ops instead of Map lookups/hash
  traversal. Far and away the highest ceiling of any option left, but
  also a much bigger, more invasive rewrite than everything done so far —
  every helper in this file would need a bitboard-aware version — and one
  this file's own maintainer should verify against the *real*
  `moverules.js`/`boardinit.js`/`hexgeometry.js` adjacency logic rather
  than a synthetic stand-in, since a subtle indexing bug here would be
  easy to miss without the real hex-grid generator to test against.
- **Parallelize the root across Workers.** Only one `Worker` is ever used
  (see `ensureCpuWorker()` in `script.js`); splitting the root moves
  across several workers (one subtree each) and merging results would use
  more of a multi-core machine, at the cost of alpha-beta pruning being
  less effective across workers than within a single sequential search
  (each worker doesn't see the others' alpha/beta bounds as they update).
  This one touches `script.js`'s worker lifecycle management as much as
  the search itself (spinning up/tearing down a pool instead of one
  worker, merging/cancelling in-flight requests across all of them), so
  it's as much an architecture change there as an `aistrategies.js` one.