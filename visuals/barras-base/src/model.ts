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

/** Um item da legenda (um segmento de cada barra). */
export interface Series {
    index: number;
    key: string;
    raw: PrimitiveValue;
    name: string;
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

/** Um registro da base nominal: uma linha da matriz num item da legenda. */
export interface Rec {
    cat: Cat;
    series: number;
    /** Valores dos campos das linhas, por nível (Eixo, Colunas da base…). */
    path: PrimitiveValue[];
    node: DataViewMatrixNode;
    text?: string[];
    search?: string;
}

export interface Column {
    name: string;
    numeric: boolean;
    value: (rec: Rec) => PrimitiveValue;
    format: (value: PrimitiveValue) => string;
}

export interface Model {
    categoryName: string;
    legendName: string;
    valueName: string;
    hasLegend: boolean;
    series: Series[];
    cats: Cat[];
    records: Rec[];
    columns: Column[];
    format: (v: PrimitiveValue) => string;
    valueFormat: string | undefined;
    /** A medida de Valores é um percentual (não faz sentido "% da barra"). */
    isPercent: boolean;
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
    const valueIndex = valueSources.findIndex(s => s.roles?.["value"]);
    if (valueIndex < 0) {
        return undefined;
    }
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
    const leaves = readColumns(colLevels, matrix.columns?.root, valueSources.length);

    // Itens da legenda (ou uma série só, a própria medida).
    const valueSource = valueSources[valueIndex];
    const series: Series[] = hasLegend
        ? leaves.members.map((m, k) => {
            const selectionId = builder().withMatrixNode(m.node, colLevels).createSelectionId();
            const objects = (m.node as unknown as { objects?: powerbi.DataViewObjects }).objects;
            return {
                index: k,
                key: m.key,
                raw: m.raw,
                name: label(m.raw, legendSource?.format, locale),
                color: colorOf(objects) || SERIES_PALETTE[k % SERIES_PALETTE.length],
                selectionId,
                selector: selectionId.getSelector(),
                node: m.node
            };
        })
        : [{
            index: 0,
            key: "",
            raw: null,
            name: valueSource.displayName,
            color: colorOf(valueSource.objects) || SERIES_PALETTE[0],
            selectionId: builder().withMeasure(valueSource.queryName || valueSource.displayName).createSelectionId(),
            selector: { metadata: valueSource.queryName || valueSource.displayName },
            node: undefined
        }];
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
        for (const s of series) {
            const present = [valueIndex, detailIndex, ...measureIndexes].some(m => !isBlank(cell(leaf, s.key, m)));
            if (present) {
                cat.counts[s.index]++;
                records.push({ cat, series: s.index, path, node: leaf });
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
                    const parts = series.map(s => Math.max(0, toNumber(cell(values, s.key, valueIndex))));
                    nodeCat = {
                        key, raw,
                        label: label(raw, catSource.format, locale),
                        parts,
                        stack: parts.reduce((a, b) => a + b, 0),
                        total: hasLegend ? numberOrUndefined(cell(values, totalKey, valueIndex)) : parts[0],
                        detail: series.map(s => numberOrUndefined(cell(values, s.key, detailIndex))),
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
        return { name: source.displayName, numeric: isNumeric(source), value: rec => rec.path[level] ?? null, format: formatOf(source) };
    };
    const measureColumn = (i: number): Column => ({
        name: valueSources[i].displayName,
        numeric: !valueSources[i].type?.text,
        value: rec => cell(rec.node, series[rec.series].key, i) ?? null,
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
            name: legendSource.displayName,
            numeric: isNumeric(legendSource),
            value: rec => series[rec.series].raw,
            format: formatOf(legendSource)
        });
    }
    for (const x of detailLevels) {
        columns.push(levelColumn(x.level));
    }
    for (const i of measureIndexes) {
        columns.push(measureColumn(i));
    }
    if (options.showValueColumn || columns.length === 0) {
        columns.push(measureColumn(valueIndex));
    }

    const formatter = valueFormatter.create({ format: valueSource.format, cultureSelector: locale });
    const detailSource = detailIndex >= 0 ? valueSources[detailIndex] : undefined;
    const detailFormatter = valueFormatter.create({ format: detailSource?.format, cultureSelector: locale });
    return {
        categoryName: catSource.displayName,
        legendName: legendSource?.displayName || "",
        valueName: valueSource.displayName,
        hasLegend,
        series,
        cats,
        records,
        columns,
        format: v => formatter.format(v),
        valueFormat: valueSource.format,
        isPercent: /%/.test(valueSource.format || ""),
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
