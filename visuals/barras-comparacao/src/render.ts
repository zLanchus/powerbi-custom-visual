"use strict";

// Desenho com o padrão selection.join() do D3: o SVG é criado uma vez e só atualizado.

import powerbi from "powerbi-visuals-api";
import { Selection, select } from "../../common/src/d3";

import { AxisStyle, renderAxis, renderAxisTitle, renderGrid } from "../../common/src/axes";
import { DARK, WHITE, readableText } from "../../common/src/colors";
import { el, svgEl } from "../../common/src/dom";
import { renderEmptyState } from "../../common/src/emptyState";
import { textWidth, truncate } from "../../common/src/format";
import { Strings } from "../../common/src/i18n";
import { SelectionHelper, bindKeyboard } from "../../common/src/selection";
import { TooltipContent, TooltipHelper } from "../../common/src/tooltip";
import { BarsConfig, BarsLayout, LineStyle, MORE_KEY, MarkerShape } from "./layout";
import { Bar, BarsModel, Category } from "./viewModel";

import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

type G = Selection<SVGGElement, unknown, null, undefined>;

interface Item {
    cat: Category;
    bar: Bar;
}

interface MarkerItem extends Item {
    m: number;
    value: number;
}

interface LegendEntry {
    key: string;
    label: string;
    color: string;
    icon: "box" | "hatch" | "line" | MarkerShape;
    series?: number;
    dash?: string;
}

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

let instances = 0;

export const DASHES: Record<LineStyle, string | null> = { solid: null, dashed: "6 4", dotted: "1.5 3" };

export class BarsRenderer {
    private root: HTMLElement;
    private legend: HTMLElement;
    private body: HTMLElement;
    private note: HTMLElement;
    private live: HTMLElement;
    private scroller: HTMLElement;
    private axisSvg: Selection<SVGSVGElement, unknown, null, undefined>;
    private axisG: G;
    private axisTitleG: G;
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private hatchPattern: Selection<SVGPatternElement, unknown, null, undefined>;
    private layers: Record<"grid" | "tracks" | "ghost" | "bars" | "zero" | "ticks" | "markers" | "refLine" | "labels" | "cats" | "titles" | "focus", G>;
    private hatchId: string;
    private empty: HTMLElement | undefined;

    private model: BarsModel | undefined;
    private layout: BarsLayout | undefined;
    private cfg: BarsConfig | undefined;
    private focusables: Item[] = [];
    private focusIndex = -1;

    constructor(container: HTMLElement, private selection: SelectionHelper, private tooltip: TooltipHelper, private strings: Strings) {
        const uid = ++instances;
        this.hatchId = `bc-hatch-${uid}`;
        this.root = el("div", "cv-root bc-root");
        container.appendChild(this.root);
        this.legend = el("div", "cv-legend");
        this.body = el("div", "cv-body");
        this.note = el("div", "cv-note");
        this.live = el("div", "cv-sr-only");
        this.live.setAttribute("aria-live", "polite");
        this.scroller = el("div", "cv-scroll");
        this.root.append(this.legend, this.body);
        this.body.append(this.note, this.live, this.scroller);

        this.axisSvg = select(this.body).append("svg").attr("class", "cv-axis-svg").attr("aria-hidden", "true");
        this.axisG = this.axisSvg.append("g").attr("class", "bc-axis");
        this.axisTitleG = this.axisSvg.append("g").attr("class", "bc-axis-title");

        this.svg = select(this.scroller).append("svg").attr("class", "cv-svg").attr("tabindex", 0).attr("role", "img").attr("focusable", "true");
        const defs = this.svg.append("defs");
        this.hatchPattern = defs.append("pattern")
            .attr("id", this.hatchId)
            .attr("patternUnits", "userSpaceOnUse")
            .attr("width", 6)
            .attr("height", 6)
            .attr("patternTransform", "rotate(45)");
        this.hatchPattern.append("rect").attr("class", "bc-hatch-bg").attr("width", 6).attr("height", 6);
        this.hatchPattern.append("line").attr("class", "bc-hatch-line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke-width", 2.5);

        const layer = (name: string): G => this.svg.append("g").attr("class", `bc-${name}`);
        this.layers = {
            grid: layer("grid"),
            tracks: layer("tracks"),
            ghost: layer("ghost"),
            bars: layer("bars"),
            zero: layer("zero"),
            ticks: layer("ticks"),
            markers: layer("markers"),
            refLine: layer("ref"),
            labels: layer("labels"),
            cats: layer("cats"),
            titles: layer("titles"),
            focus: layer("focus")
        };

        this.selection.bindBackground(this.root, target => !!target.closest(".cv-item, .cv-legend-item.cv-clickable"));
        bindKeyboard(this.svg.node() as SVGSVGElement, {
            count: () => this.focusables.length,
            focus: i => this.focus(i),
            activate: (i, multi) => {
                const item = this.focusables[i];
                if (item) {
                    this.selection.select(item.bar.id, multi);
                }
            },
            leave: () => this.focus(-1)
        });
    }

