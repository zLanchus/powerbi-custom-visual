"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import { IFilterTarget } from "powerbi-models";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import FilterAction = powerbi.FilterAction;
import PrimitiveValue = powerbi.PrimitiveValue;

import { DARK, SERIES_PALETTE, VisualFormattingSettingsModel, enumValue } from "./settings";
import {
    Selection,
    SelectionItem,
    SelectionKind,
    buildFilter,
    emptySelection,
    getTarget,
    itemKey,
    sameTarget,
    selectionFromFilters,
    valueKey
} from "./filters";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Quantas linhas a mais são desenhadas acima e abaixo da área visível da base. */
const OVERSCAN = 8;

/** Um item da legenda (um segmento de cada barra). */
interface Series {
    index: number;
    key: string;
    raw: PrimitiveValue;
    name: string;
    color: string;
    selectionId: ISelectionId;
    selector: powerbi.data.Selector;
    valueColumn: DataViewValueColumn;
    /** Medidas da base deste item da legenda, na ordem das colunas. */
    measureColumns: Array<DataViewValueColumn | undefined>;
    detailColumn: DataViewValueColumn | undefined;
}

/** Uma barra (um valor do eixo). */
interface Cat {
    key: string;
    raw: PrimitiveValue;
    label: string;
    parts: number[];
    counts: number[];
    total: number;
    /** Detalhe de cada segmento, juntando os registros (soma, quantidade, mínimo e máximo). */
    detail: DetailAcc[];
}

interface DetailAcc {
    sum: number;
    n: number;
    min: number;
    max: number;
}

/** Um registro da base nominal: uma linha do Power BI num item da legenda. */
interface Rec {
    row: number;
    cat: Cat;
    series: number;
    text?: string[];
    search?: string;
}

interface Column {
    name: string;
    numeric: boolean;
    value: (rec: Rec) => PrimitiveValue;
    format: (value: PrimitiveValue) => string;
}

interface Model {
    categoryName: string;
    legendName: string;
    valueName: string;
    hasLegend: boolean;
    series: Series[];
    cats: Cat[];
    records: Rec[];
    columns: Column[];
    format: (v: PrimitiveValue) => string;
    valueFormat: string | undefined;
    detailName: string | undefined;
    detailFormat: (v: PrimitiveValue) => string;
    grandTotal: number;
    catTarget: IFilterTarget;
    catIsDate: boolean;
    legTarget: IFilterTarget | undefined;
    legIsDate: boolean;
    rowId: (rec: Rec) => ISelectionId;
}

interface SortState {
    column: string;
    dir: 1 | -1;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
    }
    return node;
}

/** Ícone de traço (padrão do repositório). */
function icon(paths: string[], size = 14): SVGSVGElement {
    const node = svg("svg", {
        width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "bb-icon"
    });
    for (const d of paths) {
        node.appendChild(svg("path", { d }));
    }
    return node;
}

const ICON_SEARCH = ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"];
const ICON_CLOSE = ["M6 6l12 12", "M18 6L6 18"];
const ICON_FILTER = ["M4 5h16l-6 7.5V19l-4-2v-4.5z"];
const ICON_SORT_UP = ["M8 14l4-4 4 4"];
const ICON_SORT_DOWN = ["M8 10l4 4 4-4"];

function hexToRgb(hex: string): [number, number, number] | undefined {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) {
        return undefined;
    }
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Cor de texto legível (escura ou branca) sobre um fundo. */
function readableText(background: string, dark: string): string {
    const rgb = hexToRgb(background);
    if (!rgb) {
        return dark;
    }
    const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? dark : "#FFFFFF";
}

function toNumber(value: PrimitiveValue | undefined): number {
    return typeof value === "number" && isFinite(value) ? value : 0;
}

function isBlank(value: PrimitiveValue | undefined): boolean {
    return value === null || value === undefined || value === "";
}

function label(value: PrimitiveValue, format: string | undefined, locale: string): string {
    if (isBlank(value)) {
        return "(Em branco)";
    }
    if (format || value instanceof Date) {
        return valueFormatter.format(value, format, false, locale);
    }
    return String(value);
}

function colorOf(objects: powerbi.DataViewObjects | undefined): string | undefined {
    const fill = objects?.["dataColors"]?.["fill"] as powerbi.Fill | undefined;
    return fill?.solid?.color || undefined;
}

/** Texto em minúsculas e sem acentos (para a pesquisa). */
function normalize(text: string): string {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function compareRaw(a: PrimitiveValue, b: PrimitiveValue): number {
    const blankA = isBlank(a);
    const blankB = isBlank(b);
    if (blankA || blankB) {
        return blankA === blankB ? 0 : blankA ? 1 : -1;
    }
    const x = a instanceof Date ? a.getTime() : a;
    const y = b instanceof Date ? b.getTime() : b;
    if (typeof x === "number" && typeof y === "number") {
        return x - y;
    }
    return String(x).localeCompare(String(y), "pt-BR", { numeric: true, sensitivity: "base" });
}

/** Largura aproximada de um texto (para decidir se o rótulo cabe). */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number, family: string, bold = false): number {
    if (measureCtx === undefined) {
        measureCtx = document.createElement("canvas").getContext("2d");
    }
    if (!measureCtx) {
        return text.length * size * 0.56;
    }
    measureCtx.font = `${bold ? "600 " : ""}${size}px ${family}`;
    return measureCtx.measureText(text).width;
}

function truncate(text: string, max: number, size: number, family: string, bold = false): string {
    if (textWidth(text, size, family, bold) <= max) {
        return text;
    }
    let t = text;
    while (t.length > 1 && textWidth(t + "…", size, family, bold) > max) {
        t = t.slice(0, -1);
    }
    return t + "…";
}

/** Escala "redonda" do eixo de valores: 0, passo, 2×passo… até cobrir o máximo. */
function niceTicks(max: number, count: number): number[] {
    if (!(max > 0)) {
        return [0, 1];
    }
    const raw = max / Math.max(1, count);
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks: number[] = [];
    for (let v = 0; v <= top + step / 2; v += step) {
        ticks.push(Number(v.toPrecision(12)));
    }
    return ticks;
}

