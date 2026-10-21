"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

import DataViewObjects = powerbi.DataViewObjects;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;

import { ColumnGroup, MatrixModel, Measure, RowItem, cellValue, toNumber } from "./model";

export type Direction = "higherWorse" | "higherBetter" | "neutral";
export type ReferenceKind = "total" | "average" | "parent" | "fixed";

/** Configuração de análise de uma medida exibida (gravada na própria medida, como na matriz nativa). */
export interface MeasureConfig {
    heatmap: boolean;
    direction: Direction;
    reference: ReferenceKind;
    target: number;
    dataBars: boolean;
    delta: boolean;
    /** Cores do botão fx (fixas ou por regra) para a coluna inteira. */
    fill: string;
    fontColor: string;
}

export interface AnalysisOptions {
    locale: string;
    minBase: number;
    worse: string;
    better: string;
    neutral: string;
    scale: string;
    colorBetter: boolean;
    /** 0..1 */
    intensity: number;
}

/** Célula que mais se afasta da referência no sentido ruim. */
export interface Hotspot {
    row: RowItem;
    group: ColumnGroup;
    value: number;
    deviation: number;
    score: number;
}

const OBJECT = "measure";

const HEATMAP_ITEMS: powerbi.IEnumMember[] = [
    { value: "auto", displayName: "Automático" },
    { value: "on", displayName: "Ligado" },
    { value: "off", displayName: "Desligado" }
];
const DIRECTION_ITEMS: powerbi.IEnumMember[] = [
    { value: "auto", displayName: "Automático" },
    { value: "higherWorse", displayName: "Maior é pior (ex.: turnover)" },
    { value: "higherBetter", displayName: "Maior é melhor (ex.: retenção)" },
    { value: "neutral", displayName: "Neutro (escala simples)" }
];
const REFERENCE_ITEMS: powerbi.IEnumMember[] = [
    { value: "auto", displayName: "Automática" },
    { value: "total", displayName: "Total geral" },
    { value: "average", displayName: "Média das linhas do mesmo nível" },
    { value: "parent", displayName: "Linha de cima (nível anterior)" },
    { value: "fixed", displayName: "Valor fixo (meta)" }
];

function prop<T>(objects: DataViewObjects | undefined, name: string, fallback: T): T {
    const value = objects?.[OBJECT]?.[name];
    return value === undefined || value === null ? fallback : value as T;
}

export function colorProp(objects: DataViewObjects | undefined, name: string, fallback = ""): string {
    const value = objects?.[OBJECT]?.[name] as { solid?: { color?: string } } | undefined;
    return value?.solid?.color || fallback;
}

/**
 * Lê a configuração da medida. "Automático" pensa em indicadores como turnover:
 * porcentagens (e a medida-chave) ganham mapa de calor com "maior é pior" e são comparadas ao total geral;
 * as demais medidas ficam neutras e são comparadas à média das linhas.
 */
export function readConfig(measure: Measure, isKey: boolean): MeasureConfig {
    const o = measure.source.objects;
    const heatmap = prop<string>(o, "heatmap", "auto");
    const direction = prop<string>(o, "direction", "auto");
    const reference = prop<string>(o, "reference", "auto");
    const important = isKey || measure.isPercent;
    return {
        heatmap: heatmap === "auto" ? important : heatmap === "on",
        direction: direction === "auto" ? (important ? "higherWorse" : "neutral") : direction as Direction,
        reference: reference === "auto" ? (measure.isPercent ? "total" : "average") : reference as ReferenceKind,
        target: Number(prop<number>(o, "target", 0)),
        dataBars: prop<boolean>(o, "dataBars", false),
        delta: prop<boolean>(o, "delta", true),
        fill: colorProp(o, "fill"),
        fontColor: colorProp(o, "fontColor")
    };
}

// ------------------------------------------------------------------ cores

