"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
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
import DataViewValueColumn = powerbi.DataViewValueColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel, enumValue } from "./settings";

type Formatter = (v: PrimitiveValue) => string;

/** Uma medida de avaliação, com um valor por item do campo Linhas (ou um só, sem campo). */
interface Series {
    name: string;
    format: string | undefined;
    values: Array<number | null>;
}

/** Linha ou coluna da tabela: um item do campo, uma medida ou a coluna única "Nota". */
interface Line {
    label: string;
    /** Item do campo Linhas que esta linha/coluna representa (filtro cruzado). */
    cat?: number;
    /** Medida que esta linha/coluna representa. */
    series?: number;
}

interface Grid {
    rowTitle: string;
    rows: Line[];
    cols: Line[];
    /** Item do campo (filtro cruzado) e medida de cada célula. */
    cell: (r: Line, c: Line) => { cat: number | undefined; series: number };
    /** Nº de respostas: coluna (por linha), linha (por coluna) ou base única abaixo da tabela. */
    countAxis: "col" | "row" | "footer" | "none";
}

interface Model {
    categoryName: string;
    labels: string[];
    selectionIds: ISelectionId[];
    series: Series[];
    countColumn: DataViewValueColumn | undefined;
    countFormat: Formatter;
    tooltipColumns: DataViewValueColumn[];
    grid: Grid;
}

/** Ordenação escolhida ao clicar no cabeçalho: coluna (índice), nome ou média. */
interface SortState {
    key: number | "label" | "avg";
    dir: 1 | -1;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const STAR = "M12 2.6l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.01l-5.64 2.97 1.08-6.29-4.57-4.45 6.31-.92z";

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

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
    }
    return node;
}

function toNumber(value: PrimitiveValue | undefined): number | null {
    return typeof value === "number" && isFinite(value) ? value : null;
}

function label(value: PrimitiveValue, format: string | undefined, locale: string): string {
    if (value === null || value === undefined || value === "") {
        return "(Em branco)";
    }
    if (format || value instanceof Date) {
        return valueFormatter.format(value, format, false, locale);
    }
    return String(value);
}

