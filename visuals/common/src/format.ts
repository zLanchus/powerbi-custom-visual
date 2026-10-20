"use strict";

import powerbi from "powerbi-visuals-api";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

import PrimitiveValue = powerbi.PrimitiveValue;

export type Formatter = (value: PrimitiveValue) => string;

/** Cria formatadores a partir da string de formato da medida (o visual nunca assume percentual). */
export type FormatterFactory = (format: string | undefined, sample?: number) => Formatter;

/** Formatadores com o idioma do relatório. `sample` define a unidade automática (mil, mi) dos eixos. */
export function createFormatterFactory(locale: string): FormatterFactory {
    return (format, sample) => {
        const f = valueFormatter.create({ format, cultureSelector: locale, value: sample });
        return v => (v === null || v === undefined || v === "") ? "" : f.format(v);
    };
}

/** Texto de um valor de agrupamento (categoria, série). */
export function labelOf(value: PrimitiveValue | undefined, format: string | undefined, locale: string, blank: string): string {
    if (value === null || value === undefined || value === "") {
        return blank;
    }
    if (format || value instanceof Date) {
        return valueFormatter.format(value, format, false, locale);
    }
    return String(value);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Largura aproximada de um texto, para decidir se cabe. */
export function textWidth(text: string, size: number, family: string, bold = false): number {
    if (measureCtx === undefined) {
        measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    }
    if (!measureCtx) {
        return text.length * size * 0.56;
    }
    measureCtx.font = `${bold ? "600 " : ""}${size}px ${family}`;
    return measureCtx.measureText(text).width;
}

/** Corta o texto com reticências para caber em `max` px. */
export function truncate(text: string, max: number, size: number, family: string, bold = false): string {
    if (textWidth(text, size, family, bold) <= max) {
        return text;
    }
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (textWidth(text.slice(0, mid) + "…", size, family, bold) <= max) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo > 0 ? text.slice(0, lo) + "…" : "…";
}
