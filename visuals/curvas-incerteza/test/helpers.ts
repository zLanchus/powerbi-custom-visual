// Monta um dataView categórico de mentira, como o Power BI entrega ao visual.

import powerbi from "powerbi-visuals-api";

import DataViewCategorical = powerbi.DataViewCategorical;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup;
import ISelectionId = powerbi.visuals.ISelectionId;
import PrimitiveValue = powerbi.PrimitiveValue;

export type Measures = Record<string, PrimitiveValue[]>;

export interface FakeSeries {
    name: PrimitiveValue;
    measures: Measures;
}

export interface FakeData {
    categoryName?: string;
    categoryRole?: string;
    categoryType?: powerbi.ValueTypeDescriptor;
    categoryFormat?: string;
    categories: PrimitiveValue[];
    /** Sem campo Série: medidas por papel. */
    measures?: Measures;
    /** Com campo Série: uma entrada por valor da série. */
    series?: FakeSeries[];
    highlights?: PrimitiveValue[];
    formats?: Record<string, string>;
}

function column(role: string, values: PrimitiveValue[], formats: Record<string, string> | undefined, groupName?: PrimitiveValue): DataViewValueColumn {
    return {
        source: { displayName: role, queryName: `m.${role}`, roles: { [role]: true }, format: formats?.[role], groupName, type: { numeric: true } },
        values
    } as DataViewValueColumn;
}

export function fakeCategorical(data: FakeData): DataViewCategorical {
    const category = {
        source: { displayName: data.categoryName ?? "Categoria", queryName: "t.cat", roles: { [data.categoryRole ?? "category"]: true }, type: data.categoryType ?? { text: true }, format: data.categoryFormat },
        values: data.categories
    };
    let columns: DataViewValueColumn[] = [];
    let groups: DataViewValueColumnGroup[];
    let source: powerbi.DataViewMetadataColumn | undefined;
    if (data.series) {
        source = { displayName: "Série", queryName: "t.series", roles: { series: true } } as powerbi.DataViewMetadataColumn;
        groups = data.series.map(s => {
            const cols = Object.entries(s.measures).map(([role, values]) => column(role, values, data.formats, s.name));
            columns = columns.concat(cols);
            return { name: s.name, values: cols, identity: { key: String(s.name) } } as unknown as DataViewValueColumnGroup;
        });
    } else {
        columns = Object.entries(data.measures ?? {}).map(([role, values]) => column(role, values, data.formats));
        if (data.highlights) {
            const value = columns.find(c => c.source.roles?.["value"]);
            if (value) {
                value.highlights = data.highlights;
            }
        }
        groups = [{ values: columns } as unknown as DataViewValueColumnGroup];
    }
    const values = Object.assign(columns, { grouped: () => groups, source });
    return { categories: [category], values } as unknown as DataViewCategorical;
}

export function fakeId(key: string): ISelectionId {
    const id = {
        key,
        getKey: () => key,
        getSelector: () => ({ key }),
        getSelectorsByColumn: () => ({}),
        equals: (other: ISelectionId) => (other as unknown as { key: string }).key === key,
        includes: () => false,
        hasIdentity: () => true
    };
    return id as unknown as ISelectionId;
}

export const fakeFormat = () => (v: PrimitiveValue): string => (v === null || v === undefined ? "" : String(v));
export const fakeLabel = (v: PrimitiveValue): string => (v === null || v === undefined || v === "" ? "(Em branco)" : String(v));