    // ------------------------------------------------------------- estado vazio

    public renderEmpty(title: string, missing: string[]): void {
        this.model = undefined;
        this.body.style.display = "none";
        this.legend.style.display = "none";
        this.empty?.remove();
        this.empty = renderEmptyState(this.root, title, this.strings("Empty_Text"), missing);
    }

    // ------------------------------------------------------------- desenho

    public render(model: BarsModel, cfg: BarsConfig, layoutFor: (width: number, height: number) => BarsLayout, width: number, height: number, notes: string[]): void {
        this.empty?.remove();
        this.empty = undefined;
        this.model = model;
        this.cfg = cfg;
        this.body.style.display = "";
        this.root.style.fontFamily = cfg.font;
        this.root.style.background = cfg.hc.on ? cfg.hc.background : "";

        // Legenda primeiro: a altura dela define a área do gráfico.
        const legendH = this.renderLegend(model, cfg);
        this.root.style.flexDirection = cfg.legend.bottom ? "column-reverse" : "column";
        const bodyH = Math.max(0, height - legendH);
        const layout = layoutFor(width, bodyH);
        this.layout = layout;
        this.note.textContent = notes.join(" · ");

        this.body.style.height = bodyH + "px";
        Object.assign(this.scroller.style, {
            left: layout.scroll.x + "px",
            top: layout.scroll.y + "px",
            width: layout.scroll.w + "px",
            height: layout.scroll.h + "px"
        });
        this.scroller.classList.toggle("cv-scroll-x", layout.scroll.dir === "x");
        this.scroller.classList.toggle("cv-scroll-y", layout.scroll.dir === "y");
        this.svg.attr("width", layout.content.w).attr("height", layout.content.h);
        this.svg.attr("aria-label", this.strings("Aria_Summary", this.strings("Visual_Name"), model.names.value, model.names.category, model.categories.length));
        this.axisSvg
            .attr("width", layout.axis.w)
            .attr("height", layout.axis.h)
            .style("left", layout.axis.x + "px")
            .style("top", layout.axis.y + "px");

        const hatchColor = cfg.hc.on ? cfg.hc.foreground : cfg.low.color;
        this.hatchPattern.select(".bc-hatch-bg").attr("fill", hatchColor).attr("fill-opacity", cfg.hc.on ? 0 : 0.28);
        this.hatchPattern.select(".bc-hatch-line").attr("stroke", hatchColor);

        const items: Item[] = model.categories.flatMap(cat => cat.bars.filter(b => b.value !== null).map(bar => ({ cat, bar })));
        this.focusables = items;
        if (this.focusIndex >= items.length) {
            this.focusIndex = -1;
        }

        this.renderAxes(model, layout, cfg);
        this.renderBars(model, layout, cfg, items);
        this.renderReference(model, layout, cfg, items);
        this.renderMarkers(model, layout, cfg, items);
        this.renderDataLabels(model, layout, cfg, items);
        this.renderCategories(model, layout, cfg);
        this.focus(this.focusIndex);
        this.paintSelection();
    }

    /** Posição de uma barra (coordenadas do SVG rolável). */
    private box(layout: BarsLayout, item: Item, value: number): Box {
        const across = (layout.band(item.cat.key) ?? 0) + (layout.sub(String(item.bar.series)) ?? 0);
        const thick = layout.sub.bandwidth();
        const a = layout.value(0);
        const b = layout.value(value);
        if (layout.mode === "vertical") {
            return { x: layout.plot.x + across, y: layout.plot.y + Math.min(a, b), w: thick, h: Math.abs(a - b) };
        }
        return { x: layout.plot.x + Math.min(a, b), y: layout.plot.y + across, w: Math.abs(a - b), h: thick };
    }

    private fillOf(bar: Bar, cfg: BarsConfig): string {
        if (cfg.hc.on) {
            if (bar.hatch) {
                return `url(#${this.hatchId})`;
            }
            return bar.state === "above" || bar.state === "flag" ? cfg.hc.foreground : cfg.hc.background;
        }
        return bar.hatch ? `url(#${this.hatchId})` : bar.fill;
    }

