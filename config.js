"use strict";

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
   *   { label, r, f, cpuTime, cpuDepth, noEnclosure }
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
   *   cpuTime      OPTIONAL. Computer's max think time in seconds (1-30,
   *                clamped). Omit to leave whatever cpuTime is already in
   *                effect (session default, a ?cpuTime= URL param, or a
   *                manual edit) untouched — this only overrides it when
   *                present.
   *   cpuDepth     OPTIONAL. Computer's search depth (1-5, clamped).
   *                Same "only overrides if present" behavior as cpuTime.
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
   *
   * MUST be listed easiest first, hardest last: the picker renders them
   * in this exact order with no other cue to their relative difficulty.
   *
   * Tournament progression design (10 levels):
   *   - Blocks: Aprendizaje (1-3), Táctica (4-6), Estructura (7-9),
   *     Final (10). See the designer notes at the bottom of this file
   *     for the full rationale.
   *   - r climbs only three times (2 -> 3 -> 4); never together with a
   *     big CPU jump.
   *   - cpuDepth is NON-DECREASING:  1, 1, 2, 2, 3, 3, 3, 4, 4, 5.
   *   - cpuTime is STRICTLY INCREASING: 1, 2, 3, 5, 8, 10, 12, 18, 22,
   *     30 — and ALWAYS >= the minimum time that cpuDepth actually
   *     needs for that (r, f). Never raise cpuDepth without raising
   *     cpuTime: the engine would otherwise cut the search short (the
   *     level would lie about its real strength) or block the UI thread.
   *   - noEnclosure switches ON at level 7 as a deliberate rule-change
   *     moment, once the player already knows the r=4 board.
   *   - Level 10 uses the full CPU budget (30s / depth 5) and is the
   *     only level that does so.
   */
  difficulty_levels: [
    // --- Bloque Aprendizaje (1-3) ------------------------------------
    { label: "N1 — Primer contacto",   r: 2, f: 3,  cpuTime: 1,  cpuDepth: 1 },
    { label: "N2 — Fácil",             r: 2, f: 4,  cpuTime: 2,  cpuDepth: 1 },
    { label: "N3 — Primer reto",       r: 3, f: 4,  cpuTime: 3,  cpuDepth: 2 },

    // --- Bloque Táctica (4-6) ----------------------------------------
    { label: "N4 — Táctica",           r: 3, f: 5,  cpuTime: 5,  cpuDepth: 2 },
    { label: "N5 — Profundidad",       r: 3, f: 6,  cpuTime: 8,  cpuDepth: 3 },
    { label: "N6 — Tablero grande",    r: 4, f: 5,  cpuTime: 10, cpuDepth: 3 },

    // --- Bloque Estructura (7-9): entra "no enclosure" ---------------
    { label: "N7 — Sin encierro",      r: 4, f: 6,  cpuTime: 12, cpuDepth: 3, noEnclosure: true },
    { label: "N8 — IA sólida",         r: 4, f: 7,  cpuTime: 18, cpuDepth: 4, noEnclosure: true },
    { label: "N9 — Muro",              r: 4, f: 8,  cpuTime: 22, cpuDepth: 4, noEnclosure: true },

    // --- Bloque Final (10) -------------------------------------------
    { label: "N10 — Jefe final",       r: 4, f: 10, cpuTime: 30, cpuDepth: 5, noEnclosure: true },
  ],

  // Index into difficulty_levels applied at the start of every fresh
  // session (see resetAllRangeInputs() in script.js), before the player
  // has touched the picker — and again after every hard reload, since
  // the choice isn't remembered between visits. A ?radius=/?pieces= URL
  // param, if present, still overrides this (see applyUrlConfig()).
  DEFAULT_DIFFICULTY_INDEX: 0,
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
 * Acoplamiento cpuDepth / cpuTime (importante):
 *   cpuDepth=d implica explorar ~b^d nodos, con branching factor b que
 *   crece con r y f. cpuTime es el presupuesto para recorrer ese árbol.
 *   Por eso cpuTime NUNCA puede bajar del mínimo que exige el cpuDepth
 *   de ese nivel para ese (r, f): si no, el motor corta la búsqueda a
 *   medias (el nivel miente sobre su fuerza real) o ignora el límite y
 *   congela la UI. Regla práctica usada aquí:
 *
 *     cpuDepth | cpuTime mínimo orientativo
 *     ---------|---------------------------
 *        1     | 1s (r=2),  1s (r=3),  2s (r=4)
 *        2     | 2s (r=2),  3s (r=3),  5s (r=4)
 *        3     | 4s (r=2),  6s (r=3), 10s (r=4)
 *        4     |    —       10s (r=3), 18s (r=4)
 *        5     |    —          —       30s (r=4)
 *
 * Curvas resultantes (todas coherentes con lo anterior):
 *   cpuDepth : 1, 1, 2, 2, 3, 3, 3, 4, 4, 5   (no decreciente)
 *   cpuTime  : 1, 2, 3, 5, 8,10,12,18,22,30   (estrictamente creciente,
 *              y siempre >= mínimo(r, f, cpuDepth))
 *   r        : 2, 2, 3, 3, 3, 4, 4, 4, 4, 4   (3 saltos, nunca junto a
 *              un salto grande de CPU)
 *   noEncl.  : OFF hasta N6, ON desde N7
 *
 * La "textura" entre niveles con el mismo cpuDepth la da:
 *   - el cpuTime extra (misma profundidad, mejor elección dentro de
 *     ella — ver N3→N4, N7→N8→N9),
 *   - el cambio de reglas (N7, no-enclosure),
 *   - el tamaño del tablero y el número de fichas (N5→N6 sube r sin
 *     subir depth).
 * NUNCA se consigue bajando cpuTime por debajo del mínimo que exige el
 * cpuDepth del nivel: eso no es "textura", es un motor que no termina.
 *
 * Ajustes finos si hicieran falta:
 *   - Si N10 con f=10 se hace eterno, bajar f a 8-9 (sigue siendo
 *     claramente el más duro por cpuTime/cpuDepth).
 *   - Si N7 (no-enclosure) resulta demasiado brusco, probar a activarlo
 *     ya en N6 con r=3 y luego en N7 con r=4.
 *   - Si depth=1 se siente demasiado tonto, subir cpuTime (no depth):
 *     con 1 solo movimiento analizado, más tiempo solo mejora la
 *     elección dentro de esa limitación, que es justo lo que se busca
 *     en N1-N2.
 *   - Si los mínimos de la tabla resultan conservadores para tu motor
 *     concreto, ajústalos midiendo el tiempo real por profundidad en
 *     cada (r, f) y recalculando la columna cpuTime hacia arriba (nunca
 *     hacia abajo).
 */