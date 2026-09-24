# Selfo — Plan revisado: distribución multicanal, generación local y automatización

**Decisión estratégica actualizada:** Selfo mantiene el catálogo de variantes estáticas sin backend ni cuentas de usuario, pero diversifica su distribución más allá de itch.io, automatiza al 100% la generación de digital goods (todo ocurre en el navegador del jugador, sin intervención manual) y limita la inversión en redes sociales a lo que pueda ejecutarse sin trabajo humano recurrente.

---

## 1. Principios rectores (actualizados)

- **Sin backend, sin cuentas**: se mantiene sin cambios.
- **Validación antes que fragmentación**: un solo pack de pago se lanza primero para medir disposición real a pagar, antes de construir el catálogo completo.
- **Todo lo que sea repetitivo se automatiza o no se hace**: si una tarea (generar un póster, publicar un tuit) requiere tu intervención manual cada vez, se rediseña para que no la requiera, o se elimina del plan.
- **Distribución diversificada, no dependiente de una sola plataforma**: itch.io deja de ser el único canal; se reduce el riesgo de concentración.

---

## 2. Distribución multicanal

| Canal | Tipo | Por qué encaja | Modelo de ingreso |
|---|---|---|---|
| **itch.io** | Venta directa | Canal principal ya validado, pagos/IVA gestionados | Pago único por pack |
| **Gumroad** | Venta directa | Buen ajuste específico para los pósters PDF (checkout más simple, entrega instantánea) | Pago único |
| **CrazyGames / Poki** | Portal con anuncios | Juegos HTML5 gratuitos como el Base; monetización por publicidad sin que tú gestiones anuncios | Ingreso pasivo por revenue share (les envías el build, ellos gestionan el ad-serving) |
| **Newgrounds / Game Jolt** | Comunidad + descubrimiento | Público afín a juegos abstractos/experimentales; añade visibilidad sin coste | Indirecto (tráfico hacia itch.io/Gumroad) |
| **Steam (a futuro, condicional)** | Venta directa | Solo si el catálogo demuestra tracción; requiere más inversión (capturas, página de producto) | Se evalúa en Fase 5, no antes |

**Lógica de la diversificación:**
- **itch.io + Gumroad** cubren la venta directa con distinto encaje (itch.io para packs de juego, Gumroad para pósters).
- **CrazyGames/Poki** monetizan el Base gratuito sin que tengas que gestionar tú la publicidad ni perder el control de itch.io como tienda principal — es tráfico adicional, no sustitución.
- **Newgrounds/Game Jolt** son de coste cero y sirven principalmente como descubrimiento, no como fuente de ingreso directa.
- Ningún canal nuevo exige trabajo recurrente de mantenimiento: subes el build una vez y las plataformas gestionan el resto.

---

## 3. Digital goods: generación 100% local (sin intervención manual)

### Problema del planteamiento anterior
El flujo original (jugador exporta JSON → te lo envía por email → tú generas el PDF a mano) te convertía en cuello de botella y contradecía la filosofía "sin backend". Se elimina por completo.

### Nuevo flujo: todo ocurre en el navegador del jugador

1. El jugador termina una partida.
2. Un botón **"Generar póster"** ejecuta client-side (JavaScript) una librería de generación de PDF/canvas (p. ej. `jsPDF` o renderizado directo a `<canvas>` + exportación a PNG/PDF).
3. La plantilla del póster (diagrama de flujo, trayectoria o abstracto) está programada como plantilla parametrizada: toma los datos de la partida (movimientos, posiciones finales) ya presentes en el estado del juego, sin necesitar servidor ni envío de datos a ningún sitio.
4. El PDF se descarga directamente en el dispositivo del jugador. Sin email, sin espera, sin tu intervención.

### Modelo de desbloqueo sin backend
Dos opciones, ambas compatibles con "sin servidor":

- **Opción A — Gratis con marca de agua / de pago sin ella**: el botón genera siempre el póster; la versión gratuita lleva una marca de agua sutil. Para la versión limpia, el jugador introduce una clave de desbloqueo comprada en itch.io/Gumroad (una clave estática que el JS valida localmente contra un patrón, no contra un servidor).
- **Opción B — Todo incluido en el pack de pago**: la función de generar pósters solo existe en la build que se descarga tras comprar el pack; el Base gratuito no la incluye. Más simple de implementar y de explicar al comprador.

**Recomendación**: empezar con la Opción B (más simple, cero superficie de fraude) y solo evaluar la A si los datos muestran que el "probar antes de comprar" mejora la conversión.

### Catálogo de pósters (sin cambios en el producto, sí en el proceso)

| Tipo de póster | Contenido | Precio | Generación |
|---|---|---|---|
| Diagrama de flujo | Tablero final + snapshots clave | 5 € | Local, instantánea |
| Trayectoria | Líneas de movimiento de fichas | 5 € | Local, instantánea |
| Abstracto | Patrón final minimalista | 4 € | Local, instantánea |
| Pack de 3 | Los tres anteriores | 12 € | Local, instantánea |

