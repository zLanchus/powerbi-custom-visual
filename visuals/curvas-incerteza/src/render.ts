"use strict";

// Desenho com o padrão selection.join() do D3: o SVG é criado uma vez e só atualizado.

import powerbi from "powerbi-visuals-api";

import { AxisStyle, renderAxis, renderAxisTitle, renderGrid } from "../../common/src/axes";
import { DARK, WHITE } from "../../common/src/colors";
import {
    CurveFactory, ScaleLinear, ScaleTime, Selection, area, bisectLeft, curveLinear, curveMonotoneX, curveStepAfter, line, select
} from "../../common/src/d3";
import { el, svgEl } from "../../common/src/dom";
import { renderEmptyState } from "../../common/src/emptyState";
import { Strings } from "../../common/src/i18n";
import { SelectionHelper, bindKeyboard } from "../../common/src/selection";
import { TooltipContent, TooltipHelper } from "../../common/src/tooltip";
import { CurvesConfig, CurvesLayout } from "./layout";
import { CurvesModel, LineStyle, Point, Segment } from "./viewModel";

import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

type G = Selection<SVGGElement, unknown, null, undefined>;

interface SegmentItem {
    key: string;
    k: number;
    segment: Segment;
}

interface PointItem {
    k: number;
    p: Point;
}

interface LegendEntry {
    key: string;
    label: string;
    color: string;
    icon: "line" | "band" | "box" | "tick";
    dash?: string | null;
    curve?: number;
}

const DASH: Record<LineStyle, string | null> = { solid: null, dashed: "7 4", dotted: "1.5 3" };
const LOW_DASH = "5 4";
const LOW_DASH_ON_DASHED = "2 3";
const REF_DASH: Record<LineStyle, string | null> = { solid: null, dashed: "6 4", dotted: "1.5 3" };

/** No alto contraste todas as curvas têm a mesma cor: cada série ganha um tracejado próprio. */
const HC_DASHES = [null, "8 4", "2 3", "12 3 2 3", "4 4", "1 5"];

function seriesDash(style: LineStyle, k: number, highContrast: boolean): string | null {
    return highContrast ? HC_DASHES[k % HC_DASHES.length] : DASH[style];
}

function curveFactory(model: CurvesModel): CurveFactory {
    return model.interpolation === "stepAfter" ? curveStepAfter : model.interpolation === "smooth" ? curveMonotoneX : curveLinear;
}

export class CurvesRenderer {
    private root: HTMLElement;
    private legend: HTMLElement;
    private main: HTMLElement;
    private body: HTMLElement;
    private table: HTMLElement;
    private note: HTMLElement;
    private live: HTMLElement;
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private layers: Record<
        "windows" | "grid" | "xAxis" | "yAxis" | "titles" | "bands" | "reference" | "milestones" | "curves" | "marks" |
        "points" | "selected" | "milestoneLabels" | "endLabels" | "guide" | "focus",
        G
    >;
    private overlay: Selection<SVGRectElement, unknown, null, undefined>;
    private empty: HTMLElement | undefined;

    private model: CurvesModel | undefined;
    private layout: CurvesLayout | undefined;
    private cfg: CurvesConfig | undefined;
    private focusables: PointItem[] = [];
    private focusIndex = -1;
    private pixelXs: number[] = [];

    constructor(container: HTMLElement, private selection: SelectionHelper, private tooltip: TooltipHelper, private strings: Strings) {
        this.root = el("div", "cv-root ci-root");
        container.appendChild(this.root);
        this.legend = el("div", "cv-legend");
        this.main = el("div", "ci-main");
        this.body = el("div", "cv-body");
        this.table = el("div", "ci-table-wrap");
        this.note = el("div", "cv-note");
        this.live = el("div", "cv-sr-only");
        this.live.setAttribute("aria-live", "polite");
        this.root.append(this.legend, this.main);
        this.main.append(this.body, this.table);
        this.body.append(this.note, this.live);

        this.svg = select(this.body).append("svg").attr("class", "cv-svg").attr("tabindex", 0).attr("role", "img").attr("focusable", "true");
        const layer = (name: string): G => this.svg.append("g").attr("class", `ci-${name}`);
        this.layers = {
            windows: layer("windows"),
            grid: layer("grid"),
            xAxis: layer("x-axis"),
            yAxis: layer("y-axis"),
            titles: layer("titles"),
            bands: layer("bands"),
            reference: layer("reference"),
            milestones: layer("milestones"),
            curves: layer("curves"),
            marks: layer("marks"),
            points: layer("points"),
            selected: layer("selected"),
            milestoneLabels: layer("milestone-labels"),
            endLabels: layer("end-labels"),
            guide: layer("guide"),
            focus: layer("focus")
        };
        this.overlay = this.svg.append("rect").attr("class", "ci-overlay cv-item").attr("fill", "transparent");
        this.bindOverlay();

        this.selection.bindBackground(this.root, target => !!target.closest(".cv-item, .cv-legend-item.cv-clickable"));
        bindKeyboard(this.svg.node() as SVGSVGElement, {
            count: () => this.focusables.length,
            focus: i => this.focus(i),
            activate: (i, multi) => {
                const item = this.focusables[i];
                if (item) {
                    this.selection.select(item.p.id, multi);
                }
            },
            leave: () => this.focus(-1)
        });
    }

