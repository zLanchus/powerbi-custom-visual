"use strict";

import powerbi from "powerbi-visuals-api";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

import DataView = powerbi.DataView;
import DataViewMatrixNode = powerbi.DataViewMatrixNode;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import DataViewMatrixNodeValue = powerbi.DataViewMatrixNodeValue;
import PrimitiveValue = powerbi.PrimitiveValue;

import { SECTION_COUNT } from "./settings";

/** Uma medida da matriz (exibida numa seção ou só de apoio). */
export interface Measure {
    index: number;
    source: DataViewMetadataColumn;
    name: string;
    queryName: string;
    /** Seção (1..N) ou 0 para medidas de apoio (ocultas). */
    section: number;
    format: (value: PrimitiveValue) => string;
}

/** Combinação de valores dos campos de "Colunas" (vazia quando não há colunas). */
export interface ColumnGroup {
    key: string;
    labels: string[];
    isSubtotal: boolean;
}

/** Uma coluna visível: seção + grupo de colunas + medida. */
export interface ValueColumn {
    section: number;
    group: ColumnGroup;
    measure: Measure;
}

export interface RowItem {
    id: string;
    label: string;
    level: number;
    node: DataViewMatrixNode;
    /** Nó de onde vêm os valores (o próprio nó, ou o subtotal dele). */
    valuesNode: DataViewMatrixNode | undefined;
    children: RowItem[];
    isGrandTotal: boolean;
}

export interface MatrixModel {
    measures: Measure[];
    sections: number[];
    groups: ColumnGroup[];
    columns: ValueColumn[];
    columnLevelNames: string[];
    rowLevelNames: string[];
    rows: RowItem[];
    grandTotal: RowItem | undefined;
    rowLevels: powerbi.DataViewHierarchyLevel[];
    /** Índice da folha da hierarquia de colunas para (grupo, medida). */
    leafIndex: Map<string, number>;
}

function sectionOf(source: DataViewMetadataColumn): number {
    for (let i = 1; i <= SECTION_COUNT; i++) {
        if (source.roles?.[`sec${i}`]) {
            return i;
        }
    }
    return 0;
}

function memberLabel(value: PrimitiveValue, source: DataViewMetadataColumn | undefined, locale: string): string {
    if (value === null || value === undefined || value === "") {
        return "(Em branco)";
    }
    if (source?.format || value instanceof Date) {
        return valueFormatter.format(value, source?.format, false, locale);
    }
    return String(value);
}

function memberKey(value: PrimitiveValue): string {
    return value instanceof Date ? "d" + value.getTime() : typeof value + ":" + String(value);
}

function hasValues(node: DataViewMatrixNode): boolean {
    return !!node.values && Object.keys(node.values).length > 0;
}

export function cellKey(groupKey: string, measureIndex: number): string {
    return groupKey + "|" + measureIndex;
}

