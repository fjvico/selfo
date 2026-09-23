"use strict";

/**
 * BOARD_COLORS
 * ------------
 * Board-appearance colors meant to be hand-tuned without touching
 * style.css — applied once at boot to the matching CSS custom properties
 * (see applyBoardColors() in script.js) rather than being read directly
 * by the CSS itself, so this stays the one place to adjust them.
 *
 *   cellEdge   color of the hexagonal grid lines between cells (the cell
 *              polygons' stroke) — style.css's --cell-edge variable.
 *              Deliberately close to --cell-fill's gray by default so the
 *              grid barely registers; raise the contrast here (a lighter
 *              or darker value, or a different hue entirely) to make the
 *              cell edges more visible.
 */
const BOARD_COLORS = {
  cellEdge: "#929292",
};

/**
 * TOUCH_LONG_PRESS_MS
 * --------------------
 * How long, in milliseconds, a finger has to stay pressed still on a
 * piece before the drag is "armed" — the piece is considered picked up
 * and ready to move, and page panning locks so the rest of the gesture
 * doesn't scroll the page instead. Read once at boot into script.js's
 * own `CONFIG.TOUCH_LONG_PRESS_MS` (see its own comment there for the
 * exact setTimeout call this feeds), so this is the one place to tune
 * it without touching script.js.
 *
 * Lower = picking up a piece feels snappier, but a quick tap-and-drag
 * meant as a page scroll is more likely to get mistaken for arming a
 * piece. Higher = safer against that, but the player has to hold a
 * piece noticeably longer before it responds.
 *
 * Only affects touch (finger) interaction. Desktop mouse dwell-to-click
 * timing is a separate constant, `CONFIG.MOUSE_HOVER_MOVE_MS` in
 * script.js, not moved here since it isn't a touch-hold time.
 */
const TOUCH_LONG_PRESS_MS = 220;

/**
 * TOUCH_LONG_PRESS_TOLERANCE_PX
 * ------------------------------
 * Companion to TOUCH_LONG_PRESS_MS above: how far, in pixels, a finger
 * may drift while the long-press timer is running before that drift
 * cancels the arming attempt and lets the page scroll/pan instead — i.e.
 * how "still" the hold has to stay to count as picking up a piece rather
 * than the start of a scroll gesture. Read once at boot into script.js's
 * `CONFIG.TOUCH_LONG_PRESS_TOLERANCE_PX`.
 *
 * Lower = stricter (must hold almost perfectly still), so a piece is
 * less likely to get armed by accident during a scroll, but a slightly
 * shaky hold on a genuine pick-up attempt gets cancelled more easily.
 * Higher = more forgiving of a shaky hold, but a slow scroll gesture is
 * more likely to get mistaken for arming a piece.
 */
const TOUCH_LONG_PRESS_TOLERANCE_PX = 10;

/**
 * MOUSE_HOVER_MOVE_MS
 * --------------------
 * Desktop-mouse equivalent of TOUCH_LONG_PRESS_MS: how long, in
 * milliseconds, the pointer has to dwell over a piece or cell before
 * that counts as a click/selection, rather than just passing over it on
 * the way somewhere else. Read once at boot into script.js's own
 * `CONFIG.MOUSE_HOVER_MOVE_MS`. Only affects mouse/desktop interaction —
 * see TOUCH_LONG_PRESS_MS above for the touch (finger) equivalent.
 */
const MOUSE_HOVER_MOVE_MS = 550;