    private renderAxes(model: BarsModel, layout: BarsLayout, cfg: BarsConfig): void {
        const axes = cfg.axes;
        const hc = cfg.hc;
        const style: AxisStyle = {
            fontSize: axes.fontSize,
            fontFamily: cfg.font,
            textColor: hc.on ? hc.foreground : axes.fontColor,
            lineColor: hc.on ? hc.foreground : axes.gridColor,
            showLine: false
        };
        const format = (v: number): string => model.formats.value(v);
        const showAxis = layout.mode !== "card" && axes.showValue;
        if (showAxis && layout.mode === "vertical") {
            this.axisG.attr("transform", `translate(${layout.axis.w - 2},${layout.plot.y})`).attr("display", null);
            renderAxis(this.axisG, layout.value, "left", style, { tickValues: layout.ticks, format, tickSize: 0 });
        } else if (showAxis && layout.mode === "horizontal") {
            this.axisG.attr("transform", `translate(${layout.plot.x},0)`).attr("display", null);
            renderAxis(this.axisG, layout.value, "bottom", style, { tickValues: layout.ticks, format, tickSize: 0 });
        } else {
            this.axisG.attr("display", "none");
        }
        const titleStyle = { ...style, textColor: hc.on ? hc.foreground : axes.fontColor };
        renderAxisTitle(this.axisTitleG, layout.valueTitle ? axes.valueTitle : "",
            layout.valueTitle?.x ?? 0, layout.valueTitle?.y ?? 0, layout.mode === "vertical", titleStyle);
        renderAxisTitle(this.layers.titles, layout.categoryTitle ? axes.categoryTitle : "",
            layout.categoryTitle?.x ?? 0, layout.categoryTitle?.y ?? 0, layout.mode === "horizontal", titleStyle);

        // Grade e linha do zero.
        const vertical = layout.mode === "vertical";
        const gridColor = hc.on ? hc.foreground : axes.gridColor;
        this.layers.grid
            .attr("transform", `translate(${layout.plot.x},${layout.plot.y})`)
            .attr("stroke-opacity", hc.on ? 0.4 : axes.gridOpacity);
        renderGrid(this.layers.grid, layout.mode === "card" ? [] : layout.ticks.filter(t => t !== 0), layout.value, vertical,
            vertical ? layout.plot.w : layout.plot.h, gridColor, axes.grid);

        const showZero = layout.mode !== "card" || model.domain[0] < 0;
        const z = layout.value(0);
        this.layers.zero.selectAll<SVGLineElement, number>("line")
            .data(showZero ? [0] : [])
            .join("line")
            .attr("x1", vertical ? layout.plot.x : layout.plot.x + z)
            .attr("x2", vertical ? layout.plot.x + layout.plot.w : layout.plot.x + z)
            .attr("y1", vertical ? layout.plot.y + z : layout.plot.y)
            .attr("y2", vertical ? layout.plot.y + z : layout.plot.y + layout.plot.h)
            .attr("stroke", hc.on ? hc.foreground : axes.fontColor)
            .attr("stroke-opacity", model.domain[0] < 0 ? 0.9 : 0.5)
            .attr("stroke-width", 1)
            .attr("shape-rendering", "crispEdges");
    }

    private renderBars(model: BarsModel, layout: BarsLayout, cfg: BarsConfig, items: Item[]): void {
        const hc = cfg.hc;
        const radius = Math.max(0, cfg.radius);
        const fmt = model.formats.value;

        // Trilho do modo cartão.
        const tracks = layout.mode === "card" ? items : [];
        this.layers.tracks.selectAll<SVGRectElement, Item>("rect")
            .data(tracks, d => d.bar.key)
            .join("rect")
            .attr("x", layout.plot.x)
            .attr("y", d => layout.plot.y + (layout.band(d.cat.key) ?? 0) + (layout.sub(String(d.bar.series)) ?? 0))
            .attr("width", layout.plot.w)
            .attr("height", layout.sub.bandwidth())
            .attr("rx", Math.min(radius, layout.sub.bandwidth() / 2))
            .attr("fill", hc.on ? "none" : "rgba(15, 43, 69, .07)")
            .attr("stroke", hc.on ? hc.foreground : null)
            .attr("stroke-opacity", 0.4);

        const setBox = (sel: Selection<SVGRectElement, Item, SVGGElement, unknown>, value: (d: Item) => number): void => {
            sel.each((d, i, nodes) => {
                const b = this.box(layout, d, value(d));
                const r = Math.min(radius, Math.min(b.w, b.h) / 2);
                select(nodes[i])
                    .attr("x", b.x)
                    .attr("y", b.y)
                    .attr("width", Math.max(0, b.w))
                    .attr("height", Math.max(0, b.h))
                    .attr("rx", r)
                    .attr("ry", r);
            });
        };

        // Com destaque de outro visual, a barra inteira fica esmaecida e a parte destacada por cima.
        const ghosts = this.layers.ghost.selectAll<SVGRectElement, Item>("rect")
            .data(model.hasHighlights ? items : [], d => d.bar.key)
            .join("rect")
            .attr("class", "bc-ghost cv-item")
            .attr("fill", d => this.fillOf(d.bar, cfg))
            .attr("stroke", hc.on ? hc.foreground : null)
            .attr("opacity", 0.3);
        setBox(ghosts, d => d.bar.value as number);

        const bars = this.layers.bars.selectAll<SVGRectElement, Item>("rect")
            .data(items, d => d.bar.key)
            .join("rect")
            .attr("class", "bc-bar cv-item")
            .attr("fill", d => this.fillOf(d.bar, cfg))
            .attr("stroke", d => (hc.on || d.bar.hatch ? (hc.on ? hc.foreground : cfg.low.color) : null))
            .attr("stroke-width", d => (hc.on || d.bar.hatch ? 1.2 : null))
            .attr("aria-label", d => this.ariaLabel(model, d, fmt));
        setBox(bars, d => (model.hasHighlights ? d.bar.highlight ?? 0 : d.bar.value as number));

        for (const sel of [ghosts, bars]) {
            this.tooltip.bind(sel, d => this.tooltipFor(model, cfg, d));
            sel.on("click", (e: MouseEvent, d: Item) => {
                e.stopPropagation();
                this.selection.select(d.bar.id, e.ctrlKey || e.metaKey || e.shiftKey);
            }).on("contextmenu", (e: MouseEvent, d: Item) => this.selection.contextMenu(d.bar.id, e));
        }
    }

