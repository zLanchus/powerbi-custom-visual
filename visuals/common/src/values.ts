"use strict";

// Funções puras sobre valores do dataView (sem DOM e sem o host: usadas também nos testes).

import powerbi from "powerbi-visuals-api";

import PrimitiveValue = powerbi.PrimitiveValue;

/** Número de uma célula do dataView. Vazio (ou não numérico) é null, nunca zero. */
export function toNumber(value: PrimitiveValue | undefined): number | null {
    if (typeof value === "number") {
        return isFinite(value) ? value : null;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    return null;
}

/** Lê "3;6;12;18" (aceita vírgula decimal) como lista de números. */
export function parseNumberList(text: string): number[] {
    return (text || "").split(";")
        .map(part => part.trim().replace(",", "."))
        .filter(part => part !== "")
        .map(Number)
        .filter(n => isFinite(n));
}

/** Número digitado no painel; vazio = automático (null). */
export function parseOptionalNumber(text: string | undefined): number | null {
    const t = (text || "").trim().replace(",", ".");
    if (t === "") {
        return null;
    }
    const n = Number(t);
    return isFinite(n) ? n : null;
}

/**
 * Baixa confiança: Confiança < Limiar. Confiança vazia = ponto normal (nunca baixa confiança).
 * O limiar vem do campo (prioridade) ou da constante do painel.
 */
export function isLowConfidence(confidence: number | null, fieldThreshold: number | null, constantThreshold: number | null): boolean {
    if (confidence === null) {
        return false;
    }
    const threshold = fieldThreshold !== null ? fieldThreshold : constantThreshold;
    return threshold !== null && confidence < threshold;
}

/** Todos os números da lista (ignorando vazios) são iguais. */
export function allEqual(values: Array<number | null>, epsilon = 1e-12): boolean {
    let first: number | null = null;
    for (const v of values) {
        if (v === null) {
            continue;
        }
        if (first === null) {
            first = v;
        } else if (Math.abs(v - first) > epsilon * Math.max(1, Math.abs(first))) {
            return false;
        }
    }
    return true;
}

/** Domínio do eixo de valores: inclui zero quando pedido; nunca vazio nem degenerado. */
export function valueDomain(values: Array<number | null>, includeZero: boolean, fixedMin: number | null = null, fixedMax: number | null = null): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
        if (v !== null && isFinite(v)) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
        }
    }
    if (lo === Infinity) {
        lo = 0;
        hi = 1;
    }
    if (includeZero) {
        lo = Math.min(lo, 0);
        hi = Math.max(hi, 0);
    }
    if (fixedMin !== null) {
        lo = fixedMin;
    }
    if (fixedMax !== null) {
        hi = fixedMax;
    }
    if (hi <= lo) {
        const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
        if (fixedMax === null) {
            hi = lo + pad;
        } else {
            lo = hi - pad;
        }
    }
    return [lo, hi];
}

/** Coluna do dataView com o papel pedido (ou undefined). */
export function byRole<T extends { source: powerbi.DataViewMetadataColumn }>(columns: ArrayLike<T> | undefined, role: string): T | undefined {
    if (!columns) {
        return undefined;
    }
    for (let i = 0; i < columns.length; i++) {
        if (columns[i].source.roles?.[role]) {
            return columns[i];
        }
    }
    return undefined;
}

/** Todas as colunas com o papel pedido. */
export function allByRole<T extends { source: powerbi.DataViewMetadataColumn }>(columns: ArrayLike<T> | undefined, role: string): T[] {
    const out: T[] = [];
    if (columns) {
        for (let i = 0; i < columns.length; i++) {
            if (columns[i].source.roles?.[role]) {
                out.push(columns[i]);
            }
        }
    }
    return out;
}
