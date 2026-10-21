"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

import DataViewObjects = powerbi.DataViewObjects;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;

import { ColumnGroup, MatrixModel, Measure, RowItem, cellValue, toNumber } from "./model";

export type Direction = "higherWorse" | "higherBetter" | "neutral";
export type ReferenceKind = "total" | "average" | "median" | "quartiles" | "rowAverage" | "parent" | "measure" | "fixed";
/** O que usar quando a medida de referência está vazia na célula (e nas linhas de cima). */
export type FallbackKind = "total" | "median" | "average" | "parent" | "none";

/** Valor de referência de uma célula e de onde ele veio (ex.: "Meta turnover de Operações"). */
export interface ReferenceInfo {
    value: number | undefined;
    label: string;
    /** Da própria célula, herdado de uma linha de cima, da alternativa ou calculado pelo método escolhido. */
    source: "own" | "inherited" | "fallback" | "method";
}

/** Resumo dos valores das linhas de um nível numa coluna (base pequena fica de fora). */
export interface LevelStats {
    count: number;
    min: number;
    max: number;
    mean: number;
    q1: number;
    median: number;
    q3: number;
}

/** Configuração de análise de uma medida exibida (gravada na própria medida, como na matriz nativa). */
export interface MeasureConfig {
    heatmap: boolean;
    direction: Direction;
    reference: ReferenceKind;
    target: number;
    /** Medida do campo Referência usada por esta medida (quando reference = "measure"). */
    refMeasure: Measure | undefined;
    /** Sem valor na célula, procura a referência nas linhas de cima (ex.: a meta da diretoria vale para as áreas). */
    refInherit: boolean;
    refFallback: FallbackKind;
    dataBars: boolean;
    delta: boolean;
    /** Mostra as medidas do campo Detalhe ao lado do valor. */
    detail: boolean;
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
    { value: "total", displayName: "Total geral (da mesma coluna)" },
    { value: "median", displayName: "Mediana das linhas do mesmo nível" },
    { value: "quartiles", displayName: "Faixa típica do nível (1º a 3º quartil)" },
    { value: "average", displayName: "Média das linhas do mesmo nível" },
    { value: "rowAverage", displayName: "Média da própria linha (nas colunas)" },
    { value: "parent", displayName: "Linha de cima (nível anterior)" },
    { value: "measure", displayName: "Medida do campo Referência (ex.: metas)" },
    { value: "fixed", displayName: "Valor fixo" }
];
const FALLBACK_ITEMS: powerbi.IEnumMember[] = [
    { value: "total", displayName: "Total geral" },
    { value: "median", displayName: "Mediana do nível" },
    { value: "average", displayName: "Média do nível" },
    { value: "parent", displayName: "Linha de cima" },
    { value: "none", displayName: "Nenhuma (célula sem cor)" }
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
 * Com uma medida no campo Referência, a medida-chave passa a usá-la.
 */
export function readConfig(measure: Measure, isKey: boolean, references: Measure[]): MeasureConfig {
    const o = measure.source.objects;
    const heatmap = prop<string>(o, "heatmap", "auto");
    const direction = prop<string>(o, "direction", "auto");
    const reference = prop<string>(o, "reference", "auto");
    const important = isKey || measure.isPercent;
    const refQuery = prop<string>(o, "refMeasure", "");
    return {
        heatmap: heatmap === "auto" ? important : heatmap === "on",
        direction: direction === "auto" ? (important ? "higherWorse" : "neutral") : direction as Direction,
        reference: reference !== "auto" ? reference as ReferenceKind
            : isKey && references.length ? "measure" : measure.isPercent ? "total" : "average",
        target: Number(prop<number>(o, "target", 0)),
        refMeasure: references.find(r => r.queryName === refQuery) || references[0],
        refInherit: prop<boolean>(o, "refInherit", true),
        refFallback: prop<FallbackKind>(o, "refFallback", "total"),
        dataBars: prop<boolean>(o, "dataBars", false),
        delta: prop<boolean>(o, "delta", true),
        // Por padrão o detalhe (ex.: nº de saídas) acompanha só a medida-chave.
        detail: prop<boolean>(o, "detail", isKey),
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
    private rowAverages = new Map<string, number | undefined>();
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

    /** Quantil (0..1) dos valores do mesmo nível e coluna; 0,5 = mediana. */
    private quantile(measure: Measure, row: RowItem, group: ColumnGroup, p: number): number | undefined {
        const list = this.levelValues.get(this.levelKey(measure, row, group));
        if (!list?.length) {
            return undefined;
        }
        // A lista está em ordem decrescente.
        const pos = (list.length - 1) * (1 - p);
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        return list[lo] + (list[hi] - list[lo]) * (pos - lo);
    }

    /** Média da linha nas colunas (sem a de total e sem células com base pequena). */
    private rowAverage(measure: Measure, row: RowItem): number | undefined {
        const key = measure.index + "|" + row.id;
        if (!this.rowAverages.has(key)) {
            let sum = 0;
            let n = 0;
            for (const group of this.model.groups) {
                const v = this.value(row, group, measure);
                if (!group.isSubtotal && v !== undefined && !this.isLowBase(row, group)) {
                    sum += v;
                    n++;
                }
            }
            this.rowAverages.set(key, n ? sum / n : undefined);
        }
        return this.rowAverages.get(key);
    }

    private totalValue(group: ColumnGroup, measure: Measure): number | undefined {
        const total = this.model.grandTotal;
        return total ? this.value(total, group, measure) : undefined;
    }

    /** Valor de referência da célula e de onde ele veio. */
    public referenceInfo(row: RowItem, group: ColumnGroup, measure: Measure): ReferenceInfo {
        const cfg = this.configs.get(measure.index);
        return cfg ? this.resolve(cfg.reference, row, group, measure, cfg) : { value: undefined, label: "", source: "method" };
    }

    private resolve(kind: ReferenceKind | FallbackKind, row: RowItem, group: ColumnGroup, measure: Measure, cfg: MeasureConfig): ReferenceInfo {
        const none: ReferenceInfo = { value: undefined, label: "", source: "method" };
        const method = (value: number | undefined, label: string): ReferenceInfo => ({ value, label, source: "method" });
        switch (kind) {
            case "none":
                return none;
            case "fixed":
                return method(cfg.target, "valor fixo");
            case "measure": {
                const ref = cfg.refMeasure;
                if (ref) {
                    // A própria célula; depois (se ligado) as linhas de cima até o total geral.
                    for (let r: RowItem | undefined = row; r; r = cfg.refInherit ? this.above(r) : undefined) {
                        const v = this.value(r, group, ref);
                        if (v !== undefined) {
                            return r === row
                                ? { value: v, label: ref.name, source: "own" }
                                : { value: v, label: `${ref.name} de ${r.label}`, source: "inherited" };
                        }
                    }
                }
                const fallback = this.resolve(cfg.refFallback, row, group, measure, cfg);
                return fallback.value === undefined ? none
                    : { value: fallback.value, label: `${fallback.label}, sem ${ref?.name || "referência"}`, source: "fallback" };
            }
            case "rowAverage":
                // Na coluna de total, a média da própria linha não se aplica: usa o total geral.
                return group.isSubtotal
                    ? this.resolve("total", row, group, measure, cfg)
                    : method(this.rowAverage(measure, row), "média da própria linha");
        }
        // As referências abaixo comparam linhas entre si: o total geral não tem com quem comparar.
        if (row.isGrandTotal) {
            return none;
        }
        switch (kind) {
            case "total": {
                const v = this.totalValue(group, measure);
                return v !== undefined ? method(v, "total geral") : method(this.average(measure, row, group), "média do nível");
            }
            case "parent": {
                const v = row.parent ? this.value(row.parent, group, measure) : undefined;
                return v !== undefined ? method(v, (row.parent as RowItem).label) : this.resolve("total", row, group, measure, cfg);
            }
            case "median":
            case "quartiles":
                return method(this.quantile(measure, row, group, 0.5), "mediana do nível");
            default:
                return method(this.average(measure, row, group), "média do nível");
        }
    }

    /** Menor, maior, média e quartis das linhas do mesmo nível na coluna (para a explicação da referência). */
    public levelStats(row: RowItem, group: ColumnGroup, measure: Measure): LevelStats | undefined {
        const list = this.levelValues.get(this.levelKey(measure, row, group));
        if (!list?.length) {
            return undefined;
        }
        const q = (p: number): number => this.quantile(measure, row, group, p) as number;
        return {
            count: list.length,
            min: list[list.length - 1],
            max: list[0],
            mean: list.reduce((a, b) => a + b, 0) / list.length,
            q1: q(0.25),
            median: q(0.5),
            q3: q(0.75)
        };
    }

    /** Quantas células usaram a medida de referência na própria célula, herdaram de cima ou caíram na alternativa. */
    public referenceCoverage(measure: Measure): Record<ReferenceInfo["source"] | "none", number> {
        const count = { own: 0, inherited: 0, fallback: 0, method: 0, none: 0 };
        this.eachRow(row => {
            for (const group of this.model.groups) {
                if (this.value(row, group, measure) === undefined) {
                    continue;
                }
                const info = this.referenceInfo(row, group, measure);
                count[info.value === undefined ? "none" : info.source]++;
            }
        });
        return count;
    }

    /** Linha de cima; acima do primeiro nível vem o total geral. */
    private above(row: RowItem): RowItem | undefined {
        return row.isGrandTotal ? undefined : row.parent || this.model.grandTotal;
    }

    public reference(row: RowItem, group: ColumnGroup, measure: Measure): number | undefined {
        return this.referenceInfo(row, group, measure).value;
    }

    /** Faixa típica (1º e 3º quartis) do nível, quando a referência é por quartis. */
    public typicalRange(row: RowItem, group: ColumnGroup, measure: Measure): [number, number] | undefined {
        if (this.configs.get(measure.index)?.reference !== "quartiles" || row.isGrandTotal) {
            return undefined;
        }
        const q1 = this.quantile(measure, row, group, 0.25);
        const q3 = this.quantile(measure, row, group, 0.75);
        return q1 === undefined || q3 === undefined ? undefined : [q1, q3];
    }

    /** Descrição curta da referência da medida, para a legenda (ex.: "mediana do nível"). */
    public referenceLabel(measure: Measure): string {
        const cfg = this.configs.get(measure.index);
        switch (cfg?.reference) {
            case "fixed": return "valor fixo";
            case "parent": return "linha de cima";
            case "average": return "média do nível";
            case "median": return "mediana do nível";
            case "quartiles": return "faixa típica do nível";
            case "rowAverage": return "média da própria linha";
            case "measure": return cfg.refMeasure?.name || "total geral";
            default: return this.model.grandTotal ? "total geral" : "média do nível";
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

    /**
     * Valor alto (1), baixo (−1) ou na referência (0), sem olhar o sentido.
     * Na faixa típica: acima do 3º quartil é alto, abaixo do 1º é baixo e entre eles é típico.
     */
    public position(row: RowItem, group: ColumnGroup, measure: Measure): -1 | 0 | 1 | undefined {
        const v = this.value(row, group, measure);
        if (v === undefined) {
            return undefined;
        }
        const range = this.typicalRange(row, group, measure);
        if (range) {
            return v > range[1] ? 1 : v < range[0] ? -1 : 0;
        }
        const dev = this.deviation(row, group, measure);
        if (dev === undefined) {
            return undefined;
        }
        return this.isZeroDelta(measure, dev) ? 0 : dev > 0 ? 1 : -1;
    }

    /** Pior (1), melhor (−1) ou na referência (0), já com o sentido da medida (neutras: acima = 1). */
    public judgement(row: RowItem, group: ColumnGroup, measure: Measure): -1 | 0 | 1 | undefined {
        const p = this.position(row, group, measure);
        return p !== undefined && this.configs.get(measure.index)?.direction === "higherBetter" ? -p as -1 | 0 | 1 : p;
    }

    /** A célula está pior que a referência (para neutras: acima dela)? Base pequena nunca conta. */
    public isWorse(row: RowItem, group: ColumnGroup, measure: Measure): boolean {
        return this.judgement(row, group, measure) === 1 && !this.isLowBase(row, group);
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
        const worse = this.judgement(row, group, measure);
        if (!worse || (worse < 0 && !o.colorBetter)) {
            return undefined;
        }
        const target = worse > 0 ? o.worse : o.better;
        const range = this.typicalRange(row, group, measure);
        if (range) {
            // Fora da faixa típica a célula sempre ganha cor; quanto mais longe, mais forte.
            const span = v > range[1] ? scale.max - range[1] : range[0] - scale.min;
            const t = span > 0 ? Math.min(1, (v > range[1] ? v - range[1] : range[0] - v) / span) : 1;
            return mix(o.neutral, target, (0.3 + 0.7 * Math.pow(t, 0.85)) * o.intensity);
        }
        const s = this.signedDeviation(row, group, measure);
        if (s === undefined || scale.maxDev <= 0) {
            return undefined;
        }
        const t = Math.min(1, Math.abs(s) / scale.maxDev);
        if (t < 0.05) {
            return undefined;
        }
        return mix(o.neutral, target, (0.12 + 0.88 * Math.pow(t, 0.85)) * o.intensity);
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

    /** As células piores que a referência, das mais distantes para as mais próximas. */
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
                if (value === undefined || s === undefined || !this.isWorse(row, group, measure)) {
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
export function buildMeasureCard(values: Measure[], configs: Map<number, MeasureConfig>, hasDetails: boolean,
    references: Measure[]): formattingSettings.CompositeCard {
    const refItems: powerbi.IEnumMember[] = references.map(r => ({ value: r.queryName, displayName: r.name }));
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
                name: "reference", displayName: "Referência (o que é alto ou baixo)", items: REFERENCE_ITEMS,
                value: pick(REFERENCE_ITEMS, reference), selector,
                description: auto("reference", cfg?.reference || "")
            })
        ];
        if (cfg?.reference === "fixed") {
            slices.push(new formattingSettings.NumUpDown({
                name: "target", displayName: "Valor de referência", value: Number(prop<number>(o, "target", 0)), selector,
                description: "Para porcentagens, use o valor decimal (8% = 0,08)."
            }));
        }
        if (cfg?.reference === "measure") {
            if (refItems.length > 1) {
                slices.push(new formattingSettings.ItemDropdown({
                    name: "refMeasure", displayName: "Medida de referência", items: refItems,
                    value: pick(refItems, cfg.refMeasure?.queryName || ""), selector
                }));
            }
            slices.push(
                new formattingSettings.ToggleSwitch({
                    name: "refInherit", displayName: "Sem valor, usar o da linha de cima", value: cfg.refInherit, selector,
                    description: "Ex.: a meta definida para a diretoria vale para as áreas dela. No fim da cadeia vem o total geral."
                }),
                new formattingSettings.ItemDropdown({
                    name: "refFallback", displayName: "Sem valor em nenhum nível, usar", items: FALLBACK_ITEMS,
                    value: pick(FALLBACK_ITEMS, cfg.refFallback), selector
                })
            );
        }
        if (hasDetails) {
            slices.push(new formattingSettings.ToggleSwitch({
                name: "detail", displayName: "Mostrar detalhe ao lado (campo Detalhe)", value: cfg?.detail ?? false, selector
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
        description = "Mapa de calor, referência (o que é alto ou baixo) e cores de cada medida em Valores.";
        groups = groups;
    }
    return new MeasureCard();
}
