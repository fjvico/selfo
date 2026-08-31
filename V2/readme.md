# SyssPrompt

Userscript (Tampermonkey / Violentmonkey) que añade un pequeño icono 🐍 a **DeepSeek**, **ChatGPT** y **Claude** desde el que puedes marcar qué "system prompts" (reglas de comportamiento) quieres aplicar al asistente, en el idioma que prefieras. Al enviar tu mensaje, el script añade automáticamente las instrucciones marcadas justo debajo, ocultas por debajo del scroll.

## Índice

- [Instalación](#instalación)
- [Uso básico](#uso-básico)
- [Cómo se inyectan los prompts](#cómo-se-inyectan-los-prompts)
- [Idiomas](#idiomas)
- [Prompts personalizados](#prompts-personalizados)
- [Compatibilidad por sitio](#compatibilidad-por-sitio)
- [Personalización del código](#personalización-del-código)
- [Almacenamiento y privacidad](#almacenamiento-y-privacidad)
- [Solución de problemas](#solución-de-problemas)
- [Apoya el proyecto](#apoya-el-proyecto)
- [Licencia](#licencia)

## Instalación

### Opción más sencilla (recomendada para quien no tenga conocimientos técnicos)

1. Abre esta página en tu navegador: **[SyssPrompt en Greasy Fork](https://greasyfork.org/en/scripts/593175-syssprompt)**.
2. Pulsa el botón **"Install this script"**. Si es la primera vez que instalas un userscript, la propia página te guiará para instalar antes la extensión necesaria (Tampermonkey, Violentmonkey, etc., según tu navegador) — solo hay que seguir el enlace que te ofrece y volver a intentarlo.
3. Confirma la instalación en el diálogo que abre la extensión. Listo: ya no hace falta tocar ni copiar ningún código.

Desde el propio icono 🐍 del script (dentro de DeepSeek, ChatGPT o Claude) hay también un botón **"Compartir"** para enviar este mismo enlace a quien quieras por WhatsApp, Telegram, correo, etc. (o copiarlo, si tu navegador no ofrece el panel de compartir nativo).

### Opción manual (instalar desde el archivo)

1. Instala una extensión de userscripts en tu navegador: [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari) o [Violentmonkey](https://violentmonkey.github.io/).
2. Crea un nuevo script vacío desde el panel de la extensión y pega el contenido de `deep_prompt.js`, o ábrelo directamente si tu gestor lo permite.
3. Guarda. El script se activará automáticamente en:
   - `https://chat.deepseek.com/*`
   - `https://chatgpt.com/*` y `https://chat.openai.com/*`
   - `https://claude.ai/*`

No requiere ninguna configuración adicional ni claves de API.

## Uso básico

Al entrar en cualquiera de los tres sitios verás un pequeño icono 🐍 junto con un código de dos letras (el idioma activo, p. ej. `ES`):

- **DeepSeek / ChatGPT**: aparece pegado al botón "Share" de la barra superior.
- **Claude**: aparece fijo abajo a la derecha, junto a la barra de envío.

Al pasar el cursor por encima (o al hacer click, para dejarlo fijo abierto) se despliega un panel con las reglas disponibles. Marca las que quieras aplicar y escribe tu mensaje con normalidad: justo antes de enviarlo (al pulsar Enter o el botón de enviar), el script añade las instrucciones marcadas al final de tu mensaje, después de un salto de línea, para que no interrumpan visualmente lo que has escrito.

- **DeepSeek/ChatGPT**: el panel se despliega hacia abajo.
- **Claude**: el panel se despliega hacia arriba (el icono está abajo del todo).

## Cómo se inyectan los prompts

El script recuerda, para la conversación actual, qué reglas estaban activas la última vez que enviaste un mensaje. En cada envío compara ese estado con el actual:

- **Reglas recién marcadas**: se añade una frase por cada una, con este formato:

  > A partir de ahora, sigue la regla "Explica paso a paso": Explica tu razonamiento paso a paso, de forma clara y detallada, como si se lo explicaras a alguien sin conocimientos previos del tema.

- **Reglas recién desmarcadas**: se añade una única frase agrupándolas todas:

  > Cancela las reglas "Explica paso a paso", "Sé conciso". El resto de instrucciones que te he dado siguen vigentes.

- Si no cambia nada respecto al envío anterior (las mismas reglas siguen activas), no se añade ningún texto nuevo — evita repetir instrucciones ya dadas en la misma conversación.
- Si no marcas ninguna regla, el script no toca tu mensaje.

Al detectar una conversación realmente nueva (sin mensajes previos), el registro se reinicia.

## Idiomas

El icono muestra el código del idioma activo. Al hacer click sobre esas letras se abre un desplegable con los 13 idiomas disponibles, cada uno escrito en sí mismo:

| Código | Idioma |
|---|---|
| ES | Español |
| CA | Català |
| EU | Euskara |
| GL | Galego |
| EN | English |
| FR | Français |
| DE | Deutsch |
| IT | Italiano |
| PT | Português |
| RU | Русский |
| ZH | 中文 |
| JA | 日本語 |
| KA | ქართული |

Al elegir un idioma:

- Los nombres y textos de las reglas se muestran (y se inyectan) en ese idioma.
- Las reglas marcadas se mantienen (el estado marcado/desmarcado es independiente del idioma: los identificadores internos son comunes a todos los idiomas).
- El idioma por defecto se detecta a partir del idioma del navegador; si no está entre los soportados, se usa español.

Cada idioma incluye, de fábrica, cuatro reglas: *Sé conciso*, *Explica paso a paso*, *Lenguaje sencillo* y *Responder en [idioma]* (para forzar que el asistente conteste en ese idioma aunque le escribas en otro).

## Prompts personalizados

Puedes añadir tus propias reglas sin tocar el código, desde el propio panel:

1. Abre el panel del idioma en el que quieras crear la regla.
2. Rellena "Nombre corto" y el texto de la instrucción, y pulsa "+ Añadir prompt".
3. La nueva regla aparece en la lista, marcable como cualquier otra, con una "×" para eliminarla.

Estos prompts personalizados se guardan por separado del código del script (en el almacenamiento persistente del gestor de userscripts), así que **no se pierden si en el futuro actualizas el script a una versión nueva** — solo se sobrescriben los prompts "de fábrica" que vienen incluidos en el archivo.

## Compatibilidad por sitio

| Sitio | Anclaje del icono | Despliegue del panel |
|---|---|---|
| DeepSeek | Junto al botón "Share" (barra superior) | Hacia abajo |
| ChatGPT | Junto al botón "Share" (barra superior) | Hacia abajo |
| Claude | Fijo abajo a la derecha (no se inserta en el DOM de la página) | Hacia arriba |

El script detecta automáticamente el editor de texto de cada sitio (`<textarea>` en DeepSeek, editor `contenteditable` tipo ProseMirror en ChatGPT y Claude) e inserta el texto de la forma adecuada en cada caso, incluyendo el manejo especial necesario para que estos editores registren el cambio correctamente.

Si las páginas cambian su estructura interna en el futuro, es posible que el icono deje de encontrar su "botón ancla" y se quede en una posición de emergencia (fija, siempre visible) hasta que se ajusten los selectores en el código.

## Personalización del código

Dentro del archivo puedes ajustar, entre otras cosas:

- `SITE_CONFIG`: posición de emergencia, dirección de despliegue y modo de anclaje por sitio.
- `PROMPTS_BY_LANG`: las reglas "de fábrica" de cada idioma (mismo `id` en todos los idiomas).
- `UI_STRINGS`: textos de interfaz y las plantillas de activación/desactivación, por idioma.
- `PROMPT_JOIN` / `SEPARATOR`: cómo se separan las reglas entre sí y respecto a tu mensaje.

## Almacenamiento y privacidad

El script no hace ninguna llamada de red propia ni envía datos a ningún servidor. Todo lo que guarda se queda en tu navegador, vía `GM_setValue`/`GM_getValue` (o `localStorage` si tu gestor no soporta `GM_*`):

- Qué reglas tienes marcadas.
- El idioma seleccionado.
- Tus prompts personalizados.

Estos datos se comparten entre DeepSeek, ChatGPT y Claude porque es el mismo script instalado, pero no salen de tu equipo.

## Solución de problemas

- **El icono no aparece o se queda en una esquina fija**: el botón ancla del sitio no se ha encontrado; revisa la consola del navegador (busca líneas `[SystemPrompt]`) para más detalle.
- **Los prompts no se inyectan**: comprueba en la consola el log `input encontrado:` — si señala un elemento oculto o vacío, el selector del campo de texto puede necesitar ajuste (el sitio pudo cambiar su HTML).
- **Quiero ver qué está pasando paso a paso**: abre las herramientas de desarrollador (F12) → pestaña "Consola" antes de enviar un mensaje; el script registra cada paso con el prefijo `[SystemPrompt]`.

## Apoya el proyecto

Si te resulta útil, en la parte inferior del panel hay un pequeño enlace de apoyo (no intrusivo, no hace ninguna llamada de red ni recoge datos). Si prefieres no verlo, puedes borrar sin problema el bloque marcado `APOYO ... fin bloque APOYO` en el código; el resto del script sigue funcionando exactamente igual.

Justo encima, hay un botón **"Compartir"** para recomendar el script a otras personas mediante el selector nativo de tu sistema (WhatsApp, Telegram, correo, etc.) o copiando el enlace a Greasy Fork si tu navegador no lo soporta.

## Licencia

GPL-3.0. Autor: Francisco Vico.