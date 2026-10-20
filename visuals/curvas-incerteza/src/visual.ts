"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import { CHART_PALETTE, contrastColors, themeColor } from "../../common/src/colors";
import { FormatterFactory, createFormatterFactory, labelOf } from "../../common/src/format";
import { Strings, createStrings } from "../../common/src/i18n";
import { SelectionHelper } from "../../common/src/selection";
import { TooltipHelper } from "../../common/src/tooltip";
import { parseOptionalNumber } from "../../common/src/values";
import { CurvesConfig, computeLayout } from "./layout";
import { CurvesRenderer } from "./render";
import { LINE_STYLE_ITEMS, VisualFormattingSettingsModel, enumValue } from "./settings";
import { CurvesDeps, CurvesResult, CurvesSettings, Interpolation, LineStyle, MAX_POINTS, buildCurvesModel } from "./viewModel";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import DataView = powerbi.DataView;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, isFinite(v) ? v : lo));

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private strings: Strings;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private selection: SelectionHelper;
    private renderer: CurvesRenderer;
    private result: CurvesResult | undefined;
    private lastDataView: DataView | undefined;
    private format: FormatterFactory;
    private locale = "pt-BR";

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.strings = createStrings(this.host);
        this.formattingSettingsService = new FormattingSettingsService(this.host.createLocalizationManager());
        this.formattingSettings = new VisualFormattingSettingsModel();
        this.format = createFormatterFactory(this.locale);
        this.selection = new SelectionHelper(this.host, () => this.renderer.paintSelection());
        this.renderer = new CurvesRenderer(options.element, this.selection, new TooltipHelper(this.host.tooltipService), this.strings);
    }

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            const dataView = options.dataViews?.[0];
            // Redimensionar só recalcula o layout; o modelo só muda com dados (ou formatação) novos.
            const dataChanged = (options.type & powerbi.VisualUpdateType.Data) !== 0 || dataView !== this.lastDataView || !this.result;
            if (dataChanged) {
                this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
                this.locale = this.host.locale || "pt-BR";
                this.format = createFormatterFactory(this.locale);
                this.result = buildCurvesModel(dataView?.categorical, this.modelSettings(), this.deps(dataView));
                this.lastDataView = dataView;
            }
            this.draw(options.viewport.width, options.viewport.height);
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, e instanceof Error ? e.message : String(e));
        }
    }

    private draw(width: number, height: number): void {
        const result = this.result;
        if (!result?.model) {
            const names: Record<string, string> = { x: this.strings("Role_X"), value: this.strings("Role_Value") };
            this.renderer.renderEmpty(this.strings("Visual_Name"), (result?.missing || ["x", "value"]).map(k => names[k] || k));
            return;
        }
        const model = result.model;
        const cfg = this.config();
        const notes: string[] = [];
        if (model.hiddenCount > 0) {
            notes.push(this.strings("Note_HiddenSeries", model.hiddenCount));
        }
        if (model.truncated.points) {
            notes.push(this.strings("Note_TruncatedPoints", MAX_POINTS));
        }
        if (model.duplicates) {
            notes.push(this.strings("Note_Duplicates"));
        }
        const blank = this.strings("Blank");
        const xFormat = model.axis.format || (model.axis.kind === "date" ? "MMM yyyy" : undefined);
        const xLabel = (v: number): string => labelOf(model.axis.kind === "date" ? new Date(v) : v, xFormat, this.locale, blank);
        this.renderer.render(model, cfg, (w, h) => computeLayout(model, cfg, w, h, xLabel), width, height, notes);
    }

    // ------------------------------------------------------------- painel -> modelo

    private modelSettings(): CurvesSettings {
        const s = this.formattingSettings;
        const ref = s.referenceCard;
        const windows = s.windowsCard;
        const milestones = s.milestonesCard.values.value || "";
        return {
            interpolation: enumValue(s.linesCard.interpolation) as Interpolation | "auto",
            threshold: s.lowConfidenceCard.threshold.value,
            referenceConstant: ref.useConstant.value ? ref.constant.value : null,
            maxSeries: clamp(s.linesCard.maxSeries.value, 1, 30),
            windows: {
                source: enumValue(windows.source) === "fixed" ? "fixed" : "field",
                start: parseOptionalNumber(windows.start.value),
                end: parseOptionalNumber(windows.end.value)
            },
            milestones: milestones.split(";").map(t => t.trim()).filter(t => t !== ""),
            y: {
                startAtZero: s.yAxisCard.startAtZero.value,
                min: parseOptionalNumber(s.yAxisCard.min.value),
                max: parseOptionalNumber(s.yAxisCard.max.value)
            },
            x: { min: parseOptionalNumber(s.xAxisCard.min.value), max: parseOptionalNumber(s.xAxisCard.max.value) }
        };
    }

    private deps(dataView: DataView | undefined): CurvesDeps {
        const categorical = dataView?.categorical;
        const category = categorical?.categories?.[0];
        const values = categorical?.values;
        const palette = this.host.colorPalette;
        const useTheme = this.formattingSettings.linesCard.themeColors.value;
        const blank = this.strings("Blank");
        const locale = this.locale;
        const staticObjects = dataView?.metadata?.objects?.["dataColors"];
        const objectsOf = (group: powerbi.DataViewValueColumnGroup | undefined): powerbi.DataViewObject | undefined =>
            group ? group.objects?.["dataColors"] : staticObjects;
        return {
            format: (format, sample) => this.format(format, sample),
            label: (value, format) => labelOf(value, format, locale, blank),
            pointId: (i, group) => {
                const builder = this.host.createSelectionIdBuilder();
                if (category) {
                    builder.withCategory(category, i);
                }
                if (group && values) {
                    builder.withSeries(values, group);
                }
                return builder.createSelectionId();
            },
            seriesId: group => this.host.createSelectionIdBuilder().withSeries(values as powerbi.DataViewValueColumns, group).createSelectionId(),
            seriesColor: (group, k, name) => {
                const fill = objectsOf(group)?.["fill"] as powerbi.Fill | undefined;
                const fallback = CHART_PALETTE[k % CHART_PALETTE.length];
                return fill?.solid?.color || (useTheme ? themeColor(palette, name, fallback) : fallback);
            },
            seriesStyle: group => {
                const style = String(objectsOf(group)?.["lineStyle"] ?? "solid");
                return (["solid", "dashed", "dotted"].includes(style) ? style : "solid") as LineStyle;
            }
        };
    }

    private config(): CurvesConfig {
        const s = this.formattingSettings;
        const model = this.result?.model;
        const lines = s.linesCard;
        const axis = (card: typeof s.xAxisCard, defaultTitle: string): CurvesConfig["x"] => ({
            show: card.show.value,
            title: card.title.value ? (card.titleText.value || defaultTitle) : "",
            grid: card.grid.value,
            gridColor: card.gridColor.value.value,
            gridOpacity: clamp(card.gridOpacity.value, 0, 100) / 100,
            fontSize: clamp(card.fontSize.value, 6, 40),
            fontColor: card.fontColor.value.value
        });
        const ref = s.referenceCard;
        const ms = s.milestonesCard;
        const labels = s.labelsCard;
        const legend = s.legendCard;
        const position = enumValue(legend.position);
        return {
            font: lines.fontFamily.value,
            lineWidth: clamp(lines.width.value, 0.5, 12),
            dim: clamp(lines.dimOpacity.value, 0, 100) / 100,
            othersOpacity: clamp(lines.othersOpacity.value, 0, 100) / 100,
            highlightSeries: lines.highlightSeries.value || "",
            showPoints: lines.showPoints.value,
            showMarks: lines.showMarks.value,
            markSize: clamp(lines.markSize.value, 2, 30),
            band: {
                show: s.bandCard.show.value,
                opacity: clamp(s.bandCard.opacity.value, 0, 100) / 100,
                sameColor: s.bandCard.sameColor.value,
                color: s.bandCard.color.value.value
            },
            low: {
                style: enumValue(s.lowConfidenceCard.style) as CurvesConfig["low"]["style"],
                legendText: s.lowConfidenceCard.legendText.value,
                showInLegend: s.lowConfidenceCard.showInLegend.value
            },
            windows: {
                show: s.windowsCard.show.value,
                color: s.windowsCard.color.value.value,
                opacity: clamp(s.windowsCard.opacity.value, 0, 100) / 100,
                label: s.windowsCard.label.value
            },
            milestones: {
                showLines: ms.showLines.value,
                showLabels: ms.showLabels.value,
                showTable: ms.showTable.value,
                color: ms.color.value.value,
                fontSize: clamp(ms.fontSize.value, 6, 40)
            },
            reference: {
                show: ref.show.value,
                label: ref.label.value,
                showValue: ref.showValue.value,
                color: ref.color.value.value,
                style: enumValue(ref.style) as LineStyle,
                width: clamp(ref.width.value, 0.5, 10)
            },
            x: axis(s.xAxisCard, model?.axis.name || ""),
            y: axis(s.yAxisCard, model?.names.value || ""),
            yFixed: [parseOptionalNumber(s.yAxisCard.min.value) !== null, parseOptionalNumber(s.yAxisCard.max.value) !== null],
            labels: {
                endValue: labels.endValue.value,
                endName: labels.endName.value,
                fontSize: clamp(labels.fontSize.value, 6, 40),
                color: labels.color.value.value,
                useSeriesColor: labels.useSeriesColor.value
            },
            legend: {
                show: legend.show.value,
                position: position === "bottom" ? "bottom" : position === "right" ? "right" : "top",
                title: legend.showTitle.value ? (legend.titleText.value || model?.names.series || "") : "",
                fontSize: clamp(legend.fontSize.value, 6, 40),
                fontColor: legend.fontColor.value.value
            },
            hc: contrastColors(this.host.colorPalette)
        };
    }

    // ------------------------------------------------------------- painel de formatação

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        const model = this.result?.model;
        const lines = s.linesCard;
        lines.othersOpacity.visible = !!lines.highlightSeries.value;
        lines.markSize.visible = lines.showMarks.value;
        s.bandCard.color.visible = !s.bandCard.sameColor.value;
        const fixed = enumValue(s.windowsCard.source) === "fixed";
        s.windowsCard.start.visible = s.windowsCard.end.visible = fixed;
        s.referenceCard.constant.visible = s.referenceCard.useConstant.value;
        for (const card of [s.xAxisCard, s.yAxisCard]) {
            card.titleText.visible = card.title.value;
            card.gridColor.visible = card.gridOpacity.visible = card.grid.value;
        }
        // Mínimo e máximo do eixo X só valem para eixo numérico.
        s.xAxisCard.min.visible = s.xAxisCard.max.visible = !model || model.axis.kind === "number";
        s.legendCard.titleText.visible = s.legendCard.showTitle.value;
        s.labelsCard.color.visible = !s.labelsCard.useSeriesColor.value;

        const cards = s.cards.slice();
        if (model?.curves.length) {
            const slices: formattingSettings.Slice[] = [];
            for (const curve of model.curves) {
                // Sem campo Série, a cor fica nos objetos do visual (seletor vazio).
                const selector = model.hasSeries ? curve.selector : undefined;
                slices.push(new formattingSettings.ColorPicker({
                    name: "fill",
                    displayName: curve.name,
                    value: { value: curve.color },
                    selector
                }));
                slices.push(new formattingSettings.ItemDropdown({
                    name: "lineStyle",
                    displayName: `${curve.name}: estilo`,
                    items: LINE_STYLE_ITEMS,
                    value: LINE_STYLE_ITEMS.find(i => i.value === curve.style) || LINE_STYLE_ITEMS[0],
                    selector
                }));
            }
            class ColorsCard extends formattingSettings.SimpleCard {
                name = "dataColors";
                displayName = "Cores e estilo das séries";
                slices = slices;
            }
            // Logo depois de "Linhas".
            s.cards = [cards[0], new ColorsCard(), ...cards.slice(1)];
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(s);
        s.cards = cards;
        return formattingModel;
    }
}
