"use strict";

/**
 * HexGeometry (WebAssembly-backed)
 * --------------------------------
 * Drop-in replacement for the original hexgeometry.js — same names, same
 * signatures, same results. The numeric core (cube distance, cell counts and
 * generation, axial<->pixel, corner points, cube rounding, ring/angle sort)
 * runs in WebAssembly (src/engine.c). What stays in JS is only what is
 * inherently a JS-object concern: the DIRECTIONS table, key() (returns a
 * string), and neighbors() (six additions producing objects).
 *
 * Contract note: axial coordinates and radius are INTEGERS (as everywhere in
 * the game); they cross the boundary as i32. Everything geometric in
 * floating point (pixels, corners, rounding) is IEEE-754 f64 and, because
 * cos/sin/atan2 are the very same Math.* functions imported from the host,
 * bit-for-bit identical to the JS version.
 *
 * Needs wasmengine.js to have been loaded first.
 */
const HexGeometry = (() => {

  const DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  const ex = () => WasmEngine.ex();

  function cubeDistance(q1, r1, q2, r2) {
    return ex().hg_cube_distance(q1, r1, q2, r2);
  }

  function key(q, r) {
    return `${q},${r}`;
  }

  /** Total number of cells for a given radius (max distance from center). */
  function totalCells(radius) {
    return ex().hg_total_cells(radius);
  }

  /** Generate every axial coordinate within the given radius. */
  function generateCells(radius) {
    const e = ex();
    const n = e.hg_generate_cells(radius);
    if (n < 0) {
      if (radius < 0) return [];
      throw new Error(`HexGeometry.generateCells: radius ${radius} is too large for the wasm engine.`);
    }
    const cells = new Array(n);
    for (let i = 0; i < n; i++) cells[i] = { q: e.hg_cell_q(i), r: e.hg_cell_r(i) };
    return cells;
  }

  /** The (up to) 6 axial neighbor coordinates of a cell. */
  function neighbors(q, r) {
    return DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));
  }

  /** Axial -> pixel center, flat-top orientation. */
  function axialToPixel(q, r, size) {
    const e = ex();
    e.hg_axial_to_pixel(q, r, size);
    return { x: e.hg_out_x(), y: e.hg_out_y() };
  }

  /** Corner points of a flat-top hexagon centered at (cx, cy). */
  function hexCorners(cx, cy, size) {
    const e = ex();
    e.hg_hex_corners(cx, cy, size);
    const pts = new Array(6);
    for (let i = 0; i < 6; i++) pts[i] = [e.hg_corner_x(i), e.hg_corner_y(i)];
    return pts;
  }

  /** Round fractional cube coordinates (x+y+z=0) to the nearest valid hex cell. */
  function cubeRound(x, y, z) {
    const e = ex();
    e.hg_cube_round(x, y, z);
    return { q: e.hg_out_x(), r: e.hg_out_y() };
  }

  /** Pixel -> axial (nearest cell), flat-top orientation, inverse of axialToPixel. */
  function pixelToAxial(x, y, size) {
    const e = ex();
    e.hg_pixel_to_axial(x, y, size);
    return { q: e.hg_out_x(), r: e.hg_out_y() };
  }

  /** Sort cells by ring (distance from center) then by angle, for deterministic layouts.
   *  Returns a new array holding the SAME cell objects (identity preserved), like the original. */
  function sortByRingThenAngle(cells) {
    const e = ex();
    const n = cells.length;
    for (let i = 0; i < n; i++) e.hg_sort_set(i, cells[i].q, cells[i].r);
    e.hg_sort_run(n);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = cells[e.hg_sort_get(i)];
    return out;
  }

  return {
    DIRECTIONS,
    cubeDistance,
    key,
    totalCells,
    generateCells,
    neighbors,
    axialToPixel,
    hexCorners,
    cubeRound,
    pixelToAxial,
    sortByRingThenAngle,
  };
})();
