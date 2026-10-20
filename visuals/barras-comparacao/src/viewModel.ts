"use strict";

// dataView -> modelo de visualização. Função pura (sem DOM e sem host), coberta pelos testes em test/.
// Toda regra de negócio genérica mora aqui: séries, comparações, referência, baixa confiança,
// cor por regra, ordenação e Top N.

import powerbi from "powerbi-visuals-api";

import { mix, soften } from "../../common/src/colors";
import { allByRole, allEqual, byRole, isLowConfidence, toNumber, valueDomain } from "../../common/src/values";

import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup;
import ISelectionId = powerbi.visuals.ISelectionId;
import PrimitiveValue = powerbi.PrimitiveValue;

/** Limites declarados na redução de dados (capabilities pede um a mais para detectar o excesso). */
export const MAX_CATEGORIES = 1000;
export const MAX_SERIES = 30;

export type ColorRule = "none" | "aboveBelow" | "flag" | "gradient";
export type SortOrder = "model" | "desc" | "asc" | "alpha";
export type LowStyle = "hatched" | "faded";
export type BarState = "normal" | "above" | "below" | "flag" | "gradient";

export interface BarsSettings {
    rule: ColorRule;
    colors: {
        normal: string;
        above: string;
        below: string;
        flag: string;
        low: string;
        gradientMin: string;
        gradientMax: string;
    };
    lowStyle: LowStyle;
    /** Limiar constante do painel (o campo Limiar tem prioridade). */
    threshold: number | null;
    /** Referência constante do painel (o campo Referência tem prioridade). null = sem constante. */
    referenceConstant: number | null;
    sort: SortOrder;
    lowLast: boolean;
    /** Mostrar só as N primeiras após a ordenação; null = todas. */
    topN: number | null;
}

type Format = (value: PrimitiveValue) => string;

/** O que o modelo precisa do host. Nos testes, são funções simples. */
export interface BarsDeps {
    format(format: string | undefined, sample?: number): Format;
    label(value: PrimitiveValue, format: string | undefined): string;
    pointId(category: number, group: DataViewValueColumnGroup | undefined): ISelectionId;
    seriesId(group: DataViewValueColumnGroup): ISelectionId;
    seriesColor(group: DataViewValueColumnGroup, index: number, name: string): string;
    compare(a: string, b: string): number;
}

export interface TooltipValue {
    name: string;
    value: string;
}

export interface Bar {
    key: string;
    series: number;
    value: number | null;
    /** Valor destacado por filtro cruzado (supportsHighlight); null = sem destaque. */
    highlight: number | null;
    comparisons: [number | null, number | null];
    reference: number | null;
    confidence: number | null;
    threshold: number | null;
    low: boolean;
    flag: boolean;
    state: BarState;
    /** Cor final da barra (regra de cor, sinalizador e baixa confiança já aplicados). */
    fill: string;
    hatch: boolean;
    faded: boolean;
    id: ISelectionId;
    tooltips: TooltipValue[];
}

export interface Category {
    /** Posição no dataView (ordem do modelo). */
    index: number;
    key: string;
    label: string;
    extra: string;
    bars: Bar[];
    total: number;
    low: boolean;
}

export interface Series {
    name: string;
    color: string;
    /** Só com o campo Série (clique na legenda seleciona a série inteira). */
    id: ISelectionId | undefined;
    selector: powerbi.data.Selector | undefined;
}

export interface BarsModel {
    categories: Category[];
    /** Categorias escondidas pelo Top N. */
    hiddenCount: number;
    series: Series[];
    hasSeries: boolean;
    names: {
        category: string;
        series: string;
        value: string;
        comparisons: [string | null, string | null];
        reference: string | null;
        confidence: string | null;
        flag: string | null;
        extra: string | null;
    };
    formats: {
        value: Format;
        comparisons: [Format, Format];
        reference: Format;
        confidence: Format;
        /** Formato da medida principal, para os tiques do eixo. */
        valueFormat: string | undefined;
    };
    reference: {
        /** Há referência (campo ou constante). */
        present: boolean;
        fromField: boolean;
        /** Igual em todas as categorias: vira uma linha única. */
        uniform: boolean;
        value: number | null;
    };
    domain: [number, number];
    hasHighlights: boolean;
    hasConfidence: boolean;
    hasLow: boolean;
    hasFlag: boolean;
    /** Regra "acima-abaixo" sem referência: cai para a cor padrão (o painel avisa). */
    referenceMissing: boolean;
    truncated: { categories: boolean; series: boolean };
}