**Ventaja clave del nuevo flujo**: margen neto más alto (no hay tiempo tuyo invertido por unidad vendida) y escala a cualquier volumen de ventas sin coste marginal de tu tiempo.

---

## 4. Redes sociales: solo lo 100% automatizable

Se elimina cualquier canal que requiera creación de contenido manual recurrente (edición de vídeo, redacción diaria). Se conservan únicamente los que pueden configurarse una vez y funcionar solos.

| Canal | Automatización | Configuración (una vez) | Coste de tiempo recurrente |
|---|---|---|---|
| **Devlog de itch.io → cross-post automático** | itch.io permite (vía RSS o integraciones tipo Zapier/IFTTT) republicar automáticamente cada entrada del devlog en Twitter/X y Discord | Conectar RSS del devlog a Zapier/IFTTT → webhook de Discord + API de Twitter | Cero, tras la configuración inicial |
| **Discord — anuncios automáticos** | Webhook que publica automáticamente cuando se sube una nueva build o pack a itch.io (itch.io dispara webhooks en nuevas releases) | Configurar webhook itch.io → canal de Discord | Cero |
| **GIF/clip automático de cada partida "notable"** | El propio juego, client-side, puede detectar partidas con patrones visualmente llamativos (p. ej. muchos movimientos, simetría final) y ofrecer un botón de "compartir GIF" que el jugador mismo publica — la generación es automática, la publicación la hace el jugador, no tú | Implementar el detector de patrón + generación de GIF en canvas | Cero para ti (el jugador es quien comparte) |
| **Reddit / TikTok / Instagram manual** | **Eliminados del plan** — requieren creación de contenido humana recurrente, incompatible con "inversión mínima" | — | — |

**Lo que esto implica en la práctica:**
- Dejas de depender de tu propia constancia para "estar presente" en redes.
- El crecimiento orgánico pasa a depender más del boca a boca vía Discord/devlog y de que los propios jugadores compartan sus pósters y GIFs (contenido generado por el usuario, no por ti).
- Si más adelante decides invertir tiempo en TikTok/Reddit, se trata como una decisión explícita y presupuestada, no como parte del "canal gratuito" — porque no lo es.

---

## 5. Modelo de ingresos (actualizado)

| Fuente | Precio | Coste para ti | Cuándo activarla |
|---|---|---|---|
| Selfo Base (gratuito, en itch.io + CrazyGames/Poki) | 0 € | 0 € | Desde el día 1 |
| **Un único pack de validación** | 3-5 € | ~3-4% procesamiento | Antes de construir más packs |
| Packs adicionales (solo si el primero valida demanda) | 3-5 € | ~3-4% | Tras validar |
| Selfo Completo | 10-15 € | ~3-4% | Con catálogo suficiente |
| Pósters PDF (generación local) | 4-12 € | ~3-4% (itch.io) o ~13% (Gumroad) | Con la función de generación local ya integrada en el pack de pago |
| Publicidad vía CrazyGames/Poki (Base gratuito) | Revenue share | Gestionado por la plataforma | Desde el día 1, sin trabajo adicional |

---

## 6. Hoja de ruta revisada

| Fase | Plazo | Acción | Resultado esperado |
|---|---|---|---|
| **1** | Mes 1 | Publicar Base en itch.io + CrazyGames/Poki. Configurar webhook Discord y cross-post automático del devlog | Primeros jugadores y primera señal de tráfico multicanal |
| **2** | Mes 2 | Lanzar **un solo** pack de pago con generación local de pósters integrada | Validar disposición a pagar con datos reales antes de escalar |
| **3** | Mes 3 | Según conversión del pack 1: expandir catálogo o ajustar precio/propuesta | Catálogo dimensionado según demanda real, no según supuestos |
| **4** | Mes 4-5 | Publicar en Newgrounds/Game Jolt para descubrimiento adicional | Más tráfico sin coste de mantenimiento |
| **5** | Mes 6+ | Evaluar Steam si el catálogo y las ventas lo justifican | Canal adicional solo si hay tracción demostrada |

---

## 7. Lo que NO se hace (actualizado)

- ❌ No se construye backend ni se gestionan cuentas de usuario.
- ❌ No se genera ningún digital good manualmente — todo pósters/GIFs se crean client-side.
- ❌ No se invierte tiempo recurrente en TikTok, Reels o Reddit manual.
- ❌ No se lanzan 3-4 packs de golpe sin haber validado demanda con uno solo.
- ❌ No se depende de una única plataforma de distribución.
- ❌ No se promete sincronización entre dispositivos ni rankings online.

---

## En una frase

**Selfo distribuye su Base gratuito en itch.io, CrazyGames/Poki, Newgrounds y Game Jolt; valida la disposición a pagar con un único pack antes de escalar el catálogo; genera pósters y GIFs 100% en el navegador del jugador sin intervención manual; y limita su presencia en redes a integraciones automáticas (webhooks, cross-posting de devlog), dejando que sean los propios jugadores quienes compartan el contenido generado por el juego.**