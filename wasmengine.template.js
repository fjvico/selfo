"use strict";

/**
 * WasmEngine
 * ----------
 * Loads the WebAssembly build of the game engine (hexgeometry + moverules +
 * aistrategies, see src/engine.c) and exposes it, plus the board-upload
 * helpers the three API-compatible wrapper files share.
 *
 * The .wasm is embedded (base64) so a single <script> / importScripts() call
 * is enough — no fetch, no MIME-type or CORS concerns.
 *
 * Instantiation is SYNCHRONOUS wherever the browser allows it (Web Workers,
 * Firefox, Safari, Node), so `WasmEngine.ready` is already resolved and every
 * wrapper works immediately, exactly like the old pure-JS files. Chrome
 * refuses synchronous compilation of a module > 4 KB on the MAIN thread; there
 * it transparently falls back to async instantiation, and callers on the main
 * thread must `await WasmEngine.ready` once before their first call (the Web
 * Worker path never needs this).
 */
const WasmEngine = (() => {
  const WASM_BASE64 = "/*WASM_BASE64*/";

  const now = () => ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now());
  const imports = { env: { js_now: now, js_cos: Math.cos, js_sin: Math.sin, js_atan2: Math.atan2 } };

  function decode() {
    if (typeof atob === "function") {
      const bin = atob(WASM_BASE64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(WASM_BASE64, "base64"));
  }

  const engine = { exports: null, ready: null, isReady: false, hooks: {} };

  function adopt(instance) { engine.exports = instance.exports; engine.isReady = true; }

  try {
    adopt(new WebAssembly.Instance(new WebAssembly.Module(decode()), imports));
    engine.ready = Promise.resolve(engine);
  } catch (syncErr) {
    engine.ready = WebAssembly.instantiate(decode(), imports).then((r) => { adopt(r.instance); return engine; });
  }

  /** The wasm exports, or a clear error if instantiation is still pending (main thread, Chrome). */
  engine.ex = function () {
    if (!engine.exports) throw new Error("WasmEngine not ready yet: `await WasmEngine.ready` before the first call on the main thread.");
    return engine.exports;
  };

  // ---- color <-> wasm code (0 empty, 1 black, 2 white)
  engine.colorCode = (c) => (c === "black" ? 1 : c === "white" ? 2 : 0);

  /**
   * Copies a board (JS Maps) into the wasm module, preserving the Map
   * iteration order of `cells` and of every neighbor list (that order is
   * observable in move generation and tie-breaks). Returns { keys, index }:
   * cell index -> key string, and key string -> cell index.
   */
  engine.uploadBoard = function (cells, neighborKeys) {
    const ex = engine.ex();
    const n = cells.size;
    if (n > ex.board_max_cells()) throw new Error(`Board has ${n} cells; the wasm engine supports at most ${ex.board_max_cells()}.`);
    const keys = new Array(n);
    const index = new Map();
    let i = 0;
    for (const k of cells.keys()) { keys[i] = k; index.set(k, i); i++; }
    ex.board_begin(n);
    i = 0;
    for (const cell of cells.values()) { ex.board_set_cell(i, cell.q, cell.r, engine.colorCode(cell.color)); i++; }
    for (i = 0; i < n; i++) {
      const nks = neighborKeys.get(keys[i]);
      if (nks.length > 6) throw new Error(`Cell ${keys[i]} has ${nks.length} neighbors; a hex cell has at most 6.`);
      for (const nk of nks) {
        const j = index.get(nk);
        if (j === undefined) throw new Error(`Neighbor "${nk}" of cell "${keys[i]}" is not a board cell.`);
        ex.board_add_neighbor(i, j);
      }
    }
    ex.board_end();
    return { keys, index };
  };

  return engine;
})();

if (typeof module !== "undefined" && module.exports) module.exports = WasmEngine;
