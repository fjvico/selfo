#!/usr/bin/env node
"use strict";
/**
 * enumerate_boards.js — recorre TODAS las inicializaciones de tablero válidas
 * para un radius y un número de fichas por color dados, y para cada una juega
 * una partida completa (ambos bandos con el motor WebAssembly), guardando
 * cada partida en su propio fichero.
 *
 * Uso:
 *   node enumerate_boards.js <radius> <pieces> [opciones]
 *
 * "Inicialización válida" son las mismas reglas que usa buildBoard() en
 * script.js para repartir las fichas al azar, pero aquí se comprueban todas
 * las combinaciones posibles en vez de sortear una:
 *   - ningún color puede tener un grupo conectado de más de `radius` fichas
 *   - ninguna ficha puede empezar ya encerrada por el rival
 *   - negras (quien mueve primero) no puede ganar en su primera jugada
 *   - si la regla "No enclosure" está activa (--no-enclosure), además ambos
 *     colores deben tener al menos un movimiento legal
 *
 * Opciones:
 *   --depth N            profundidad máxima (0 = Auto). Por defecto 3
 *   --time S             tiempo máximo por jugada en segundos. Por defecto 5
 *   --no-enclosure       activa la regla "No enclosure" (por defecto: se permite encerrar)
 *   --max-moves N        jugadas totales a partir de las cuales la partida es tablas. Por defecto 200
 *   --first-move-depth N profundidad de la 1ª jugada de negras. Por defecto 1; 0 = sin límite especial
 *   --strategy NAME      estrategia (minimaxAlphaBetaID | minimaxAlphaBetaCloning). Por defecto: la del motor
 *   --engine DIR         carpeta del motor WebAssembly (debe contener wasmengine.js). Por defecto .
 *   --out DIR            carpeta donde guardar las partidas. Por defecto ./games
 *   --skip N             salta las primeras N inicializaciones válidas (para reanudar). Por defecto 0
 *   --limit N            juega como máximo N inicializaciones válidas. Por defecto: todas
 *   --force              no pedir confirmación aunque el número de tableros sea muy grande
 *   --count-only         solo cuenta cuántas inicializaciones son válidas, sin jugar ninguna partida
 *   --verbose            imprime cada jugada de cada partida por consola además de guardarla
 *
 * El número de inicializaciones SIN filtrar es C(total,pieces) * C(total-pieces,pieces),
 * donde total = 3*radius*(radius+1)+1. Crece muy rápido: con radius 4 (61 casillas) y
 * 4 fichas por color ya son más de 3.000 millones antes de filtrar. El script imprime
 * ese número al empezar y, si supera un umbral, pide --force para continuar.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ------------------------------------------------------------------ argumentos
function parseArgs(argv) {
  const opts = { depth: 3, time: 5, noEnclosure: false, maxMoves: 200, firstMoveDepth: 1, strategy: undefined,
    engine: ".", out: "games", skip: 0, limit: Infinity, force: false, countOnly: false, verbose: false };
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
      case "--engine": opts.engine = next(); break;
      case "--out": opts.out = next(); break;
      case "--skip": opts.skip = Number(next()); break;
      case "--limit": opts.limit = Number(next()); break;
      case "--force": opts.force = true; break;
      case "--count-only": opts.countOnly = true; break;
      case "--verbose": opts.verbose = true; break;
      case "-h": case "--help": usage(0); break;
      default:
        if (a.startsWith("--")) die(`Opción desconocida: ${a}`);
        pos.push(a);
    }
  }
  if (pos.length !== 2) usage(1);
  opts.radius = Number(pos[0]); opts.pieces = Number(pos[1]);
  if (!Number.isInteger(opts.radius) || opts.radius < 1) die("radius debe ser un entero >= 1");
  if (!Number.isInteger(opts.pieces) || opts.pieces < 1) die("pieces debe ser un entero >= 1");
  for (const [k, v] of [["--depth", opts.depth], ["--time", opts.time], ["--max-moves", opts.maxMoves], ["--skip", opts.skip]]) {
    if (!Number.isFinite(v) || v < 0) die(`${k} debe ser un número >= 0`);
  }
  if (opts.time <= 0) die("--time debe ser > 0");
  return opts;
}
function usage(code) {
  console.log(fs.readFileSync(__filename, "utf8").split("/**")[1].split("*/")[0].replace(/^ \* ?/gm, "").trim());
  process.exit(code);
}
function die(msg) { console.error("Error: " + msg); process.exit(1); }