/** Retângulo com os cantos arredondados só na ponta da barra (em cima ou à direita). */
function barPath(x: number, y: number, w: number, h: number, r: number, horizontal: boolean): string {
    if (horizontal) {
        r = Math.max(0, Math.min(r, h / 2, w));
        return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
    }
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private model: Model | undefined;
    private width = 0;
    private height = 0;
    private locale = "pt-BR";
    private pct: (v: number) => string = v => (v * 100).toFixed(1) + "%";
    private count: (v: number) => string = v => String(v);

    private selection: Selection = emptySelection();
    private search = "";
    private sort: SortState | undefined;
    /** Ainda há partes da base chegando do Power BI. */
    private loading = false;
    /** A base passou do máximo de registros configurado. */
    private truncated = false;
    private crossFilterWasOn: boolean | undefined;
    private lastCatTarget: IFilterTarget | undefined;

    // Partes da base nominal atualizadas sem redesenhar tudo.
    private table: {
        count: HTMLElement;
        filterBar: HTMLElement;
        grid: HTMLElement;
        inner: HTMLElement;
        head: HTMLElement;
        body: HTMLElement;
        empty: HTMLElement;
        template: string;
        rows: Rec[];
        rowHeight: number;
        frame: number;
    } | undefined;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "bb-root");
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI (fora das barras e das linhas).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando),
        // exceto na caixa de pesquisa.
        this.root.addEventListener("mousedown", (e: MouseEvent) => {
            if (!(e.target as Element).closest("input")) {
                e.preventDefault();
            }
        });
        // Clique no vazio do gráfico limpa a seleção.
        this.root.addEventListener("click", (e: MouseEvent) => {
            const target = e.target as Element;
            if (!target.closest(".bb-seg, .bb-legend-item, .bb-cat-hit, .bb-panel")) {
                this.setSelection(emptySelection());
            }
        });
    }

    // ---------------------------------------------------------------- update

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.locale = this.host.locale || "pt-BR";
            const pctFormatter = valueFormatter.create({ format: "0.0%", cultureSelector: this.locale });
            this.pct = v => pctFormatter.format(v);
            const countFormatter = valueFormatter.create({ format: "#,0", cultureSelector: this.locale });
            this.count = v => countFormatter.format(v);
            this.width = options.viewport.width;
            this.height = options.viewport.height;

            // Base em partes: pede a próxima até chegar ao máximo configurado.
            const rows = dataView?.categorical?.categories?.[0]?.values.length || 0;
            const limit = Math.max(1, this.formattingSettings.tableCard.maxRows.value || 30) * 1000;
            this.loading = false;
            this.truncated = false;
            if (dataView?.metadata?.segment) {
                if (rows < limit && this.host.fetchMoreData(true)) {
                    this.loading = true;
                } else {
                    this.truncated = true;
                }
            }

            this.model = this.buildModel(dataView);
            this.syncSelection(options);
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const settings = this.formattingSettings;
        const labels = settings.dataLabelsCard;
        labels.segmentColor.visible = !labels.autoContrast.value;
        settings.axesCard.categoryWidth.visible = enumValue(settings.barsCard.orientation) === "horizontal";
        settings.rowsCard.zebraColor.visible = settings.rowsCard.zebra.value;
        const det = settings.detailCard;
        det.where.visible = !!this.model?.hasLegend;
        const table = settings.tableCard;
        table.showLegendColumn.visible = table.colorMarker.visible = !!this.model?.hasLegend;

        const cards = settings.cards.slice();
        if (this.model?.series.length) {
            const slices = this.model.series.map(s => new formattingSettings.ColorPicker({
                name: "fill",
                displayName: s.name,
                value: { value: s.color },
                selector: s.selector
            }));
            const colorsTitle = this.model.hasLegend ? "Cores da legenda" : "Cor das barras";
            class ColorsCard extends formattingSettings.SimpleCard {
                name = "dataColors";
                displayName = colorsTitle;
                slices = slices;
            }
            // Cores logo depois de "Barras".
            const at = cards.indexOf(settings.barsCard) + 1;
            settings.cards = [...cards.slice(0, at), new ColorsCard(), ...cards.slice(at)];
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(settings);
        settings.cards = cards;
        return formattingModel;
    }

    // ------------------------------------------------------------- dados

    private buildModel(dataView: DataView | undefined): Model | undefined {
        const categorical = dataView?.categorical;
        const categories = categorical?.categories || [];
        const category = categories.find(c => c.source.roles?.["category"]);
        const values = categorical?.values;
        if (!category || !values || values.length === 0) {
            return undefined;
        }
        const firstValue = values.find(c => c.source.roles?.["value"]);
        if (!firstValue) {
            return undefined;
        }

        const locale = this.locale;
        const legendSource = values.source;
        const hasLegend = !!legendSource;
        const groups = values.grouped();
        const builder = (): powerbi.visuals.ISelectionIdBuilder => this.host.createSelectionIdBuilder();
        const roleIndex = (source: DataViewMetadataColumn, role: string): number =>
            (source as unknown as { rolesIndex?: Record<string, number[]> }).rolesIndex?.[role]?.[0] ?? 0;
        const byRole = (role: string) => (a: { source: DataViewMetadataColumn }, b: { source: DataViewMetadataColumn }): number =>
            roleIndex(a.source, role) - roleIndex(b.source, role);

        // Medidas da base: a ordem e os nomes vêm do primeiro grupo; em cada grupo, a mesma medida pelo queryName.
        const groupColumns = (k: number): DataViewValueColumn[] =>
            hasLegend ? groups[k].values : Array.from(values);
        const measureSources = groupColumns(0)
            .filter(c => c.source.roles?.["columnMeasures"])
            .sort(byRole("columnMeasures"))
            .map(c => c.source);
        const sameMeasure = (a: DataViewMetadataColumn, b: DataViewMetadataColumn): boolean =>
            (a.queryName || a.displayName) === (b.queryName || b.displayName);

        const series: Series[] = [];
        const groupCount = hasLegend ? groups.length : 1;
        for (let k = 0; k < groupCount; k++) {
            const columns = groupColumns(k);
            const valueColumn = columns.find(c => c.source.roles?.["value"]);
            if (!valueColumn) {
                continue;
            }
            const measureColumns = measureSources.map(m => columns.find(c => c.source.roles?.["columnMeasures"] && sameMeasure(c.source, m)));
            const detailColumn = columns.find(c => c.source.roles?.["detail"]);
            if (hasLegend) {
                const group = groups[k];
                const selectionId = builder().withSeries(values, group).createSelectionId();
                series.push({
                    index: series.length,
                    key: valueKey(group.name),
                    raw: group.name,
                    name: label(group.name, legendSource?.format, locale),
                    color: colorOf(group.objects) || SERIES_PALETTE[series.length % SERIES_PALETTE.length],
                    selectionId,
                    selector: selectionId.getSelector(),
                    valueColumn,
                    measureColumns,
                    detailColumn
                });
            } else {
                const queryName = valueColumn.source.queryName || valueColumn.source.displayName;
                series.push({
                    index: 0,
                    key: "",
                    raw: null,
                    name: valueColumn.source.displayName,
                    color: colorOf(valueColumn.source.objects) || SERIES_PALETTE[0],
                    selectionId: builder().withMeasure(queryName).createSelectionId(),
                    selector: { metadata: queryName },
                    valueColumn,
                    measureColumns,
                    detailColumn
                });
            }
        }
        if (series.length === 0) {
            return undefined;
        }

        // Barras (somando os registros) e registros da base.
        const catMap = new Map<string, Cat>();
        const cats: Cat[] = [];
        const records: Rec[] = [];
        const n = category.values.length;
        for (let row = 0; row < n; row++) {
            const raw = category.values[row];
            const key = valueKey(raw);
            let cat = catMap.get(key);
            if (!cat) {
                cat = {
                    key, raw, label: label(raw, category.source.format, locale),
                    parts: series.map(() => 0), counts: series.map(() => 0), total: 0,
                    detail: series.map(() => ({ sum: 0, n: 0, min: Infinity, max: -Infinity }))
                };
                catMap.set(key, cat);
                cats.push(cat);
            }
            for (const s of series) {
                const value = s.valueColumn.values[row];
                const detail = s.detailColumn?.values[row];
                const present = !isBlank(value) || !isBlank(detail) || s.measureColumns.some(c => c && !isBlank(c.values[row]));
                if (!present) {
                    continue;
                }
                const v = Math.max(0, toNumber(value));
                cat.parts[s.index] += v;
                cat.counts[s.index]++;
                cat.total += v;
                if (typeof detail === "number" && isFinite(detail)) {
                    const acc = cat.detail[s.index];
                    acc.sum += detail;
                    acc.n++;
                    acc.min = Math.min(acc.min, detail);
                    acc.max = Math.max(acc.max, detail);
                }
                records.push({ row, cat, series: s.index });
            }
        }

        const order = enumValue(this.formattingSettings.barsCard.order);
        if (order === "desc") {
            cats.sort((a, b) => b.total - a.total);
        } else if (order === "asc") {
            cats.sort((a, b) => a.total - b.total);
        } else if (order === "alpha") {
            cats.sort((a, b) => compareRaw(a.raw, b.raw));
        }

        // Colunas da base nominal.
        const table = this.formattingSettings.tableCard;
        const emptyText = String(table.emptyText.value ?? "");
        const formatOf = (source: DataViewMetadataColumn): ((v: PrimitiveValue) => string) => {
            const f = source.format ? valueFormatter.create({ format: source.format, cultureSelector: locale }) : undefined;
            return v => {
                if (isBlank(v)) {
                    return emptyText;
                }
                if (f) {
                    return f.format(v);
                }
                if (v instanceof Date) {
                    return v.toLocaleDateString(locale);
                }
                if (typeof v === "boolean") {
                    return v ? "Verdadeiro" : "Falso";
                }
                if (typeof v === "number") {
                    return Number.isInteger(v) ? String(v) : v.toLocaleString(locale);
                }
                return String(v);
            };
        };
        const isNumeric = (source: DataViewMetadataColumn): boolean => !!(source.type?.numeric || source.type?.integer);
        const columns: Column[] = [];
        const detail = categories.filter(c => c.source.roles?.["columns"]).sort(byRole("columns"));
        if (table.showCategoryColumn.value && !category.source.roles?.["columns"]) {
            columns.push(this.categoryColumn(category, formatOf));
        }
        if (hasLegend && legendSource && table.showLegendColumn.value) {
            columns.push({
                name: legendSource.displayName,
                numeric: isNumeric(legendSource),
                value: rec => series[rec.series].raw,
                format: formatOf(legendSource)
            });
        }
        for (const column of detail) {
            columns.push(this.categoryColumn(column, formatOf));
        }
        measureSources.forEach((source, m) => {
            columns.push({
                name: source.displayName,
                numeric: isNumeric(source),
                value: rec => series[rec.series].measureColumns[m]?.values[rec.row] ?? null,
                format: formatOf(source)
            });
        });
        if (table.showValueColumn.value || columns.length === 0) {
            columns.push({
                name: firstValue.source.displayName,
                numeric: true,
                value: rec => series[rec.series].valueColumn.values[rec.row],
                format: formatOf(firstValue.source)
            });
        }

        const formatter = valueFormatter.create({ format: firstValue.source.format, cultureSelector: locale });
        const detailSource = series.find(x => x.detailColumn)?.detailColumn?.source;
        const detailFormatter = valueFormatter.create({ format: detailSource?.format, cultureSelector: locale });
        return {
            categoryName: category.source.displayName,
            legendName: legendSource?.displayName || "",
            valueName: firstValue.source.displayName,
            hasLegend,
            series,
            cats,
            records,
            columns,
            format: v => formatter.format(v),
            valueFormat: firstValue.source.format,
            detailName: detailSource?.displayName,
            detailFormat: v => detailFormatter.format(v),
            grandTotal: cats.reduce((a, c) => a + c.total, 0),
            catTarget: getTarget(category.source),
            catIsDate: !!category.source.type?.dateTime,
            legTarget: legendSource ? getTarget(legendSource) : undefined,
            legIsDate: !!legendSource?.type?.dateTime,
            rowId: rec => {
                const b = builder().withCategory(category, rec.row);
                return (hasLegend ? b.withSeries(values, groups[rec.series]) : b).createSelectionId();
            }
        };
    }

    private categoryColumn(column: DataViewCategoryColumn, formatOf: (s: DataViewMetadataColumn) => (v: PrimitiveValue) => string): Column {
        return {
            name: column.source.displayName,
            numeric: !!(column.source.type?.numeric || column.source.type?.integer),
            value: rec => column.values[rec.row],
            format: formatOf(column.source)
        };
    }

    // ------------------------------------------------------------- seleção

    /** Com o filtro cruzado ligado, a seleção vem do filtro salvo no Power BI (favoritos, troca de página etc.). */
    private syncSelection(options: VisualUpdateOptions): void {
        const model = this.model;
        const crossFilter = this.formattingSettings.generalCard.crossFilter.value;
        if (this.crossFilterWasOn && !crossFilter) {
            // Desligou: tira o filtro que tinha ficado nos outros visuais.
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
        }
        this.crossFilterWasOn = crossFilter;
        if (!model) {
            return;
        }
        if (crossFilter) {
            this.selection = selectionFromFilters(
                options.jsonFilters,
                { target: model.catTarget, isDate: model.catIsDate },
                model.legTarget ? { target: model.legTarget, isDate: model.legIsDate } : undefined
            );
        } else if (this.lastCatTarget && !sameTarget(this.lastCatTarget, model.catTarget)) {
            this.selection = emptySelection();
        }
        this.lastCatTarget = model.catTarget;
    }

    private select(kind: SelectionKind, item: SelectionItem, multi: boolean): void {
        const current = this.selection;
        const key = itemKey(item);
        let next: Selection;
        if (multi && current.kind === kind && current.items.size > 0) {
            next = { kind, items: new Map(current.items) };
            if (next.items.has(key)) {
                next.items.delete(key);
            } else {
                next.items.set(key, item);
            }
        } else if (current.kind === kind && current.items.size === 1 && current.items.has(key)) {
            // Clicar de novo no mesmo item desfaz a seleção.
            next = emptySelection();
        } else {
            next = { kind, items: new Map([[key, item]]) };
        }
        this.setSelection(next);
    }

    private setSelection(selection: Selection): void {
        if (selection.items.size === 0 && this.selection.items.size === 0) {
            return;
        }
        this.selection = selection;
        this.paintSelection();
        if (this.table) {
            this.table.grid.scrollTop = 0;
        }
        this.refreshTable();
        const model = this.model;
        if (model && this.formattingSettings.generalCard.crossFilter.value) {
            const filter = buildFilter(selection, model.catTarget, model.legTarget);
            if (filter) {
                this.host.applyJsonFilter(filter, "general", "filter", FilterAction.merge);
            } else {
                this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
            }
        }
    }

    private segmentItem(cat: Cat, series: Series): { kind: SelectionKind; item: SelectionItem } {
        if (!this.model?.hasLegend) {
            return { kind: "category", item: { cat: cat.key, leg: "", catRaw: cat.raw } };
        }
        return { kind: "segment", item: { cat: cat.key, leg: series.key, catRaw: cat.raw, legRaw: series.raw } };
    }

    private segmentOn(cat: Cat, k: number): boolean {
        const sel = this.selection;
        if (sel.items.size === 0) {
            return true;
        }
        const leg = this.model?.series[k]?.key ?? "";
        if (sel.kind === "category") {
            return sel.items.has(itemKey({ cat: cat.key, leg: "" }));
        }
        if (sel.kind === "legend") {
            return sel.items.has(itemKey({ cat: "", leg }));
        }
        return sel.items.has(itemKey({ cat: cat.key, leg }));
    }

    /** Esmaece o que não está selecionado (segmentos, rótulos e itens da legenda). */
    private paintSelection(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const dim = String(Math.min(100, Math.max(0, this.formattingSettings.barsCard.selectedOpacity.value)) / 100);
        const catByIndex = model.cats;
        const catOn = catByIndex.map(cat => model.series.some((_, k) => this.segmentOn(cat, k)));
        const seriesOn = model.series.map((_, k) => catByIndex.some(cat => this.segmentOn(cat, k)));

        this.root.querySelectorAll<SVGElement>(".bb-seg, .bb-seg-label").forEach(node => {
            const cat = catByIndex[Number(node.dataset.cat)];
            node.style.opacity = this.segmentOn(cat, Number(node.dataset.series)) ? "1" : dim;
        });
        this.root.querySelectorAll<SVGElement>(".bb-cat-label, .bb-total-label").forEach(node => {
            node.style.opacity = catOn[Number(node.dataset.cat)] ? "1" : dim;
        });
        this.root.querySelectorAll<HTMLElement>(".bb-legend-item").forEach(node => {
            node.style.opacity = seriesOn[Number(node.dataset.series)] ? "1" : dim;
        });
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        this.table = undefined;
        const s = this.formattingSettings;
        root.style.fontFamily = s.generalCard.fontFamily.value;
        const model = this.model;

        if (!model) {
            const empty = el("div", "bb-empty");
            empty.appendChild(el("div", "bb-empty-title", "Barras com Base Nominal"));
            empty.appendChild(el("div", "bb-empty-text",
                "Coloque um campo em Eixo, uma medida em Valores (ex.: Contagem de Matrícula), o campo da Legenda " +
                "e as colunas da base nominal (ex.: Nome, Cidade)."));
            root.appendChild(empty);
            return;
        }

        // ---- layout: gráfico + base nominal
        const layout = s.layoutCard;
        let position = enumValue(layout.position);
        const stackBelow = Math.max(0, layout.stackBelow.value);
        if (position !== "bottom" && stackBelow > 0 && this.width < stackBelow) {
            position = "bottom";
        }
        const gap = Math.max(0, layout.gap.value);
        const share = Math.min(90, Math.max(10, layout.size.value)) / 100;
        root.classList.toggle("bb-col", position === "bottom");
        root.classList.toggle("bb-reverse", position === "left");
        root.style.gap = gap + "px";

        let chartW = this.width;
        let chartH = this.height;
        let tableW = this.width;
        let tableH = this.height;
        if (position === "bottom") {
            tableH = Math.max(120, Math.round((this.height - gap) * share));
            chartH = Math.max(0, this.height - gap - tableH);
        } else {
            tableW = Math.min(Math.max(180, Math.round((this.width - gap) * share)), Math.max(180, this.width - gap - 120));
            chartW = Math.max(0, this.width - gap - tableW);
        }

        const chartPane = el("div", "bb-chart-pane");
        chartPane.style.width = chartW + "px";
        chartPane.style.height = chartH + "px";
        const tablePane = el("div", "bb-table-pane");
        tablePane.style.width = tableW + "px";
        tablePane.style.height = tableH + "px";
        root.append(chartPane, tablePane);

        if (chartW > 40 && chartH > 40) {
            this.renderChartPane(chartPane, model, chartW, chartH);
        }
        this.renderTable(tablePane, model);
        this.paintSelection();
    }

    private renderChartPane(pane: HTMLElement, model: Model, width: number, height: number): void {
        const legendCard = this.formattingSettings.legendCard;
        const legendEl = legendCard.show.value && model.hasLegend ? this.renderLegend(model) : undefined;
        const legendBottom = enumValue(legendCard.position) === "bottom";
        const chart = el("div", "bb-chart");
        if (legendEl && !legendBottom) {
            pane.appendChild(legendEl);
        }
        pane.appendChild(chart);
        if (legendEl && legendBottom) {
            pane.appendChild(legendEl);
        }
        const legendHeight = legendEl ? Math.ceil(legendEl.getBoundingClientRect().height) || legendCard.fontSize.value + 18 : 0;
        const chartH = Math.max(0, height - legendHeight);
        chart.style.height = chartH + "px";
        this.renderChart(chart, model, width, chartH);
    }

    private renderLegend(model: Model): HTMLElement {
        const card = this.formattingSettings.legendCard;
        const legend = el("div", "bb-legend");
        legend.style.fontSize = card.fontSize.value + "px";
        legend.style.color = card.fontColor.value.value;
        if (card.showTitle.value && model.legendName) {
            legend.appendChild(el("span", "bb-legend-title", model.legendName));
        }
        model.series.forEach((series, k) => {
            const item = el("span", "bb-legend-item");
            item.dataset.series = String(k);
            item.title = "Clique para filtrar a base por " + series.name;
            const dot = el("span", "bb-legend-dot");
            dot.style.background = series.color;
            item.appendChild(dot);
            item.appendChild(el("span", "bb-legend-text", series.name));
            item.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.select("legend", { cat: "", leg: series.key, legRaw: series.raw }, e.ctrlKey || e.metaKey || e.shiftKey);
            });
            item.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectionManager.showContextMenu(series.selectionId, { x: e.clientX, y: e.clientY });
            });
            legend.appendChild(item);
        });
        return legend;
    }

    private renderChart(chart: HTMLElement, model: Model, width: number, height: number): void {
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        const bars = s.barsCard;
        const axes = s.axesCard;
        const labels = s.dataLabelsCard;
        const horizontal = enumValue(bars.orientation) === "horizontal";
        const n = model.cats.length;
        if (n === 0) {
            return;
        }

        const maxTotal = Math.max(...model.cats.map(c => c.total), 0);
        const totalSize = labels.totalFontSize.value;
        const catSize = axes.categoryFontSize.value;
        const valSize = axes.valueFontSize.value;
        const showTotal = labels.showTotal.value;
        const totalTexts = model.cats.map(c => model.format(c.total));
        const det = s.detailCard;
        const detailWhere = enumValue(det.where);
        const hasDetail = det.show.value && !!model.detailName;
        // Com um segmento só, o rótulo de dentro repetiria o total: o detalhe vai para o total.
        const single = model.series.length === 1 && showTotal;
        const detailOnTotal = hasDetail && showTotal && (detailWhere !== "segment" || single);
        const detailOnSegment = hasDetail && detailWhere !== "total" && !single;
        const totalDetails = model.cats.map(c => (detailOnTotal ? this.detailText(model, c) : ""));
        const totalW = showTotal
            ? Math.max(...totalTexts.map((t, i) => textWidth(t, totalSize, font, true)
                + (totalDetails[i] ? textWidth(" " + totalDetails[i], det.fontSize.value, font, det.bold.value) : 0))) + 10
            : 0;

        // Espaço do eixo de valores e escala.
        const valueSpan = horizontal ? width : height;
        const ticks = niceTicks(maxTotal, Math.max(2, Math.min(6, Math.floor(valueSpan / (horizontal ? 90 : 48)))));
        const top = ticks[ticks.length - 1];
        const axisFormatter = valueFormatter.create({ format: model.valueFormat, value: top, cultureSelector: this.locale });
        const tickTexts = ticks.map(t => axisFormatter.format(t));

        let plotX: number;
        let plotY: number;
        let plotW: number;
        let plotH: number;
        let catW = 0;
        if (horizontal) {
            const autoCat = Math.max(...model.cats.map(c => textWidth(c.label, catSize, font))) + 10;
            catW = !axes.showCategory.value ? 0
                : axes.categoryWidth.value > 0 ? Math.min(axes.categoryWidth.value, width * 0.6)
                    : Math.min(autoCat, width * 0.35);
            const axisH = axes.showValues.value ? valSize + 10 : 0;
            plotX = catW + 6;
            plotY = 4;
            plotW = Math.max(10, width - plotX - totalW - 10);
            plotH = Math.max(10, height - plotY - axisH);
        } else {
            const axisW = axes.showValues.value ? Math.max(...tickTexts.map(t => textWidth(t, valSize, font))) + 10 : 0;
            const catH = axes.showCategory.value ? catSize + 12 : 4;
            plotX = axisW + 4;
            plotY = showTotal ? totalSize + 10 : 8;
            plotW = Math.max(10, width - plotX - 6);
            plotH = Math.max(10, height - plotY - catH);
        }

        const root = svg("svg", { width, height, class: "bb-svg" });
        chart.appendChild(root);
        const gridLayer = svg("g", { class: "bb-grid-lines" });
        const barLayer = svg("g", { class: "bb-bars" });
        const textLayer = svg("g", { class: "bb-texts" });
        root.append(gridLayer, barLayer, textLayer);

        // Linhas de grade e eixo de valores.
        ticks.forEach((t, i) => {
            const p = top > 0 ? t / top : 0;
            if (horizontal) {
                const x = plotX + p * plotW;
                if (axes.showGrid.value) {
                    gridLayer.appendChild(svg("line", {
                        x1: x, x2: x, y1: plotY, y2: plotY + plotH, stroke: axes.gridColor.value.value, "stroke-width": 1
                    }));
                }
                if (axes.showValues.value) {
                    const text = svg("text", {
                        x, y: plotY + plotH + valSize / 2 + 6, "font-size": valSize, fill: axes.valueColor.value.value,
                        "text-anchor": i === 0 ? "start" : "middle", class: "bb-axis-label"
                    });
                    text.textContent = tickTexts[i];
                    textLayer.appendChild(text);
                }
            } else {
                const y = plotY + plotH - p * plotH;
                if (axes.showGrid.value) {
                    gridLayer.appendChild(svg("line", {
                        x1: plotX, x2: plotX + plotW, y1: y, y2: y, stroke: axes.gridColor.value.value, "stroke-width": 1
                    }));
                }
                if (axes.showValues.value) {
                    const text = svg("text", {
                        x: plotX - 6, y, "font-size": valSize, fill: axes.valueColor.value.value,
                        "text-anchor": "end", class: "bb-axis-label"
                    });
                    text.textContent = tickTexts[i];
                    textLayer.appendChild(text);
                }
            }
        });

        const slot = (horizontal ? plotH : plotW) / n;
        const gapPct = Math.min(90, Math.max(0, bars.gap.value)) / 100;
        const maxThick = bars.maxWidth.value > 0 ? bars.maxWidth.value : Infinity;
        const thick = Math.max(1, Math.min(maxThick, slot * (1 - gapPct)));
        const length = horizontal ? plotW : plotH;
        const scale = (v: number): number => (top > 0 ? (v / top) * length : 0);
        const radius = Math.max(0, bars.radius.value);
        const borderW = Math.max(0, bars.borderWidth.value);
        // Com um segmento só, o rótulo de dentro repetiria o total.
        const segMode = single ? "none" : enumValue(labels.segment);
        const segSize = labels.segmentFontSize.value;

        model.cats.forEach((cat, i) => {
            const offset = (horizontal ? plotY : plotX) + slot * i + (slot - thick) / 2;
            const full = scale(cat.total);

            // Área clicável da categoria (a faixa inteira): filtra a barra toda.
            const hit = horizontal
                ? svg("rect", { x: 0, y: plotY + slot * i, width: catW + 6, height: slot, class: "bb-cat-hit" })
                : svg("rect", { x: plotX + slot * i, y: plotY + plotH, width: slot, height: height - plotY - plotH, class: "bb-cat-hit" });
            hit.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.select("category", { cat: cat.key, leg: "", catRaw: cat.raw }, e.ctrlKey || e.metaKey || e.shiftKey);
            });
            barLayer.appendChild(hit);

            // Recorte com a ponta arredondada; os segmentos ficam dentro dele.
            const clipId = `bb-clip-${i}`;
            const clip = svg("clipPath", { id: clipId });
            clip.appendChild(svg("path", {
                d: horizontal
                    ? barPath(plotX, offset, full, thick, radius, true)
                    : barPath(offset, plotY + plotH - full, thick, full, radius, false)
            }));
            root.appendChild(clip);
            const group = svg("g", { "clip-path": `url(#${clipId})` });
            barLayer.appendChild(group);

            let acc = 0;
            model.series.forEach((series, k) => {
                const value = cat.parts[k];
                const size = scale(value);
                if (size <= 0) {
                    return;
                }
                const rect = horizontal
                    ? svg("rect", { x: plotX + acc, y: offset, width: size, height: thick })
                    : svg("rect", { x: offset, y: plotY + plotH - acc - size, width: thick, height: size });
                rect.setAttribute("fill", series.color);
                rect.setAttribute("class", "bb-seg");
                if (borderW > 0) {
                    rect.setAttribute("stroke", bars.borderColor.value.value);
                    rect.setAttribute("stroke-width", String(borderW));
                }
                rect.dataset.cat = String(i);
                rect.dataset.series = String(k);
                this.bindSegment(rect, model, cat, series);
                group.appendChild(rect);

                if (segMode !== "none") {
                    const shareOfBar = cat.total > 0 ? value / cat.total : 0;
                    const text = segMode === "value" ? model.format(value)
                        : segMode === "percent" ? this.pct(shareOfBar)
                            : `${model.format(value)} (${this.pct(shareOfBar)})`;
                    const along = horizontal ? size : thick;
                    const across = horizontal ? thick : size;
                    // O detalhe só entra se couber junto; senão, fica só o valor.
                    const detail = detailOnSegment ? this.detailText(model, cat, k) : "";
                    const width = textWidth(text, segSize, font, true);
                    const withDetail = !!detail && width + textWidth(" " + detail, det.fontSize.value, font, det.bold.value) + 8 <= along;
                    if (width + 8 <= along && segSize + 4 <= across) {
                        const t = svg("text", {
                            x: horizontal ? plotX + acc + size / 2 : offset + thick / 2,
                            y: horizontal ? offset + thick / 2 : plotY + plotH - acc - size / 2,
                            "font-size": segSize,
                            fill: labels.autoContrast.value ? readableText(series.color, DARK) : labels.segmentColor.value.value,
                            class: "bb-seg-label"
                        });
                        t.dataset.cat = String(i);
                        t.dataset.series = String(k);
                        t.textContent = text;
                        if (withDetail) {
                            this.appendDetail(t, detail, undefined);
                        }
                        textLayer.appendChild(t);
                    }
                }
                acc += size;
            });

            // Total na ponta da barra.
            if (showTotal) {
                const t = svg("text", horizontal
                    ? { x: plotX + full + 6, y: offset + thick / 2, "text-anchor": "start" }
                    : { x: offset + thick / 2, y: plotY + plotH - full - 6 - totalSize / 2, "text-anchor": "middle" });
                t.setAttribute("font-size", String(totalSize));
                t.setAttribute("fill", labels.totalColor.value.value);
                t.setAttribute("class", "bb-total-label");
                t.dataset.cat = String(i);
                t.textContent = totalTexts[i];
                if (totalDetails[i]) {
                    this.appendDetail(t, totalDetails[i], det.fontColor.value.value);
                }
                textLayer.appendChild(t);
            }

            // Rótulo da categoria.
            if (axes.showCategory.value) {
                const t = horizontal
                    ? svg("text", { x: catW, y: offset + thick / 2, "text-anchor": "end" })
                    : svg("text", { x: offset + thick / 2, y: plotY + plotH + catSize / 2 + 7, "text-anchor": "middle" });
                t.setAttribute("font-size", String(catSize));
                t.setAttribute("fill", axes.categoryColor.value.value);
                t.setAttribute("class", "bb-cat-label");
                t.dataset.cat = String(i);
                t.textContent = truncate(cat.label, Math.max(10, horizontal ? catW - 4 : slot - 4), catSize, font);
                const title = svg("title");
                title.textContent = cat.label;
                t.appendChild(title);
                textLayer.appendChild(t);
            }
        });

        // Linha de base.
        textLayer.appendChild(svg("line", horizontal
            ? { x1: plotX, x2: plotX, y1: plotY, y2: plotY + plotH, class: "bb-baseline", stroke: axes.gridColor.value.value }
            : { x1: plotX, x2: plotX + plotW, y1: plotY + plotH, y2: plotY + plotH, class: "bb-baseline", stroke: axes.gridColor.value.value }));
    }

    /** Detalhe de um segmento (k) ou da barra inteira (sem k), juntando os registros como configurado. */
    private detailValue(cat: Cat, k?: number): number | undefined {
        const parts = k === undefined ? cat.detail : [cat.detail[k]];
        const n = parts.reduce((a, d) => a + d.n, 0);
        if (n === 0) {
            return undefined;
        }
        const sum = parts.reduce((a, d) => a + d.sum, 0);
        switch (enumValue(this.formattingSettings.detailCard.aggregation)) {
            case "avg": return sum / n;
            case "min": return Math.min(...parts.map(d => d.min));
            case "max": return Math.max(...parts.map(d => d.max));
            default: return sum;
        }
    }

    /** Texto do detalhe no estilo escolhido: (18), · 18 ou 18. */
    private detailText(model: Model, cat: Cat, k?: number): string {
        const v = this.detailValue(cat, k);
        if (v === undefined) {
            return "";
        }
        const text = model.detailFormat(v);
        const style = enumValue(this.formattingSettings.detailCard.style);
        return style === "paren" ? `(${text})` : style === "dot" ? `· ${text}` : text;
    }

    /** Acrescenta o detalhe ao rótulo, num trecho com fonte e cor próprias. */
    private appendDetail(label: SVGTextElement, text: string, color: string | undefined): void {
        const det = this.formattingSettings.detailCard;
        const span = svg("tspan", {
            "font-size": det.fontSize.value,
            "font-weight": det.bold.value ? 600 : 400,
            class: "bb-detail"
        });
        if (color) {
            span.setAttribute("fill", color);
        }
        span.textContent = " " + text;
        label.appendChild(span);
    }

    private bindSegment(rect: SVGRectElement, model: Model, cat: Cat, series: Series): void {
        const k = series.index;
        const tooltip = (): VisualTooltipDataItem[] => {
            const value = cat.parts[k];
            const items: VisualTooltipDataItem[] = [{ displayName: model.categoryName, value: cat.label }];
            if (model.hasLegend) {
                items.push({ displayName: model.legendName, value: series.name, color: series.color });
            }
            items.push({ displayName: model.valueName, value: model.format(value), color: model.hasLegend ? undefined : series.color });
            if (model.series.length > 1) {
                items.push({ displayName: "% da barra", value: this.pct(cat.total > 0 ? value / cat.total : 0) });
                items.push({ displayName: "Total da barra", value: model.format(cat.total) });
            }
            items.push({ displayName: "% do total geral", value: this.pct(model.grandTotal > 0 ? value / model.grandTotal : 0) });
            const detail = this.detailValue(cat, k);
            if (model.detailName && detail !== undefined) {
                items.push({ displayName: model.detailName, value: model.detailFormat(detail) });
            }
            items.push({ displayName: "Registros na base", value: this.count(cat.counts[k]) });
            return items;
        };
        const show = (e: MouseEvent, move: boolean): void => {
            const args = { coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: tooltip(), identities: [] };
            if (move) {
                this.host.tooltipService.move(args);
            } else {
                this.host.tooltipService.show(args);
            }
        };
        rect.addEventListener("mouseenter", (e: MouseEvent) => show(e, false));
        rect.addEventListener("mousemove", (e: MouseEvent) => show(e, true));
        rect.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
        rect.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            const { kind, item } = this.segmentItem(cat, series);
            this.select(kind, item, e.ctrlKey || e.metaKey || e.shiftKey);
        });
        rect.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectionManager.showContextMenu(model.hasLegend ? series.selectionId : {} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
    }

    // ------------------------------------------------------------- base nominal

    private applyTableStyles(panel: HTMLElement): void {
        const s = this.formattingSettings;
        const p = s.panelCard;
        const h = s.headerCard;
        const r = s.rowsCard;
        const t = s.tableCard;
        const vars: Record<string, string> = {
            "--bb-panel-bg": p.fill.value.value,
            "--bb-panel-radius": Math.max(0, p.radius.value) + "px",
            "--bb-panel-bw": Math.max(0, p.borderWidth.value) + "px",
            "--bb-panel-bc": p.borderColor.value.value,
            "--bb-chip-bg": p.chipFill.value.value,
            "--bb-chip-fg": p.chipColor.value.value,
            "--bb-title-size": t.titleFontSize.value + "px",
            "--bb-title-fg": t.titleColor.value.value,
            "--bb-head-bg": h.fill.value.value,
            "--bb-head-fg": h.fontColor.value.value,
            "--bb-head-size": h.fontSize.value + "px",
            "--bb-head-case": h.uppercase.value ? "uppercase" : "none",
            "--bb-row-bg": r.fill.value.value,
            "--bb-row-fg": r.fontColor.value.value,
            "--bb-row-size": r.fontSize.value + "px",
            "--bb-row-h": this.rowHeight() + "px",
            "--bb-zebra": r.zebra.value ? r.zebraColor.value.value : r.fill.value.value,
            "--bb-grid": r.gridColor.value.value,
            "--bb-table-radius": Math.max(0, r.radius.value) + "px"
        };
        for (const [k, v] of Object.entries(vars)) {
            panel.style.setProperty(k, v);
        }
    }

    private rowHeight(): number {
        return Math.max(18, this.formattingSettings.rowsCard.height.value);
    }

    private renderTable(pane: HTMLElement, model: Model): void {
        const s = this.formattingSettings;
        const t = s.tableCard;
        const font = s.generalCard.fontFamily.value;
        const panel = el("div", "bb-panel");
        this.applyTableStyles(panel);
        pane.appendChild(panel);

        // Título e contagem.
        const head = el("div", "bb-panel-head");
        const title = String(t.title.value ?? "");
        if (title) {
            head.appendChild(el("div", "bb-title", title));
        }
        const count = el("div", "bb-count");
        count.hidden = !t.showCount.value;
        head.appendChild(count);
        panel.appendChild(head);

        // Filtro ativo (chips) ou dica.
        const filterBar = el("div", "bb-filterbar");
        panel.appendChild(filterBar);

        // Pesquisa.
        if (t.showSearch.value) {
            const box = el("label", "bb-search");
            box.appendChild(icon(ICON_SEARCH));
            const input = el("input");
            input.type = "text";
            input.placeholder = "Pesquisar na base…";
            input.value = this.search;
            const clear = el("button", "bb-search-clear");
            clear.type = "button";
            clear.title = "Limpar pesquisa";
            clear.appendChild(icon(ICON_CLOSE, 12));
            clear.hidden = !this.search;
            input.addEventListener("input", () => {
                this.search = input.value;
                clear.hidden = !this.search;
                if (this.table) {
                    this.table.grid.scrollTop = 0;
                }
                this.refreshTable();
            });
            input.addEventListener("keydown", (e: KeyboardEvent) => {
                // As teclas ficam na pesquisa (não vão para o Power BI).
                e.stopPropagation();
                if (e.key === "Escape") {
                    input.value = "";
                    input.dispatchEvent(new Event("input"));
                }
            });
            clear.addEventListener("click", (e: MouseEvent) => {
                e.preventDefault();
                input.value = "";
                input.dispatchEvent(new Event("input"));
            });
            box.append(input, clear);
            panel.appendChild(box);
        } else {
            this.search = "";
        }

        // Tabela com rolagem; só as linhas visíveis são desenhadas.
        const grid = el("div", "bb-grid");
        const inner = el("div", "bb-inner");
        const headRow = el("div", "bb-head");
        const body = el("div", "bb-body");
        inner.append(headRow, body);
        grid.appendChild(inner);
        const empty = el("div", "bb-no-rows");
        const wrap = el("div", "bb-grid-wrap");
        wrap.append(grid, empty);
        panel.appendChild(wrap);

        if (this.loading || this.truncated) {
            const foot = el("div", "bb-foot", this.loading
                ? "Carregando mais registros…"
                : `Mostrando os primeiros ${this.count(model.records.length)} registros (limite em Formatar → Base nominal).`);
            panel.appendChild(foot);
        }

        // Larguras das colunas a partir do cabeçalho e de uma amostra das linhas.
        const marker = t.colorMarker.value && model.hasLegend;
        const rowSize = s.rowsCard.fontSize.value;
        const headSize = s.headerCard.fontSize.value;
        const sample = model.records.slice(0, 300);
        const widths = model.columns.map((column, c) => {
            let w = textWidth(s.headerCard.uppercase.value ? column.name.toUpperCase() : column.name, headSize, font, true) + 30;
            for (const rec of sample) {
                w = Math.max(w, textWidth(this.cellText(rec, c), rowSize, font) + 24);
            }
            if (c === 0 && marker) {
                w += 16;
            }
            return Math.round(Math.min(300, Math.max(64, w)));
        });
        const template = widths.map(w => `minmax(${w}px, ${w}fr)`).join(" ");
        inner.style.minWidth = widths.reduce((a, b) => a + b, 0) + "px";
        headRow.style.gridTemplateColumns = template;

        model.columns.forEach((column, c) => {
            const cell = el("div", "bb-th" + (column.numeric ? " bb-num" : ""));
            cell.appendChild(el("span", "bb-th-text", column.name));
            cell.title = "Clique para ordenar por " + column.name;
            cell.dataset.col = String(c);
            cell.addEventListener("click", () => {
                const current = this.sort;
                if (!current || current.column !== column.name) {
                    this.sort = { column: column.name, dir: 1 };
                } else if (current.dir === 1) {
                    this.sort = { column: column.name, dir: -1 };
                } else {
                    this.sort = undefined;
                }
                this.refreshTable();
            });
            headRow.appendChild(cell);
        });

        this.table = {
            count, filterBar, grid, inner, head: headRow, body, empty, template,
            rows: [], rowHeight: this.rowHeight(), frame: 0
        };
        grid.addEventListener("scroll", () => {
            const table = this.table;
            if (table && !table.frame) {
                table.frame = requestAnimationFrame(() => {
                    table.frame = 0;
                    this.renderRows();
                });
            }
        });
        this.refreshTable();
    }

    private cellText(rec: Rec, c: number): string {
        const columns = this.model?.columns || [];
        if (!rec.text) {
            rec.text = new Array(columns.length);
        }
        let text = rec.text[c];
        if (text === undefined) {
            const column = columns[c];
            text = rec.text[c] = column ? column.format(column.value(rec)) : "";
        }
        return text;
    }

    private searchText(rec: Rec): string {
        if (rec.search === undefined) {
            const columns = this.model?.columns || [];
            rec.search = normalize(columns.map((_, c) => this.cellText(rec, c)).join("\u0001"));
        }
        return rec.search;
    }

    private recordOn(rec: Rec): boolean {
        return this.segmentOn(rec.cat, rec.series);
    }

    /** Filtra (seleção + pesquisa), ordena e redesenha a base. */
    private refreshTable(): void {
        const model = this.model;
        const table = this.table;
        if (!model || !table) {
            return;
        }
        let rows = this.selection.items.size ? model.records.filter(r => this.recordOn(r)) : model.records.slice();
        const query = normalize(this.search.trim());
        if (query) {
            rows = rows.filter(r => this.searchText(r).includes(query));
        }
        const sortIndex = this.sort ? model.columns.findIndex(c => c.name === this.sort?.column) : -1;
        if (sortIndex >= 0 && this.sort) {
            const column = model.columns[sortIndex];
            const dir = this.sort.dir;
            rows.sort((a, b) => {
                const va = column.value(a);
                const vb = column.value(b);
                // Vazios sempre no fim.
                if (isBlank(va) || isBlank(vb)) {
                    return compareRaw(va, vb);
                }
                return dir * compareRaw(va, vb) || a.row - b.row;
            });
        }
        table.rows = rows;

        // Contagem.
        const total = model.records.length;
        table.count.textContent = rows.length === total
            ? `${this.count(total)} ${total === 1 ? "registro" : "registros"}`
            : `${this.count(rows.length)} de ${this.count(total)}`;

        // Indicador de ordenação.
        table.head.querySelectorAll<HTMLElement>(".bb-th").forEach(cell => {
            cell.querySelector(".bb-sort")?.remove();
            const on = Number(cell.dataset.col) === sortIndex && !!this.sort;
            cell.classList.toggle("bb-sorted", on);
            if (on && this.sort) {
                const arrow = icon(this.sort.dir === 1 ? ICON_SORT_UP : ICON_SORT_DOWN, 12);
                arrow.classList.add("bb-sort");
                cell.appendChild(arrow);
            }
        });

        this.renderFilterBar(model, table.filterBar);
        table.empty.textContent = rows.length ? "" : (total ? "Nenhum registro encontrado." : "Sem registros.");
        table.empty.hidden = rows.length > 0;
        table.body.style.height = rows.length * table.rowHeight + "px";
        this.renderRows();
    }

    private renderFilterBar(model: Model, bar: HTMLElement): void {
        bar.replaceChildren();
        const sel = this.selection;
        if (sel.items.size === 0) {
            const hint = el("div", "bb-hint");
            hint.appendChild(icon(ICON_FILTER, 12));
            hint.appendChild(el("span", undefined, model.hasLegend
                ? "Clique numa barra ou na legenda para filtrar a base."
                : "Clique numa barra para filtrar a base."));
            bar.appendChild(hint);
            return;
        }
        const seriesByKey = new Map(model.series.map(s => [s.key, s]));
        const catByKey = new Map(model.cats.map(c => [c.key, c]));
        const items = Array.from(sel.items.values());
        const shown = items.slice(0, 3);
        for (const item of shown) {
            const chip = el("span", "bb-chip");
            const series = item.leg ? seriesByKey.get(item.leg) : undefined;
            if (series) {
                const dot = el("span", "bb-chip-dot");
                dot.style.background = series.color;
                chip.appendChild(dot);
            }
            const parts: string[] = [];
            if (sel.kind !== "legend") {
                parts.push(catByKey.get(item.cat)?.label ?? label(item.catRaw ?? null, undefined, this.locale));
            }
            if (sel.kind !== "category") {
                parts.push(series?.name ?? label(item.legRaw ?? null, undefined, this.locale));
            }
            const text = parts.join(" · ");
            chip.appendChild(el("span", "bb-chip-text", text));
            chip.title = text;
            const remove = el("button", "bb-chip-x");
            remove.type = "button";
            remove.title = "Remover este filtro";
            remove.appendChild(icon(ICON_CLOSE, 11));
            remove.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                const next: Selection = { kind: sel.kind, items: new Map(sel.items) };
                next.items.delete(itemKey(item));
                this.setSelection(next.items.size ? next : emptySelection());
            });
            chip.appendChild(remove);
            bar.appendChild(chip);
        }
        if (items.length > shown.length) {
            bar.appendChild(el("span", "bb-chip bb-chip-more", "+" + (items.length - shown.length)));
        }
        const clear = el("button", "bb-clear", "Limpar");
        clear.type = "button";
        clear.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.setSelection(emptySelection());
        });
        bar.appendChild(clear);
    }

    /** Desenha só as linhas visíveis (com folga), para aguentar dezenas de milhares de registros. */
    private renderRows(): void {
        const model = this.model;
        const table = this.table;
        if (!model || !table) {
            return;
        }
        const h = table.rowHeight;
        const headH = table.head.offsetHeight;
        const viewTop = Math.max(0, table.grid.scrollTop - headH);
        const viewH = table.grid.clientHeight || 400;
        const start = Math.max(0, Math.floor(viewTop / h) - OVERSCAN);
        const end = Math.min(table.rows.length, Math.ceil((viewTop + viewH) / h) + OVERSCAN);
        const marker = this.formattingSettings.tableCard.colorMarker.value && model.hasLegend;

        const fragment = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
            const rec = table.rows[i];
            const row = el("div", "bb-row" + (i % 2 ? " bb-odd" : ""));
            row.style.top = i * h + "px";
            row.style.gridTemplateColumns = table.template;
            model.columns.forEach((column, c) => {
                const text = this.cellText(rec, c);
                const cell = el("div", "bb-td" + (column.numeric ? " bb-num" : ""));
                if (c === 0 && marker) {
                    const dot = el("span", "bb-row-dot");
                    dot.style.background = model.series[rec.series].color;
                    cell.appendChild(dot);
                }
                cell.appendChild(el("span", "bb-td-text", text));
                cell.title = text;
                row.appendChild(cell);
            });
            row.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectionManager.showContextMenu(model.rowId(rec), { x: e.clientX, y: e.clientY });
            });
            fragment.appendChild(row);
        }
        table.body.replaceChildren(fragment);
    }
}
