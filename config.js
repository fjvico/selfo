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
   */
  difficulty_levels: [
    { label: "Easy",   r: 2, f: 6,  cpuTime: 5,  cpuDepth: 2 },
    { label: "Medium", r: 3, f: 10, cpuTime: 15, cpuDepth: 3, noEnclosure: true },
    { label: "Hard",   r: 4, f: 16 },
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