/**
 * GAME_PARAM_RANGES
 * -----------------
 * Min/max/default for every numeric game parameter that actually has a
 * fixed range — the single source of truth for them, read once at boot
 * (see script.js's applyGameParamRanges(), called before anything else
 * touches these controls) to set both CONFIG's own copies in script.js
 * (MIN_RADIUS/MAX_RADIUS/DEFAULT_RADIUS, DEFAULT_CPU_TIME_SECONDS,
 * DEFAULT_CPU_DEPTH — kept there too since most of script.js already
 * reads CONFIG.* directly) and the matching <input type="range">
 * elements' min/max/value attributes in index.html. Change a value here
 * and it takes effect everywhere; there's no second copy to keep in sync
 * by hand.
 *
 *   min      lowest value the player (or a ?radius=/?cpuTime=/?cpuDepth=
 *            URL param, or a difficulty level's r/cpuTime/cpuDepth — see
 *            FeatureConfig.difficulty_levels below) can set it to.
 *            Anything lower is clamped up to this.
 *   max      same, upper end.
 *   default  the value a fresh session starts with, before the player
 *            (or a difficulty level, or a URL param) changes it.
 *
 * "Pieces per player" is deliberately NOT here: unlike these three, it
 * isn't an independent parameter with its own fixed range — it's derived
 * from radius (see pieceRangeForRadius() in script.js), so its valid
 * range changes depending on what radius is currently selected.
 *
 * cpuDepth's default (0) is a sentinel, not a real ply count — it means
 * "no fixed depth cap; let cpuTime alone decide how deep the search
 * goes" (shown as "Auto" in the UI — see formatCpuDepthLabel() in
 * script.js), rather than "search 0 plies". Response time is what a
 * player actually feels turn to turn, so cpuTime is the parameter that
 * should reliably stay low/predictable; cpuDepth existing at all past
 * this is for advanced/testing use — pinning a specific, reproducible
 * ply cap (e.g. to compare two search implementations at an identical
 * depth — see FeatureConfig.computerself_strategies below) rather than
 * "however deep it gets in the time available", which will vary with
 * the device, board size, and position. See
 * AiStrategies.minimaxAlphaBetaID()'s own doc comment (aistrategies.js)
 * for exactly how the 0 sentinel is handled, and for the separate
 * "stop early once a good-enough move is found" behavior that exists
 * specifically so time-only (cpuDepth left at Auto) search doesn't just
 * burn the entire cpuTime budget once the position is already decided.
 */
const GAME_PARAM_RANGES = {
  radius:   { min: 2, max: 5, default: 2 },     // board radius
  cpuTime:  { min: 1, max: 30, default: 30 },   // computer's max think time, seconds
  cpuDepth: { min: 0, max: 5, default: 0 },     // computer's search depth cap, plies — 0 = no cap (see above)
};

/**
 * FeatureConfig
 * -------------
 * Toggles for optional gameplay rules, read once before the rest of the
 * page wires itself up (see index.html's script order — this file loads
 * first — and script.js's applyFeatureConfig()). Each entry controls two
 * independent things about one feature:
 *
 *   [ show_in_ui, default_value ]
 *
 *   show_in_ui     true  -> the feature's control is rendered in the
 *                           setup panel, so the player can change it.
 *                  false -> the control is hidden entirely; the feature
 *                           is fixed at default_value for the whole
 *                           session (nothing to change it back).
 *   default_value  the value the feature starts with internally,
 *                  independent of whether its control is shown.
 *
 * New optional features follow this same shape — add an entry here
 * rather than hardcoding a control's presence or default elsewhere.
 *
 * no_enclosure: whether a move that would trap an opponent piece (see
 * MoveRules.wouldIsolateOpponentPiece / legalMoveTargets in
 * moverules.js) is blocked, shown in the UI as the "No enclosure"
 * checkbox — checking it turns trapping moves OFF.
 *   default_value true  -> "No enclosure" starts CHECKED: enclosure is
 *                          NOT allowed, trapping moves are hidden/blocked
 *                          (except a move that also wins the game
 *                          outright, which is never blocked by this —
 *                          see wouldFullyConnectOwnColor).
 *                 false -> "No enclosure" starts UNCHECKED: enclosure IS
 *                          allowed, trapping moves are offered normally.
 */