function hexToRgb(hex: string): [number, number, number] | undefined {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!m) {
        return undefined;
    }
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    if (!x || !y) {
        return t < 0.5 ? a : b;
    }
    const c = x.map((v, i) => Math.round(v + (y[i] - v) * Math.min(1, Math.max(0, t))));
    return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Cor com transparência (para barras de dados e fundos suaves). */
export function alpha(hex: string, a: number): string {
    const rgb = hexToRgb(hex);
    return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})` : hex;
}

/** Cor de texto legível (escura ou branca) sobre um fundo. */
export function readableText(background: string, dark: string): string {
    const rgb = hexToRgb(background);
    if (!rgb) {
        return dark;
    }
    const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4 ? dark : "#FFFFFF";
}

// ---------------------------------------------------------------- análise

interface Scale {
    min: number;
    max: number;
    maxDev: number;
}

/**
 * Referências, escalas e desvios de todas as células, calculados uma vez por atualização.
 * Células com base pequena ficam fora das médias, das escalas e dos pontos de atenção.
 */
export class Analysis {
    private levelValues = new Map<string, number[]>();
    private scales = new Map<string, Scale>();
    private ppFormatter: valueFormatter.IValueFormatter;
    private relFormatter: valueFormatter.IValueFormatter;

    constructor(private model: MatrixModel, private configs: Map<number, MeasureConfig>, private options: AnalysisOptions) {
        this.ppFormatter = valueFormatter.create({ format: "0.0", cultureSelector: options.locale });
        this.relFormatter = valueFormatter.create({ format: "0%", cultureSelector: options.locale });
        this.compute();
    }

    public config(measure: Measure): MeasureConfig | undefined {
        return this.configs.get(measure.index);
    }

    public value(row: RowItem, group: ColumnGroup, measure: Measure): number | undefined {
        return toNumber(cellValue(this.model, row, group.key, measure.index)?.value);
    }

    public baseValue(row: RowItem, group: ColumnGroup): number | undefined {
        return this.model.base ? this.value(row, group, this.model.base) : undefined;
    }

    public isLowBase(row: RowItem, group: ColumnGroup): boolean {
        if (!this.model.base || this.options.minBase <= 0) {
            return false;
        }
        const base = this.baseValue(row, group);
        return base !== undefined && base < this.options.minBase;
    }

    private levelKey(measure: Measure, row: RowItem, group: ColumnGroup): string {
        return measure.index + "|" + row.level + "|" + group.key;
    }

    private scaleKey(measure: Measure, row: RowItem, group: ColumnGroup): string {
        // O total geral usa a escala do primeiro nível; a coluna de total tem escala própria.
        return measure.index + "|" + (row.isGrandTotal ? 0 : row.level) + "|" + (group.isSubtotal ? "t" : "c");
    }

    private eachRow(fn: (row: RowItem) => void): void {
        const walk = (items: RowItem[]): void => items.forEach(r => {
            fn(r);
            walk(r.children);
        });
        walk(this.model.rows);
    }

    private compute(): void {
        const model = this.model;
        // 1) valores por nível e grupo (para a média e a posição no ranking)
        this.eachRow(row => {
            for (const group of model.groups) {
                if (this.isLowBase(row, group)) {
                    continue;
                }
                for (const m of model.values) {
                    const v = this.value(row, group, m);
                    if (v === undefined) {
                        continue;
                    }
                    const key = this.levelKey(m, row, group);
                    const list = this.levelValues.get(key);
                    if (list) {
                        list.push(v);
                    } else {
                        this.levelValues.set(key, [v]);
                    }
                }
            }
        });
        this.levelValues.forEach(list => list.sort((a, b) => b - a));

        // 2) escalas: menor, maior e maior desvio de cada medida por nível
        this.eachRow(row => {
            for (const group of model.groups) {
                if (this.isLowBase(row, group)) {
                    continue;
                }
                for (const m of model.values) {
                    const v = this.value(row, group, m);
                    if (v === undefined) {
                        continue;
                    }
                    const dev = this.deviation(row, group, m);
                    const key = this.scaleKey(m, row, group);
                    const s = this.scales.get(key) || { min: Infinity, max: -Infinity, maxDev: 0 };
                    s.min = Math.min(s.min, v);
                    s.max = Math.max(s.max, v);
                    if (dev !== undefined) {
                        s.maxDev = Math.max(s.maxDev, Math.abs(dev));
                    }
                    this.scales.set(key, s);
                }
            }
        });
    }

    private average(measure: Measure, row: RowItem, group: ColumnGroup): number | undefined {
        const list = this.levelValues.get(this.levelKey(measure, row, group));
        return list?.length ? list.reduce((a, b) => a + b, 0) / list.length : undefined;
    }

    private totalValue(group: ColumnGroup, measure: Measure): number | undefined {
        const total = this.model.grandTotal;
        return total ? this.value(total, group, measure) : undefined;
    }

    /** Valor de comparação da célula (total geral, média, linha de cima ou meta). */
    public reference(row: RowItem, group: ColumnGroup, measure: Measure): number | undefined {
        const cfg = this.configs.get(measure.index);
        if (!cfg) {
            return undefined;
        }
        if (cfg.reference === "fixed") {
            return cfg.target;
        }
        if (row.isGrandTotal) {
            return undefined;
        }
        let ref: number | undefined;
        if (cfg.reference === "total") {
            ref = this.totalValue(group, measure);
        } else if (cfg.reference === "parent") {
            ref = row.parent ? this.value(row.parent, group, measure) : this.totalValue(group, measure);
        }
        return ref ?? this.average(measure, row, group);
    }

    public referenceLabel(measure: Measure): string {
        const cfg = this.configs.get(measure.index);
        switch (cfg?.reference) {
            case "fixed": return "Meta";
            case "parent": return "Linha de cima";
            case "average": return "Média do nível";
            default: return this.model.grandTotal ? "Total geral" : "Média do nível";
        }
    }

    public deviation(row: RowItem, group: ColumnGroup, measure: Measure): number | undefined {
        const v = this.value(row, group, measure);
        const ref = this.reference(row, group, measure);
        return v === undefined || ref === undefined ? undefined : v - ref;
    }

    /** Quanto a célula é pior (positivo) ou melhor (negativo) que a referência; neutro = acima (+) ou abaixo (−). */
    public signedDeviation(row: RowItem, group: ColumnGroup, measure: Measure): number | undefined {
        const dev = this.deviation(row, group, measure);
        if (dev === undefined) {
            return undefined;
        }
        return this.configs.get(measure.index)?.direction === "higherBetter" ? -dev : dev;
    }

    /** A célula está pior que a referência (para neutras: acima dela)? Base pequena nunca conta. */
    public isWorse(row: RowItem, group: ColumnGroup, measure: Measure): boolean {
        const s = this.signedDeviation(row, group, measure);
        return s !== undefined && s > 0 && !this.isLowBase(row, group);
    }

    /** Cor do mapa de calor (ou undefined quando a célula fica sem cor). */
    public heatColor(row: RowItem, group: ColumnGroup, measure: Measure): string | undefined {
        const cfg = this.configs.get(measure.index);
        if (!cfg?.heatmap || this.isLowBase(row, group)) {
            return undefined;
        }
        const v = this.value(row, group, measure);
        const scale = this.scales.get(this.scaleKey(measure, row, group));
        if (v === undefined || !scale) {
            return undefined;
        }
        const o = this.options;
        if (cfg.direction === "neutral") {
            if (row.isGrandTotal) {
                return undefined;
            }
            const t = scale.max === scale.min ? 0.5 : (v - scale.min) / (scale.max - scale.min);
            return mix(o.neutral, o.scale, Math.min(1, Math.max(0, t)) * o.intensity);
        }
        const s = this.signedDeviation(row, group, measure);
        if (s === undefined || scale.maxDev <= 0) {
            return undefined;
        }
        const t = Math.max(-1, Math.min(1, s / scale.maxDev));
        if (Math.abs(t) < 0.05 || (t < 0 && !o.colorBetter)) {
            return undefined;
        }
        return mix(o.neutral, t > 0 ? o.worse : o.better, (0.12 + 0.88 * Math.pow(Math.abs(t), 0.85)) * o.intensity);
    }

    /** Tamanho da barra de dados (0..1) em relação ao maior valor do nível. */
    public barRatio(row: RowItem, group: ColumnGroup, measure: Measure): number | undefined {
        const v = this.value(row, group, measure);
        const scale = this.scales.get(this.scaleKey(measure, row, group));
        if (v === undefined || !scale) {
            return undefined;
        }
        const top = Math.max(Math.abs(scale.max), Math.abs(scale.min));
        return top > 0 ? Math.max(0, Math.min(1, v / top)) : 0;
    }

    /** Posição da célula entre as linhas do mesmo nível (1 = maior valor). */
    public rank(row: RowItem, group: ColumnGroup, measure: Measure): { position: number; count: number } | undefined {
        const v = this.value(row, group, measure);
        const list = this.levelValues.get(this.levelKey(measure, row, group));
        if (v === undefined || !list?.length || row.isGrandTotal || this.isLowBase(row, group)) {
            return undefined;
        }
        return { position: list.filter(x => x > v).length + 1, count: list.length };
    }

    /** Desvio formatado: pontos percentuais para porcentagens, no formato da medida para o resto. */
    public formatDelta(measure: Measure, dev: number): string {
        const text = measure.isPercent
            ? this.ppFormatter.format(Math.abs(dev) * 100) + " p.p."
            : measure.format(Math.abs(dev));
        return this.isZeroDelta(measure, dev) ? text : (dev > 0 ? "+" : "−") + text;
    }

    /** O desvio arredondado para exibição é zero (ex.: 0,0 p.p.)? */
    public isZeroDelta(measure: Measure, dev: number): boolean {
        return measure.isPercent
            ? this.ppFormatter.format(Math.abs(dev) * 100) === this.ppFormatter.format(0)
            : measure.format(Math.abs(dev)) === measure.format(0);
    }

    /** Variação relativa à referência (ex.: +45%). */
    public formatRelative(dev: number, ref: number): string {
        if (!ref) {
            return "";
        }
        const rel = dev / Math.abs(ref);
        return (rel > 0 ? "+" : rel < 0 ? "−" : "") + this.relFormatter.format(Math.abs(rel));
    }

    /** As células que mais se afastam da referência no sentido ruim. */
    public hotspots(measure: Measure, count: number, scope: string, level: string, rank: string): Hotspot[] {
        const model = this.model;
        const groups = scope === "rowTotal" && model.totalGroup
            ? [model.totalGroup]
            : model.groups.filter(g => !g.isSubtotal);
        const rows: RowItem[] = [];
        this.eachRow(row => {
            if (level === "all" || (level === "top" && row.level === 0) || (level !== "top" && row.children.length === 0)) {
                rows.push(row);
            }
        });
        const byImpact = rank === "impact" && !!model.base;
        const found: Hotspot[] = [];
        for (const row of rows) {
            for (const group of groups) {
                const value = this.value(row, group, measure);
                const s = this.signedDeviation(row, group, measure);
                if (value === undefined || s === undefined || s <= 0 || this.isLowBase(row, group)) {
                    continue;
                }
                const base = this.baseValue(row, group);
                found.push({
                    row,
                    group,
                    value,
                    deviation: this.deviation(row, group, measure) as number,
                    score: byImpact ? s * Math.abs(base ?? 0) : s
                });
            }
        }
        return found.sort((a, b) => b.score - a.score).slice(0, Math.max(0, count));
    }
}

// ------------------------------------------------------- painel de formatação

/**
 * Cartão "Medidas": um grupo por medida exibida, com mapa de calor, referência,
 * barras de dados e as cores com o botão fx (avaliadas por célula, como na matriz nativa).
 */
export function buildMeasureCard(values: Measure[], configs: Map<number, MeasureConfig>): formattingSettings.CompositeCard {
    const pick = (items: powerbi.IEnumMember[], value: string): powerbi.IEnumMember =>
        items.find(i => i.value === value) || items[0];

    const groups = values.map(measure => {
        const o = measure.source.objects;
        const selector = { metadata: measure.queryName };
        const cellSelector = {
            ...dataViewWildcard.createDataViewWildcardSelector(dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals),
            metadata: measure.queryName
        };
        const cfg = configs.get(measure.index);
        const auto = (name: string, effective: string): string => {
            const label = name === "heatmap" ? (effective === "true" ? "ligado" : "desligado")
                : String(DIRECTION_ITEMS.concat(REFERENCE_ITEMS).find(i => i.value === effective)?.displayName || "").toLowerCase();
            return `Automático agora: ${label}.`;
        };

        const reference = prop<string>(o, "reference", "auto");
        const slices: formattingSettings.Slice[] = [
            new formattingSettings.ItemDropdown({
                name: "heatmap", displayName: "Mapa de calor", items: HEATMAP_ITEMS,
                value: pick(HEATMAP_ITEMS, prop<string>(o, "heatmap", "auto")), selector,
                description: auto("heatmap", String(cfg?.heatmap))
            }),
            new formattingSettings.ItemDropdown({
                name: "direction", displayName: "Sentido", items: DIRECTION_ITEMS,
                value: pick(DIRECTION_ITEMS, prop<string>(o, "direction", "auto")), selector,
                description: auto("direction", cfg?.direction || "")
            }),
            new formattingSettings.ItemDropdown({
                name: "reference", displayName: "Comparar com", items: REFERENCE_ITEMS,
                value: pick(REFERENCE_ITEMS, reference), selector,
                description: auto("reference", cfg?.reference || "")
            })
        ];
        if (reference === "fixed") {
            slices.push(new formattingSettings.NumUpDown({
                name: "target", displayName: "Meta", value: Number(prop<number>(o, "target", 0)), selector,
                description: "Para porcentagens, use o valor decimal (8% = 0,08)."
            }));
        }
        slices.push(
            new formattingSettings.ToggleSwitch({
                name: "delta", displayName: "Mostrar desvio (botão Desvio)", value: prop<boolean>(o, "delta", true), selector
            }),
            new formattingSettings.ToggleSwitch({
                name: "dataBars", displayName: "Barras de dados", value: prop<boolean>(o, "dataBars", false), selector
            }),
            // Cores com o botão "fx" do Power BI (regras, escala ou valor de campo, avaliadas por célula).
            new formattingSettings.ColorPicker({
                name: "fill",
                displayName: "Cor de fundo (fx)",
                description: "Use o botão fx para formatar pelo valor de qualquer campo. Tem prioridade sobre o mapa de calor.",
                value: { value: colorProp(o, "fill") },
                selector: cellSelector,
                altConstantSelector: selector,
                instanceKind: VisualEnumerationInstanceKinds.ConstantOrRule
            }),
            new formattingSettings.ColorPicker({
                name: "fontColor",
                displayName: "Cor da fonte (fx)",
                value: { value: colorProp(o, "fontColor") },
                selector: cellSelector,
                altConstantSelector: selector,
                instanceKind: VisualEnumerationInstanceKinds.ConstantOrRule
            })
        );

        return new formattingSettings.Group({
            name: "m_" + measure.index,
            displayName: measure.name,
            slices
        });
    });

    class MeasureCard extends formattingSettings.CompositeCard {
        name = OBJECT;
        displayName = "Medidas";
        description = "Mapa de calor, referência e cores de cada medida em Valores.";
        groups = groups;
    }
    return new MeasureCard();
}