// ------------------------------------------------------------------ carga del motor (solo wasm, para ambos bandos)
function loadEngine(dir) {
  const ctx = vm.createContext({ performance, atob, console });
  const wasmPath = path.join(dir, "wasmengine.js");
  try { fs.accessSync(wasmPath, fs.constants.R_OK); }
  catch (e) { die(`No encuentro wasmengine.js en ${path.resolve(dir)} (${e.code}). Usa --engine para indicar la carpeta correcta.`); }
  for (const f of ["wasmengine.js", "hexgeometry.js", "moverules.js", "aistrategies.js"]) {
    const p = path.join(dir, f);
    let src;
    try { src = fs.readFileSync(p, "utf8"); }
    catch (e) { die(`No se puede leer ${p}: ${e.code} (${e.message})`); }
    vm.runInContext(src, ctx, { filename: p });
  }
  if (!vm.runInContext("WasmEngine.isReady", ctx)) die("El wasm no se instanció de forma síncrona en este entorno.");
  return vm.runInContext("({ HexGeometry, MoveRules, AiStrategies })", ctx);
}

// ------------------------------------------------------------------ combinatoria exacta (BigInt, sin desbordar)
function nCr(n, r) {
  if (r < 0 || r > n) return 0n;
  r = Math.min(r, n - r);
  let num = 1n, den = 1n;
  for (let i = 0; i < r; i++) { num *= BigInt(n - i); den *= BigInt(i + 1); }
  return num / den;
}

/** Generador perezoso de combinaciones de tamaño k de `arr`, en orden lexicográfico.
 *  No materializa el conjunto completo: cada combinación se calcula sobre la marcha,
 *  por eso --skip puede usarse aunque el total sea enorme sin llenar la memoria. */
function* combinations(arr, k) {
  const n = arr.length;
  if (k < 0 || k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k === 0) { yield []; return; }
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// ------------------------------------------------------------------ validez de una inicialización (igual que buildBoard en script.js)
function maxConnectedGroup(keySet, nb) {
  const seen = new Set(); let max = 0;
  for (const start of keySet) {
    if (seen.has(start)) continue;
    let size = 0; const stack = [start]; seen.add(start);
    while (stack.length) { const k = stack.pop(); size++; for (const n of nb.get(k)) if (keySet.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); } }
    if (size > max) max = size;
  }
  return max;
}

function makeValidator(MR, radius, enclosureAllowed) {
  return function isValid(cells, nb) {
    const blackKeys = new Set(), whiteKeys = new Set();
    for (const [k, c] of cells) (c.color === "black" ? blackKeys : c.color === "white" ? whiteKeys : null)?.add(k);
    if (maxConnectedGroup(blackKeys, nb) > radius) return false;
    if (maxConnectedGroup(whiteKeys, nb) > radius) return false;
    if (MR.hasEnclosedPiece(cells, nb, "black")) return false;
    if (MR.hasEnclosedPiece(cells, nb, "white")) return false;
    if (!enclosureAllowed && !(MR.hasAnyLegalMove(cells, nb, "black", enclosureAllowed) && MR.hasAnyLegalMove(cells, nb, "white", enclosureAllowed))) return false;
    for (const from of blackKeys) {
      for (const to of MR.legalMoveTargets(cells, nb, from, enclosureAllowed)) {
        if (MR.wouldFullyConnectOwnColor(cells, nb, from, to, "black")) return false; // negras ganaría en la 1ª jugada
      }
    }
    return true;
  };
}

/** Recorre todas las (blackKeys, whiteKeys) disjuntas de tamaño `pieces`, filtra
 *  con `isValid` y devuelve (mediante yield) el tablero {cells, neighborKeys}. */
