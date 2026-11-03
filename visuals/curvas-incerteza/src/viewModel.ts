"use strict";

// dataView -> modelo de visualização. Função pura (sem DOM e sem host), coberta pelos testes em test/.
// Toda regra de negócio genérica mora aqui: ordenação do eixo, separação de séries, trechos de
// baixa confiança, faixa de intervalo, janelas destacadas, marcos e referência.

import powerbi from "powerbi-visuals-api";

import { allByRole, allEqual, byRole, isLowConfidence, toNumber, valueDomain } from "../../common/src/values";

import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup;
import ISelectionId = powerbi.visuals.ISelectionId;
import PrimitiveValue = powerbi.PrimitiveValue;

/** Limites declarados na redução de dados (capabilities pede um a mais para detectar o excesso). */
export const MAX_POINTS = 1000;
export const MAX_SERIES = 30;

export type AxisKind = "number" | "date" | "text";
export type Interpolation = "stepAfter" | "linear" | "smooth";
export type LineStyle = "solid" | "dashed" | "dotted";

export interface CurvesSettings {
    /** "auto" = degrau após o ponto quando o eixo é numérico inteiro; reta nos demais. */
    interpolation: Interpolation | "auto";
    /** Limiar constante do painel (o campo Limiar tem prioridade). */
    threshold: number | null;
    /** Referência constante (o campo Referência tem prioridade). null = sem constante. */
    referenceConstant: number | null;
    /** Máximo de séries visíveis; as excedentes ficam ocultas. */
    maxSeries: number;
    windows: { source: "field" | "fixed"; start: number | null; end: number | null };
    /** Valores de X dos marcos, como digitados no painel ("3;6;12;18"). */
    milestones: string[];
    y: { startAtZero: boolean; min: number | null; max: number | null };
    x: { min: number | null; max: number | null };
}

type Format = (value: PrimitiveValue) => string;

/** O que o modelo precisa do host. Nos testes, são funções simples. */
export interface CurvesDeps {
    format(format: string | undefined, sample?: number): Format;
    label(value: PrimitiveValue, format: string | undefined): string;
    pointId(index: number, group: DataViewValueColumnGroup | undefined): ISelectionId;
    seriesId(group: DataViewValueColumnGroup): ISelectionId;
    seriesColor(group: DataViewValueColumnGroup | undefined, index: number, name: string): string;
    seriesStyle(group: DataViewValueColumnGroup | undefined): LineStyle;
}

export interface TooltipValue {
    name: string;
    value: string;
}

export interface Point {
    /** Posição no eixo ordenado (0..n-1). */
    i: number;
    /** Posição em X: o número, a data em ms ou o índice (texto). */
    x: number;
    value: number | null;
    lower: number | null;
    upper: number | null;
    confidence: number | null;
    threshold: number | null;
    low: boolean;
    mark: boolean;
    /** Destaque de filtro cruzado (supportsHighlight). */
    highlighted: boolean;
    id: ISelectionId;
    tooltips: TooltipValue[];
}

/** Trecho contínuo da curva com um único estado de confiança. */
export interface Segment {
    low: boolean;
    points: Point[];
}

export interface Curve {
    key: string;
    name: string;
    color: string;
    style: LineStyle;
    id: ISelectionId | undefined;
    selector: powerbi.data.Selector | undefined;
    /** Um ponto por posição do eixo (valor null quando vazio). */
    points: Point[];
    segments: Segment[];
    /** Trechos da faixa (pontos com os dois limites preenchidos). */
    bands: Point[][];
    last: Point | undefined;
}

export interface Milestone {
    x: number;
    label: string;
    /** Valor de cada curva visível no marco (null se a curva não chega lá). */
    values: Array<number | null>;
}

export interface CurvesModel {
    axis: {
        kind: AxisKind;
        integer: boolean;
        name: string;
        format: string | undefined;
        /** Posições de X em ordem crescente (número, ms ou índice). */
        xs: number[];
        labels: string[];
        domain: [number, number];
    };
    interpolation: Interpolation;
    curves: Curve[];
    hiddenCount: number;
    hasSeries: boolean;
    names: {
        series: string;
        value: string;
        lower: string | null;
        upper: string | null;
        confidence: string | null;
        reference: string | null;
        highlight: string | null;
        marks: string | null;
    };
    formats: { value: Format; confidence: Format; reference: Format; valueFormat: string | undefined };
    /** Janelas destacadas, em posições de X (do primeiro ao último X da sequência). */
    windows: Array<{ start: number; end: number }>;
    reference: {
        present: boolean;
        uniform: boolean;
        value: number | null;
        points: Array<{ x: number; value: number }>;
    };
    milestones: Milestone[];
    yDomain: [number, number];
    hasBand: boolean;
    hasLow: boolean;
    hasMarks: boolean;
    hasHighlights: boolean;
    /** Havia X repetido: o visual não soma, usa o primeiro e avisa. */
    duplicates: boolean;
    truncated: { points: boolean; series: boolean };
}

