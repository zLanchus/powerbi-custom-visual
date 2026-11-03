"use strict";

import powerbi from "powerbi-visuals-api";

import DialogConstructorOptions = powerbi.extensibility.visual.DialogConstructorOptions;

/** O que o pop-up precisa para se desenhar (vai para o diálogo do Power BI como estado inicial). */
export interface PopupState {
    title: string;
    content: string;
    fontFamily: string;
    background: string;
    fontColor: string;
    accent: string;
    panel: string;
    fontSize: number;
    align: string;
    maxWidth: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    return node;
}

/** **negrito** e *itálico*, sem HTML (o texto nunca é interpretado como código). */
function appendInline(parent: HTMLElement, text: string): void {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
    for (const part of parts) {
        if (!part) {
            continue;
        }
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
            const strong = el("strong");
            strong.textContent = part.slice(2, -2);
            parent.appendChild(strong);
        } else if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
            const em = el("em");
            em.textContent = part.slice(1, -1);
            parent.appendChild(em);
        } else {
            parent.appendChild(document.createTextNode(part));
        }
    }
}

/** Linhas de um parágrafo: quebras simples viram <br>. */
function appendLines(parent: HTMLElement, lines: string[]): void {
    lines.forEach((line, i) => {
        if (i > 0) {
            parent.appendChild(el("br"));
        }
        appendInline(parent, line);
    });
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;

/**
 * Converte o texto em blocos: # título, ## subtítulo, - lista, 1. lista numerada,
 * > destaque, --- linha; linha em branco separa parágrafos.
 */
export function renderContent(target: HTMLElement, raw: string): void {
    // Aceita "\n" digitado literalmente (útil em caixas de texto de uma linha).
    const lines = raw.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").split("\n");
    let paragraph: string[] = [];
    let list: HTMLElement | undefined;
    let quote: string[] = [];

    const flushParagraph = (): void => {
        if (paragraph.length) {
            const p = el("p", "pe-p");
            appendLines(p, paragraph);
            target.appendChild(p);
            paragraph = [];
        }
        list = undefined;
    };
    const flushQuote = (): void => {
        if (quote.length) {
            const q = el("div", "pe-quote");
            appendLines(q, quote);
            target.appendChild(q);
            quote = [];
        }
    };
    const flush = (): void => {
        flushParagraph();
        flushQuote();
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            flush();
            continue;
        }
        const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (heading) {
            flush();
            const h = el(heading[1].length === 1 ? "h2" : "h3", heading[1].length === 1 ? "pe-h1" : "pe-h2");
            appendInline(h, heading[2]);
            target.appendChild(h);
            continue;
        }
        if (/^(-{3,}|_{3,})$/.test(trimmed)) {
            flush();
            target.appendChild(el("hr", "pe-hr"));
            continue;
        }
        if (trimmed.startsWith(">")) {
            flushParagraph();
            quote.push(trimmed.replace(/^>\s?/, ""));
            continue;
        }
        const bullet = BULLET.test(line);
        const numbered = !bullet && NUMBER.test(line);
        if (bullet || numbered) {
            const tag = bullet ? "ul" : "ol";
            if (!list || list.tagName.toLowerCase() !== tag) {
                flush();
                list = el(tag, "pe-list");
                target.appendChild(list);
            }
            const li = el("li");
            appendInline(li, line.replace(bullet ? BULLET : NUMBER, ""));
            list.appendChild(li);
            continue;
        }
        if (list) {
            // Linha sem marcador logo depois de um item continua o item.
            const last = list.lastElementChild as HTMLElement | null;
            if (last) {
                last.appendChild(el("br"));
                appendInline(last, trimmed);
                continue;
            }
        }
        flushQuote();
        paragraph.push(trimmed);
    }
    flush();
}

/** Monta o conteúdo do pop-up (no diálogo do Power BI ou dentro do próprio visual). */
export function renderPopup(target: HTMLElement, state: PopupState, showTitle: boolean): HTMLElement {
    const page = el("div", `pe-page pe-align-${state.align === "justify" ? "justify" : "left"}`);
    page.style.setProperty("--pe-bg", state.background);
    page.style.setProperty("--pe-fg", state.fontColor);
    page.style.setProperty("--pe-accent", state.accent);
    page.style.setProperty("--pe-panel", state.panel);
    // Cores e fonte também direto no elemento: o texto aparece mesmo se o estilo do visual não carregar.
    page.style.background = state.background;
    page.style.color = state.fontColor;
    page.style.fontFamily = state.fontFamily;
    page.style.fontSize = `${Math.max(8, state.fontSize)}px`;

    const body = el("div", "pe-body");
    if (state.maxWidth > 0) {
        body.style.maxWidth = `${state.maxWidth}px`;
    }
    if (showTitle && state.title) {
        const h = el("h1", "pe-title");
        h.textContent = state.title;
        body.appendChild(h);
    }
    renderContent(body, state.content);
    page.appendChild(body);
    target.replaceChildren(page);
    return page;
}

const DEFAULT_STATE: PopupState = {
    title: "",
    content: "",
    fontFamily: "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif",
    background: "#FFFFFF",
    fontColor: "#0F2B45",
    accent: "#6CBEEB",
    panel: "#F1F8FD",
    fontSize: 15,
    align: "left",
    maxWidth: 820
};

/** O estado chega do Power BI como objeto ou, em alguns ambientes, como texto JSON; campos ausentes usam o padrão. */
function toState(initialState: unknown): PopupState {
    let value = initialState;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            value = { content: value };
        }
    }
    const given = (value && typeof value === "object" ? value : {}) as Partial<PopupState>;
    const state = { ...DEFAULT_STATE };
    for (const key of Object.keys(DEFAULT_STATE) as Array<keyof PopupState>) {
        const v = given[key];
        if (typeof v === typeof DEFAULT_STATE[key]) {
            (state as Record<string, unknown>)[key] = v;
        }
    }
    return state;
}

/** Conteúdo do diálogo modal do Power BI (aberto por host.openModalDialog). */
export class PopupDialog {
    static id = "popupExplicativoF66C2BC2Dialog";

    constructor(options: DialogConstructorOptions, initialState: object) {
        const element = options.element;
        element.classList.add("pe-dialog");
        try {
            const state = toState(initialState);
            if (!state.content.trim()) {
                state.content = initialState === undefined || initialState === null
                    ? "> O pop-up abriu, mas o Power BI não entregou o texto a ele."
                    : "> O texto do pop-up está vazio. Preencha **Formatar visual → Pop-up → Texto** ou o campo **Texto do pop-up**.";
            }
            const page = renderPopup(element, state, false);
            // Ocupa a janela do diálogo inteira, com rolagem própria, qualquer que seja o tamanho do elemento recebido.
            Object.assign(page.style, {
                position: "fixed",
                top: "0",
                right: "0",
                bottom: "0",
                left: "0",
                overflow: "auto",
                boxSizing: "border-box",
                padding: "28px 32px 36px",
                lineHeight: "1.6"
            });
        } catch (e) {
            const message = document.createElement("pre");
            message.style.cssText = "margin:16px;white-space:pre-wrap;font:14px/1.5 Segoe UI,arial,sans-serif;color:#0F2B45";
            message.textContent = `Não foi possível montar o pop-up: ${String(e)}`;
            element.replaceChildren(message);
        }
    }
}

const registry = globalThis as unknown as { dialogRegistry?: Record<string, unknown> };
registry.dialogRegistry = registry.dialogRegistry || {};
registry.dialogRegistry[PopupDialog.id] = PopupDialog;