    // ------------------------------------------------------------- estado vazio

    public renderEmpty(title: string, missing: string[]): void {
        this.model = undefined;
        this.main.style.display = "none";
        this.legend.style.display = "none";
        this.empty?.remove();
        this.empty = renderEmptyState(this.root, title, this.strings("Empty_Text"), missing);
    }

    // ------------------------------------------------------------- desenho

    public render(model: CurvesModel, cfg: CurvesConfig, layoutFor: (width: number, height: number) => CurvesLayout, width: number, height: number, notes: string[]): void {
        this.empty?.remove();
        this.empty = undefined;
        this.model = model;
        this.cfg = cfg;
        this.main.style.display = "";
        this.root.style.fontFamily = cfg.font;
        this.root.style.background = cfg.hc.on ? cfg.hc.background : "";
        this.note.textContent = notes.join(" · ");

        const right = cfg.legend.position === "right";
        this.root.style.flexDirection = right ? "row-reverse" : cfg.legend.position === "bottom" ? "column-reverse" : "column";
        this.legend.classList.toggle("ci-legend-right", right);
        const legendSize = this.renderLegend(model, cfg, right ? height : 0, right ? width * 0.3 : 0);
        const mainW = Math.max(0, right ? width - legendSize : width);
        const mainH = Math.max(0, right ? height : height - legendSize);
        this.main.style.width = mainW + "px";
        this.main.style.height = mainH + "px";
        const tableH = this.renderTable(model, cfg, mainW);
        const bodyH = Math.max(0, mainH - tableH);
        this.body.style.height = bodyH + "px";

        const layout = layoutFor(mainW, bodyH);
        this.layout = layout;
        this.svg.attr("width", layout.width).attr("height", layout.height);
        this.svg.attr("aria-label", this.strings("Aria_Summary", this.strings("Visual_Name"), model.names.value, model.axis.name, model.curves.length));
        this.pixelXs = model.axis.xs.map(x => layout.x(x));

        this.focusables = [];
        model.curves.forEach((curve, k) => {
            for (const p of curve.points) {
                if (p.value !== null) {
                    this.focusables.push({ k, p });
                }
            }
        });
        if (this.focusIndex >= this.focusables.length) {
            this.focusIndex = -1;
        }

        const plot = layout.plot;
        for (const g of Object.values(this.layers)) {
            g.attr("transform", `translate(${plot.x},${plot.y})`);
        }
        this.layers.xAxis.attr("transform", `translate(${plot.x},${plot.y + plot.h})`);
        this.layers.yAxis.attr("transform", `translate(${plot.x},${plot.y})`);
        this.layers.titles.attr("transform", null);
        this.overlay.attr("x", plot.x).attr("y", plot.y).attr("width", plot.w).attr("height", plot.h);

        this.renderAxes(model, layout, cfg);
        this.renderWindows(model, layout, cfg);
        this.renderBands(model, layout, cfg);
        this.renderReference(model, layout, cfg);
        this.renderCurves(model, layout, cfg);
        this.renderMilestones(model, layout, cfg);
        this.renderEndLabels(model, layout, cfg);
        this.hideGuide();
        this.focus(this.focusIndex);
        this.paintSelection();
    }

