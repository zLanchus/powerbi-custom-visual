"use strict";

// Layout: margens, escalas, rolagem e o que cabe. Recalculado a cada redimensionamento,
// sem reconstruir o modelo de dados.

import { ScaleBand, ScaleLinear, scaleBand, scaleLinear } from "../../common/src/d3";

import { ContrastColors } from "../../common/src/colors";
import { textWidth } from "../../common/src/format";
import { tickCount } from "../../common/src/axes";
import { BarsModel, ColorRule } from "./viewModel";

export type MarkerShape = "circle" | "dash" | "diamond";
export type LineStyle = "dashed" | "solid" | "dotted";

/** Opções do painel já resolvidas (valores simples). */
export interface BarsConfig {
    font: string;
    orientation: "vertical" | "horizontal";
    card: boolean;
    gap: number;
    radius: number;
    labelWidthPct: number;
    cardBarHeight: number;
    dim: number;
    rule: ColorRule;
    colors: { above: string; below: string; flag: string };
    markers: Array<{ shape: MarkerShape; size: number; color: string; showLabel: boolean }>;
    reference: { show: boolean; label: string; showValue: boolean; color: string; style: LineStyle; width: number };
    low: { faded: boolean; color: string; legendText: string; showInLegend: boolean };
    labels: { show: boolean; inside: boolean; autoHide: boolean; fontSize: number; color: string; bold: boolean };
    axes: {
        showValue: boolean;
        valueTitle: string;
        categoryTitle: string;
        grid: boolean;
        gridColor: string;
        gridOpacity: number;
        fontSize: number;
        fontColor: string;
        catFontSize: number;
        catColor: string;
        extraFontSize: number;
        extraColor: string;
    };
    legend: { show: boolean; bottom: boolean; title: string; fontSize: number; fontColor: string };
    hc: ContrastColors;
}

export const MORE_KEY = "__more";

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface BarsLayout {
    mode: "vertical" | "horizontal" | "card";
    /** Faixa fixa do eixo de valores (coordenadas da área do gráfico). */
    axis: Rect & { show: boolean };
    /** Área rolável (coordenadas da área do gráfico). */
    scroll: Rect & { dir: "x" | "y" | null };
    /** Tamanho do SVG dentro da área rolável. */
    content: { w: number; h: number };
    /** Área de plotagem dentro do SVG rolável. */
    plot: Rect;
    keys: string[];
    band: ScaleBand<string>;
    sub: ScaleBand<string>;
    value: ScaleLinear<number, number>;
    ticks: number[];
    catLabel: { rotate: boolean; maxWidth: number; showExtra: boolean; x: number };
    valueTitle: { x: number; y: number } | null;
    categoryTitle: { x: number; y: number } | null;
}

/** Espessura mínima de uma faixa de categoria antes de ligar a rolagem. */
const MIN_STEP = 18;
const PAD = 6;

