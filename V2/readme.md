# Selfo

A futuristic, metallic-themed hexagonal **connection board game**.

Two players take turns moving one of their pieces to an empty adjacent
cell. The first player to connect **all** of their pieces into a single
group (every piece reachable from every other piece through adjacent
same-color cells) wins. Black always moves first; White may invoke the
**pie rule** and swap colors instead of making a move, but only on
White's very first turn.

## Play it

Open `index.html` in any modern browser — no build step, no server
required for local 2-player games. It's a single static page
(`index.html` + `style.css` + `script.js` + `hexgeometry.js`).

### Modes available now
- **2 players, same device** — pass the device back and forth.
- **2 players, online (code)** — one player creates a game and shares
  the 6-character code (or the generated link) with the other, who
  joins with it. This uses [PeerJS](https://peerjs.com) over WebRTC
  with its free public signaling broker, so both files just need to be
  served over `https://` (GitHub Pages works out of the box).

### Coming soon
- **Vs computer** and **computer vs computer** — the buttons are in
  place but disabled. The move/turn engine already reads its rules
  (`RULES.maxStepsPerMove`, `RULES.movesPerTurn`) from a single object
  in `script.js`, so a future multi-step-move or multi-move-per-turn
  variant only needs new UI controls, not a rewrite.

## Install on GitHub Pages

1. Create a new repository (or use an existing one) and add these four
   files to its root: `index.html`, `style.css`, `script.js`,
   `hexgeometry.js`.
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
| `script.js`        | Game state machine, rendering, rules, online play (PeerJS)  |