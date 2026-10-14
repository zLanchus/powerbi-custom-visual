"use strict";

import powerbi from "powerbi-visuals-api";
import {
    AdvancedFilter,
    BasicFilter,
    FilterType,
    IAdvancedFilter,
    IAdvancedFilterCondition,
    IBasicFilter,
    IFilterTarget,
    PrimitiveValueType
} from "powerbi-models";

import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

export type FieldKind = "text" | "number" | "date" | "bool";

export interface ValueItem {
    key: string;
    raw: PrimitiveValue;
    label: string;
}

export interface FieldModel {
    key: string;
    displayName: string;
    kind: FieldKind;
    target: IFilterTarget;
    values: ValueItem[];
}

/** Estado de seleção de um campo: lista de valores marcados ou intervalo de/até. */
export interface FieldState {
    selected: Map<string, PrimitiveValue>;
    rangeFrom: string;
    rangeTo: string;
}

export const BLANK_LABEL = "(Em branco)";

export function emptyState(): FieldState {
    return { selected: new Map(), rangeFrom: "", rangeTo: "" };
}

export function isActive(state: FieldState | undefined): boolean {
    return !!state && (state.selected.size > 0 || state.rangeFrom !== "" || state.rangeTo !== "");
}

export function getKind(column: DataViewMetadataColumn): FieldKind {
    const type = column.type;
    if (type?.dateTime) {
        return "date";
    }
    if (type?.numeric || type?.integer) {
        return "number";
    }
    if (type?.bool) {
        return "bool";
    }
    return "text";
}

interface ExprNode {
    source?: { entity?: string };
    entity?: string;
    ref?: string;
    arg?: ExprNode;
    hierarchy?: string;
    level?: string;
}

function findEntity(node: ExprNode | undefined): string | undefined {
    while (node) {
        if (node.source?.entity) {
            return node.source.entity;
        }
        if (node.entity) {
            return node.entity;
        }
        node = node.arg;
    }
    return undefined;
}

/** Descobre a tabela/coluna (ou hierarquia/nível) que o filtro deve atingir. */
export function getTarget(column: DataViewMetadataColumn): IFilterTarget {
    const expr = column.expr as unknown as ExprNode | undefined;
    const entity = findEntity(expr);

    if (expr && entity) {
        if (expr.ref) {
            return { table: entity, column: expr.ref };
        }
        if (expr.level && expr.arg?.hierarchy) {
            return { table: entity, hierarchy: expr.arg.hierarchy, hierarchyLevel: expr.level };
        }
    }

    const queryName = column.queryName || column.displayName;
    const dot = queryName.indexOf(".");
    return dot > 0
        ? { table: queryName.substring(0, dot), column: queryName.substring(dot + 1) }
        : { table: queryName, column: column.displayName };
}

export function sameTarget(a: IFilterTarget, b: IFilterTarget): boolean {
    const x = a as unknown as Record<string, unknown>;
    const y = b as unknown as Record<string, unknown>;
    return x.table === y.table
        && x.column === y.column
        && x.hierarchy === y.hierarchy
        && x.hierarchyLevel === y.hierarchyLevel;
}

export function valueKey(raw: PrimitiveValue): string {
    if (raw === null || raw === undefined || raw === "") {
        return "blank";
    }
    if (raw instanceof Date) {
        return "d:" + raw.getTime();
    }
    return typeof raw + ":" + String(raw);
}

export function formatValue(raw: PrimitiveValue, kind: FieldKind): string {
    if (raw === null || raw === undefined || raw === "") {
        return BLANK_LABEL;
    }
    if (raw instanceof Date) {
        const hasTime = raw.getHours() !== 0 || raw.getMinutes() !== 0 || raw.getSeconds() !== 0;
        return hasTime ? raw.toLocaleString("pt-BR") : raw.toLocaleDateString("pt-BR");
    }
    if (typeof raw === "number") {
        // Inteiros sem separador de milhar (anos, códigos); decimais no padrão pt-BR.
        return Number.isInteger(raw) ? String(raw) : raw.toLocaleString("pt-BR");
    }
    if (typeof raw === "boolean" || kind === "bool") {
        return raw ? "Verdadeiro" : "Falso";
    }
    return String(raw);
}