    private renderReference(model: BarsModel, layout: BarsLayout, cfg: BarsConfig, items: Item[]): void {
        const ref = cfg.reference;
        const hc = cfg.hc;
        const color = hc.on ? hc.foreground : ref.color;
        const dash = DASHES[ref.style];
        const show = ref.show && model.reference.present;
        const single = show && model.reference.uniform && model.reference.value !== null && layout.mode !== "card";
        const vertical = layout.mode === "vertical";

        // Linha única quando a referência é igual em todas as categorias.
        const p = single ? layout.value(model.reference.value as number) : 0;
        const lineData = single ? [model.reference.value as number] : [];
        this.layers.refLine.selectAll<SVGLineElement, number>("line")
            .data(lineData)
            .join("line")
            .attr("x1", vertical ? layout.plot.x : layout.plot.x + p)
            .attr("x2", vertical ? layout.plot.x + layout.plot.w : layout.plot.x + p)
            .attr("y1", vertical ? layout.plot.y + p : layout.plot.y - 4)
            .attr("y2", vertical ? layout.plot.y + p : layout.plot.y + layout.plot.h)
            .attr("stroke", color)
            .attr("stroke-width", ref.width)
            .attr("stroke-dasharray", dash)
            .attr("stroke-linecap", ref.style === "dotted" ? "round" : null);
        const labelText = single ? this.referenceLabel(model, cfg, model.reference.value as number) : "";
        this.layers.refLine.selectAll<SVGTextElement, string>("text")
            .data(labelText ? [labelText] : [])
            .join("text")
            .attr("class", "bc-ref-label")
            .attr("x", vertical ? layout.plot.x + layout.plot.w - 2 : layout.plot.x + p)
            .attr("y", vertical ? layout.plot.y + p - 4 : layout.plot.y - 6)
            .attr("text-anchor", vertical ? "end" : "middle")
            .attr("font-size", cfg.labels.fontSize)
            .attr("font-weight", 600)
            .attr("fill", color)
            .attr("paint-order", "stroke")
            .attr("stroke", hc.on ? hc.background : WHITE)
            .attr("stroke-width", 3)
            .text(d => d);

        // Referência diferente por categoria: um traço por barra.
        const ticks = show && !single ? items.filter(d => d.bar.reference !== null) : [];
        const extend = 3;
        this.layers.ticks.selectAll<SVGLineElement, Item>("line")
            .data(ticks, d => d.bar.key)
            .join("line")
            .each((d, i, nodes) => {
                const across = layout.plot.y * (vertical ? 0 : 1) + (layout.band(d.cat.key) ?? 0) + (layout.sub(String(d.bar.series)) ?? 0);
                const thick = layout.sub.bandwidth();
                const pos = layout.value(d.bar.reference as number);
                const line = select(nodes[i]);
                if (vertical) {
                    line.attr("x1", layout.plot.x + across - extend).attr("x2", layout.plot.x + across + thick + extend)
                        .attr("y1", layout.plot.y + pos).attr("y2", layout.plot.y + pos);
                } else {
                    line.attr("x1", layout.plot.x + pos).attr("x2", layout.plot.x + pos)
                        .attr("y1", across - extend).attr("y2", across + thick + extend);
                }
            })
            .attr("stroke", color)
            .attr("stroke-width", Math.max(1.5, ref.width))
            .attr("stroke-dasharray", ref.style === "solid" ? null : ref.style === "dotted" ? "1.5 2" : "3 2")
            .attr("pointer-events", "none");
    }

    private referenceLabel(model: BarsModel, cfg: BarsConfig, value: number): string {
        const name = cfg.reference.label || model.names.reference || this.strings("Reference_Default");
        return cfg.reference.showValue ? `${name}: ${model.formats.reference(value)}` : name;
    }

