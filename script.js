// ==UserScript==
// @name         SyssPrompt
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Icono junto al botón "Share" (DeepSeek/ChatGPT) o en la barra de envío (Claude) para marcar qué system prompt(s) añadir al primer mensaje de cada conversación nueva
// @author       Francisco Vico
// @license      GPL-3.0
// @homepageURL   https://fjvico.github.io
// @supportURL    mailto:fjvico@uma.es
// @match        https://chat.deepseek.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // 0) DETECCIÓN DE SITIO
    // =========================================================
    // De esto dependen: qué botón usamos como "ancla" para colocar el
    // icono, y en qué dirección se despliega el panel (arriba/abajo).
    const HOST = location.hostname;
    let SITE = 'deepseek';
    if (HOST.includes('chatgpt.com') || HOST.includes('chat.openai.com')) {
        SITE = 'chatgpt';
    } else if (HOST.includes('claude.ai')) {
        SITE = 'claude';
    }

    // direction: 'down'  -> el panel se despliega hacia abajo (icono arriba, como en DeepSeek/ChatGPT)
    // direction: 'up'    -> el panel se despliega hacia arriba (icono abajo, como en Claude)
    // fallbackPos: posición de emergencia mientras no se localiza el botón ancla
    // attachMode: 'inline' -> se intenta enganchar el icono junto a un botón real de la página
    //             'fixed'  -> el icono se queda SIEMPRE en la posición fija (fallbackPos); no se
    //                         inserta dentro del DOM de la página. Se usa en Claude porque su barra
    //                         del composer centra sus hijos y el icono acababa apareciendo en medio
    //                         del ancho en vez de pegado al margen derecho.
    // inlineOffsetY: desplazamiento vertical extra (px) aplicado SOLO cuando attachMode es 'inline'
    //                y el enganche tuvo éxito (para ChatGPT, 1.5 veces la altura del icono).
    const ICON_HEIGHT = 28;
    const SITE_CONFIG = {
        deepseek: { direction: 'down', fallbackPos: { top: '12px', right: '64px' }, attachMode: 'inline', inlineOffsetY: 0 },
        chatgpt:  { direction: 'down', fallbackPos: { top: '50px', right: '20px' }, attachMode: 'inline', inlineOffsetY: 0 },
        claude:   { direction: 'up',   fallbackPos: { bottom: '12px', right: '20px' }, attachMode: 'fixed', inlineOffsetY: 0 },
    };
    const siteConfig = SITE_CONFIG[SITE];

    // =========================================================
    // 1) IDIOMAS Y PROMPTS (traducidos) — añade tantos como quieras
    // =========================================================
    // Los ids de cada prompt deben ser IGUALES en todos los idiomas (son la
    // clave que se guarda al marcar/desmarcar); solo cambian "name" y "text".
    const LANGUAGES = ['ES', 'CA', 'EU', 'GL', 'EN', 'FR', 'DE', 'IT', 'PT', 'RU', 'ZH', 'JA', 'KA'];

    const PROMPTS_BY_LANG = {
        ES: [
            { id: 'concision', name: 'Sé conciso', text: 'Responde de forma extremadamente concisa, sin rodeos ni explicaciones innecesarias.' },
            { id: 'paso_a_paso', name: 'Explica paso a paso', text: 'Explica tu razonamiento paso a paso, de forma clara y detallada, como si se lo explicaras a alguien sin conocimientos previos del tema.' },
            { id: 'lenguaje_sencillo', name: 'Lenguaje sencillo', text: 'Usa un lenguaje sencillo y cercano, evitando tecnicismos y jerga innecesaria.' },
            { id: 'idioma_respuesta', name: 'Responder en español', text: 'Contesta en español.' },
        ],
        CA: [
            { id: 'concision', name: 'Sigues concís', text: 'Respon de manera extremadament concisa, sense rodejos ni explicacions innecessàries.' },
            { id: 'paso_a_paso', name: 'Explica pas a pas', text: 'Explica el teu raonament pas a pas, de manera clara i detallada, com si ho expliquessis a algú sense coneixements previs del tema.' },
            { id: 'lenguaje_sencillo', name: 'Llenguatge senzill', text: 'Fes servir un llenguatge senzill i proper, evitant tecnicismes i argot innecessari.' },
            { id: 'idioma_respuesta', name: 'Respondre en català', text: 'Contesta en català.' },
        ],
        EU: [
            { id: 'concision', name: 'Izan zaitez zehatza', text: 'Erantzun oso modu zehatzean, itzulinguruak eta beharrezkoak ez diren azalpenak saihestuz.' },
            { id: 'paso_a_paso', name: 'Azaldu urratsez urrats', text: 'Azaldu zure arrazoiketa urratsez urrats, argi eta zehatz, gaiaren aurretiko ezagutzarik ez duen norbaiti azalduko bazenio bezala.' },
            { id: 'lenguaje_sencillo', name: 'Hizkuntza erraza', text: 'Erabili hizkuntza erraz eta hurbila, teknizismoak eta beharrezkoa ez den jargoia saihestuz.' },
            { id: 'idioma_respuesta', name: 'Euskaraz erantzun', text: 'Erantzun euskaraz.' },
        ],
        GL: [
            { id: 'concision', name: 'Sé conciso', text: 'Responde de forma extremadamente concisa, sen rodeos nin explicacións innecesarias.' },
            { id: 'paso_a_paso', name: 'Explica paso a paso', text: 'Explica o teu razoamento paso a paso, de forma clara e detallada, coma se llo estiveses a explicar a alguén sen coñecementos previos sobre o tema.' },
            { id: 'lenguaje_sencillo', name: 'Linguaxe sinxela', text: 'Usa unha linguaxe sinxela e próxima, evitando tecnicismos e xerga innecesaria.' },
            { id: 'idioma_respuesta', name: 'Responder en galego', text: 'Contesta en galego.' },
        ],
        EN: [
            { id: 'concision', name: 'Be concise', text: 'Answer extremely concisely, without detours or unnecessary explanations.' },
            { id: 'paso_a_paso', name: 'Explain step by step', text: 'Explain your reasoning step by step, clearly and in detail, as if explaining it to someone with no prior knowledge of the topic.' },
            { id: 'lenguaje_sencillo', name: 'Plain language', text: 'Use simple, approachable language, avoiding jargon and unnecessary technical terms.' },
            { id: 'idioma_respuesta', name: 'Reply in English', text: 'Answer in English.' },
        ],
        FR: [
            { id: 'concision', name: 'Sois concis', text: 'Réponds de manière extrêmement concise, sans détours ni explications inutiles.' },
            { id: 'paso_a_paso', name: 'Explique étape par étape', text: "Explique ton raisonnement étape par étape, de façon claire et détaillée, comme si tu l'expliquais à quelqu'un sans connaissances préalables du sujet." },
            { id: 'lenguaje_sencillo', name: 'Langage simple', text: 'Utilise un langage simple et accessible, en évitant le jargon et les termes techniques inutiles.' },
            { id: 'idioma_respuesta', name: 'Répondre en français', text: 'Réponds en français.' },
        ],
        DE: [
            { id: 'concision', name: 'Sei prägnant', text: 'Antworte extrem knapp, ohne Umwege oder unnötige Erklärungen.' },
            { id: 'paso_a_paso', name: 'Erkläre Schritt für Schritt', text: 'Erkläre deine Überlegungen Schritt für Schritt, klar und detailliert, so als würdest du es jemandem ohne Vorkenntnisse zum Thema erklären.' },
            { id: 'lenguaje_sencillo', name: 'Einfache Sprache', text: 'Verwende eine einfache, zugängliche Sprache und vermeide unnötigen Fachjargon.' },
            { id: 'idioma_respuesta', name: 'Auf Deutsch antworten', text: 'Antworte auf Deutsch.' },
        ],
        IT: [
            { id: 'concision', name: 'Sii conciso', text: 'Rispondi in modo estremamente conciso, senza giri di parole o spiegazioni inutili.' },
            { id: 'paso_a_paso', name: 'Spiega passo dopo passo', text: "Spiega il tuo ragionamento passo dopo passo, in modo chiaro e dettagliato, come se lo stessi spiegando a qualcuno senza conoscenze pregresse sull'argomento." },
            { id: 'lenguaje_sencillo', name: 'Linguaggio semplice', text: 'Usa un linguaggio semplice e accessibile, evitando tecnicismi e gergo inutile.' },
            { id: 'idioma_respuesta', name: 'Rispondere in italiano', text: 'Rispondi in italiano.' },
        ],
        PT: [
            { id: 'concision', name: 'Sê conciso', text: 'Responde de forma extremamente concisa, sem rodeios nem explicações desnecessárias.' },
            { id: 'paso_a_paso', name: 'Explica passo a passo', text: 'Explica o teu raciocínio passo a passo, de forma clara e detalhada, como se estivesses a explicar a alguém sem conhecimentos prévios sobre o tema.' },
            { id: 'lenguaje_sencillo', name: 'Linguagem simples', text: 'Usa uma linguagem simples e próxima, evitando tecnicismos e jargão desnecessário.' },
            { id: 'idioma_respuesta', name: 'Responder em português', text: 'Responde em português.' },
        ],
        RU: [
            { id: 'concision', name: 'Будь краток', text: 'Отвечай предельно кратко, без лишних отступлений и ненужных объяснений.' },
            { id: 'paso_a_paso', name: 'Объясняй пошагово', text: 'Объясняй свои рассуждения шаг за шагом, ясно и подробно, как будто объясняешь человеку, который впервые слышит об этой теме.' },
            { id: 'lenguaje_sencillo', name: 'Простой язык', text: 'Используй простой и доступный язык, избегая терминов и ненужного жаргона.' },
            { id: 'idioma_respuesta', name: 'Отвечать на русском', text: 'Отвечай на русском языке.' },
        ],
        ZH: [
            { id: 'concision', name: '简洁回答', text: '请极其简洁地回答，不要绕圈子，也不要给出不必要的解释。' },
            { id: 'paso_a_paso', name: '逐步解释', text: '请一步步清晰详细地解释你的推理过程，就像在向一个完全不了解该主题的人讲解一样。' },
            { id: 'lenguaje_sencillo', name: '简单语言', text: '使用简单易懂、贴近日常的语言，避免使用行话和不必要的专业术语。' },
            { id: 'idioma_respuesta', name: '用中文回答', text: '请用中文回答。' },
        ],
        JA: [
            { id: 'concision', name: '簡潔に答える', text: '回り道や不要な説明をせず、極めて簡潔に答えてください。' },
            { id: 'paso_a_paso', name: 'ステップごとに説明', text: 'そのトピックについて予備知識のない人に説明するかのように、あなたの推論をステップごとに明確かつ詳細に説明してください。' },
            { id: 'lenguaje_sencillo', name: '平易な言葉', text: '専門用語や不要な業界用語を避け、シンプルで親しみやすい言葉を使ってください。' },
            { id: 'idioma_respuesta', name: '日本語で回答', text: '日本語で答えてください。' },
        ],
        KA: [
            { id: 'concision', name: 'იყავი ლაკონური', text: 'უპასუხე უკიდურესად მოკლედ, ზედმეტი გადახვევებისა და საჭირო არარსებული განმარტებების გარეშე.' },
            { id: 'paso_a_paso', name: 'ახსენი ნაბიჯ-ნაბიჯ', text: 'ახსენი შენი მსჯელობა ნაბიჯ-ნაბიჯ, ნათლად და დეტალურად, თითქოს განუმარტავდი ვინმეს, ვისაც ამ თემის შესახებ წინასწარი ცოდნა არ აქვს.' },
            { id: 'lenguaje_sencillo', name: 'მარტივი ენა', text: 'გამოიყენე მარტივი და ხელმისაწვდომი ენა, მოერიდე ჟარგონსა და საჭიროების გარეშე ტექნიკურ ტერმინებს.' },
            { id: 'idioma_respuesta', name: 'უპასუხე ქართულად', text: 'უპასუხე ქართულად.' },
        ],
        // -> Añade más objetos aquí (mismo id en cada idioma): { id: 'xxx', name: '...', text: '...' }
    };

    // Textos de la interfaz (nota y plantilla de revocación) por idioma.
    // activateTemplate(name, text): frase para CADA prompt recién activado.
    // deactivateTemplate(namesList): frase única para TODOS los prompts recién
    // desactivados en esta pasada (namesList ya viene formateado como
    // "Nombre 1", "Nombre 2").
    const UI_STRINGS = {
        ES: { note: 'Si no marcas ninguno, no se añade nada.', title: 'System prompts',
            namePlaceholder: 'Nombre corto', textPlaceholder: 'Texto de la instrucción...', addButton: '+ Añadir prompt',
            shareLabel: 'Compartir', shareText: 'SyssPrompt: añade instrucciones a DeepSeek, ChatGPT y Claude con un clic.', copiedLabel: '¡Enlace copiado!',
            activateTemplate: (name, text) => `A partir de ahora, sigue la regla "${name}": ${text}`,
            deactivateTemplate: (names) => `Cancela las reglas ${names}. El resto de instrucciones que te he dado siguen vigentes.` },
        CA: { note: "Si no en marques cap, no s'afegeix res.", title: 'System prompts',
            namePlaceholder: 'Nom curt', textPlaceholder: 'Text de la instrucció...', addButton: '+ Afegir prompt',
            shareLabel: 'Compartir', shareText: 'SyssPrompt: afegeix instruccions a DeepSeek, ChatGPT i Claude amb un clic.', copiedLabel: 'Enllaç copiat!',
            activateTemplate: (name, text) => `A partir d'ara, segueix la regla "${name}": ${text}`,
            deactivateTemplate: (names) => `Cancel·la les regles ${names}. La resta d'instruccions que t'he donat continuen vigents.` },
        EU: { note: 'Bat ere markatzen ez baduzu, ez da ezer gehitzen.', title: 'System prompts',
            namePlaceholder: 'Izen laburra', textPlaceholder: 'Jarraibidearen testua...', addButton: '+ Prompt bat gehitu',
            shareLabel: 'Partekatu', shareText: 'SyssPrompt: gehitu jarraibideak DeepSeek, ChatGPT eta Claude-ri klik batean.', copiedLabel: 'Esteka kopiatuta!',
            activateTemplate: (name, text) => `Hemendik aurrera, jarraitu "${name}" araua: ${text}`,
            deactivateTemplate: (names) => `Ezeztatu ${names} arauak. Eman dizkizudan gainerako jarraibideek indarrean jarraitzen dute.` },
        GL: { note: 'Se non marcas ningún, non se engade nada.', title: 'System prompts',
            namePlaceholder: 'Nome curto', textPlaceholder: 'Texto da instrución...', addButton: '+ Engadir prompt',
            shareLabel: 'Compartir', shareText: 'SyssPrompt: engade instrucións a DeepSeek, ChatGPT e Claude cun clic.', copiedLabel: 'Ligazón copiada!',
            activateTemplate: (name, text) => `A partir de agora, segue a regra "${name}": ${text}`,
            deactivateTemplate: (names) => `Cancela as regras ${names}. O resto das instrucións que che dei seguen vixentes.` },
        EN: { note: "If you don't check any, nothing is added.", title: 'System prompts',
            namePlaceholder: 'Short name', textPlaceholder: 'Instruction text...', addButton: '+ Add prompt',
            shareLabel: 'Share', shareText: 'SyssPrompt: add instructions to DeepSeek, ChatGPT and Claude with one click.', copiedLabel: 'Link copied!',
            activateTemplate: (name, text) => `From now on, follow the rule "${name}": ${text}`,
            deactivateTemplate: (names) => `Cancel the rules ${names}. The rest of the instructions I gave you remain in effect.` },
        FR: { note: "Si vous n'en cochez aucun, rien n'est ajouté.", title: 'System prompts',
            namePlaceholder: 'Nom court', textPlaceholder: "Texte de l'instruction...", addButton: '+ Ajouter un prompt',
            shareLabel: 'Partager', shareText: "SyssPrompt : ajoute des instructions à DeepSeek, ChatGPT et Claude en un clic.", copiedLabel: 'Lien copié !',
            activateTemplate: (name, text) => `À partir de maintenant, suis la règle "${name}" : ${text}`,
            deactivateTemplate: (names) => `Annule les règles ${names}. Le reste des instructions que je t'ai données reste en vigueur.` },
        DE: { note: 'Wenn du keinen auswählst, wird nichts hinzugefügt.', title: 'System prompts',
            namePlaceholder: 'Kurzer Name', textPlaceholder: 'Text der Anweisung...', addButton: '+ Prompt hinzufügen',
            shareLabel: 'Teilen', shareText: 'SyssPrompt: fügt DeepSeek, ChatGPT und Claude mit einem Klick Anweisungen hinzu.', copiedLabel: 'Link kopiert!',
            activateTemplate: (name, text) => `Ab jetzt befolge die Regel "${name}": ${text}`,
            deactivateTemplate: (names) => `Widerrufe die Regeln ${names}. Die übrigen Anweisungen, die ich dir gegeben habe, bleiben weiterhin gültig.` },
        IT: { note: 'Se non ne selezioni nessuno, non viene aggiunto nulla.', title: 'System prompts',
            namePlaceholder: 'Nome breve', textPlaceholder: "Testo dell'istruzione...", addButton: '+ Aggiungi prompt',
            shareLabel: 'Condividi', shareText: 'SyssPrompt: aggiunge istruzioni a DeepSeek, ChatGPT e Claude con un clic.', copiedLabel: 'Link copiato!',
            activateTemplate: (name, text) => `Da ora in poi, segui la regola "${name}": ${text}`,
            deactivateTemplate: (names) => `Annulla le regole ${names}. Il resto delle istruzioni che ti ho dato resta valido.` },
        PT: { note: 'Se não marcares nenhum, nada é adicionado.', title: 'System prompts',
            namePlaceholder: 'Nome curto', textPlaceholder: 'Texto da instrução...', addButton: '+ Adicionar prompt',
            shareLabel: 'Partilhar', shareText: 'SyssPrompt: adiciona instruções ao DeepSeek, ChatGPT e Claude com um clique.', copiedLabel: 'Link copiado!',
            activateTemplate: (name, text) => `A partir de agora, segue a regra "${name}": ${text}`,
            deactivateTemplate: (names) => `Cancela as regras ${names}. O resto das instruções que te dei continuam válidas.` },
        RU: { note: 'Если ничего не отмечено, ничего не добавляется.', title: 'System prompts',
            namePlaceholder: 'Короткое название', textPlaceholder: 'Текст инструкции...', addButton: '+ Добавить промпт',
            shareLabel: 'Поделиться', shareText: 'SyssPrompt: добавляет инструкции в DeepSeek, ChatGPT и Claude в один клик.', copiedLabel: 'Ссылка скопирована!',
            activateTemplate: (name, text) => `С этого момента следуй правилу "${name}": ${text}`,
            deactivateTemplate: (names) => `Отмени правила ${names}. Остальные данные тебе инструкции остаются в силе.` },
        ZH: { note: '如果不勾选任何一项，则不会添加任何内容。', title: 'System prompts',
            namePlaceholder: '简短名称', textPlaceholder: '指令内容...', addButton: '+ 添加提示词',
            shareLabel: '分享', shareText: 'SyssPrompt：一键为 DeepSeek、ChatGPT 和 Claude 添加指令。', copiedLabel: '链接已复制！',
            activateTemplate: (name, text) => `从现在起，请遵循规则"${name}"：${text}`,
            deactivateTemplate: (names) => `取消规则${names}。我给你的其他指令仍然有效。` },
        JA: { note: '何もチェックしない場合、何も追加されません。', title: 'System prompts',
            namePlaceholder: '短い名前', textPlaceholder: '指示の内容...', addButton: '+ プロンプトを追加',
            shareLabel: '共有', shareText: 'SyssPrompt：ワンクリックでDeepSeek、ChatGPT、Claudeに指示を追加。', copiedLabel: 'リンクをコピーしました！',
            activateTemplate: (name, text) => `これからは「${name}」というルールに従ってください：${text}`,
            deactivateTemplate: (names) => `ルール${names}を取り消してください。これまでに伝えた他の指示は引き続き有効です。` },
        KA: { note: 'თუ არცერთს არ მონიშნავ, არაფერი დაემატება.', title: 'System prompts',
            namePlaceholder: 'მოკლე სახელი', textPlaceholder: 'ინსტრუქციის ტექსტი...', addButton: '+ პრომპტის დამატება',
            shareLabel: 'გაზიარება', shareText: 'SyssPrompt: დაამატე ინსტრუქციები DeepSeek-ს, ChatGPT-ს და Claude-ს ერთი დაწკაპუნებით.', copiedLabel: 'ბმული დაკოპირდა!',
            activateTemplate: (name, text) => `ამიერიდან მიჰყევი წესს "${name}": ${text}`,
            deactivateTemplate: (names) => `გააუქმე წესები ${names}. დანარჩენი მითითებები, რომლებიც მოგეცი, ძალაში რჩება.` },
    };

    // Convierte una lista de nombres en 'name1", "name2' formateado para
    // insertar dentro de deactivateTemplate (que ya pone las comillas del extremo).
    function quotedNames(names) {
        return names.map(n => `"${n}"`).join(', ');
    }

    // Si este script te resulta útil y quieres apoyar el trabajo detrás de él,
    // abajo del todo del panel se muestra un pequeño enlace de apoyo (no
    // intrusivo, no hace ninguna llamada de red ni recoge datos). Si prefieres
    // no verlo, puedes borrar sin problema el bloque "APOYO" más abajo (busca
    // "APOYO" en este archivo); el resto del script funciona exactamente igual.
    const SUPPORT_URL = 'https://www.amazon.es/-/en/Cartas-Alias-pr%C3%B3ximo-inicio-sesi%C3%B3n-ebook/dp/B0GQJMRJ48';

    // Página del script en Greasy Fork: la forma más sencilla de instalarlo
    // (botón de instalación de un clic, detecta si falta el gestor de userscripts).
    const SITE_URL = 'https://greasyfork.org/en/scripts/593175-syssprompt';
    const SUPPORT_TEXT_PRE = 'Buy me a ';
    const SUPPORT_TEXT_LINK = 'book';
    const SUPPORT_TEXT_POST = ' ❤️';

    function getPrompts() {
        const builtIn = PROMPTS_BY_LANG[currentLang] || PROMPTS_BY_LANG.ES;
        // Los "de fábrica" vienen del código (pueden cambiar en una futura
        // actualización del script); los personalizados del usuario se leen
        // de almacenamiento persistente y sobreviven a esas actualizaciones.
        return builtIn.concat(getCustomPrompts(currentLang));
    }
    function getUIStrings() {
        return UI_STRINGS[currentLang] || UI_STRINGS.ES;
    }

    // Cómo se combinan los prompts marcados entre sí (un único párrafo, separados por espacio)
    const PROMPT_JOIN = " ";
    // Cómo se separa el mensaje del usuario del bloque de prompts (una línea en blanco)
    const SEPARATOR = "\n\n";

    // =========================================================
    // 2) PERSISTENCIA (qué prompts están marcados)
    // =========================================================
    // Misma clave en los tres sitios: si usas Tampermonkey, la selección de
    // prompts se comparte entre DeepSeek, ChatGPT y Claude (es el mismo script).
    const STORAGE_KEY_SELECTED_IDS = 'ds_sysprompt_selected_ids';

    const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

    function loadValue(key, def) {
        try {
            if (hasGM) {
                const v = GM_getValue(key, undefined);
                return v === undefined ? def : v;
            }
            const v = localStorage.getItem(key);
            return v === null ? def : JSON.parse(v);
        } catch (err) {
            console.error('[SystemPrompt] Error leyendo valor guardado:', err);
            return def;
        }
    }
    function saveValue(key, value) {
        try {
            if (hasGM) {
                GM_setValue(key, value);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (err) {
            console.error('[SystemPrompt] Error guardando valor:', err);
        }
    }

    // Array de ids marcados. Por defecto, ninguno (nada se inyecta hasta que el usuario marque algo).
    let selectedIds = loadValue(STORAGE_KEY_SELECTED_IDS, []);

    function isSelected(id) {
        return selectedIds.includes(id);
    }
    function toggleSelected(id, checked) {
        if (checked && !selectedIds.includes(id)) {
            selectedIds.push(id);
        } else if (!checked) {
            selectedIds = selectedIds.filter(x => x !== id);
        }
        saveValue(STORAGE_KEY_SELECTED_IDS, selectedIds);
    }

    // =========================================================
    // 2.1) PROMPTS PERSONALIZADOS DEL USUARIO
    // =========================================================
    // Los prompts de PROMPTS_BY_LANG viven en el código del script: si algún
    // día se actualiza el archivo (nueva versión), ese array se sobrescribe
    // entero. Para que los prompts que el propio usuario añada desde el panel
    // NO se pierdan al actualizar, se guardan aparte, en almacenamiento
    // persistente (independiente del código), y se combinan en tiempo de
    // ejecución con los "de fábrica" en getPrompts().
    const STORAGE_KEY_CUSTOM_PROMPTS = 'ai_sysprompt_custom_prompts';

    let customPromptsByLang = loadValue(STORAGE_KEY_CUSTOM_PROMPTS, {});

    function getCustomPrompts(langCode) {
        return Array.isArray(customPromptsByLang[langCode]) ? customPromptsByLang[langCode] : [];
    }

    function addCustomPrompt(langCode, name, text) {
        const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const list = getCustomPrompts(langCode).concat([{ id, name, text }]);
        customPromptsByLang = Object.assign({}, customPromptsByLang, { [langCode]: list });
        saveValue(STORAGE_KEY_CUSTOM_PROMPTS, customPromptsByLang);
        return id;
    }

    function deleteCustomPrompt(langCode, id) {
        const list = getCustomPrompts(langCode).filter(p => p.id !== id);
        customPromptsByLang = Object.assign({}, customPromptsByLang, { [langCode]: list });
        saveValue(STORAGE_KEY_CUSTOM_PROMPTS, customPromptsByLang);
        if (isSelected(id)) toggleSelected(id, false); // si estaba marcado, se desmarca también
    }

    // =========================================================
    // 2.1) PERSISTENCIA DEL IDIOMA SELECCIONADO
    // =========================================================
    const STORAGE_KEY_LANG = 'ai_sysprompt_lang';

    function detectDefaultLang() {
        const nav = (navigator.language || 'es').slice(0, 2).toUpperCase();
        return LANGUAGES.includes(nav) ? nav : 'ES';
    }

    let currentLang = loadValue(STORAGE_KEY_LANG, detectDefaultLang());
    if (!LANGUAGES.includes(currentLang)) currentLang = 'ES';

    function setLang(code) {
        if (!LANGUAGES.includes(code)) return;
        currentLang = code;
        saveValue(STORAGE_KEY_LANG, currentLang);
    }

    // =========================================================
    // 3) INYECCIÓN EN EL CAMPO DE TEXTO
    // =========================================================
    // Guarda los ids de los prompts que estaban activos la última vez que se
    // tocó el mensaje en ESTE chat. Se resetea a [] al cambiar de conversación.
    let lastInjectedIds = [];

    function sameIdSet(a, b) {
        if (a.length !== b.length) return false;
        const setB = new Set(b);
        return a.every(id => setB.has(id));
    }

    // DeepSeek usa un <textarea> normal. ChatGPT y Claude usan un editor
    // "contenteditable" (tipo ProseMirror) como campo real, pero ADEMÁS
    // mantienen un <textarea> oculto (fallback de accesibilidad/autofill,
    // vacío y con display:none) que NO hay que confundir con el campo real.
    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (el.offsetWidth === 0 && el.offsetHeight === 0 && style.position !== 'fixed') return false;
        return true;
    }

    function getInputElement() {
        if (SITE === 'deepseek') {
            return document.querySelector('textarea');
        }

        // ChatGPT / Claude: priorizar el editor contenteditable visible.
        const ceCandidates = [
            '#prompt-textarea[contenteditable="true"]',
            'div[contenteditable="true"].ProseMirror',
            'div[contenteditable="true"]',
        ];
        for (const sel of ceCandidates) {
            const el = document.querySelector(sel);
            if (el && isVisible(el)) return el;
        }

        // Fallback: un <textarea> visible (si el sitio cambia y vuelve a usar uno real)
        const visibleTextarea = Array.from(document.querySelectorAll('textarea')).find(isVisible);
        if (visibleTextarea) return visibleTextarea;

        // Último recurso: lo que haya, aunque no esté marcado como visible
        return document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea') || null;
    }

    function isTextarea(el) {
        return el && el.tagName === 'TEXTAREA';
    }

    function getInputText(el) {
        return isTextarea(el) ? el.value : (el.innerText || '');
    }

    function isInputEmpty(el) {
        return !getInputText(el).trim();
    }

    function setTextareaValue(el, value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
        ).set;
        nativeSetter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));

        // Mantener el scroll y el cursor arriba, para que el texto añadido
        // (que queda por debajo, tras el mensaje del usuario) no se vea al
        // insertarlo: no queremos que salte a mostrar el final del contenido.
        requestAnimationFrame(() => {
            try {
                el.setSelectionRange(0, 0);
                el.scrollTop = 0;
            } catch (err) {
                // Algunos navegadores/inputs pueden no soportar setSelectionRange en este momento
            }
        });
    }

    // Editores contenteditable (ChatGPT / Claude, tipo ProseMirror) no basta
    // con tocar el innerHTML: el editor mantiene su propio modelo interno de
    // documento y, si lo modificamos "a mano" por fuera de su pipeline de
    // edición, no se entera del cambio y al enviar el mensaje usa su propio
    // contenido (sin lo que hayamos insertado). Por eso aquí simulamos una
    // inserción real: colocamos el cursor al final y usamos execCommand
    // ('insertText'), que dispara los eventos nativos (beforeinput/input)
    // que estos editores sí escuchan para actualizar su estado interno.
    function appendToContentEditable(el, addition) {
        el.focus();

        // Cursor al final del contenido actual
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        let inserted = false;
        try {
            inserted = document.execCommand('insertText', false, addition);
        } catch (err) {
            inserted = false;
        }

        if (!inserted) {
            // Fallback si execCommand no está disponible: disparamos los
            // eventos nativos manualmente tras insertar el texto.
            el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: addition }));
            document.execCommand ? null : (el.textContent += addition);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: addition }));
        }

        // Ocultar el bloque insertado: devolver el cursor al principio y el
        // scroll arriba, igual que se hace con el textarea de DeepSeek.
        requestAnimationFrame(() => {
            try {
                const range2 = document.createRange();
                range2.selectNodeContents(el);
                range2.collapse(true);
                const sel2 = window.getSelection();
                sel2.removeAllRanges();
                sel2.addRange(range2);
                el.scrollTop = 0;
            } catch (err) {
                // Algunos editores pueden gestionar la selección de otra forma
            }
        });
    }

    function tryInject() {
        const PROMPTS = getPrompts();
        const currentIds = PROMPTS.filter(p => isSelected(p.id)).map(p => p.id);
        console.log('[SystemPrompt] tryInject(). currentIds=', currentIds, 'lastInjectedIds=', lastInjectedIds, 'lang=', currentLang);

        // Sin cambios respecto a la última vez que se aplicó en este chat -> no tocar nada
        if (sameIdSet(currentIds, lastInjectedIds)) {
            console.log('[SystemPrompt] Sin cambios respecto a la última vez, no se inyecta nada.');
            return;
        }

        const addedIds = currentIds.filter(id => !lastInjectedIds.includes(id));
        const removedIds = lastInjectedIds.filter(id => !currentIds.includes(id));
        console.log('[SystemPrompt] addedIds=', addedIds, 'removedIds=', removedIds);

        // Frase por cada prompt recién activado: activateTemplate(nombre, texto)
        let block = '';
        if (addedIds.length > 0) {
            const ui = getUIStrings();
            block = PROMPTS.filter(p => addedIds.includes(p.id))
                .map(p => ui.activateTemplate(p.name, p.text))
                .join(PROMPT_JOIN);
        }
        // Una única frase agrupando TODOS los prompts recién desactivados en esta pasada
        if (removedIds.length > 0) {
            const removedNames = PROMPTS.filter(p => removedIds.includes(p.id)).map(p => p.name);
            if (block) block += ' ';
            block += getUIStrings().deactivateTemplate(quotedNames(removedNames));
        }
        console.log('[SystemPrompt] Bloque a insertar:', JSON.stringify(block));

        if (!block) {
            lastInjectedIds = currentIds;
            console.log('[SystemPrompt] Bloque vacío, no hay nada que insertar.');
            return;
        }

        const input = getInputElement();
        console.log('[SystemPrompt] input encontrado:', input, 'valor actual:', input ? JSON.stringify(getInputText(input)) : null);
        if (!input || isInputEmpty(input)) {
            console.log('[SystemPrompt] No se inyecta: no hay campo de texto o está vacío.');
            return;
        }

        // El mensaje del usuario va primero (visible), el bloque de prompts se
        // añade DESPUÉS, oculto por debajo del scroll.
        const addition = SEPARATOR + block;
        if (isTextarea(input)) {
            setTextareaValue(input, getInputText(input) + addition);
        } else {
            appendToContentEditable(input, addition);
        }
        lastInjectedIds = currentIds;
        console.log('[SystemPrompt] Inyectado. Bloque añadido:', JSON.stringify(addition));
    }

    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                tryInject();
            }
        },
        true
    );

    document.addEventListener(
        'click',
        (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
            if (label.includes('send') || label.includes('enviar')) {
                tryInject();
            }
        },
        true
    );

    // Al cambiar de conversación (nueva URL), olvidamos lo aplicado hasta
    // ahora — pero SOLO si de verdad es una conversación nueva (sin mensajes
    // todavía). Muchos sitios cambian la URL justo después del primer envío
    // (para asignarle un ID real a la conversación) sin que sea una
    // conversación distinta; en ese caso NO hay que resetear.
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const bubbles = document.querySelectorAll(
                '[class*="message"], [data-testid*="message"], [class*="chat-message"], [data-message-author-role], [data-testid*="conversation-turn"]'
            );
            if (bubbles.length === 0) {
                lastInjectedIds = [];
                console.log('[SystemPrompt] Nueva conversación detectada, se reinicia el registro.');
            } else {
                console.log('[SystemPrompt] Cambio de URL sin conversación nueva (ya hay mensajes), no se reinicia.');
            }
        }
    }, 500);

    // =========================================================
    // 4) LOCALIZAR EL BOTÓN "ANCLA" JUNTO AL QUE COLGAR EL ICONO
    // =========================================================
    // - DeepSeek y ChatGPT: el botón "Share" de la barra superior.
    // - Claude: no hay un "Share" cómodo en la barra del composer, así que
    //   usamos el botón de enviar mensaje (abajo a la derecha), que es lo
    //   que hace que el icono quede "abajo" como pide el usuario.
    function findShareButtonGeneric() {
        const candidates = [
            'button[aria-label*="share" i]',
            'button[title*="share" i]',
            '[data-testid*="share" i]',
            'a[aria-label*="share" i]',
        ];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        const buttons = Array.from(document.querySelectorAll('button, a'));
        return buttons.find(b => /^(share|compartir)$/i.test((b.textContent || '').trim())) || null;
    }

    function findSendButtonClaude() {
        const candidates = [
            'button[aria-label*="send message" i]',
            'button[aria-label*="send" i]',
            '[data-testid="send-message-button"]',
        ];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    function findAnchorButton() {
        if (SITE === 'claude') return findSendButtonClaude();
        return findShareButtonGeneric(); // deepseek y chatgpt
    }

    // =========================================================
    // 5) ICONO REDONDO + DESPLEGABLE (Shadow DOM, aislado del CSS del sitio)
    // =========================================================
    const HOST_ID = 'ds-sysprompt-host';
    const PANEL_ID = 'ds-sysprompt-panel-host';
    let hostEl = null;      // icono, se inserta dentro de la barra junto al botón ancla
    let panelHostEl = null; // panel desplegable, SIEMPRE flotante en <body>, posicionado por JS
    let panelDropdown = null;
    let iconEl = null;
    let langLabelEl = null; // <span> con el código de idioma (ES/EN/...) dentro del icono
    let openLanguagePicker = null; // se asigna dentro de buildWidget()
    let checkboxEls = {}; // id -> input

    function buildWidget() {
        if (document.getElementById(HOST_ID)) return;

        // ---------- 1) ICONO ----------
        hostEl = document.createElement('div');
        hostEl.id = HOST_ID;
        // Posición de emergencia (SIEMPRE visible) mientras no se localiza el botón ancla.
        const fp = siteConfig.fallbackPos;
        let fallbackStyle =
            'all: initial !important;' +
            'position: fixed !important;' +
            'z-index: 2147483647 !important;' +
            'pointer-events: auto !important;' +
            `right: ${fp.right} !important;`;
        fallbackStyle += fp.top ? `top: ${fp.top} !important;` : `bottom: ${fp.bottom} !important;`;
        hostEl.setAttribute('style', fallbackStyle);

        const shadow = hostEl.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            :host { all: initial; }
            * { box-sizing: border-box; }
            .icon {
                height: ${ICON_HEIGHT}px;
                padding: 0 10px;
                border-radius: ${ICON_HEIGHT / 2}px;
                background: #2a2a2a;
                border: 1px solid #555;
                color: #eee;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                font-size: 14px;
                cursor: pointer;
                user-select: none;
                box-shadow: 0 1px 4px rgba(0,0,0,0.4);
                white-space: nowrap;
            }
            .icon.active {
                border-color: #7aa2ff;
                box-shadow: 0 0 0 2px rgba(122,162,255,0.4);
            }
            .icon .gear {
                font-size: 14px;
                line-height: 1;
            }
            .icon .lang-code {
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.5px;
                color: #cfd8ff;
                border-left: 1px solid #555;
                padding-left: 6px;
                cursor: pointer;
            }
            .icon .lang-code:hover {
                color: #7aa2ff;
            }
        `;

        iconEl = document.createElement('div');
        iconEl.className = 'icon';
        iconEl.title = getUIStrings().title;

        const gearSpan = document.createElement('span');
        gearSpan.className = 'gear';
        gearSpan.textContent = '🐍';

        const langSpan = document.createElement('span');
        langSpan.className = 'lang-code';
        langSpan.textContent = currentLang;
        langSpan.title = 'Click para elegir idioma / choose language';
        langSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            openLanguagePicker();
        });
        langLabelEl = langSpan;

        iconEl.appendChild(gearSpan);
        iconEl.appendChild(langSpan);

        shadow.appendChild(style);
        shadow.appendChild(iconEl);
        document.body.appendChild(hostEl);

        // ---------- 2) PANEL DESPLEGABLE (independiente, flotante en <body>) ----------
        panelHostEl = document.createElement('div');
        panelHostEl.id = PANEL_ID;
        panelHostEl.setAttribute(
            'style',
            'all: initial !important;' +
            'position: fixed !important;' +
            'z-index: 2147483647 !important;' +
            'pointer-events: auto !important;' +
            'display: none !important;'
        );

        const panelShadow = panelHostEl.attachShadow({ mode: 'open' });
        const panelStyle = document.createElement('style');
        panelStyle.textContent = `
            :host { all: initial; }
            * { box-sizing: border-box; }
            .dropdown {
                font-family: system-ui, sans-serif;
                background: #1e1e1e;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 8px;
                min-width: 220px;
                max-width: 280px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                color: #eee;
                font-size: 12px;
            }
            .item {
                display: flex;
                align-items: flex-start;
                gap: 6px;
                padding: 4px 2px;
                cursor: pointer;
            }
            .item:hover { background: rgba(255,255,255,0.06); border-radius: 4px; }
            .item input { margin-top: 2px; cursor: pointer; }
            .item-label { line-height: 1.3; flex: 1; }
            .del-btn {
                color: #999;
                cursor: pointer;
                padding: 0 3px;
                font-size: 14px;
                line-height: 1;
            }
            .del-btn:hover { color: #ff6b6b; }
            .add-form {
                margin-top: 6px;
                padding-top: 6px;
                border-top: 1px solid #444;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .add-form input,
            .add-form textarea {
                background: #2a2a2a;
                border: 1px solid #555;
                border-radius: 4px;
                color: #eee;
                font-family: inherit;
                font-size: 11px;
                padding: 4px 6px;
                resize: vertical;
            }
            .add-form button {
                background: #2a2a2a;
                border: 1px solid #555;
                border-radius: 4px;
                color: #cfd8ff;
                cursor: pointer;
                font-size: 11px;
                padding: 4px 6px;
            }
            .add-form button:hover { border-color: #7aa2ff; }
            .empty-note {
                margin-top: 4px;
                padding-top: 6px;
                border-top: 1px solid #444;
                font-size: 11px;
                color: #999;
            }
            .support-line {
                margin-top: 6px;
                padding-top: 6px;
                border-top: 1px solid #444;
                font-size: 11px;
                color: #999;
            }
            .support-line a {
                color: #7aa2ff;
                text-decoration: none;
            }
            .support-line a:hover {
                text-decoration: underline;
            }
            .share-line {
                margin-top: 6px;
                padding-top: 6px;
                border-top: 1px solid #444;
                font-size: 11px;
                color: #cfd8ff;
                cursor: pointer;
            }
            .share-line:hover {
                color: #7aa2ff;
            }
            .lang-list {
                display: flex;
                flex-direction: column;
                gap: 2px;
                max-height: 260px;
                overflow-y: auto;
            }
            .lang-item {
                padding: 6px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            }
            .lang-item:hover {
                background: rgba(255,255,255,0.08);
            }
            .lang-item.active {
                color: #7aa2ff;
                font-weight: 600;
            }
        `;

        panelDropdown = document.createElement('div');
        panelDropdown.className = 'dropdown';
        renderPanelContents();
        panelShadow.appendChild(panelStyle);
        panelShadow.appendChild(panelDropdown);
        document.body.appendChild(panelHostEl);

        // ---------- 3) ABRIR / CERRAR con retraso (evita cierres al mover el cursor) ----------
        let closeTimer = null;
        let pinned = false; // true tras un click, se mantiene abierto hasta click fuera
        let pickerOpen = false; // true mientras se muestra la lista de idiomas en vez de los prompts

        function openPanel() {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            positionPanel();
            panelHostEl.style.setProperty('display', 'block', 'important');
        }
        function scheduleClose() {
            if (pinned) return;
            if (closeTimer) clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                panelHostEl.style.setProperty('display', 'none', 'important');
            }, 300);
        }
        function cancelClose() {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        }

        // Abre el panel mostrando la lista de idiomas (cada uno en su propio
        // idioma) en vez de los checkboxes de prompts. Al elegir uno, se
        // vuelve automáticamente a la vista de prompts.
        openLanguagePicker = function () {
            pinned = true;
            cancelClose();
            openPanel();
            pickerOpen = true;
            renderLanguagePicker((code) => {
                setLang(code);
                if (langLabelEl) langLabelEl.textContent = currentLang;
                if (iconEl) iconEl.title = getUIStrings().title;
                pickerOpen = false;
                renderPanelContents();
                positionPanel();
                console.log('[SystemPrompt] Idioma cambiado a', currentLang);
            });
        };

        iconEl.addEventListener('mouseenter', () => { cancelClose(); openPanel(); });
        iconEl.addEventListener('mouseleave', scheduleClose);
        panelHostEl.addEventListener('mouseenter', cancelClose);
        panelHostEl.addEventListener('mouseleave', scheduleClose);

        iconEl.addEventListener('click', (e) => {
            e.stopPropagation();
            pinned = !pinned;
            if (pinned) {
                if (pickerOpen) {
                    pickerOpen = false;
                    renderPanelContents();
                }
                openPanel();
            } else {
                panelHostEl.style.setProperty('display', 'none', 'important');
            }
        });
        document.addEventListener('click', (e) => {
            if (pinned && !panelHostEl.contains(e.target) && e.target !== iconEl) {
                pinned = false;
                panelHostEl.style.setProperty('display', 'none', 'important');
            }
        });

        updateIconState();
        console.log('[SystemPrompt] Widget inyectado. Sitio detectado:', SITE, '- dirección de despliegue:', siteConfig.direction, '- idioma:', currentLang);

        function updateIconState() {
            const anySelected = getPrompts().some(p => isSelected(p.id));
            iconEl.classList.toggle('active', anySelected);
        }
    }

    // Reconstruye el contenido del panel (checkboxes, nota y línea de apoyo)
    // con los textos del idioma actualmente seleccionado. El estado marcado
    // de cada checkbox se conserva porque depende de "selectedIds" (los ids
    // son iguales en todos los idiomas), no del DOM.
    function renderPanelContents() {
        if (!panelDropdown) return;
        panelDropdown.innerHTML = '';
        checkboxEls = {};

        const prompts = getPrompts();
        const ui = getUIStrings();

        prompts.forEach(p => {
            const item = document.createElement('label');
            item.className = 'item';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = isSelected(p.id);
            cb.addEventListener('change', () => {
                toggleSelected(p.id, cb.checked);
                if (iconEl) {
                    const anySelected = getPrompts().some(pp => isSelected(pp.id));
                    iconEl.classList.toggle('active', anySelected);
                }
            });
            checkboxEls[p.id] = cb;

            const label = document.createElement('span');
            label.className = 'item-label';
            label.textContent = p.name;

            item.appendChild(cb);
            item.appendChild(label);

            // Los prompts personalizados (creados por el usuario, id "custom_...")
            // llevan un botón para borrarlos; los "de fábrica" no se pueden borrar.
            if (p.id.startsWith('custom_')) {
                const del = document.createElement('span');
                del.className = 'del-btn';
                del.textContent = '×';
                del.title = 'Eliminar este prompt';
                del.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteCustomPrompt(currentLang, p.id);
                    renderPanelContents();
                    positionPanel();
                });
                item.appendChild(del);
            }

            panelDropdown.appendChild(item);
        });

        // ---------- Formulario para añadir un prompt propio ----------
        // Se guarda en almacenamiento persistente (no en el código), así que
        // no se pierde si el script se actualiza más adelante.
        const addForm = document.createElement('div');
        addForm.className = 'add-form';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = ui.namePlaceholder;
        nameInput.maxLength = 60;

        const textInput = document.createElement('textarea');
        textInput.placeholder = ui.textPlaceholder;
        textInput.rows = 2;

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = ui.addButton;
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = nameInput.value.trim();
            const text = textInput.value.trim();
            if (!name || !text) return;
            addCustomPrompt(currentLang, name, text);
            renderPanelContents();
            positionPanel();
        });

        addForm.appendChild(nameInput);
        addForm.appendChild(textInput);
        addForm.appendChild(addBtn);
        panelDropdown.appendChild(addForm);

        const note = document.createElement('div');
        note.className = 'empty-note';
        note.textContent = ui.note;
        panelDropdown.appendChild(note);

        // ---------- Compartir (instalación fácil vía Greasy Fork) ----------
        const shareLine = document.createElement('div');
        shareLine.className = 'share-line';
        const shareIcon = document.createElement('span');
        shareIcon.textContent = '📤 ';
        const shareLabelSpan = document.createElement('span');
        shareLabelSpan.textContent = ui.shareLabel;
        shareLine.appendChild(shareIcon);
        shareLine.appendChild(shareLabelSpan);
        shareLine.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const uiNow = getUIStrings();
            if (navigator.share) {
                try {
                    await navigator.share({ title: 'SyssPrompt', text: uiNow.shareText, url: SITE_URL });
                    return;
                } catch (err) {
                    // El usuario canceló el selector nativo, o no hay soporte real: seguir al fallback
                }
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(SITE_URL);
                    const original = shareLabelSpan.textContent;
                    shareLabelSpan.textContent = uiNow.copiedLabel;
                    setTimeout(() => { shareLabelSpan.textContent = original; }, 1500);
                    return;
                } catch (err) {
                    // Sin permiso de portapapeles: último recurso, abrir la página
                }
            }
            window.open(SITE_URL, '_blank', 'noopener,noreferrer');
        });
        panelDropdown.appendChild(shareLine);

        // ---------- APOYO (opcional): borra este bloque si no lo quieres ----------
        const supportLine = document.createElement('div');
        supportLine.className = 'support-line';
        supportLine.append(SUPPORT_TEXT_PRE);
        const supportBookLink = document.createElement('a');
        supportBookLink.href = SUPPORT_URL;
        supportBookLink.target = '_blank';
        supportBookLink.rel = 'noopener noreferrer';
        supportBookLink.textContent = SUPPORT_TEXT_LINK;
        supportLine.appendChild(supportBookLink);
        supportLine.append(SUPPORT_TEXT_POST);
        panelDropdown.appendChild(supportLine);
        // ---------- fin bloque APOYO ----------
    }

    // Nombre de cada idioma escrito en sí mismo (para el desplegable de selección).
    const LANGUAGE_NATIVE_NAMES = {
        ES: 'Español',
        CA: 'Català',
        EU: 'Euskara',
        GL: 'Galego',
        EN: 'English',
        FR: 'Français',
        DE: 'Deutsch',
        IT: 'Italiano',
        PT: 'Português',
        RU: 'Русский',
        ZH: '中文',
        JA: '日本語',
        KA: 'ქართული',
    };

    // Sustituye el contenido del panel por la lista de idiomas disponibles
    // (cada uno escrito en su propio idioma). onPick(code) se llama al elegir uno.
    function renderLanguagePicker(onPick) {
        if (!panelDropdown) return;
        panelDropdown.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'lang-list';

        LANGUAGES.forEach((code) => {
            const item = document.createElement('div');
            item.className = 'lang-item' + (code === currentLang ? ' active' : '');
            item.textContent = LANGUAGE_NATIVE_NAMES[code] || code;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                onPick(code);
            });
            list.appendChild(item);
        });

        panelDropdown.appendChild(list);
    }

    // =========================================================
    // 5.5) POSICIONAR EL PANEL FLOTANTE, alineado a la derecha del icono
    // =========================================================
    // - direction 'down' (DeepSeek/ChatGPT): el panel cae justo debajo del icono.
    // - direction 'up' (Claude): el panel sube justo encima del icono, para que
    //   quepa en pantalla al estar el icono abajo del todo (junto al botón de enviar).
    // En ambos casos el orden de las opciones dentro del panel es el mismo
    // (de arriba a abajo), solo cambia el punto de anclaje vertical.
    function positionPanel() {
        if (!hostEl || !panelHostEl) return;
        const rect = hostEl.getBoundingClientRect();
        const gap = 6;
        const right = Math.max(4, window.innerWidth - rect.right);

        panelHostEl.style.setProperty('right', `${right}px`, 'important');
        panelHostEl.style.setProperty('left', 'auto', 'important');

        if (siteConfig.direction === 'up') {
            const bottom = Math.max(4, window.innerHeight - rect.top + gap);
            panelHostEl.style.setProperty('bottom', `${bottom}px`, 'important');
            panelHostEl.style.setProperty('top', 'auto', 'important');
        } else {
            const top = rect.bottom + gap;
            panelHostEl.style.setProperty('top', `${top}px`, 'important');
            panelHostEl.style.setProperty('bottom', 'auto', 'important');
        }
    }

    // =========================================================
    // 6) INSERTAR EL ICONO JUNTO AL BOTÓN ANCLA (en el propio DOM de la barra)
    // =========================================================
    // En vez de superponer un elemento con position:fixed (que puede quedar
    // tapado por elementos de la página con su propia capa de apilamiento),
    // insertamos el icono como un hermano más del botón ancla, dentro de
    // su mismo contenedor. Así hereda la misma visibilidad y alineación.
    // - DeepSeek/ChatGPT: ese contenedor es la barra superior (icono arriba).
    // - Claude: ese contenedor es la barra del composer (icono abajo).
    let attachedInline = false;

    function attachNextToAnchor() {
        // Claude: el icono se queda SIEMPRE en su posición fija (bottom/right),
        // nunca se inserta dentro del DOM de la página. Esto evita que la barra
        // del composer (que centra sus hijos) lo empuje hacia el centro.
        if (siteConfig.attachMode === 'fixed') return false;

        if (!hostEl) return false;
        const anchorBtn = findAnchorButton();
        if (!anchorBtn || !anchorBtn.parentElement) return false;

        // Si ya está correctamente colocado justo antes del botón ancla, no tocar nada
        if (hostEl.parentElement === anchorBtn.parentElement && hostEl.nextElementSibling === anchorBtn) {
            return true;
        }

        hostEl.style.setProperty('all', 'unset', 'important');
        hostEl.style.setProperty('position', 'static', 'important');
        hostEl.style.setProperty('display', 'inline-flex', 'important');
        hostEl.style.setProperty('align-items', 'center', 'important');
        hostEl.style.setProperty('margin-right', '6px', 'important');
        if (siteConfig.inlineOffsetY) {
            hostEl.style.setProperty('margin-top', `${siteConfig.inlineOffsetY}px`, 'important');
        }
        hostEl.style.setProperty('vertical-align', 'middle', 'important');
        hostEl.style.setProperty('z-index', '2147483647', 'important');

        anchorBtn.parentElement.insertBefore(hostEl, anchorBtn);
        console.log('[SystemPrompt] Icono insertado junto al botón ancla (', SITE, ').');
        return true;
    }

    function repositionWidget() {
        if (!hostEl) return;
        attachedInline = attachNextToAnchor();
        if (!attachedInline && siteConfig.attachMode !== 'fixed') {
            console.log('[SystemPrompt] Botón ancla no encontrado todavía; icono en posición de emergencia.');
        }
        if (panelHostEl && panelHostEl.style.display === 'block') {
            positionPanel();
        }
    }

    // Construir el widget y engancharlo junto al botón ancla en cuanto exista.
    // Seguimos comprobando indefinidamente (baja frecuencia) porque una SPA puede
    // re-renderizar esa barra y desenganchar nuestro nodo del DOM.
    const initInterval = setInterval(() => {
        try {
            if (document.documentElement) {
                buildWidget();
                repositionWidget();
                // Mientras no hayamos podido engancharlo junto al botón ancla (fallback fijo),
                // lo reinsertamos como último hijo de <body> para ganar cualquier empate
                // de z-index frente a overlays que la página añada después.
                if (!attachedInline && hostEl && hostEl.parentNode === document.body &&
                    hostEl.parentNode.lastElementChild !== hostEl) {
                    hostEl.parentNode.appendChild(hostEl);
                }
            }
        } catch (err) {
            console.error('[SystemPrompt] Error inicializando el widget:', err);
        }
    }, 1000);

    // También reposicionar en scroll/resize, por si el botón ancla se mueve
    window.addEventListener('resize', repositionWidget, true);
    window.addEventListener('scroll', repositionWidget, true);
})();