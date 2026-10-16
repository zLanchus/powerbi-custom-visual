"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
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

import { DARK, SERIES_PALETTE, VisualFormattingSettingsModel, enumValue } from "./settings";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Um item da legenda (um segmento de cada barra). */
interface Series {
    key: string;
    name: string;
    color: string;
    selectionId: ISelectionId;
    selector: powerbi.data.Selector;
    values: number[];
    tooltips: DataViewValueColumn[];
}

/** Uma barra (um valor da categoria). */
interface Bar {
    index: number;
    label: string;
    total: number;
    /** Valores por série, na ordem da legenda. */
    parts: number[];
    selectionIds: ISelectionId[];
}

interface Model {
    categoryName: string;
    legendName: string;
    valueName: string;
    hasLegend: boolean;
    series: Series[];
    bars: Bar[];
    format: (v: PrimitiveValue) => string;
    grandTotal: number;
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

function label(value: PrimitiveValue, format: string | undefined, locale: string): string {
    if (value === null || value === undefined || value === "") {
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

/** Largura aproximada de um texto (para decidir se o rótulo cabe no segmento). */
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

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "pz-root");
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI (fora das barras).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
        // Clique no vazio limpa a seleção.
        this.root.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as Element).closest(".pz-seg, .pz-legend-item")) {
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
            const pctFormatter = valueFormatter.create({ format: "0.0%", cultureSelector: this.locale });
            this.pct = v => pctFormatter.format(v);
            this.width = options.viewport.width;
            this.height = options.viewport.height;
            this.model = this.buildModel(dataView);
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
        const conn = settings.connectorsCard;
        conn.fontSize.visible = conn.fontColor.visible = conn.showRate.value;
        settings.categoryLabelsCard.width.visible = enumValue(settings.categoryLabelsCard.position) === "left";

        const cards = settings.cards.slice();
        if (this.model?.series.length) {
            const slices = this.model.series.map(s => new formattingSettings.ColorPicker({
                name: "fill",
                displayName: s.name,
                value: { value: s.color },
                selector: s.selector
            }));
            class ColorsCard extends formattingSettings.SimpleCard {
                name = "dataColors";
                displayName = "Cores da legenda";
                slices = slices;
            }
            // Cores logo depois de "Barras".
            settings.cards = [cards[0], cards[1], new ColorsCard(), ...cards.slice(2)];
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(settings);
        settings.cards = cards;
        return formattingModel;
    }

    // ------------------------------------------------------------- dados

    private buildModel(dataView: DataView | undefined): Model | undefined {
        const categorical = dataView?.categorical;
        const category = categorical?.categories?.[0];
        const values = categorical?.values;
        if (!category || !values || values.length === 0) {
            return undefined;
        }
        const valueColumn = values.find(c => c.source.roles?.["value"]);
        if (!valueColumn) {
            return undefined;
        }

        const locale = this.locale;
        const formatter = valueFormatter.create({ format: valueColumn.source.format, cultureSelector: locale });
        const legendSource = values.source;
        const hasLegend = !!legendSource;
        const groups = values.grouped();

        const series: Series[] = groups.map((group, k) => {
            const measure = group.values.find(c => c.source.roles?.["value"]);
            const tooltips = group.values.filter(c => c.source.roles?.["tooltips"]);
            const name = hasLegend ? label(group.name, legendSource?.format, locale) : valueColumn.source.displayName;
            const selectionId = hasLegend
                ? this.host.createSelectionIdBuilder().withSeries(values, group).createSelectionId()
                : this.host.createSelectionIdBuilder().withMeasure(valueColumn.source.queryName || "").createSelectionId();
            const selector: powerbi.data.Selector = hasLegend
                ? selectionId.getSelector()
                : { metadata: valueColumn.source.queryName };
            const objects = hasLegend ? group.objects : valueColumn.source.objects;
            return {
                key: hasLegend ? "s" + k + ":" + String(group.name) : "single",
                name,
                color: colorOf(objects) || SERIES_PALETTE[k % SERIES_PALETTE.length],
                selectionId,
                selector,
                values: category.values.map((_, i) => toNumber(measure?.values[i])),
                tooltips
            };
        });

        const bars: Bar[] = category.values.map((value, i) => {
            const parts = series.map(s => Math.max(0, s.values[i]));
            return {
                index: i,
                label: label(value, category.source.format, locale),
                total: parts.reduce((a, b) => a + b, 0),
                parts,
                selectionIds: groups.map(group => {
                    const builder = this.host.createSelectionIdBuilder().withCategory(category, i);
                    return (hasLegend ? builder.withSeries(values, group) : builder).createSelectionId();
                })
            };
        });

        const order = enumValue(this.formattingSettings.barsCard.order);
        if (order === "desc") {
            bars.sort((a, b) => b.total - a.total);
        } else if (order === "asc") {
            bars.sort((a, b) => a.total - b.total);
        }

        return {
            categoryName: category.source.displayName,
            legendName: legendSource?.displayName || "",
            valueName: valueColumn.source.displayName,
            hasLegend,
            series,
            bars,
            format: v => formatter.format(v),
            grandTotal: bars.reduce((a, b) => a + b.total, 0)
        };
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        root.style.fontFamily = font;
        const model = this.model;

        if (!model || model.bars.length === 0) {
            const empty = el("div", "pz-empty");
            empty.appendChild(el("div", "pz-empty-title", "Pirâmide Segmentada"));
            empty.appendChild(el("div", "pz-empty-text",
                "Coloque um campo em Categoria, uma medida em Valores e, se quiser dividir as barras, um campo em Legenda."));
            root.appendChild(empty);
            return;
        }

        // ---- legenda
        const legendCard = s.legendCard;
        const showLegend = legendCard.show.value && model.hasLegend;
        let legendEl: HTMLElement | undefined;
        if (showLegend) {
            legendEl = this.renderLegend(model);
        }
        const legendBottom = enumValue(legendCard.position) === "bottom";
        if (legendEl && !legendBottom) {
            root.appendChild(legendEl);
        }
        const chart = el("div", "pz-chart");
        root.appendChild(chart);
        if (legendEl && legendBottom) {
            root.appendChild(legendEl);
        }

        const width = Math.max(0, this.width);
        const legendHeight = legendEl ? Math.ceil(legendEl.getBoundingClientRect().height) || legendCard.fontSize.value + 18 : 0;
        const height = Math.max(0, this.height - legendHeight);
        chart.style.height = height + "px";
        this.renderChart(chart, model, width, height);
        this.paintSelection();
    }

    private renderLegend(model: Model): HTMLElement {
        const card = this.formattingSettings.legendCard;
        const legend = el("div", "pz-legend");
        legend.style.fontSize = card.fontSize.value + "px";
        legend.style.color = card.fontColor.value.value;
        if (card.showTitle.value && model.legendName) {
            legend.appendChild(el("span", "pz-legend-title", model.legendName));
        }
        model.series.forEach((series, k) => {
            const item = el("span", "pz-legend-item");
            item.dataset.series = String(k);
            const dot = el("span", "pz-legend-dot");
            dot.style.background = series.color;
            item.appendChild(dot);
            item.appendChild(el("span", "pz-legend-text", series.name));
            item.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.selectionManager.select(series.selectionId, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
            });
            legend.appendChild(item);
        });
        return legend;
    }

    private renderChart(chart: HTMLElement, model: Model, width: number, height: number): void {
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        const bars = s.barsCard;
        const cats = s.categoryLabelsCard;
        const labels = s.dataLabelsCard;
        const conn = s.connectorsCard;
        const mirror = bars.mirror.value && model.series.length > 1;
        const upward = enumValue(bars.order) === "asc";

        const catLeft = cats.show.value && enumValue(cats.position) === "left";
        const catTop = cats.show.value && !catLeft;
        const catWidth = catLeft ? Math.min(Math.max(0, cats.width.value), width * 0.45) : 0;
        const totalMode = enumValue(labels.total);
        const totalTexts = model.bars.map((bar, i) => this.totalText(model, bar, i, totalMode));
        const totalWidth = totalMode === "none" ? 0
            : Math.min(width * 0.3, Math.max(...totalTexts.map(t => textWidth(t, labels.totalFontSize.value, font, true))) + 14);

        const padX = 8;
        const padY = 6;
        const plotX = catWidth + padX;
        const plotW = Math.max(10, width - catWidth - totalWidth - padX * 2);
        const center = plotX + plotW / 2;

        const n = model.bars.length;
        const slot = Math.max(1, (height - padY * 2) / n);
        const topLabelH = catTop ? cats.fontSize.value + 10 : 0;
        const gapPct = Math.min(90, Math.max(0, bars.gap.value)) / 100;
        const gapH = slot * gapPct;
        const barH = Math.max(2, slot - gapH - topLabelH);

        const maxTotal = Math.max(...model.bars.map(b => b.total), 0);
        // No modo espelhado, cada lado usa a metade da largura e a escala do maior lado.
        const leftOf = (b: Bar): number => b.parts[0] || 0;
        const rightOf = (b: Bar): number => b.total - leftOf(b);
        const maxSide = Math.max(...model.bars.map(b => Math.max(leftOf(b), rightOf(b))), 0);
        const minW = plotW * Math.min(100, Math.max(0, bars.minWidth.value)) / 100;
        const scale = (v: number, full: number, max: number): number => (max > 0 ? (v / max) * full : 0);

        const root = svg("svg", { width, height, class: "pz-svg" });
        chart.appendChild(root);
        const connLayer = svg("g", { class: "pz-connectors" });
        const barLayer = svg("g", { class: "pz-bars" });
        const textLayer = svg("g", { class: "pz-texts" });
        root.append(connLayer, barLayer, textLayer);

        const radius = Math.max(0, Math.min(bars.radius.value, barH / 2));
        const borderW = Math.max(0, bars.borderWidth.value);
        const segMode = enumValue(labels.segment);
        const segSize = labels.segmentFontSize.value;
        const edges: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];

        model.bars.forEach((bar, row) => {
            const y = padY + row * slot + gapH / 2 + topLabelH;
            let x0: number;
            let x1: number;
            // Posição de cada segmento: [início, fim].
            const segs: Array<[number, number]> = [];
            if (mirror) {
                const lw = Math.max(bar.total > 0 ? minW / 2 : 0, scale(leftOf(bar), plotW / 2, maxSide));
                const rw = Math.max(bar.total > 0 ? minW / 2 : 0, scale(rightOf(bar), plotW / 2, maxSide));
                x0 = center - lw;
                x1 = center + rw;
                segs.push([x0, center]);
                const right = rightOf(bar);
                let cx = center;
                for (let k = 1; k < bar.parts.length; k++) {
                    const w = right > 0 ? (bar.parts[k] / right) * rw : 0;
                    segs.push([cx, cx + w]);
                    cx += w;
                }
            } else {
                const w = Math.max(bar.total > 0 ? minW : 0, scale(bar.total, plotW, maxTotal));
                x0 = center - w / 2;
                x1 = center + w / 2;
                let cx = x0;
                for (const part of bar.parts) {
                    const pw = bar.total > 0 ? (part / bar.total) * w : 0;
                    segs.push([cx, cx + pw]);
                    cx += pw;
                }
            }
            edges.push({ x0, x1, y0: y, y1: y + barH });

            // Recorte arredondado da barra inteira; os segmentos ficam dentro dele.
            const clipId = `pz-clip-${row}`;
            const clip = svg("clipPath", { id: clipId });
            clip.appendChild(svg("rect", { x: x0, y, width: Math.max(0, x1 - x0), height: barH, rx: radius, ry: radius }));
            root.appendChild(clip);
            const group = svg("g", { "clip-path": `url(#${clipId})` });
            barLayer.appendChild(group);

            segs.forEach(([a, b], k) => {
                const value = bar.parts[k];
                if (b - a <= 0) {
                    return;
                }
                const series = model.series[k];
                const rect = svg("rect", {
                    x: a, y, width: b - a, height: barH, fill: series.color, class: "pz-seg"
                });
                if (borderW > 0) {
                    rect.setAttribute("stroke", bars.borderColor.value.value);
                    rect.setAttribute("stroke-width", String(borderW));
                }
                rect.dataset.bar = String(row);
                rect.dataset.series = String(k);
                this.bindSegment(rect, model, bar, k);
                group.appendChild(rect);

                if (segMode !== "none" && value > 0) {
                    const share = bar.total > 0 ? value / bar.total : 0;
                    const text = segMode === "value" ? model.format(value)
                        : segMode === "percent" ? this.pct(share)
                            : `${model.format(value)} (${this.pct(share)})`;
                    if (textWidth(text, segSize, font) + 8 <= b - a && segSize + 2 <= barH) {
                        const t = svg("text", {
                            x: (a + b) / 2, y: y + barH / 2, "font-size": segSize,
                            fill: labels.autoContrast.value ? readableText(series.color, DARK) : labels.segmentColor.value.value,
                            class: "pz-seg-label"
                        });
                        t.dataset.bar = String(row);
                        t.dataset.series = String(k);
                        t.textContent = text;
                        textLayer.appendChild(t);
                    }
                }
            });

            if (mirror) {
                textLayer.appendChild(svg("line", {
                    x1: center, x2: center, y1: y - 1, y2: y + barH + 1, class: "pz-axis"
                }));
            }

            // Rótulo da categoria.
            if (cats.show.value) {
                const t = svg("text", {
                    "font-size": cats.fontSize.value, fill: cats.fontColor.value.value,
                    "font-weight": cats.bold.value ? 600 : 400, class: "pz-cat-label"
                });
                if (catLeft) {
                    t.setAttribute("x", String(catWidth));
                    t.setAttribute("y", String(y + barH / 2));
                    t.setAttribute("text-anchor", "end");
                    t.textContent = truncate(bar.label, Math.max(10, catWidth - 4), cats.fontSize.value, font, cats.bold.value);
                } else {
                    t.setAttribute("x", String(center));
                    t.setAttribute("y", String(y - topLabelH / 2));
                    t.setAttribute("text-anchor", "middle");
                    t.textContent = truncate(bar.label, plotW, cats.fontSize.value, font, cats.bold.value);
                }
                const title = svg("title");
                title.textContent = bar.label;
                t.appendChild(title);
                textLayer.appendChild(t);
            }

            // Rótulo do total.
            if (totalMode !== "none") {
                const t = svg("text", {
                    x: plotX + plotW + 10, y: y + barH / 2, "font-size": labels.totalFontSize.value,
                    fill: labels.totalColor.value.value, class: "pz-total-label"
                });
                t.textContent = truncate(totalTexts[row], totalWidth, labels.totalFontSize.value, font, true);
                textLayer.appendChild(t);
            }
        });

        // Conectores entre barras consecutivas.
        if (conn.show.value) {
            for (let i = 0; i + 1 < edges.length; i++) {
                const a = edges[i];
                const b = edges[i + 1];
                // Com o rótulo acima da barra, o conector termina antes dele.
                const by = b.y0 - topLabelH;
                if (by - a.y1 < 2) {
                    continue;
                }
                const points = `${a.x0},${a.y1} ${a.x1},${a.y1} ${b.x1},${by} ${b.x0},${by}`;
                connLayer.appendChild(svg("polygon", {
                    points, fill: conn.color.value.value,
                    "fill-opacity": Math.min(100, Math.max(0, conn.opacity.value)) / 100
                }));
                // Taxa de conversão no sentido do fluxo: de cima para baixo no funil, de baixo para cima na pirâmide.
                const from = model.bars[upward ? i + 1 : i].total;
                const to = model.bars[upward ? i : i + 1].total;
                if (conn.showRate.value && from > 0 && by - a.y1 >= conn.fontSize.value) {
                    const t = svg("text", {
                        x: center, y: (a.y1 + by) / 2, "font-size": conn.fontSize.value,
                        fill: conn.fontColor.value.value, class: "pz-rate"
                    });
                    t.textContent = this.pct(to / from);
                    textLayer.appendChild(t);
                }
            }
        }
    }

    private totalText(model: Model, bar: Bar, row: number, mode: string): string {
        const upward = enumValue(this.formattingSettings.barsCard.order) === "asc";
        const value = model.format(bar.total);
        if (mode === "valueFirst") {
            // Na pirâmide (maior embaixo) a referência é a base.
            const first = model.bars[upward ? model.bars.length - 1 : 0].total;
            return first > 0 ? `${value} · ${this.pct(bar.total / first)}` : value;
        }
        if (mode === "valuePrev") {
            const p = upward ? row + 1 : row - 1;
            if (p < 0 || p >= model.bars.length) {
                return value;
            }
            const prev = model.bars[p].total;
            return prev > 0 ? `${value} · ${this.pct(bar.total / prev)}` : value;
        }
        return value;
    }

    // ------------------------------------------------------------- interação

    private bindSegment(rect: SVGRectElement, model: Model, bar: Bar, k: number): void {
        const tooltip = (): VisualTooltipDataItem[] => {
            const series = model.series[k];
            const value = bar.parts[k];
            const items: VisualTooltipDataItem[] = [
                { displayName: model.categoryName, value: bar.label }
            ];
            if (model.hasLegend) {
                items.push({ displayName: model.legendName, value: series.name, color: series.color });
            }
            items.push({ displayName: model.valueName, value: model.format(value), color: model.hasLegend ? undefined : series.color });
            if (model.hasLegend) {
                items.push({ displayName: "% da barra", value: this.pct(bar.total > 0 ? value / bar.total : 0) });
                items.push({ displayName: "Total da barra", value: model.format(bar.total) });
            }
            items.push({ displayName: "% do total geral", value: this.pct(model.grandTotal > 0 ? value / model.grandTotal : 0) });
            for (const column of series.tooltips) {
                const f = valueFormatter.create({ format: column.source.format, cultureSelector: this.locale });
                items.push({ displayName: column.source.displayName, value: f.format(column.values[bar.index]) });
            }
            return items;
        };
        const id = bar.selectionIds[k];
        rect.addEventListener("mouseenter", (e: MouseEvent) => {
            this.host.tooltipService.show({
                coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: tooltip(), identities: [id]
            });
        });
        rect.addEventListener("mousemove", (e: MouseEvent) => {
            this.host.tooltipService.move({
                coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: tooltip(), identities: [id]
            });
        });
        rect.addEventListener("mouseleave", () => {
            this.host.tooltipService.hide({ immediately: true, isTouchEvent: false });
        });
        rect.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
        });
        rect.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectionManager.showContextMenu(id, { x: e.clientX, y: e.clientY });
        });
    }

    /** Esmaece o que não está selecionado (segmentos e itens da legenda). */
    private paintSelection(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const dim = String(Math.min(100, Math.max(0, this.formattingSettings.barsCard.selectedOpacity.value)) / 100);
        const has = selected.length > 0;
        const isOn = (id: ISelectionId): boolean => selected.some(sel => sel.equals(id) || id.includes(sel) || sel.includes(id));
        const seriesOn = model.series.map(series => !has || isOn(series.selectionId)
            || model.bars.some(bar => selected.some(sel => sel.equals(bar.selectionIds[model.series.indexOf(series)]))));

        this.root.querySelectorAll<SVGElement>(".pz-seg, .pz-seg-label").forEach(node => {
            const bar = model.bars[Number(node.dataset.bar)];
            const k = Number(node.dataset.series);
            const on = !has || isOn(bar.selectionIds[k]);
            node.style.opacity = on ? "1" : dim;
        });
        this.root.querySelectorAll<HTMLElement>(".pz-legend-item").forEach(node => {
            node.style.opacity = seriesOn[Number(node.dataset.series)] ? "1" : dim;
        });
    }
}
