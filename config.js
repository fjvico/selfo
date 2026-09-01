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
 * allow_enclosure: whether a move that would trap an opponent piece
 * (see wouldIsolateOpponentPiece / legalMoveTargets in script.js) is
 * offered as legal at all.
 *   default_value true  -> enclosure IS allowed (the no-enclosure move
 *                          restriction starts OFF).
 *                 false -> enclosure is NOT allowed (the restriction
 *                          starts ON, trapping moves are hidden/blocked).
 */
const FeatureConfig = {
  allow_enclosure: [false, true],
};
