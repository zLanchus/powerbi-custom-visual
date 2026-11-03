"use strict";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

export function icon(paths: string[], className = "md-icon"): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", className);
    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

/** Ícones de traço (DESIGN.md), em caixa de 24 × 24. */
export const ICONS = {
    search: ["M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", "M20 20l-4.6-4.6"],
    expand: ["M4 5h16v14H4z", "M12 9v6", "M9 12h6"],
    collapse: ["M4 5h16v14H4z", "M9 12h6"],
    heat: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    delta: ["M12 5l8 14H4z"],
    focus: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
    download: ["M12 4v11", "M7 10.5l5 5 5-5", "M5 20h14"],
    chevron: ["M9 6l6 6-6 6"],
    clear: ["M7 7l10 10", "M17 7L7 17"],
    alert: ["M12 4l9 16H3z", "M12 10v4", "M12 17.2v.3"],
    info: ["M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", "M12 11v5.5", "M12 7.6v.3"],
    target: ["M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", "M12 7.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9z", "M12 11.6v.8"],
    ruler: ["M3 8h18v8H3z", "M7 8v3", "M11 8v4", "M15 8v3", "M19 8v4"],
    palette: ["M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.5-1.8c-.4-1.3.4-2.2 1.7-2.2H18a3 3 0 0 0 3-3c0-6-4-11-9-11z", "M7.5 11v.2", "M10 7.3v.2", "M15 7.8v.2"],
    scale: ["M12 4v16", "M5 8h14", "M5 8l-2.5 6a3 3 0 0 0 5 0z", "M19 8l-2.5 6a3 3 0 0 0 5 0z", "M8 20h8"],
    shield: ["M12 3l8 3v6c0 4.5-3.4 8-8 9c-4.6-1-8-4.5-8-9V6z", "M12 9v4", "M12 15.8v.3"]
};
