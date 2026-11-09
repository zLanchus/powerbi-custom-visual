"use strict";

/**
 * Interpretador de Markdown do pop-up (subconjunto amplo do CommonMark + GitHub).
 *
 * Monta o DOM direto, sem innerHTML: o texto nunca é interpretado como HTML/código,
 * só como a marcação abaixo.
 *
 * Blocos: títulos (# a ######, e "Título" + "===" na linha de baixo), parágrafos,
 * listas com marcadores (-, *, +, •), numeradas (1. ou 1)), aninhadas por recuo e de
 * tarefas (- [ ] / - [x]), citações (>) aninhadas e com blocos dentro, avisos do GitHub
 * (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]), blocos de código (``` ou ~~~),
 * tabelas (| a | b | com linha |---|:---:|), linha divisória (---, ***, ___).
 *
 * No texto: **negrito**, __negrito__, *itálico*, _itálico_, ***os dois***, ~~riscado~~,
 * ==marcado==, `código`, [link](https://...), ![imagem](https://... ou data:image/...),
 * <https://...>, endereços soltos (https://...), <br>, <u>, <sub>, <sup>, <kbd> (e outras marcas
 * simples), \ para escapar caracteres e
 * quebra de linha simples (Enter) = nova linha.
 */

export interface MarkdownOptions {
    /** Abre um link (no visual, pelo host do Power BI). Sem ele, o link abre em nova aba. */
    onLink?: (url: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    return node;
}

// ---------------------------------------------------------------------------
// Texto (inline)
// ---------------------------------------------------------------------------

const PUNCT = /[!-/:-@[-`{-~]/;
const ALNUM = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

function isSafeUrl(url: string): boolean {
    return /^(https?:|mailto:)/i.test(url);
}

function isSafeImage(url: string): boolean {
    return /^https?:/i.test(url) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(url);
}

/** Posição do "]" que fecha o "[" em `start` (respeitando colchetes internos, escapes e código). */
function closingBracket(text: string, start: number): number {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") {
            i++;
        } else if (c === "`") {
            const end = closingCode(text, i);
            if (end > 0) {
                i = end - 1;
            }
        } else if (c === "[") {
            depth++;
        } else if (c === "]") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/** Fim (exclusivo) do trecho `código` que começa em `start`, ou -1. */
function closingCode(text: string, start: number): number {
    let n = 0;
    while (text[start + n] === "`") {
        n++;
    }
    let i = start + n;
    while (i < text.length) {
        const j = text.indexOf("`", i);
        if (j < 0) {
            return -1;
        }
        let m = 0;
        while (text[j + m] === "`") {
            m++;
        }
        if (m === n) {
            return j + m;
        }
        i = j + m;
    }
    return -1;
}

/** Destino de link logo após "](": `(url "título")`. Devolve url, título e o fim. */
function linkTarget(text: string, open: number): { url: string; title: string; end: number } | undefined {
    if (text[open] !== "(") {
        return undefined;
    }
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") {
            i++;
        } else if (c === "(") {
            depth++;
        } else if (c === ")") {
            depth--;
            if (depth === 0) {
                const inner = text.slice(open + 1, i).trim();
                const m = /^<?([^\s>]*)>?(?:\s+["'(](.*)["')])?$/.exec(inner);
                if (!m) {
                    return undefined;
                }
                return { url: m[1].replace(/\\(.)/g, "$1"), title: m[2] || "", end: i + 1 };
            }
        }
    }
    return undefined;
}

/** Procura o fechamento de um delimitador (`run` = sequência exata, ex.: "**"). */
function closingDelim(text: string, from: number, run: string): number {
    const c = run[0];
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\\") {
            i++;
            continue;
        }
        if (ch === "`") {
            const end = closingCode(text, i);
            if (end > 0) {
                i = end - 1;
            }
            continue;
        }
        if (ch !== c) {
            continue;
        }
        let n = 0;
        while (text[i + n] === c) {
            n++;
        }
        const before = text[i - 1] ?? " ";
        const after = text[i + n] ?? " ";
        const exact = n === run.length || (n > run.length && (c === "~" || c === "="));
        if (exact && i > from && !SPACE.test(before) && !(c === "_" && ALNUM.test(after))) {
            return i;
        }
        i += n - 1;
    }
    return -1;
}

