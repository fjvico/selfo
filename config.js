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
   * index.html's #difficultyMenuToggle/#difficultyMenu, which are built
   * from this array by script.js's buildDifficultyMenu(), and applied by
   * selectDifficultyLevel()). Each entry is a full board definition:
   *
   *   { label, r, f }
   *
   *   label  used only as the button's tooltip/accessible name — never
   *          shown as text in the picker itself, and the r/f values
   *          below are never surfaced to the player anywhere in that
   *          picker either. Selecting a level tells the player nothing
   *          about board size or piece count, only its position from
   *          easiest to hardest (shown purely as an ascending bars icon
   *          — see buildDifficultyIcon() in script.js).
   *   r      board radius (must be within CONFIG.MIN_RADIUS/MAX_RADIUS
   *          in script.js).
   *   f      pieces per color. Should fit pieceRangeForRadius(r) (see
   *          script.js) for that same r — a value outside that range is
   *          silently clamped into it when the level is applied, rather
   *          than rejected, so keep r/f matched to avoid a level quietly
   *          not doing what its position in the list implies.
   *
   * MUST be listed easiest first, hardest last: the picker renders them
   * in this exact order with no other cue to their relative difficulty.
   */
  difficulty_levels: [
    { label: "Easy",   r: 2, f: 6 },
    { label: "Medium", r: 3, f: 10 },
    { label: "Hard",   r: 4, f: 16 },
  ],

  // Index into difficulty_levels applied at the start of every fresh
  // session (see resetAllRangeInputs() in script.js), before the player
  // has touched the picker — and again after every hard reload, since
  // the choice isn't remembered between visits. A ?radius=/?pieces= URL
  // param, if present, still overrides this (see applyUrlConfig()).
  DEFAULT_DIFFICULTY_INDEX: 0,
};