export function compareValues(a: ValueItem, b: ValueItem): number {
    const blankA = a.key === "blank";
    const blankB = b.key === "blank";
    if (blankA || blankB) {
        return blankA === blankB ? 0 : blankA ? 1 : -1;
    }
    const x = a.raw instanceof Date ? a.raw.getTime() : a.raw;
    const y = b.raw instanceof Date ? b.raw.getTime() : b.raw;
    if (typeof x === "number" && typeof y === "number") {
        return x - y;
    }
    return String(x).localeCompare(String(y), "pt-BR", { numeric: true, sensitivity: "base" });
}

/** Converte valor do data view para o formato aceito pelos filtros JSON do Power BI. */
function toFilterValue(raw: PrimitiveValue): PrimitiveValueType {
    if (raw instanceof Date) {
        return raw.toJSON();
    }
    if (raw === undefined || raw === "") {
        return null as unknown as PrimitiveValueType;
    }
    return raw as PrimitiveValueType;
}

/** Converte o texto de um <input type="date|number"> em valor de filtro. */
function parseRangeInput(text: string, kind: FieldKind, endOfRange: boolean): PrimitiveValueType | undefined {
    if (text === "") {
        return undefined;
    }
    if (kind === "date") {
        const [y, m, d] = text.split("-").map(Number);
        if (!y || !m || !d) {
            return undefined;
        }
        // "Até" inclui o dia inteiro: usa < dia seguinte.
        return new Date(y, m - 1, endOfRange ? d + 1 : d).toJSON();
    }
    const n = Number(text.replace(",", "."));
    return isNaN(n) ? undefined : n;
}

export function buildFilter(field: FieldModel, state: FieldState, useRange: boolean, singleSelect: boolean): IBasicFilter | IAdvancedFilter | undefined {
    if (useRange) {
        const conditions: IAdvancedFilterCondition[] = [];
        const from = parseRangeInput(state.rangeFrom, field.kind, false);
        const to = parseRangeInput(state.rangeTo, field.kind, true);
        if (from !== undefined) {
            conditions.push({ operator: "GreaterThanOrEqual", value: from });
        }
        if (to !== undefined) {
            conditions.push({ operator: field.kind === "date" ? "LessThan" : "LessThanOrEqual", value: to });
        }
        return conditions.length
            ? new AdvancedFilter(field.target, "And", conditions).toJSON()
            : undefined;
    }

    if (state.selected.size === 0) {
        return undefined;
    }
    const values = Array.from(state.selected.values()).map(toFilterValue);
    const filter = new BasicFilter(field.target, "In", values);
    filter.requireSingleSelection = singleSelect;
    return filter.toJSON();
}

function pad(n: number): string {
    return n < 10 ? "0" + n : String(n);
}

function toDateInput(date: Date): string {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

/** Reconstrói o estado do campo a partir do filtro que o Power BI devolve em options.jsonFilters. */
export function stateFromFilter(field: FieldModel, filter: IBasicFilter | IAdvancedFilter): FieldState {
    const state = emptyState();

    if (filter.filterType === FilterType.Basic) {
        const byKey = new Map(field.values.map(v => [v.key, v.raw]));
        for (const v of (filter as IBasicFilter).values) {
            let raw: PrimitiveValue = v as PrimitiveValue;
            if (field.kind === "date" && typeof v === "string") {
                raw = new Date(v);
            }
            const key = valueKey(raw);
            state.selected.set(key, byKey.has(key) ? byKey.get(key) : raw);
        }
    } else if (filter.filterType === FilterType.Advanced) {
        for (const c of (filter as IAdvancedFilter).conditions || []) {
            let text = "";
            if (field.kind === "date") {
                const d = new Date(c.value as string);
                if (c.operator === "LessThan") {
                    d.setDate(d.getDate() - 1);
                }
                text = isNaN(d.getTime()) ? "" : toDateInput(d);
            } else {
                text = String(c.value);
            }
            if (c.operator === "GreaterThanOrEqual" || c.operator === "GreaterThan") {
                state.rangeFrom = text;
            } else {
                state.rangeTo = text;
            }
        }
    }
    return state;
}
