"use strict";

import powerbi from "powerbi-visuals-api";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import { IFilterTarget } from "powerbi-models";

import DataView = powerbi.DataView;
import DataViewMatrixNode = powerbi.DataViewMatrixNode;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import DataViewHierarchyLevel = powerbi.DataViewHierarchyLevel;
import ISelectionId = powerbi.visuals.ISelectionId;
import ISelectionIdBuilder = powerbi.visuals.ISelectionIdBuilder;
import PrimitiveValue = powerbi.PrimitiveValue;

import { SERIES_PALETTE } from "./settings";
import { getTarget, valueKey } from "./filters";

/** Um segmento de cada barra: um item da Legenda ou, sem Legenda, uma das medidas de Valores. */
export interface Series {
    index: number;
    key: string;
    raw: PrimitiveValue;
    name: string;
    /** Item da Legenda na hierarquia de colunas ("" sem Legenda) e medida de Valores usada. */
    member: string;
    measure: number;
    valueName: string;
    format: (v: PrimitiveValue) => string;
    isPercent: boolean;
    color: string;
    selectionId: ISelectionId;
    selector: powerbi.data.Selector;
    /** Nó da hierarquia de colunas (para o ID de seleção das linhas da base). */
    node: DataViewMatrixNode | undefined;
}

/** Uma barra (um valor do eixo). Os valores vêm calculados pelo Power BI em cada nível. */
export interface Cat {
    key: string;
    raw: PrimitiveValue;
    label: string;
    /** Valor de cada segmento (medida calculada para barra × item da legenda). */
    parts: number[];
    /** Soma dos segmentos (o comprimento da barra empilhada). */
    stack: number;
    /** Medida calculada para a barra inteira (subtotal), quando o Power BI envia. */
    total: number | undefined;
    detail: Array<number | undefined>;
    detailTotal: number | undefined;
    counts: number[];
}

/**
 * Um registro da base nominal: uma linha da matriz num item da legenda.
 * Com várias medidas empilhadas, o registro é a linha (uma vez só) e entra nos segmentos em que tem valor.
 */
export interface Rec {
    cat: Cat;
    /** Segmento principal (cor do marcador). */
    series: number;
    /** Segmentos a que o registro pertence (para o clique no gráfico). */
    members: number[];
    /** Valor do registro em cada segmento. */
    values: Array<number | undefined>;
    /** Valores dos campos das linhas, por nível (Eixo, Colunas da base…). */
    path: PrimitiveValue[];
    node: DataViewMatrixNode;
    /** Detalhe calculado para o registro (para recalcular as barras com os filtros das colunas). */
    detail: number | undefined;
    text?: string[];
    search?: string;
}

export interface Column {
    id: string;
    name: string;
    numeric: boolean;
    /** Campo que dá para filtrar pela coluna (Eixo, Legenda e Colunas da base; medidas não). */
    filter?: { target: IFilterTarget; isDate: boolean };
    value: (rec: Rec) => PrimitiveValue;
    format: (value: PrimitiveValue) => string;
}

export interface Model {
    categoryName: string;
    legendName: string;
    valueName: string;
    hasLegend: boolean;
    /** Várias medidas em Valores, cada uma um segmento (sem Legenda). */
    stackedMeasures: boolean;
    series: Series[];
    cats: Cat[];
    records: Rec[];
    columns: Column[];
    format: (v: PrimitiveValue) => string;
    valueFormat: string | undefined;
    /** A medida de Valores é um percentual (não faz sentido "% da barra"). */
    isPercent: boolean;
    detailIsPercent: boolean;
    detailName: string | undefined;
    detailFormat: (v: PrimitiveValue) => string;
    grandTotal: number;
    catTarget: IFilterTarget;
    catIsDate: boolean;
    legTarget: IFilterTarget | undefined;
    legIsDate: boolean;
    rowId: (rec: Rec) => ISelectionId;
}

export interface ModelOptions {
    locale: string;
    order: string;
    emptyText: string;
    showCategoryColumn: boolean;
    showLegendColumn: boolean;
    showValueColumn: boolean;
    builder: () => ISelectionIdBuilder;
}

export function isBlank(value: PrimitiveValue | undefined): boolean {
    return value === null || value === undefined || value === "";
}

export function toNumber(value: PrimitiveValue | undefined): number {
    return typeof value === "number" && isFinite(value) ? value : 0;
}