export interface BarsResult {
    model?: BarsModel;
    /** Papéis obrigatórios que faltam ("category", "value"). */
    missing: string[];
}

interface GroupColumns {
    value?: DataViewValueColumn;
    comparisons: [DataViewValueColumn | undefined, DataViewValueColumn | undefined];
    reference?: DataViewValueColumn;
    flag?: DataViewValueColumn;
    confidence?: DataViewValueColumn;
    threshold?: DataViewValueColumn;
    extra?: DataViewValueColumn;
    tooltips: DataViewValueColumn[];
}

function columnsOf(columns: DataViewValueColumn[]): GroupColumns {
    return {
        value: byRole(columns, "value"),
        comparisons: [byRole(columns, "comparison1"), byRole(columns, "comparison2")],
        reference: byRole(columns, "reference"),
        flag: byRole(columns, "flag"),
        confidence: byRole(columns, "confidence"),
        threshold: byRole(columns, "threshold"),
        extra: byRole(columns, "extraLabel"),
        tooltips: allByRole(columns, "tooltips")
    };
}

const cell = (column: DataViewValueColumn | undefined, i: number): number | null =>
    column ? toNumber(column.values[i]) : null;

export function buildBarsModel(categorical: DataViewCategorical | undefined, settings: BarsSettings, deps: BarsDeps): BarsResult {
    const category = categorical?.categories?.find(c => c.source.roles?.["category"]);
    const values = categorical?.values;
    const anyValue = values ? byRole(values, "value") : undefined;
    const missing: string[] = [];
    if (!category) {
        missing.push("category");
    }
    if (!anyValue) {
        missing.push("value");
    }
    if (!category || !values || !anyValue) {
        return { missing };
    }

    const hasSeries = !!values.source;
    const allGroups: DataViewValueColumnGroup[] = values.grouped();
    const groups = allGroups.slice(0, MAX_SERIES);
    const nCategories = Math.min(category.values.length, MAX_CATEGORIES);
    const groupColumns = groups.map(g => columnsOf(g.values));
    const first = groupColumns[0];
    const valueSource = anyValue.source;

    const series: Series[] = groups.map((group, k) => {
        const name = hasSeries ? deps.label(group.name, values.source?.format) : valueSource.displayName;
        const id = hasSeries ? deps.seriesId(group) : undefined;
        return {
            name,
            color: hasSeries ? deps.seriesColor(group, k, name) : settings.colors.normal,
            id,
            selector: id?.getSelector()
        };
    });

    const formatOf = (column: DataViewValueColumn | undefined): Format => deps.format(column?.source.format);
    const formats = {
        value: formatOf(anyValue),
        comparisons: [formatOf(first.comparisons[0]), formatOf(first.comparisons[1])] as [Format, Format],
        reference: formatOf(first.reference || anyValue),
        confidence: formatOf(first.confidence),
        valueFormat: valueSource.format
    };

    const referenceFromField = !!first.reference;
    let hasHighlights = false;
    let hasLow = false;
    let hasFlag = false;

    // Barras (ainda sem cor: a regra de gradiente precisa do intervalo dos valores visíveis).
    let categories: Category[] = [];
    for (let i = 0; i < nCategories; i++) {
        const bars: Bar[] = groups.map((group, k) => {
            const cols = groupColumns[k];
            const value = cell(cols.value, i);
            if (cols.value?.highlights) {
                hasHighlights = true;
            }
            const confidence = cell(cols.confidence, i);
            const threshold = cell(cols.threshold, i);
            const low = isLowConfidence(confidence, threshold, settings.threshold);
            const flagValue = cell(cols.flag, i);
            const flag = flagValue !== null && flagValue !== 0;
            hasLow = hasLow || low;
            hasFlag = hasFlag || flag;
            return {
                key: `${i}:${k}`,
                series: k,
                value,
                highlight: cols.value?.highlights ? toNumber(cols.value.highlights[i]) : null,
                comparisons: [cell(cols.comparisons[0], i), cell(cols.comparisons[1], i)],
                reference: referenceFromField ? cell(cols.reference, i) : settings.referenceConstant,
                confidence,
                threshold: threshold !== null ? threshold : settings.threshold,
                low,
                flag,
                state: "normal",
                fill: settings.colors.normal,
                hatch: false,
                faded: false,
                id: deps.pointId(i, hasSeries ? group : undefined),
                tooltips: cols.tooltips.map(column => ({
                    name: column.source.displayName,
                    value: deps.format(column.source.format)(column.values[i])
                }))
            };
        });
        const nonEmpty = bars.filter(b => b.value !== null);
        const extraRaw = first.extra?.values[i];
        categories.push({
            index: i,
            key: String(i),
            label: deps.label(category.values[i], category.source.format),
            extra: extraRaw === null || extraRaw === undefined ? ""
                : typeof extraRaw === "number" ? deps.format(first.extra?.source.format)(extraRaw) : String(extraRaw),
            bars,
            total: nonEmpty.reduce((sum, b) => sum + (b.value as number), 0),
            low: nonEmpty.length > 0 && nonEmpty.every(b => b.low)
        });
    }

    // Ordenação (estável) e Top N.
    const byTotal = (dir: number) => (a: Category, b: Category): number => dir * (a.total - b.total) || a.index - b.index;
    if (settings.sort === "desc") {
        categories.sort(byTotal(-1));
    } else if (settings.sort === "asc") {
        categories.sort(byTotal(1));
    } else if (settings.sort === "alpha") {
        categories.sort((a, b) => deps.compare(a.label, b.label) || a.index - b.index);
    }
    if (settings.lowLast) {
        categories = [...categories.filter(c => !c.low), ...categories.filter(c => c.low)];
    }
    let hiddenCount = 0;
    if (settings.topN !== null && settings.topN > 0 && categories.length > settings.topN) {
        hiddenCount = categories.length - settings.topN;
        categories = categories.slice(0, settings.topN);
    }

    // Cores por regra. O Sinalizador tem prioridade; a baixa confiança (cinza hachurado) vem por cima de tudo.
    const visibleBars = categories.flatMap(c => c.bars);
    const visibleValues = visibleBars.map(b => b.value).filter((v): v is number => v !== null);
    const minValue = visibleValues.length ? Math.min(...visibleValues) : 0;
    const maxValue = visibleValues.length ? Math.max(...visibleValues) : 0;
    const referencePresent = referenceFromField || settings.referenceConstant !== null;
    const referenceMissing = settings.rule === "aboveBelow" && (!referencePresent || visibleBars.every(b => b.reference === null));
    for (const bar of visibleBars) {
        const base = hasSeries ? series[bar.series].color : settings.colors.normal;
        let state: BarState = "normal";
        let fill = base;
        if (bar.flag) {
            state = "flag";
            fill = settings.colors.flag;
        } else if (settings.rule === "aboveBelow" && bar.reference !== null && bar.value !== null) {
            const above = bar.value > bar.reference;
            state = above ? "above" : "below";
            // Com séries, muda a saturação da cor da série (a legenda continua legível).
            fill = hasSeries ? (above ? base : soften(base)) : (above ? settings.colors.above : settings.colors.below);
        } else if (settings.rule === "gradient" && bar.value !== null) {
            state = "gradient";
            const t = maxValue > minValue ? (bar.value - minValue) / (maxValue - minValue) : 1;
            fill = mix(settings.colors.gradientMin, settings.colors.gradientMax, t);
        }
        bar.state = state;
        bar.fill = fill;
        if (bar.low) {
            bar.hatch = settings.lowStyle === "hatched";
            bar.faded = settings.lowStyle === "faded";
            if (bar.hatch) {
                bar.fill = settings.colors.low;
            }
        }
    }

    // Eixo: sempre a partir de zero e até o maior entre valor, comparações e referência.
    const extent: Array<number | null> = [];
    for (const bar of visibleBars) {
        extent.push(bar.value, bar.comparisons[0], bar.comparisons[1], bar.reference);
    }
    const references = visibleBars.map(b => b.reference);
    const uniform = allEqual(references);

    return {
        missing,
        model: {
            categories,
            hiddenCount,
            series,
            hasSeries,
            names: {
                category: category.source.displayName,
                series: values.source?.displayName || "",
                value: valueSource.displayName,
                comparisons: [first.comparisons[0]?.source.displayName ?? null, first.comparisons[1]?.source.displayName ?? null],
                reference: first.reference?.source.displayName ?? null,
                confidence: first.confidence?.source.displayName ?? null,
                flag: first.flag?.source.displayName ?? null,
                extra: first.extra?.source.displayName ?? null
            },
            formats,
            reference: {
                present: referencePresent && references.some(r => r !== null),
                fromField: referenceFromField,
                uniform,
                value: uniform ? references.find(r => r !== null) ?? null : null
            },
            domain: valueDomain(extent, true),
            hasHighlights,
            hasConfidence: !!first.confidence,
            hasLow,
            hasFlag,
            referenceMissing,
            truncated: { categories: category.values.length > MAX_CATEGORIES, series: allGroups.length > MAX_SERIES }
        }
    };
}
