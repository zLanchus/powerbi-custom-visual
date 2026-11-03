"use strict";

// Layout: margens, escalas, tiques e rótulos do fim das curvas. Recalculado a cada
// redimensionamento, sem reconstruir o modelo de dados.

import { ScaleLinear, ScaleTime, scaleLinear, scaleTime } from "../../common/src/d3";
import { ContrastColors } from "../../common/src/colors";
import { textWidth } from "../../common/src/format";
import { tickCount } from "../../common/src/axes";
import { CurvesModel, LineStyle } from "./viewModel";

export interface AxisConfig {
    show: boolean;
    title: string;
    grid: boolean;
    gridColor: string;
    gridOpacity: number;
    fontSize: number;
    fontColor: string;
}

/** Opções do painel já resolvidas (valores simples). */
export interface CurvesConfig {
    font: string;
    lineWidth: number;
    dim: number;
    othersOpacity: number;
    highlightSeries: string;
    showPoints: boolean;
    showMarks: boolean;
    markSize: number;
    band: { show: boolean; opacity: number; sameColor: boolean; color: string };
    low: { style: "dashed" | "faded" | "hidden"; legendText: string; showInLegend: boolean };
    windows: { show: boolean; color: string; opacity: number; label: string };
    milestones: { showLines: boolean; showLabels: boolean; showTable: boolean; color: string; fontSize: number };
    reference: { show: boolean; label: string; showValue: boolean; color: string; style: LineStyle; width: number };
    x: AxisConfig;
    y: AxisConfig;
    /** Mínimo e máximo do eixo Y digitados no painel (não são arredondados). */
    yFixed: [boolean, boolean];
    labels: { endValue: boolean; endName: boolean; fontSize: number; color: string; useSeriesColor: boolean };
    legend: { show: boolean; position: "top" | "bottom" | "right"; title: string; fontSize: number; fontColor: string };
    hc: ContrastColors;
}

export interface EndLabel {
    curve: number;
    text: string;
    x: number;
    y: number;
}

export interface CurvesLayout {
    width: number;
    height: number;
    plot: { x: number; y: number; w: number; h: number };
    /** Posição em px (dentro da área de plotagem) de um X do modelo. */
    x: (v: number) => number;
    xScale: ScaleLinear<number, number> | ScaleTime<number, number>;
    xTicks: Array<{ x: number; label: string }>;
    y: ScaleLinear<number, number>;
    yTicks: number[];
    endLabels: EndLabel[];
    xTitle: { x: number; y: number } | null;
    yTitle: { x: number; y: number } | null;
}

const PAD = 8;

export function endLabelText(model: CurvesModel, cfg: CurvesConfig, curveIndex: number): string {
    const curve = model.curves[curveIndex];
    const parts: string[] = [];
    if (cfg.labels.endName && model.hasSeries && model.curves.length <= 4) {
        parts.push(curve.name);
    }
    if (cfg.labels.endValue && curve.last) {
        parts.push(model.formats.value(curve.last.value));
    }
    return parts.join(" ");
}

