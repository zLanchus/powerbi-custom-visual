"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { displayUnitSystemType, valueFormatter } from "powerbi-visuals-utils-formattingutils";
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
import DataViewMatrixNode = powerbi.DataViewMatrixNode;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import {
    DARK, LINE_PALETTE, SERIES_PALETTE, WHITE, VisualFormattingSettingsModel, enumValue
} from "./settings";

type Kind = "column" | "line";
type NumFormat = (v: number) => string;

/** Um valor do eixo X. */
interface Category {
    index: number;
    label: string;
    selectionId: ISelectionId;
}

/** Uma série: um segmento das colunas (item da legenda ou medida) ou uma linha (medida). */
interface Series {
    key: string;
    kind: Kind;
    name: string;
    color: string;
    selector: powerbi.data.Selector;
    source: DataViewMetadataColumn;
    format: (v: PrimitiveValue) => string;
    values: Array<number | null>;
    /** Identidade de cada ponto (categoria × série), para o filtro cruzado. */
    selectionIds: ISelectionId[];
}

interface ExtraColumn {
    name: string;
    format: (v: PrimitiveValue) => string;
    values: PrimitiveValue[];
}

interface Model {
    categoryName: string;
    categories: Category[];
    columns: Series[];
    lines: Series[];
    extras: ExtraColumn[];
    hasLegend: boolean;
}

interface Scale {
    min: number;
    max: number;
    ticks: number[];
    /** Valor → y em pixels. */
    y: (v: number) => number;
    format: NumFormat;
    /** Valor usado para escolher as unidades automáticas dos rótulos. */
    unitBasis: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

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

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
    }
    parent?.appendChild(node);
    return node;
}

function toNumber(value: PrimitiveValue | undefined): number | null {
    return typeof value === "number" && isFinite(value) ? value : null;
}

function memberLabel(value: PrimitiveValue | undefined, source: DataViewMetadataColumn | undefined, locale: string): string {
    if (value === null || value === undefined || value === "") {
        return "(Em branco)";
    }
    if (source?.format || value instanceof Date) {
        return valueFormatter.format(value, source?.format, false, locale);
    }
    return String(value);
}

function colorOf(objects: powerbi.DataViewObjects | undefined, object: string): string | undefined {
    const fill = objects?.[object]?.["fill"] as powerbi.Fill | undefined;
    return fill?.solid?.color || undefined;
}

/** Lê um número digitado no painel ("1.000,5", "0,25", "1e6"); vazio = automático. */
function parseNumber(text: string | undefined): number | undefined {
    const raw = (text || "").trim().replace(/\s/g, "");
    if (!raw) {
        return undefined;
    }
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
    const percent = normalized.endsWith("%");
    const n = Number(percent ? normalized.slice(0, -1) : normalized);
    return isFinite(n) ? (percent ? n / 100 : n) : undefined;
}

/** Escala "bonita": limites e marcas em múltiplos de 1, 2, 2,5 ou 5. */
function niceTicks(lo: number, hi: number, count: number): number[] {
    if (!(hi > lo)) {
        hi = lo + 1;
    }
    const raw = (hi - lo) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const start = Math.floor(lo / step + 1e-9) * step;
    const end = Math.ceil(hi / step - 1e-9) * step;
    const ticks: number[] = [];
    for (let v = start; v <= end + step * 1e-6; v += step) {
        ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    }
    return ticks;
}

/** Largura de um texto em pixels. */
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

/** Corta o texto com reticências para caber na largura. */
function fit(text: string, width: number, size: number, family: string, bold = false): string {
    if (textWidth(text, size, family, bold) <= width) {
        return text;
    }
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (textWidth(text.slice(0, mid) + "…", size, family, bold) <= width) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo > 0 ? text.slice(0, lo) + "…" : "";
}

/** Cor do texto com bom contraste sobre um fundo. */
function contrastColor(background: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(background.trim());
    if (!m) {
        return DARK;
    }
    const n = parseInt(m[1], 16);
    const lin = (c: number): number => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return lum > 0.35 ? DARK : WHITE;
}

/** Retângulo com cantos arredondados só em cima (rTop) ou só embaixo (rBottom). */
function barPath(x: number, y: number, w: number, h: number, rTop: number, rBottom: number): string {
    const rt = Math.max(0, Math.min(rTop, w / 2, h));
    const rb = Math.max(0, Math.min(rBottom, w / 2, h - rt));
    return `M${x},${y + rt}`
        + (rt ? `Q${x},${y} ${x + rt},${y}` : "") + `H${x + w - rt}`
        + (rt ? `Q${x + w},${y} ${x + w},${y + rt}` : "") + `V${y + h - rb}`
        + (rb ? `Q${x + w},${y + h} ${x + w - rb},${y + h}` : "") + `H${x + rb}`
        + (rb ? `Q${x},${y + h} ${x},${y + h - rb}` : "") + "Z";
}

type Point = [number, number];

/** Caminho da linha: reta, suave (monotônica, não "passa do ponto") ou em degraus. */
function linePath(points: Point[], curve: string): string {
    if (points.length === 0) {
        return "";
    }
    if (points.length === 1) {
        return `M${points[0][0]},${points[0][1]}`;
    }
    if (curve === "step") {
        let d = `M${points[0][0]},${points[0][1]}`;
        for (let i = 1; i < points.length; i++) {
            const mid = (points[i - 1][0] + points[i][0]) / 2;
            d += `H${mid}V${points[i][1]}H${points[i][0]}`;
        }
        return d;
    }
    if (curve !== "smooth" || points.length < 3) {
        return "M" + points.map(p => `${p[0]},${p[1]}`).join("L");
    }
    // Fritsch–Carlson
    const n = points.length;
    const dx: number[] = [];
    const slope: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        dx.push(points[i + 1][0] - points[i][0]);
        slope.push((points[i + 1][1] - points[i][1]) / (dx[i] || 1));
    }
    const t: number[] = [slope[0]];
    for (let i = 1; i < n - 1; i++) {
        t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
    }
    t.push(slope[n - 2]);
    for (let i = 0; i < n - 1; i++) {
        if (slope[i] === 0) {
            t[i] = t[i + 1] = 0;
            continue;
        }
        const a = t[i] / slope[i];
        const b = t[i + 1] / slope[i];
        const s = a * a + b * b;
        if (s > 9) {
            const k = 3 / Math.sqrt(s);
            t[i] = k * a * slope[i];
            t[i + 1] = k * b * slope[i];
        }
    }
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i] / 3;
        d += `C${points[i][0] + h},${points[i][1] + t[i] * h} ${points[i + 1][0] - h},${points[i + 1][1] - t[i + 1] * h} ${points[i + 1][0]},${points[i + 1][1]}`;
    }
    return d;
}