function numberOrUndefined(value: PrimitiveValue | undefined): number | undefined {
    return typeof value === "number" && isFinite(value) ? value : undefined;
}

export function label(value: PrimitiveValue, format: string | undefined, locale: string): string {
    if (isBlank(value)) {
        return "(Em branco)";
    }
    if (format || value instanceof Date) {
        return valueFormatter.format(value, format, false, locale);
    }
    return String(value);
}

export function compareRaw(a: PrimitiveValue, b: PrimitiveValue): number {
    const blankA = isBlank(a);
    const blankB = isBlank(b);
    if (blankA || blankB) {
        return blankA === blankB ? 0 : blankA ? 1 : -1;
    }
    const x = a instanceof Date ? a.getTime() : a;
    const y = b instanceof Date ? b.getTime() : b;
    if (typeof x === "number" && typeof y === "number") {
        return x - y;
    }
    return String(x).localeCompare(String(y), "pt-BR", { numeric: true, sensitivity: "base" });
}

function colorOf(objects: powerbi.DataViewObjects | undefined): string | undefined {
    const fill = objects?.["dataColors"]?.["fill"] as powerbi.Fill | undefined;
    return fill?.solid?.color || undefined;
}

function hasValues(node: DataViewMatrixNode): boolean {
    return !!node.values && Object.keys(node.values).length > 0;
}

function nodeValue(node: DataViewMatrixNode): PrimitiveValue {
    return node.levelValues?.[0]?.value ?? node.value ?? null;
}

function roleIndex(source: DataViewMetadataColumn, role: string): number {
    return (source as unknown as { rolesIndex?: Record<string, number[]> }).rolesIndex?.[role]?.[0] ?? 0;
}

/** Folhas da hierarquia de colunas: o índice de cada (item da legenda ou total, medida) em node.values. */
interface ColumnLeaves {
    /** Itens da legenda, na ordem do Power BI (vazio sem Legenda). */
    members: Array<{ key: string; raw: PrimitiveValue; node: DataViewMatrixNode }>;
    index: Map<string, number>;
}

const TOTAL_KEY = "#total";

function leafKey(memberKey: string, measure: number): string {
    return memberKey + "|" + measure;
}

function readColumns(levels: DataViewHierarchyLevel[], root: DataViewMatrixNode | undefined, measureCount: number): ColumnLeaves {
    const lastIsMeasure = levels.length > 0 && !!levels[levels.length - 1].sources?.[0]?.isMeasure;
    const memberLevels = lastIsMeasure ? levels.length - 1 : levels.length;
    const members: ColumnLeaves["members"] = [];
    const index = new Map<string, number>();
    let counter = 0;

    const walk = (node: DataViewMatrixNode, memberKey: string): void => {
        const children = node.children || [];
        if (children.length === 0) {
            const measure = lastIsMeasure && node.level === levels.length - 1
                ? (node.levelValues?.[0]?.levelSourceIndex ?? node.levelSourceIndex ?? 0)
                : 0;
            index.set(leafKey(memberKey, measure), counter++);
            return;
        }
        for (const child of children) {
            if (child.level !== undefined && child.level < memberLevels) {
                if (child.isSubtotal) {
                    walk(child, TOTAL_KEY);
                } else {
                    const raw = nodeValue(child);
                    const key = valueKey(raw);
                    if (!members.some(m => m.key === key)) {
                        members.push({ key, raw, node: child });
                    }
                    walk(child, key);
                }
            } else {
                walk(child, memberKey);
            }
        }
    };
    if (root) {
        walk(root, "");
    }
    if (index.size === 0) {
        // Sem Legenda e com uma medida só, os valores ficam na ordem das medidas.
        for (let m = 0; m < measureCount; m++) {
            index.set(leafKey("", m), m);
        }
    }
    return { members, index };
}

