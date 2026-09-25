"use strict";
/**
 * runlabel.js — construye el nombre de la carpeta de una ejecución a partir de
 * sus parámetros: siempre radius, pieces, depth y time; cualquier otra opción
 * relevante para la partida se añade SOLO si el usuario la especificó en la
 * línea de comandos (así, leyendo el nombre de la carpeta, se identifica
 * exactamente cómo se generaron esas partidas).
 *
 * Las opciones puramente de ejecución (dónde guardar, cuántas hacer en esta
 * tanda, si reanudar, si ser detallado...) NO forman parte del nombre: dos
 * ejecuciones con --skip/--limit distintos deben caer en la MISMA carpeta
 * para poder acumular o reanudar partidas.
 */
function sanitize(v) {
  return String(v).replace(/\./g, "p").replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * @param opts    objeto de opciones ya parseado (con depth, time, y las extra)
 * @param given   Set con los nombres largos de las opciones que el usuario
 *                escribió explícitamente en la línea de comandos
 * @param extra   lista ordenada de [nombreOpcion, etiqueta, valor] para las
 *                opciones que no son radius/pieces/depth/time
 */
function buildRunDirName(opts, given, extra) {
  // depth 0 = Auto, pero en el nombre de la carpeta se escribe literalmente "d0"
  let name = `r${sanitize(opts.radius)}_p${sanitize(opts.pieces)}_d${sanitize(opts.depth)}_t${sanitize(opts.time)}`;
  for (const [optName, label, value] of extra) {
    if (!given.has(optName) || value === undefined || value === null || value === false) continue;
    name += `_${label}${value === true ? "" : sanitize(value)}`;
  }
  return name;
}

module.exports = { buildRunDirName, sanitize };