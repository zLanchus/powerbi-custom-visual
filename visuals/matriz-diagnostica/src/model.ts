"use strict";

import powerbi from "powerbi-visuals-api";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

import DataView = powerbi.DataView;
import DataViewMatrixNode = powerbi.DataViewMatrixNode;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import DataViewMatrixNodeValue = powerbi.DataViewMatrixNodeValue;
import DataViewHierarchyLevel = powerbi.DataViewHierarchyLevel;
import PrimitiveValue = powerbi.PrimitiveValue;

/**
 * Papéis da medida: exibida na tabela, detalhe entre parênteses, referência (ex.: metas), base (volume)
 * para a amostra mínima ou só na dica de ferramenta. A mesma medida pode estar em mais de um campo.
 */
export type MeasureRole = "values" | "detail" | "reference" | "base" | "tooltips";

export interface Measure {
    index: number;
    source: DataViewMetadataColumn;
    name: string;
    queryName: string;
    /** Formato de porcentagem (o desvio aparece em pontos percentuais). */
    isPercent: boolean;
    format: (value: PrimitiveValue) => string;
}

/** Combinação de valores dos campos de "Colunas" (vazia quando não há colunas). */
export interface ColumnGroup {
    key: string;
    labels: string[];
    isSubtotal: boolean;
    /** Nó do último nível de membros, para o filtro cruzado por célula. */
    node: DataViewMatrixNode | undefined;
}

/** Uma coluna visível: grupo de colunas + medida. */
export interface ValueColumn {
    key: string;
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
    parent: RowItem | undefined;
    isGrandTotal: boolean;
    /** Posição original entre os irmãos (ordem do Power BI). */
    order: number;
}

export interface MatrixModel {
    measures: Measure[];
    /** Medidas exibidas (campo Valores). */
    values: Measure[];
    /** Medidas mostradas entre parênteses ao lado do valor (campo Detalhe). */
    details: Measure[];
    /** Medidas com o valor de referência de cada célula (campo Referência, ex.: metas por diretoria). */
    references: Measure[];
    base: Measure | undefined;
    tooltips: Measure[];
    groups: ColumnGroup[];
    /** Grupo com o total de cada linha (coluna de total ou o único grupo quando não há colunas). */
    totalGroup: ColumnGroup | undefined;
    columns: ValueColumn[];
    columnLevels: DataViewHierarchyLevel[];
    columnLevelNames: string[];
    /** As colunas são datas ou períodos (meses, trimestres…), em que a tendência faz sentido. */
    columnIsTime: boolean;
    rowLevels: DataViewHierarchyLevel[];
    rowLevelNames: string[];
    rows: RowItem[];
    grandTotal: RowItem | undefined;
    /** Índice da folha da hierarquia de colunas para (grupo, medida). */
    leafIndex: Map<string, number>;
}

const ROLES: MeasureRole[] = ["values", "detail", "reference", "base", "tooltips"];

function hasRole(measure: Measure, role: MeasureRole): boolean {
    const roles = measure.source.roles;
    // Sem papel conhecido, a medida é tratada como valor exibido.
    return role === "values" && !ROLES.some(r => roles?.[r]) ? true : !!roles?.[role];
}

/** Palavras que indicam um campo de tempo (sem acentos, em minúsculas). */
const TIME_WORDS = new Set([
    "data", "date", "dia", "day", "semana", "week", "mes", "month", "bimestre", "trimestre", "quarter",
    "semestre", "ano", "year", "periodo", "period", "competencia", "anomes", "mesano", "yearmonth"
]);

/** Campo de data, ou com nome de período (Mês, Ano, Trimestre, AnoMês…). "Tempo de casa (anos)" não conta. */
function isTimeSource(source: DataViewMetadataColumn): boolean {
    if (source.type?.dateTime) {
        return true;
    }
    const words = (source.displayName || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/);
    return words.some(w => TIME_WORDS.has(w));
}