function* enumerateBoards(HG, radius, pieces, isValid, stats) {
  const list = HG.generateCells(radius);
  const allKeys = list.map((c) => HG.key(c.q, c.r));
  const coordOf = new Map(list.map((c) => [HG.key(c.q, c.r), c]));
  const nbAll = new Map(allKeys.map((k) => [k, HG.neighbors(coordOf.get(k).q, coordOf.get(k).r).map((n) => HG.key(n.q, n.r)).filter((x) => coordOf.has(x))]));

  for (const blackKeys of combinations(allKeys, pieces)) {
    const bset = new Set(blackKeys);
    const rest = allKeys.filter((k) => !bset.has(k));
    for (const whiteKeys of combinations(rest, pieces)) {
      stats.raw++;
      const cells = new Map();
      for (const k of allKeys) cells.set(k, { q: coordOf.get(k).q, r: coordOf.get(k).r, color: bset.has(k) ? "black" : whiteKeys.includes(k) ? "white" : null });
      if (isValid(cells, nbAll)) yield { cells, neighborKeys: nbAll, blackKeys, whiteKeys };
    }
  }
}

// ------------------------------------------------------------------ una partida (ambos bandos con el mismo motor wasm)
function isConnected(cells, nb, color) {
  const own = []; for (const [k, c] of cells) if (c.color === color) own.push(k);
  if (own.length <= 1) return own.length === 1;
  const seen = new Set([own[0]]), st = [own[0]];
  while (st.length) { const k = st.pop(); for (const n of nb.get(k)) if (!seen.has(n) && cells.get(n).color === color) { seen.add(n); st.push(n); } }
  return seen.size === own.length;
}
function cloneCells(cells) { const m = new Map(); for (const [k, c] of cells) m.set(k, { q: c.q, r: c.r, color: c.color }); return m; }
const opp = (c) => (c === "black" ? "white" : "black");

function playGame(board, engine, opts) {
  const cells = cloneCells(board.cells), neighborKeys = board.neighborKeys;
  const enc = !opts.noEnclosure;
  const { HexGeometry: HG, MoveRules: MR, AiStrategies: AI } = engine;
  const moves = [];
  let turn = "black", plies = 0, winner = null, reason = null;

  while (true) {
    if (plies >= opts.maxMoves) { reason = "max-moves"; break; }
    if (!MR.hasAnyLegalMove(cells, neighborKeys, turn, enc)) { winner = opp(turn); reason = "no-moves"; break; }

    const isOpening = turn === "black" && plies === 0 && opts.firstMoveDepth > 0;
    const options = { maxDepth: isOpening ? opts.firstMoveDepth : opts.depth, maxTimeSeconds: opts.time };
    const state = { cells, neighborKeys, color: turn, enclosureAllowed: enc };
    const t0 = performance.now();
    let res;
    try { res = AI.pickMove(state, options, opts.strategy); }
    catch (e) { winner = opp(turn); reason = `error:${e.message}`; break; }
    const ms = performance.now() - t0;

    const mv = res && res.move;
    const legal = mv && cells.has(mv.from) && cells.has(mv.to) && cells.get(mv.from).color === turn &&
      MR.legalMoveTargets(cells, neighborKeys, mv.from, enc).includes(mv.to);
    if (!legal) { winner = opp(turn); reason = "illegal-move"; break; }

    cells.get(mv.to).color = turn; cells.get(mv.from).color = null;
    moves.push({ ply: plies + 1, color: turn, from: mv.from, to: mv.to, depthReached: res.depthReached, nodesEvaluated: res.nodesEvaluated, score: res.score, ms: Math.round(ms * 10) / 10 });
    if (opts.verbose) console.log(`   ${String(plies + 1).padStart(3)} ${turn.padEnd(5)} ${mv.from}->${mv.to} d=${res.depthReached} n=${res.nodesEvaluated} ${ms.toFixed(0)}ms`);
    plies++;

    if (isConnected(cells, neighborKeys, turn)) { winner = turn; reason = "connection"; break; }
    if (enc && MR.hasEnclosedPiece(cells, neighborKeys, "black") && MR.hasEnclosedPiece(cells, neighborKeys, "white")) { reason = "mutual-enclosure"; break; }
    turn = opp(turn);
  }
  return { winner, reason, plies, moves };
}

