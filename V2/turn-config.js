// =======================================================================
// TURN server configuration (Metered.ca)
// -----------------------------------------------------------------------
// Kept in its own file, separate from script.js, so pulling in future
// updates of script.js never overwrites (or asks you to re-enter) your
// TURN credentials — you only ever touch this file.
//
// How to get these two values:
//   1. Sign up free at https://www.metered.ca
//   2. Create an app (Dashboard -> "Create a new app"). No spaces in the
//      name — only letters, numbers, "-" and "_". Its domain becomes
//      "<app-name>.metered.live" — that's METERED_APP_DOMAIN below.
//   3. Go to the "TURN Server" tab (not "Developers" — that page shows
//      the Secret Key, which must NEVER go in client-side code) and
//      generate a credential ("Add Credential" / "Generate Your First
//      Credential").
//   4. Copy that credential's API key (safe to ship in the browser — it
//      can only be used to mint short-lived TURN credentials) into
//      METERED_API_KEY below.
//
// Leave METERED_API_KEY empty to skip Metered entirely and fall back to
// the static/free TURN servers in script.js (works between two PCs,
// unreliable for mobile <-> desktop).
// =======================================================================

const METERED_APP_DOMAIN = "selfo.metered.live"; // e.g. "selfo.metered.live"
const METERED_API_KEY = "0c7dfa8e3f7c8dfedf07cdfbcd172e4d4351";    // the app's TURN Credential API key (NOT the account Secret Key)