function isPercentFormat(format: string | undefined): boolean {
    return !!format && (/^[Pp]\d*$/.test(format) || /%/.test(format.replace(/\\%|"[^"]*"/g, "")));
}

export function memberLabel(value: PrimitiveValue, source: DataViewMetadataColumn | undefined, locale: string): string {
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
            isPercent: isPercentFormat(source.format),
            format: (v: PrimitiveValue) => formatter.format(v)
        };
    });
    const values = measures.filter(m => hasRole(m, "values"));

    // ---- colunas: percorre a hierarquia e guarda o índice de cada folha
    const columnLevels = matrix.columns?.levels || [];
    const lastIsMeasure = columnLevels.length > 0 && !!columnLevels[columnLevels.length - 1].sources?.[0]?.isMeasure;
    const memberLevelCount = lastIsMeasure ? columnLevels.length - 1 : columnLevels.length;
    const columnLevelNames = columnLevels.slice(0, memberLevelCount).map(l => l.sources.map(s => s.displayName).join(" / "));
    const columnIsTime = columnLevels.slice(0, memberLevelCount).some(l => l.sources.some(isTimeSource));

    const groups: ColumnGroup[] = [];
    const groupByKey = new Map<string, ColumnGroup>();
    const leafIndex = new Map<string, number>();
    let leafCounter = 0;

    const walkColumns = (node: DataViewMatrixNode, labels: string[], keys: string[], subtotal: boolean,
        memberNode: DataViewMatrixNode | undefined): void => {
        const children = node.children || [];
        if (children.length === 0) {
            const isMeasureLeaf = lastIsMeasure && (node.level === columnLevels.length - 1);
            const measureIndex = isMeasureLeaf
                ? (node.levelValues?.[0]?.levelSourceIndex ?? node.levelSourceIndex ?? 0)
                : 0;
            const key = keys.join("\u001f");
            let group = groupByKey.get(key);
            if (!group) {
                group = { key, labels: labels.slice(), isSubtotal: subtotal, node: subtotal ? undefined : memberNode };
                groupByKey.set(key, group);
                groups.push(group);
            }
            leafIndex.set(cellKey(key, measureIndex), leafCounter++);
            return;
        }
        for (const child of children) {
            const isMemberLevel = child.level !== undefined && child.level < memberLevelCount;
            if (isMemberLevel) {
                const src = columnLevels[child.level].sources[child.levelValues?.[0]?.levelSourceIndex ?? 0];
                const label = child.isSubtotal ? totalLabel : memberLabel(child.levelValues?.[0]?.value, src, locale);
                const key = child.isSubtotal ? "#total" : memberKey(child.levelValues?.[0]?.value);
                walkColumns(child, labels.concat(label), keys.concat(key), subtotal || !!child.isSubtotal, child);
            } else {
                walkColumns(child, labels, keys, subtotal, memberNode);
            }
        }
    };
    if (matrix.columns?.root) {
        walkColumns(matrix.columns.root, [], [], false, undefined);
    }
    if (groups.length === 0) {
        // Uma medida só e nenhum campo em "Colunas": os valores vêm na ordem das medidas.
        const group: ColumnGroup = { key: "", labels: [], isSubtotal: false, node: undefined };
        groups.push(group);
        groupByKey.set("", group);
        measures.forEach(m => leafIndex.set(cellKey("", m.index), m.index));
    }
    const totalGroup = memberLevelCount === 0 ? groups[0] : groupByKey.get("#total");

    // ---- colunas visíveis: grupo de colunas > medida (como na matriz nativa)
    const columns: ValueColumn[] = [];
    for (const group of groups) {
        for (const measure of values) {
            if (leafIndex.has(cellKey(group.key, measure.index))) {
                columns.push({ key: cellKey(group.key, measure.index), group, measure });
            }
        }
    }

    // ---- linhas
    const rowLevels = matrix.rows?.levels || [];
    const rowLevelNames = rowLevels.map(l => l.sources.map(s => s.displayName).join(" / "));
    let grandTotal: RowItem | undefined;

    const buildRows = (parentNode: DataViewMatrixNode, parent: RowItem | undefined, parentId: string): RowItem[] => {
        const items: RowItem[] = [];
        for (const node of parentNode.children || []) {
            if (node.isSubtotal) {
                continue;
            }
            const level = node.level ?? 0;
            const value = node.levelValues?.[0]?.value;
            const src = rowLevels[level]?.sources[node.levelValues?.[0]?.levelSourceIndex ?? 0];
            const subtotal = (node.children || []).find(c => c.isSubtotal);
            const item: RowItem = {
                id: parentId + "\u001f" + memberKey(value),
                label: memberLabel(value, src, locale),
                level,
                node,
                // O valor da linha de cima vem do próprio nó ou do nó de subtotal dela (depende do Power BI).
                valuesNode: hasValues(node) ? node : subtotal,
                children: [],
                parent,
                isGrandTotal: false,
                order: items.length
            };
            item.children = buildRows(node, item, item.id);
            items.push(item);
        }
        return items;
    };

    const root = matrix.rows?.root;
    let rows: RowItem[] = [];
    if (root) {
        if (rowLevels.length === 0 || !(root.children || []).some(c => c.levelValues?.length)) {
            // Sem campos em "Linhas": uma única linha com os totais.
            const node = (root.children || [])[0] || root;
            grandTotal = {
                id: "#total", label: totalLabel, level: 0, node, valuesNode: node, children: [], parent: undefined, isGrandTotal: true, order: 0
            };
        } else {
            rows = buildRows(root, undefined, "");
            const totalNode = (root.children || []).find(c => c.isSubtotal);
            if (totalNode) {
                grandTotal = {
                    id: "#total", label: totalLabel, level: 0, node: totalNode, valuesNode: totalNode, children: [],
                    parent: undefined, isGrandTotal: true, order: 0
                };
            }
        }
    }

    return {
        measures,
        values,
        details: measures.filter(m => hasRole(m, "detail")),
        references: measures.filter(m => hasRole(m, "reference")),
        base: measures.find(m => hasRole(m, "base")),
        // Uma medida que já está em Valores não se repete na dica de ferramenta.
        tooltips: measures.filter(m => hasRole(m, "tooltips") && !hasRole(m, "values")),
        groups,
        totalGroup,
        columns,
        columnLevels,
        columnLevelNames,
        columnIsTime,
        rowLevels,
        rowLevelNames,
        rows,
        grandTotal,
        leafIndex
    };
}

/** Valor bruto de uma medida numa linha, para um grupo de colunas. */
export function cellValue(model: MatrixModel, row: RowItem, groupKey: string, measureIndex: number): DataViewMatrixNodeValue | undefined {
    const j = model.leafIndex.get(cellKey(groupKey, measureIndex));
    if (j === undefined || !row.valuesNode?.values) {
        return undefined;
    }
    return row.valuesNode.values[j];
}

export function toNumber(value: PrimitiveValue | undefined): number | undefined {
    return typeof value === "number" && isFinite(value) ? value : undefined;
}

/** Caminho da linha a partir do primeiro nível (ex.: Operações › Turno C). */
export function rowPath(row: RowItem): RowItem[] {
    const path: RowItem[] = [];
    for (let r: RowItem | undefined = row; r; r = r.parent) {
        path.unshift(r);
    }
    return path;
}
