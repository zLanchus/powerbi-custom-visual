"use strict";

import { Axis, AxisDomain, AxisScale, axisBottom, axisLeft, axisRight, axisTop } from "d3-axis";
import { Selection } from "d3-selection";

import { textWidth } from "./format";

export type Orient = "left" | "right" | "top" | "bottom";

export interface AxisStyle {
    fontSize: number;
    fontFamily: string;
    textColor: string;
    lineColor: string;
    /** Mostra a linha do eixo (domínio). */
    showLine: boolean;
}

/** Quantos tiques cabem num eixo com `length` px. */
export function tickCount(length: number, spacing = 48): number {
    return Math.max(2, Math.min(10, Math.floor(length / spacing)));
}

function axisFor<D extends AxisDomain>(orient: Orient, scale: AxisScale<D>): Axis<D> {
    switch (orient) {
        case "left": return axisLeft(scale);
        case "right": return axisRight(scale);
        case "top": return axisTop(scale);
        default: return axisBottom(scale);
    }
}

/** Desenha um eixo com d3-axis e aplica o estilo do painel (atributos, sem CSS injetado). */
export function renderAxis<D extends AxisDomain>(
    g: Selection<SVGGElement, unknown, null, undefined>,
    scale: AxisScale<D>,
    orient: Orient,
    style: AxisStyle,
    options: { ticks?: number; tickValues?: D[]; format?: (d: D) => string; tickSize?: number }
): void {
    const axis = axisFor(orient, scale)
        .tickSizeOuter(0)
        .tickSizeInner(options.tickSize ?? 4)
        .tickPadding(6);
    if (options.tickValues) {
        axis.tickValues(options.tickValues);
    } else if (options.ticks !== undefined) {
        axis.ticks(options.ticks);
    }
    if (options.format) {
        axis.tickFormat(options.format);
    }
    g.call(axis);
    g.attr("font-family", style.fontFamily).attr("font-size", style.fontSize);
    g.selectAll<SVGTextElement, D>(".tick text").attr("fill", style.textColor);
    g.selectAll<SVGLineElement, D>(".tick line").attr("stroke", style.lineColor);
    g.select<SVGPathElement>(".domain")
        .attr("stroke", style.lineColor)
        .attr("display", style.showLine ? null : "none");
}

/** Linhas de grade do eixo de valores. */
export function renderGrid(
    g: Selection<SVGGElement, unknown, null, undefined>,
    ticks: number[],
    position: (v: number) => number,
    horizontal: boolean,
    length: number,
    color: string,
    show: boolean
): void {
    g.selectAll<SVGLineElement, number>("line")
        .data(show ? ticks : [])
        .join("line")
        .attr("x1", v => (horizontal ? 0 : position(v)))
        .attr("x2", v => (horizontal ? length : position(v)))
        .attr("y1", v => (horizontal ? position(v) : 0))
        .attr("y2", v => (horizontal ? position(v) : length))
        .attr("stroke", color)
        .attr("stroke-width", 1)
        .attr("shape-rendering", "crispEdges");
}

/** Maior largura dos rótulos de tique, para reservar a margem do eixo. */
export function maxLabelWidth(labels: string[], fontSize: number, fontFamily: string): number {
    let max = 0;
    for (const label of labels) {
        max = Math.max(max, textWidth(label, fontSize, fontFamily));
    }
    return Math.ceil(max);
}

/** Título de eixo (texto simples, girado no eixo vertical). */
export function renderAxisTitle(
    g: Selection<SVGGElement, unknown, null, undefined>,
    text: string,
    x: number,
    y: number,
    vertical: boolean,
    style: AxisStyle
): void {
    g.selectAll<SVGTextElement, string>("text")
        .data(text ? [text] : [])
        .join("text")
        .attr("class", "cv-axis-title")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-family", style.fontFamily)
        .attr("font-size", style.fontSize)
        .attr("font-weight", 600)
        .attr("fill", style.textColor)
        .attr("transform", vertical ? `translate(${x},${y}) rotate(-90)` : `translate(${x},${y})`)
        .text(d => d);
}
