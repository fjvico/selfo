#!/usr/bin/env node
"use strict";
/**
 * selfplay.js — enfrenta el motor anterior (JS puro) con el actual (WebAssembly)
 * y contabiliza los resultados.
 *
 * Uso:
 *   node selfplay.js <partidas> <radius> <pieces> [opciones]
 *
 * Opciones:
 *   --depth N            profundidad máxima (0 = Auto: solo manda el tiempo). Por defecto 3
 *   --time S             tiempo máximo por jugada en segundos. Por defecto 5
 *   --no-enclosure       activa la regla "No enclosure" (por defecto: se permite encerrar)
 *   --max-moves N        jugadas totales (plies) a partir de las cuales la partida es tablas. Por defecto 200
 *   --first-move-depth N profundidad de la 1ª jugada de negras (como en el juego). Por defecto 1; 0 = sin límite especial
 *   --strategy NAME      estrategia (minimaxAlphaBetaID | minimaxAlphaBetaCloning). Por defecto: la del motor
 *   --seed N             semilla del generador de tableros (reproducible). Por defecto: aleatoria
 *   --current DIR        carpeta del motor actual.  Por defecto . (carpeta desde donde se ejecuta)
 *   --legacy DIR         carpeta del motor anterior. Por defecto ./legacy
 *   --verbose            imprime cada jugada
 *
 * Emparejamiento: las partidas se juegan por parejas sobre EL MISMO tablero,
 * intercambiando colores (partida 1: actual=negras; partida 2: actual=blancas...),
 * para que la ventaja de mover primero no favorezca a ningún motor.
 * El árbitro (legalidad de jugadas, victoria, encierro mutuo, sin movimientos)
 * es siempre el MoveRules del motor anterior. Una jugada ilegal hace perder al motor que la propone.
 * No se simula la regla de la tarta (intercambio de colores).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ------------------------------------------------------------------ argumentos
function parseArgs(argv) {
  const opts = { depth: 3, time: 5, noEnclosure: false, maxMoves: 200, firstMoveDepth: 1, strategy: undefined,
    seed: null, current: ".", legacy: "legacy", verbose: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) die(`Falta el valor de ${a}`); return argv[++i]; };
    switch (a) {
      case "--depth": opts.depth = Number(next()); break;
      case "--time": opts.time = Number(next()); break;
      case "--no-enclosure": opts.noEnclosure = true; break;
      case "--max-moves": opts.maxMoves = Number(next()); break;
      case "--first-move-depth": opts.firstMoveDepth = Number(next()); break;
      case "--strategy": opts.strategy = next(); break;
      case "--seed": opts.seed = Number(next()); break;
      case "--current": opts.current = next(); break;
      case "--legacy": opts.legacy = next(); break;
      case "--verbose": opts.verbose = true; break;
      case "-h": case "--help": usage(0); break;
      default:
        if (a.startsWith("--")) die(`Opción desconocida: ${a}`);
        pos.push(a);
    }
  }
  if (pos.length !== 3) usage(1);
  opts.games = Number(pos[0]); opts.radius = Number(pos[1]); opts.pieces = Number(pos[2]);
  for (const [k, v] of [["partidas", opts.games], ["radius", opts.radius], ["pieces", opts.pieces]]) {
    if (!Number.isInteger(v) || v < 1) die(`${k} debe ser un entero >= 1`);
  }
  for (const [k, v] of [["--depth", opts.depth], ["--time", opts.time], ["--max-moves", opts.maxMoves]]) {
    if (!Number.isFinite(v) || v < 0) die(`${k} debe ser un número >= 0`);
  }
  if (opts.time <= 0) die("--time debe ser > 0");
  if (opts.seed === null) opts.seed = (Math.random() * 2 ** 32) >>> 0;
  return opts;
}
function usage(code) {
  console.log(fs.readFileSync(__filename, "utf8").split("/**")[1].split("*/")[0].replace(/^ \* ?/gm, "").trim());
  process.exit(code);
}
function die(msg) { console.error("Error: " + msg); process.exit(1); }