    private renderMarkers(model: BarsModel, layout: BarsLayout, cfg: BarsConfig, items: Item[]): void {
        const hc = cfg.hc;
        const vertical = layout.mode === "vertical";
        const markers: MarkerItem[] = [];
        for (const item of items) {
            item.bar.comparisons.forEach((value, m) => {
                if (value !== null) {
                    markers.push({ ...item, m, value });
                }
            });
        }
        const geometry = (d: MarkerItem): { cx: number; cy: number; size: number; thick: number } => {
            const across = (layout.band(d.cat.key) ?? 0) + (layout.sub(String(d.bar.series)) ?? 0) + layout.sub.bandwidth() / 2;
            const pos = layout.value(d.value);
            const size = Math.max(4, cfg.markers[d.m].size);
            return vertical
                ? { cx: layout.plot.x + across, cy: layout.plot.y + pos, size, thick: layout.sub.bandwidth() }
                : { cx: layout.plot.x + pos, cy: layout.plot.y + across, size, thick: layout.sub.bandwidth() };
        };
        const path = (d: MarkerItem): string => {
            const { cx, cy, size, thick } = geometry(d);
            const r = size / 2;
            const shape = cfg.markers[d.m].shape;
            if (shape === "circle") {
                return `M${cx - r},${cy}a${r},${r} 0 1,0 ${size},0a${r},${r} 0 1,0 ${-size},0`;
            }
            if (shape === "diamond") {
                return `M${cx},${cy - r}L${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}Z`;
            }
            const half = Math.max(r, thick * 0.45);
            return vertical ? `M${cx - half},${cy}L${cx + half},${cy}` : `M${cx},${cy - half}L${cx},${cy + half}`;
        };
        const colorOf = (d: MarkerItem): string => (hc.on ? hc.foreground : cfg.markers[d.m].color);
        const marks = this.layers.markers.selectAll<SVGPathElement, MarkerItem>("path")
            .data(markers, d => `${d.bar.key}:${d.m}`)
            .join("path")
            .attr("class", "bc-marker cv-item")
            .attr("d", path)
            .attr("fill", d => (cfg.markers[d.m].shape === "diamond" ? colorOf(d) : "none"))
            .attr("stroke", d => (cfg.markers[d.m].shape === "diamond" ? (hc.on ? hc.background : WHITE) : colorOf(d)))
            .attr("stroke-width", d => (cfg.markers[d.m].shape === "dash" ? 3 : cfg.markers[d.m].shape === "circle" ? 2 : 1))
            .attr("stroke-linecap", "round");
        this.tooltip.bind(marks, d => this.tooltipFor(model, cfg, d));
        marks.on("click", (e: MouseEvent, d: MarkerItem) => {
            e.stopPropagation();
            this.selection.select(d.bar.id, e.ctrlKey || e.metaKey || e.shiftKey);
        }).on("contextmenu", (e: MouseEvent, d: MarkerItem) => this.selection.contextMenu(d.bar.id, e));

        const labeled = markers.filter(d => cfg.markers[d.m].showLabel);
        const size = Math.max(8, cfg.labels.fontSize - 1);
        this.layers.markers.selectAll<SVGTextElement, MarkerItem>("text")
            .data(labeled, d => `${d.bar.key}:${d.m}`)
            .join("text")
            .attr("class", "bc-marker-label")
            .each((d, i, nodes) => {
                const g = geometry(d);
                const t = select(nodes[i]);
                if (vertical) {
                    t.attr("x", g.cx + g.size / 2 + 3).attr("y", g.cy).attr("text-anchor", "start");
                } else {
                    t.attr("x", g.cx).attr("y", g.cy - g.size / 2 - 3).attr("text-anchor", "middle");
                }
            })
            .attr("dominant-baseline", vertical ? "central" : "auto")
            .attr("font-size", size)
            .attr("fill", d => colorOf(d))
            .attr("paint-order", "stroke")
            .attr("stroke", hc.on ? hc.background : WHITE)
            .attr("stroke-width", 3)
            .attr("pointer-events", "none")
            .text(d => model.formats.comparisons[d.m](d.value));
    }