    private renderAxes(model: CurvesModel, layout: CurvesLayout, cfg: CurvesConfig): void {
        const hc = cfg.hc;
        const style = (a: CurvesConfig["x"]): AxisStyle => ({
            fontSize: a.fontSize,
            fontFamily: cfg.font,
            textColor: hc.on ? hc.foreground : a.fontColor,
            lineColor: hc.on ? hc.foreground : a.fontColor,
            showLine: true
        });
        if (cfg.y.show) {
            this.layers.yAxis.attr("display", null);
            renderAxis(this.layers.yAxis, layout.y, "left", { ...style(cfg.y), showLine: false }, {
                tickValues: layout.yTicks, format: v => model.formats.value(Number(v)), tickSize: 0
            });
        } else {
            this.layers.yAxis.attr("display", "none");
        }
        if (cfg.x.show) {
            this.layers.xAxis.attr("display", null);
            const ticks = layout.xTicks;
            const labelOf = new Map(ticks.map(t => [t.x, t.label]));
            if (model.axis.kind === "date") {
                const scale = layout.xScale as ScaleTime<number, number>;
                renderAxis(this.layers.xAxis, scale, "bottom", style(cfg.x), {
                    tickValues: ticks.map(t => new Date(t.x)), format: d => labelOf.get(Number(d.valueOf())) ?? "", tickSize: 4
                });
            } else {
                const scale = layout.xScale as ScaleLinear<number, number>;
                renderAxis(this.layers.xAxis, scale, "bottom", style(cfg.x), {
                    tickValues: ticks.map(t => t.x), format: v => labelOf.get(Number(v)) ?? "", tickSize: 4
                });
            }
            this.layers.xAxis.select(".domain").attr("stroke-opacity", 0.5);
        } else {
            this.layers.xAxis.attr("display", "none");
        }
        const titleStyle = (a: CurvesConfig["x"]): AxisStyle => ({ ...style(a), textColor: hc.on ? hc.foreground : a.fontColor });
        const titles = this.layers.titles;
        let gx = titles.select<SVGGElement>("g.ci-x-title");
        if (gx.empty()) {
            gx = titles.append("g").attr("class", "ci-x-title");
            titles.append("g").attr("class", "ci-y-title");
        }
        renderAxisTitle(gx, layout.xTitle ? cfg.x.title : "", layout.xTitle?.x ?? 0, layout.xTitle?.y ?? 0, false, titleStyle(cfg.x));
        renderAxisTitle(titles.select<SVGGElement>("g.ci-y-title"), layout.yTitle ? cfg.y.title : "",
            layout.yTitle?.x ?? 0, layout.yTitle?.y ?? 0, true, titleStyle(cfg.y));

        // Grade: horizontal (Y) e vertical (X) num só grupo.
        const grid = this.layers.grid;
        let gy = grid.select<SVGGElement>("g.ci-grid-y");
        if (gy.empty()) {
            gy = grid.append("g").attr("class", "ci-grid-y");
            grid.append("g").attr("class", "ci-grid-x");
        }
        gy.attr("stroke-opacity", hc.on ? 0.4 : cfg.y.gridOpacity);
        renderGrid(gy, layout.yTicks, v => layout.y(v), true, layout.plot.w, hc.on ? hc.foreground : cfg.y.gridColor, cfg.y.grid);
        const gxg = grid.select<SVGGElement>("g.ci-grid-x").attr("stroke-opacity", hc.on ? 0.4 : cfg.x.gridOpacity);
        renderGrid(gxg, layout.xTicks.map(t => t.x), v => layout.x(v), false, layout.plot.h, hc.on ? hc.foreground : cfg.x.gridColor, cfg.x.grid);
    }

    private renderWindows(model: CurvesModel, layout: CurvesLayout, cfg: CurvesConfig): void {
        const hc = cfg.hc;
        const data = cfg.windows.show ? model.windows : [];
        const span = (w: { start: number; end: number }): [number, number] => {
            let a = Math.max(0, Math.min(layout.plot.w, layout.x(w.start)));
            let b = Math.max(0, Math.min(layout.plot.w, layout.x(w.end)));
            if (b - a < 6) {
                const c = (a + b) / 2;
                a = c - 3;
                b = c + 3;
            }
            return [a, b];
        };
        this.layers.windows.selectAll<SVGRectElement, { start: number; end: number }>("rect")
            .data(data)
            .join("rect")
            .attr("x", d => span(d)[0])
            .attr("width", d => span(d)[1] - span(d)[0])
            .attr("y", 0)
            .attr("height", layout.plot.h)
            .attr("fill", hc.on ? "none" : cfg.windows.color)
            .attr("fill-opacity", cfg.windows.opacity)
            .attr("stroke", hc.on ? hc.foreground : null)
            .attr("stroke-dasharray", hc.on ? "2 3" : null);
        this.layers.windows.selectAll<SVGTextElement, { start: number; end: number }>("text")
            .data(cfg.windows.label ? data : [])
            .join("text")
            .attr("x", d => (span(d)[0] + span(d)[1]) / 2)
            .attr("y", -5)
            .attr("text-anchor", "middle")
            .attr("font-size", cfg.milestones.fontSize)
            .attr("font-weight", 600)
            .attr("fill", hc.on ? hc.foreground : cfg.y.fontColor)
            .text(cfg.windows.label);
    }

    private renderBands(model: CurvesModel, layout: CurvesLayout, cfg: CurvesConfig): void {
        const hc = cfg.hc;
        interface BandItem { key: string; k: number; points: Point[] }
        const data: BandItem[] = [];
        if (cfg.band.show) {
            model.curves.forEach((curve, k) => curve.bands.forEach((points, b) => data.push({ key: `${curve.key}:${b}`, k, points })));
        }
        const gen = area<Point>()
            .curve(curveFactory(model))
            .x(p => layout.x(p.x))
            .y0(p => layout.y(p.lower as number))
            .y1(p => layout.y(p.upper as number));
        this.layers.bands.selectAll<SVGPathElement, BandItem>("path")
            .data(data, d => d.key)
            .join("path")
            .attr("class", "ci-band")
            .attr("d", d => gen(d.points) || "")
            .attr("fill", d => (hc.on ? hc.foreground : cfg.band.sameColor ? model.curves[d.k].color : cfg.band.color))
            .attr("fill-opacity", hc.on ? 0.15 : cfg.band.opacity)
            .attr("pointer-events", "none");
    }