function link(parent: HTMLElement, url: string, title: string, opts: MarkdownOptions): HTMLElement {
    if (!isSafeUrl(url)) {
        const span = el("span");
        parent.appendChild(span);
        return span;
    }
    const a = el("a", "pe-link");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = title || url;
    a.addEventListener("click", (e) => {
        if (opts.onLink && /^https?:/i.test(url)) {
            e.preventDefault();
            e.stopPropagation();
            opts.onLink(url);
        }
    });
    parent.appendChild(a);
    return a;
}

/** Interpreta a marcação de texto de `text` e acrescenta o resultado em `parent`. */
export function renderInline(parent: HTMLElement, text: string, opts: MarkdownOptions = {}): void {
    let buffer = "";
    const flush = (): void => {
        if (buffer) {
            parent.appendChild(document.createTextNode(buffer));
            buffer = "";
        }
    };
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        const rest = text.slice(i);

        // Escape: \* vira um * literal.
        if (c === "\\" && i + 1 < text.length && PUNCT.test(text[i + 1])) {
            buffer += text[i + 1];
            i += 2;
            continue;
        }

        // `código`
        if (c === "`") {
            const end = closingCode(text, i);
            let n = 0;
            while (text[i + n] === "`") {
                n++;
            }
            if (end > 0) {
                flush();
                let code = text.slice(i + n, end - n);
                if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
                    code = code.slice(1, -1);
                }
                const node = el("code", "pe-code");
                node.textContent = code;
                parent.appendChild(node);
                i = end;
            } else {
                buffer += text.slice(i, i + n);
                i += n;
            }
            continue;
        }

        // ![imagem](url) e [link](url)
        if (c === "[" || (c === "!" && text[i + 1] === "[")) {
            const image = c === "!";
            const open = image ? i + 1 : i;
            const close = closingBracket(text, open);
            const target = close > 0 ? linkTarget(text, close + 1) : undefined;
            if (target) {
                flush();
                const label = text.slice(open + 1, close);
                if (image) {
                    if (isSafeImage(target.url)) {
                        const img = el("img", "pe-img");
                        img.src = target.url;
                        img.alt = label;
                        if (target.title) {
                            img.title = target.title;
                        }
                        parent.appendChild(img);
                    } else {
                        buffer += label;
                    }
                } else {
                    renderInline(link(parent, target.url, target.title, opts), label, opts);
                }
                i = target.end;
                continue;
            }
        }

        // <https://...>, <email@x.com>, <br>
        if (c === "<") {
            const br = /^<br\s*\/?>/i.exec(rest);
            if (br) {
                flush();
                parent.appendChild(el("br"));
                i += br[0].length;
                continue;
            }
            // Algumas marcas HTML simples (criadas como elementos, nunca como HTML).
            const tag = /^<(b|strong|i|em|u|s|del|mark|sub|sup|small|kbd)>/i.exec(rest);
            if (tag) {
                const name = tag[1].toLowerCase();
                const close = rest.toLowerCase().indexOf(`</${name}>`, tag[0].length);
                if (close > tag[0].length) {
                    flush();
                    const node = el(name as "b", name === "mark" ? "pe-mark" : name === "kbd" ? "pe-kbd" : undefined);
                    renderInline(node, rest.slice(tag[0].length, close), opts);
                    parent.appendChild(node);
                    i += close + name.length + 3;
                    continue;
                }
            }
            const auto = /^<((?:https?:|mailto:)[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/i.exec(rest);
            if (auto) {
                flush();
                const url = auto[1].includes(":") ? auto[1] : `mailto:${auto[1]}`;
                link(parent, url, "", opts).textContent = auto[1];
                i += auto[0].length;
                continue;
            }
        }

        // Endereço solto: https://... ou www....
        if ((c === "h" || c === "w") && !ALNUM.test(text[i - 1] ?? " ")) {
            const m = /^(?:https?:\/\/|www\.)[^\s<]+/i.exec(rest);
            if (m) {
                let url = m[0];
                // Pontuação final não faz parte do endereço; ")" só se estiver sobrando.
                for (;;) {
                    const last = url[url.length - 1];
                    if (/[.,;:!?*_~'"]/.test(last)) {
                        url = url.slice(0, -1);
                    } else if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
                        url = url.slice(0, -1);
                    } else {
                        break;
                    }
                }
                flush();
                link(parent, url.startsWith("www.") ? `https://${url}` : url, "", opts).textContent = url;
                i += url.length;
                continue;
            }
        }

        // **negrito**, *itálico*, ***os dois***, __negrito__, _itálico_, ~~riscado~~, ==marcado==
        if (c === "*" || c === "_" || c === "~" || c === "=") {
            let n = 0;
            while (text[i + n] === c) {
                n++;
            }
            const after = text[i + n] ?? " ";
            const before = text[i - 1] ?? " ";
            const canOpen = !SPACE.test(after) && !(c === "_" && ALNUM.test(before));
            const sizes = c === "~" || c === "=" ? (n >= 2 ? [2] : []) : [Math.min(n, 3), 2, 1].filter((s, k, a) => s <= n && a.indexOf(s) === k);
            let done = false;
            if (canOpen) {
                for (const size of sizes) {
                    const run = c.repeat(size);
                    const start = i + size;
                    const end = closingDelim(text, start, run);
                    if (end > start) {
                        flush();
                        const inner = text.slice(start, end);
                        let node: HTMLElement;
                        let inside: HTMLElement;
                        if (c === "~") {
                            node = inside = el("del");
                        } else if (c === "=") {
                            node = inside = el("mark", "pe-mark");
                        } else if (size === 3) {
                            node = el("strong");
                            inside = node.appendChild(el("em"));
                        } else {
                            node = inside = el(size === 2 ? "strong" : "em");
                        }
                        renderInline(inside, inner, opts);
                        parent.appendChild(node);
                        i = end + size;
                        done = true;
                        break;
                    }
                }
            }
            if (!done) {
                buffer += text.slice(i, i + n);
                i += n;
            }
            continue;
        }

        buffer += c;
        i++;
    }
    flush();
}