    private renderDataLabels(model: BarsModel, layout: BarsLayout, cfg: BarsConfig, items: Item[]): void {
        const labels = cfg.labels;
        const hc = cfg.hc;
        const font = cfg.font;
        const size = labels.fontSize;
        const vertical = layout.mode === "vertical";
        const card = layout.mode === "card";
        const thick = layout.sub.bandwidth();
        const slot = model.series.length > 1 ? layout.sub.step() : layout.band.step();
        interface Placed { item: Item; text: string; x: number; y: number; anchor: string; fill: string }
        const placed: Placed[] = [];
        if (labels.show) {
            for (const item of items) {
                const value = item.bar.value as number;
                const text = model.formats.value(value);
                const w = textWidth(text, size, font, labels.bold);
                const b = this.box(layout, item, value);
                const negative = value < 0;
                const textColor = hc.on ? hc.foreground : labels.color;
                if (card) {
                    placed.push({ item, text, x: layout.plot.x + layout.plot.w + 8, y: b.y + b.h / 2, anchor: "start", fill: textColor });
                    continue;
                }
                const length = vertical ? b.h : b.w;
                if (labels.inside) {
                    const fits = vertical ? length >= size + 6 && w <= thick - 2 : length >= w + 8 && thick >= size;
                    if (labels.autoHide && !fits) {
                        continue;
                    }
                    const fill = hc.on ? hc.foreground : (item.bar.hatch ? labels.color : readableText(item.bar.fill));
                    if (vertical) {
                        placed.push({ item, text, x: b.x + b.w / 2, y: negative ? b.y + b.h - size / 2 - 3 : b.y + size / 2 + 3, anchor: "middle", fill });
                    } else {
                        placed.push({ item, text, x: negative ? b.x + 4 : b.x + b.w - 4, y: b.y + b.h / 2, anchor: negative ? "start" : "end", fill });
                    }
                    continue;
                }
                const fits = vertical ? w <= slot - 2 : thick >= size * 0.8;
                if (labels.autoHide && !fits) {
                    continue;
                }
                if (vertical) {
                    placed.push({ item, text, x: b.x + b.w / 2, y: negative ? b.y + b.h + size / 2 + 3 : b.y - size / 2 - 3, anchor: "middle", fill: textColor });
                } else {
                    placed.push({ item, text, x: negative ? b.x - 4 : b.x + b.w + 4, y: b.y + b.h / 2, anchor: negative ? "end" : "start", fill: textColor });
                }
            }
        }
        this.layers.labels.selectAll<SVGTextElement, Placed>("text")
            .data(placed, d => d.item.bar.key)
            .join("text")
            .attr("class", "bc-label")
            .attr("x", d => d.x)
            .attr("y", d => d.y)
            .attr("text-anchor", d => d.anchor)
            .attr("dominant-baseline", "central")
            .attr("font-size", size)
            .attr("font-weight", labels.bold ? 600 : 400)
            .attr("fill", d => d.fill)
            .attr("pointer-events", "none")
            .text(d => d.text);
    }

    private renderCategories(model: BarsModel, layout: BarsLayout, cfg: BarsConfig): void {
        const axes = cfg.axes;
        const hc = cfg.hc;
        const font = cfg.font;
        const byKey = new Map(model.categories.map(c => [c.key, c]));
        const more = this.strings("TopN_More", model.hiddenCount);
        interface CatLabel { key: string; label: string; extra: string; more: boolean }
        const data: CatLabel[] = layout.keys.map(key => {
            const cat = byKey.get(key);
            return cat ? { key, label: cat.label, extra: cat.extra, more: false } : { key, label: more, extra: "", more: true };
        });
        const vertical = layout.mode === "vertical";
        const { rotate, maxWidth, showExtra } = layout.catLabel;
        const groups = this.layers.cats.selectAll<SVGGElement, CatLabel>("g.bc-cat")
            .data(data, d => d.key)
            .join(enter => {
                const g = enter.append("g").attr("class", "bc-cat");
                g.append("text").attr("class", "bc-cat-label");
                g.append("text").attr("class", "bc-cat-extra");
                g.append("title");
                return g;
            });
        const twoLines = (d: CatLabel): boolean => showExtra && d.extra !== "";
        groups.attr("transform", d => {
            const center = (layout.band(d.key) ?? 0) + layout.band.bandwidth() / 2;
            if (vertical) {
                return `translate(${layout.plot.x + center},${layout.plot.y + layout.plot.h + 6})${rotate ? " rotate(-90)" : ""}`;
            }
            const x = layout.mode === "card" ? 0 : layout.catLabel.x;
            return `translate(${x},${layout.plot.y + center})`;
        });
        const anchor = vertical ? (rotate ? "end" : "middle") : (layout.mode === "card" ? "start" : "end");
        groups.select<SVGTextElement>(".bc-cat-label")
            .attr("text-anchor", anchor)
            .attr("dominant-baseline", vertical && !rotate ? "hanging" : "central")
            .attr("y", d => (!vertical && twoLines(d) ? -(axes.extraFontSize / 2 + 1) : 0))
            .attr("font-size", axes.catFontSize)
            .attr("font-weight", d => (d.more ? 400 : 600))
            .attr("fill", d => (hc.on ? hc.foreground : d.more ? axes.extraColor : axes.catColor))
            .text(d => truncate(d.label, Math.max(12, maxWidth), axes.catFontSize, font, !d.more));
        groups.select<SVGTextElement>(".bc-cat-extra")
            .attr("text-anchor", anchor)
            .attr("dominant-baseline", vertical ? "hanging" : "central")
            .attr("y", d => (vertical ? axes.catFontSize + 3 : twoLines(d) ? axes.catFontSize / 2 + 2 : 0))
            .attr("font-size", axes.extraFontSize)
            .attr("fill", hc.on ? hc.foreground : axes.extraColor)
            .attr("display", d => (twoLines(d) ? null : "none"))
            .text(d => truncate(d.extra, Math.max(12, maxWidth), axes.extraFontSize, font));
        groups.select("title").text(d => (d.more ? this.strings("TopN_MoreTooltip", model.hiddenCount)
            : d.extra ? `${d.label} · ${d.extra}` : d.label));
    }

    // ------------------------------------------------------------- legenda