const FeatureConfig = {
  no_enclosure: [true, false],

  /**
   * difficulty_levels: presets behind the "Difficulty" picker in the top
   * bar (the icon between the mode selector and the share button — see
   * index.html's #difficultyMenuToggle/#difficultyMenu, and
   * script.js's initDifficultyControl()/applyDifficultyLevel()). Each
   * entry is a full board (and, optionally, CPU) definition:
   *
   *   { label, r, f, cpuTime, cpuDepth, noEnclosure, cpuStrategy, challengeWins }
   *
   *   label        used only as the slider's tooltip/accessible name at
   *                that step — never shown as text in the picker itself,
   *                and none of the values below are ever surfaced to the
   *                player anywhere in that picker either. Selecting a
   *                level tells the player nothing about board size,
   *                piece count, or CPU strength, only its position from
   *                easiest to hardest (the slider itself, plain, with no
   *                numbers on it — see index.html's #difficultyRange).
   *   r            board radius (must be within CONFIG.MIN_RADIUS/
   *                MAX_RADIUS in script.js).
   *   f            pieces per color. Should fit pieceRangeForRadius(r)
   *                (see script.js) for that same r — a value outside
   *                that range is silently clamped into it when the level
   *                is applied, rather than rejected, so keep r/f matched
   *                to avoid a level quietly not doing what its position
   *                in the list implies.
   *   cpuTime      OPTIONAL. Computer's max think time in seconds — see
   *                GAME_PARAM_RANGES.cpuTime above for the actual
   *                min/max (clamped to it, not rejected, if out of
   *                range). Omit to leave whatever cpuTime is already in
   *                effect (session default, a ?cpuTime= URL param, or a
   *                manual edit) untouched — this only overrides it when
   *                present.
   *   cpuDepth     OPTIONAL, and none of the levels below actually set
   *                it (they rely on cpuTime + AiStrategies'
   *                good-enough-move early stop instead — see
   *                GAME_PARAM_RANGES' own doc comment above for why).
   *                Still supported for a level that specifically wants a
   *                fixed, reproducible ply cap instead of a time-governed
   *                one — see GAME_PARAM_RANGES.cpuDepth for min/max/the
   *                0 = "no cap" sentinel. Same "only overrides if
   *                present" behavior as cpuTime.
   *   noEnclosure  OPTIONAL boolean. Unlike cpuTime/cpuDepth above, this
   *                one does NOT just "leave it as-is" when omitted — a
   *                level without it resets noEnclosure to the
   *                FeatureConfig.no_enclosure default instead, since a
   *                stale rule silently surviving a board change (whether
   *                from picking a different level or dragging the
   *                radius/pieces sliders directly) is exactly the
   *                confusing behavior this is meant to avoid. Still
   *                subject to FeatureConfig.no_enclosure existing as a
   *                rule at all — this can't turn the rule on/off if the
   *                game itself doesn't use it.
   *   cpuStrategy  OPTIONAL. Name of one of AiStrategies.strategies (see
   *                aistrategies.js) — currently "minimaxAlphaBetaID"
   *                (the default; make/unmake + incremental connectivity)
   *                or "minimaxAlphaBetaCloning" (the older, slower,
   *                clone-per-node implementation, kept around specifically
   *                so the two can be compared — see DEFAULT_CPU_STRATEGY
   *                and computerself_strategies just below). Same "only
   *                overrides if present" behavior as cpuTime/cpuDepth —
   *                omit to leave whatever's already in effect untouched.
   *                In computerself mode, computerself_strategies (if it
   *                sets a value for that color) takes priority over this.
   *   challengeWins REQUIRED (unlike everything else in this list, which
   *                is optional). Only meaningful in the default minimalist
   *                win/loss "challenge ladder" (no ?classicMode=true — see
   *                applyChallengeOutcome() in script.js): net wins over
   *                the computer needed at *this specific level* before
   *                moving up (or, symmetrically, net losses before moving
   *                down) — every level sets its own, there's no shared
   *                fallback constant, so an easy level can ask for just a
   *                couple of confirming wins while a harder one demands a
   *                longer streak. Also sets that level's progress bar
   *                segment count (2x this), not just the threshold. A
   *                level that omits it falls back to 3 in script.js
   *                (challengeWinsForLevel()) purely as a defensive
   *                fallback against a config mistake, not a value meant to
   *                be relied on — always set this explicitly.
   *
   * MUST be listed easiest first, hardest last: the picker renders them
   * in this exact order with no other cue to their relative difficulty.
   *
   * Tournament progression design (10 levels):
   *   - Blocks: Aprendizaje (1-3), Táctica (4-6), Estructura (7-9),
   *     Final (10). See notes at the bottom of this file.
   *   - r climbs four times (2 -> 3 -> 4 -> 5), each jump paired with a
   *     bigger f rather than a bigger cpuTime at the same moment.
   *   - cpuDepth is intentionally left unset on every level (see
   *     GAME_PARAM_RANGES.cpuDepth's doc comment above) — depth is
   *     time-governed throughout the whole progression, not a separate
   *     dial. cpuTime + f (more pieces to coordinate) carry the
   *     difficulty curve between them.
   *   - cpuTime mostly holds at a flat 5s through the middle of the
   *     curve (N4-N9) — f and, at N7, noEnclosure are what actually make
   *     those levels harder, not a growing think-time budget every step.
   *   - noEnclosure switches ON at level 7 as a deliberate rule-change
   *     moment, once the player already knows the r=4 board.
   *   - Level 10 jumps to r=5 with by far the most pieces (f=30) and the
   *     longest think time (10s) of any level, though still well short
   *     of GAME_PARAM_RANGES.cpuTime's own max (30s).
   */
  difficulty_levels: [
    // --- Bloque Aprendizaje (1-3) ------------------------------------
    { label: "N1 — Primer contacto",   r: 2, f:  3, cpuTime:  1, challengeWins: 3 },
    { label: "N2 — Fácil",             r: 2, f:  4, cpuTime:  1, challengeWins: 3 },
    { label: "N3 — Primer reto",       r: 2, f:  5, cpuTime:  3, challengeWins: 3 },

    // --- Bloque Táctica (4-6) ----------------------------------------
    { label: "N4 — Táctica",           r: 3, f:  7, cpuTime:  5, challengeWins: 4 },
    { label: "N5 — IA rápida",         r: 3, f:  9, cpuTime:  5, challengeWins: 4 },
    { label: "N6 — Tablero grande",    r: 3, f: 11, cpuTime:  5, challengeWins: 4 },

    // --- Bloque Estructura (7-9): entra "no enclosure" ---------------
    { label: "N7 — Sin encierro",      r: 4, f: 10, cpuTime:  5, challengeWins: 2, noEnclosure: true },
    { label: "N8 — IA sólida",         r: 4, f: 12, cpuTime:  5, challengeWins: 2, noEnclosure: true },
    { label: "N9 — Muro",              r: 4, f: 14, cpuTime:  5, challengeWins: 2, noEnclosure: true },

    // --- Bloque Final (10) -------------------------------------------
    { label: "N10 — Jefe final",       r: 5, f: 30, cpuTime: 10, challengeWins: 1, noEnclosure: true },
  ],

  // Index into difficulty_levels applied at the start of every fresh
  // session (see resetAllRangeInputs() in script.js), before the player
  // has touched the picker — and again after every hard reload, since
  // the choice isn't remembered between visits. A ?radius=/?pieces= URL
  // param, if present, still overrides this (see applyUrlConfig()).
  DEFAULT_DIFFICULTY_INDEX: 0,

  // Fallback AiStrategies.strategies name (see aistrategies.js) for any
  // CPU move whose difficulty level doesn't set its own cpuStrategy (see
  // difficulty_levels above) — i.e. the engine actually used almost all
  // the time, since none of the levels above override it. Change this
  // one line to run the whole game on the older "minimaxAlphaBetaCloning"
  // engine instead, without touching every level.
  DEFAULT_CPU_STRATEGY: "minimaxAlphaBetaID",

  // computerself ("AI vs AI") only: an optional per-color override of
  // which engine each side uses, letting black and white run genuinely
  // different search implementations against each other in the same
  // game — the main reason to do this is comparing them directly (speed,
  // move quality, who tends to win) rather than just reading isolated
  // numbers off the ?showAdvanced=true CPU search log for two separate
  // games. Ignored entirely outside computerself (vscomputer only ever
  // has one CPU, governed by DEFAULT_CPU_STRATEGY/cpuStrategy above).
  //
  // A color set to a falsy value (empty string, null, etc.) falls back to
  // the normal resolution (current level's cpuStrategy, else
  // DEFAULT_CPU_STRATEGY) instead of forcing anything — so you don't have
  // to touch this at all for ordinary play. By default both colors are
  // the current engine, i.e. this changes nothing until you edit it.
  computerself_strategies: {
    black: "minimaxAlphaBetaID",
    white: "minimaxAlphaBetaID",
  },
};

