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

`config.js` exports four top-level `const`s. All of them are read once, early,
and nothing else in the app is supposed to define game rules, difficulty
tiers, or URL-parameter docs outside of this file.

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
{ label, r, f, cpuTime, cpuDepth, noEnclosure }
```

| Key | Required | Meaning |
|-----|----------|---------|
| `label` | yes | Tooltip / accessible name for that step on the slider only. **Never shown as text anywhere in the picker** — selecting a level tells the player nothing about board size, piece count, or CPU strength, just its position from easiest to hardest. Don't put numbers in it that would leak that. |
| `r` | yes | Board radius. Must be within `CONFIG.MIN_RADIUS`–`CONFIG.MAX_RADIUS` (`script.js`; currently 2–5). |
| `f` | yes | Pieces per color. Should fit `pieceRangeForRadius(r)` (`script.js`) for that same `r` — an out-of-range value is **silently clamped**, not rejected, when the level is applied. Keep `r`/`f` matched on purpose so a level doesn't quietly do something other than what its position in the list implies. |
| `cpuTime` | no | Computer's max think time in seconds, clamped to 1–30. |
| `cpuDepth` | no | Computer's search depth, clamped to 1–5. |
| `noEnclosure` | no | Boolean. Unlike `cpuTime`/`cpuDepth`, omitting this **resets** it to the `no_enclosure` default rather than leaving it as-is — see below. Still subject to `no_enclosure` above existing as a rule at all — this can't turn it on if the `show_in_ui` chain means the rule isn't in play. |

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

## `CONFIG` vs `FeatureConfig`

Two different objects, two different files, on purpose:

- **`FeatureConfig`** (`config.js`) — the deployer-facing knobs: which
  optional rules exist and their defaults, the difficulty presets, and the
  URL-parameter docs. This is the file meant to be edited without needing to
  read the rest of the app.
- **`CONFIG`** (top of `script.js`) — engine/UI constants that aren't
  meant to vary per-deployment in the same way: board radius bounds
  (`MIN_RADIUS`/`MAX_RADIUS`), `CELL_SIZE`, CPU defaults
  (`DEFAULT_CPU_TIME_SECONDS`, `DEFAULT_CPU_DEPTH`, `CPU_FIRST_MOVE_DEPTH`),
  touch/mouse interaction timing, and `DEFAULT_MODE`. You *can* edit these,
  but they're closer to "engine tuning" than "which rules does this
  deployment offer" — if in doubt about which file a new constant belongs
  in, ask whether a non-technical deployer would plausibly want to change it
  without reading `script.js`; if yes, it probably belongs in
  `FeatureConfig` instead.

`FeatureConfig.difficulty_levels` entries reference `CONFIG.MIN_RADIUS`/
`MAX_RADIUS` implicitly (their `r` values must fit inside that range) —
there's no runtime check tying the two files together beyond what
`pieceRangeForRadius()`/`buildBoard()` naturally enforce, so a `config.js`
edit that assumes different bounds than the current `CONFIG` needs a manual
double-check.

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