"use strict";

import powerbi from "powerbi-visuals-api";
import { IFilterTarget } from "powerbi-models";

import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { FieldKind, FieldModel, ValueItem, compareValues, formatValue, valueKey } from "./filters";
import { NestedGroup, buildTree } from "./hierarchy";

/**
 * Modo catálogo: em vez das colunas reais, o visual recebe uma tabela pequena do modelo com
 * uma linha por valor de cada filtro (Filtro, Coluna, Valor, Tipo, Ordem). A consulta fica do
 * tamanho da soma dos valores, não do produto das combinações, e cada filtro é aplicado na
 * coluna real indicada em "Coluna".
 */
export const CATALOG_ROLES = ["catName", "catColumn", "catValue", "catType", "catOrder"];
export const CATALOG_GROUP = "catalog";

const LEVEL_SEP = "|";

export function isCatalogColumn(column: DataViewCategoryColumn): boolean {
    return CATALOG_ROLES.some(role => column.source.roles?.[role]);
}

/** "Tabela[Coluna]" ou "'Tabela com espaço'[Coluna]" → alvo do filtro. */
export function parseTarget(text: string): IFilterTarget | undefined {
    const m = /^\s*'?(.+?)'?\s*\[(.+)\]\s*$/.exec(text);
    return m ? { table: m[1].replace(/''/g, "'"), column: m[2].replace(/\]\]/g, "]") } : undefined;
}

function parseKind(text: string | undefined): FieldKind {
    const t = (text || "").trim().toLowerCase();
    if (t.startsWith("n") || t === "inteiro" || t === "decimal") {
        return "number";
    }
    if (t.startsWith("d")) {
        return "date";
    }
    if (t.startsWith("b") || t.startsWith("v") || t === "lógico" || t === "logico") {
        return "bool";
    }
    return "text";
}

/** Converte o texto do catálogo no valor com o tipo da coluna real (o filtro precisa do tipo certo). */
export function parseValue(text: string, kind: FieldKind): PrimitiveValue {
    const t = text.trim();
    if (t === "") {
        return null;
    }
    if (kind === "number") {
        const n = Number(t.replace(/\s/g, "").replace(",", "."));
        return isNaN(n) ? t : n;
    }
    if (kind === "date") {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
        if (m) {
            return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        }
        const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
        if (br) {
            return new Date(+br[3], +br[2] - 1, +br[1]);
        }
        return t;
    }
    if (kind === "bool") {
        return /^(true|verdadeiro|sim|1)$/i.test(t);
    }
    return text;
}

function text(value: PrimitiveValue): string {
    return value === null || value === undefined ? "" : String(value);
}

export interface CatalogResult {
    fields: FieldModel[];
    nested: Map<string, NestedGroup>;
    /** Linhas do catálogo com a coluna em formato inválido (para avisar no pop-up). */
    invalid: string[];
}

interface Row {
    path: PrimitiveValue[];
    order: number | undefined;
}

/**
 * Monta os filtros a partir das colunas do catálogo.
 * @param only nomes dos filtros a mostrar, na ordem desejada (vazio = todos, em ordem alfabética).
 * @param allow quando informado, só entram as linhas aceitas (cascata); o filtro aparece mesmo sem valores.
 */
/** Chaves (valor ou caminho da árvore) de cada filtro do catálogo, por chave do filtro. */
export function catalogKeys(result: CatalogResult): Map<string, Set<string>> {
    const keys = new Map<string, Set<string>>();
    for (const field of result.fields) {
        const tree = result.nested.get(field.key);
        keys.set(field.key, new Set(tree ? Array.from(tree.leafPath.keys()) : field.values.map(v => v.key)));
    }
    return keys;
}