// Example base URL shown in the "?" help panel (see index.html's
// #helpOverlay / script.js's dom.helpUrlExample) when illustrating how to
// build a preconfigured game link — kept here, not hardcoded in the HTML,
// so it's a one-line edit if the game ever moves to a different domain.
const HELP_URL_EXAMPLE = "https://selfo.games?mode=vscomputer&radius=3&cpuTime=15";

/**
 * URL_PARAMS
 * ----------
 * Documents every ?param=value query-string option applyUrlConfig() (see
 * script.js) reads at load — shown to the player in the "?" help panel
 * (index.html's #helpOverlay, built by script.js's buildHelpParamsList()),
 * so that panel and what the URL actually accepts can't drift apart: they
 * both come from this one list.
 *
 * Each entry: { param, description }
 *   param        the exact query-string key as it must appear in the URL
 *                (e.g. "radius" for ?radius=3) — keep it identical to the
 *                matching params.get(...) call in applyUrlConfig().
 *   description  one short, player-facing sentence: what it does and,
 *                where useful, its accepted values or range.
 *
 * Listed in the order applyUrlConfig() reads them. Adding a new URL
 * parameter there should mean adding one entry here too.
 *
 * The radius/cpuTime/cpuDepth descriptions below spell their min/max out
 * as plain text for the player, rather than interpolating
 * GAME_PARAM_RANGES — if you change a range up top, update the matching
 * number(s) here too so the help panel doesn't quote a stale range.
 */
