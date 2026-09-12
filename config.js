"use strict";

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
 */
const GAME_PARAM_RANGES = {
  radius:   { min: 2, max: 5, default: 2 },     // board radius
  cpuTime:  { min: 1, max: 30, default: 30 },   // computer's max think time, seconds
  cpuDepth: { min: 1, max: 5, default: 5 },     // computer's search depth, plies
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
   *   { label, r, f, cpuTime, cpuDepth, noEnclosure, cpuStrategy }
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
   *   cpuDepth     OPTIONAL. Computer's search depth — see
   *                GAME_PARAM_RANGES.cpuDepth above for min/max. Same
   *                "only overrides if present" behavior as cpuTime.
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
   *
   * MUST be listed easiest first, hardest last: the picker renders them
   * in this exact order with no other cue to their relative difficulty.
   *
   * Tournament progression design (10 levels):
   *   - Blocks: Aprendizaje (1-3), Táctica (4-6), Estructura (7-9),
   *     Final (10). See notes at the bottom of this file.
   *   - r climbs only three times (2 -> 3 -> 4); never together with a
   *     big CPU jump.
   *   - cpuDepth climbs in steps: 1,1,2,2,3,3,3,4,4,5.
   *   - cpuTime uses a sawtooth so some levels feel "fast but sharp"
   *     (high depth, low time) and others "slow but shallow".
   *   - noEnclosure switches ON at level 7 as a deliberate rule-change
   *     moment, once the player already knows the r=4 board.
   *   - Level 10 uses the full CPU budget (30s / depth 5) and is the
   *     only level that does so.
   */
  difficulty_levels: [
    // --- Bloque Aprendizaje (1-3) ------------------------------------
    { label: "N1 — Primer contacto",   r: 2, f: 3,  cpuTime: 1,  cpuDepth: 1 },
    { label: "N2 — Fácil",             r: 2, f: 4,  cpuTime: 3,  cpuDepth: 1 },
    { label: "N3 — Primer reto",       r: 3, f: 4,  cpuTime: 3,  cpuDepth: 2 },

    // --- Bloque Táctica (4-6) ----------------------------------------
    { label: "N4 — Táctica",           r: 3, f: 5,  cpuTime: 5,  cpuDepth: 2 },
    { label: "N5 — IA rápida",         r: 3, f: 6,  cpuTime: 1,  cpuDepth: 3 },
    { label: "N6 — Tablero grande",    r: 4, f: 5,  cpuTime: 8,  cpuDepth: 3 },

    // --- Bloque Estructura (7-9): entra "no enclosure" ---------------
    { label: "N7 — Sin encierro",      r: 4, f: 6,  cpuTime: 8,  cpuDepth: 3, noEnclosure: true },
    { label: "N8 — IA sólida",         r: 4, f: 7,  cpuTime: 12, cpuDepth: 4, noEnclosure: true },
    { label: "N9 — Muro",              r: 4, f: 8,  cpuTime: 18, cpuDepth: 4, noEnclosure: true },

    // --- Bloque Final (10) -------------------------------------------
    { label: "N10 — Jefe final",       r: 4, f: 10, cpuTime: 30, cpuDepth: 5, noEnclosure: true },
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
  { param: "mode", description: "Game mode: local2p (pass and play), online2p (remote, needs join), vscomputer, or computerself." },
  { param: "radius", description: "Board radius, from 2 (smallest) to 5 (largest)." },
  { param: "pieces", description: "Pieces per color. Out-of-range values are clamped to whatever the chosen radius allows." },
  { param: "noEnclosure", description: "true or false — whether trapping an opponent's piece is blocked. Only takes effect if the \"No enclosure\" control itself isn't locked out of the UI." },
  { param: "color", description: "black or white — which color the human player controls in vscomputer mode." },
  { param: "cpuTime", description: "Computer's max think time per move, in seconds (1-30)." },
  { param: "cpuDepth", description: "Computer's search depth — how many moves ahead it evaluates (1-5)." },
  { param: "name", description: "Display name shown to the other player (online2p) or in the players box, up to 18 characters." },
  { param: "join", description: "A room code — opens directly into online2p and connects to that room." },
];

/**
 * Notas sobre la progresión del torneo (para referencia del diseñador)
 * --------------------------------------------------------------------
 * Bloques:
 *   1-3  Aprendizaje : r=2-3, f=3-4, sin no-enclosure. Enseñan mecánicas.
 *   4-6  Táctica     : r=3-4, f=5-6, sin no-enclosure. Sube profundidad.
 *   7-9  Estructura  : r=4 fijo, f=6-8, no-enclosure ON. Cambio de reglas.
 *   10   Final       : r=4, f=10, cpuTime=30, cpuDepth=5. Presupuesto total.
 *
 * Curva de cpuDepth : 1, 1, 2, 2, 3, 3, 3, 4, 4, 5   (escalonada)
 * Curva de cpuTime  : 1, 3, 3, 5, 1, 8, 8, 12, 18, 30 (diente de sierra:
 *                     el N5 baja a 1s para sentirse "rápido pero agudo",
 *                     con depth 3 — un cambio de textura, no de nivel).
 * Curva de r        : 2, 2, 3, 3, 3, 4, 4, 4, 4, 4   (3 saltos, nunca
 *                     junto a un salto grande de CPU).
 * noEnclosure       : OFF hasta N6, ON desde N7. Es un cambio binario de
 *                     reglas, no un parámetro gradual: por eso se
 *                     introduce solo, en un nivel donde el tablero (r=4)
 *                     ya es familiar desde N6.
 *
 * Ajustes finos si hicieran falta:
 *   - Si N10 con f=10 se hace eterno, bajar f a 8-9 (sigue siendo
 *     claramente el más duro por cpuTime/cpuDepth).
 *   - Si N7 (no-enclosure) resulta demasiado brusco, probar a activarlo
 *     ya en N6 con r=3 y luego en N7 con r=4.
 *   - Si depth=1 se siente demasiado tonto, subir cpuTime (no depth):
 *     con 1 solo movimiento analizado, más tiempo solo mejora la
 *     elección dentro de esa limitación, que es justo lo que se busca
 *     en N1.
 */