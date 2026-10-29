"use strict";

import powerbi from "powerbi-visuals-api";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

import DataView = powerbi.DataView;
import DataViewMatrixNode = powerbi.DataViewMatrixNode;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

export type Formatter = (value: PrimitiveValue) => string;

/** Uma medida da consulta (Valor ou Dicas de ferramenta). */
export interface Measure {
    index: number;
    name: string;
    isValue: boolean;
    format: Formatter;
}

/** Um motivo principal ou um detalhamento. */
export interface Item {
    /** Chave única: motivo, ou motivo + detalhamento. */
    key: string;
    label: string;
    blank: boolean;
    value: number | null;
    /** Posição na ordem do Power BI. */
    order: number;
    node: DataViewMatrixNode;
    /** Nó de onde vêm os valores (o próprio nó ou o subtotal dele). */
    valuesNode: DataViewMatrixNode | undefined;
    /** Detalhamentos (vazio no nível de detalhamento). */
    children: Item[];
    parent: Item | undefined;
}

export interface Model {
    reasonName: string;
    detailName: string;
    hasDetail: boolean;
    value: Measure;
    measures: Measure[];
    /** Motivos na ordem do Power BI. */
    reasons: Item[];
    /** Total geral (do Power BI; na falta dele, soma dos motivos). */
    total: number | null;
    rowLevels: powerbi.DataViewHierarchyLevel[];
    /** Identifica os campos usados (muda quando o usuário troca os campos). */
    signature: string;
}

export const BLANK_LABEL = "(Em branco)";

function memberLabel(value: PrimitiveValue, source: DataViewMetadataColumn | undefined, locale: string): string {
    if (value === null || value === undefined || value === "") {
        return BLANK_LABEL;
    }
    if (source?.format || value instanceof Date) {
        return valueFormatter.format(value, source?.format, false, locale);
    }
    return String(value);
}

function memberKey(value: PrimitiveValue): string {
    return value instanceof Date ? "d" + value.getTime() : typeof value + ":" + String(value);
}

function hasValues(node: DataViewMatrixNode | undefined): boolean {
    return !!node?.values && Object.keys(node.values).length > 0;
}

/** Valor bruto de uma medida num nó (sem colunas, o índice é o da medida). */
export function rawValue(node: DataViewMatrixNode | undefined, measureIndex: number): PrimitiveValue | undefined {
    const values = node?.values;
    if (!values) {
        return undefined;
    }
    for (const key of Object.keys(values)) {
        const cell = values[Number(key)];
        if ((cell.valueSourceIndex ?? Number(key)) === measureIndex) {
            return cell.value;
        }
    }
    return undefined;
}

function toNumber(value: PrimitiveValue | undefined): number | null {
    return typeof value === "number" && isFinite(value) ? value : null;
}

export function buildModel(dataView: DataView | undefined, locale: string): Model | undefined {
    const matrix = dataView?.matrix;
    const rowLevels = matrix?.rows?.levels || [];
    const root = matrix?.rows?.root;
    const sources = matrix?.valueSources || [];
    if (!matrix || !root || rowLevels.length === 0 || sources.length === 0) {
        return undefined;
    }

    const measures: Measure[] = sources.map((source, index) => {
        const formatter = valueFormatter.create({ format: source.format, cultureSelector: locale });
        return {
            index,
            name: source.displayName,
            isValue: !!source.roles?.["value"],
            format: (v: PrimitiveValue) => (v === null || v === undefined ? "—" : formatter.format(v))
        };
    });
    const value = measures.find(m => m.isValue);
    if (!value) {
        return undefined;
    }

    const build = (parent: DataViewMatrixNode, parentItem: Item | undefined): Item[] => {
        const items: Item[] = [];
        for (const node of parent.children || []) {
            if (node.isSubtotal) {
                continue;
            }
            const level = node.level ?? 0;
            const raw = node.levelValues?.[0]?.value;
            const source = rowLevels[level]?.sources[node.levelValues?.[0]?.levelSourceIndex ?? 0];
            const subtotal = (node.children || []).find(c => c.isSubtotal);
            // O valor do motivo vem do próprio nó ou do nó de subtotal dele (depende do Power BI).
            const valuesNode = hasValues(node) ? node : subtotal;
            const item: Item = {
                key: (parentItem ? parentItem.key + "\u001f" : "") + memberKey(raw),
                label: memberLabel(raw, source, locale),
                blank: raw === null || raw === undefined || raw === "",
                value: toNumber(rawValue(valuesNode, value.index)),
                order: items.length,
                node,
                valuesNode,
                children: [],
                parent: parentItem
            };
            if (level === 0 && rowLevels.length > 1) {
                item.children = build(node, item);
            }
            items.push(item);
        }
        return items;
    };

    const reasons = build(root, undefined);
    const totalNode = (root.children || []).find(c => c.isSubtotal);
    let total = toNumber(rawValue(hasValues(totalNode) ? totalNode : hasValues(root) ? root : undefined, value.index));
    if (total === null && reasons.length > 0) {
        total = reasons.reduce((sum, r) => sum + (r.value ?? 0), 0);
    }

    const levelName = (i: number): string => rowLevels[i]?.sources.map(s => s.displayName).join(" / ") || "";
    const levelId = (i: number): string => rowLevels[i]?.sources.map(s => s.queryName || s.displayName).join("|") || "";
    return {
        reasonName: levelName(0),
        detailName: levelName(1),
        hasDetail: rowLevels.length > 1,
        value,
        measures,
        reasons,
        total,
        rowLevels,
        signature: levelId(0) + "\u001e" + levelId(1)
    };
}