export function computeLayout(model: BarsModel, cfg: BarsConfig, width: number, height: number, valueText: (v: number) => string): BarsLayout {
    const keys = model.categories.map(c => c.key);
    if (model.hiddenCount > 0) {
        keys.push(MORE_KEY);
    }
    const seriesKeys = model.series.map((_, k) => String(k));
    const n = Math.max(1, keys.length);
    const minStep = Math.max(MIN_STEP, seriesKeys.length * 5 + 6);
    const font = cfg.font;
    const axes = cfg.axes;
    const labelsW = (cfg.labels.show && !cfg.labels.inside)
        ? Math.ceil(Math.max(0, ...model.categories.flatMap(c => c.bars.map(b => b.value === null ? 0
            : textWidth(valueText(b.value), cfg.labels.fontSize, font, cfg.labels.bold))))) + 6
        : 0;
    const hasExtra = model.categories.some(c => c.extra !== "");
    const hasNegative = model.domain[0] < 0;
    const catTexts = model.categories.map(c => c.label);
    const maxCatW = Math.ceil(Math.max(0, ...catTexts.map(t => textWidth(t, axes.catFontSize, font))));

    const mode: BarsLayout["mode"] = cfg.card ? "card" : cfg.orientation;
    const inner = (1 - cfg.gap) > 0 ? cfg.gap : 0.9;
    const value = scaleLinear().domain(model.domain);

    const tickLabels = (ticks: number[]): number =>
        Math.ceil(Math.max(0, ...ticks.map(t => textWidth(valueText(t), axes.fontSize, font))));

    if (mode === "vertical") {
        const top = PAD + (cfg.labels.show && !cfg.labels.inside ? cfg.labels.fontSize + 4 : 0);
        const valueTitleW = axes.valueTitle ? axes.fontSize + 8 : 0;
        const catTitleH = axes.categoryTitle ? axes.fontSize + 8 : 0;
        // Primeira estimativa da altura para os tiques do eixo.
        let catArea = axes.catFontSize + 8 + (hasExtra ? axes.extraFontSize + 4 : 0);
        const estimateH = Math.max(20, height - top - catArea - catTitleH - (hasNegative && cfg.labels.show ? cfg.labels.fontSize + 4 : 0));
        value.range([estimateH, 0]).nice(tickCount(estimateH));
        let ticks = value.ticks(tickCount(estimateH));
        const axisW = axes.showValue ? tickLabels(ticks) + 10 + valueTitleW : valueTitleW + 2;
        const availW = Math.max(20, width - axisW - PAD);
        const contentW = Math.max(availW, n * minStep);
        const step = contentW / n;
        // Rótulos girados quando não cabem na faixa.
        const rotate = maxCatW > step - 4 && step < 60;
        let maxWidth = step - 4;
        let showExtra = hasExtra;
        if (rotate) {
            // Texto na vertical: ocupa só a altura da fonte na largura da faixa.
            catArea = Math.min(Math.max(axes.catFontSize + 8, height * 0.32), Math.min(maxCatW, 160) + 10);
            maxWidth = catArea - 10;
            showExtra = false;
        }
        const scrollbar = contentW > availW ? 10 : 0;
        const bottomNeg = hasNegative && cfg.labels.show && !cfg.labels.inside ? cfg.labels.fontSize + 4 : 0;
        const plotH = Math.max(10, height - top - catArea - catTitleH - scrollbar - bottomNeg);
        value.range([plotH, 0]).domain(model.domain).nice(tickCount(plotH));
        ticks = value.ticks(tickCount(plotH));
        const band = scaleBand<string>().domain(keys).range([0, contentW]).paddingInner(inner).paddingOuter(inner / 2);
        const sub = scaleBand<string>().domain(seriesKeys).range([0, band.bandwidth()]).paddingInner(seriesKeys.length > 1 ? 0.08 : 0);
        return {
            mode,
            axis: { show: true, x: 0, y: 0, w: axisW, h: height },
            scroll: { x: axisW, y: 0, w: width - axisW, h: height, dir: contentW > availW ? "x" : null },
            content: { w: contentW + PAD, h: height - scrollbar },
            plot: { x: 0, y: top, w: contentW, h: plotH },
            keys,
            band,
            sub,
            value,
            ticks,
            catLabel: { rotate, maxWidth, showExtra, x: 0 },
            valueTitle: axes.valueTitle ? { x: axes.fontSize / 2 + 2, y: top + plotH / 2 } : null,
            categoryTitle: axes.categoryTitle ? { x: contentW / 2, y: height - scrollbar - catTitleH / 2 } : null
        };
    }

    if (mode === "horizontal") {
        const catTitleW = axes.categoryTitle ? axes.fontSize + 8 : 0;
        // Rótulo da linha de referência única fica acima das barras.
        const refTop = cfg.reference.show && model.reference.present && model.reference.uniform ? cfg.labels.fontSize + 8 : 0;
        const labelCol = Math.min(maxCatW + 12, Math.max(40, width * cfg.labelWidthPct / 100));
        const axisH = (axes.showValue ? axes.fontSize + 10 : 2) + (axes.valueTitle ? axes.fontSize + 8 : 0);
        const availH = Math.max(20, height - axisH - PAD);
        const contentH = Math.max(availH, n * minStep + refTop);
        const scrollbar = contentH > availH ? 10 : 0;
        const leftNeg = hasNegative ? labelsW : 0;
        const plotX = catTitleW + labelCol + leftNeg;
        const plotW = Math.max(10, width - plotX - labelsW - PAD - scrollbar);
        value.range([0, plotW]).nice(tickCount(plotW, 70));
        const ticks = value.ticks(tickCount(plotW, 70));
        const band = scaleBand<string>().domain(keys).range([0, contentH - refTop]).paddingInner(inner).paddingOuter(inner / 2);
        const sub = scaleBand<string>().domain(seriesKeys).range([0, band.bandwidth()]).paddingInner(seriesKeys.length > 1 ? 0.08 : 0);
        const step = band.step();
        return {
            mode,
            axis: { show: true, x: 0, y: availH, w: width, h: axisH },
            scroll: { x: 0, y: 0, w: width, h: availH, dir: contentH > availH ? "y" : null },
            content: { w: width - scrollbar, h: contentH },
            plot: { x: plotX, y: refTop, w: plotW, h: contentH - refTop },
            keys,
            band,
            sub,
            value,
            ticks,
            catLabel: {
                rotate: false,
                maxWidth: labelCol - 10,
                showExtra: hasExtra && step >= axes.catFontSize + axes.extraFontSize + 6,
                x: catTitleW + labelCol - 8
            },
            valueTitle: axes.valueTitle ? { x: plotX + plotW / 2, y: axisH - axes.fontSize / 2 - 2 } : null,
            categoryTitle: axes.categoryTitle ? { x: axes.fontSize / 2 + 2, y: Math.min(contentH, availH) / 2 } : null
        };
    }

    // Modo cartão: rótulo à esquerda, barra fina, valor à direita, sem eixos.
    const rowMin = Math.max(cfg.cardBarHeight * Math.max(1, seriesKeys.length) + 12,
        axes.catFontSize + (hasExtra ? axes.extraFontSize + 4 : 0) + 10);
    const availH = Math.max(20, height - PAD);
    const contentH = Math.max(availH, n * rowMin / (1 - Math.min(0.6, cfg.gap) / 2));
    const scrollbar = contentH > availH ? 10 : 0;
    const labelCol = Math.max(40, width * cfg.labelWidthPct / 100);
    const valueCol = cfg.labels.show ? labelsW + 8 : PAD;
    const plotX = labelCol + 8;
    const plotW = Math.max(10, width - plotX - valueCol - scrollbar);
    value.range([0, plotW]);
    const band = scaleBand<string>().domain(keys).range([0, contentH]).paddingInner(Math.min(0.6, cfg.gap)).paddingOuter(0.1);
    const barsH = Math.min(band.bandwidth(), cfg.cardBarHeight * Math.max(1, seriesKeys.length) + (seriesKeys.length - 1) * 2);
    const offset = (band.bandwidth() - barsH) / 2;
    const sub = scaleBand<string>().domain(seriesKeys).range([offset, offset + barsH]).paddingInner(seriesKeys.length > 1 ? 0.2 : 0);
    return {
        mode,
        axis: { show: false, x: 0, y: 0, w: 0, h: 0 },
        scroll: { x: 0, y: 0, w: width, h: availH, dir: contentH > availH ? "y" : null },
        content: { w: width - scrollbar, h: contentH },
        plot: { x: plotX, y: 0, w: plotW, h: contentH },
        keys,
        band,
        sub,
        value,
        ticks: [],
        catLabel: { rotate: false, maxWidth: labelCol - 4, showExtra: hasExtra, x: 0 },
        valueTitle: null,
        categoryTitle: null
    };
}