// ------------------------------------------------------------------ carga de motores
function loadEngine(dir, label) {
  const ctx = vm.createContext({ performance, atob, console });
  let hasWasm = false; try { fs.accessSync(path.join(dir, "wasmengine.js"), fs.constants.R_OK); hasWasm = true; } catch (e) { /* motor sin wasm */ }
  const files = (hasWasm ? ["wasmengine.js"] : []).concat(["hexgeometry.js", "moverules.js", "aistrategies.js"]);
  for (const f of files) {
    const p = path.join(dir, f);
    let src;
    try { src = fs.readFileSync(p, "utf8"); }
    catch (e) {
      let extra = "";
      try { extra = `\n  Contenido de ${dir}: ${fs.readdirSync(dir).join(", ") || "(vacío)"}`; }
      catch (e2) { extra = `\n  No se puede leer la carpeta ${dir}: ${e2.code} (${e2.message})`; }
      try { const l = fs.lstatSync(p); if (l.isSymbolicLink()) extra += `\n  ${p} es un enlace simbólico hacia ${fs.readlinkSync(p)}`; } catch (e3) { /* no existe ni como enlace */ }
      die(`${label}: no se puede leer ${p}: ${e.code} (${e.message})\n  Node ${process.version} en ${process.platform}, usuario uid=${process.getuid ? process.getuid() : "?"}, cwd=${process.cwd()}${extra}`);
    }
    vm.runInContext(src, ctx, { filename: p });
  }
  if (hasWasm && !vm.runInContext("WasmEngine.isReady", ctx)) die(`${label}: el wasm no se instanció de forma síncrona`);
  return { api: vm.runInContext("({ HexGeometry, MoveRules, AiStrategies })", ctx), wasm: hasWasm };
}

// ------------------------------------------------------------------ utilidades
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const opp = (c) => (c === "black" ? "white" : "black");

// ------------------------------------------------------------------ generación de tableros (misma lógica que buildBoard del juego)
function makeBoardFactory(HG, MR, rand) {
  const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function groupSizeIfAdded(k, set, nb) {
    const seen = new Set([k]), st = [k];
    while (st.length) { const x = st.pop(); for (const n of nb.get(x)) if (set.has(n) && !seen.has(n)) { seen.add(n); st.push(n); } }
    return seen.size;
  }
  function place(keys, nb, count, maxGroup) {
    let best = [];
    for (let a = 0; a < 25 && best.length < count; a++) {
      const order = shuffled(keys), chosen = [], set = new Set();
      for (const k of order) {
        if (chosen.length >= count) break;
        const sz = groupSizeIfAdded(k, set, nb);
        if (sz > maxGroup) continue;
        if (rand() < (sz <= 1 ? 1 : 1 / sz)) { chosen.push(k); set.add(k); }
      }
      for (const k of order) {
        if (chosen.length >= count) break;
        if (set.has(k)) continue;
        if (groupSizeIfAdded(k, set, nb) <= maxGroup) { chosen.push(k); set.add(k); }
      }
      if (chosen.length > best.length) best = chosen;
    }
    return best;
  }
  function emptyGrid(radius) {
    const list = HG.generateCells(radius), cells = new Map();
    for (const c of list) cells.set(HG.key(c.q, c.r), { q: c.q, r: c.r, color: null });
    const nb = new Map();
    for (const [k, c] of cells) nb.set(k, HG.neighbors(c.q, c.r).map((n) => HG.key(n.q, n.r)).filter((x) => cells.has(x)));
    return { cells, neighborKeys: nb };
  }
  function firstMoverCanWin(cells, nb, enc) {
    for (const [from, c] of cells) {
      if (c.color !== "black") continue;
      for (const to of MR.legalMoveTargets(cells, nb, from, enc)) if (MR.wouldFullyConnectOwnColor(cells, nb, from, to, "black")) return true;
    }
    return false;
  }
  return function build(radius, perColor, enc) {
    let result = null, noWin = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const { cells, neighborKeys } = emptyGrid(radius);
      const all = [...cells.keys()];
      const black = place(all, neighborKeys, perColor, radius), bset = new Set(black);
      const white = place(all.filter((k) => !bset.has(k)), neighborKeys, perColor, radius);
      for (const k of black) cells.get(k).color = "black";
      for (const k of white) cells.get(k).color = "white";
      result = { cells, neighborKeys };
      if (MR.hasEnclosedPiece(cells, neighborKeys, "black") || MR.hasEnclosedPiece(cells, neighborKeys, "white")) continue;
      if (perColor >= 2 && firstMoverCanWin(cells, neighborKeys, enc)) continue;
      noWin = result;
      if (enc) break;
      if (MR.hasAnyLegalMove(cells, neighborKeys, "black", enc) && MR.hasAnyLegalMove(cells, neighborKeys, "white", enc)) break;
    }
    return noWin || result;
  };
}