export function buildCatalog(
    categories: DataViewCategoryColumn[],
    only: string[],
    allow?: (fieldKey: string, pathKey: string) => boolean
): CatalogResult {
    const column = (role: string): PrimitiveValue[] | undefined =>
        categories.find(c => c.source.roles?.[role])?.values as PrimitiveValue[] | undefined;
    const names = column("catName") || [];
    const cols = column("catColumn") || [];
    const vals = column("catValue") || [];
    const types = column("catType");
    const orders = column("catOrder");

    interface Group {
        name: string;
        targets: IFilterTarget[];
        columnNames: string[];
        kinds: FieldKind[];
        rows: Row[];
        seen: Set<string>;
    }
    const groups = new Map<string, Group>();
    const invalid = new Set<string>();

    for (let r = 0; r < names.length; r++) {
        const name = text(names[r]).trim();
        if (!name) {
            continue;
        }
        let group = groups.get(name);
        if (!group) {
            const parts = text(cols[r]).split(LEVEL_SEP).map(s => s.trim()).filter(Boolean);
            const targets = parts.map(parseTarget);
            if (!targets.length || targets.some(t => !t)) {
                invalid.add(name + ": " + text(cols[r]));
                continue;
            }
            const kindParts = text(types?.[r]).split(LEVEL_SEP);
            group = {
                name,
                targets: targets as IFilterTarget[],
                columnNames: targets.map(t => (t as { column: string }).column),
                kinds: targets.map((_, i) => parseKind(kindParts[i] ?? kindParts[0])),
                rows: [],
                seen: new Set()
            };
            groups.set(name, group);
        }
        const levels = group.targets.length;
        // Num filtro aninhado os valores vêm como "2025 | jan": separa e tira os espaços em volta do |.
        const valueParts = levels === 1 ? [text(vals[r])] : text(vals[r]).split(LEVEL_SEP).map(v => v.trim());
        const path = group.kinds.map((kind, i) => parseValue(valueParts[i] ?? "", kind));
        const key = path.map(valueKey).join("\u001f");
        if (group.seen.has(key) || (allow && !allow("cat:" + name, key))) {
            continue;
        }
        group.seen.add(key);
        const order = typeof orders?.[r] === "number" ? orders[r] as number : Number(orders?.[r]);
        group.rows.push({ path, order: isFinite(order) && orders?.[r] !== null && orders?.[r] !== "" ? order : undefined });
    }

    const wanted = only.map(s => s.trim().toLowerCase()).filter(Boolean);
    let list = Array.from(groups.values());
    if (wanted.length) {
        list = wanted
            .map(w => list.find(g => g.name.toLowerCase() === w))
            .filter((g): g is Group => !!g);
    } else {
        list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" }));
    }

    const fields: FieldModel[] = [];
    const nested = new Map<string, NestedGroup>();
    for (const g of list) {
        // Ordem: coluna "Ordem" quando existe; senão, pelos valores (números e datas em ordem, texto alfabético).
        g.rows.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
                return a.order - b.order;
            }
            for (let i = 0; i < a.path.length; i++) {
                const c = compareValues(item(a.path[i], g.kinds[i]), item(b.path[i], g.kinds[i]));
                if (c !== 0) {
                    return c;
                }
            }
            return 0;
        });

        const levels: FieldModel[] = g.targets.map((target, i) => {
            const unique = new Map<string, ValueItem>();
            for (const row of g.rows) {
                const v = item(row.path[i], g.kinds[i]);
                if (!unique.has(v.key)) {
                    unique.set(v.key, v);
                }
            }
            return {
                key: "cat:" + g.name + (g.targets.length > 1 ? "#" + i : ""),
                displayName: g.targets.length > 1 ? g.columnNames[i] : g.name,
                kind: g.kinds[i],
                target,
                values: Array.from(unique.values())
            };
        });

        if (levels.length === 1) {
            fields.push(levels[0]);
            continue;
        }
        const tree = buildTree(levels, levels.map((_, i) => g.rows.map(row => row.path[i])));
        const leaves = Array.from(tree.leafPath.keys()).map(id => {
            const node = tree.nodes.get(id);
            return { key: id, raw: node.item.raw, label: node.item.label };
        });
        const field: FieldModel = {
            key: "cat:" + g.name,
            displayName: g.name,
            kind: "text",
            target: levels[0].target,
            values: leaves
        };
        nested.set(field.key, tree);
        fields.push(field);
    }
    return { fields, nested, invalid: Array.from(invalid) };
}

function item(raw: PrimitiveValue, kind: FieldKind): ValueItem {
    return { key: valueKey(raw), raw, label: formatValue(raw, kind) };
}