function mean(values: Array<number | null>): number | null {
    const nums = values.filter((v): v is number => v !== null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** Largura aproximada de um texto (para dimensionar as colunas). */
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

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private model: Model | undefined;
    private sort: SortState | undefined;
    /** Assinatura dos campos: a ordenação por clique é desfeita quando os campos mudam. */
    private fieldsKey = "";
    private width = 0;
    private height = 0;
    /** Tamanho e espaço das estrelas nesta renderização (encolhem para caber na largura). */
    private starSize = 18;
    private starGap = 3;
    private locale = "pt-BR";

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "ta-root");
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI (fora das células).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
        // Clique no vazio limpa a seleção.
        this.root.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as Element).closest("[data-cat], th")) {
                this.selectionManager.clear().then(() => this.paintSelection());
            }
        });
        this.selectionManager.registerOnSelectCallback(() => this.paintSelection());
    }

    // ---------------------------------------------------------------- update

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.locale = this.host.locale || "pt-BR";
            this.width = options.viewport.width;
            this.height = options.viewport.height;
            this.model = this.buildModel(dataView);
            const key = this.model
                ? [this.model.grid.rows.length, this.model.grid.cols.map(c => c.label).join("|"),
                    enumValue(this.formattingSettings.layoutCard.sortBy)].join("¦")
                : "";
            if (key !== this.fieldsKey) {
                this.fieldsKey = key;
                this.sort = undefined;
            }
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        const bands = s.bandsCard;
        bands.lowLimit.visible = bands.lowColor.visible = bands.highLimit.visible = bands.highColor.visible =
            bands.applyToNumber.visible = bands.show.value;
        s.rowsCard.zebraColor.visible = s.rowsCard.zebra.value;
        s.starsCard.outlineColor.visible = s.starsCard.outlineWidth.value > 0;
        const nums = s.numbersCard;
        nums.position.visible = nums.decimals.visible = nums.showMax.visible = nums.useMeasureFormat.visible =
            nums.fontSize.visible = nums.fontColor.visible = nums.bold.visible = nums.show.value;
        nums.decimals.visible = nums.show.value && !nums.useMeasureFormat.value;
        const sum = s.summaryCard;
        sum.columnTitle.visible = sum.showColumn.value;
        sum.rowTitle.visible = sum.showRow.value;
        return this.formattingSettingsService.buildFormattingModel(s);
    }

    // ------------------------------------------------------------- dados

    private buildModel(dataView: DataView | undefined): Model | undefined {
        const categorical = dataView?.categorical;
        const values = categorical?.values ? Array.from(categorical.values) : [];
        const ratingColumns = values.filter(c => c.source.roles?.["ratings"]);
        if (ratingColumns.length === 0) {
            return undefined;
        }
        const locale = this.locale;
        const category = categorical?.categories?.[0];
        const countColumn = values.find(c => c.source.roles?.["count"]);
        const tooltipColumns = values.filter(c => c.source.roles?.["tooltips"]);
        const size = category ? category.values.length : 1;
        const countFormatter = valueFormatter.create({ format: countColumn?.source.format || "#,0", cultureSelector: locale });

        const series: Series[] = ratingColumns.map(c => ({
            name: c.source.displayName,
            format: c.source.format,
            values: Array.from({ length: size }, (_, i) => toNumber(c.values[i]))
        }));
        const labels = category ? category.values.map(v => label(v, category.source.format, locale)) : [];
        const selectionIds = category
            ? category.values.map((_, i) => this.host.createSelectionIdBuilder().withCategory(category, i).createSelectionId())
            : [];

        let orientation = enumValue(this.formattingSettings.layoutCard.orientation);
        if (!category) {
            orientation = "single";
        } else if (orientation !== "measureRows") {
            orientation = "categoryRows";
        }
        const seriesLines: Line[] = series.map((s, i) => ({ label: s.name, series: i }));
        const catLines: Line[] = labels.map((l, i) => ({ label: l, cat: i }));
        let grid: Grid;
        if (orientation === "categoryRows") {
            grid = {
                rowTitle: category?.source.displayName ?? "",
                rows: catLines,
                cols: seriesLines,
                cell: (r, c) => ({ cat: r.cat, series: c.series ?? 0 }),
                countAxis: countColumn ? "col" : "none"
            };
        } else if (orientation === "measureRows") {
            grid = {
                rowTitle: "Avaliação",
                rows: seriesLines,
                cols: catLines,
                cell: (r, c) => ({ cat: c.cat, series: r.series ?? 0 }),
                countAxis: countColumn ? "row" : "none"
            };
        } else {
            grid = {
                rowTitle: "Avaliação",
                rows: seriesLines,
                cols: [{ label: "Nota" }],
                cell: r => ({ cat: undefined, series: r.series ?? 0 }),
                countAxis: countColumn ? "footer" : "none"
            };
        }

        return {
            categoryName: category?.source.displayName ?? "",
            labels,
            selectionIds,
            series,
            countColumn,
            countFormat: v => (v === null || v === undefined ? "—" : countFormatter.format(v)),
            tooltipColumns,
            grid
        };
    }

    private value(model: Model, r: Line, c: Line): number | null {
        const { cat, series } = model.grid.cell(r, c);
        return model.series[series].values[cat ?? 0];
    }

    private rowMean(model: Model, r: Line): number | null {
        return mean(model.grid.cols.map(c => this.value(model, r, c)));
    }

    /** Linhas na ordem escolhida (clique no cabeçalho ou ordenação inicial do painel). */
    private orderedRows(model: Model): Line[] {
        const rows = model.grid.rows.slice();
        let sort = this.sort;
        if (!sort) {
            const initial = enumValue(this.formattingSettings.layoutCard.sortBy);
            sort = initial === "best" ? { key: "avg", dir: -1 }
                : initial === "worst" ? { key: "avg", dir: 1 }
                    : initial === "label" ? { key: "label", dir: 1 }
                        : undefined;
        }
        if (!sort) {
            return rows;
        }
        const { key, dir } = sort;
        const index = new Map(rows.map((r, i) => [r, i]));
        if (key === "label") {
            rows.sort((a, b) => dir * a.label.localeCompare(b.label, this.locale, { numeric: true, sensitivity: "base" })
                || index.get(a) - index.get(b));
            return rows;
        }
        const of = (r: Line): number | null => key === "avg" ? this.rowMean(model, r) : this.value(model, r, model.grid.cols[key]);
        // Vazios sempre no fim, qualquer que seja a direção.
        rows.sort((a, b) => {
            const va = of(a);
            const vb = of(b);
            if (va === null || vb === null) {
                return va === vb ? index.get(a) - index.get(b) : va === null ? 1 : -1;
            }
            return dir * (va - vb) || index.get(a) - index.get(b);
        });
        return rows;
    }

    /** Clique no cabeçalho: maior primeiro → menor primeiro → ordem inicial (nome: A–Z → Z–A → inicial). */
    private toggleSort(key: SortState["key"]): void {
        const first: 1 | -1 = key === "label" ? 1 : -1;
        const current = this.sort;
        if (!current || current.key !== key) {
            this.sort = { key, dir: first };
        } else if (current.dir === first) {
            this.sort = { key, dir: first === 1 ? -1 : 1 };
        } else {
            this.sort = undefined;
        }
        this.render();
    }

    private ratingFormatter(model: Model, seriesIndex: number): Formatter {
        const nums = this.formattingSettings.numbersCard;
        const format = nums.useMeasureFormat.value && model.series[seriesIndex]?.format
            ? model.series[seriesIndex].format
            : (() => {
                const d = Math.max(0, Math.min(4, Math.round(nums.decimals.value)));
                return d > 0 ? "0." + "0".repeat(d) : "0";
            })();
        const f = valueFormatter.create({ format, cultureSelector: this.locale });
        return v => (v === null || v === undefined ? "—" : f.format(v));
    }

    // ------------------------------------------------------------- desenho

    /** Estrelas preenchidas proporcionalmente à nota (desenhadas em SVG, sem ids). */
    private stars(value: number, fillColor: string): SVGSVGElement {
        const s = this.formattingSettings;
        const st = s.starsCard;
        const count = Math.max(1, Math.min(10, Math.round(s.scaleCard.starCount.value)));
        const max = s.scaleCard.maxValue.value > 0 ? s.scaleCard.maxValue.value : 5;
        let filled = Math.max(0, Math.min(count, (value / max) * count));
        const mode = enumValue(s.scaleCard.fillMode);
        if (mode === "half") {
            filled = Math.round(filled * 2) / 2;
        } else if (mode === "whole") {
            filled = Math.round(filled);
        }
        const size = this.starSize;
        const gap = this.starGap;
        const width = count * size + (count - 1) * gap;
        const root = svg("svg", { width, height: size, viewBox: `0 0 ${width} ${size}`, class: "ta-stars" });
        const outline = Math.max(0, st.outlineWidth.value);
        const emptyOpacity = String(Math.max(0, Math.min(100, st.emptyOpacity.value)) / 100);
        const circle = enumValue(st.shape) === "circle";
        // Desenha a forma numa caixa 24×24.
        const shape = (attrs: Record<string, string | number>): SVGElement => circle
            ? svg("circle", { cx: 12, cy: 12, r: 9.5, ...attrs })
            : svg("path", { d: STAR, "stroke-linejoin": "round", ...attrs });

        for (let i = 0; i < count; i++) {
            const x = i * (size + gap);
            const g = svg("svg", { x, y: 0, width: size, height: size, viewBox: "0 0 24 24", overflow: "visible" });
            g.appendChild(shape({ fill: st.empty.value.value, "fill-opacity": emptyOpacity }));
            const part = Math.max(0, Math.min(1, filled - i));
            if (part > 0) {
                // O <svg> interno recorta a forma na largura preenchida.
                const clip = svg("svg", { x: 0, y: 0, width: 24 * part, height: 24, viewBox: `0 0 ${24 * part} 24` });
                clip.appendChild(shape({ fill: fillColor }));
                g.appendChild(clip);
            }
            if (outline > 0) {
                g.appendChild(shape({ fill: "none", stroke: st.outlineColor.value.value, "stroke-width": outline * 24 / size }));
            }
            root.appendChild(g);
        }
        return root;
    }

    private bandColor(value: number | null): string | undefined {
        const b = this.formattingSettings.bandsCard;
        if (!b.show.value || value === null) {
            return undefined;
        }
        if (value < b.lowLimit.value) {
            return b.lowColor.value.value;
        }
        if (value >= b.highLimit.value) {
            return b.highColor.value.value;
        }
        return undefined;
    }

    /** Conteúdo de uma célula de nota: estrelas e o número. */
    private ratingContent(value: number | null, format: Formatter): HTMLElement {
        const s = this.formattingSettings;
        const nums = s.numbersCard;
        const box = el("div", "ta-rating");
        box.classList.toggle("ta-below", enumValue(nums.position) === "below");
        if (value === null) {
            const dash = el("span", "ta-dash", "—");
            dash.style.fontSize = nums.fontSize.value + "px";
            box.appendChild(dash);
            return box;
        }
        const band = this.bandColor(value);
        box.appendChild(this.stars(value, band || s.starsCard.fill.value.value));
        if (nums.show.value) {
            const n = el("span", "ta-number", format(value));
            n.style.fontSize = nums.fontSize.value + "px";
            n.style.color = s.bandsCard.applyToNumber.value && band ? band : nums.fontColor.value.value;
            n.style.fontWeight = nums.bold.value ? "600" : "400";
            if (nums.showMax.value) {
                const m = el("span", "ta-max", " /" + format(s.scaleCard.maxValue.value).replace(/[,.]0+$/, ""));
                m.style.fontSize = Math.round(nums.fontSize.value * 0.78) + "px";
                n.appendChild(m);
            }
            box.appendChild(n);
        }
        return box;
    }

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        root.style.fontFamily = font;
        const model = this.model;

        // ---- cabeçalho
        const header = s.headerCard;
        if (header.title.value || header.subtitle.value) {
            const head = el("div", "ta-header");
            if (header.title.value) {
                const t = el("div", "ta-title", header.title.value);
                t.style.fontSize = header.titleSize.value + "px";
                t.style.color = header.titleColor.value.value;
                head.appendChild(t);
            }
            if (header.subtitle.value) {
                const t = el("div", "ta-subtitle", header.subtitle.value);
                t.style.fontSize = header.subtitleSize.value + "px";
                t.style.color = header.subtitleColor.value.value;
                head.appendChild(t);
            }
            root.appendChild(head);
        }

        if (!model) {
            const empty = el("div", "ta-empty");
            empty.appendChild(el("div", "ta-empty-title", "Tabela de Avaliação"));
            empty.appendChild(el("div", "ta-empty-text",
                "Coloque uma ou mais medidas com a nota (1 a 5) em Avaliações. Opcional: um campo em Linhas (ex.: Unidade) e o Nº de respostas."));
            root.appendChild(empty);
            return;
        }

        const grid = model.grid;
        const th = s.tableHeaderCard;
        const rs = s.rowsCard;
        const nums = s.numbersCard;
        const st = s.starsCard;
        const counts = s.countsCard;
        const sum = s.summaryCard;
        const frame = s.frameCard;
        const showCount = counts.show.value && grid.countAxis !== "none";
        const showMeanCol = sum.showColumn.value && grid.cols.length > 1;
        const showMeanRow = sum.showRow.value && grid.rows.length > 1;
        const clickSort = s.layoutCard.clickSort.value;
        const sepW = Math.max(0, rs.separatorWidth.value);
        const divider = `${Math.max(0, sum.dividerWidth.value)}px solid ${sum.dividerColor.value.value}`;
        const countTitle = counts.title.value || model.countColumn?.source.displayName || "Respostas";
        const meanFormat = this.ratingFormatter(model, 0);

        const wrap = el("div", "ta-frame");
        wrap.style.borderRadius = Math.max(0, frame.radius.value) + "px";
        if (frame.borderWidth.value > 0) {
            wrap.style.border = `${frame.borderWidth.value}px solid ${frame.borderColor.value.value}`;
        }
        wrap.style.background = rs.background.value.value;
        const scroll = el("div", "ta-scroll");
        wrap.appendChild(scroll);
        const table = el("table", "ta-table");
        scroll.appendChild(table);

        // ---- largura das colunas
        const count = Math.max(1, Math.min(10, Math.round(s.scaleCard.starCount.value)));
        const numberW = nums.show.value
            ? textWidth(meanFormat(s.scaleCard.maxValue.value) + (nums.showMax.value ? " /10" : ""), nums.fontSize.value, font, nums.bold.value)
            : 0;
        const below = enumValue(nums.position) === "below";
        const ratingWidth = (size: number, gap: number): number => {
            const starsW = count * size + (count - 1) * gap;
            return Math.ceil((below ? Math.max(starsW, numberW) : starsW + (numberW ? numberW + 10 : 0)) + 24);
        };
        const labelW = Math.ceil(Math.min(
            Math.max(textWidth(s.layoutCard.rowHeaderTitle.value || grid.rowTitle, th.fontSize.value, font, true) * (th.uppercase.value ? 1.25 : 1),
                ...grid.rows.map(r => textWidth(r.label, rs.fontSize.value, font, rs.bold.value)),
                showMeanRow ? textWidth(sum.rowTitle.value || "Média geral", rs.fontSize.value, font, true) : 0,
                showCount && grid.countAxis === "row" ? textWidth(countTitle, rs.fontSize.value, font) : 0) + 32,
            Math.max(110, this.width * 0.4)));
        const countW = showCount && grid.countAxis === "col"
            ? Math.ceil(Math.max(textWidth(countTitle, th.fontSize.value, font, true) * (th.uppercase.value ? 1.25 : 1),
                ...grid.rows.map(r => textWidth(model.countFormat(r.cat !== undefined ? model.countColumn.values[r.cat] : null), counts.fontSize.value, font))) + 24)
            : 0;
        // Com pouco espaço, as estrelas encolhem (até 60%) antes de aparecer a rolagem lateral.
        const ratingCols = grid.cols.length + (showMeanCol ? 1 : 0);
        const available = this.width - 8 - 2 * Math.max(0, frame.borderWidth.value) - labelW - countW;
        let scale = 1;
        const fullW = ratingWidth(Math.max(6, st.size.value), Math.max(0, st.gap.value)) * ratingCols;
        if (fullW > available) {
            const fixed = ratingCols * (ratingWidth(0, 0));
            scale = Math.max(0.6, Math.min(1, (available - fixed) / Math.max(1, fullW - fixed)));
        }
        this.starSize = Math.max(6, st.size.value * scale);
        this.starGap = Math.max(0, st.gap.value * scale);
        const ratingW = ratingWidth(this.starSize, this.starGap);

        // ---- altura das linhas
        const lineCount = grid.rows.length + (showCount && grid.countAxis === "row" ? 1 : 0) + (showMeanRow ? 1 : 0);
        const headH = Math.max(20, th.height.value);
        const contentH = below ? this.starSize + nums.fontSize.value * 1.25 + 2 : Math.max(this.starSize, nums.fontSize.value * 1.25);
        const minRow = Math.ceil(Math.max(contentH, rs.fontSize.value * 1.3) + 8);
        let rowH = Math.max(minRow, rs.height.value);
        if (rs.fit.value) {
            const used = (root.querySelector(".ta-header")?.getBoundingClientRect().height || 0)
                + (showCount && grid.countAxis === "footer" ? counts.fontSize.value * 1.4 + 8 : 0)
                + 8 + 2 * Math.max(0, frame.borderWidth.value) + headH + 1;
            rowH = Math.max(minRow, Math.min(rowH, Math.floor((this.height - used) / Math.max(1, lineCount))));
        }

        // ---- cabeçalho das colunas
        const thead = el("thead");
        const hr = el("tr");
        thead.appendChild(hr);
        const headCell = (text: string, sortKey: SortState["key"] | undefined, minWidth: number, extraClass = ""): HTMLTableCellElement => {
            const cell = el("th", extraClass);
            cell.style.background = th.background.value.value;
            cell.style.color = th.fontColor.value.value;
            cell.style.fontSize = th.fontSize.value + "px";
            cell.style.fontWeight = th.bold.value ? "600" : "400";
            cell.style.textTransform = th.uppercase.value ? "uppercase" : "none";
            cell.style.height = headH + "px";
            cell.style.minWidth = minWidth + "px";
            const inner = el("span", "ta-th", "");
            inner.appendChild(el("span", "ta-th-text", text));
            cell.title = text;
            if (clickSort && sortKey !== undefined) {
                cell.classList.add("ta-sortable");
                const active = this.sort?.key === sortKey;
                const arrow = svg("svg", { viewBox: "0 0 24 24", width: 12, height: 12, class: "ta-arrow" + (active ? " ta-on" : "") });
                arrow.appendChild(svg("path", {
                    d: active && this.sort?.dir === 1 ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6",
                    fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round"
                }));
                inner.appendChild(arrow);
                cell.addEventListener("click", (e: MouseEvent) => {
                    e.stopPropagation();
                    this.toggleSort(sortKey);
                });
            }
            cell.appendChild(inner);
            hr.appendChild(cell);
            return cell;
        };
        const first = headCell(s.layoutCard.rowHeaderTitle.value || grid.rowTitle, "label", labelW, "ta-first");
        first.style.width = labelW + "px";
        grid.cols.forEach((c, k) => {
            const cell = headCell(c.label, grid.cols.length > 1 || grid.rows.length > 1 ? k : undefined, ratingW,
                enumValue(st.align) === "left" ? "ta-left" : "");
            if (c.cat !== undefined) {
                cell.dataset.headCat = String(c.cat);
            }
        });
        if (showCount && grid.countAxis === "col") {
            headCell(countTitle, undefined, countW, "ta-count-col");
        }
        if (showMeanCol) {
            const cell = headCell(sum.columnTitle.value || "Média", "avg", ratingW, enumValue(st.align) === "left" ? "ta-left" : "");
            cell.style.borderLeft = divider;
        }
        table.appendChild(thead);

        // ---- linhas
        const tbody = el("tbody");
        table.appendChild(tbody);
        const rows = this.orderedRows(model);
        const styleCell = (cell: HTMLTableCellElement, zebra: boolean): void => {
            cell.style.height = rowH + "px";
            cell.style.background = zebra ? rs.zebraColor.value.value : rs.background.value.value;
            cell.style.borderBottom = sepW > 0 ? `${sepW}px solid ${rs.separatorColor.value.value}` : "none";
        };
        const labelCell = (text: string, zebra: boolean, bold: boolean): HTMLTableCellElement => {
            const cell = el("td", "ta-first");
            styleCell(cell, zebra);
            const t = el("div", "ta-label", text);
            t.title = text;
            t.style.fontSize = rs.fontSize.value + "px";
            t.style.color = rs.fontColor.value.value;
            t.style.fontWeight = bold ? "600" : "400";
            t.style.maxWidth = labelW - 24 + "px";
            cell.appendChild(t);
            return cell;
        };
        const ratingCell = (value: number | null, format: Formatter, zebra: boolean): HTMLTableCellElement => {
            const cell = el("td", "ta-cell" + (enumValue(st.align) === "left" ? " ta-left" : ""));
            styleCell(cell, zebra);
            cell.appendChild(this.ratingContent(value, format));
            return cell;
        };
        const countCell = (value: PrimitiveValue | undefined, zebra: boolean): HTMLTableCellElement => {
            const cell = el("td", "ta-count");
            styleCell(cell, zebra);
            cell.appendChild(el("span", "", value === undefined ? "" : model.countFormat(value)));
            cell.style.fontSize = counts.fontSize.value + "px";
            cell.style.color = counts.fontColor.value.value;
            return cell;
        };
        const zebraOn = rs.zebra.value;

        rows.forEach((r, ri) => {
            const zebra = zebraOn && ri % 2 === 1;
            const tr = el("tr", "ta-row");
            const lc = labelCell(r.label, zebra, rs.bold.value);
            if (r.cat !== undefined) {
                lc.dataset.cat = String(r.cat);
                this.bindCell(lc, model, r, undefined);
            }
            tr.appendChild(lc);
            grid.cols.forEach(c => {
                const { cat, series } = grid.cell(r, c);
                const cell = ratingCell(this.value(model, r, c), this.ratingFormatter(model, series), zebra);
                if (cat !== undefined) {
                    cell.dataset.cat = String(cat);
                }
                this.bindCell(cell, model, r, c);
                tr.appendChild(cell);
            });
            if (showCount && grid.countAxis === "col" && r.cat !== undefined) {
                const cell = countCell(model.countColumn.values[r.cat], zebra);
                cell.dataset.cat = String(r.cat);
                this.bindCell(cell, model, r, undefined);
                tr.appendChild(cell);
            }
            if (showMeanCol) {
                const cell = ratingCell(this.rowMean(model, r), r.series !== undefined ? this.ratingFormatter(model, r.series) : meanFormat, zebra);
                cell.style.borderLeft = divider;
                if (r.cat !== undefined) {
                    cell.dataset.cat = String(r.cat);
                }
                this.bindCell(cell, model, r, undefined, true);
                tr.appendChild(cell);
            }
            tbody.appendChild(tr);
        });

        // Linha de respostas (medidas nas linhas, campo nas colunas).
        let extra = rows.length;
        if (showCount && grid.countAxis === "row") {
            const zebra = zebraOn && extra % 2 === 1;
            const tr = el("tr", "ta-row ta-count-row");
            tr.appendChild(labelCell(countTitle, zebra, rs.bold.value));
            grid.cols.forEach(c => {
                const cell = countCell(c.cat !== undefined ? model.countColumn.values[c.cat] : null, zebra);
                cell.classList.add(enumValue(st.align) === "left" ? "ta-left" : "ta-center");
                if (c.cat !== undefined) {
                    cell.dataset.cat = String(c.cat);
                    this.bindCell(cell, model, undefined, c);
                }
                tr.appendChild(cell);
            });
            if (showMeanCol) {
                const cell = countCell(undefined, zebra);
                cell.style.borderLeft = divider;
                tr.appendChild(cell);
            }
            tbody.appendChild(tr);
            extra++;
        }

        // Linha de média (média de cada coluna).
        if (showMeanRow) {
            const tr = el("tr", "ta-row ta-mean-row");
            const zebra = zebraOn && extra % 2 === 1;
            const lc = labelCell(sum.rowTitle.value || "Média geral", zebra, true);
            tr.appendChild(lc);
            const colMeans = grid.cols.map(c => mean(rows.map(r => this.value(model, r, c))));
            grid.cols.forEach((c, k) => {
                const format = c.series !== undefined ? this.ratingFormatter(model, c.series) : meanFormat;
                const cell = ratingCell(colMeans[k], format, zebra);
                if (c.cat !== undefined) {
                    cell.dataset.cat = String(c.cat);
                }
                this.bindCell(cell, model, undefined, c, true);
                tr.appendChild(cell);
            });
            if (showCount && grid.countAxis === "col") {
                tr.appendChild(countCell(undefined, zebra));
            }
            if (showMeanCol) {
                const cell = ratingCell(mean(rows.map(r => this.rowMean(model, r))), meanFormat, zebra);
                cell.style.borderLeft = divider;
                this.bindCell(cell, model, undefined, undefined, true);
                tr.appendChild(cell);
            }
            tr.querySelectorAll<HTMLElement>("td").forEach(td => (td.style.borderTop = divider));
            tbody.appendChild(tr);
        }

        root.appendChild(wrap);

        // Base de respostas (sem campo em Linhas).
        if (showCount && grid.countAxis === "footer") {
            const foot = el("div", "ta-footer", `${countTitle}: ${model.countFormat(model.countColumn.values[0])}`);
            foot.style.fontSize = counts.fontSize.value + "px";
            foot.style.color = counts.fontColor.value.value;
            root.appendChild(foot);
        }

        this.paintSelection();
    }

    // ------------------------------------------------------------- interação

    private tooltip(model: Model, r: Line | undefined, c: Line | undefined, isMean: boolean): VisualTooltipDataItem[] {
        const cat = r?.cat ?? c?.cat;
        const items: VisualTooltipDataItem[] = [];
        if (cat !== undefined) {
            items.push({ displayName: model.categoryName, value: model.labels[cat] });
        }
        const sum = this.formattingSettings.summaryCard;
        if (isMean) {
            // Coluna de média (r), linha de média (c) ou o canto entre as duas.
            const rows = model.grid.rows;
            const values = r ? model.grid.cols.map(col => this.value(model, r, col))
                : c ? rows.map(row => this.value(model, row, c))
                    : rows.map(row => this.rowMean(model, row));
            const name = r ? sum.columnTitle.value || "Média" : sum.rowTitle.value || "Média geral";
            items.push({ displayName: name, value: this.ratingFormatter(model, r?.series ?? c?.series ?? 0)(mean(values)) });
        } else if (r && c) {
            const { series } = model.grid.cell(r, c);
            items.push({ displayName: model.series[series].name, value: this.ratingFormatter(model, series)(this.value(model, r, c)) });
        } else if (cat !== undefined && r) {
            // Rótulo da linha: todas as notas daquele item.
            model.series.forEach((s, i) => items.push({ displayName: s.name, value: this.ratingFormatter(model, i)(s.values[cat]) }));
        }
        if (cat !== undefined) {
            const extra = (column: DataViewValueColumn): void => {
                const f = valueFormatter.create({ format: column.source.format, cultureSelector: this.locale });
                const v = column.values[cat];
                items.push({ displayName: column.source.displayName, value: v === null || v === undefined ? "—" : f.format(v) });
            };
            if (model.countColumn) {
                extra(model.countColumn);
            }
            model.tooltipColumns.forEach(extra);
        }
        return items;
    }

    private bindCell(cell: HTMLElement, model: Model, r: Line | undefined, c: Line | undefined, isMean = false): void {
        const cat = r?.cat ?? c?.cat;
        const id = cat !== undefined ? model.selectionIds[cat] : undefined;
        const args = (e: MouseEvent) => ({
            coordinates: [e.clientX, e.clientY], isTouchEvent: false,
            dataItems: this.tooltip(model, r, c, isMean), identities: id ? [id] : []
        });
        cell.addEventListener("mouseenter", (e: MouseEvent) => this.host.tooltipService.show(args(e)));
        cell.addEventListener("mousemove", (e: MouseEvent) => this.host.tooltipService.move(args(e)));
        cell.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
        if (!id) {
            return;
        }
        cell.tabIndex = 0;
        cell.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
        });
        cell.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
            }
        });
        cell.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectionManager.showContextMenu(id, { x: e.clientX, y: e.clientY });
        });
    }

    /** Esmaece o que não está selecionado. */
    private paintSelection(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const dim = String(Math.min(100, Math.max(0, this.formattingSettings.rowsCard.selectedOpacity.value)) / 100);
        const isOn = (cat: number): boolean => selected.length === 0 || selected.some(sel => sel.equals(model.selectionIds[cat]));
        this.root.querySelectorAll<HTMLElement>("[data-cat]").forEach(node => {
            const on = isOn(Number(node.dataset.cat));
            // Só o conteúdo esmaece: o fundo (linhas alternadas) continua igual.
            Array.from(node.children).forEach((child: HTMLElement) => (child.style.opacity = on ? "1" : dim));
        });
        this.root.querySelectorAll<HTMLElement>("[data-head-cat]").forEach(node => {
            Array.from(node.children).forEach((child: HTMLElement) => (child.style.opacity = isOn(Number(node.dataset.headCat)) ? "1" : dim));
        });
    }
}
