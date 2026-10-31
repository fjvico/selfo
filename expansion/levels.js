/**
 * game/expansion/levels.js — niveles de la ESCALERA DE AMPLIACIÓN (radios 3 y 4), zona oculta.
 * Se carga solo la primera vez que se activa (pulsación larga de >= 3 s en el botón de dificultad; ver ExpansionLadder en script.js).
 * Mismo formato que FeatureConfig.difficulty_levels de config.js: { label, r, f, cpuTime, challengeWins, boardColor, gridColor, noEnclosure }.
 * Aquí se ajusta a mano el tiempo de reflexión (cpuTime, en segundos, 1-30), los colores y las victorias por nivel:
 * cambiar estos valores NO obliga a regenerar las listas. Cambiar r, f o noEnclosure SÍ (cada nivel necesita su lista R_f_e|n en game/expansion/lists.js).
 *
 * ranges / size / seed: los usa tools/expansion/gen_lists.js para generar game/expansion/lists.js. Los rangos son de PLIES de la
 * partida perfecta (en radio 3-4 las partidas son más largas que en radio 2); cada lista tiene un nivel de dificultad por rango y la
 * mitad de las posiciones ganan negras, la mitad blancas (hay que adivinar quién gana). El juego solo usa de los rangos su NÚMERO (3).
 *
 * Límites del generador: radio 3 hasta f=8 (f=9 exige subir el límite de la tabla dist), radio 4 hasta f=6.
 * Los cpuTime son un PUNTO DE PARTIDA sin calibrar: el motor wasm admite cualquier radio, pero con más casillas llega menos profundo en el mismo tiempo.
 */
window.__SELFO_EXPANSION = {
  ranges: [[5, 8], [9, 12], [13, 16]],
  size: 100,
  seed: 20261011,
  levels: [
    // --- Radio 3 (37 casillas) ---------------------------------------
    { label: "E1 — Radio 3, primer paso",  r: 3, f: 4, cpuTime: 4,  challengeWins: 3 },
    { label: "E2 — Radio 3",               r: 3, f: 5, cpuTime: 6,  challengeWins: 3, boardColor: "#168F9C", gridColor: "#149DAB" },
    { label: "E3 — Radio 3, táctica",      r: 3, f: 6, cpuTime: 8,  challengeWins: 3, boardColor: "#397BC5", gridColor: "#3583D4" },
    { label: "E4 — Radio 3, estructura",   r: 3, f: 7, cpuTime: 10, challengeWins: 5, boardColor: "#7954B5", gridColor: "#7C4EC2" },
    { label: "E5 — Radio 3, final",        r: 3, f: 8, cpuTime: 12, challengeWins: 5, boardColor: "#C24A6E", gridColor: "#D1436C" },
    // --- Radio 4 (61 casillas); E9 cambia la regla: sin encierro -------
    { label: "E6 — Radio 4",               r: 4, f: 4, cpuTime: 8,  challengeWins: 3, boardColor: "#2F8F5B", gridColor: "#35A56A" },
    { label: "E7 — Radio 4, más fichas",   r: 4, f: 5, cpuTime: 10, challengeWins: 3, boardColor: "#8A8F2E", gridColor: "#9AA032" },
    { label: "E8 — Radio 4, táctica",      r: 4, f: 6, cpuTime: 12, challengeWins: 5, boardColor: "#B8742E", gridColor: "#C9812F" },
    { label: "E9 — Radio 4, sin encierro", r: 4, f: 6, cpuTime: 14, challengeWins: 5, noEnclosure: true, boardColor: "#6f8f9a", gridColor: "#b8c7cc" },
  ],
};
