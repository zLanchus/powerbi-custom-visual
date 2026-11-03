"use strict";

import powerbi from "powerbi-visuals-api";

import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;

/** Cores padrão do repositório (ver DESIGN.md na raiz). */
export const PRIMARY = "#6CBEEB";
export const DARK = "#0F2B45";
export const PANEL = "#F1F8FD";
export const WHITE = "#FFFFFF";
export const MUTED = "#4E6175";

/**
 * Tons para marcas de dados (barras, linhas). A primária #6CBEEB tem contraste 2:1 com o branco;
 * para marcas o plano pede pelo menos 3:1, então o padrão é um azul da mesma família (3,1:1).
 */
export const DATA_BLUE = "#3E9BD1";
/** Destaque (acima da referência): laranja escuro, 5:1 com o branco e mais escuro que o azul. */
export const ACCENT = "#B5520F";

/**
 * Paleta das séries quando "cores do tema" está desligado: tons do padrão do repositório,
 * todos com contraste de pelo menos 3:1 com o branco.
 */
export const CHART_PALETTE = [
    "#3E9BD1", "#0F2B45", "#B5520F", "#2E6A99", "#5C7E99", "#1B4A73", "#4E6175", "#24384D"
];

/** Cores do modo de alto contraste (só as do sistema). */
export interface ContrastColors {
    on: boolean;
    foreground: string;
    background: string;
    selected: string;
    link: string;
}

export function contrastColors(palette: ISandboxExtendedColorPalette | undefined): ContrastColors {
    if (!palette?.isHighContrast) {
        return { on: false, foreground: DARK, background: WHITE, selected: DARK, link: DARK };
    }
    return {
        on: true,
        foreground: palette.foreground.value,
        background: palette.background.value,
        selected: palette.foregroundSelected.value,
        link: palette.hyperlink.value
    };
}

/** Cor do tema do relatório para uma chave (série). */
export function themeColor(palette: powerbi.extensibility.IColorPalette | undefined, key: string, fallback: string): string {
    try {
        return palette?.getColor(key)?.value || fallback;
    } catch {
        return fallback;
    }
}

export function hexToRgb(hex: string): [number, number, number] | undefined {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!m) {
        return undefined;
    }
    let h = m[1];
    if (h.length === 3) {
        h = h.split("").map(c => c + c).join("");
    }
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: number[]): string {
    return "#" + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Mistura `a` com `b` (t = 0 → a, t = 1 → b). Cores que não são hexadecimais voltam como `a`. */
export function mix(a: string, b: string, t: number): string {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    if (!x || !y) {
        return a;
    }
    return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Versão menos saturada e mais clara da cor (estado "abaixo" quando há séries). */
export function soften(color: string, amount = 0.55): string {
    const rgb = hexToRgb(color);
    if (!rgb) {
        return color;
    }
    const gray = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const desaturated = rgb.map(v => v + (gray - v) * amount);
    return mix(toHex(desaturated), WHITE, amount * 0.6);
}

export function luminance(color: string): number {
    const rgb = hexToRgb(color);
    if (!rgb) {
        return 0;
    }
    const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Texto legível (escuro ou branco) sobre um fundo. */
export function readableText(background: string, dark = DARK): string {
    return contrastRatio(background, dark) >= contrastRatio(background, WHITE) ? dark : WHITE;
}
