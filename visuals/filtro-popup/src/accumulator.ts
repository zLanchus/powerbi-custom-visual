"use strict";

import powerbi from "powerbi-visuals-api";

import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { valueKey } from "./filters";

const SEP = "\u001f";

/** Um grupo de colunas que precisa das combinações (filtro aninhado) ou uma coluna isolada. */
interface Group {
    indexes: number[];
    /** Combinações distintas (chave → valores de cada coluna do grupo), na ordem em que chegaram. */
    rows: Map<string, PrimitiveValue[]>;
}

/**
 * Guarda só o que o visual precisa das linhas que o Power BI envia:
 * - filtros sem aninhamento: os valores distintos de cada coluna;
 * - filtros aninhados: as combinações distintas entre as colunas da árvore.
 *
 * Com isso o visual pede os dados em partes (sem que o Power BI junte todas as
 * partes num conjunto cada vez maior) e descarta as linhas já lidas: a memória
 * fica proporcional aos valores distintos, não ao total de combinações.
 */
export class SegmentAccumulator {
    private signature = "";
    private sources: DataViewCategoryColumn["source"][] = [];
    private groups: Group[] = [];
    /** Linhas recebidas desde a última consulta nova. */
    public rowsRead = 0;

    /**
     * Junta uma parte dos dados.
     * @param reset true quando é uma consulta nova (filtros, campos ou dados mudaram).
     * @param groupOf papel de cada coluna que forma um grupo (filtro aninhado com mais de uma coluna) ou undefined.
     */
    public add(categories: DataViewCategoryColumn[], reset: boolean, groupOf: (c: DataViewCategoryColumn) => string | undefined): void {
        const signature = categories.map(c => (c.source.queryName || c.source.displayName) + "#" + Object.keys(c.source.roles || {}).join(",")).join("|");
        if (reset || signature !== this.signature) {
            this.signature = signature;
            this.sources = categories.map(c => c.source);
            this.rowsRead = 0;
            const byRole = new Map<string, number[]>();
            const groups: Group[] = [];
            categories.forEach((c, i) => {
                const role = groupOf(c);
                if (role) {
                    const list = byRole.get(role) || [];
                    if (list.length === 0) {
                        byRole.set(role, list);
                        groups.push({ indexes: list, rows: new Map() });
                    }
                    list.push(i);
                } else {
                    groups.push({ indexes: [i], rows: new Map() });
                }
            });
            this.groups = groups;
        }

        const count = categories[0]?.values.length || 0;
        this.rowsRead += count;
        for (const group of this.groups) {
            const columns = group.indexes.map(i => categories[i].values);
            for (let r = 0; r < count; r++) {
                const values = columns.map(c => c[r]);
                const key = values.length === 1 ? valueKey(values[0]) : values.map(valueKey).join(SEP);
                if (!group.rows.has(key)) {
                    group.rows.set(key, values);
                }
            }
        }
    }

    /** Colunas compactas no mesmo formato do Power BI (cada grupo com as próprias linhas distintas). */
    public categories(): DataViewCategoryColumn[] {
        const result: DataViewCategoryColumn[] = this.sources.map(source => ({ source, values: [] } as DataViewCategoryColumn));
        for (const group of this.groups) {
            const rows = Array.from(group.rows.values());
            group.indexes.forEach((index, k) => {
                (result[index] as { values: PrimitiveValue[] }).values = rows.map(row => row[k]);
            });
        }
        return result;
    }
}
