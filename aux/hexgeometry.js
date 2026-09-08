"use strict";

/**
 * HexGeometry
 * -----------
 * Pure math helpers for a flat-top hexagonal grid arranged as a big
 * hexagon-shaped board, addressed with axial coordinates (q, r).
 *
 * Note on orientation: individual cells are flat-top (flat edge up/down,
 * pointed left/right). Tiling flat-top cells into an axial-range hexagon
 * of this shape makes the *board's* overall silhouette come out pointy-top
 * (narrower left-to-right than top-to-bottom) — the two are always
 * rotated 30° from each other for this kind of "hexagon of hexagons"
 * layout. Pointy-top board = flat-top cells; that's the trade this file
 * makes, chosen because a narrower board is friendlier on mobile widths.
 *
 * "radius" here means "maximum axial/cube distance from the center":
 *   radius = 0  -> only the center cell (1 cell)
 *   radius = 1  -> center + 1 ring around it (7 cells)
 *   radius = 2  -> center + 2 rings (19 cells)
 */
const HexGeometry = (() => {

  // the 6 axial directions, in a fixed clockwise order starting at "east"
  const DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  function cubeDistance(q1, r1, q2, r2) {
    const s1 = -q1 - r1;
    const s2 = -q2 - r2;
    return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(s1 - s2));
  }

  function key(q, r) {
    return `${q},${r}`;
  }

  /** Total number of cells for a given radius (max distance from center). */
  function totalCells(radius) {
    return 3 * radius * (radius + 1) + 1;
  }

  /** Generate every axial coordinate within the given radius. */
  function generateCells(radius) {
    const cells = [];
    const maxDist = radius;
    for (let q = -maxDist; q <= maxDist; q++) {
      const rMin = Math.max(-maxDist, -q - maxDist);
      const rMax = Math.min(maxDist, -q + maxDist);
      for (let r = rMin; r <= rMax; r++) {
        cells.push({ q, r });
      }
    }
    return cells;
  }

  /** The (up to) 6 axial neighbor coordinates of a cell. */
  function neighbors(q, r) {
    return DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));
  }

  /** Axial -> pixel center, flat-top orientation. */
  function axialToPixel(q, r, size) {
    const x = size * 1.5 * q;
    const y = size * Math.sqrt(3) * (r + q / 2);
    return { x, y };
  }

  /** Corner points of a flat-top hexagon centered at (cx, cy). */
  function hexCorners(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angleDeg = 60 * i;
      const angleRad = (Math.PI / 180) * angleDeg;
      pts.push([cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)]);
    }
    return pts;
  }

  /** Round fractional cube coordinates (x+y+z=0) to the nearest valid hex cell. */
  function cubeRound(x, y, z) {
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  }

  /** Pixel -> axial (nearest cell), flat-top orientation, inverse of axialToPixel. */
  function pixelToAxial(x, y, size) {
    const qFrac = (2 / 3) * (x / size);
    const rFrac = ((-1 / 3) * (x / size)) + ((Math.sqrt(3) / 3) * (y / size));
    const sFrac = -qFrac - rFrac; // cube y-component (since q + r + s = 0)
    return cubeRound(qFrac, sFrac, rFrac);
  }

  /** Sort cells by ring (distance from center) then by angle, for deterministic layouts. */
  function sortByRingThenAngle(cells) {
    return [...cells].sort((a, b) => {
      const da = cubeDistance(0, 0, a.q, a.r);
      const db = cubeDistance(0, 0, b.q, b.r);
      if (da !== db) return da - db;
      const angA = Math.atan2(a.r, a.q);
      const angB = Math.atan2(b.r, b.q);
      return angA - angB;
    });
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