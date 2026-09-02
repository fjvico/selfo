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
  no_enclosure: [true, true],
};