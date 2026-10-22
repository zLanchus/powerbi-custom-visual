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
    DARK, FONT, Font, LINE_PALETTE, SERIES_LINE_STYLE_ITEMS, SERIES_PALETTE, SERIES_TRISTATE_ITEMS, WHITE,
    VisualFormattingSettingsModel, enumValue
} from "./settings";

type Kind = "column" | "line";
type NumFormat = (v: number) => string;

/** Fonte já resolvida de uma parte do visual. */
interface TextStyle {
    family: string;
    size: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

/** Um valor do eixo X. */
interface Category {
    index: number;
    /** Texto no eixo X (último nível, ou os níveis concatenados). */
    label: string;
    /** Caminho completo, para a dica de ferramenta (ex.: 2024 › Jan). */
    fullLabel: string;
    /** Rótulo de cada nível (do primeiro ao último) e chave de cada nível, para agrupar. */
    path: string[];
    keys: string[];
    selectionId: ISelectionId;
}

/** Ajustes de uma linha específica (cartão "Linhas — por série"); vazio = igual às outras. */
interface LineOptions {
    width: number;
    style: string;
    markers: string;
    area: string;
    labels: string;
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
    options: LineOptions;
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
    /** Quantidade de campos no Eixo X. */
    levels: number;
    /** Eixo X agrupado: os níveis de cima aparecem como grupos embaixo dos rótulos. */
    groupedAxis: boolean;
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

type Box = [number, number, number, number];

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

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const pct = (v: number): number => clamp(v, 0, 100) / 100;

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

/** Lê um número digitado no painel ("1.000,5", "0,25", "25%", "1e6"); vazio = automático. */
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
function textWidth(text: string, st: TextStyle): number {
    if (measureCtx === undefined) {
        measureCtx = document.createElement("canvas").getContext("2d");
    }
    if (!measureCtx) {
        return text.length * st.size * 0.56;
    }
    measureCtx.font = `${st.italic ? "italic " : ""}${st.bold ? "600 " : ""}${st.size}px ${st.family}`;
    return measureCtx.measureText(text).width;
}

/** Corta o texto com reticências para caber na largura. */
function fit(text: string, width: number, st: TextStyle): string {
    if (textWidth(text, st) <= width) {
        return text;
    }
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (textWidth(text.slice(0, mid) + "…", st) <= width) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo > 0 ? text.slice(0, lo) + "…" : "";
}

/** Atributos de fonte para um <text> do SVG. */
function svgFont(st: TextStyle): Record<string, string | number> {
    return {
        "font-family": st.family, "font-size": st.size, "font-weight": st.bold ? 600 : 400,
        "font-style": st.italic ? "italic" : "normal", "text-decoration": st.underline ? "underline" : "none"
    };
}

/** Fonte num elemento HTML. */
function htmlFont(node: HTMLElement, st: TextStyle): void {
    node.style.fontFamily = st.family;
    node.style.fontSize = st.size + "px";
    node.style.fontWeight = st.bold ? "600" : "400";
    node.style.fontStyle = st.italic ? "italic" : "normal";
    node.style.textDecoration = st.underline ? "underline" : "none";
}

/** Escolhe a cor de texto (clara ou escura) com melhor contraste sobre um fundo. */
function contrastColor(background: string, light = WHITE, dark = DARK): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(background.trim());
    if (!m) {
        return dark;
    }
    const n = parseInt(m[1], 16);
    const lin = (c: number): number => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return lum > 0.35 ? dark : light;
}

/** Retângulo com cantos arredondados em cima (rTop) e embaixo (rBottom). */
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

function dashArray(style: string, width: number): string {
    return style === "dashed" ? `${width * 3} ${width * 2}` : style === "dotted" ? `0.1 ${width * 2}` : "";
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
    private markerNodes: Array<{ node: SVGElement; category: number }> = [];

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

    /** Fonte de uma parte do visual; a fonte padrão herda a fonte de "Geral". */
    private textStyle(font: Font): TextStyle {
        const family = font.family.value;
        return {
            family: family && family !== FONT ? family : this.formattingSettings.generalCard.fontFamily.value || FONT,
            size: Math.max(6, font.size.value),
            bold: font.bold.value,
            italic: font.italic.value,
            underline: font.underline.value
        };
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        const model = this.model;

        // Mostra só as opções que fazem efeito com o que está ligado.
        const g = s.generalCard;
        g.animationDuration.visible = g.animate.value;
        g.background.visible = g.backgroundRadius.visible = g.showBackground.value;

        const t = s.togglesCard;
        t.dividerColor.visible = t.showDivider.value;
        t.hiddenOpacity.visible = enumValue(t.hiddenStyle) !== "strike";
        t.doubleClickSolo.visible = t.seriesChips.value;
        [t.columnsLabel, t.linesLabel, t.showIcons, t.activeBackground, t.activeFontColor, t.activeBorderColor,
            t.inactiveBackground, t.inactiveFontColor, t.inactiveBorderColor].forEach(x => { x.visible = t.groupButtons.value; });
        [t.chipStyle, t.background, t.fontColor, t.borderColor, t.chipHiddenBackground, t.chipHiddenFontColor,
            t.chipHiddenBorderColor, t.showSwatch, t.swatchShape, t.swatchSize, t.chipMaxWidth].forEach(x => { x.visible = t.seriesChips.value; });
        t.swatchShape.visible = t.swatchSize.visible = t.seriesChips.value && t.showSwatch.value;
        t.activeBorderColor.visible = t.inactiveBorderColor.visible = t.groupButtons.value && t.borderWidth.value > 0;
        t.borderColor.visible = t.chipHiddenBorderColor.visible = t.seriesChips.value && t.borderWidth.value > 0;
        t.background.visible = t.seriesChips.value && enumValue(t.chipStyle) !== "filled";
        t.resetLabel.visible = t.resetColor.visible = t.resetBackground.visible = t.showReset.value;

        const c = s.columnsCard;
        c.borderColor.visible = c.borderWidth.value > 0;
        const l = s.linesCard;
        [l.markerShape, l.markerSize, l.markerFill, l.markerCenterColor, l.markerBorderWidth, l.markerGrow]
            .forEach(x => { x.visible = l.showMarkers.value; });
        l.markerCenterColor.visible = l.showMarkers.value && enumValue(l.markerFill) === "hollow";
        l.areaOpacity.visible = l.showArea.value;

        const x = s.xAxisCard;
        x.lineColor.visible = x.lineWidth.visible = x.lineOpacity.visible = x.showLine.value;
        // Opções de vários campos só aparecem com mais de um campo no Eixo X.
        const hierarchyGroup = x.groups.find(grp => grp.name === "xHierarchy");
        if (hierarchyGroup) {
            hierarchyGroup.visible = !!model && model.levels > 1;
        }
        const xMode = enumValue(x.hierarchy);
        x.concatOrder.visible = x.concatSeparator.visible = xMode === "concat";
        [x.groupFont.control, x.groupColor, x.groupSpacing, x.showSeparators, x.separatorColor, x.separatorOpacity, x.separatorInPlot]
            .forEach(slice => { slice.visible = xMode === "grouped"; });
        x.separatorColor.visible = x.separatorOpacity.visible = x.separatorInPlot.visible = xMode === "grouped" && x.showSeparators.value;
        x.titleText.visible = x.titleFont.control.visible = x.titleColor.visible = x.showTitle.value;
        for (const axis of [s.yAxisCard, s.y2AxisCard]) {
            axis.titleText.visible = axis.titleFont.control.visible = axis.titleColor.visible = axis.showTitle.value;
            axis.gridColor.visible = axis.gridOpacity.visible = axis.gridWidth.visible = axis.gridStyle.visible = axis.showGrid.value;
        }
        const y2 = s.y2AxisCard;
        const own = !y2.sameScale.value;
        y2.groups.slice(1).forEach(grp => { grp.visible = own; });
        y2.min.visible = y2.max.visible = y2.tickCount.visible = own;

        const cl = s.columnLabelsCard;
        cl.fontColor.visible = !cl.autoColor.value;
        cl.lightColor.visible = cl.darkColor.visible = cl.autoColor.value;
        const tl = s.totalLabelsCard;
        tl.haloColor.visible = tl.haloWidth.visible = tl.halo.value;
        const ll = s.lineLabelsCard;
        ll.fontColor.visible = !ll.useLineColor.value;
        ll.haloColor.visible = ll.haloWidth.visible = ll.halo.value;
        const it = s.interactionCard;
        it.hoverColor.visible = it.hoverOpacity.visible = it.hoverBand.value;
        it.totalText.visible = it.tooltipTotal.value;

        // Sem linhas (ou sem colunas), as opções delas somem do painel.
        const hasLines = !model || model.lines.length > 0;
        const hasColumns = !model || model.columns.length > 0;
        s.linesCard.visible = s.y2AxisCard.visible = s.lineLabelsCard.visible = hasLines;
        s.columnsCard.visible = s.columnLabelsCard.visible = s.totalLabelsCard.visible = hasColumns;

        const cards = s.cards.slice();
        if (model) {
            const list: formattingSettings.Cards[] = [];
            for (const card of cards) {
                list.push(card);
                if (card === s.columnsCard && model.columns.length) {
                    list.push(this.columnColorsCard(model.columns));
                }
                if (card === s.linesCard && model.lines.length) {
                    list.push(this.lineSeriesCard(model.lines));
                }
            }
            s.cards = list;
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(s);
        s.cards = cards;
        return formattingModel;
    }

    /** Cor de cada série das colunas. */
    private columnColorsCard(list: Series[]): formattingSettings.SimpleCard {
        const slices = list.map(series => new formattingSettings.ColorPicker({
            name: "fill", displayName: series.name, value: { value: series.color }, selector: series.selector
        }));
        class ColorsCard extends formattingSettings.SimpleCard {
            name = "columnColors";
            displayName = "Cores das colunas";
            slices = slices;
        }
        return new ColorsCard();
    }

    /** Uma seção por linha: cor, espessura, estilo, marcadores, área e rótulos. */
    private lineSeriesCard(list: Series[]): formattingSettings.CompositeCard {
        const pick = (items: powerbi.IEnumMember[], value: string): powerbi.IEnumMember =>
            items.find(i => i.value === value) || items[0];
        const groups = list.map((series, k) => {
            const selector = series.selector;
            const o = series.options;
            return new formattingSettings.Group({
                name: "lineSeries" + k,
                displayName: series.name,
                slices: [
                    new formattingSettings.ColorPicker({ name: "fill", displayName: "Cor", value: { value: series.color }, selector }),
                    new formattingSettings.NumUpDown({
                        name: "width", displayName: "Espessura (px, 0 = igual às outras)", value: o.width, selector
                    }),
                    new formattingSettings.ItemDropdown({
                        name: "style", displayName: "Estilo", items: SERIES_LINE_STYLE_ITEMS, value: pick(SERIES_LINE_STYLE_ITEMS, o.style), selector
                    }),
                    new formattingSettings.ItemDropdown({
                        name: "markers", displayName: "Marcadores", items: SERIES_TRISTATE_ITEMS, value: pick(SERIES_TRISTATE_ITEMS, o.markers), selector
                    }),
                    new formattingSettings.ItemDropdown({
                        name: "area", displayName: "Área sombreada", items: SERIES_TRISTATE_ITEMS, value: pick(SERIES_TRISTATE_ITEMS, o.area), selector
                    }),
                    new formattingSettings.ItemDropdown({
                        name: "labels", displayName: "Rótulos", items: SERIES_TRISTATE_ITEMS, value: pick(SERIES_TRISTATE_ITEMS, o.labels), selector
                    })
                ]
            });
        });
        class LineSeriesCard extends formattingSettings.CompositeCard {
            name = "lineColors";
            displayName = "Linhas — por série";
            groups = groups;
        }
        return new LineSeriesCard();
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
        // Vários campos no Eixo X (ex.: Ano e Mês): cada folha da hierarquia vira uma categoria.
        const rowNodes: DataViewMatrixNode[] = [];
        const paths: string[][] = [];
        const keyPaths: string[][] = [];
        const collect = (node: DataViewMatrixNode, path: string[], keys: string[]): void => {
            for (const child of node.children || []) {
                if (child.isSubtotal) {
                    continue;
                }
                const level = child.level ?? path.length;
                const value = child.levelValues?.[0]?.value ?? child.value;
                const source = rowLevels[level]?.sources?.[child.levelValues?.[0]?.levelSourceIndex ?? 0];
                const nextPath = path.concat(memberLabel(value, source, locale));
                const nextKeys = keys.concat(value instanceof Date ? String(value.getTime()) : String(value));
                if ((child.children || []).some(c => !c.isSubtotal)) {
                    collect(child, nextPath, nextKeys);
                } else {
                    rowNodes.push(child);
                    paths.push(nextPath);
                    keyPaths.push(nextKeys);
                }
            }
        };
        collect(rowRoot, [], []);
        const xs = this.formattingSettings.xAxisCard;
        const mode = rowLevels.length > 1 ? enumValue(xs.hierarchy) : "inner";
        const separator = xs.concatSeparator.value ?? " ";
        const innerFirst = enumValue(xs.concatOrder) !== "outerFirst";
        const categories: Category[] = rowNodes.map((node, index) => {
            const path = paths[index];
            return {
                index,
                label: mode === "concat" ? (innerFirst ? path.slice().reverse() : path).join(separator) : path[path.length - 1],
                fullLabel: path.join(" › "),
                path,
                keys: keyPaths[index],
                selectionId: builder().withMatrixNode(node, rowLevels).createSelectionId()
            };
        });
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
                    selectionIds: rowNodes.map(row => builder().withMatrixNode(row, rowLevels).withMatrixNode(member, colLevels).createSelectionId()),
                    options: this.lineOptions(undefined)
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
        const categoryName = rowLevels.map(l => l.sources?.[0]?.displayName || "").filter(Boolean).join(" › ");
        return { categoryName, categories, columns, lines, extras, hasLegend, levels: rowLevels.length, groupedAxis: mode === "grouped" };
    }

    private lineOptions(objects: powerbi.DataViewObjects | undefined): LineOptions {
        const o = objects?.["lineColors"] || {};
        const str = (v: powerbi.DataViewPropertyValue | undefined): string => (typeof v === "string" ? v : "default");
        return {
            width: typeof o["width"] === "number" ? o["width"] as number : 0,
            style: str(o["style"]),
            markers: str(o["markers"]),
            area: str(o["area"]),
            labels: str(o["labels"])
        };
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
                .withMatrixNode(row, rowLevels).withMeasure(queryName).createSelectionId()),
            options: this.lineOptions(kind === "line" ? source.objects : undefined)
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
        const g = s.generalCard;
        root.style.fontFamily = g.fontFamily.value || FONT;
        root.style.padding = `${Math.max(0, g.paddingY.value)}px ${Math.max(0, g.paddingX.value)}px`;
        root.style.background = g.showBackground.value ? g.background.value.value : "";
        root.style.borderRadius = g.showBackground.value ? Math.max(0, g.backgroundRadius.value) + "px" : "";
        // Valores usados pelo CSS (animação e efeitos de mouse).
        root.style.setProperty("--cl-anim", Math.max(0, g.animationDuration.value) + "ms");
        root.style.setProperty("--cl-hover", String(1 + Math.max(0, s.columnsCard.hoverBrightness.value) / 100));
        root.style.setProperty("--cl-grow", String(1 + Math.max(0, s.linesCard.markerGrow.value) / 100));
        const model = this.model;
        const animate = this.animateNext && g.animate.value && g.animationDuration.value > 0;
        this.animateNext = false;
        root.classList.toggle("cl-animate", animate);

        // ---- cabeçalho
        const header = s.headerCard;
        if (header.title.value || header.subtitle.value) {
            const head = el("div", "cl-header");
            head.style.textAlign = enumValue(header.align) || "left";
            head.style.paddingBottom = Math.max(0, header.spacing.value) + "px";
            if (header.title.value) {
                const t = el("div", "cl-title", header.title.value);
                htmlFont(t, this.textStyle(header.titleFont));
                t.style.color = header.titleColor.value.value;
                head.appendChild(t);
            }
            if (header.subtitle.value) {
                const t = el("div", "cl-subtitle", header.subtitle.value);
                htmlFont(t, this.textStyle(header.subtitleFont));
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
        const spacing = Math.max(0, toggles.spacing.value) + "px";
        if (toolbar && enumValue(toggles.position) === "bottom") {
            root.append(chart, toolbar);
            toolbar.style.paddingTop = spacing;
        } else {
            if (toolbar) {
                root.appendChild(toolbar);
                toolbar.style.paddingBottom = spacing;
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
        const gap = Math.max(0, t.gap.value);
        bar.style.gap = `${gap}px ${gap + 4}px`;
        bar.style.justifyContent = { left: "flex-start", center: "center", right: "flex-end" }[enumValue(t.align)] || "flex-start";
        const font = this.textStyle(t.font);
        const height = Math.max(font.size + 4, t.height.value);
        const iconSize = t.iconSize.value > 0 ? t.iconSize.value : Math.round(font.size * 1.25);
        const hiddenStyle = enumValue(t.hiddenStyle);
        const hiddenOpacity = hiddenStyle === "strike" ? "" : String(pct(t.hiddenOpacity.value));
        const borderW = Math.max(0, t.borderWidth.value);
        const paddingX = t.paddingX.value >= 0 ? t.paddingX.value : Math.round(height * 0.42);
        const button = (className: string, on: boolean, colors: { bg: string; fg: string; border: string }, borderWidth = borderW): HTMLButtonElement => {
            const b = el("button", "cl-btn " + className + (on ? " cl-on" : ""));
            b.type = "button";
            htmlFont(b, font);
            b.style.height = height + "px";
            b.style.borderRadius = Math.max(0, t.radius.value) + "px";
            b.style.padding = `0 ${Math.max(0, paddingX)}px`;
            b.style.gap = Math.round(font.size * 0.55) + "px";
            b.style.background = colors.bg;
            b.style.color = colors.fg;
            b.style.border = borderWidth > 0 ? `${borderWidth}px solid ${colors.border}` : "none";
            b.classList.toggle("cl-shadow", t.shadow.value);
            b.setAttribute("aria-pressed", String(on));
            if (!on) {
                b.style.opacity = hiddenOpacity;
                b.classList.toggle("cl-strike", hiddenStyle !== "fade");
            }
            return b;
        };
        const label = (text: string, maxWidth = 0): HTMLElement => {
            const span = el("span", "cl-btn-text", text);
            span.style.maxWidth = maxWidth > 0 ? maxWidth + "px" : "none";
            span.style.textDecoration = font.underline ? "underline" : "";
            return span;
        };
        const kinds: Array<{ kind: Kind; list: Series[]; label: string; path: string }> = [
            { kind: "column", list: model.columns, label: t.columnsLabel.value || "Colunas", path: ICON_COLUMNS },
            { kind: "line", list: model.lines, label: t.linesLabel.value || "Linhas", path: ICON_LINES }
        ];
        const present = kinds.filter(k => k.list.length > 0);
        const sections: HTMLElement[] = [];

        if (t.groupButtons.value && present.length > 0) {
            const group = el("div", "cl-group");
            group.style.gap = gap + "px";
            for (const k of present) {
                const on = k.kind === "column" ? this.columnsOn : this.linesOn;
                const b = button("cl-group-btn", on, on
                    ? { bg: t.activeBackground.value.value, fg: t.activeFontColor.value.value, border: t.activeBorderColor.value.value }
                    : { bg: t.inactiveBackground.value.value, fg: t.inactiveFontColor.value.value, border: t.inactiveBorderColor.value.value });
                b.title = on ? `Esconder ${k.label.toLowerCase()}` : `Mostrar ${k.label.toLowerCase()}`;
                if (t.showIcons.value) {
                    b.appendChild(icon(k.path, iconSize));
                }
                b.appendChild(label(k.label));
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
            sections.push(group);
        }

        if (t.seriesChips.value) {
            const chips = el("div", "cl-chips");
            chips.style.gap = gap + "px";
            const chipStyle = enumValue(t.chipStyle);
            for (const k of present) {
                const groupOn = k.kind === "column" ? this.columnsOn : this.linesOn;
                for (const series of k.list) {
                    const on = groupOn && !this.hidden.has(series.key);
                    let colors = { bg: t.chipHiddenBackground.value.value, fg: t.chipHiddenFontColor.value.value, border: t.chipHiddenBorderColor.value.value };
                    let width = borderW;
                    if (on) {
                        colors = { bg: t.background.value.value, fg: t.fontColor.value.value, border: t.borderColor.value.value };
                        if (chipStyle === "filled") {
                            colors = { bg: series.color, fg: contrastColor(series.color, WHITE, t.fontColor.value.value), border: t.borderColor.value.value };
                        } else if (chipStyle === "outline") {
                            colors = { ...colors, border: series.color };
                            width = Math.max(1.5, borderW);
                        }
                    }
                    const b = button("cl-chip", on, colors, width);
                    b.title = (on ? "Clique para esconder" : "Clique para mostrar")
                        + (t.doubleClickSolo.value ? " · duplo clique: mostrar só esta" : "");
                    if (t.showSwatch.value) {
                        b.appendChild(this.swatch(series, on, font.size, chipStyle === "filled" && on ? colors.fg : undefined));
                    }
                    b.appendChild(label(series.name, Math.max(0, t.chipMaxWidth.value)));
                    b.addEventListener("click", (e: MouseEvent) => {
                        e.stopPropagation();
                        this.toggleSeries(series);
                    });
                    if (t.doubleClickSolo.value) {
                        b.addEventListener("dblclick", (e: MouseEvent) => {
                            e.stopPropagation();
                            this.solo(model, series);
                        });
                    }
                    chips.appendChild(b);
                }
            }
            sections.push(chips);
        }

        sections.forEach((section, i) => {
            if (i > 0 && t.showDivider.value) {
                const divider = el("span", "cl-divider");
                divider.style.height = Math.round(height * 0.8) + "px";
                divider.style.background = t.dividerColor.value.value;
                bar.appendChild(divider);
            }
            bar.appendChild(section);
        });

        // "Mostrar tudo" fica junto dos botões das séries (quebra de linha junto com eles).
        const anyHidden = this.hidden.size > 0 || (model.columns.length > 0 && !this.columnsOn) || (model.lines.length > 0 && !this.linesOn);
        if (anyHidden && t.showReset.value) {
            const text = t.resetLabel.value.trim();
            const withBg = t.resetBackground.value;
            const reset = button("cl-reset" + (withBg ? "" : " cl-reset-plain"), true, {
                bg: withBg ? t.background.value.value : "transparent", fg: t.resetColor.value.value, border: t.borderColor.value.value
            }, withBg ? borderW : 0);
            if (!text) {
                reset.style.padding = "0";
                reset.style.width = height + "px";
            }
            if (!withBg) {
                reset.classList.remove("cl-shadow");
            }
            reset.title = "Mostrar tudo";
            reset.setAttribute("aria-label", "Mostrar tudo");
            reset.appendChild(icon(ICON_RESET, iconSize));
            if (text) {
                reset.appendChild(label(text));
            }
            reset.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.hidden.clear();
                this.columnsOn = this.linesOn = true;
                this.animateNext = true;
                this.render();
            });
            (sections[sections.length - 1] || bar).appendChild(reset);
        }
        return bar;
    }

    /** Amostra da cor no botão. Vazada quando a série está escondida. */
    private swatch(series: Series, on: boolean, fontSize: number, outline?: string): SVGSVGElement {
        const t = this.formattingSettings.togglesCard;
        const base = t.swatchSize.value > 0 ? t.swatchSize.value : Math.round(fontSize * 0.95);
        let shape = enumValue(t.swatchShape);
        if (shape === "auto") {
            shape = series.kind === "line" ? "line" : "square";
        }
        const w = shape === "line" ? Math.round(base * 1.7) : base;
        const h = base;
        const stroke = outline || series.color;
        const s = svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "cl-swatch", "aria-hidden": "true" });
        if (shape === "square") {
            svg("rect", { x: 1, y: 1, width: w - 2, height: h - 2, rx: Math.min(3, w / 4), fill: on ? series.color : "none", stroke, "stroke-width": 1.6 }, s);
        } else if (shape === "circle") {
            svg("circle", { cx: w / 2, cy: h / 2, r: w / 2 - 1, fill: on ? series.color : "none", stroke, "stroke-width": 1.6 }, s);
        } else {
            svg("line", { x1: 1, y1: h / 2, x2: w - 1, y2: h / 2, stroke, "stroke-width": 2.2, "stroke-linecap": "round", "stroke-dasharray": on ? "" : "2 2.5" }, s);
            svg("circle", { cx: w / 2, cy: h / 2, r: Math.max(2, h / 4), fill: on ? series.color : WHITE, stroke, "stroke-width": 1.6 }, s);
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
        const domain = (values: number[], minText: string, maxText: string): [number, number] | undefined => {
            if (values.length === 0) {
                return undefined;
            }
            let lo = Math.min(0, ...values);
            let hi = Math.max(0, ...values);
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
        const d1 = domain(sameScale ? [...colValues, ...lineVals] : colValues, ys.min.value, ys.max.value);
        const d2 = sameScale ? undefined : domain(lineVals, y2s.min.value, y2s.max.value);

        // ---- fontes
        const xFont = this.textStyle(xs.font);
        const xTitleFont = this.textStyle(xs.titleFont);
        const y1Font = this.textStyle(ys.font);
        const y1TitleFont = this.textStyle(ys.titleFont);
        const y2Font = this.textStyle(y2s.font);
        const y2TitleFont = this.textStyle(y2s.titleFont);
        const colLabelFont = this.textStyle(s.columnLabelsCard.font);
        const totalFont = this.textStyle(s.totalLabelsCard.font);
        const lineLabelFont = this.textStyle(s.lineLabelsCard.font);

        // ---- espaço do eixo X (embaixo)
        const xTitle = xs.showTitle.value ? (xs.titleText.value || model.categoryName) : "";
        const xTitleH = xTitle ? xTitleFont.size + 8 : 0;
        const plotH0 = Math.max(20, H - xTitleH);

        const makeScale = (d: [number, number] | undefined, card: typeof ys, source: DataViewMetadataColumn | undefined,
            top: number, bottom: number): Scale | undefined => {
            if (!d) {
                return undefined;
            }
            const userMin = parseNumber(card.min.value) !== undefined;
            const userMax = parseNumber(card.max.value) !== undefined;
            const count = card.tickCount.value > 0 ? Math.round(card.tickCount.value) : Math.max(2, Math.round((bottom - top) / 48));
            let ticks = niceTicks(d[0], d[1], count);
            const min = userMin ? d[0] : ticks[0];
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
            tl.show.value && cols.length ? totalFont.size + Math.max(0, tl.offset.value) + 1 : 0,
            ll.show.value && lns.length && enumValue(ll.position) === "above" ? lineLabelFont.size + Math.max(0, ll.offset.value) + 6 : 0);

        // X: rotação e altura dos rótulos
        const labelWidths = model.categories.map(c => textWidth(c.label, xFont));
        const maxLabelW = Math.max(0, ...labelWidths);
        const labelCap = xs.maxLabelWidth.value > 0 ? xs.maxLabelWidth.value : Math.min(maxLabelW, Math.max(40, H * 0.32));
        const labelGap = Math.max(0, xs.labelSpacing.value);
        // Eixo agrupado (vários campos): uma faixa de grupos por nível de cima (ex.: o ano embaixo dos meses).
        const groupFont = this.textStyle(xs.groupFont);
        const groupGap = Math.max(0, xs.groupSpacing.value);
        const outerRows = model.groupedAxis && xs.show.value ? model.levels - 1 : 0;
        const groupRowH = groupFont.size * 1.3 + groupGap;
        const groupsH = outerRows * groupRowH;

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
        // Duas passadas: a primeira estima as margens, a segunda usa os rótulos dos eixos já medidos.
        for (let pass = 0; pass < 2; pass++) {
            scale1 = makeScale(d1, ys, sameScale ? (colSource || lineSource) : colSource, topPad, plotBottom);
            scale2 = makeScale(d2, y2s, lineSource, topPad, plotBottom);
            const tickW = (sc: Scale | undefined, st: TextStyle): number =>
                sc ? Math.max(0, ...sc.ticks.map(v => textWidth(sc.format(v), st))) : 0;
            ml = showY1 ? Math.ceil(tickW(scale1, y1Font)) + 10 + (y1Title ? y1TitleFont.size + 8 : 0) : 8;
            mr = showY2 ? Math.ceil(tickW(scale2, y2Font)) + 10 + (y2Title ? y2TitleFont.size + 8 : 0) : 8;
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
                rotation = rot === "auto" ? (Math.min(maxLabelW, labelCap) <= band - 6 ? 0 : 45) : Number(rot) || 0;
                const cap = Math.min(maxLabelW, labelCap);
                xLabelH = rotation === 0 ? xFont.size * 1.3 + labelGap + 2 : rotation === 45 ? cap * 0.71 + xFont.size + labelGap : cap + labelGap + 2;
            }
            plotBottom = Math.max(topPad + 20, plotH0 - xLabelH - groupsH - (scrolling ? scrollbar : 0));
            if (pass === 0 && rotation > 0 && xs.show.value) {
                // O primeiro rótulo inclinado avança para a esquerda: deixa um espaço antes da primeira coluna.
                const first = Math.min(labelWidths[0] || 0, labelCap);
                const extent = rotation === 45 ? first * 0.71 + xFont.size * 0.5 : xFont.size * 0.6;
                padLeft = Math.max(0, Math.ceil(extent - band / 2));
            }
        }
        if (!scale1 && !scale2) {
            // Tudo escondido: só a área vazia com o aviso.
            const msg = el("div", "cl-all-hidden", s.togglesCard.allHiddenText.value);
            htmlFont(msg, { ...this.textStyle(s.togglesCard.font), bold: false, underline: false });
            msg.style.color = s.togglesCard.fontColor.value.value;
            chart.appendChild(msg);
            return;
        }
        const svgH = plotBottom + xLabelH + groupsH;
        const plotTop = topPad;
        const lineScale = sameScale ? scale1 : scale2;

        // ---- eixo esquerdo e direito (fora da área que rola)
        const drawAxis = (sc: Scale, side: "left" | "right", width: number, st: TextStyle, color: string,
            title: string, titleSt: TextStyle, titleColor: string): void => {
            const a = svg("svg", { width, height: svgH, class: "cl-axis cl-axis-" + side });
            a.style[side] = "0";
            chart.appendChild(a);
            for (const v of sc.ticks) {
                const t = svg("text", {
                    x: side === "left" ? width - 8 : 8, y: sc.y(v), fill: color, ...svgFont(st),
                    "text-anchor": side === "left" ? "end" : "start", "dominant-baseline": "middle"
                }, a);
                t.textContent = sc.format(v);
            }
            if (title) {
                const cx = side === "left" ? titleSt.size * 0.7 : width - titleSt.size * 0.7;
                const cy = (plotTop + plotBottom) / 2;
                const t = svg("text", {
                    x: cx, y: cy, fill: titleColor, ...svgFont(titleSt), "text-anchor": "middle", "dominant-baseline": "middle",
                    transform: `rotate(${side === "left" ? -90 : 90} ${cx} ${cy})`
                }, a);
                t.textContent = fit(title, plotBottom - plotTop, titleSt);
            }
        };
        if (showY1 && scale1) {
            drawAxis(scale1, "left", ml, y1Font, ys.fontColor.value.value, y1Title, y1TitleFont, ys.titleColor.value.value);
        }
        if (showY2 && scale2) {
            drawAxis(scale2, "right", mr, y2Font, y2s.fontColor.value.value, y2Title, y2TitleFont, y2s.titleColor.value.value);
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
            const t = el("div", "cl-x-title", fit(xTitle, W, xTitleFont));
            htmlFont(t, xTitleFont);
            t.style.color = xs.titleColor.value.value;
            t.style.paddingLeft = ml + "px";
            t.style.paddingRight = mr + "px";
            chart.appendChild(t);
        }

        // Grade (do eixo das colunas, ou do das linhas se as colunas estiverem escondidas).
        const gridScale = scale1 || scale2;
        const gridCard = scale1 ? ys : y2s;
        if (gridCard.showGrid.value && gridScale) {
            const grid = svg("g", { class: "cl-grid" }, plot);
            const style = enumValue(gridCard.gridStyle);
            const gw = Math.max(0.5, gridCard.gridWidth.value);
            for (const v of gridScale.ticks) {
                const y = Math.round(gridScale.y(v)) + (gw % 2 === 1 ? 0.5 : 0);
                svg("line", {
                    x1: 0, x2: contentW, y1: y, y2: y, stroke: gridCard.gridColor.value.value, "stroke-width": gw,
                    "stroke-opacity": pct(gridCard.gridOpacity.value),
                    "stroke-dasharray": style === "dashed" ? `${gw * 4} ${gw * 4}` : style === "dotted" ? `${gw} ${gw * 3}` : ""
                }, grid);
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
        const spacing = clamp(cs.spacing.value, 0, 95) / 100;
        const barW = Math.max(1, Math.min(cs.maxWidth.value > 0 ? cs.maxWidth.value : Infinity, band * (1 - spacing)));
        const radiusTop = Math.max(0, cs.radius.value);
        const radiusBase = Math.max(0, cs.radiusBase.value);
        const eachSegment = cs.roundEachSegment.value;
        const segGap = Math.max(0, cs.segmentGap.value);
        const borderW = Math.max(0, cs.borderWidth.value);
        const colOpacity = pct(cs.opacity.value);
        const cl = s.columnLabelsCard;
        const segLabels: Array<{ x: number; y: number; w: number; text: string; color: string; category: number }> = [];
        if (scale1 && cols.length) {
            const sc = scale1;
            const g = svg("g", { class: "cl-columns" }, plot);
            const labelFormats = cols.map(c => this.numberFormat(c.source, enumValue(cl.units), cl.decimals.value, sc.unitBasis));
            const position = enumValue(cl.position);
            const half = colLabelFont.size * 0.5 + 4;
            for (let i = 0; i < n; i++) {
                const x = i * band + (band - barW) / 2;
                // Ponta (longe do zero) e base (junto do zero) de cada lado da pilha.
                const outerPos = cols.reduce((last, c, k) => ((c.values[i] ?? 0) > 0 ? k : last), -1);
                const outerNeg = cols.reduce((last, c, k) => ((c.values[i] ?? 0) < 0 ? k : last), -1);
                const innerPos = cols.findIndex(c => (c.values[i] ?? 0) > 0);
                const innerNeg = cols.findIndex(c => (c.values[i] ?? 0) < 0);
                let pos = 0;
                let neg = 0;
                cols.forEach((c, k) => {
                    const v = c.values[i];
                    if (v === null || v === 0) {
                        return;
                    }
                    const up = v > 0;
                    const from = up ? pos : neg;
                    const to = from + v;
                    if (up) {
                        pos = to;
                    } else {
                        neg = to;
                    }
                    const inPlot = (y: number): number => clamp(y, plotTop, plotBottom);
                    let yFrom = inPlot(sc.y(from));
                    const yTo = inPlot(sc.y(to));
                    // Espaço entre segmentos: o segmento se afasta do que está embaixo dele.
                    const isInner = k === (up ? innerPos : innerNeg);
                    if (segGap > 0 && !isInner && Math.abs(yTo - yFrom) > segGap) {
                        yFrom += up ? -segGap : segGap;
                    }
                    const top = Math.min(yFrom, yTo);
                    const h = Math.abs(yTo - yFrom);
                    if (h <= 0) {
                        return;
                    }
                    const isOuter = k === (up ? outerPos : outerNeg);
                    const rOuter = isOuter || eachSegment ? radiusTop : 0;
                    const rInner = isInner || eachSegment ? radiusBase : 0;
                    const node = svg("path", {
                        d: barPath(x, top, barW, h, up ? rOuter : rInner, up ? rInner : rOuter),
                        fill: c.color, "fill-opacity": colOpacity, class: "cl-seg " + (up ? "cl-up" : "cl-down"), "data-s": c.key, "data-c": i
                    }, g);
                    node.style.animationDelay = Math.min(400, i * (400 / Math.max(1, n))) + "ms";
                    if (borderW > 0) {
                        node.setAttribute("stroke", cs.borderColor.value.value);
                        node.setAttribute("stroke-width", String(borderW));
                    }
                    this.segmentNodes.push({ node, id: c.selectionIds[i], category: i });
                    if (cl.show.value) {
                        const text = labelFormats[k](v);
                        const w = textWidth(text, colLabelFont);
                        const fits = h >= colLabelFont.size + 3 && w <= barW + 2;
                        if (fits || !cl.hideSmall.value) {
                            const yText = position === "insideEnd" ? (up ? top + half : top + h - half)
                                : position === "insideBase" ? (up ? top + h - half : top + half)
                                    : top + h / 2;
                            segLabels.push({
                                x: x + barW / 2, y: yText, w, text, category: i,
                                color: cl.autoColor.value ? contrastColor(c.color, cl.lightColor.value.value, cl.darkColor.value.value) : cl.fontColor.value.value
                            });
                        }
                    }
                });
            }
        }

        // Linha do eixo X (no zero do eixo das colunas, ou embaixo).
        if (xs.showLine.value) {
            const sc = scale1 && cols.length ? scale1 : undefined;
            const lw = Math.max(0.5, xs.lineWidth.value);
            const y = Math.round(sc && sc.min < 0 && sc.max > 0 ? sc.y(0) : plotBottom) + (lw % 2 === 1 ? 0.5 : 0);
            svg("line", { x1: 0, x2: contentW, y1: y, y2: y, stroke: xs.lineColor.value.value, "stroke-width": lw, "stroke-opacity": pct(xs.lineOpacity.value) }, plot);
        }

        // ---- linhas
        const ls = s.linesCard;
        const curve = enumValue(ls.curve);
        const nulls = enumValue(ls.nulls);
        const markerR = Math.max(1, ls.markerSize.value);
        const shape = enumValue(ls.markerShape);
        const hollow = enumValue(ls.markerFill) === "hollow";
        const lineOpacity = pct(ls.opacity.value);
        const tri = (value: string, fallback: boolean): boolean => (value === "on" ? true : value === "off" ? false : fallback);
        const lineLabels: Array<{ x: number; y: number; text: string; color: string; category: number; above: boolean; offset: number }> = [];
        if (lineScale && lns.length) {
            const sc = lineScale;
            const g = svg("g", { class: "cl-lines" }, plot);
            const clampY = (y: number): number => clamp(y, plotTop, plotBottom);
            const baseY = clampY(sc.y(clamp(0, sc.min, sc.max)));
            lns.forEach(l => {
                const o = l.options;
                const lineW = Math.max(0.5, o.width > 0 ? o.width : ls.width.value);
                const dash = o.style !== "default" ? o.style : enumValue(ls.style);
                const showMarkers = tri(o.markers, ls.showMarkers.value);
                const showArea = tri(o.area, ls.showArea.value);
                const showLabels = tri(o.labels, ll.show.value);
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
                if (showArea) {
                    for (const run of runs) {
                        if (run.length < 2) {
                            continue;
                        }
                        const d = linePath(run, curve) + `L${run[run.length - 1][0]},${baseY}L${run[0][0]},${baseY}Z`;
                        svg("path", { d, fill: l.color, "fill-opacity": pct(ls.areaOpacity.value), class: "cl-area" }, lg);
                    }
                }
                for (const run of runs) {
                    const path = svg("path", {
                        d: linePath(run, curve), fill: "none", stroke: l.color, "stroke-width": lineW, "stroke-opacity": lineOpacity,
                        "stroke-linecap": "round", "stroke-linejoin": "round", class: "cl-path" + (dash === "solid" ? " cl-drawable" : "")
                    }, lg);
                    if (dash === "solid") {
                        path.setAttribute("pathLength", "1");
                    } else {
                        path.setAttribute("stroke-dasharray", dashArray(dash, lineW));
                    }
                }
                if (showMarkers) {
                    const mw = ls.markerBorderWidth.value > 0 ? ls.markerBorderWidth.value : Math.max(1.5, lineW * 0.75);
                    points.forEach((p, i) => {
                        if (!p || l.values[i] === null) {
                            return;
                        }
                        const m = markerShape(shape, p[0], p[1], markerR, {
                            fill: hollow ? ls.markerCenterColor.value.value : l.color, stroke: l.color, "stroke-width": mw,
                            "stroke-opacity": lineOpacity, class: "cl-marker", "data-s": l.key, "data-c": i
                        }, lg);
                        this.markerNodes.push({ node: m, category: i });
                        this.pointNodes.push({ node: m, category: i });
                    });
                }
                // Rótulos
                if (showLabels) {
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
                    const offset = (showMarkers ? markerR : lineW / 2) + Math.max(0, ll.offset.value);
                    chosen.forEach(i => {
                        const p = points[i];
                        if (!p) {
                            return;
                        }
                        lineLabels.push({
                            x: p[0], y: p[1], text: fmt(l.values[i] as number), category: i, above, offset,
                            color: ll.useLineColor.value ? l.color : ll.fontColor.value.value
                        });
                    });
                }
            });
        }

        // ---- rótulos (por cima de tudo)
        const labels = svg("g", { class: "cl-labels" }, plot);
        // Caixas já ocupadas por rótulos (os das linhas desviam dos totais e uns dos outros).
        const placed: Box[] = [];
        const collides = (box: Box): boolean => placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        const halo = (t: SVGTextElement, on: boolean, colorValue: string, width: number): void => {
            if (on && width > 0) {
                t.setAttribute("stroke", colorValue);
                t.setAttribute("stroke-width", String(width));
                t.setAttribute("stroke-linejoin", "round");
                t.setAttribute("paint-order", "stroke");
            }
        };
        for (const lab of segLabels) {
            placed.push([lab.x - lab.w / 2 - 1, lab.y - colLabelFont.size / 2 - 1, lab.x + lab.w / 2 + 1, lab.y + colLabelFont.size / 2 + 1]);
            const t = svg("text", {
                x: lab.x, y: lab.y, fill: lab.color, ...svgFont(colLabelFont), "text-anchor": "middle", "dominant-baseline": "central", class: "cl-label"
            }, labels);
            t.textContent = lab.text;
            this.pointNodes.push({ node: t, category: lab.category });
        }
        if (tl.show.value && scale1 && cols.length) {
            const sc = scale1;
            const fmt = this.numberFormat(cols[0].source, enumValue(tl.units), tl.decimals.value, sc.unitBasis);
            const offset = Math.max(0, tl.offset.value);
            const texts = stackTotal.map(total => (total === null ? "" : fmt(total)));
            // Todos ou nenhum: se algum total não cabe na largura da categoria, nenhum aparece (a não ser que a opção force).
            const widest = Math.max(0, ...texts.map(text => textWidth(text, totalFont)));
            const totalsFit = n === 1 || widest <= band + 4 || tl.showWhenNotFit.value;
            stackTotal.forEach((total, i) => {
                if (total === null || !totalsFit) {
                    return;
                }
                const text = texts[i];
                const w = textWidth(text, totalFont);
                const negative = total < 0;
                const yEdge = clamp(sc.y(negative ? stackNeg[i] : stackPos[i]), plotTop, plotBottom);
                const cx = i * band + band / 2;
                const yTop = negative ? yEdge + offset - 1 : yEdge - offset - totalFont.size;
                placed.push([cx - w / 2 - 2, yTop, cx + w / 2 + 2, yTop + totalFont.size + 2]);
                const t = svg("text", {
                    x: cx, y: negative ? yEdge + totalFont.size * 0.5 + offset : yEdge - offset, fill: tl.fontColor.value.value,
                    ...svgFont(totalFont), "text-anchor": "middle", "dominant-baseline": negative ? "central" : "auto", class: "cl-label cl-total"
                }, labels);
                halo(t, tl.halo.value, tl.haloColor.value.value, Math.max(0, tl.haloWidth.value));
                t.textContent = text;
                this.pointNodes.push({ node: t, category: i });
            });
        }
        if (lineLabels.length) {
            const size = lineLabelFont.size;
            for (const lab of lineLabels) {
                const w = textWidth(lab.text, lineLabelFont);
                // Tenta o lado escolhido; se bater em outro rótulo, o outro lado do ponto.
                const sides = ll.avoidOverlap.value ? [lab.above, !lab.above] : [lab.above];
                const candidates = sides.map(above => {
                    const y = above ? Math.max(size, lab.y - lab.offset) : Math.min(plotBottom - 2, lab.y + lab.offset + size * 0.8);
                    return { y, box: [lab.x - w / 2 - 2, y - size, lab.x + w / 2 + 2, y + 2] as Box };
                });
                const spot = ll.avoidOverlap.value ? candidates.find(c => !collides(c.box)) : candidates[0];
                if (!spot) {
                    continue;
                }
                placed.push(spot.box);
                const t = svg("text", {
                    x: lab.x, y: spot.y, fill: lab.color, ...svgFont(lineLabelFont), "text-anchor": "middle", class: "cl-label cl-line-label"
                }, labels);
                halo(t, ll.halo.value, ll.haloColor.value.value, Math.max(0, ll.haloWidth.value));
                t.textContent = lab.text;
                this.pointNodes.push({ node: t, category: lab.category });
            }
        }

        // ---- rótulos do eixo X
        if (xs.show.value) {
            const g = svg("g", { class: "cl-x-labels" }, plot);
            const color = xs.fontColor.value.value;
            const yBase = plotBottom + labelGap;
            // Rótulos horizontais que não cabem: mostra um a cada k.
            let every = 1;
            const horizontalW = Math.min(maxLabelW, xs.maxLabelWidth.value > 0 ? xs.maxLabelWidth.value : 140);
            if (rotation === 0) {
                every = Math.max(1, Math.ceil((horizontalW + 8) / Math.max(1, band)));
            } else if (band < xFont.size * 1.05) {
                every = Math.ceil(xFont.size * 1.05 / Math.max(1, band));
            }
            model.categories.forEach((c, i) => {
                if (i % every !== 0) {
                    return;
                }
                const cx = i * band + band / 2;
                const t = svg("text", { x: cx, y: yBase, fill: color, ...svgFont(xFont), class: "cl-x-label", "data-c": i }, g);
                if (rotation === 0) {
                    t.setAttribute("text-anchor", "middle");
                    t.setAttribute("dominant-baseline", "hanging");
                    const room = every === 1 ? band - 4 : Math.min(horizontalW, band * every - 8);
                    t.textContent = fit(c.label, xs.maxLabelWidth.value > 0 ? Math.min(room, xs.maxLabelWidth.value) : room, xFont);
                } else {
                    t.setAttribute("text-anchor", "end");
                    t.setAttribute("dominant-baseline", rotation === 90 ? "central" : "hanging");
                    t.setAttribute("transform", `rotate(${-rotation} ${cx} ${yBase})`);
                    t.textContent = fit(c.label, labelCap, xFont);
                }
                const title = svg("title", {}, t);
                title.textContent = c.fullLabel;
                this.pointNodes.push({ node: t, category: i });
            });
            if (outerRows > 0) {
                this.drawGroups(model, plot, band, plotTop, plotBottom, plotBottom + xLabelH, groupRowH, groupGap, groupFont);
            }
        }

        this.bindPlot(model, plotSvg, padLeft, band, cols, lns, stackTotal);
        if (scrolling) {
            scroller.scrollLeft = this.scrollLeft;
        }
    }

    /** Grupos dos níveis de cima do Eixo X (ex.: 2024 embaixo de Jan…Dez), com divisórias entre eles. */
    private drawGroups(model: Model, plot: SVGGElement, band: number, plotTop: number, plotBottom: number,
        top: number, rowH: number, gap: number, font: TextStyle): void {
        const xs = this.formattingSettings.xAxisCard;
        const cats = model.categories;
        const n = cats.length;
        const outerRows = model.levels - 1;
        const g = svg("g", { class: "cl-x-groups" }, plot);
        const prefix = (c: Category, level: number): string => c.keys.slice(0, level + 1).join("\u001f");
        for (let r = 0; r < outerRows; r++) {
            // r = 0 é a faixa logo abaixo dos rótulos (o nível imediatamente acima do último).
            const level = model.levels - 2 - r;
            const y = top + r * rowH + gap;
            let start = 0;
            for (let i = 1; i <= n; i++) {
                if (i < n && prefix(cats[i], level) === prefix(cats[start], level)) {
                    continue;
                }
                const x0 = start * band;
                const x1 = i * band;
                const label = cats[start].path[level] ?? "";
                const t = svg("text", {
                    x: (x0 + x1) / 2, y, fill: xs.groupColor.value.value, ...svgFont(font),
                    "text-anchor": "middle", "dominant-baseline": "hanging", class: "cl-x-label cl-x-group"
                }, g);
                t.textContent = fit(label, Math.max(0, x1 - x0 - 6), font);
                const title = svg("title", {}, t);
                title.textContent = cats[start].path.slice(0, level + 1).join(" › ");
                start = i;
            }
        }
        if (!xs.showSeparators.value) {
            return;
        }
        // Uma divisória por troca de grupo; desce até a faixa do nível mais alto que mudou.
        const lineTop = xs.separatorInPlot.value ? plotTop : plotBottom;
        for (let i = 1; i < n; i++) {
            let changed = -1;
            for (let level = 0; level < model.levels - 1; level++) {
                if (cats[i].keys[level] !== cats[i - 1].keys[level]) {
                    changed = level;
                    break;
                }
            }
            if (changed < 0) {
                continue;
            }
            const row = model.levels - 2 - changed;
            const x = Math.round(i * band) + 0.5;
            svg("line", {
                x1: x, x2: x, y1: lineTop, y2: top + (row + 1) * rowH, stroke: xs.separatorColor.value.value,
                "stroke-opacity": pct(xs.separatorOpacity.value), class: "cl-x-separator"
            }, g);
        }
    }

    // ------------------------------------------------------------- interação

    private bindPlot(model: Model, plot: SVGSVGElement, padLeft: number, band: number, cols: Series[], lns: Series[], totals: Array<number | null>): void {
        const n = model.categories.length;
        const info = (e: MouseEvent): { index: number; series: Series | undefined } => {
            const box = plot.getBoundingClientRect();
            const index = clamp(Math.floor((e.clientX - box.left - padLeft) / Math.max(1, band)), 0, n - 1);
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
        const it = this.formattingSettings.interactionCard;
        const items: VisualTooltipDataItem[] = [{ displayName: model.categoryName, value: category.fullLabel }];
        const add = (series: Series): void => {
            items.push({ displayName: series.name, value: series.format(series.values[index]), color: series.color });
        };
        if (enumValue(it.tooltipMode) === "item" && hoveredSeries) {
            add(hoveredSeries);
        } else {
            cols.slice().reverse().forEach(add);
            if (it.tooltipTotal.value && cols.length > 1 && totals[index] !== null) {
                items.push({ displayName: it.totalText.value || "Total", value: cols[0].format(totals[index]) });
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
        const opacity = it.hoverBand.value ? pct(it.hoverOpacity.value) : 0;
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
        const dim = String(pct(this.formattingSettings.interactionCard.selectedOpacity.value));
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