// ------------------------------------------------------------------ main
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const engine = loadEngine(opts.engine);
  const total = 3 * opts.radius * (opts.radius + 1) + 1;
  if (opts.pieces * 2 > total) die(`radius ${opts.radius} tiene ${total} casillas: no caben ${opts.pieces}+${opts.pieces} fichas`);

  const rawCount = nCr(total, opts.pieces) * nCr(total - opts.pieces, opts.pieces);
  console.log(`Casillas: ${total}. Inicializaciones sin filtrar (antes de aplicar las reglas): ${rawCount.toLocaleString("es-ES")}.`);
  const THRESHOLD = 200000n;
  if (rawCount > THRESHOLD && !opts.force && !opts.countOnly) {
    die(`Son demasiadas para continuar sin confirmar (> ${THRESHOLD.toLocaleString("es-ES")}). ` +
      `Repite con --force si de verdad quieres procesarlas todas, o reduce radius/pieces, o usa --limit para probar con una parte.`);
  }

  const isValid = makeValidator(engine.MoveRules, opts.radius, !opts.noEnclosure);
  const stats = { raw: 0 };
  const boards = enumerateBoards(engine.HexGeometry, opts.radius, opts.pieces, isValid, stats);

  if (!opts.countOnly) fs.mkdirSync(opts.out, { recursive: true });
  const pad = String(Math.max(opts.limit, 100000)).length;

  let seen = 0, played = 0, alreadyDone = 0;
  const tally = { black: 0, white: 0, draws: 0, reasons: {} };
  const tAll = performance.now();

  for (const board of boards) {
    if (seen < opts.skip) { seen++; continue; }
    seen++;
    if (played >= opts.limit) break;

    if (opts.countOnly) { played++; continue; }

    const idx = seen; // índice 1-based entre las inicializaciones VÁLIDAS
    const file = path.join(opts.out, `juego_${String(idx).padStart(pad, "0")}.json`);
    if (fs.existsSync(file)) { played++; alreadyDone++; continue; } // reanudación: no repetir partidas ya jugadas

    const result = playGame(board, engine, opts);
    const record = {
      index: idx, radius: opts.radius, pieces: opts.pieces,
      enclosureAllowed: !opts.noEnclosure, options: { depth: opts.depth, time: opts.time, firstMoveDepth: opts.firstMoveDepth, strategy: opts.strategy || null },
      initial: { black: board.blackKeys, white: board.whiteKeys },
      result: { winner: result.winner, reason: result.reason, plies: result.plies },
      moves: result.moves,
    };
    fs.writeFileSync(file, JSON.stringify(record, null, 1));

    played++;
    if (result.winner) tally[result.winner]++; else tally.draws++;
    tally.reasons[result.reason] = (tally.reasons[result.reason] || 0) + 1;

    if (played % 20 === 0 || played === 1) {
      const secs = (performance.now() - tAll) / 1000;
      console.log(`  ${played} partidas jugadas (${idx}ª inicialización válida) — ${secs.toFixed(1)}s, ${(secs / played).toFixed(2)}s/partida`);
    }
  }

  console.log("\n================ RESUMEN ================");
  console.log(`Combinaciones examinadas (antes de filtrar): ${stats.raw.toLocaleString("es-ES")}`);
  console.log(`Inicializaciones válidas encontradas: ${seen.toLocaleString("es-ES")}`);
  if (opts.countOnly) { console.log("(--count-only: no se jugó ninguna partida)"); return; }
  console.log(`Partidas procesadas en esta ejecución: ${played} (nuevas: ${played - alreadyDone}, ya existentes de antes: ${alreadyDone})`);
  console.log(`  de las nuevas — ganan negras: ${tally.black}   ganan blancas: ${tally.white}   tablas: ${tally.draws}`);
  console.log(`  motivos: ${Object.entries(tally.reasons).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  console.log(`Partidas guardadas en: ${path.resolve(opts.out)}`);
  console.log(`Tiempo total: ${((performance.now() - tAll) / 1000).toFixed(1)} s`);
}
main();