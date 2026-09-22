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
| `script.js`  | Application logic: game state, UI wiring, board rendering, online play (PeerJS), URL config parsing, plus two small self-contained UI modules (`ModeIcons` — the person/android glyphs composed into each mode button's SVG icon; `SupportHeart` — the top-bar heart's randomized pulse, see [UI flourishes](#ui-flourishes)). `CONFIG` (a different object from `FeatureConfig` — see [CONFIG vs FeatureConfig](#config-vs-featureconfig)) lives here, near the top. |
| `hexgeometry.js`, `boardinit.js`, `moverules.js`, `fitness.js`, `aistrategies.js` | Supporting modules loaded after `config.js`/before `script.js`. Judging by what `script.js` calls on them: `HexGeometry` (hex-grid math — axial↔pixel, corners, cell keys), `BoardInit` (board/cell/neighbor-map construction), `MoveRules` (legal-move and enclosure logic), `Fitness` (position evaluation), `AiStrategies` (CPU move selection). Consult each file directly for its actual implementation — this README doesn't cover their internals. |

## `config.js`

`config.js` exports six top-level `const`s. All of them are read once,
early, and nothing else in the app is supposed to define game rules,
difficulty tiers, parameter ranges, board colors, or URL-parameter docs
outside of this file.

### `BOARD_COLORS`

Currently just `cellEdge` — the hex grid line color between cells,
applied to style.css's `--cell-edge` custom property by
`applyBoardColors()` in `script.js`. style.css's `:root` hardcodes a
matching literal value too, purely so the very first paint already shows
the right color before that call runs — update both if you change it, or
the page will briefly flash the old color.

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
{ label, r, f, cpuTime, cpuDepth, noEnclosure, cpuStrategy, challengeWins }
```

| Key | Required | Meaning |
|-----|----------|---------|
| `label` | yes | Tooltip / accessible name for that step on the slider only. **Never shown as text anywhere in the picker** — selecting a level tells the player nothing about board size, piece count, or CPU strength, just its position from easiest to hardest. Don't put numbers in it that would leak that. |
| `r` | yes | Board radius. Must be within `CONFIG.MIN_RADIUS`–`CONFIG.MAX_RADIUS` (`script.js`; currently 2–5). |
| `f` | yes | Pieces per color. Should fit `pieceRangeForRadius(r)` (`script.js`) for that same `r` — an out-of-range value is **silently clamped**, not rejected, when the level is applied. Keep `r`/`f` matched on purpose so a level doesn't quietly do something other than what its position in the list implies. |
| `cpuTime` | no | Computer's max think time in seconds, clamped to 1–30. |
| `cpuDepth` | no | Computer's fixed ply cap. 0 (default) means no cap — see [CPU search performance](#cpudepth-is-time-governed-by-default-not-a-second-dial) below for why. 1–5 sets an explicit cap. |
| `noEnclosure` | no | Boolean. Unlike `cpuTime`/`cpuDepth`, omitting this **resets** it to the `no_enclosure` default rather than leaving it as-is — see below. Still subject to `no_enclosure` above existing as a rule at all — this can't turn it on if the `show_in_ui` chain means the rule isn't in play. |
| `cpuStrategy` | no | Name of an `AiStrategies.strategies` entry (`aistrategies.js`) — see [CPU search performance](#cpu-search-performance-aistrategiesjs) below. Same override-if-present behavior as `cpuTime`/`cpuDepth`. |
| `challengeWins` | **yes** — the one required field besides `label`/`r`/`f` | Only meaningful in the default minimalist win/loss "challenge ladder" (see [The default minimalist mode](#the-default-minimalist-mode-winloss-challenge-ladder) below): net wins over the computer needed at this level before moving up (or net losses before moving down). Also doubles that level's progress-bar segment count. Every shipped level sets this explicitly; a level that omits it falls back to `3` in `script.js` (`challengeWinsForLevel()`) purely as a defensive fallback, not a value meant to be relied on. |

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

## The default minimalist mode: win/loss "challenge ladder"

Without `?classicMode=true`, the player never sees the mode/difficulty
icons and never picks either manually. Instead:

- Mode is locked to `vscomputer` for the whole session (`boot()` forces
  `Game.mode = "vscomputer"` right after `applyUrlConfig()` runs,
  overriding even an explicit `?mode=`) — there's no UI to change it, and
  the ladder only makes sense against a computer anyway.
- Difficulty starts at `FeatureConfig.DEFAULT_DIFFICULTY_INDEX` (as
  always) and from there is driven entirely by results, not a slider.
- A horizontal bar under the board (`#challengeBar`, built/positioned by
  `renderChallengeBar()`) shows progress: `2 * challengeWinsForLevel(
  Game.challengeLevelIndex)` segments (that level's own **required**
  `challengeWins` field in `difficulty_levels` — see its doc comment in
  `config.js`; every level sets this explicitly, so different levels can
  have shorter or longer ladders on purpose), a marker starting dead
  center. Each decisive game nudges the marker one segment toward
  whichever side won — computer right, human left — via
  `applyChallengeOutcome(winnerColor)`, called from `endGame()` (never
  `endGameDraw()` — a draw doesn't move it either way). Which side
  actually won is read from `Game.players[winnerColor].isLocal`, not
  `Game.humanColor`, since only the former tracks a pie-rule swap
  mid-game.
- Reaching the right end drops one `difficulty_levels` index (or just
  resets in place at index 0 — nothing lower to drop to), with a small
  "leveled down" accent (`playLevelChangeAnimation("down")`: a few muted,
  slow, mostly-downward-drifting particles — see `.challenge-fx-piece.sad`
  in `style.css`). Reaching the left end raises one index with the
  equivalent "leveled up" accent (`playLevelChangeAnimation("up")`: a
  quicker, brighter, outward-radiating burst) — *unless* already at the
  last (hardest) index, in which case the whole ladder is complete:
  `playChallengeCompleteCelebration()` runs its own separate, bigger,
  full-screen wordless particle burst (`.celebration-piece` in
  `style.css`, randomized per-particle via inline custom properties so it
  never looks identical twice) instead of the small accent, then resets
  back to index 0 and starts fresh. Both accents reuse the same
  `.celebration-piece`/`celebration-piece-burst` keyframe as the big one,
  just anchored at `#challengeMarkerFx` (kept positioned to match the
  marker by `renderChallengeBar()`, not nested inside `#challengeMarker`
  itself so its own `rotate()` doesn't rotate the burst directions too)
  with much smaller/quicker parameters instead of full-screen ones.

**The actual level switch is deliberately deferred**, not applied the
instant a threshold is crossed: `applyChallengeOutcome()` only updates
`Game.challengeMarkerPos`/`Game.challengeLevelIndex`, re-renders the bar,
and plays the small up/down accent immediately (so it overlaps the
just-finished game's own win/loss flash, rather than waiting) — the
*index* change itself is stashed in the module-level
`pendingChallengeLevelIndex` (or `pendingChallengeCelebration` is set, for
the ladder-complete case). Those are only consumed later — inside
`fadeToBlackThenRestart()`'s screen-is-fully-black moment, or
`scheduleEndedAutoRestart()`'s timer for the celebration case — so the
just-finished game's own win/loss flash and pause still play out first,
rather than the UI jumping straight to the new level's board underneath
that flash.

Session-only: the ladder's progress isn't persisted anywhere, so a page
reload starts it over from index 0, same as difficulty already did
before this existed.

Share behavior also changes: `buildSetupUrl()` returns a bare
`"https://selfo.games"` with no query string at all when
`!Game.classicMode`, since the ladder always starts from the same place
regardless of who opens the link — there's nothing meaningful left to
encode.

## CPU search performance (`aistrategies.js`)

`minimaxAlphaBetaID()` is a fairly standard alpha-beta minimax with
iterative deepening (see its own doc comment for the algorithm itself).
Several optimizations are already in place; two more are identified but
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
- **Transposition table.** A fixed-size, two-slot-per-bucket array
  (`TT_SIZE = 2^16` buckets, `ttCreate()`/`ttGet()`/`ttSet()`) instead of
  an unbounded `Map` — bucket index is the low 16 bits of an
  incrementally-maintained 32-bit Zobrist hash (see
  `zobristFor()`/`computeHash()`/`hashState` in `makeMove()`), and each
  bucket keeps two entries: slot `[0]` under depth-preferred replacement
  (only overwritten by an entry at least as deep, so a shallow probe
  can't evict a hard-won deep result within the same iterative-deepening
  call) and slot `[1]` always-replace, so a busy bucket still tracks
  whatever was seen most recently. Every stored entry (`{ depth, score,
  move, flag, key }`) carries its own full 32-bit hash and `ttGet()`
  checks it before trusting the entry, so two different positions
  landing in the same bucket — a certainty at this table size, not a rare
  accident — are never confused for one another; correctness comes from
  that full-key check, not from the bucket index alone. Standard
  fail-soft alpha-beta semantics (`TT_EXACT`/`TT_LOWER`/`TT_UPPER`). Two
  effects: a deep-enough cached entry can resolve or tighten a node
  immediately, and — even when it can't — that position's previously-best
  move gets tried first (see the next point). Deliberately allocated
  fresh (`ttCreate()`) for one `minimaxAlphaBetaID()` call, not a
  module-level table reused across separate CPU moves: the board, the
  no-enclosure rule, and even which color is thinking can all differ
  between moves, and a stale cross-call entry being subtly wrong is a
  worse failure mode than rebuilding the table once per move. It *is*
  shared across all of one call's iterative-deepening depths, which is
  exactly where most of the value is — a shallow depth's results inform
  the next depth immediately.
- **Mate-distance-aware TT scores, and a same-quality tie-break among
  lost moves.** A win/loss score is stored as `SCORE.WIN`/`-SCORE.WIN`
  offset by plies-from-root, so a faster forced win (or a slower, less
  bad forced loss) always outscores the alternative — but that framing
  is only safe to *store* in the TT once converted to plies-from-*node*
  (`toTT()`/`fromTT()`, gated by `MATE_THRESHOLD`), since transposition
  can reach the same position at a different depth from the root. On top
  of that, once the best root score is a proven loss, `searchAtDepth()`
  doesn't just take whichever losing move the search order happened to
  try first: among moves that lose equally late, it picks the one
  leaving the CPU the best static position, confirming ties (up to
  `MAX_TIE_CONFIRMATIONS`) with a cheap narrowed-window re-search. This
  is what makes a lost CPU look like it's still playing for a mistake
  instead of handing the game over, at effectively no extra time cost —
  see `searchAtDepth()`'s "Choosing among LOST root moves" comment for
  the full mechanics.
- **Move ordering seeded from the transposition table** (`putMoveFirst()`)
  rather than only the static `allyContactAfterMove` heuristic — a
  position's previously-best move (from a shallower depth, or from
  reaching the same position by a different move order) is tried first,
  which is normally the single biggest lever on how much alpha-beta gets
  to prune. Folded into the TT work above rather than a separate
  "remember the root's last-best-move" mechanism, since the TT already
  captures this more generally (every node, not just the root).

The core search optimizations (make/unmake, the halved connectivity check,
and the transposition table with its move ordering) were verified against
the pre-optimization algorithm
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

### `cpuDepth` is time-governed by default, not a second dial

Response time is what a player actually feels turn to turn, so `cpuTime`
is the parameter that has to stay low/predictable — `cpuDepth` fighting
for its own separate ply budget on top of that just adds a way to
*accidentally* make the CPU slower (or, capped too low, weaker) than the
time budget alone would. So `GAME_PARAM_RANGES.cpuDepth`'s default (and
every shipped `difficulty_levels` entry) leaves it at `0`, a sentinel
meaning "no fixed ply cap — let `cpuTime` alone decide how deep the
search goes" (shown as "Auto" in the UI, not literally zero plies). An
explicit `1`-`5` still works as a hard cap, for anyone who specifically
wants a fixed, reproducible depth regardless of time available (e.g.
benchmarking, or comparing the two engines at an identical depth via
`computerself_strategies` below).

Two things had to change in `aistrategies.js` to make "no cap" actually
safe rather than literally unbounded:

- **`options.maxDepth` of `0`/`undefined`** now resolves to
  `NO_DEPTH_CAP_LIMIT` (40 plies) internally, not `Infinity`. Testing a
  genuinely uncapped loop surfaced a real edge case: a position where
  connectivity keeps flipping in and out let iterative deepening
  "complete" depth after depth almost instantly, with the nominal depth
  climbing into the hundreds of thousands within the time budget — and
  since a forced win's score is `SCORE.WIN + depth` (a small tie-break
  bonus for a faster mate), that distorted the score's scale completely.
  40 is already far beyond anything this game's *real* move generation
  cost lets a real board reach inside any sane time budget — a generous
  finite ceiling standing in for "unreachable in practice", not a literal
  infinite one, which also sidesteps risking a call-stack overflow on a
  pathological position (a real, if unlikely, risk with true unbounded
  recursion, especially inside a Worker).
- **The "good enough, stop and just play it" early exit**
  (`SCORE.GOOD_ENOUGH`, currently `450`) — otherwise a time-governed
  search with no depth cap would always spend the *entire* `cpuTime`
  budget every single move, even once the position is already clearly
  decided, which is exactly the sluggish feel a low response time is
  meant to avoid. Checked in two places: after each iterative-deepening
  depth completes (`minimaxAlphaBetaID()`, same spot the forced-win check
  already lived), and — more aggressively — inside `searchAtDepth()`
  itself, which stops comparing the *remaining* root moves the moment one
  of them already clears the bar, rather than finishing the full-width
  comparison first. Both mean the chosen move is provably good, not
  necessarily provably *the best* among every option at that depth — the
  right trade for keeping response time low. A genuine forced win always
  clears this same, lower bar first, so it didn't need a separate check.
  Deliberately **not** added to `minimaxAlphaBetaCloning` — it's kept as
  an unmoving, full-comparison-every-depth baseline (see "Switching
  engines" below), so it still only stops on a proven win/loss or the
  time budget, exactly as it always has. That baseline *did* still need
  the `maxDepth` sentinel fix above, though — without it, leaving
  `cpuDepth` at its new "Auto" default while running the old engine (via
  `computerself_strategies`) would have silently clamped it to a
  depth-1-only search, a real bug rather than an intentional difference
  between the two.

`SCORE.GOOD_ENOUGH`'s value is a rough estimate (see its own comment in
`aistrategies.js` for the scoring math it's based on), not something
tuned against real play yet — revisit it if real games show the CPU
committing to weak moves too eagerly, or still visibly grinding through
the full time budget on already-decided positions.

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

## UI flourishes

Two small, self-contained modules near the top of `script.js`, independent
of the game-state code around them:

- **`ModeIcons`** builds the SVG icon for each of the 4 mode buttons (and
  the matching split-apart pair used in the minimalist players strip) from
  two hand-drawn glyph functions, `person(x)` and `android(x)` — same
  16-unit bounding box, same vertical extent, so any mode's two glyphs read
  as a matched pair. Which two glyphs a mode uses, and how far apart they
  sit, is entirely table-driven (`COMPOSITION`/`GAP`); `online2p` is the
  one special case, drawing its right-hand person smaller and lifted up
  (`ONLINE_FAR_PERSON`) so the two read as "apart" rather than a wider
  `local2p`. The android glyph is also what lies down (head to the left)
  in the compact players bar while `Game.cpuLost[color]` is true — see the
  `cpuLost` field's own comment in `script.js` and `updateCompactBar()`.
- **`SupportHeart`** makes the top-bar support-link heart turn red and
  pulse like a heartbeat at unpredictable intervals — random rest length
  (skewed short, via `randLow()`), random episode length, and a random
  tempo/peak-scale per episode (`REST_MS`/`BEAT_MS`/`PERIOD_S`/`PEAK`) —
  so there's no rhythm to learn. The animation itself lives in
  `style.css`'s `.beating` class, driven by the `--beat-period`/`--beat-peak`
  custom properties this module sets; `endBeating()` waits for the current
  beat cycle to finish rather than cutting it off mid-pulse (with a
  `setTimeout` backstop for when no animation is actually running, e.g.
  reduced-motion or a backgrounded tab). Exposes `SupportHeart.beatNow()`
  for triggering an episode immediately from the console.

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