/** Linhas de um parágrafo: cada Enter vira uma quebra de linha (também "  " ou "\" no fim). */
function renderLines(parent: HTMLElement, lines: string[], opts: MarkdownOptions): void {
    lines.forEach((line, k) => {
        if (k > 0) {
            parent.appendChild(el("br"));
        }
        const text = line.replace(/\s+$/, "").replace(/\\$/, "");
        renderInline(parent, text, opts);
    });
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( *)([-*+•]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/;
const SETEXT = /^ {0,3}=+[ \t]*$/;
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const ALERTS: Record<string, string> = {
    NOTE: "Observação",
    TIP: "Dica",
    IMPORTANT: "Importante",
    WARNING: "Atenção",
    CAUTION: "Cuidado"
};

const ALERT_ICONS: Record<string, string> = {
    NOTE: "M12 16v-5M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    TIP: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
    IMPORTANT: "M4 4h16v12H8l-4 4zM12 7v4M12 13.5h.01",
    WARNING: "M12 3 2 20h20zM12 10v4M12 17h.01",
    CAUTION: "M8 3h8l5 5v8l-5 5H8l-5-5V8zM12 8v5M12 16h.01"
};

function indentOf(line: string): number {
    return line.length - line.trimStart().length;
}

function isTableRow(line: string): boolean {
    return line.includes("|") && line.trim() !== "";
}

function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith("|")) {
        s = s.slice(1);
    }
    if (s.endsWith("|") && !s.endsWith("\\|")) {
        s = s.slice(0, -1);
    }
    const cells: string[] = [];
    let cur = "";
    let inCode = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "\\" && s[i + 1] === "|") {
            cur += "|";
            i++;
        } else if (ch === "`") {
            inCode = !inCode;
            cur += ch;
        } else if (ch === "|" && !inCode) {
            cells.push(cur.trim());
            cur = "";
        } else {
            cur += ch;
        }
    }
    cells.push(cur.trim());
    return cells;
}

/** A linha começa um bloco que interrompe um parágrafo? */
function startsBlock(line: string, next: string | undefined): boolean {
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)
        || !!ITEM.exec(line)?.[4]?.trim()
        || (isTableRow(line) && next !== undefined && TABLE_SEP.test(next) && next.includes("-"));
}