function markerShape(shape: string, x: number, y: number, r: number, attrs: Record<string, string | number>, parent: Element): SVGElement {
    if (shape === "square") {
        return svg("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: Math.min(2, r / 2), ...attrs }, parent);
    }
    if (shape === "diamond") {
        const k = r * 1.3;
        return svg("path", { d: `M${x},${y - k}L${x + k},${y}L${x},${y + k}L${x - k},${y}Z`, ...attrs }, parent);
    }
    return svg("circle", { cx: x, cy: y, r, ...attrs }, parent);
}

const ICON_COLUMNS = "M4 20V11M10 20V5M16 20v-7M21 20H3";
const ICON_LINES = "M3 17l5-6 4 4 8-9";
const ICON_RESET = "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4";

function icon(path: string, size: number): SVGSVGElement {
    const s = svg("svg", { viewBox: "0 0 24 24", width: size, height: size, class: "cl-icon", "aria-hidden": "true" });
    svg("path", { d: path, fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" }, s);
    return s;
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

    /** Séries escondidas pela legenda interativa (chave da série). */
    private hidden = new Set<string>();
    private columnsOn = true;
    private linesOn = true;
    private startSignature = "";
    /** Anima o próximo desenho (primeira carga e cliques na legenda). */
    private animateNext = true;
    private scrollLeft = 0;

    /** Elementos desenhados, para pintar a seleção e o destaque sem redesenhar. */
    private segmentNodes: Array<{ node: SVGElement; id: ISelectionId; category: number }> = [];
    private pointNodes: Array<{ node: Element; category: number }> = [];
    private bandNodes: SVGRectElement[] = [];
    private markerNodes: Array<{ node: SVGElement; category: number; r: number }> = [];

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "cl-root");
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI (fora do gráfico).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
        // Clique no vazio limpa a seleção.
        this.root.addEventListener("click", (e: MouseEvent) => {
            const target = e.target as Element;
            if (!target.closest(".cl-plot") && !target.closest(".cl-toolbar")) {
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
            const hadModel = !!this.model;
            this.model = this.buildModel(dataView);
            if (!hadModel && this.model) {
                this.animateNext = true;
            }
            this.applyStartVisibility();
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    /** "Colunas/Linhas visíveis ao abrir": vale na carga e quando a opção muda no painel. */
    private applyStartVisibility(): void {
        const t = this.formattingSettings.togglesCard;
        const signature = `${t.startColumns.value}|${t.startLines.value}`;
        if (signature !== this.startSignature) {
            this.startSignature = signature;
            this.columnsOn = t.startColumns.value;
            this.linesOn = t.startLines.value;
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        const model = this.model;
        const t = s.togglesCard;
        const togglesOn = t.show.value;
        t.slices.forEach(slice => {
            if (slice !== t.show) {
                slice.visible = togglesOn;
            }
        });
        if (togglesOn) {
            t.columnsLabel.visible = t.linesLabel.visible = t.activeBackground.visible = t.activeFontColor.visible = t.groupButtons.value;
            t.borderColor.visible = t.borderWidth.value > 0;
        }
        s.columnsCard.borderColor.visible = s.columnsCard.borderWidth.value > 0;
        const lines = s.linesCard;
        lines.markerShape.visible = lines.markerSize.visible = lines.markerFill.visible = lines.showMarkers.value;
        lines.areaOpacity.visible = lines.showArea.value;
        const x = s.xAxisCard;
        x.lineColor.visible = x.showLine.value;
        x.titleText.visible = x.showTitle.value;
        const y = s.yAxisCard;
        y.gridColor.visible = y.gridOpacity.visible = y.gridStyle.visible = y.showGrid.value;
        y.titleText.visible = y.showTitle.value;
        const y2 = s.y2AxisCard;
        [y2.show, y2.fontSize, y2.fontColor, y2.min, y2.max, y2.units, y2.decimals, y2.showTitle, y2.titleText]
            .forEach(slice => { slice.visible = !y2.sameScale.value; });
        y2.titleText.visible = !y2.sameScale.value && y2.showTitle.value;
        s.columnLabelsCard.fontColor.visible = !s.columnLabelsCard.autoColor.value;
        const ll = s.lineLabelsCard;
        ll.fontColor.visible = !ll.useLineColor.value;
        ll.haloColor.visible = ll.halo.value;
        const it = s.interactionCard;
        it.hoverColor.visible = it.hoverOpacity.visible = it.hoverBand.value;

        // Sem linhas (ou sem colunas), as opções delas somem do painel.
        const hasLines = !model || model.lines.length > 0;
        const hasColumns = !model || model.columns.length > 0;
        s.linesCard.visible = s.y2AxisCard.visible = s.lineLabelsCard.visible = hasLines;
        s.columnsCard.visible = s.columnLabelsCard.visible = s.totalLabelsCard.visible = hasColumns;

        const cards = s.cards.slice();
        const colorCard = (name: string, displayName: string, list: Series[]): formattingSettings.SimpleCard => {
            const slices = list.map(series => new formattingSettings.ColorPicker({
                name: "fill",
                displayName: series.name,
                value: { value: series.color },
                selector: series.selector
            }));
            class ColorsCard extends formattingSettings.SimpleCard {
                name = name;
                displayName = displayName;
                slices = slices;
            }
            return new ColorsCard();
        };
        if (model) {
            const list: formattingSettings.Cards[] = [];
            for (const card of cards) {
                list.push(card);
                if (card === s.columnsCard && model.columns.length) {
                    list.push(colorCard("columnColors", "Cores das colunas", model.columns));
                }
                if (card === s.linesCard && model.lines.length) {
                    list.push(colorCard("lineColors", "Cores das linhas", model.lines));
                }
            }
            s.cards = list;
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(s);
        s.cards = cards;
        return formattingModel;
    }

    // ------------------------------------------------------------- dados

    private buildModel(dataView: DataView | undefined): Model | undefined {
        const matrix = dataView?.matrix;
        const sources = matrix?.valueSources || [];
        const rowRoot = matrix?.rows?.root;
        const rowLevels = matrix?.rows?.levels || [];
        if (!matrix || !rowRoot || rowLevels.length === 0 || sources.length === 0) {
            return undefined;
        }
        const locale = this.locale;
        const builder = (): powerbi.visuals.ISelectionIdBuilder => this.host.createSelectionIdBuilder();
        const formatOf = (source: DataViewMetadataColumn): ((v: PrimitiveValue) => string) => {
            const f = valueFormatter.create({ format: source.format, cultureSelector: locale });
            return v => (v === null || v === undefined ? "—" : f.format(v));
        };
        const role = (i: number, name: string): boolean => !!sources[i].roles?.[name];

        // ---- colunas da matriz: folhas = (item da legenda ou subtotal) × medida
        const colLevels = matrix.columns?.levels || [];
        const lastIsMeasure = colLevels.length > 0 && !!colLevels[colLevels.length - 1].sources?.[0]?.isMeasure;
        const memberLevels = lastIsMeasure ? colLevels.length - 1 : colLevels.length;
        const leafIndex = new Map<string, number>();
        const members: DataViewMatrixNode[] = [];
        let leafCounter = 0;
        const walk = (node: DataViewMatrixNode, group: string): void => {
            const children = node.children || [];
            if (children.length === 0) {
                const isMeasureLeaf = lastIsMeasure && node.level === colLevels.length - 1;
                const measure = isMeasureLeaf ? (node.levelValues?.[0]?.levelSourceIndex ?? node.levelSourceIndex ?? 0) : 0;
                leafIndex.set(group + "\u001f" + measure, leafCounter++);
                return;
            }
            children.forEach(child => {
                if (child.level !== undefined && child.level < memberLevels) {
                    if (child.isSubtotal) {
                        walk(child, "#total");
                    } else {
                        members.push(child);
                        walk(child, "m" + (members.length - 1));
                    }
                } else {
                    walk(child, group);
                }
            });
        };
        if (matrix.columns?.root) {
            walk(matrix.columns.root, "");
        }
        if (leafIndex.size === 0) {
            sources.forEach((_, i) => leafIndex.set("\u001f" + i, i));
        }
        const hasLegend = memberLevels > 0 && members.length > 0;

        // ---- categorias (linhas da matriz)
        const rowNodes = (rowRoot.children || []).filter(n => !n.isSubtotal);
        const catSource = rowLevels[0]?.sources?.[0];
        const categories: Category[] = rowNodes.map((node, index) => ({
            index,
            label: memberLabel(node.levelValues?.[0]?.value ?? node.value, catSource, locale),
            selectionId: builder().withMatrixNode(node, rowLevels).createSelectionId()
        }));
        const cell = (row: DataViewMatrixNode, group: string, measure: number): PrimitiveValue | undefined => {
            const j = leafIndex.get(group + "\u001f" + measure);
            return j === undefined ? undefined : row.values?.[j]?.value;
        };
        /** Valor da medida para a categoria inteira (sem o filtro da legenda). */
        const total = (row: DataViewMatrixNode, measure: number): PrimitiveValue | undefined => {
            if (leafIndex.has("#total\u001f" + measure)) {
                return cell(row, "#total", measure);
            }
            if (leafIndex.has("\u001f" + measure)) {
                return cell(row, "", measure);
            }
            // Sem subtotal disponível: soma dos itens da legenda.
            let sum: number | null = null;
            members.forEach((_, k) => {
                const v = toNumber(cell(row, "m" + k, measure));
                if (v !== null) {
                    sum = (sum ?? 0) + v;
                }
            });
            return sum;
        };

        const columnMeasures = sources.map((_, i) => i).filter(i => role(i, "columnValues"));
        const lineMeasures = sources.map((_, i) => i).filter(i => role(i, "lineValues"));
        const extraMeasures = sources.map((_, i) => i).filter(i => role(i, "tooltips"));

        let columns: Series[];
        if (hasLegend && columnMeasures.length > 0) {
            const measure = columnMeasures[0];
            const memberSource = colLevels[0]?.sources?.[0];
            columns = members.map((member, k) => {
                const memberId = builder().withMatrixNode(member, colLevels).createSelectionId();
                return {
                    key: "s:" + String(member.levelValues?.[0]?.value ?? member.value ?? k),
                    kind: "column" as Kind,
                    name: memberLabel(member.levelValues?.[0]?.value ?? member.value, memberSource, locale),
                    color: colorOf(member.objects, "columnColors") || SERIES_PALETTE[k % SERIES_PALETTE.length],
                    selector: memberId.getSelector(),
                    source: sources[measure],
                    format: formatOf(sources[measure]),
                    values: rowNodes.map(row => toNumber(cell(row, "m" + k, measure))),
                    selectionIds: rowNodes.map(row => builder().withMatrixNode(row, rowLevels).withMatrixNode(member, colLevels).createSelectionId())
                };
            });
        } else {
            columns = columnMeasures.map((measure, k) => this.measureSeries("column", sources[measure], k, rowNodes,
                row => total(row, measure), rowLevels, formatOf));
        }
        const lines = lineMeasures.map((measure, k) => this.measureSeries("line", sources[measure], k, rowNodes,
            row => total(row, measure), rowLevels, formatOf));
        const extras: ExtraColumn[] = extraMeasures.map(measure => ({
            name: sources[measure].displayName,
            format: formatOf(sources[measure]),
            values: rowNodes.map(row => total(row, measure) ?? null)
        }));

        if (categories.length === 0 || columns.length + lines.length === 0) {
            return undefined;
        }
        return { categoryName: catSource?.displayName || "", categories, columns, lines, extras, hasLegend };
    }

    private measureSeries(
        kind: Kind, source: DataViewMetadataColumn, k: number, rows: DataViewMatrixNode[],
        value: (row: DataViewMatrixNode) => PrimitiveValue | undefined, rowLevels: powerbi.DataViewHierarchyLevel[],
        formatOf: (source: DataViewMetadataColumn) => (v: PrimitiveValue) => string
    ): Series {
        const queryName = source.queryName || source.displayName;
        const palette = kind === "line" ? LINE_PALETTE : SERIES_PALETTE;
        return {
            key: (kind === "line" ? "l:" : "c:") + queryName,
            kind,
            name: source.displayName,
            color: colorOf(source.objects, kind === "line" ? "lineColors" : "columnColors") || palette[k % palette.length],
            selector: { metadata: queryName },
            source,
            format: formatOf(source),
            values: rows.map(row => toNumber(value(row))),
            selectionIds: rows.map(row => this.host.createSelectionIdBuilder()
                .withMatrixNode(row, rowLevels).withMeasure(queryName).createSelectionId())
        };
    }

    // ------------------------------------------------------------- formatação de números

    /**
     * Formatador para eixos e rótulos. unitsSetting: "auto", "none" ou o valor da unidade.
     * basis: valor que decide as unidades automáticas; step: intervalo do eixo (casas decimais automáticas).
     */
    private numberFormat(source: DataViewMetadataColumn | undefined, unitsSetting: string, decimals: number, basis: number, step?: number): NumFormat {
        const format = source?.format;
        const isPercent = !!format && /%/.test(format.replace(/"[^"]*"/g, ""));
        // Porcentagens nunca levam unidades (mil, mi), como nos visuais nativos.
        const unitValue = isPercent || unitsSetting === "none" ? 0 : unitsSetting === "auto" ? basis : Number(unitsSetting);
        let precision: number | undefined = decimals >= 0 ? Math.min(10, Math.round(decimals)) : undefined;
        // Unidades "inteiras", como nos gráficos nativos: 400.000 vira "400 mil" (e não "0,4 mi").
        const units = displayUnitSystemType.DisplayUnitSystemType.WholeUnits;
        const probe = valueFormatter.create({ format, value: unitValue, displayUnitSystemType: units, cultureSelector: this.locale });
        if (precision === undefined && step !== undefined && step > 0) {
            const unit = isPercent ? 0.01 : (probe.displayUnit?.value || 1);
            const scaled = step / unit;
            precision = 0;
            while (precision < 6 && Math.abs(scaled * Math.pow(10, precision) - Math.round(scaled * Math.pow(10, precision))) > 1e-6) {
                precision++;
            }
        }
        const unit = probe.displayUnit?.value || 1;
        if (precision === undefined && unit > 1) {
            // Rótulos com unidades (mil, mi): 3 algarismos, como "335 mil", "1,2 mi" e "0,12 mil".
            const byPrecision = [0, 1, 2].map(p => valueFormatter.create({
                format, value: unitValue, precision: p, displayUnitSystemType: units, cultureSelector: this.locale
            }));
            return v => {
                const scaled = Math.abs(v) / unit;
                let p = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
                // Sem zeros sobrando no fim: "1 mi" em vez de "1,00 mi".
                while (p > 0 && Math.round(scaled * Math.pow(10, p)) % 10 === 0) {
                    p--;
                }
                return byPrecision[p].format(v);
            };
        }
        if (precision === undefined) {
            return v => probe.format(v);
        }
        const f = valueFormatter.create({ format, value: unitValue, precision, displayUnitSystemType: units, cultureSelector: this.locale });
        return v => f.format(v);
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        const previousScroller = root.querySelector<HTMLElement>(".cl-scroller");
        if (previousScroller) {
            this.scrollLeft = previousScroller.scrollLeft;
        }
        root.replaceChildren();
        this.segmentNodes = [];
        this.pointNodes = [];
        this.bandNodes = [];
        this.markerNodes = [];
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        root.style.fontFamily = font;
        const model = this.model;
        const animate = this.animateNext && s.generalCard.animate.value;
        this.animateNext = false;
        root.classList.toggle("cl-animate", animate);

        // ---- cabeçalho
        const header = s.headerCard;
        if (header.title.value || header.subtitle.value) {
            const head = el("div", "cl-header");
            if (header.title.value) {
                const t = el("div", "cl-title", header.title.value);
                t.style.fontSize = header.titleSize.value + "px";
                t.style.color = header.titleColor.value.value;
                head.appendChild(t);
            }
            if (header.subtitle.value) {
                const t = el("div", "cl-subtitle", header.subtitle.value);
                t.style.fontSize = header.subtitleSize.value + "px";
                t.style.color = header.subtitleColor.value.value;
                head.appendChild(t);
            }
            root.appendChild(head);
        }

        if (!model) {
            const empty = el("div", "cl-empty");
            empty.appendChild(el("div", "cl-empty-title", "Colunas Empilhadas e Linha"));
            empty.appendChild(el("div", "cl-empty-text",
                "Coloque um campo no Eixo X e medidas no Eixo Y da coluna e/ou no Eixo Y da linha. Opcional: Legenda da coluna."));
            root.appendChild(empty);
            return;
        }

        const toggles = s.togglesCard;
        const toolbar = toggles.show.value ? this.renderToolbar(model) : undefined;
        const chart = el("div", "cl-chart");
        if (toolbar && enumValue(toggles.position) === "bottom") {
            root.append(chart, toolbar);
            toolbar.classList.add("cl-toolbar-bottom");
        } else {
            if (toolbar) {
                root.appendChild(toolbar);
            }
            root.appendChild(chart);
        }
        const rect = chart.getBoundingClientRect();
        const chartW = Math.max(0, rect.width || this.width - 16);
        const chartH = Math.max(0, rect.height || this.height - 8);
        this.renderChart(model, chart, chartW, chartH);
        this.paintSelection();
    }

    // ---- legenda interativa

    private renderToolbar(model: Model): HTMLElement {
        const t = this.formattingSettings.togglesCard;
        const bar = el("div", "cl-toolbar");
        bar.style.justifyContent = { left: "flex-start", center: "center", right: "flex-end" }[enumValue(t.align)] || "flex-start";
        const size = Math.max(8, t.fontSize.value);
        const height = Math.max(size + 8, t.height.value);
        const hiddenOpacity = String(Math.min(100, Math.max(0, t.hiddenOpacity.value)) / 100);
        const border = t.borderWidth.value > 0 ? `${t.borderWidth.value}px solid ${t.borderColor.value.value}` : "none";
        const style = (b: HTMLElement): void => {
            b.style.height = height + "px";
            b.style.borderRadius = Math.max(0, t.radius.value) + "px";
            b.style.fontSize = size + "px";
            b.style.border = border;
            b.style.padding = `0 ${Math.round(height * 0.42)}px`;
        };
        const kinds: Array<{ kind: Kind; list: Series[]; label: string; path: string }> = [
            { kind: "column", list: model.columns, label: t.columnsLabel.value || "Colunas", path: ICON_COLUMNS },
            { kind: "line", list: model.lines, label: t.linesLabel.value || "Linhas", path: ICON_LINES }
        ];
        const present = kinds.filter(k => k.list.length > 0);

        if (t.groupButtons.value && present.length > 0) {
            const group = el("div", "cl-group");
            for (const k of present) {
                const on = k.kind === "column" ? this.columnsOn : this.linesOn;
                const b = el("button", "cl-btn cl-group-btn" + (on ? " cl-on" : ""));
                b.type = "button";
                style(b);
                b.style.background = on ? t.activeBackground.value.value : t.background.value.value;
                b.style.color = on ? t.activeFontColor.value.value : t.fontColor.value.value;
                if (!on) {
                    b.style.opacity = hiddenOpacity;
                }
                b.setAttribute("aria-pressed", String(on));
                b.title = on ? `Esconder ${k.label.toLowerCase()}` : `Mostrar ${k.label.toLowerCase()}`;
                b.append(icon(k.path, Math.round(size * 1.25)), el("span", "cl-btn-text", k.label));
                b.addEventListener("click", (e: MouseEvent) => {
                    e.stopPropagation();
                    if (k.kind === "column") {
                        this.columnsOn = !this.columnsOn;
                    } else {
                        this.linesOn = !this.linesOn;
                    }
                    this.animateNext = true;
                    this.render();
                });
                group.appendChild(b);
            }
            bar.appendChild(group);
        }

        if (t.seriesChips.value) {
            const chips = el("div", "cl-chips");
            for (const k of present) {
                const groupOn = k.kind === "column" ? this.columnsOn : this.linesOn;
                for (const series of k.list) {
                    const on = groupOn && !this.hidden.has(series.key);
                    const b = el("button", "cl-btn cl-chip" + (on ? " cl-on" : ""));
                    b.type = "button";
                    style(b);
                    b.style.background = t.background.value.value;
                    b.style.color = t.fontColor.value.value;
                    if (!on) {
                        b.style.opacity = hiddenOpacity;
                    }
                    b.setAttribute("aria-pressed", String(on));
                    b.title = (on ? "Clique para esconder" : "Clique para mostrar") + " · duplo clique: mostrar só esta";
                    b.append(this.swatch(series, on, size), el("span", "cl-btn-text", series.name));
                    b.addEventListener("click", (e: MouseEvent) => {
                        e.stopPropagation();
                        this.toggleSeries(series);
                    });
                    b.addEventListener("dblclick", (e: MouseEvent) => {
                        e.stopPropagation();
                        this.solo(model, series);
                    });
                    chips.appendChild(b);
                }
            }
            bar.appendChild(chips);
        }

        // "Mostrar tudo" fica junto dos botões das séries (quebra de linha junto com eles).
        const resetParent = (bar.lastElementChild as HTMLElement | null) || bar;
        const anyHidden = this.hidden.size > 0 || (model.columns.length > 0 && !this.columnsOn) || (model.lines.length > 0 && !this.linesOn);
        if (anyHidden) {
            const reset = el("button", "cl-btn cl-reset");
            reset.type = "button";
            style(reset);
            reset.style.padding = "0";
            reset.style.width = height + "px";
            reset.style.background = "transparent";
            reset.style.border = "none";
            reset.style.color = t.fontColor.value.value;
            reset.title = "Mostrar tudo";
            reset.setAttribute("aria-label", "Mostrar tudo");
            reset.appendChild(icon(ICON_RESET, Math.round(size * 1.25)));
            reset.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.hidden.clear();
                this.columnsOn = this.linesOn = true;
                this.animateNext = true;
                this.render();
            });
            resetParent.appendChild(reset);
        }
        return bar;
    }

    /** Amostra da cor no botão: quadradinho (coluna) ou traço com ponto (linha). Vazada quando escondida. */
    private swatch(series: Series, on: boolean, size: number): SVGSVGElement {
        const w = series.kind === "line" ? Math.round(size * 1.6) : Math.round(size * 0.95);
        const h = Math.round(size * 0.95);
        const s = svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "cl-swatch", "aria-hidden": "true" });
        if (series.kind === "column") {
            svg("rect", {
                x: 1, y: 1, width: w - 2, height: h - 2, rx: Math.min(3, w / 4),
                fill: on ? series.color : "none", stroke: series.color, "stroke-width": 1.6
            }, s);
        } else {
            svg("line", { x1: 1, y1: h / 2, x2: w - 1, y2: h / 2, stroke: series.color, "stroke-width": 2.2, "stroke-linecap": "round", "stroke-dasharray": on ? "" : "2 2.5" }, s);
            svg("circle", { cx: w / 2, cy: h / 2, r: Math.max(2, h / 4), fill: on ? series.color : WHITE, stroke: series.color, "stroke-width": 1.6 }, s);
        }
        return s;
    }

    private toggleSeries(series: Series): void {
        const groupOn = series.kind === "column" ? this.columnsOn : this.linesOn;
        if (!groupOn) {
            // Grupo desligado: liga o grupo mostrando só esta série.
            const list = series.kind === "column" ? this.model?.columns : this.model?.lines;
            (list || []).forEach(x => (x === series ? this.hidden.delete(x.key) : this.hidden.add(x.key)));
            if (series.kind === "column") {
                this.columnsOn = true;
            } else {
                this.linesOn = true;
            }
        } else if (this.hidden.has(series.key)) {
            this.hidden.delete(series.key);
        } else {
            this.hidden.add(series.key);
        }
        this.animateNext = true;
        this.render();
    }

    /** Duplo clique: mostra só esta série (as do outro tipo continuam como estão). */
    private solo(model: Model, series: Series): void {
        const list = series.kind === "column" ? model.columns : model.lines;
        list.forEach(x => (x === series ? this.hidden.delete(x.key) : this.hidden.add(x.key)));
        if (series.kind === "column") {
            this.columnsOn = true;
        } else {
            this.linesOn = true;
        }
        this.animateNext = true;
        this.render();
    }

    // ---- gráfico

    private renderChart(model: Model, chart: HTMLElement, W: number, H: number): void {
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        const xs = s.xAxisCard;
        const ys = s.yAxisCard;
        const y2s = s.y2AxisCard;
        const n = model.categories.length;

        const cols = this.columnsOn ? model.columns.filter(c => !this.hidden.has(c.key)) : [];
        const lns = this.linesOn ? model.lines.filter(l => !this.hidden.has(l.key)) : [];
        const sameScale = y2s.sameScale.value;

        // ---- pilhas (positivos para cima, negativos para baixo)
        const stackPos = new Array<number>(n).fill(0);
        const stackNeg = new Array<number>(n).fill(0);
        const stackTotal: Array<number | null> = new Array(n).fill(null);
        for (const c of cols) {
            c.values.forEach((v, i) => {
                if (v === null) {
                    return;
                }
                if (v >= 0) {
                    stackPos[i] += v;
                } else {
                    stackNeg[i] += v;
                }
                stackTotal[i] = (stackTotal[i] ?? 0) + v;
            });
        }
        const lineVals = lns.flatMap(l => l.values.filter((v): v is number => v !== null));

        // ---- domínios
        const domain = (values: number[], minText: string, maxText: string, includeZero: boolean): [number, number] | undefined => {
            if (values.length === 0) {
                return undefined;
            }
            let lo = Math.min(...values);
            let hi = Math.max(...values);
            if (includeZero) {
                lo = Math.min(0, lo);
                hi = Math.max(0, hi);
            }
            const userMin = parseNumber(minText);
            const userMax = parseNumber(maxText);
            if (userMin !== undefined) {
                lo = userMin;
            }
            if (userMax !== undefined) {
                hi = userMax;
            }
            if (hi === lo) {
                hi = lo + (Math.abs(lo) || 1);
            }
            return hi > lo ? [lo, hi] : [hi, lo];
        };
        const colValues = cols.length ? [...stackPos, ...stackNeg] : [];
        const d1 = domain(sameScale ? [...colValues, ...lineVals] : colValues, ys.min.value, ys.max.value, true);
        const d2 = sameScale ? undefined : domain(lineVals, y2s.min.value, y2s.max.value, true);

        // ---- espaço do eixo X (embaixo)
        const xFont = Math.max(6, xs.fontSize.value);
        const xTitle = xs.showTitle.value ? (xs.titleText.value || model.categoryName) : "";
        const xTitleH = xTitle ? xFont + 8 : 0;
        const plotH0 = Math.max(20, H - xTitleH);

        // Contas iniciais com uma estimativa das margens; refeitas depois que os rótulos dos eixos são medidos.
        const tickCount = Math.max(2, Math.round(plotH0 / 48));
        const makeScale = (d: [number, number] | undefined, card: typeof ys | typeof y2s, source: DataViewMetadataColumn | undefined,
            top: number, bottom: number, userMin: boolean, userMax: boolean): Scale | undefined => {
            if (!d) {
                return undefined;
            }
            let ticks = niceTicks(d[0], d[1], tickCount);
            let min = userMin ? d[0] : ticks[0];
            let max = userMax ? d[1] : ticks[ticks.length - 1];
            if (userMin || userMax) {
                ticks = ticks.filter(v => v >= min - 1e-9 && v <= max + 1e-9);
            }
            if (max === min) {
                max = min + 1;
            }
            const step = ticks.length > 1 ? ticks[1] - ticks[0] : (max - min);
            const unitBasis = Math.max(Math.abs(min), Math.abs(max));
            const format = this.numberFormat(source, enumValue(card.units), card.decimals.value, unitBasis, step);
            return { min, max, ticks, format, unitBasis, y: v => top + (max - v) / (max - min) * (bottom - top) };
        };
        const colSource = (cols[0] || model.columns[0])?.source;
        const lineSource = (lns[0] || model.lines[0])?.source;

        // Margem de cima para os rótulos acima das colunas e das linhas.
        const tl = s.totalLabelsCard;
        const ll = s.lineLabelsCard;
        const topPad = Math.max(6,
            tl.show.value && cols.length ? tl.fontSize.value + 6 : 0,
            ll.show.value && lns.length && enumValue(ll.position) === "above" ? ll.fontSize.value + 10 : 0);

        // X: rotação e altura dos rótulos
        const labelBold = xs.bold.value;
        const labelWidths = model.categories.map(c => textWidth(c.label, xFont, font, labelBold));
        const maxLabelW = Math.max(0, ...labelWidths);

        const y1Font = Math.max(6, ys.fontSize.value);
        const y2Font = Math.max(6, y2s.fontSize.value);
        const y1Title = ys.showTitle.value ? (ys.titleText.value || (sameScale ? [...cols, ...lns] : cols).map(c => c.source.displayName)
            .filter((v, i, a) => a.indexOf(v) === i).join(", ")) : "";
        const y2Title = !sameScale && y2s.showTitle.value ? (y2s.titleText.value || lns.map(l => l.name).join(", ")) : "";

        const showY1 = ys.show.value && !!d1;
        const showY2 = !sameScale && y2s.show.value && !!d2;

        let xLabelH = 0;
        let rotation = 0;
        let ml = 8;
        let mr = 8;
        let contentW = 0;
        let band = 0;
        let plotBottom = plotH0;
        let scale1: Scale | undefined;
        let scale2: Scale | undefined;
        const scrollbar = 10;
        let scrolling = false;
        let padLeft = 0;
        for (let pass = 0; pass < 2; pass++) {
            scale1 = makeScale(d1, ys, sameScale ? (colSource || lineSource) : colSource, topPad, plotBottom,
                parseNumber(ys.min.value) !== undefined, parseNumber(ys.max.value) !== undefined);
            scale2 = makeScale(d2, y2s, lineSource, topPad, plotBottom,
                parseNumber(y2s.min.value) !== undefined, parseNumber(y2s.max.value) !== undefined);
            const tickW = (sc: Scale | undefined, size: number): number =>
                sc ? Math.max(0, ...sc.ticks.map(v => textWidth(sc.format(v), size, font))) : 0;
            ml = showY1 ? Math.ceil(tickW(scale1, y1Font)) + 10 + (y1Title ? y1Font + 8 : 0) : 8;
            mr = showY2 ? Math.ceil(tickW(scale2, y2Font)) + 10 + (y2Title ? y2Font + 8 : 0) : 8;
            const plotW = Math.max(20, W - ml - mr - padLeft);
            const minW = Math.max(0, xs.minWidth.value);
            scrolling = minW > 0 && n * minW > plotW;
            contentW = scrolling ? n * minW : plotW;
            band = contentW / Math.max(1, n);

            const rot = enumValue(xs.rotation);
            if (!xs.show.value) {
                rotation = 0;
                xLabelH = 4;
            } else {
                rotation = rot === "auto" ? (maxLabelW <= band - 6 ? 0 : 45) : Number(rot) || 0;
                const cap = Math.min(maxLabelW, Math.max(40, H * 0.32));
                xLabelH = rotation === 0 ? xFont * 1.3 + 8 : rotation === 45 ? cap * 0.71 + xFont + 6 : cap + 8;
            }
            plotBottom = Math.max(topPad + 20, plotH0 - xLabelH - (scrolling ? scrollbar : 0));
            if (pass === 0 && rotation > 0 && xs.show.value) {
                // O primeiro rótulo inclinado avança para a esquerda: deixa um espaço antes da primeira coluna.
                const first = Math.min(labelWidths[0] || 0, Math.max(40, H * 0.32));
                const extent = rotation === 45 ? first * 0.71 + xFont * 0.5 : xFont * 0.6;
                padLeft = Math.max(0, Math.ceil(extent - band / 2));
            }
        }
        if (!scale1 && !scale2) {
            // Tudo escondido: só a área vazia com o aviso.
            const msg = el("div", "cl-all-hidden", "Tudo escondido. Use os botões da legenda para mostrar colunas ou linhas.");
            chart.appendChild(msg);
            return;
        }
        const svgH = plotBottom + xLabelH;
        const plotTop = topPad;
        const lineScale = sameScale ? scale1 : scale2;

        // ---- eixo esquerdo e direito (fora da área que rola)
        const axisSvg = (side: "left" | "right", width: number): SVGSVGElement => {
            const a = svg("svg", { width, height: svgH, class: "cl-axis cl-axis-" + side });
            a.style[side] = "0";
            chart.appendChild(a);
            return a;
        };
        const drawAxis = (sc: Scale, side: "left" | "right", width: number, size: number, color: string, title: string): void => {
            const a = axisSvg(side, width);
            for (const v of sc.ticks) {
                const t = svg("text", {
                    x: side === "left" ? width - 8 : 8, y: sc.y(v), "font-size": size, fill: color,
                    "text-anchor": side === "left" ? "end" : "start", "dominant-baseline": "middle"
                }, a);
                t.textContent = sc.format(v);
            }
            if (title) {
                const cx = side === "left" ? size * 0.7 : width - size * 0.7;
                const cy = (plotTop + plotBottom) / 2;
                const t = svg("text", {
                    x: cx, y: cy, "font-size": size, fill: color, "text-anchor": "middle", "dominant-baseline": "middle",
                    transform: `rotate(${side === "left" ? -90 : 90} ${cx} ${cy})`, class: "cl-axis-title"
                }, a);
                t.textContent = fit(title, plotBottom - plotTop, size, font);
            }
        };
        if (showY1 && scale1) {
            drawAxis(scale1, "left", ml, y1Font, ys.fontColor.value.value, y1Title);
        }
        if (showY2 && scale2) {
            drawAxis(scale2, "right", mr, y2Font, y2s.fontColor.value.value, y2Title);
        }

        // ---- área do gráfico (rola na horizontal quando a categoria tem largura mínima)
        const scroller = el("div", "cl-scroller");
        scroller.style.left = ml + "px";
        scroller.style.right = mr + "px";
        scroller.style.overflowX = scrolling ? "auto" : "hidden";
        chart.appendChild(scroller);
        const plotSvg = svg("svg", { width: contentW + padLeft, height: svgH, class: "cl-plot" }, scroller);
        const plot = svg("g", { transform: `translate(${padLeft},0)` }, plotSvg);
        if (xTitle) {
            const t = el("div", "cl-x-title", fit(xTitle, W, xFont, font));
            t.style.fontSize = xFont + "px";
            t.style.color = xs.fontColor.value.value;
            t.style.paddingLeft = ml + "px";
            t.style.paddingRight = mr + "px";
            chart.appendChild(t);
        }

        // Grade (do eixo principal, ou do das linhas se as colunas estiverem escondidas).
        const gridScale = scale1 || scale2;
        if (ys.showGrid.value && gridScale) {
            const g = svg("g", { class: "cl-grid" }, plot);
            const style = enumValue(ys.gridStyle);
            for (const v of gridScale.ticks) {
                const y = Math.round(gridScale.y(v)) + 0.5;
                svg("line", {
                    x1: 0, x2: contentW, y1: y, y2: y, stroke: ys.gridColor.value.value,
                    "stroke-opacity": Math.min(100, Math.max(0, ys.gridOpacity.value)) / 100,
                    "stroke-dasharray": style === "dashed" ? "4 4" : style === "dotted" ? "1 3" : ""
                }, g);
            }
        }

        // Faixas de cada categoria (destaque ao passar o mouse).
        const it = s.interactionCard;
        const bands = svg("g", { class: "cl-bands" }, plot);
        for (let i = 0; i < n; i++) {
            const r = svg("rect", {
                x: i * band, y: plotTop, width: band, height: Math.max(0, plotBottom - plotTop),
                fill: it.hoverColor.value.value, "fill-opacity": 0, "data-c": i
            }, bands);
            this.bandNodes.push(r);
        }

        // ---- colunas
        const cs = s.columnsCard;
        const spacing = Math.min(95, Math.max(0, cs.spacing.value)) / 100;
        const barW = Math.max(1, band * (1 - spacing));
        const radius = Math.max(0, cs.radius.value);
        const borderW = Math.max(0, cs.borderWidth.value);
        const colOpacity = Math.min(100, Math.max(0, cs.opacity.value)) / 100;
        const cl = s.columnLabelsCard;
        const colLabelFont = Math.max(6, cl.fontSize.value);
        const segLabels: Array<{ x: number; y: number; w: number; text: string; color: string; category: number }> = [];
        if (scale1 && cols.length) {
            const sc = scale1;
            const g = svg("g", { class: "cl-columns" }, plot);
            const labelFormats = cols.map(c => this.numberFormat(c.source, enumValue(cl.units), cl.decimals.value, sc.unitBasis));
            for (let i = 0; i < n; i++) {
                const x = i * band + (band - barW) / 2;
                // Último segmento de cada lado leva o arredondamento.
                const lastPos = cols.reduce((last, c, k) => ((c.values[i] ?? 0) > 0 ? k : last), -1);
                const lastNeg = cols.reduce((last, c, k) => ((c.values[i] ?? 0) < 0 ? k : last), -1);
                let pos = 0;
                let neg = 0;
                cols.forEach((c, k) => {
                    const v = c.values[i];
                    if (v === null || v === 0) {
                        return;
                    }
                    const from = v > 0 ? pos : neg;
                    const to = from + v;
                    if (v > 0) {
                        pos = to;
                    } else {
                        neg = to;
                    }
                    const clamp = (y: number): number => Math.min(plotBottom, Math.max(plotTop, y));
                    const y0 = clamp(sc.y(from));
                    const y1 = clamp(sc.y(to));
                    const top = Math.min(y0, y1);
                    const h = Math.abs(y1 - y0);
                    if (h <= 0) {
                        return;
                    }
                    const node = svg("path", {
                        d: barPath(x, top, barW, h, v > 0 && k === lastPos ? radius : 0, v < 0 && k === lastNeg ? radius : 0),
                        fill: c.color, "fill-opacity": colOpacity, class: "cl-seg " + (v > 0 ? "cl-up" : "cl-down"), "data-s": c.key, "data-c": i
                    }, g);
                    node.style.animationDelay = Math.min(400, i * (400 / Math.max(1, n))) + "ms";
                    if (borderW > 0) {
                        node.setAttribute("stroke", cs.borderColor.value.value);
                        node.setAttribute("stroke-width", String(borderW));
                    }
                    this.segmentNodes.push({ node, id: c.selectionIds[i], category: i });
                    if (cl.show.value) {
                        const text = labelFormats[k](v);
                        const fits = h >= colLabelFont + 3 && textWidth(text, colLabelFont, font, cl.bold.value) <= barW + 2;
                        if (fits) {
                            const pos = enumValue(cl.position);
                            const yText = pos === "insideEnd" ? (v > 0 ? top + colLabelFont * 0.5 + 4 : top + h - colLabelFont * 0.5 - 4)
                                : pos === "insideBase" ? (v > 0 ? top + h - colLabelFont * 0.5 - 4 : top + colLabelFont * 0.5 + 4)
                                    : top + h / 2;
                            segLabels.push({
                                x: x + barW / 2, y: yText, text, category: i, w: textWidth(text, colLabelFont, font, cl.bold.value),
                                color: cl.autoColor.value ? contrastColor(c.color) : cl.fontColor.value.value
                            });
                        }
                    }
                });
            }
        }

        // Linha do eixo X (no zero do eixo principal, ou embaixo).
        if (xs.showLine.value) {
            const sc = scale1 && cols.length ? scale1 : undefined;
            const y = Math.round(sc && sc.min < 0 && sc.max > 0 ? sc.y(0) : plotBottom) + 0.5;
            svg("line", { x1: 0, x2: contentW, y1: y, y2: y, stroke: xs.lineColor.value.value, "stroke-opacity": 0.35, class: "cl-x-line" }, plot);
        }

        // ---- linhas
        const ls = s.linesCard;
        const curve = enumValue(ls.curve);
        const nulls = enumValue(ls.nulls);
        const lineW = Math.max(0.5, ls.width.value);
        const dash = enumValue(ls.style);
        const markerR = Math.max(1, ls.markerSize.value);
        const shape = enumValue(ls.markerShape);
        const hollow = enumValue(ls.markerFill) === "hollow";
        const lineLabels: Array<{ x: number; y: number; text: string; color: string; category: number; above: boolean }> = [];
        if (lineScale && lns.length) {
            const sc = lineScale;
            const g = svg("g", { class: "cl-lines" }, plot);
            const clampY = (y: number): number => Math.min(plotBottom, Math.max(plotTop, y));
            const baseY = clampY(sc.y(Math.min(sc.max, Math.max(sc.min, 0))));
            lns.forEach(l => {
                const points: Array<Point | null> = l.values.map((v, i) => {
                    const value = v === null && nulls === "zero" ? 0 : v;
                    return value === null ? null : [i * band + band / 2, clampY(sc.y(value))];
                });
                // Trechos contínuos (vazios interrompem a linha, a não ser que a opção ligue os pontos).
                const runs: Point[][] = [];
                let current: Point[] = [];
                points.forEach(p => {
                    if (p) {
                        current.push(p);
                    } else if (nulls !== "connect" && current.length) {
                        runs.push(current);
                        current = [];
                    }
                });
                if (current.length) {
                    runs.push(current);
                }
                const lg = svg("g", { class: "cl-line", "data-s": l.key }, g);
                if (ls.showArea.value) {
                    for (const run of runs) {
                        if (run.length < 2) {
                            continue;
                        }
                        const d = linePath(run, curve) + `L${run[run.length - 1][0]},${baseY}L${run[0][0]},${baseY}Z`;
                        svg("path", { d, fill: l.color, "fill-opacity": Math.min(100, Math.max(0, ls.areaOpacity.value)) / 100, class: "cl-area" }, lg);
                    }
                }
                for (const run of runs) {
                    const path = svg("path", {
                        d: linePath(run, curve), fill: "none", stroke: l.color, "stroke-width": lineW,
                        "stroke-linecap": "round", "stroke-linejoin": "round", class: "cl-path" + (dash === "solid" ? " cl-drawable" : "")
                    }, lg);
                    if (dash === "solid") {
                        path.setAttribute("pathLength", "1");
                    } else {
                        path.setAttribute("stroke-dasharray", dash === "dashed" ? `${lineW * 3} ${lineW * 2}` : `0.1 ${lineW * 2}`);
                    }
                }
                if (ls.showMarkers.value) {
                    points.forEach((p, i) => {
                        if (!p || l.values[i] === null) {
                            return;
                        }
                        const m = markerShape(shape, p[0], p[1], markerR, {
                            fill: hollow ? WHITE : l.color, stroke: l.color, "stroke-width": Math.max(1.5, lineW * 0.75),
                            class: "cl-marker", "data-s": l.key, "data-c": i
                        }, lg);
                        this.markerNodes.push({ node: m, category: i, r: markerR });
                        this.pointNodes.push({ node: m, category: i });
                    });
                }
                // Rótulos
                if (ll.show.value) {
                    const basis = Math.max(0, ...l.values.map(v => Math.abs(v ?? 0)));
                    const fmt = this.numberFormat(l.source, enumValue(ll.units), ll.decimals.value, basis);
                    const which = enumValue(ll.points);
                    const valid = l.values.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
                    let chosen: number[] = valid;
                    if (which === "last") {
                        chosen = valid.slice(-1);
                    } else if (which === "ends") {
                        chosen = valid.length > 1 ? [valid[0], valid[valid.length - 1]] : valid;
                    } else if (which === "minmax" && valid.length) {
                        const byValue = valid.slice().sort((a, b) => (l.values[a] as number) - (l.values[b] as number));
                        chosen = Array.from(new Set([byValue[0], byValue[byValue.length - 1]])).sort((a, b) => a - b);
                    }
                    const above = enumValue(ll.position) === "above";
                    const offset = (ls.showMarkers.value ? markerR : lineW / 2) + 4;
                    chosen.forEach(i => {
                        const p = points[i];
                        if (!p) {
                            return;
                        }
                        lineLabels.push({
                            x: p[0], y: above ? p[1] - offset : p[1] + offset, text: fmt(l.values[i] as number), category: i, above,
                            color: ll.useLineColor.value ? l.color : ll.fontColor.value.value
                        });
                    });
                }
            });
        }

        // ---- rótulos (por cima de tudo)
        const labels = svg("g", { class: "cl-labels" }, plot);
        // Caixas já ocupadas por rótulos (os das linhas desviam dos totais e uns dos outros).
        const placed: Array<[number, number, number, number]> = [];
        const collides = (box: [number, number, number, number]): boolean =>
            placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        for (const lab of segLabels) {
            placed.push([lab.x - lab.w / 2 - 1, lab.y - colLabelFont / 2 - 1, lab.x + lab.w / 2 + 1, lab.y + colLabelFont / 2 + 1]);
            const t = svg("text", {
                x: lab.x, y: lab.y, "font-size": colLabelFont, fill: lab.color, "text-anchor": "middle", "dominant-baseline": "central",
                "font-weight": cl.bold.value ? 600 : 400, class: "cl-label"
            }, labels);
            t.textContent = lab.text;
            this.pointNodes.push({ node: t, category: lab.category });
        }
        if (tl.show.value && scale1 && cols.length) {
            const sc = scale1;
            const fmt = this.numberFormat(cols[0].source, enumValue(tl.units), tl.decimals.value, sc.unitBasis);
            const size = Math.max(6, tl.fontSize.value);
            const texts = stackTotal.map(total => (total === null ? "" : fmt(total)));
            // Todos ou nenhum: se algum total não cabe na largura da categoria, nenhum aparece.
            const widest = Math.max(0, ...texts.map(text => textWidth(text, size, font, tl.bold.value)));
            const totalsFit = n === 1 || widest <= band + 4;
            stackTotal.forEach((total, i) => {
                if (total === null || !totalsFit) {
                    return;
                }
                const text = texts[i];
                const w = textWidth(text, size, font, tl.bold.value);
                const negative = total < 0;
                const yEdge = Math.min(plotBottom, Math.max(plotTop, sc.y(negative ? stackNeg[i] : stackPos[i])));
                const cx = i * band + band / 2;
                const yTop = negative ? yEdge + 4 : yEdge - 5 - size;
                placed.push([cx - w / 2 - 2, yTop, cx + w / 2 + 2, yTop + size + 2]);
                const t = svg("text", {
                    x: cx, y: negative ? yEdge + size * 0.5 + 5 : yEdge - 5,
                    "font-size": size, fill: tl.fontColor.value.value, "text-anchor": "middle",
                    "dominant-baseline": negative ? "central" : "auto", "font-weight": tl.bold.value ? 600 : 400, class: "cl-label cl-total"
                }, labels);
                t.textContent = text;
                this.pointNodes.push({ node: t, category: i });
            });
        }
        if (lineLabels.length) {
            const size = Math.max(6, ll.fontSize.value);
            const halo = ll.halo.value;
            const offset = (ls.showMarkers.value ? markerR : lineW / 2) + 4;
            for (const lab of lineLabels) {
                const w = textWidth(lab.text, size, font, ll.bold.value);
                // lab.y já está do lado escolhido; se bater em outro rótulo, tenta o outro lado do ponto.
                const pointY = lab.above ? lab.y + offset : lab.y - offset;
                const candidates = [lab.above, !lab.above].map(above => {
                    const y = above ? Math.max(size, pointY - offset) : Math.min(plotBottom - 2, pointY + offset + size * 0.8);
                    return { y, box: [lab.x - w / 2 - 2, y - size, lab.x + w / 2 + 2, y + 2] as [number, number, number, number] };
                });
                const spot = candidates.find(c => !collides(c.box));
                if (!spot) {
                    continue;
                }
                const y = spot.y;
                placed.push(spot.box);
                const t = svg("text", {
                    x: lab.x, y, "font-size": size, fill: lab.color, "text-anchor": "middle",
                    "font-weight": ll.bold.value ? 600 : 400, class: "cl-label cl-line-label"
                }, labels);
                if (halo) {
                    t.setAttribute("stroke", ll.haloColor.value.value);
                    t.setAttribute("stroke-width", "3.5");
                    t.setAttribute("stroke-linejoin", "round");
                    t.setAttribute("paint-order", "stroke");
                }
                t.textContent = lab.text;
                this.pointNodes.push({ node: t, category: lab.category });
            }
        }

        // ---- rótulos do eixo X
        if (xs.show.value) {
            const g = svg("g", { class: "cl-x-labels" }, plot);
            const color = xs.fontColor.value.value;
            const yBase = plotBottom + 6;
            // Rótulos horizontais que não cabem: mostra um a cada k.
            let every = 1;
            if (rotation === 0) {
                every = Math.max(1, Math.ceil((Math.min(maxLabelW, 140) + 8) / Math.max(1, band)));
            } else if (band < xFont * 1.05) {
                every = Math.ceil(xFont * 1.05 / Math.max(1, band));
            }
            const cap = Math.min(maxLabelW, Math.max(40, H * 0.32));
            model.categories.forEach((c, i) => {
                if (i % every !== 0) {
                    return;
                }
                const cx = i * band + band / 2;
                const t = svg("text", {
                    "font-size": xFont, fill: color, "font-weight": labelBold ? 600 : 400, class: "cl-x-label", "data-c": i
                }, g);
                if (rotation === 0) {
                    t.setAttribute("x", String(cx));
                    t.setAttribute("y", String(yBase));
                    t.setAttribute("text-anchor", "middle");
                    t.setAttribute("dominant-baseline", "hanging");
                    t.textContent = fit(c.label, every === 1 ? band - 4 : Math.min(140, band * every - 8), xFont, font, labelBold);
                } else {
                    t.setAttribute("x", String(cx));
                    t.setAttribute("y", String(yBase));
                    t.setAttribute("text-anchor", "end");
                    t.setAttribute("dominant-baseline", rotation === 90 ? "central" : "hanging");
                    t.setAttribute("transform", `rotate(${-rotation} ${cx} ${yBase})`);
                    t.textContent = fit(c.label, cap, xFont, font, labelBold);
                }
                const title = svg("title", {}, t);
                title.textContent = c.label;
                this.pointNodes.push({ node: t, category: i });
            });
        }

        this.bindPlot(model, plotSvg, padLeft, band, cols, lns, stackTotal);
        if (scrolling) {
            scroller.scrollLeft = this.scrollLeft;
        }
    }

    // ------------------------------------------------------------- interação

    private bindPlot(model: Model, plot: SVGSVGElement, padLeft: number, band: number, cols: Series[], lns: Series[], totals: Array<number | null>): void {
        const n = model.categories.length;
        const info = (e: MouseEvent): { index: number; series: Series | undefined } => {
            const box = plot.getBoundingClientRect();
            const index = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - box.left - padLeft) / Math.max(1, band))));
            const key = (e.target as Element).closest("[data-s]")?.getAttribute("data-s");
            const series = key ? [...cols, ...lns].find(x => x.key === key) : undefined;
            return { index, series };
        };
        let hovered = -1;
        const hover = (index: number): void => {
            if (index === hovered) {
                return;
            }
            hovered = index;
            this.paintHover(index);
        };
        const tooltipArgs = (e: MouseEvent) => {
            const { index, series } = info(e);
            return {
                coordinates: [e.clientX, e.clientY], isTouchEvent: false,
                dataItems: this.tooltip(model, index, series, cols, lns, totals),
                identities: [series ? series.selectionIds[index] : model.categories[index].selectionId]
            };
        };
        plot.addEventListener("mouseenter", (e: MouseEvent) => {
            hover(info(e).index);
            this.host.tooltipService.show(tooltipArgs(e));
        });
        plot.addEventListener("mousemove", (e: MouseEvent) => {
            hover(info(e).index);
            this.host.tooltipService.move(tooltipArgs(e));
        });
        plot.addEventListener("mouseleave", () => {
            hover(-1);
            this.host.tooltipService.hide({ immediately: true, isTouchEvent: false });
        });
        plot.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            const { index, series } = info(e);
            const id = series && series.kind === "column" ? series.selectionIds[index] : model.categories[index].selectionId;
            this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
        });
        plot.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const { index, series } = info(e);
            const id = series && series.kind === "column" ? series.selectionIds[index] : model.categories[index].selectionId;
            this.selectionManager.showContextMenu(id, { x: e.clientX, y: e.clientY });
        });
    }

    private tooltip(model: Model, index: number, hoveredSeries: Series | undefined, cols: Series[], lns: Series[], totals: Array<number | null>): VisualTooltipDataItem[] {
        const category = model.categories[index];
        const items: VisualTooltipDataItem[] = [{ displayName: model.categoryName, value: category.label }];
        const add = (series: Series): void => {
            items.push({ displayName: series.name, value: series.format(series.values[index]), color: series.color });
        };
        const mode = enumValue(this.formattingSettings.interactionCard.tooltipMode);
        if (mode === "item" && hoveredSeries) {
            add(hoveredSeries);
        } else {
            cols.slice().reverse().forEach(add);
            if (cols.length > 1 && totals[index] !== null) {
                items.push({ displayName: "Total", value: cols[0].format(totals[index]) });
            }
            lns.forEach(add);
        }
        for (const extra of model.extras) {
            items.push({ displayName: extra.name, value: extra.format(extra.values[index]) });
        }
        return items;
    }

    /** Destaca a faixa da categoria sob o mouse e aumenta os marcadores dela. */
    private paintHover(index: number): void {
        const it = this.formattingSettings.interactionCard;
        const opacity = it.hoverBand.value ? Math.min(100, Math.max(0, it.hoverOpacity.value)) / 100 : 0;
        this.bandNodes.forEach((r, i) => r.setAttribute("fill-opacity", String(i === index ? opacity : 0)));
        for (const m of this.markerNodes) {
            m.node.classList.toggle("cl-marker-hover", m.category === index);
        }
    }

    /** Esmaece o que não está selecionado. */
    private paintSelection(): void {
        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const model = this.model;
        if (!model) {
            return;
        }
        const keys = new Set(selected.map(id => id.getKey()));
        const dim = String(Math.min(100, Math.max(0, this.formattingSettings.interactionCard.selectedOpacity.value)) / 100);
        const categoryOn = new Set<number>();
        model.categories.forEach((c, i) => {
            if (keys.has(c.selectionId.getKey())) {
                categoryOn.add(i);
            }
        });
        for (const seg of this.segmentNodes) {
            if (keys.has(seg.id.getKey())) {
                categoryOn.add(seg.category);
            }
        }
        const none = keys.size === 0;
        for (const seg of this.segmentNodes) {
            const on = none || keys.has(seg.id.getKey()) || keys.has(model.categories[seg.category].selectionId.getKey());
            seg.node.style.opacity = on ? "" : dim;
        }
        for (const p of this.pointNodes) {
            if (p.node instanceof SVGElement) {
                p.node.style.opacity = none || categoryOn.has(p.category) ? "" : dim;
            }
        }
    }
}