    private renderLegend(model: BarsModel, cfg: BarsConfig): number {
        const legend = this.legend;
        legend.replaceChildren();
        const hc = cfg.hc;
        const entries: LegendEntry[] = [];
        if (model.hasSeries) {
            model.series.forEach((s, k) => entries.push({ key: `s${k}`, label: s.name, color: s.color, icon: "box", series: k }));
        } else if (cfg.rule === "aboveBelow" && model.reference.present) {
            entries.push({ key: "above", label: this.strings("Legend_Above"), color: cfg.colors.above, icon: "box" });
            entries.push({ key: "below", label: this.strings("Legend_Below"), color: cfg.colors.below, icon: "box" });
        }
        if (model.hasFlag) {
            entries.push({ key: "flag", label: model.names.flag || this.strings("Legend_Flag"), color: cfg.colors.flag, icon: "box" });
        }
        model.names.comparisons.forEach((name, m) => {
            if (name) {
                entries.push({ key: `m${m}`, label: name, color: cfg.markers[m].color, icon: cfg.markers[m].shape });
            }
        });
        if (cfg.reference.show && model.reference.present) {
            entries.push({
                key: "ref",
                label: cfg.reference.label || model.names.reference || this.strings("Reference_Default"),
                color: cfg.reference.color,
                icon: "line",
                dash: DASHES[cfg.reference.style] || undefined
            });
        }
        if (model.hasLow && cfg.low.showInLegend) {
            entries.push({ key: "low", label: cfg.low.legendText || this.strings("Low_Default"), color: cfg.low.color, icon: cfg.low.faded ? "box" : "hatch" });
        }
        const show = cfg.legend.show && entries.length > 0;
        legend.style.display = show ? "" : "none";
        if (!show) {
            return 0;
        }
        legend.style.fontSize = cfg.legend.fontSize + "px";
        legend.style.color = hc.on ? hc.foreground : cfg.legend.fontColor;
        if (model.hasSeries && cfg.legend.title) {
            legend.appendChild(el("span", "cv-legend-title", cfg.legend.title));
        }
        for (const entry of entries) {
            const item = el("span", "cv-legend-item");
            item.dataset.key = entry.key;
            item.appendChild(this.legendIcon(entry, cfg));
            item.appendChild(el("span", "cv-legend-text", entry.label));
            if (entry.series !== undefined) {
                const series = model.series[entry.series];
                item.classList.add("cv-clickable");
                item.dataset.series = String(entry.series);
                item.addEventListener("click", (e: MouseEvent) => {
                    e.stopPropagation();
                    if (series.id) {
                        this.selection.select(series.id, e.ctrlKey || e.metaKey || e.shiftKey);
                    }
                });
                item.addEventListener("contextmenu", (e: MouseEvent) => this.selection.contextMenu(series.id, e));
            }
            legend.appendChild(item);
        }
        return Math.ceil(legend.getBoundingClientRect().height) || cfg.legend.fontSize + 16;
    }

    private legendIcon(entry: LegendEntry, cfg: BarsConfig): SVGSVGElement {
        const hc = cfg.hc;
        const color = hc.on ? hc.foreground : entry.color;
        const icon = svgEl("svg", { width: 14, height: 14, class: "cv-legend-icon", "aria-hidden": "true" });
        if (entry.icon === "box" || entry.icon === "hatch") {
            icon.appendChild(svgEl("rect", {
                x: 1, y: 1, width: 12, height: 12, rx: 3,
                fill: entry.icon === "hatch" ? `url(#${this.hatchId})` : (hc.on ? hc.background : color),
                stroke: hc.on || entry.icon === "hatch" ? color : "none",
                opacity: entry.key === "low" && cfg.low.faded ? 0.4 : 1
            }));
        } else if (entry.icon === "line") {
            const line = svgEl("line", { x1: 0, y1: 7, x2: 14, y2: 7, stroke: color, "stroke-width": 2 });
            if (entry.dash) {
                line.setAttribute("stroke-dasharray", entry.dash === "6 4" ? "4 2" : entry.dash);
            }
            icon.appendChild(line);
        } else if (entry.icon === "circle") {
            icon.appendChild(svgEl("circle", { cx: 7, cy: 7, r: 4.5, fill: "none", stroke: color, "stroke-width": 2 }));
        } else if (entry.icon === "diamond") {
            icon.appendChild(svgEl("path", { d: "M7,1.5L12.5,7L7,12.5L1.5,7Z", fill: color }));
        } else {
            icon.appendChild(svgEl("line", { x1: 2, y1: 7, x2: 12, y2: 7, stroke: color, "stroke-width": 3, "stroke-linecap": "round" }));
        }
        return icon;
    }

    // ------------------------------------------------------------- interação