function isConnected(cells, nb, color) {
  const own = []; for (const [k, c] of cells) if (c.color === color) own.push(k);
  if (own.length <= 1) return own.length === 1;
  const seen = new Set([own[0]]), st = [own[0]];
  while (st.length) { const k = st.pop(); for (const n of nb.get(k)) if (!seen.has(n) && cells.get(n).color === color) { seen.add(n); st.push(n); } }
  return seen.size === own.length;
}
function cloneBoard(b) {
  const cells = new Map(); for (const [k, c] of b.cells) cells.set(k, { q: c.q, r: c.r, color: c.color });
  return { cells, neighborKeys: b.neighborKeys };
}

// ------------------------------------------------------------------ una partida
/** engines: { black: {name, api, stats}, white: {...} } */
function playGame(board, engines, referee, opts) {
  const { cells, neighborKeys } = board;
  const enc = !opts.noEnclosure;
  let turn = "black", plies = 0;
  const finish = (winner, reason) => ({ winner, reason, plies });

  while (true) {
    if (plies >= opts.maxMoves) return finish(null, "max-moves");
    const eng = engines[turn];
    if (!referee.MoveRules.hasAnyLegalMove(cells, neighborKeys, turn, enc)) return finish(opp(turn), "no-moves");

    const isOpening = turn === "black" && plies === 0 && opts.firstMoveDepth > 0;
    const options = { maxDepth: isOpening ? opts.firstMoveDepth : opts.depth, maxTimeSeconds: opts.time };
    const state = { cells, neighborKeys, color: turn, enclosureAllowed: enc };
    const t0 = performance.now();
    let res;
    try { res = eng.api.AiStrategies.pickMove(state, options, opts.strategy); }
    catch (e) { return finish(opp(turn), `error:${eng.name}:${e.message}`); }
    const ms = performance.now() - t0;

    const st = eng.stats;
    if (!isOpening) { // la 1ª jugada de negras (profundidad limitada) no se cuenta en las estadísticas
      st.moves++; st.ms += ms;
      if (Number.isFinite(res.nodesEvaluated)) st.nodes += res.nodesEvaluated;
      if (Number.isFinite(res.depthReached)) { st.depthSum += res.depthReached; st.depthN++; }
    }

    const mv = res && res.move;
    const legal = mv && cells.has(mv.from) && cells.has(mv.to) && cells.get(mv.from).color === turn &&
      referee.MoveRules.legalMoveTargets(cells, neighborKeys, mv.from, enc).includes(mv.to);
    if (!legal) return finish(opp(turn), `illegal-move:${eng.name}`);

    cells.get(mv.to).color = turn; cells.get(mv.from).color = null; plies++;
    if (opts.verbose) console.log(`   ${String(plies).padStart(3)} ${turn.padEnd(5)} ${eng.name.padEnd(6)} ${mv.from}->${mv.to} d=${res.depthReached} n=${res.nodesEvaluated} ${ms.toFixed(0)}ms`);

    if (isConnected(cells, neighborKeys, turn)) return finish(turn, "connection");
    if (enc && referee.MoveRules.hasEnclosedPiece(cells, neighborKeys, "black") && referee.MoveRules.hasEnclosedPiece(cells, neighborKeys, "white"))
      return finish(null, "mutual-enclosure");
    turn = opp(turn);
  }
}

