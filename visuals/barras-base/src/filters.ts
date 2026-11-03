"use strict";

import powerbi from "powerbi-visuals-api";
import {
    BasicFilter,
    FilterType,
    IBasicFilter,
    IFilterTarget,
    ITupleFilter,
    PrimitiveValueType,
    TupleFilter
} from "powerbi-models";

import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

/** O que está selecionado: barras inteiras (categoria), itens da legenda ou segmentos (categoria + legenda). */
export type SelectionKind = "category" | "legend" | "segment";

export interface SelectionItem {
    /** Chave do valor da categoria (vazia quando kind = "legend"). */
    cat: string;
    /** Chave do item da legenda (vazia quando kind = "category"). */
    leg: string;
    catRaw?: PrimitiveValue;
    legRaw?: PrimitiveValue;
}

export interface Selection {
    kind: SelectionKind;
    items: Map<string, SelectionItem>;
}

export function emptySelection(): Selection {
    return { kind: "category", items: new Map() };
}

export function itemKey(item: SelectionItem): string {
    return item.cat + "\u0001" + item.leg;
}

export function valueKey(raw: PrimitiveValue | undefined): string {
    if (raw === null || raw === undefined || raw === "") {
        return "blank";
    }
    if (raw instanceof Date) {
        return "d:" + raw.getTime();
    }
    return typeof raw + ":" + String(raw);
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

export function sameTarget(a: IFilterTarget | undefined, b: IFilterTarget | undefined): boolean {
    if (!a || !b) {
        return false;
    }
    const x = a as unknown as Record<string, unknown>;
    const y = b as unknown as Record<string, unknown>;
    return x.table === y.table
        && x.column === y.column
        && x.hierarchy === y.hierarchy
        && x.hierarchyLevel === y.hierarchyLevel;
}

/** Converte valor do data view para o formato aceito pelos filtros JSON do Power BI. */
function toFilterValue(raw: PrimitiveValue | undefined): PrimitiveValueType {
    if (raw instanceof Date) {
        return raw.toJSON();
    }
    if (raw === undefined || raw === "") {
        return null as unknown as PrimitiveValueType;
    }
    return raw as PrimitiveValueType;
}

/** Valor que volta do filtro: datas chegam como texto. */
function fromFilterValue(value: unknown, isDate: boolean): PrimitiveValue {
    if (isDate && typeof value === "string") {
        const d = new Date(value);
        return isNaN(d.getTime()) ? value : d;
    }
    return value as PrimitiveValue;
}

/** Filtro JSON equivalente à seleção (básico para categoria ou legenda; de tupla para segmentos). */
export function buildFilter(selection: Selection, catTarget: IFilterTarget, legTarget: IFilterTarget | undefined): IBasicFilter | ITupleFilter | undefined {
    const items = Array.from(selection.items.values());
    if (items.length === 0) {
        return undefined;
    }
    if (selection.kind === "category" || (selection.kind === "segment" && !legTarget)) {
        return new BasicFilter(catTarget, "In", items.map(i => toFilterValue(i.catRaw))).toJSON();
    }
    if (selection.kind === "legend") {
        return legTarget ? new BasicFilter(legTarget, "In", items.map(i => toFilterValue(i.legRaw))).toJSON() : undefined;
    }
    const tuples = items.map(i => [{ value: toFilterValue(i.catRaw) }, { value: toFilterValue(i.legRaw) }]);
    return new TupleFilter([catTarget, legTarget], "In", tuples).toJSON();
}

/** Filtro de uma coluna da base (lista de valores marcados). */
export function buildColumnFilter(target: IFilterTarget, values: PrimitiveValue[]): IBasicFilter {
    return new BasicFilter(target, "In", values.map(toFilterValue)).toJSON();
}

function targetKey(target: IFilterTarget): string {
    const t = target as unknown as Record<string, unknown>;
    return [t.table, t.column, t.hierarchy, t.hierarchyLevel].join("\u0001");
}

/** Junta filtros do mesmo campo (ex.: barra clicada + filtro da coluna do Eixo) pela interseção dos valores. */
export function mergeFilters(filters: Array<IBasicFilter | ITupleFilter>): Array<IBasicFilter | ITupleFilter> {
    const out: Array<IBasicFilter | ITupleFilter> = [];
    const basic = new Map<string, IBasicFilter>();
    for (const f of filters) {
        if (f.filterType !== FilterType.Basic || Array.isArray(f.target)) {
            out.push(f);
            continue;
        }
        const b = f as IBasicFilter;
        const key = targetKey(b.target as IFilterTarget);
        const current = basic.get(key);
        if (!current) {
            basic.set(key, b);
            out.push(b);
        } else {
            const keep = new Set(b.values.map(v => JSON.stringify(v)));
            current.values = current.values.filter(v => keep.has(JSON.stringify(v)));
        }
    }
    return out;
}

/** Forma comparável de uma lista de filtros (só campos e valores), para saber se o Power BI trouxe um estado novo. */
export function canonicalFilters(filters: powerbi.IFilter[] | undefined): string {
    // Aceita lista aninhada (alguns hosts devolvem o grupo de filtros aplicado de uma vez como um item só).
    const flat = (filters || []).flat() as powerbi.IFilter[];
    const list = flat.map(f => {
        const x = f as unknown as { target?: IFilterTarget | IFilterTarget[]; values?: unknown[] };
        const targets = Array.isArray(x.target) ? x.target : x.target ? [x.target] : [];
        const values = (x.values || []).map(v => JSON.stringify(v)).sort();
        return targets.map(targetKey).join("+") + "=" + values.join(",");
    });
    return list.sort().join("|");
}

/** Filtros de colunas da base (campos que não são o Eixo nem a Legenda) vindos de options.jsonFilters. */
export function columnFiltersFrom(
    filters: powerbi.IFilter[] | undefined,
    columns: Array<{ id: string; filter?: { target: IFilterTarget; isDate: boolean } }>,
    exclude: Array<IFilterTarget | undefined>
): Map<string, Map<string, PrimitiveValue>> {
    const out = new Map<string, Map<string, PrimitiveValue>>();
    for (const f of (filters || []).flat() as powerbi.IFilter[]) {
        const filter = f as unknown as IBasicFilter;
        if (filter?.filterType !== FilterType.Basic || !filter.target || Array.isArray(filter.target)) {
            continue;
        }
        const target = filter.target as IFilterTarget;
        if (exclude.some(t => sameTarget(t, target))) {
            continue;
        }
        const column = columns.find(c => c.filter && sameTarget(c.filter.target, target));
        if (!column?.filter) {
            continue;
        }
        const values = new Map<string, PrimitiveValue>();
        for (const v of filter.values || []) {
            const raw = fromFilterValue(v, column.filter.isDate);
            values.set(valueKey(raw), raw);
        }
        out.set(column.id, values);
    }
    return out;
}

/** Reconstrói a seleção a partir do filtro que o Power BI devolve em options.jsonFilters. */
export function selectionFromFilters(
    filters: powerbi.IFilter[] | undefined,
    cat: { target: IFilterTarget; isDate: boolean },
    leg: { target: IFilterTarget; isDate: boolean } | undefined
): Selection {
    const selection = emptySelection();
    for (const f of (filters || []).flat() as powerbi.IFilter[]) {
        const filter = f as unknown as IBasicFilter | ITupleFilter;
        if (!filter?.target) {
            continue;
        }
        if (filter.filterType === FilterType.Tuple && Array.isArray(filter.target) && leg) {
            const [a, b] = filter.target as IFilterTarget[];
            if (!sameTarget(a, cat.target) || !sameTarget(b, leg.target)) {
                continue;
            }
            selection.kind = "segment";
            for (const tuple of (filter as ITupleFilter).values || []) {
                const catRaw = fromFilterValue(tuple[0]?.value, cat.isDate);
                const legRaw = fromFilterValue(tuple[1]?.value, leg.isDate);
                const item = { cat: valueKey(catRaw), leg: valueKey(legRaw), catRaw, legRaw };
                selection.items.set(itemKey(item), item);
            }
            return selection;
        }
        if (filter.filterType === FilterType.Basic && !Array.isArray(filter.target)) {
            const target = filter.target as IFilterTarget;
            const isCat = sameTarget(target, cat.target);
            const isLeg = !isCat && !!leg && sameTarget(target, leg.target);
            if (!isCat && !isLeg) {
                continue;
            }
            selection.kind = isCat ? "category" : "legend";
            for (const v of (filter as IBasicFilter).values || []) {
                const raw = fromFilterValue(v, isCat ? cat.isDate : !!leg?.isDate);
                const item: SelectionItem = isCat
                    ? { cat: valueKey(raw), leg: "", catRaw: raw }
                    : { cat: "", leg: valueKey(raw), legRaw: raw };
                selection.items.set(itemKey(item), item);
            }
            return selection;
        }
    }
    return selection;
}