export interface CurvesResult {
    model?: CurvesModel;
    /** Papéis obrigatórios que faltam ("x", "value"). */
    missing: string[];
}

const cell = (column: DataViewValueColumn | undefined, i: number): number | null =>
    column ? toNumber(column.values[i]) : null;

/**
 * Divide a curva em trechos. Valor vazio interrompe a curva; o trecho entre os pontos i e i+1
 * herda o estado do ponto i+1, e trechos vizinhos compartilham o ponto da emenda (sem lacuna).
 */
export function splitSegments(points: Point[]): Segment[] {
    const segments: Segment[] = [];
    let run: Point[] = [];
    const flush = (): void => {
        if (run.length === 1) {
            segments.push({ low: run[0].low, points: run });
        } else if (run.length > 1) {
            let current: Segment = { low: run[1].low, points: [run[0], run[1]] };
            for (let k = 2; k < run.length; k++) {
                if (run[k].low === current.low) {
                    current.points.push(run[k]);
                } else {
                    segments.push(current);
                    current = { low: run[k].low, points: [run[k - 1], run[k]] };
                }
            }
            segments.push(current);
        }
        run = [];
    };
    for (const p of points) {
        if (p.value === null) {
            flush();
        } else {
            run.push(p);
        }
    }
    flush();
    return segments;
}

/** Trechos da faixa: pontos consecutivos com os dois limites preenchidos. */
export function splitBands(points: Point[]): Point[][] {
    const bands: Point[][] = [];
    let run: Point[] = [];
    for (const p of points) {
        if (p.lower !== null && p.upper !== null) {
            run.push(p);
        } else if (run.length) {
            bands.push(run);
            run = [];
        }
    }
    if (run.length) {
        bands.push(run);
    }
    return bands;
}

/** Sequências de posições com destaque ≠ 0 viram janelas (do primeiro ao último X). */
export function highlightWindows(xs: number[], on: boolean[]): Array<{ start: number; end: number }> {
    const windows: Array<{ start: number; end: number }> = [];
    let start = -1;
    for (let i = 0; i <= xs.length; i++) {
        if (i < xs.length && on[i]) {
            if (start < 0) {
                start = i;
            }
        } else if (start >= 0) {
            windows.push({ start: xs[start], end: xs[i - 1] });
            start = -1;
        }
    }
    return windows;
}

/** Valor da curva em x: exato; em degrau, o último ponto até x; em reta, interpolado. */
export function valueAt(points: Point[], x: number, interpolation: Interpolation): number | null {
    let before: Point | undefined;
    let after: Point | undefined;
    for (const p of points) {
        if (p.value === null) {
            continue;
        }
        if (p.x === x) {
            return p.value;
        }
        if (p.x < x) {
            before = p;
        } else if (!after) {
            after = p;
        }
    }
    if (!before || !after) {
        return null;
    }
    if (interpolation === "stepAfter") {
        return before.value;
    }
    const t = (x - before.x) / (after.x - before.x);
    return (before.value as number) + ((after.value as number) - (before.value as number)) * t;
}

function axisKind(type: powerbi.ValueTypeDescriptor | undefined, values: PrimitiveValue[]): AxisKind {
    if (type?.dateTime || values.some(v => v instanceof Date)) {
        return "date";
    }
    if (type?.numeric || type?.integer || (values.length > 0 && values.every(v => typeof v === "number" || v === null))) {
        return values.every(v => typeof v === "number" || v === null) ? "number" : "text";
    }
    return "text";
}