/** Junta os valores dos registros: soma, média ou contagem. */
function aggregate(values: Array<number | undefined>, mode: string): number | undefined {
    if (mode === "count") {
        return values.length;
    }
    const nums = values.filter((v): v is number => v !== undefined);
    if (nums.length === 0) {
        return undefined;
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    return mode === "avg" ? sum / nums.length : sum;
}

function groupByCat(records: Rec[]): Map<string, Rec[]> {
    const byCat = new Map<string, Rec[]>();
    for (const rec of records) {
        const list = byCat.get(rec.cat.key);
        if (list) {
            list.push(rec);
        } else {
            byCat.set(rec.cat.key, [rec]);
        }
    }
    return byCat;
}

/** Registros que entram na conta do segmento k (com medidas empilhadas, quem tem valor naquela medida, mesmo 0). */
function inSeries(model: Model, rec: Rec, k: number): boolean {
    return model.stackedMeasures ? rec.values[k] !== undefined : rec.series === k;
}

/** Primeiro modo (soma, média ou contagem) que reproduz todos os valores calculados pelo Power BI. */
function matchMode(pairs: Array<{ target: number; values: Array<number | undefined> }>): string | undefined {
    const close = (a: number | undefined, b: number): boolean =>
        a !== undefined && Math.abs(a - b) <= 0.005 * Math.max(1, Math.abs(a), Math.abs(b));
    if (pairs.length === 0) {
        return undefined;
    }
    return ["sum", "avg", "count"].find(mode => pairs.every(p => close(aggregate(p.values, mode), p.target)));
}

/**
 * Descobre como cada medida se comporta nos registros, comparando o valor que o Power BI calculou para cada segmento
 * com a soma, a média e a contagem dos registros dele (ex.: Contagem = soma; Salário médio ou % por pessoa = média).
 */
export function detectModes(model: Model, cats: Cat[], records: Rec[]): { values: Array<string | undefined>; detail: string | undefined } {
    const byCat = groupByCat(records);
    const values = model.series.map((_, k) => {
        const pairs: Array<{ target: number; values: Array<number | undefined> }> = [];
        for (const cat of cats) {
            const list = (byCat.get(cat.key) || []).filter(r => inSeries(model, r, k));
            if (list.length) {
                pairs.push({ target: cat.parts[k], values: list.map(r => r.values[k]) });
            }
        }
        return matchMode(pairs);
    });
    const detailPairs: Array<{ target: number; values: Array<number | undefined> }> = [];
    for (const cat of cats) {
        const list = byCat.get(cat.key);
        if (list && cat.detailTotal !== undefined) {
            detailPairs.push({ target: cat.detailTotal, values: list.map(r => r.detail) });
        }
    }
    return { values, detail: matchMode(detailPairs) };
}

/**
 * Barras recalculadas a partir dos registros que passam nos filtros das colunas da base
 * (o Power BI não recalcula o próprio visual com um filtro aplicado por ele).
 * Barras sem nenhum registro somem, como num gráfico nativo filtrado.
 */
export function recompute(model: Model, cats: Cat[], records: Rec[], valueModes: string[], detailMode: string): Cat[] {
    const n = model.series.length;
    const byCat = groupByCat(records);
    const out: Cat[] = [];
    for (const cat of cats) {
        const recs = byCat.get(cat.key);
        if (!recs) {
            continue;
        }
        const bySeries = Array.from({ length: n }, (_, k) => recs.filter(r => inSeries(model, r, k)));
        const parts = bySeries.map((list, k) => (list.length ? Math.max(0, aggregate(list.map(r => r.values[k]), valueModes[k]) ?? 0) : 0));
        const detailTotal = aggregate(recs.map(r => r.detail), detailMode);
        out.push({
            ...cat,
            parts,
            stack: parts.reduce((a, b) => a + b, 0),
            // Com medidas empilhadas não há uma medida da barra inteira: o total é a soma dos segmentos.
            total: model.stackedMeasures ? undefined : n === 1 ? parts[0] : aggregate(recs.map(r => r.values[r.series]), valueModes[0]),
            detail: model.stackedMeasures ? parts.map(() => undefined)
                : n === 1 ? [detailTotal]
                    : bySeries.map(list => (list.length ? aggregate(list.map(r => r.detail), detailMode) : undefined)),
            detailTotal,
            counts: model.series.map((_, k) => recs.filter(r => r.members.includes(k)).length)
        });
    }
    return out;
}

/** Acumulado: cada barra passa a somar ela mesma e as anteriores, na ordem do gráfico. */
export function accumulate(model: Model): void {
    const n = model.series.length;
    const parts = new Array<number>(n).fill(0);
    const detail = new Array<number | undefined>(n).fill(undefined);
    const counts = new Array<number>(n).fill(0);
    let total: number | undefined;
    let detailTotal: number | undefined;
    const add = (a: number | undefined, b: number | undefined): number | undefined =>
        a === undefined ? b : b === undefined ? a : a + b;
    for (const cat of model.cats) {
        for (let k = 0; k < n; k++) {
            parts[k] += cat.parts[k];
            detail[k] = add(detail[k], cat.detail[k]);
            counts[k] += cat.counts[k];
        }
        total = add(total, cat.total ?? cat.stack);
        detailTotal = add(detailTotal, cat.detailTotal);
        cat.parts = parts.slice();
        cat.detail = detail.slice();
        cat.counts = counts.slice();
        cat.stack = parts.reduce((a, b) => a + b, 0);
        cat.total = total;
        cat.detailTotal = detailTotal;
    }
    model.grandTotal = model.cats.length ? model.cats[model.cats.length - 1].stack : 0;
}

export function buildModel(dataView: DataView | undefined, options: ModelOptions): Model | undefined {
    const matrix = dataView?.matrix;
    const rowLevels = matrix?.rows?.levels || [];
    const valueSources = matrix?.valueSources || [];
    if (!matrix || rowLevels.length === 0 || valueSources.length === 0) {
        return undefined;
    }
    const catLevel = rowLevels.findIndex(l => l.sources?.[0]?.roles?.["category"]);
    if (catLevel < 0) {
        return undefined;
    }
    const valueIndexes = valueSources
        .map((source, i) => ({ source, i }))
        .filter(x => x.source.roles?.["value"])
        .sort((a, b) => roleIndex(a.source, "value") - roleIndex(b.source, "value"))
        .map(x => x.i);
    if (valueIndexes.length === 0) {
        return undefined;
    }
    const valueIndex = valueIndexes[0];
    const detailIndex = valueSources.findIndex(s => s.roles?.["detail"]);
    const measureIndexes = valueSources
        .map((source, i) => ({ source, i }))
        .filter(x => x.source.roles?.["columnMeasures"])
        .sort((a, b) => roleIndex(a.source, "columnMeasures") - roleIndex(b.source, "columnMeasures"))
        .map(x => x.i);

    const { locale, builder } = options;
    const catSource = rowLevels[catLevel].sources[0];
    const colLevels = matrix.columns?.levels || [];
    const legendLevel = colLevels.find(l => !l.sources?.[0]?.isMeasure);
    const legendSource = legendLevel?.sources?.[0];
    const hasLegend = !!legendSource;
    const stackedMeasures = !hasLegend && valueIndexes.length > 1;
    const leaves = readColumns(colLevels, matrix.columns?.root, valueSources.length);

    // Segmentos: itens da Legenda ou, sem Legenda, as medidas de Valores (uma só = barra simples).
    const valueSource = valueSources[valueIndex];
    const formatterOf = (source: DataViewMetadataColumn): ((v: PrimitiveValue) => string) => {
        const f = valueFormatter.create({ format: source.format, cultureSelector: locale });
        return v => f.format(v);
    };
    const series: Series[] = hasLegend
        ? leaves.members.map((m, k) => {
            const selectionId = builder().withMatrixNode(m.node, colLevels).createSelectionId();
            const objects = (m.node as unknown as { objects?: powerbi.DataViewObjects }).objects;
            return {
                index: k,
                key: m.key,
                raw: m.raw,
                name: label(m.raw, legendSource?.format, locale),
                member: m.key,
                measure: valueIndex,
                valueName: valueSource.displayName,
                format: formatterOf(valueSource),
                isPercent: /%/.test(valueSource.format || ""),
                color: colorOf(objects) || SERIES_PALETTE[k % SERIES_PALETTE.length],
                selectionId,
                selector: selectionId.getSelector(),
                node: m.node
            };
        })
        : valueIndexes.map((i, k) => {
            const source = valueSources[i];
            const queryName = source.queryName || source.displayName;
            return {
                index: k,
                key: "m:" + queryName,
                raw: source.displayName,
                name: source.displayName,
                member: "",
                measure: i,
                valueName: source.displayName,
                format: formatterOf(source),
                isPercent: /%/.test(source.format || ""),
                color: colorOf(source.objects) || SERIES_PALETTE[k % SERIES_PALETTE.length],
                selectionId: builder().withMeasure(queryName).createSelectionId(),
                selector: { metadata: queryName },
                node: undefined
            };
        });
    if (series.length === 0) {
        return undefined;
    }

    const cell = (node: DataViewMatrixNode | undefined, memberKey: string, measure: number): PrimitiveValue | undefined => {
        if (!node?.values || measure < 0) {
            return undefined;
        }
        const j = leaves.index.get(leafKey(memberKey, measure));
        return j === undefined ? undefined : node.values[j]?.value;
    };
    const totalKey = hasLegend ? TOTAL_KEY : "";

    // Percorre as linhas: barras no nível do Eixo, registros nas folhas.
    const cats: Cat[] = [];
    const catMap = new Map<string, Cat>();
    const records: Rec[] = [];
    const lastLevel = rowLevels.length - 1;

    const addRecords = (leaf: DataViewMatrixNode, cat: Cat, path: PrimitiveValue[]): void => {
        if (stackedMeasures) {
            // Uma linha por registro; ele entra nos segmentos das medidas em que tem valor (diferente de 0).
            const present = [...valueIndexes, detailIndex, ...measureIndexes].some(m => !isBlank(cell(leaf, "", m)));
            if (!present) {
                return;
            }
            const values = series.map(s => numberOrUndefined(cell(leaf, "", s.measure)));
            const members = series.filter(s => values[s.index] !== undefined && values[s.index] !== 0).map(s => s.index);
            members.forEach(k => cat.counts[k]++);
            records.push({
                cat, series: members[0] ?? 0, members, values, path, node: leaf,
                detail: numberOrUndefined(cell(leaf, "", detailIndex))
            });
            return;
        }
        for (const s of series) {
            const present = [valueIndex, detailIndex, ...measureIndexes].some(m => !isBlank(cell(leaf, s.member, m)));
            if (present) {
                cat.counts[s.index]++;
                const values = series.map(() => undefined as number | undefined);
                values[s.index] = numberOrUndefined(cell(leaf, s.member, s.measure));
                records.push({
                    cat, series: s.index, members: [s.index], values, path, node: leaf,
                    detail: numberOrUndefined(cell(leaf, s.member, detailIndex))
                });
            }
        }
    };

    const walk = (parent: DataViewMatrixNode, path: PrimitiveValue[], cat: Cat | undefined): void => {
        for (const node of parent.children || []) {
            if (node.isSubtotal) {
                continue;
            }
            const level = node.level ?? 0;
            const nodePath = path.slice();
            nodePath[level] = nodeValue(node);
            let nodeCat = cat;
            if (level === catLevel) {
                const raw = nodeValue(node);
                const key = valueKey(raw);
                nodeCat = catMap.get(key);
                if (!nodeCat) {
                    // O valor da barra vem do próprio nó ou do nó de subtotal dele (depende do Power BI).
                    const values = hasValues(node) ? node : (node.children || []).find(c => c.isSubtotal);
                    const parts = series.map(s => Math.max(0, toNumber(cell(values, s.member, s.measure))));
                    nodeCat = {
                        key, raw,
                        label: label(raw, catSource.format, locale),
                        parts,
                        stack: parts.reduce((a, b) => a + b, 0),
                        // Com medidas empilhadas não há uma medida da barra inteira: o total é a soma dos segmentos.
                        total: hasLegend ? numberOrUndefined(cell(values, totalKey, valueIndex)) : stackedMeasures ? undefined : parts[0],
                        detail: series.map(s => (stackedMeasures ? undefined : numberOrUndefined(cell(values, s.member, detailIndex)))),
                        detailTotal: numberOrUndefined(cell(values, totalKey, detailIndex)),
                        counts: series.map(() => 0)
                    };
                    catMap.set(key, nodeCat);
                    cats.push(nodeCat);
                }
            }
            if (!nodeCat) {
                continue;
            }
            if (level === lastLevel || !(node.children || []).some(c => !c.isSubtotal)) {
                addRecords(node, nodeCat, nodePath);
            } else {
                walk(node, nodePath, nodeCat);
            }
        }
    };
    if (matrix.rows.root) {
        walk(matrix.rows.root, [], undefined);
    }

    if (options.order === "desc") {
        cats.sort((a, b) => (b.total ?? b.stack) - (a.total ?? a.stack));
    } else if (options.order === "asc") {
        cats.sort((a, b) => (a.total ?? a.stack) - (b.total ?? b.stack));
    } else if (options.order === "alpha") {
        cats.sort((a, b) => compareRaw(a.raw, b.raw));
    }

    // Colunas da base nominal.
    const formatOf = (source: DataViewMetadataColumn | undefined): ((v: PrimitiveValue) => string) => {
        const f = source?.format ? valueFormatter.create({ format: source.format, cultureSelector: locale }) : undefined;
        return v => {
            if (isBlank(v)) {
                return options.emptyText;
            }
            if (f) {
                return f.format(v);
            }
            if (v instanceof Date) {
                return v.toLocaleDateString(locale);
            }
            if (typeof v === "boolean") {
                return v ? "Verdadeiro" : "Falso";
            }
            if (typeof v === "number") {
                return Number.isInteger(v) ? String(v) : v.toLocaleString(locale);
            }
            return String(v);
        };
    };
    const isNumeric = (source: DataViewMetadataColumn | undefined): boolean => !!(source?.type?.numeric || source?.type?.integer);
    const levelColumn = (level: number): Column => {
        const source = rowLevels[level].sources[0];
        return {
            id: "r:" + (source.queryName || source.displayName), name: source.displayName, numeric: isNumeric(source),
            filter: { target: getTarget(source), isDate: !!source.type?.dateTime },
            value: rec => rec.path[level] ?? null, format: formatOf(source)
        };
    };
    const measureColumn = (i: number): Column => ({
        id: "m:" + (valueSources[i].queryName || valueSources[i].displayName),
        name: valueSources[i].displayName,
        numeric: !valueSources[i].type?.text,
        value: rec => cell(rec.node, series[rec.series].member, i) ?? null,
        format: formatOf(valueSources[i])
    });

    const columns: Column[] = [];
    const detailLevels = rowLevels
        .map((l, level) => ({ source: l.sources[0], level }))
        .filter(x => x.level !== catLevel && x.source?.roles?.["columns"])
        .sort((a, b) => roleIndex(a.source, "columns") - roleIndex(b.source, "columns"));
    if (options.showCategoryColumn) {
        columns.push(levelColumn(catLevel));
    }
    if (hasLegend && options.showLegendColumn) {
        columns.push({
            id: "l:" + (legendSource.queryName || legendSource.displayName),
            name: legendSource.displayName,
            numeric: isNumeric(legendSource),
            filter: { target: getTarget(legendSource), isDate: !!legendSource.type?.dateTime },
            value: rec => series[rec.series].raw,
            format: formatOf(legendSource)
        });
    } else if (stackedMeasures && options.showLegendColumn) {
        // Em que medidas o registro entra (ex.: "Desligados").
        columns.push({
            id: "#medidas",
            name: "Medidas",
            numeric: false,
            value: rec => rec.members.map(k => series[k].name).join(", ") || null,
            format: formatOf(undefined)
        });
    }
    for (const x of detailLevels) {
        columns.push(levelColumn(x.level));
    }
    for (const i of measureIndexes) {
        columns.push(measureColumn(i));
    }
    if (options.showValueColumn || columns.length === 0) {
        for (const i of stackedMeasures ? valueIndexes : [valueIndex]) {
            columns.push(measureColumn(i));
        }
    }

    const formatter = valueFormatter.create({ format: valueSource.format, cultureSelector: locale });
    const detailSource = detailIndex >= 0 ? valueSources[detailIndex] : undefined;
    const detailFormatter = valueFormatter.create({ format: detailSource?.format, cultureSelector: locale });
    return {
        categoryName: catSource.displayName,
        legendName: legendSource?.displayName || "",
        valueName: stackedMeasures ? "Valores" : valueSource.displayName,
        hasLegend,
        stackedMeasures,
        series,
        cats,
        records,
        columns,
        format: v => formatter.format(v),
        valueFormat: valueSource.format,
        isPercent: /%/.test(valueSource.format || ""),
        detailIsPercent: /%/.test(detailSource?.format || ""),
        detailName: detailSource?.displayName,
        detailFormat: v => detailFormatter.format(v),
        grandTotal: cats.reduce((a, c) => a + c.stack, 0),
        catTarget: getTarget(catSource),
        catIsDate: !!catSource.type?.dateTime,
        legTarget: legendSource ? getTarget(legendSource) : undefined,
        legIsDate: !!legendSource?.type?.dateTime,
        rowId: rec => {
            const b = builder().withMatrixNode(rec.node, rowLevels);
            const s = series[rec.series];
            return (s.node ? b.withMatrixNode(s.node, colLevels) : b).createSelectionId();
        }
    };
}
