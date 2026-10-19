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
import { FieldModel, FieldState, ValueItem, emptyState, sameTarget, valueKey } from "./filters";

import PrimitiveValue = powerbi.PrimitiveValue;

const SEP = "\u001f";

export interface TreeNode {
    /** Caminho completo (valores de todos os níveis até aqui): Ano 2024 › Mês 3 ≠ Ano 2025 › Mês 3. */
    id: string;
    level: number;
    item: ValueItem;
    children: TreeNode[];
    /** Ids das folhas (último nível) abaixo deste nó. */
    leafKeys: string[];
}

/** Colunas de um mesmo espaço "Filtro aninhado N", mostradas como uma árvore. */
export interface NestedGroup {
    levels: FieldModel[];
    roots: TreeNode[];
    nodes: Map<string, TreeNode>;
    /** Valores de cada nível no caminho de cada folha. */
    leafPath: Map<string, PrimitiveValue[]>;
}

function childId(parent: TreeNode | undefined, key: string): string {
    return parent ? parent.id + SEP + key : key;
}

export function buildTree(levels: FieldModel[], columns: PrimitiveValue[][]): NestedGroup {
    const nodes = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];
    const leafPath = new Map<string, PrimitiveValue[]>();
    const lookups = levels.map(f => new Map(f.values.map(v => [v.key, v])));
    const depth = levels.length;
    const rows = columns[0]?.length || 0;

    for (let r = 0; r < rows; r++) {
        let parent: TreeNode | undefined;
        for (let l = 0; l < depth; l++) {
            const raw = columns[l][r];
            const key = valueKey(raw);
            const id = childId(parent, key);
            let node = nodes.get(id);
            if (!node) {
                node = { id, level: l, item: lookups[l].get(key) || { key, raw, label: String(raw) }, children: [], leafKeys: [] };
                nodes.set(id, node);
                (parent ? parent.children : roots).push(node);
                if (l === depth - 1) {
                    leafPath.set(id, columns.map(c => c[r]));
                }
            }
            parent = node;
        }
    }

    const finish = (list: TreeNode[]): void => {
        for (const node of list) {
            if (node.children.length) {
                finish(node.children);
                node.leafKeys = node.children.flatMap(c => c.leafKeys);
            } else {
                node.leafKeys = [node.id];
            }
        }
    };
    finish(roots);

    return { levels, roots, nodes, leafPath };
}

function toFilterValue(raw: PrimitiveValue): PrimitiveValueType {
    if (raw instanceof Date) {
        return raw.toJSON();
    }
    return (raw === undefined || raw === "" ? null : raw) as PrimitiveValueType;
}

function fromFilterValue(value: unknown, level: FieldModel): PrimitiveValue {
    if (level.kind === "date" && typeof value === "string") {
        return new Date(value);
    }
    return value as PrimitiveValue;
}

/** Nós mais altos que estão totalmente marcados (resumo da seleção). */
export function coverNodes(nodes: TreeNode[], selected: { has(key: string): boolean }): TreeNode[] {
    const result: TreeNode[] = [];
    for (const node of nodes) {
        const count = node.leafKeys.filter(k => selected.has(k)).length;
        if (count === 0) {
            continue;
        }
        if (count === node.leafKeys.length) {
            result.push(node);
        } else {
            result.push(...coverNodes(node.children, selected));
        }
    }
    return result;
}

/**
 * Filtro da árvore. Se só há itens inteiros do 1º nível marcados, usa um filtro
 * simples nessa coluna; caso contrário, um filtro de várias colunas (tupla) com
 * o caminho completo de cada folha marcada, que é exato mesmo quando o mesmo
 * valor aparece em vários pais (ex.: o mês 3 de 2024 e o mês 3 de 2025).
 */
export function buildTreeFilter(group: NestedGroup, state: FieldState, singleSelect: boolean): IBasicFilter | ITupleFilter | undefined {
    if (state.selected.size === 0) {
        return undefined;
    }
    const cover = coverNodes(group.roots, state.selected);
    if (cover.every(n => n.level === 0)) {
        const filter = new BasicFilter(group.levels[0].target, "In", cover.map(n => toFilterValue(n.item.raw)));
        filter.requireSingleSelection = singleSelect && cover.length === 1;
        return filter.toJSON();
    }

    const values = Array.from(state.selected.keys())
        .map(id => group.leafPath.get(id))
        .filter(path => !!path)
        .map(path => path.map(raw => ({ value: toFilterValue(raw) })));
    return new TupleFilter(group.levels.map(l => l.target), "In", values).toJSON();
}

function sameTargets(a: IFilterTarget[], b: IFilterTarget[]): boolean {
    return a.length === b.length && a.every((t, i) => sameTarget(t, b[i]));
}

/** Reconstrói a seleção da árvore a partir dos filtros salvos no relatório. */
export function treeStateFromFilters(group: NestedGroup, filters: Array<{ filterType?: number; target?: unknown }>): FieldState {
    const state = emptyState();
    const targets = group.levels.map(l => l.target);

    for (const filter of filters) {
        if (!filter || !filter.target) {
            continue;
        }
        if (filter.filterType === FilterType.Tuple && Array.isArray(filter.target)
            && sameTargets(filter.target as IFilterTarget[], targets)) {
            for (const tuple of (filter as ITupleFilter).values) {
                let id = "";
                tuple.forEach((element, l) => {
                    const key = valueKey(fromFilterValue(element.value, group.levels[l]));
                    id = l === 0 ? key : id + SEP + key;
                });
                if (group.leafPath.has(id)) {
                    state.selected.set(id, null);
                }
            }
        } else if (filter.filterType === FilterType.Basic && !Array.isArray(filter.target)
            && sameTarget(filter.target as IFilterTarget, targets[0])) {
            for (const value of (filter as IBasicFilter).values) {
                const root = group.nodes.get(valueKey(fromFilterValue(value, group.levels[0])));
                root?.leafKeys.forEach(k => state.selected.set(k, null));
            }
        }
    }
    return state;
}