// ------------------------------------------------------------------ main
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const legacy = loadEngine(opts.legacy, "legacy"), current = loadEngine(opts.current, "actual");
  if (legacy.wasm) console.warn("Aviso: la carpeta 'legacy' contiene wasmengine.js; ¿es realmente el motor anterior?");
  if (!current.wasm) console.warn("Aviso: la carpeta 'actual' no contiene wasmengine.js; ¿es realmente el motor WebAssembly?");

  const referee = legacy.api;
  const build = makeBoardFactory(referee.HexGeometry, referee.MoveRules, rng(opts.seed));
  const mk = (name, api) => ({ name, api, stats: { moves: 0, ms: 0, nodes: 0, depthSum: 0, depthN: 0 } });
  const E = { current: mk("wasm", current.api), legacy: mk("js", legacy.api) };
  const tally = { wasm: { win: 0, asBlack: 0, asWhite: 0 }, js: { win: 0, asBlack: 0, asWhite: 0 }, draws: 0, drawReasons: {}, errors: [] };

  console.log(`Partidas=${opts.games} radius=${opts.radius} pieces=${opts.pieces} depth=${opts.depth || "Auto"} time=${opts.time}s ` +
    `enclosure=${opts.noEnclosure ? "NO permitido" : "permitido"} max-moves=${opts.maxMoves} seed=${opts.seed}`);
  console.log(`  wasm: ${path.resolve(opts.current)}\n  js  : ${path.resolve(opts.legacy)}\n`);

  let board = null, tAll = performance.now();
  for (let g = 0; g < opts.games; g++) {
    const second = g % 2 === 1;                    // 2ª partida de la pareja: colores intercambiados
    if (!second) board = build(opts.radius, opts.pieces, !opts.noEnclosure);
    const engines = second ? { black: E.legacy, white: E.current } : { black: E.current, white: E.legacy };
    const r = playGame(cloneBoard(board), engines, referee, opts);

    let label;
    if (r.winner) {
      const w = engines[r.winner];
      tally[w.name].win++; tally[w.name][r.winner === "black" ? "asBlack" : "asWhite"]++;
      label = `gana ${w.name} (${r.winner})`;
    } else {
      tally.draws++; tally.drawReasons[r.reason] = (tally.drawReasons[r.reason] || 0) + 1;
      label = `TABLAS`;
    }
    if (r.reason.startsWith("error") || r.reason.startsWith("illegal")) tally.errors.push(`partida ${g + 1}: ${r.reason}`);
    console.log(`#${String(g + 1).padStart(String(opts.games).length)}  negras=${engines.black.name.padEnd(4)} blancas=${engines.white.name.padEnd(4)} ` +
      `${label.padEnd(20)} ${String(r.plies).padStart(4)} jugadas  [${r.reason}]`);
  }

  const secs = (performance.now() - tAll) / 1000;
  const n = opts.games, pct = (x) => ((100 * x) / n).toFixed(1) + "%";
  console.log("\n================ RESUMEN ================");
  for (const k of ["wasm", "js"]) {
    const t = tally[k];
    console.log(`${k.padEnd(5)} victorias: ${String(t.win).padStart(4)} (${pct(t.win)})   como negras: ${t.asBlack}, como blancas: ${t.asWhite}`);
  }
  const reasons = Object.entries(tally.drawReasons).map(([k, v]) => `${k}: ${v}`).join(", ");
  console.log(`tablas: ${tally.draws} (${pct(tally.draws)})${reasons ? "  [" + reasons + "]" : ""}`);
  console.log("\nRendimiento (solo jugadas de búsqueda normales):");
  for (const e of [E.current, E.legacy]) {
    const s = e.stats;
    console.log(`${e.name.padEnd(5)} jugadas=${s.moves}  ms/jugada=${(s.ms / Math.max(1, s.moves)).toFixed(1)}  ` +
      `profundidad media=${(s.depthSum / Math.max(1, s.depthN)).toFixed(2)}  nodos/s=${Math.round(s.nodes / Math.max(1e-9, s.ms / 1000)).toLocaleString("es-ES")}`);
  }
  if (tally.errors.length) console.log("\nERRORES:\n  " + tally.errors.join("\n  "));
  console.log(`\nTiempo total: ${secs.toFixed(1)} s`);
  process.exit(tally.errors.length ? 2 : 0);
}
main();