    private renderReference(model: CurvesModel, layout: CurvesLayout, cfg: CurvesConfig): void {
        const ref = model.reference;
        const show = cfg.reference.show && ref.present;
        const color = cfg.hc.on ? cfg.hc.foreground : cfg.reference.color;
        const dash = REF_DASH[cfg.reference.style];
        const single = show && ref.uniform && ref.value !== null;
        const varying = show && !single && ref.points.length > 0;
        const gen = line<{ x: number; value: number }>().curve(curveFactory(model)).x(p => layout.x(p.x)).y(p => layout.y(p.value));
        const d = single
            ? `M0,${layout.y(ref.value as number)}H${layout.plot.w}`
            : varying ? gen(ref.points) || "" : "";
        this.layers.reference.selectAll<SVGPathElement, string>("path")
            .data(d ? [d] : [])
            .join("path")
            .attr("d", v => v)
            .attr("fill", "none")
            .attr("stroke", color)
            .attr("stroke-width", cfg.reference.width)
            .attr("stroke-dasharray", dash)
            .attr("pointer-events", "none");
        let label = "";
        let ly = 0;
        if (single || varying) {
            const value = single ? ref.value as number : ref.points[ref.points.length - 1].value;
            const name = cfg.reference.label || model.names.reference || this.strings("Reference_Default");
            label = cfg.reference.showValue ? `${name}: ${model.formats.reference(value)}` : name;
            ly = layout.y(value) - 5;
        }
        this.layers.reference.selectAll<SVGTextElement, string>("text")
            .data(label ? [label] : [])
            .join("text")
            .attr("x", layout.plot.w - 2)
            .attr("y", ly)
            .attr("text-anchor", "end")
            .attr("font-size", cfg.labels.fontSize)
            .attr("font-weight", 600)
            .attr("fill", color)
            .attr("paint-order", "stroke")
            .attr("stroke", cfg.hc.on ? cfg.hc.background : WHITE)
            .attr("stroke-width", 3)
            .text(v => v);
    }

    private renderCurves(model: CurvesModel, layout: CurvesLayout, cfg: CurvesConfig): void {
        const hc = cfg.hc;
        const gen = line<Point>().curve(curveFactory(model)).x(p => layout.x(p.x)).y(p => layout.y(p.value as number));
        const segments: SegmentItem[] = [];
        model.curves.forEach((curve, k) => {
            curve.segments.forEach((segment, s) => {
                if (!(segment.low && cfg.low.style === "hidden")) {
                    segments.push({ key: `${curve.key}:${s}`, k, segment });
                }
            });
        });
        const dashOf = (d: SegmentItem): string | null => {
            const dash = seriesDash(model.curves[d.k].style, d.k, hc.on);
            if (d.segment.low && cfg.low.style === "dashed") {
                return dash ? LOW_DASH_ON_DASHED : LOW_DASH;
            }
            return dash;
        };
        this.layers.curves.selectAll<SVGPathElement, SegmentItem>("path")
            .data(segments, d => d.key)
            .join("path")
            .attr("class", "ci-curve")
            .attr("d", d => gen(d.segment.points) || "")
            .attr("fill", "none")
            .attr("stroke", d => (hc.on ? hc.foreground : model.curves[d.k].color))
            .attr("stroke-width", d => (d.segment.points.length === 1 ? cfg.lineWidth + 3 : cfg.lineWidth))
            .attr("stroke-linecap", d => (d.segment.points.length === 1 ? "round" : "butt"))
            .attr("stroke-linejoin", "round")
            .attr("stroke-dasharray", dashOf)
            .attr("pointer-events", "none");

        // Marcas (ex.: censuras): tique vertical na curva.
        const marks: PointItem[] = [];
        const points: PointItem[] = [];
        model.curves.forEach((curve, k) => {
            for (const p of curve.points) {
                if (p.value === null) {
                    continue;
                }
                if (cfg.showMarks && p.mark) {
                    marks.push({ k, p });
                }
                if (cfg.showPoints || (model.hasHighlights && p.highlighted)) {
                    points.push({ k, p });
                }
            }
        });
        const half = cfg.markSize / 2;
        this.layers.marks.selectAll<SVGLineElement, PointItem>("line")
            .data(marks, d => `${d.k}:${d.p.i}`)
            .join("line")
            .attr("x1", d => layout.x(d.p.x))
            .attr("x2", d => layout.x(d.p.x))
            .attr("y1", d => layout.y(d.p.value as number) - half)
            .attr("y2", d => layout.y(d.p.value as number) + half)
            .attr("stroke", d => (hc.on ? hc.foreground : model.curves[d.k].color))
            .attr("stroke-width", 1.5)
            .attr("pointer-events", "none");
        this.layers.points.selectAll<SVGCircleElement, PointItem>("circle")
            .data(points, d => `${d.k}:${d.p.i}`)
            .join("circle")
            .attr("cx", d => layout.x(d.p.x))
            .attr("cy", d => layout.y(d.p.value as number))
            .attr("r", d => (model.hasHighlights && d.p.highlighted ? 4 : cfg.lineWidth + 1.5))
            .attr("fill", d => (hc.on ? hc.foreground : model.curves[d.k].color))
            .attr("stroke", hc.on ? hc.background : WHITE)
            .attr("stroke-width", 1)
            .attr("pointer-events", "none");
    }