export function buildModel(dataView: DataView | undefined, locale: string, totalLabel: string): MatrixModel | undefined {
    const matrix = dataView?.matrix;
    if (!matrix || !matrix.valueSources?.length) {
        return undefined;
    }

    const measures: Measure[] = matrix.valueSources.map((source, index) => {
        const formatter = valueFormatter.create({ format: source.format, cultureSelector: locale });
        return {
            index,
            source,
            name: source.displayName,
            queryName: source.queryName || source.displayName,
            section: sectionOf(source),
            format: (v: PrimitiveValue) => formatter.format(v)
        };
    });

    // ---- colunas: percorre a hierarquia e guarda o índice de cada folha
    const colLevels = matrix.columns?.levels || [];
    const lastIsMeasure = colLevels.length > 0 && !!colLevels[colLevels.length - 1].sources?.[0]?.isMeasure;
    const memberLevelCount = lastIsMeasure ? colLevels.length - 1 : colLevels.length;
    const columnLevelNames = colLevels.slice(0, memberLevelCount).map(l => l.sources.map(s => s.displayName).join(" / "));

    const groups: ColumnGroup[] = [];
    const groupByKey = new Map<string, ColumnGroup>();
    const leafIndex = new Map<string, number>();
    let leafCounter = 0;

    const walkColumns = (node: DataViewMatrixNode, labels: string[], keys: string[], subtotal: boolean): void => {
        const children = node.children || [];
        if (children.length === 0) {
            const isMeasureLeaf = lastIsMeasure && (node.level === colLevels.length - 1);
            const measureIndex = isMeasureLeaf
                ? (node.levelValues?.[0]?.levelSourceIndex ?? node.levelSourceIndex ?? 0)
                : 0;
            const key = keys.join("\u001f");
            let group = groupByKey.get(key);
            if (!group) {
                group = { key, labels: labels.slice(), isSubtotal: subtotal };
                groupByKey.set(key, group);
                groups.push(group);
            }
            leafIndex.set(cellKey(key, measureIndex), leafCounter++);
            return;
        }
        for (const child of children) {
            const isMemberLevel = child.level !== undefined && child.level < memberLevelCount;
            if (isMemberLevel) {
                const src = colLevels[child.level].sources[child.levelValues?.[0]?.levelSourceIndex ?? 0];
                const label = child.isSubtotal ? totalLabel : memberLabel(child.levelValues?.[0]?.value, src, locale);
                const key = child.isSubtotal ? "#total" : memberKey(child.levelValues?.[0]?.value);
                walkColumns(child, labels.concat(label), keys.concat(key), subtotal || !!child.isSubtotal);
            } else {
                walkColumns(child, labels, keys, subtotal);
            }
        }
    };
    if (matrix.columns?.root) {
        walkColumns(matrix.columns.root, [], [], false);
    }
    if (groups.length === 0) {
        const group = { key: "", labels: [], isSubtotal: false };
        groups.push(group);
        groupByKey.set("", group);
        measures.forEach(m => leafIndex.set(cellKey("", m.index), m.index));
    }

    // ---- seções e colunas visíveis: seção > grupo de colunas > medida
    const sections = Array.from(new Set(measures.filter(m => m.section > 0).map(m => m.section))).sort((a, b) => a - b);
    const columns: ValueColumn[] = [];
    for (const section of sections) {
        const sectionMeasures = measures.filter(m => m.section === section);
        for (const group of groups) {
            for (const measure of sectionMeasures) {
                if (leafIndex.has(cellKey(group.key, measure.index))) {
                    columns.push({ section, group, measure });
                }
            }
        }
    }

    // ---- linhas
    const rowLevels = matrix.rows?.levels || [];
    const rowLevelNames = rowLevels.map(l => l.sources.map(s => s.displayName).join(" / "));
    let grandTotal: RowItem | undefined;

    const buildRows = (parent: DataViewMatrixNode, parentId: string): RowItem[] => {
        const items: RowItem[] = [];
        for (const node of parent.children || []) {
            if (node.isSubtotal) {
                continue;
            }
            const level = node.level ?? 0;
            const value = node.levelValues?.[0]?.value;
            const src = rowLevels[level]?.sources[node.levelValues?.[0]?.levelSourceIndex ?? 0];
            const id = parentId + "\u001f" + memberKey(value);
            const children = buildRows(node, id);
            const subtotal = (node.children || []).find(c => c.isSubtotal);
            items.push({
                id,
                label: memberLabel(value, src, locale),
                level,
                node,
                // O valor da linha de cima vem do próprio nó ou do nó de subtotal dela (depende do Power BI).
                valuesNode: hasValues(node) ? node : subtotal,
                children,
                isGrandTotal: false
            });
        }
        return items;
    };

    const root = matrix.rows?.root;
    let rows: RowItem[] = [];
    if (root) {
        if (rowLevels.length === 0 || !(root.children || []).some(c => c.levelValues?.length)) {
            // Sem campos em "Linhas": uma única linha com os totais.
            const node = (root.children || [])[0] || root;
            grandTotal = { id: "#total", label: totalLabel, level: 0, node, valuesNode: node, children: [], isGrandTotal: true };
        } else {
            rows = buildRows(root, "");
            const totalNode = (root.children || []).find(c => c.isSubtotal);
            if (totalNode) {
                grandTotal = {
                    id: "#total", label: totalLabel, level: 0, node: totalNode, valuesNode: totalNode, children: [], isGrandTotal: true
                };
            }
        }
    }

    return { measures, sections, groups, columns, columnLevelNames, rowLevelNames, rows, grandTotal, rowLevels, leafIndex };
}

/** Valor bruto de uma medida numa linha, para um grupo de colunas. */
export function cellValue(model: MatrixModel, row: RowItem, groupKey: string, measureIndex: number): DataViewMatrixNodeValue | undefined {
    const j = model.leafIndex.get(cellKey(groupKey, measureIndex));
    if (j === undefined || !row.valuesNode?.values) {
        return undefined;
    }
    return row.valuesNode.values[j];
}