export function buildCurvesModel(categorical: DataViewCategorical | undefined, settings: CurvesSettings, deps: CurvesDeps): CurvesResult {
    const category = categorical?.categories?.find(c => c.source.roles?.["x"]);
    const values = categorical?.values;
    const anyValue = values ? byRole(values, "value") : undefined;
    const missing: string[] = [];
    if (!category) {
        missing.push("x");
    }
    if (!anyValue) {
        missing.push("value");
    }
    if (!category || !values || !anyValue) {
        return { missing };
    }

    // ---- eixo X: número e data em ordem crescente; texto na ordem do modelo.
    const raw = category.values.slice(0, MAX_POINTS);
    const kind = axisKind(category.source.type, raw);
    const keyOf = (v: PrimitiveValue): number | string | null =>
        v === null || v === undefined ? null : kind === "number" ? toNumber(v) : kind === "date" ? toNumber(v) : String(v);
    let order = raw.map((_, i) => i).filter(i => kind === "text" || keyOf(raw[i]) !== null);
    if (kind !== "text") {
        order.sort((a, b) => (keyOf(raw[a]) as number) - (keyOf(raw[b]) as number) || a - b);
    }
    // X repetido: não soma; fica o primeiro e o visual avisa.
    const seen = new Set<number | string | null>();
    let duplicates = false;
    order = order.filter(i => {
        const key = keyOf(raw[i]);
        if (seen.has(key)) {
            duplicates = true;
            return false;
        }
        seen.add(key);
        return true;
    });
    const xs = order.map((i, k) => (kind === "text" ? k : keyOf(raw[i]) as number));
    const labels = order.map(i => deps.label(raw[i], category.source.format));
    const integer = kind === "number" && xs.every(x => Number.isInteger(x));
    const interpolation: Interpolation = settings.interpolation === "auto"
        ? (integer ? "stepAfter" : "linear")
        : settings.interpolation;

    // ---- séries
    const hasSeries = !!values.source;
    const allGroups: DataViewValueColumnGroup[] = values.grouped();
    const groups = allGroups.slice(0, MAX_SERIES);
    const visibleCount = Math.max(1, Math.min(groups.length, Math.round(settings.maxSeries) || groups.length));
    const first = groups[0]?.values || [];
    const valueSource = anyValue.source;
    const lowerName = byRole(first, "lower")?.source.displayName ?? null;
    const upperName = byRole(first, "upper")?.source.displayName ?? null;
    const confidenceColumn = byRole(first, "confidence");
    const referenceColumn = byRole(first, "reference");

    let hasLow = false;
    let hasMarks = false;
    let hasHighlights = false;
    const highlightOn = xs.map(() => false);

    const curves: Curve[] = groups.map((group, k) => {
        const cols = group.values;
        const value = byRole(cols, "value");
        const lower = byRole(cols, "lower");
        const upper = byRole(cols, "upper");
        const confidence = byRole(cols, "confidence");
        const threshold = byRole(cols, "threshold");
        const highlight = byRole(cols, "highlight");
        const marks = byRole(cols, "marks");
        const tooltips = allByRole(cols, "tooltips");
        if (value?.highlights) {
            hasHighlights = true;
        }
        const name = hasSeries ? deps.label(group.name, values.source?.format) : valueSource.displayName;
        const points: Point[] = order.map((src, i) => {
            const conf = cell(confidence, src);
            const thr = cell(threshold, src);
            const low = isLowConfidence(conf, thr, settings.threshold);
            const markValue = cell(marks, src);
            const hl = cell(highlight, src);
            if (hl !== null && hl !== 0) {
                highlightOn[i] = true;
            }
            const v = cell(value, src);
            const lo = cell(lower, src);
            const up = cell(upper, src);
            // A faixa só aparece com os dois limites preenchidos.
            const bothLimits = lo !== null && up !== null;
            hasLow = hasLow || (low && v !== null);
            hasMarks = hasMarks || (markValue !== null && markValue > 0 && v !== null);
            return {
                i,
                x: xs[i],
                value: v,
                lower: bothLimits ? lo : null,
                upper: bothLimits ? up : null,
                confidence: conf,
                threshold: thr !== null ? thr : settings.threshold,
                low,
                mark: markValue !== null && markValue > 0,
                highlighted: !!value?.highlights && toNumber(value.highlights[src]) !== null,
                id: deps.pointId(src, hasSeries ? group : undefined),
                tooltips: tooltips.map(column => ({
                    name: column.source.displayName,
                    value: deps.format(column.source.format)(column.values[src])
                }))
            };
        });
        const id = hasSeries ? deps.seriesId(group) : undefined;
        const defined = points.filter(p => p.value !== null);
        return {
            key: hasSeries ? `s${k}:${String(group.name)}` : "value",
            name,
            color: deps.seriesColor(hasSeries ? group : undefined, k, name),
            style: deps.seriesStyle(hasSeries ? group : undefined),
            id,
            selector: id?.getSelector(),
            points,
            segments: splitSegments(points),
            bands: splitBands(points),
            last: defined[defined.length - 1]
        };
    });
    const visible = curves.slice(0, visibleCount);

    // ---- janelas destacadas
    let windows: Array<{ start: number; end: number }> = [];
    if (settings.windows.source === "fixed") {
        const { start, end } = settings.windows;
        if (start !== null && end !== null) {
            windows = [{ start: Math.min(start, end), end: Math.max(start, end) }];
        }
    } else {
        windows = highlightWindows(xs, highlightOn);
    }

    // ---- referência: campo (prioridade) ou constante
    let reference: CurvesModel["reference"] = { present: false, uniform: true, value: null, points: [] };
    if (referenceColumn) {
        const refs = order.map(src => cell(referenceColumn, src));
        const points = refs.map((value, i) => ({ x: xs[i], value })).filter((p): p is { x: number; value: number } => p.value !== null);
        const uniform = allEqual(refs);
        reference = { present: points.length > 0, uniform, value: uniform ? points[0]?.value ?? null : null, points };
    } else if (settings.referenceConstant !== null) {
        reference = { present: true, uniform: true, value: settings.referenceConstant, points: [] };
    }

    // ---- marcos (só os que caem dentro do eixo)
    const milestones: Milestone[] = [];
    for (const token of settings.milestones) {
        let x: number | null = null;
        let label = token;
        if (kind === "text") {
            const i = labels.indexOf(token);
            x = i >= 0 ? xs[i] : null;
        } else if (kind === "number") {
            const n = Number(token.replace(",", "."));
            x = isFinite(n) ? n : null;
        } else {
            const t = Date.parse(token);
            x = isNaN(t) ? null : t;
        }
        if (x === null || xs.length === 0 || x < xs[0] || x > xs[xs.length - 1]) {
            continue;
        }
        const exact = xs.indexOf(x);
        if (exact >= 0) {
            label = labels[exact];
        }
        milestones.push({ x, label, values: visible.map(c => valueAt(c.points, x as number, interpolation)) });
    }

    // ---- domínios
    const yValues: Array<number | null> = [];
    for (const c of visible) {
        for (const p of c.points) {
            yValues.push(p.value, p.lower, p.upper);
        }
    }
    if (reference.value !== null) {
        yValues.push(reference.value);
    }
    for (const p of reference.points) {
        yValues.push(p.value);
    }
    const xMin = xs.length ? xs[0] : 0;
    const xMax = xs.length ? xs[xs.length - 1] : 1;
    let xDomain: [number, number] = [xMin, xMax];
    if (kind === "number") {
        xDomain = [settings.x.min ?? xMin, settings.x.max ?? xMax];
    }
    if (xDomain[1] <= xDomain[0]) {
        xDomain = kind === "date" ? [xDomain[0] - 86400000, xDomain[0] + 86400000] : [xDomain[0] - 1, xDomain[0] + 1];
    }

    return {
        missing,
        model: {
            axis: { kind, integer, name: category.source.displayName, format: category.source.format, xs, labels, domain: xDomain },
            interpolation,
            curves: visible,
            hiddenCount: Math.max(0, allGroups.length - visible.length),
            hasSeries,
            names: {
                series: values.source?.displayName || "",
                value: valueSource.displayName,
                lower: lowerName,
                upper: upperName,
                confidence: confidenceColumn?.source.displayName ?? null,
                reference: referenceColumn?.source.displayName ?? null,
                highlight: byRole(first, "highlight")?.source.displayName ?? null,
                marks: byRole(first, "marks")?.source.displayName ?? null
            },
            formats: {
                value: deps.format(valueSource.format),
                confidence: deps.format(confidenceColumn?.source.format),
                reference: deps.format(referenceColumn?.source.format ?? valueSource.format),
                valueFormat: valueSource.format
            },
            windows,
            reference,
            milestones,
            yDomain: valueDomain(yValues, settings.y.startAtZero, settings.y.min, settings.y.max),
            hasBand: visible.some(c => c.bands.length > 0),
            hasLow: hasLow && visible.some(c => c.points.some(p => p.low && p.value !== null)),
            hasMarks: hasMarks && visible.some(c => c.points.some(p => p.mark && p.value !== null)),
            hasHighlights,
            duplicates,
            truncated: { points: category.values.length > MAX_POINTS, series: allGroups.length > MAX_SERIES }
        }
    };
}
