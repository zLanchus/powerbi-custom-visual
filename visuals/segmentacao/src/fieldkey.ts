"use strict";

import powerbi from "powerbi-visuals-api";
import { IFilterTarget } from "powerbi-models";

import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

/**
 * Chave oculta de colunas como as de parâmetros de campo.
 *
 * Num parâmetro de campo, a coluna exibida ("Parâmetro") é agrupada por uma coluna oculta
 * ("Parâmetro Campos", com valores como 'Medidas'[Vendas]). O Power BI não aceita filtro pelo texto
 * exibido nessas colunas; a segmentação nativa filtra pela coluna oculta. Aqui o visual descobre essa
 * coluna (identityFields) e, para cada linha, o valor da chave (dentro da identidade da linha).
 *
 * A identidade é "opaca" na API, mas em tempo de execução traz a expressão que a define
 * (ex.: Coluna oculta = 'Medidas'[Vendas]). Se o formato não for o esperado, as funções devolvem
 * undefined e o visual usa a seleção como reserva.
 */

interface ExprNode {
    source?: { entity?: string };
    entity?: string;
    ref?: string;
    arg?: ExprNode;
    left?: ExprNode;
    right?: ExprNode;
    value?: unknown;
    [key: string]: unknown;
}

function entityOf(node: ExprNode | undefined): string | undefined {
    while (node) {
        if (node.source?.entity) {
            return node.source.entity;
        }
        if (typeof node.entity === "string") {
            return node.entity;
        }
        node = node.arg;
    }
    return undefined;
}

/** Tabela/coluna de uma referência de coluna. */
function columnTarget(node: ExprNode | undefined): IFilterTarget | undefined {
    const entity = entityOf(node);
    return node && entity && typeof node.ref === "string" ? { table: entity, column: node.ref } : undefined;
}

function sameColumn(a: IFilterTarget | undefined, b: IFilterTarget | undefined): boolean {
    const x = a as { table?: string; column?: string } | undefined;
    const y = b as { table?: string; column?: string } | undefined;
    return !!x && !!y && x.table === y.table && x.column === y.column;
}

/** Coluna oculta que identifica cada item, quando é diferente da coluna exibida. */
export function hiddenKeyTarget(category: DataViewCategoryColumn | undefined): IFilterTarget | undefined {
    const keys = category?.identityFields as unknown as ExprNode[] | undefined;
    if (!category || keys?.length !== 1) {
        return undefined;
    }
    const key = columnTarget(keys[0]);
    const shown = columnTarget(category.source.expr as unknown as ExprNode);
    return key && !sameColumn(key, shown) ? key : undefined;
}

/** Procura, na expressão da identidade, "coluna = constante" para a coluna pedida. */
function findConstant(node: unknown, target: IFilterTarget, depth = 0): { found: boolean; value?: PrimitiveValue } {
    if (!node || typeof node !== "object" || depth > 12) {
        return { found: false };
    }
    const n = node as ExprNode;
    if (n.left && n.right && sameColumn(columnTarget(n.left), target)) {
        const v = n.right.value;
        if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
            return { found: true, value: v as PrimitiveValue };
        }
    }
    for (const child of Object.values(n)) {
        if (child && typeof child === "object") {
            const hit = findConstant(child, target, depth + 1);
            if (hit.found) {
                return hit;
            }
        }
    }
    return { found: false };
}

/** Valor da chave oculta em cada linha; undefined se alguma linha não puder ser lida. */
export function hiddenKeyValues(category: DataViewCategoryColumn, target: IFilterTarget): PrimitiveValue[] | undefined {
    // "expr" é um getter no Power BI; ao atravessar o iframe pode chegar só o campo interno "_expr".
    const identities = category.identity as unknown as Array<{ expr?: unknown; _expr?: unknown }> | undefined;
    if (!identities || identities.length !== category.values.length) {
        return undefined;
    }
    const values: PrimitiveValue[] = [];
    for (const identity of identities) {
        const hit = findConstant(identity?.expr ?? identity?._expr, target);
        if (!hit.found) {
            return undefined;
        }
        values.push(hit.value);
    }
    return values;
}