export function computeLayout(
    model: CurvesModel,
    cfg: CurvesConfig,
    width: number,
    height: number,
    xLabel: (v: number) => string
): CurvesLayout {
    const font = cfg.font;
    const { kind, xs, labels, domain } = model.axis;

    // Margem direita: rótulos do fim das curvas.
    const endTexts = model.curves.map((_, k) => endLabelText(model, cfg, k));
    const endW = Math.ceil(Math.max(0, ...endTexts.map(t => (t ? textWidth(t, cfg.labels.fontSize, font, true) : 0))));
    // Rótulos das pontas do eixo X não podem ser cortados.
    const edgeW = (label: string): number => (cfg.x.show && label ? textWidth(label, cfg.x.fontSize, font) / 2 + 2 : 0);
    const firstLabel = kind === "text" ? labels[0] : xLabel(domain[0]);
    const lastLabel = kind === "text" ? labels[labels.length - 1] : xLabel(domain[1]);
    const right = Math.max(endW > 0 ? Math.min(width * 0.35, endW + 10) : PAD + 4, edgeW(lastLabel));
    const windowLabel = cfg.windows.show && cfg.windows.label && model.windows.length > 0;
    const top = PAD + (windowLabel ? cfg.milestones.fontSize + 6 : 0);
    const bottom = (cfg.x.show ? cfg.x.fontSize + 12 : 4) + (cfg.x.title ? cfg.x.fontSize + 8 : 0);

    const yTitleW = cfg.y.title ? cfg.y.fontSize + 8 : 0;
    const estimateH = Math.max(20, height - top - bottom);
    const y = scaleLinear().domain(model.yDomain).range([estimateH, 0]).nice(tickCount(estimateH, 40));
    // Mínimo e máximo fixos não são arredondados.
    const [niceMin, niceMax] = y.domain();
    y.domain([cfg.yFixed[0] ? model.yDomain[0] : niceMin, cfg.yFixed[1] ? model.yDomain[1] : niceMax]);
    let yTicks = y.ticks(tickCount(estimateH, 40));
    const yLabelW = cfg.y.show ? Math.ceil(Math.max(0, ...yTicks.map(t => textWidth(model.formats.value(t), cfg.y.fontSize, font)))) + 8 : 2;
    const left = Math.max(yLabelW + yTitleW + 2, edgeW(firstLabel));
    const plot = { x: left, y: top, w: Math.max(10, width - left - right), h: Math.max(10, height - top - bottom) };
    y.range([plot.h, 0]);
    yTicks = y.ticks(tickCount(plot.h, 40));

    // Eixo X: contínuo para número e data; texto na ordem do modelo, com espaçamento igual.
    let xScale: ScaleLinear<number, number> | ScaleTime<number, number>;
    let xTicks: Array<{ x: number; label: string }>;
    if (kind === "date") {
        const scale = scaleTime().domain([new Date(domain[0]), new Date(domain[1])]).range([0, plot.w]);
        xScale = scale;
        const count = tickCount(plot.w, 90);
        xTicks = scale.ticks(count).map(d => ({ x: d.getTime(), label: xLabel(d.getTime()) }));
    } else if (kind === "number") {
        const scale = scaleLinear().domain(domain).range([0, plot.w]);
        xScale = scale;
        const widest = Math.max(...[domain[0], domain[1]].map(v => textWidth(xLabel(v), cfg.x.fontSize, font)), 10);
        let ticks = scale.ticks(tickCount(plot.w, Math.max(36, widest + 14)));
        if (model.axis.integer) {
            ticks = ticks.filter(t => Number.isInteger(t));
        }
        xTicks = ticks.map(t => ({ x: t, label: xLabel(t) }));
    } else {
        const n = xs.length;
        const scale = scaleLinear().domain(n > 1 ? [0, n - 1] : [-0.5, 0.5]).range([0, plot.w]);
        xScale = scale;
        const widest = Math.max(10, ...labels.map(l => textWidth(l, cfg.x.fontSize, font)));
        const step = n > 1 ? plot.w / (n - 1) : plot.w;
        const every = Math.max(1, Math.ceil((widest + 10) / step));
        xTicks = labels.map((label, i) => ({ x: i, label })).filter((_, i) => i % every === 0);
    }
    const x = (v: number): number => (kind === "date" ? (xScale as ScaleTime<number, number>)(new Date(v)) : (xScale as ScaleLinear<number, number>)(v));

    // Rótulos do fim: na altura do último ponto, afastados para não se sobreporem.
    const endLabels: EndLabel[] = [];
    model.curves.forEach((curve, k) => {
        const text = endTexts[k];
        if (text && curve.last && curve.last.value !== null) {
            endLabels.push({ curve: k, text, x: x(curve.last.x) + 6, y: y(curve.last.value) });
        }
    });
    endLabels.sort((a, b) => a.y - b.y);
    const gap = cfg.labels.fontSize + 2;
    for (let k = 1; k < endLabels.length; k++) {
        if (endLabels[k].y - endLabels[k - 1].y < gap) {
            endLabels[k].y = endLabels[k - 1].y + gap;
        }
    }
    const overflow = endLabels.length ? endLabels[endLabels.length - 1].y - plot.h : 0;
    if (overflow > 0) {
        for (const label of endLabels) {
            label.y -= overflow;
        }
    }

    return {
        width,
        height,
        plot,
        x,
        xScale,
        xTicks,
        y,
        yTicks,
        endLabels,
        xTitle: cfg.x.title ? { x: plot.x + plot.w / 2, y: height - cfg.x.fontSize / 2 - 2 } : null,
        yTitle: cfg.y.title ? { x: cfg.y.fontSize / 2 + 2, y: plot.y + plot.h / 2 } : null
    };
}