    private renderMilestones(model: CurvesModel, layout: CurvesLayout, cfg: CurvesConfig): void {
        const hc = cfg.hc;
        const ms = cfg.milestones;
        const color = hc.on ? hc.foreground : ms.color;
        this.layers.milestones.selectAll<SVGLineElement, number>("line")
            .data(ms.showLines ? model.milestones.map(m => m.x) : [])
            .join("line")
            .attr("x1", x => layout.x(x))
            .attr("x2", x => layout.x(x))
            .attr("y1", 0)
            .attr("y2", layout.plot.h)
            .attr("stroke", color)
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "2 3")
            .attr("stroke-opacity", 0.7)
            .attr("pointer-events", "none");
        interface Label { key: string; k: number; x: number; y: number; value: number; end: boolean }
        const labels: Label[] = [];
        const gap = ms.fontSize + 1;
        if (ms.showLabels) {
            for (const m of model.milestones) {
                const px = layout.x(m.x);
                // Perto da borda direita, o rótulo fica à esquerda da linha.
                const end = px > layout.plot.w - 44;
                const column: Label[] = [];
                m.values.forEach((value, k) => {
                    if (value !== null) {
                        column.push({ key: `${m.x}:${k}`, k, x: px, y: layout.y(value) - 5, value, end });
                    }
                });
                // Afasta os rótulos do mesmo marco para não se sobreporem.
                column.sort((a, b) => a.y - b.y);
                for (let i = 1; i < column.length; i++) {
                    column[i].y = Math.max(column[i].y, column[i - 1].y + gap);
                }
                labels.push(...column);
            }
        }
        this.layers.milestoneLabels.selectAll<SVGTextElement, Label>("text")
            .data(labels, d => d.key)
            .join("text")
            .attr("x", d => (d.end ? d.x - 4 : d.x + 4))
            .attr("y", d => d.y)
            .attr("text-anchor", d => (d.end ? "end" : "start"))
            .attr("font-size", ms.fontSize)
            .attr("font-weight", 600)
            .attr("fill", d => (hc.on ? hc.foreground : model.curves[d.k].color))
            .attr("paint-order", "stroke")
            .attr("stroke", hc.on ? hc.background : WHITE)
            .attr("stroke-width", 3)
            .attr("pointer-events", "none")
            .text(d => model.formats.value(d.value));
    }

    private renderEndLabels(model: CurvesModel, layout: CurvesLayout, cfg: CurvesConfig): void {
        const hc = cfg.hc;
        this.layers.endLabels.selectAll<SVGTextElement, CurvesLayout["endLabels"][number]>("text")
            .data(layout.endLabels, d => String(d.curve))
            .join("text")
            .attr("x", d => d.x)
            .attr("y", d => d.y)
            .attr("dominant-baseline", "central")
            .attr("font-size", cfg.labels.fontSize)
            .attr("font-weight", 600)
            .attr("fill", d => (hc.on ? hc.foreground : cfg.labels.useSeriesColor ? model.curves[d.curve].color : cfg.labels.color))
            .attr("pointer-events", "none")
            .text(d => d.text);
    }

    // ------------------------------------------------------------- tabela de marcos

    private renderTable(model: CurvesModel, cfg: CurvesConfig, width: number): number {
        const wrap = this.table;
        wrap.replaceChildren();
        const show = cfg.milestones.showTable && model.milestones.length > 0;
        wrap.style.display = show ? "" : "none";
        if (!show) {
            return 0;
        }
        const hc = cfg.hc;
        wrap.style.fontSize = cfg.milestones.fontSize + "px";
        wrap.style.color = hc.on ? hc.foreground : cfg.legend.fontColor;
        wrap.style.maxWidth = width + "px";
        const table = el("table", "ci-table");
        const head = el("tr");
        head.appendChild(el("th", "ci-table-name", model.hasSeries ? model.names.series : this.strings("Milestones_Series")));
        for (const m of model.milestones) {
            head.appendChild(el("th", undefined, m.label));
        }
        const thead = el("thead");
        thead.appendChild(head);
        table.appendChild(thead);
        const tbody = el("tbody");
        model.curves.forEach((curve, k) => {
            const row = el("tr");
            const name = el("td", "ci-table-name");
            const dot = el("span", "ci-table-dot");
            dot.style.background = hc.on ? hc.foreground : curve.color;
            name.append(dot, document.createTextNode(curve.name));
            row.appendChild(name);
            for (const m of model.milestones) {
                const v = m.values[k];
                row.appendChild(el("td", undefined, v === null ? "–" : model.formats.value(v)));
            }
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return Math.ceil(wrap.getBoundingClientRect().height);
    }

    // ------------------------------------------------------------- legenda

    private renderLegend(model: CurvesModel, cfg: CurvesConfig, height: number, maxWidth: number): number {
        const legend = this.legend;
        legend.replaceChildren();
        const hc = cfg.hc;
        const entries: LegendEntry[] = [];
        const endNames = cfg.labels.endName && model.hasSeries && model.curves.length <= 4;
        if (model.hasSeries && !endNames) {
            model.curves.forEach((curve, k) => entries.push({
                key: curve.key, label: curve.name, color: curve.color, icon: "line", dash: seriesDash(curve.style, k, hc.on), curve: k
            }));
        }
        const extras: LegendEntry[] = [];
        if (cfg.band.show && model.hasBand) {
            const name = model.names.lower && model.names.upper ? `${model.names.lower} – ${model.names.upper}` : this.strings("Band_Default");
            extras.push({ key: "band", label: name, color: cfg.band.sameColor ? (model.curves[0]?.color || DARK) : cfg.band.color, icon: "band" });
        }
        if (model.hasLow && cfg.low.showInLegend && cfg.low.style !== "hidden") {
            extras.push({ key: "low", label: cfg.low.legendText || this.strings("Low_Default"), color: cfg.y.fontColor, icon: "line", dash: cfg.low.style === "dashed" ? LOW_DASH : null });
        }
        if (cfg.reference.show && model.reference.present) {
            extras.push({
                key: "ref", label: cfg.reference.label || model.names.reference || this.strings("Reference_Default"),
                color: cfg.reference.color, icon: "line", dash: REF_DASH[cfg.reference.style]
            });
        }
        if (cfg.windows.show && model.windows.length > 0) {
            extras.push({ key: "window", label: cfg.windows.label || model.names.highlight || this.strings("Window_Default"), color: cfg.windows.color, icon: "box" });
        }
        if (cfg.showMarks && model.hasMarks) {
            extras.push({ key: "marks", label: model.names.marks || this.strings("Marks_Default"), color: cfg.y.fontColor, icon: "tick" });
        }
        if (!model.hasSeries && extras.length) {
            const curve = model.curves[0];
            entries.push({ key: curve.key, label: curve.name, color: curve.color, icon: "line", dash: seriesDash(curve.style, 0, hc.on) });
        }
        entries.push(...extras);
        const show = cfg.legend.show && entries.length > 0;
        legend.style.display = show ? "" : "none";
        if (!show) {
            return 0;
        }
        legend.style.fontSize = cfg.legend.fontSize + "px";
        legend.style.color = hc.on ? hc.foreground : cfg.legend.fontColor;
        legend.style.maxWidth = maxWidth ? maxWidth + "px" : "";
        legend.style.maxHeight = height ? height + "px" : "";
        if (model.hasSeries && !endNames && cfg.legend.title) {
            legend.appendChild(el("span", "cv-legend-title", cfg.legend.title));
        }
        for (const entry of entries) {
            const item = el("span", "cv-legend-item");
            item.appendChild(this.legendIcon(entry, cfg));
            item.appendChild(el("span", "cv-legend-text", entry.label));
            if (entry.curve !== undefined) {
                const curve = model.curves[entry.curve];
                item.classList.add("cv-clickable");
                item.dataset.curve = String(entry.curve);
                item.addEventListener("click", (e: MouseEvent) => {
                    e.stopPropagation();
                    if (curve.id) {
                        this.selection.select(curve.id, e.ctrlKey || e.metaKey || e.shiftKey);
                    }
                });
                item.addEventListener("contextmenu", (e: MouseEvent) => this.selection.contextMenu(curve.id, e));
            }
            legend.appendChild(item);
        }
        const rect = legend.getBoundingClientRect();
        return Math.ceil(maxWidth ? rect.width : rect.height) || cfg.legend.fontSize + 16;
    }

    private legendIcon(entry: LegendEntry, cfg: CurvesConfig): SVGSVGElement {
        const hc = cfg.hc;
        const color = hc.on ? hc.foreground : entry.color;
        const icon = svgEl("svg", { width: 18, height: 12, class: "cv-legend-icon", "aria-hidden": "true" });
        if (entry.icon === "line") {
            const l = svgEl("line", { x1: 1, y1: 6, x2: 17, y2: 6, stroke: color, "stroke-width": 2.5 });
            if (entry.dash) {
                l.setAttribute("stroke-dasharray", entry.dash === "7 4" ? "5 3" : entry.dash);
            }
            icon.appendChild(l);
        } else if (entry.icon === "band") {
            icon.appendChild(svgEl("rect", { x: 1, y: 2, width: 16, height: 8, rx: 2, fill: color, "fill-opacity": hc.on ? 0.3 : Math.max(0.2, cfg.band.opacity) }));
        } else if (entry.icon === "box") {
            icon.appendChild(svgEl("rect", { x: 3, y: 0, width: 12, height: 12, rx: 2, fill: color, "fill-opacity": hc.on ? 0.3 : Math.max(0.3, cfg.windows.opacity) }));
        } else {
            icon.appendChild(svgEl("line", { x1: 9, y1: 1, x2: 9, y2: 11, stroke: color, "stroke-width": 1.5 }));
            icon.appendChild(svgEl("line", { x1: 2, y1: 6, x2: 16, y2: 6, stroke: color, "stroke-width": 1.5, "stroke-opacity": 0.5 }));
        }
        return icon;
    }

    // ------------------------------------------------------------- interação

    /** Índice do X mais próximo de uma posição em px (dentro da área de plotagem). */
    private nearestIndex(px: number): number {
        const xs = this.pixelXs;
        if (xs.length === 0) {
            return -1;
        }
        const i = bisectLeft(xs, px);
        if (i <= 0) {
            return 0;
        }
        if (i >= xs.length) {
            return xs.length - 1;
        }
        return px - xs[i - 1] <= xs[i] - px ? i - 1 : i;
    }

    /** Ponto mais próximo do mouse (até 24 px) entre as curvas no X mais próximo. */
    private nearestPoint(e: MouseEvent): PointItem | undefined {
        const model = this.model;
        const layout = this.layout;
        if (!model || !layout) {
            return undefined;
        }
        const [mx, my] = this.mouse(e);
        const i = this.nearestIndex(mx);
        let best: PointItem | undefined;
        let bestD = 24;
        model.curves.forEach((curve, k) => {
            const p = curve.points[i];
            if (p && p.value !== null) {
                const d = Math.hypot(layout.x(p.x) - mx, layout.y(p.value) - my);
                if (d <= bestD) {
                    bestD = d;
                    best = { k, p };
                }
            }
        });
        return best;
    }

    private mouse(e: MouseEvent): [number, number] {
        const rect = (this.svg.node() as SVGSVGElement).getBoundingClientRect();
        const plot = this.layout?.plot;
        return [e.clientX - rect.left - (plot?.x ?? 0), e.clientY - rect.top - (plot?.y ?? 0)];
    }

    private bindOverlay(): void {
        this.overlay
            .on("mousemove", (e: MouseEvent) => {
                const [mx] = this.mouse(e);
                const i = this.nearestIndex(mx);
                this.showGuide(i);
                this.tooltip.show(e, this.tooltipAt(i));
            })
            .on("mouseleave", () => {
                this.hideGuide();
                this.tooltip.hide();
            })
            .on("click", (e: MouseEvent) => {
                e.stopPropagation();
                const hit = this.nearestPoint(e);
                if (hit) {
                    this.selection.select(hit.p.id, e.ctrlKey || e.metaKey || e.shiftKey);
                } else {
                    this.selection.clear();
                }
            })
            .on("contextmenu", (e: MouseEvent) => this.selection.contextMenu(this.nearestPoint(e)?.p.id, e));
    }

    /** Linha-guia vertical com todas as séries naquele X. */
    private showGuide(i: number): void {
        const model = this.model;
        const layout = this.layout;
        const cfg = this.cfg;
        if (!model || !layout || !cfg || i < 0) {
            return;
        }
        const x = this.pixelXs[i];
        const color = cfg.hc.on ? cfg.hc.foreground : cfg.y.fontColor;
        this.layers.guide.selectAll<SVGLineElement, number>("line")
            .data([x])
            .join("line")
            .attr("x1", v => v)
            .attr("x2", v => v)
            .attr("y1", 0)
            .attr("y2", layout.plot.h)
            .attr("stroke", color)
            .attr("stroke-opacity", 0.6)
            .attr("pointer-events", "none");
        const dots = model.curves.map((curve, k) => ({ k, p: curve.points[i] })).filter(d => d.p && d.p.value !== null);
        this.layers.guide.selectAll<SVGCircleElement, PointItem>("circle")
            .data(dots, d => String(d.k))
            .join("circle")
            .attr("cx", d => layout.x(d.p.x))
            .attr("cy", d => layout.y(d.p.value as number))
            .attr("r", 4)
            .attr("fill", d => (cfg.hc.on ? cfg.hc.foreground : model.curves[d.k].color))
            .attr("stroke", cfg.hc.on ? cfg.hc.background : WHITE)
            .attr("stroke-width", 1.5)
            .attr("pointer-events", "none");
    }

    private hideGuide(): void {
        this.layers.guide.selectAll("*").remove();
    }

    private tooltipAt(i: number): TooltipContent | undefined {
        const model = this.model;
        const cfg = this.cfg;
        if (!model || !cfg || i < 0) {
            return undefined;
        }
        const items: VisualTooltipDataItem[] = [{ displayName: model.axis.name, value: model.axis.labels[i] }];
        const ids: ISelectionId[] = [];
        const fmt = model.formats.value;
        const single = model.curves.length === 1;
        for (const curve of model.curves) {
            const p = curve.points[i];
            if (!p || p.value === null) {
                continue;
            }
            ids.push(p.id);
            let text = fmt(p.value);
            if (p.lower !== null && p.upper !== null && !single) {
                text += ` (${fmt(p.lower)} – ${fmt(p.upper)})`;
            }
            if (p.low && !single) {
                text += ` · ${cfg.low.legendText || this.strings("Low_Default")}`;
            }
            items.push({ displayName: curve.name, value: text, color: curve.color });
            if (single) {
                this.pointDetails(model, cfg, p, items);
            } else {
                for (const t of p.tooltips) {
                    items.push({ displayName: `${curve.name} · ${t.name}`, value: t.value });
                }
            }
        }
        return items.length > 1 ? { items, ids } : undefined;
    }

    /** Detalhes do ponto quando há uma curva só. */
    private pointDetails(model: CurvesModel, cfg: CurvesConfig, p: Point, items: VisualTooltipDataItem[]): void {
        const fmt = model.formats.value;
        if (p.lower !== null && p.upper !== null) {
            items.push({ displayName: this.strings("Tooltip_Interval"), value: `${fmt(p.lower)} – ${fmt(p.upper)}` });
        }
        if (model.names.confidence && p.confidence !== null) {
            items.push({ displayName: model.names.confidence, value: model.formats.confidence(p.confidence) });
        }
        if (p.low) {
            items.push({
                displayName: (cfg.low.legendText || this.strings("Low_Default")),
                value: `${model.formats.confidence(p.confidence)} < ${model.formats.confidence(p.threshold)}`
            });
        }
        for (const t of p.tooltips) {
            items.push({ displayName: t.name, value: t.value });
        }
    }

    private ariaLabel(model: CurvesModel, item: PointItem): string {
        const curve = model.curves[item.k];
        const label = this.strings("Aria_Point", `${model.axis.name} ${model.axis.labels[item.p.i]}`, curve.name, model.formats.value(item.p.value));
        return item.p.low ? `${label}, ${this.strings("Aria_Low")}` : label;
    }

    private focus(index: number): void {
        this.focusIndex = index;
        const item = index >= 0 ? this.focusables[index] : undefined;
        const layout = this.layout;
        const model = this.model;
        const data = item && layout && model ? [item] : [];
        const color = this.cfg?.hc.on ? this.cfg.hc.selected : DARK;
        this.layers.focus.selectAll<SVGCircleElement, PointItem>("circle")
            .data(data)
            .join("circle")
            .attr("class", "cv-focus")
            .attr("cx", d => (layout ? layout.x(d.p.x) : 0))
            .attr("cy", d => (layout ? layout.y(d.p.value as number) : 0))
            .attr("r", 7)
            .attr("stroke", color)
            .attr("stroke-width", 2)
            .attr("aria-label", d => (model ? this.ariaLabel(model, d) : ""));
        if (item && model) {
            this.live.textContent = this.ariaLabel(model, item);
            this.showGuide(item.p.i);
        }
    }

    /** Esmaece o que não está selecionado, a série fora de destaque e o que outro visual não destacou. */
    public paintSelection(): void {
        const model = this.model;
        const cfg = this.cfg;
        const layout = this.layout;
        if (!model || !cfg || !layout) {
            return;
        }
        const has = this.selection.hasSelection;
        const highlighted = cfg.highlightSeries.trim().toLowerCase();
        const focusCurve = highlighted ? model.curves.findIndex(c => c.name.toLowerCase() === highlighted) : -1;
        const selectedPoints: PointItem[] = [];
        const curveOn = model.curves.map((curve, k) => {
            const seriesSelected = this.selection.isSelected(curve.id);
            let anyPoint = false;
            for (const p of curve.points) {
                if (p.value !== null && this.selection.isSelected(p.id)) {
                    anyPoint = true;
                    selectedPoints.push({ k, p });
                }
            }
            return !has || seriesSelected || anyPoint;
        });
        const opacity = (k: number): number => {
            let o = curveOn[k] ? 1 : cfg.dim;
            if (focusCurve >= 0 && k !== focusCurve) {
                o *= cfg.othersOpacity;
            }
            if (model.hasHighlights && !model.curves[k].points.some(p => p.highlighted)) {
                o *= cfg.dim;
            }
            return o;
        };
        const lowFade = cfg.low.style === "faded" ? 0.35 : 1;
        this.layers.curves.selectAll<SVGPathElement, SegmentItem>("path")
            .attr("opacity", d => opacity(d.k) * (d.segment.low ? lowFade : 1));
        this.layers.bands.selectAll<SVGPathElement, { k: number }>("path").attr("opacity", d => opacity(d.k));
        this.layers.marks.selectAll<SVGLineElement, PointItem>("line").attr("opacity", d => opacity(d.k));
        this.layers.points.selectAll<SVGCircleElement, PointItem>("circle").attr("opacity", d => opacity(d.k));
        this.layers.endLabels.selectAll<SVGTextElement, { curve: number }>("text").attr("opacity", d => opacity(d.curve));
        this.layers.milestoneLabels.selectAll<SVGTextElement, { k: number }>("text").attr("opacity", d => opacity(d.k));
        const hc = cfg.hc;
        this.layers.selected.selectAll<SVGCircleElement, PointItem>("circle")
            .data(selectedPoints, d => `${d.k}:${d.p.i}`)
            .join("circle")
            .attr("cx", d => layout.x(d.p.x))
            .attr("cy", d => layout.y(d.p.value as number))
            .attr("r", 4.5)
            .attr("fill", d => (hc.on ? hc.selected : model.curves[d.k].color))
            .attr("stroke", hc.on ? hc.background : WHITE)
            .attr("stroke-width", 1.5)
            .attr("pointer-events", "none");
        this.legend.querySelectorAll<HTMLElement>(".cv-legend-item[data-curve]").forEach(node => {
            node.style.opacity = String(opacity(Number(node.dataset.curve)));
        });
    }
}
