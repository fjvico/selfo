# Selfo

A futuristic, metallic-themed hexagonal **connection board game**.

Two players take turns moving one of their pieces to an empty adjacent
cell. The first player to connect **all** of their pieces into a single
group (every piece reachable from every other piece through adjacent
same-color cells) wins. Black always moves first; White may invoke the
**pie rule** and swap colors instead of making a move, but only on
White's very first turn.

## Play it

Open `index.html` in any modern browser — no build step required. For
2-player-on-one-device games, no server is needed either; it's a
single static page (`index.html` + `style.css` + `script.js` +
`hexgeometry.js` + `boardinit.js`). Online play and the computer
modes need it served over `http(s)://` instead — see the notes below.

### Modes available now
- **2 players, same device** — pass the device back and forth.
- **2 players, online (code)** — one player creates a game and shares
  the 6-character code (or the generated link) with the other, who
  joins with it. This uses [PeerJS](https://peerjs.com) over WebRTC
  with its free public signaling broker, so both files just need to be
  served over `https://` (GitHub Pages works out of the box).
- **Vs computer** — pick a color, then play against the CPU (powered
  by `aistrategies.js`'s alpha-beta minimax search). Adjustable think
  time and search depth in the setup panel.
- **Computer vs computer** — sit back and watch two CPU players face
  off; useful for testing the AI or just enjoying the metallic glow.

Both computer modes run the search in a Web Worker (`aistrategies.js`
also acts as the worker script), so the board and buttons stay
responsive even at high think-time/depth settings on larger boards —
the search never blocks the page's main thread. One consequence:
because browsers block Workers from loading scripts over `file://`,
the two computer modes need the page served over `http(s)://` (any
static server, or GitHub Pages) — they won't work if you just
double-click `index.html`. 2-player-on-one-device mode is unaffected
and still works straight from disk.

### Coming soon
- Multi-step moves and multi-move turns — the move/turn engine already
  reads its rules (`RULES.maxStepsPerMove`, `RULES.movesPerTurn`) from
  a single object in `script.js`, so this only needs new UI controls,
  not a rewrite.

## Pre-configuring via the URL

The whole setup panel can be filled in from the page's own URL, so a
link alone can open the game with a specific mode, board size, color,
or CPU settings already chosen — no clicking through the panel first.
All parameters are optional and safe to combine; unknown or invalid
values are just ignored.

| Parameter  | Values                                              |
|------------|------------------------------------------------------|
| `mode`     | `local2p`, `online2p`, `vscomputer`, `computerself`  |
| `radius`   | `2`–`6` — board radius                                |
| `pieces`   | integer — pieces per player (clamped to what's valid for `radius`) |
| `color`    | `black` or `white` — which color the human plays in `vscomputer` |
| `cpuTime`  | `1`–`30` — CPU max think time, in seconds             |
| `cpuDepth` | `1`–`5` — CPU max search depth                        |
| `name`     | up to 18 characters — pre-fills your own name          |
| `join`     | an online room code — connects directly as a guest (implies `mode=online2p`, and overrides any other `mode=`) |

Example: `index.html?mode=vscomputer&color=white&radius=4&cpuDepth=4`
opens straight into "vs computer," human playing white, a radius-4
board, and the CPU searching 4 moves ahead.

The **LINK** button in the top bar builds one of these automatically
from whatever's currently configured (or, in online mode, an invite
link with a room code instead) and copies it to the clipboard.

## Install on GitHub Pages

1. Create a new repository (or use an existing one) and add these six
   files to its root: `index.html`, `style.css`, `script.js`,
   `hexgeometry.js`, `boardinit.js`, `aistrategies.js`.
2. Commit and push to the `main` branch.
3. In the repository, go to **Settings → Pages**, set **Source** to
   `Deploy from a branch`, branch `main`, folder `/ (root)`, and save.
4. After a minute your game is live at
   `https://<your-username>.github.io/<repo-name>/`.

## Project structure

| File              | Purpose                                                     |
|-------------------|--------------------------------------------------------------|
| `index.html`      | Page structure: top bar, options panel, board, setup panel  |
| `style.css`        | Metallic/futuristic visual theme, responsive layout          |
| `hexgeometry.js`   | Pure hex-grid math (axial coordinates, neighbors, pixel conversion) |
| `boardinit.js`     | Empty-board / adjacency-map generation strategies             |
| `aistrategies.js`  | Computer-player search strategies (alpha-beta minimax); also doubles as the Web Worker script that runs the search off the main thread |
| `script.js`        | Game state machine, rendering, rules, online play (PeerJS), CPU turn wiring |