const URL_PARAMS = [
  { param: "showAdvanced", description: "true shows the full setup and options panels (board size, pieces, no-enclosure rule, CPU search settings, color choice) instead of the compact default view." },
  { param: "classicMode", description: "true restores the mode and difficulty icons plus manual control over both, and shares full setup links — instead of the default minimalist win/loss challenge ladder against the computer." },
  { param: "mode", description: "Game mode: local2p (pass and play), online2p (remote, needs join), vscomputer, or computerself." },
  { param: "radius", description: "Board radius, from 2 (smallest) to 5 (largest)." },
  { param: "pieces", description: "Pieces per color. Out-of-range values are clamped to whatever the chosen radius allows." },
  { param: "noEnclosure", description: "true or false — whether trapping an opponent's piece is blocked. Only takes effect if the \"No enclosure\" control itself isn't locked out of the UI." },
  { param: "color", description: "black or white — which color the human player controls in vscomputer mode." },
  { param: "cpuTime", description: "Computer's max think time per move, in seconds (1-30)." },
  { param: "cpuDepth", description: "Computer's fixed search-depth cap, in plies (0-5). 0 (the default) means no cap — think time alone decides how deep it searches." },
  { param: "name", description: "Display name shown to the other player (online2p) or in the players box, up to 18 characters." },
  { param: "join", description: "A room code — opens directly into online2p and connects to that room." },
];