function renderBlocks(target: HTMLElement, lines: string[], opts: MarkdownOptions, depth: number): void {
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i++;
            continue;
        }

        // Bloco de código ``` ... ```
        const fence = FENCE.exec(line);
        if (fence) {
            const mark = fence[1];
            const pad = indentOf(line);
            const code: string[] = [];
            i++;
            while (i < lines.length) {
                const t = lines[i].trim();
                if (t.length >= mark.length && t[0] === mark[0] && /^([`~])\1*$/.test(t)) {
                    i++;
                    break;
                }
                code.push(lines[i].slice(Math.min(pad, indentOf(lines[i]))));
                i++;
            }
            const pre = el("pre", "pe-pre");
            const node = el("code");
            if (fence[2]) {
                node.className = `language-${fence[2]}`;
            }
            node.textContent = code.join("\n");
            pre.appendChild(node);
            target.appendChild(pre);
            continue;
        }

        // # Título
        const heading = HEADING.exec(line);
        if (heading) {
            appendHeading(target, heading[1].length, heading[2] || "", opts);
            i++;
            continue;
        }

        // --- linha divisória
        if (RULE.test(line)) {
            target.appendChild(el("hr", "pe-hr"));
            i++;
            continue;
        }

        // > citação (aceita tudo dentro, inclusive outra citação)
        if (QUOTE.test(line)) {
            const inner: string[] = [];
            while (i < lines.length) {
                const l = lines[i];
                if (QUOTE.test(l)) {
                    inner.push(l.replace(/^ {0,3}> ?/, ""));
                } else if (l.trim() && inner.length && inner[inner.length - 1].trim() && !startsBlock(l, lines[i + 1])) {
                    inner.push(l); // continuação "preguiçosa" de um parágrafo da citação
                } else {
                    break;
                }
                i++;
            }
            appendQuote(target, inner, opts, depth);
            continue;
        }

        // Tabela
        if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
            const header = splitRow(line);
            const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && isTableRow(lines[i]) && !startsBlockExceptTable(lines[i])) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            appendTable(target, header, aligns, rows, opts);
            continue;
        }

        // Listas
        const item = ITEM.exec(line);
        if (item) {
            i = appendList(target, lines, i, opts, depth);
            continue;
        }

        // Parágrafo (Enter = nova linha); "Título" seguido de "===" vira título.
        const para: string[] = [];
        while (i < lines.length && lines[i].trim()) {
            if (para.length && startsBlock(lines[i], lines[i + 1])) {
                break;
            }
            if (para.length && SETEXT.test(lines[i])) {
                break;
            }
            para.push(lines[i].trim());
            i++;
        }
        if (i < lines.length && SETEXT.test(lines[i]) && para.length) {
            const title = para.pop() as string;
            if (para.length) {
                appendParagraph(target, para, opts);
            }
            appendHeading(target, 1, title, opts);
            i++;
            continue;
        }
        appendParagraph(target, para, opts);
    }
}

function startsBlockExceptTable(line: string): boolean {
    return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line);
}

function appendParagraph(target: HTMLElement, lines: string[], opts: MarkdownOptions): void {
    const p = el("p", "pe-p");
    renderLines(p, lines, opts);
    target.appendChild(p);
}

function appendHeading(target: HTMLElement, level: number, text: string, opts: MarkdownOptions): void {
    // O título do pop-up é o <h1>; "#" do texto vira <h2>, e assim por diante.
    const tag = `h${Math.min(6, level + 1)}` as "h2";
    const h = el(tag, `pe-h${Math.min(level, 4)}`);
    renderInline(h, text.trim(), opts);
    target.appendChild(h);
}

function appendQuote(target: HTMLElement, inner: string[], opts: MarkdownOptions, depth: number): void {
    const alert = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(inner[0] ?? "");
    const box = el("div", "pe-quote");
    if (alert) {
        const kind = alert[1].toUpperCase();
        box.classList.add("pe-alert", `pe-alert-${kind.toLowerCase()}`);
        const title = el("div", "pe-alert-title");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "pe-alert-icon");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", ALERT_ICONS[kind]);
        svg.appendChild(path);
        title.append(svg, document.createTextNode(ALERTS[kind]));
        box.appendChild(title);
        inner = inner.slice(1);
    }
    if (depth < 8) {
        renderBlocks(box, inner, opts, depth + 1);
    } else {
        renderLines(box, inner, opts);
    }
    target.appendChild(box);
}

function appendTable(target: HTMLElement, header: string[], aligns: string[], rows: string[][], opts: MarkdownOptions): void {
    const wrap = el("div", "pe-table-wrap");
    const table = el("table", "pe-table");
    const cell = (tag: "th" | "td", text: string, k: number): HTMLElement => {
        const c = el(tag);
        if (aligns[k]) {
            c.style.textAlign = aligns[k];
        }
        renderInline(c, text, opts);
        return c;
    };
    const thead = el("thead");
    const htr = el("tr");
    header.forEach((h, k) => htr.appendChild(cell("th", h, k)));
    thead.appendChild(htr);
    table.appendChild(thead);
    if (rows.length) {
        const tbody = el("tbody");
        for (const row of rows) {
            const tr = el("tr");
            header.forEach((_, k) => tr.appendChild(cell("td", row[k] ?? "", k)));
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
    }
    wrap.appendChild(table);
    target.appendChild(wrap);
}

/** Lista a partir da linha `start`; devolve a linha seguinte ao fim da lista. */
function appendList(target: HTMLElement, lines: string[], start: number, opts: MarkdownOptions, depth: number): number {
    const first = ITEM.exec(lines[start]) as RegExpExecArray;
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const list = el(ordered ? "ol" : "ul", "pe-list");
    if (ordered) {
        const n = parseInt(first[2], 10);
        if (n !== 1) {
            (list as HTMLOListElement).start = n;
        }
    }
    const items: string[][] = [];
    let loose = false;
    let i = start;
    while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (!m || m[1].length > base + 1 || /\d/.test(m[2]) !== ordered || (i > start && m[1].length < base)) {
            break;
        }
        const spaces = (m[3] || " ").length;
        const offset = m[1].length + m[2].length + (spaces > 4 ? 1 : spaces);
        const body = [m[4] ?? ""];
        i++;
        while (i < lines.length) {
            const l = lines[i];
            if (!l.trim()) {
                // Linha em branco: a lista continua se o que vem depois estiver recuado ou for outro item.
                let j = i;
                while (j < lines.length && !lines[j].trim()) {
                    j++;
                }
                if (j < lines.length && indentOf(lines[j]) > base) {
                    for (; i < j; i++) {
                        body.push("");
                    }
                    continue;
                }
                const nextItem = j < lines.length ? ITEM.exec(lines[j]) : null;
                if (nextItem && nextItem[1].length <= base + 1 && nextItem[1].length >= base && /\d/.test(nextItem[2]) === ordered) {
                    loose = true;
                }
                break;
            }
            const ind = indentOf(l);
            if (ind > base) {
                body.push(l.slice(Math.min(ind, offset)));
            } else if (ITEM.test(l) || startsBlock(l, lines[i + 1])) {
                break;
            } else {
                body.push(l.trim()); // linha sem marcador logo depois do item continua o item
            }
            i++;
        }
        items.push(body);
        if (i < lines.length && !lines[i].trim()) {
            // Pula as linhas em branco entre itens.
            let j = i;
            while (j < lines.length && !lines[j].trim()) {
                j++;
            }
            const nextItem = j < lines.length ? ITEM.exec(lines[j]) : null;
            if (nextItem && nextItem[1].length <= base + 1 && nextItem[1].length >= base && /\d/.test(nextItem[2]) === ordered) {
                i = j;
                continue;
            }
            break;
        }
    }

    for (const body of items) {
        const li = el("li");
        const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
        if (task) {
            body[0] = body[0].slice(task[0].length);
            li.classList.add("pe-task");
            const box = el("span", `pe-check${task[1] === " " ? "" : " pe-checked"}`);
            box.setAttribute("role", "checkbox");
            box.setAttribute("aria-checked", task[1] === " " ? "false" : "true");
            li.appendChild(box);
            list.classList.add("pe-task-list");
        }
        if (body.some((l, k) => k > 0 && l.trim() === "")) {
            loose = true;
        }
        const holder = el("div", "pe-li");
        if (depth < 8) {
            renderBlocks(holder, body, opts, depth + 1);
        } else {
            renderLines(holder, body, opts);
        }
        li.appendChild(holder);
        list.appendChild(li);
    }
    if (!loose) {
        list.classList.add("pe-tight");
    }
    target.appendChild(list);
    return i;
}

/** Converte o texto em Markdown e acrescenta os blocos em `target`. */
export function renderMarkdown(target: HTMLElement, raw: string, opts: MarkdownOptions = {}): void {
    // Aceita "\n" digitado literalmente (útil em caixas de texto de uma linha); "\\n" fica "\n".
    const text = raw.replace(/\r\n?/g, "\n")
        .replace(/\\\\n|\\n/g, (m) => (m === "\\n" ? "\n" : "\\n"))
        .replace(/\t/g, "    ");
    renderBlocks(target, text.split("\n"), opts, 0);
}
