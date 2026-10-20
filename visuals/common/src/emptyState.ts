"use strict";

import { el } from "./dom";

/**
 * Estado vazio: em vez de uma área em branco, mostra quais campos faltam.
 * Estilos em common/style/common.less (.cv-empty).
 */
export function renderEmptyState(container: HTMLElement, title: string, text: string, missing: string[]): HTMLElement {
    const box = el("div", "cv-empty");
    box.setAttribute("role", "status");
    box.appendChild(el("div", "cv-empty-title", title));
    box.appendChild(el("div", "cv-empty-text", text));
    if (missing.length) {
        const list = el("ul", "cv-empty-list");
        for (const field of missing) {
            list.appendChild(el("li", "cv-empty-field", field));
        }
        box.appendChild(list);
    }
    container.appendChild(box);
    return box;
}