    private tooltipFor(model: BarsModel, cfg: BarsConfig, item: Item): TooltipContent {
        const { cat, bar } = item;
        const series = model.series[bar.series];
        const items: VisualTooltipDataItem[] = [{ displayName: model.names.category, value: cat.label }];
        if (model.hasSeries) {
            items.push({ displayName: model.names.series, value: series.name, color: series.color });
        }
        items.push({ displayName: model.names.value, value: model.formats.value(bar.value), color: bar.hatch ? cfg.low.color : bar.fill });
        if (model.hasHighlights && bar.highlight !== null) {
            items.push({ displayName: `${model.names.value} (${this.strings("Tooltip_Highlighted")})`, value: model.formats.value(bar.highlight) });
        }
        bar.comparisons.forEach((value, m) => {
            const name = model.names.comparisons[m];
            if (name && value !== null) {
                items.push({ displayName: name, value: model.formats.comparisons[m](value), color: cfg.markers[m].color });
            }
        });
        if (bar.reference !== null && model.reference.present) {
            items.push({
                displayName: cfg.reference.label || model.names.reference || this.strings("Reference_Default"),
                value: model.formats.reference(bar.reference)
            });
        }
        if (model.names.confidence && bar.confidence !== null) {
            items.push({ displayName: model.names.confidence, value: model.formats.confidence(bar.confidence) });
        }
        if (bar.low) {
            items.push({
                displayName: cfg.low.legendText || this.strings("Low_Default"),
                value: `${model.formats.confidence(bar.confidence)} < ${model.formats.confidence(bar.threshold)}`
            });
        }
        if (model.names.extra && cat.extra) {
            items.push({ displayName: model.names.extra, value: cat.extra });
        }
        for (const t of bar.tooltips) {
            items.push({ displayName: t.name, value: t.value });
        }
        return { items, ids: [bar.id] };
    }

    private ariaLabel(model: BarsModel, item: Item, fmt: (v: number) => string): string {
        const { cat, bar } = item;
        const head = model.hasSeries ? `${cat.label}, ${model.series[bar.series].name}` : cat.label;
        const parts = [this.strings("Aria_Bar", head, fmt(bar.value as number))];
        if (bar.state === "above") {
            parts.push(this.strings("Aria_Above"));
        } else if (bar.state === "below") {
            parts.push(this.strings("Aria_Below"));
        }
        if (bar.low) {
            parts.push(this.strings("Aria_Low"));
        }
        return parts.join(", ");
    }

    /** Anel de foco do teclado e anúncio para leitor de tela. */
    private focus(index: number): void {
        this.focusIndex = index;
        const item = index >= 0 ? this.focusables[index] : undefined;
        const layout = this.layout;
        const model = this.model;
        const data = item && layout && model ? [this.box(layout, item, item.bar.value as number)] : [];
        const color = this.cfg?.hc.on ? this.cfg.hc.selected : DARK;
        this.layers.focus.selectAll<SVGRectElement, Box>("rect")
            .data(data)
            .join("rect")
            .attr("class", "cv-focus")
            .attr("x", d => d.x - 3)
            .attr("y", d => d.y - 3)
            .attr("width", d => d.w + 6)
            .attr("height", d => d.h + 6)
            .attr("rx", 4)
            .attr("stroke", color)
            .attr("stroke-width", 2);
        if (item && model && data[0]) {
            this.live.textContent = this.ariaLabel(model, item, v => model.formats.value(v));
            const b = data[0];
            const s = this.scroller;
            if (b.x < s.scrollLeft || b.x + b.w > s.scrollLeft + s.clientWidth) {
                s.scrollLeft = Math.max(0, b.x - s.clientWidth / 2);
            }
            if (b.y < s.scrollTop || b.y + b.h > s.scrollTop + s.clientHeight) {
                s.scrollTop = Math.max(0, b.y - s.clientHeight / 2);
            }
        }
    }

    /** Esmaece o que não está selecionado (barras, marcadores e itens da legenda). */
    public paintSelection(): void {
        const model = this.model;
        const cfg = this.cfg;
        if (!model || !cfg) {
            return;
        }
        const has = this.selection.hasSelection;
        const seriesOn = model.series.map(s => this.selection.isSelected(s.id));
        const on = (d: Item): boolean => !has || seriesOn[d.bar.series] || this.selection.isSelected(d.bar.id);
        const fade = (d: Item): number => (d.bar.faded ? 0.4 : 1);
        this.layers.bars.selectAll<SVGRectElement, Item>("rect").attr("opacity", d => fade(d) * (on(d) ? 1 : cfg.dim));
        this.layers.ghost.selectAll<SVGRectElement, Item>("rect").attr("opacity", d => 0.3 * fade(d) * (on(d) ? 1 : cfg.dim));
        this.layers.markers.selectAll<SVGElement, Item>("path, text").attr("opacity", d => (on(d) ? 1 : cfg.dim));
        this.layers.labels.selectAll<SVGTextElement, { item: Item }>("text").attr("opacity", d => (on(d.item) ? 1 : cfg.dim));
        this.legend.querySelectorAll<HTMLElement>(".cv-legend-item[data-series]").forEach(node => {
            const k = Number(node.dataset.series);
            const lit = !has || model.categories.some(c => on({ cat: c, bar: c.bars[k] }));
            node.style.opacity = lit ? "1" : String(cfg.dim);
        });
    }
}