/**
 * Notas sobre la progresión del torneo (para referencia del diseñador)
 * --------------------------------------------------------------------
 * Bloques:
 *   1-3  Aprendizaje : r=2, f=3-5, sin no-enclosure. Enseñan mecánicas.
 *   4-6  Táctica     : r=3, f=7-11, sin no-enclosure. Sube f, cpuTime=5
 *                      fijo desde aquí.
 *   7-9  Estructura  : r=4, f=10-14, no-enclosure ON. Cambio de reglas.
 *   10   Final       : r=5, f=30, cpuTime=10 (tablero y plantilla mucho
 *                      mayores que en cualquier nivel anterior).
 *
 * cpuDepth: deliberadamente SIN especificar en ningún nivel — queda en
 *   0 ("Auto"), así que la profundidad la decide en cada turno el propio
 *   tiempo disponible (cpuTime) más el corte anticipado al encontrar una
 *   jugada ya suficientemente buena (ver el comentario de
 *   AiStrategies.minimaxAlphaBetaID() en aistrategies.js). Esto es a
 *   propósito: el tiempo de respuesta es lo que el jugador nota partida
 *   a partida, así que es la única palanca de dificultad relacionada con
 *   "cuánto piensa" — no hay una curva de profundidad que mantener en
 *   paralelo a la de tiempo.
 * Curva de cpuTime  : 1, 1, 3, 5, 5, 5, 5, 5, 5, 10 (sube rápido en el
 *                     bloque de aprendizaje y luego se queda plana en 5s
 *                     durante todo Táctica+Estructura — ahí la dificultad
 *                     la aporta f, no más tiempo de la CPU — y solo vuelve
 *                     a subir en el nivel final).
 * Curva de r        : 2, 2, 2, 3, 3, 3, 4, 4, 4, 5   (4 saltos: el de N10
 *                     a r=5 es nuevo respecto al diseño anterior).
 * Curva de f        : 3, 4, 5, 7, 9, 11, 10, 12, 14, 30 (asciende en casi
 *                     todos los niveles — es la palanca principal de
 *                     dificultad dentro de cada bloque de r constante;
 *                     el salto a 30 en N10 es mucho mayor que cualquier
 *                     otro paso de la tabla).
 * noEnclosure       : OFF hasta N6, ON desde N7. Es un cambio binario de
 *                     reglas, no un parámetro gradual: por eso se
 *                     introduce solo, en un nivel donde el tablero (r=4)
 *                     ya es familiar desde N6.
 *
 * Ajustes finos si hicieran falta:
 *   - N10 (r=5, f=30) es un salto notablemente más grande que el resto
 *     de la progresión — si se siente como un muro en vez de un cierre
 *     natural, considerar un escalón intermedio (p.ej. r=4, f=20-24)
 *     antes de N10, o bajar f directamente si las partidas se hacen
 *     eternas (con f=30 sobre 91 celdas el tablero queda muy denso).
 *   - Si N7 (no-enclosure) resulta demasiado brusco, probar a activarlo
 *     ya en N6 con r=3 y luego en N7 con r=4.
 *   - Si algún nivel se siente demasiado errático con tan poco cpuTime
 *     (p.ej. N1/N2), es la primera palanca a subir — con cpuDepth en
 *     "Auto" no hay una segunda palanca de profundidad que compense por
 *     separado.
 *   - Si se quiere un nivel con dificultad reproducible exactamente
 *     igual en cualquier dispositivo (p.ej. para comparar motores, ver
 *     FeatureConfig.computerself_strategies), es el caso de uso pensado
 *     para fijar cpuDepth explícitamente en ese nivel en concreto, en
 *     vez de dejarlo en "Auto".
 */