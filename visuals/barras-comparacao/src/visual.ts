"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import { CHART_PALETTE, contrastColors, themeColor } from "../../common/src/colors";
import { FormatterFactory, createFormatterFactory, labelOf } from "../../common/src/format";
import { Strings, createStrings } from "../../common/src/i18n";
import { SelectionHelper } from "../../common/src/selection";
import { TooltipHelper } from "../../common/src/tooltip";
import { BarsConfig, LineStyle, MarkerShape, computeLayout } from "./layout";
import { BarsRenderer } from "./render";
import { VisualFormattingSettingsModel, enumValue } from "./settings";
import {
    BarsDeps, BarsResult, BarsSettings, ColorRule, LowStyle, MAX_CATEGORIES, MAX_SERIES, SortOrder, buildBarsModel
} from "./viewModel";

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
    private renderer: BarsRenderer;
    private result: BarsResult | undefined;
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
        this.renderer = new BarsRenderer(options.element, this.selection, new TooltipHelper(this.host.tooltipService), this.strings);
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
                this.result = buildBarsModel(dataView?.categorical, this.modelSettings(), this.deps(dataView));
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
            const names: Record<string, string> = { category: this.strings("Role_Category"), value: this.strings("Role_Value") };
            this.renderer.renderEmpty(this.strings("Visual_Name"), (result?.missing || ["category", "value"]).map(k => names[k] || k));
            return;
        }
        const model = result.model;
        const cfg = this.config();
        const notes: string[] = [];
        if (model.truncated.categories) {
            notes.push(this.strings("Note_TruncatedCategories", MAX_CATEGORIES));
        }
        if (model.truncated.series) {
            notes.push(this.strings("Note_TruncatedSeries", MAX_SERIES));
        }
        const valueText = (v: number): string => model.formats.value(v);
        this.renderer.render(model, cfg, (w, h) => computeLayout(model, cfg, w, h, valueText), width, height, notes);
    }

    // ------------------------------------------------------------- painel -> modelo

    private modelSettings(): BarsSettings {
        const s = this.formattingSettings;
        const rule = s.colorRuleCard;
        const ref = s.referenceCard;
        const top = s.topNCard;
        return {
            rule: enumValue(rule.rule) as ColorRule,
            colors: {
                normal: rule.normalColor.value.value,
                above: rule.aboveColor.value.value,
                below: rule.belowColor.value.value,
                flag: rule.flagColor.value.value,
                low: s.lowConfidenceCard.color.value.value,
                gradientMin: rule.gradientMin.value.value,
                gradientMax: rule.gradientMax.value.value
            },
            lowStyle: enumValue(s.lowConfidenceCard.style) as LowStyle,
            threshold: s.lowConfidenceCard.threshold.value,
            referenceConstant: ref.useConstant.value ? ref.constant.value : null,
            sort: enumValue(s.sortCard.order) as SortOrder,
            lowLast: s.sortCard.lowLast.value,
            topN: top.show.value ? Math.max(1, Math.round(top.count.value)) : null
        };
    }

    private deps(dataView: DataView | undefined): BarsDeps {
        const categorical = dataView?.categorical;
        const category = categorical?.categories?.[0];
        const values = categorical?.values;
        const palette = this.host.colorPalette;
        const useTheme = this.formattingSettings.colorRuleCard.themeColors.value;
        const blank = this.strings("Blank");
        const locale = this.locale;
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
                const fill = group.objects?.["dataColors"]?.["fill"] as powerbi.Fill | undefined;
                const fallback = CHART_PALETTE[k % CHART_PALETTE.length];
                return fill?.solid?.color || (useTheme ? themeColor(palette, name, fallback) : fallback);
            },
            compare: (a, b) => a.localeCompare(b, locale, { numeric: true, sensitivity: "base" })
        };
    }

    private config(): BarsConfig {
        const s = this.formattingSettings;
        const model = this.result?.model;
        const layout = s.layoutCard;
        const axes = s.axesCard;
        const labels = s.dataLabelsCard;
        const legend = s.legendCard;
        const ref = s.referenceCard;
        const low = s.lowConfidenceCard;
        const markers = s.markersCard;
        const marker = (g: typeof markers.marker1): BarsConfig["markers"][number] => ({
            shape: enumValue(g.shape) as MarkerShape,
            size: clamp(g.size.value, 4, 40),
            color: g.color.value.value,
            showLabel: g.showLabel.value
        });
        return {
            font: layout.fontFamily.value,
            orientation: enumValue(layout.orientation) === "horizontal" ? "horizontal" : "vertical",
            card: layout.cardMode.value,
            gap: clamp(layout.gap.value, 0, 90) / 100,
            radius: clamp(layout.radius.value, 0, 40),
            labelWidthPct: clamp(layout.labelWidth.value, 5, 70),
            cardBarHeight: clamp(layout.cardBarHeight.value, 2, 40),
            dim: clamp(layout.dimOpacity.value, 0, 100) / 100,
            rule: enumValue(s.colorRuleCard.rule) as ColorRule,
            colors: {
                above: s.colorRuleCard.aboveColor.value.value,
                below: s.colorRuleCard.belowColor.value.value,
                flag: s.colorRuleCard.flagColor.value.value
            },
            markers: [marker(markers.marker1), marker(markers.marker2)],
            reference: {
                show: ref.show.value,
                label: ref.label.value,
                showValue: ref.showValue.value,
                color: ref.color.value.value,
                style: enumValue(ref.style) as LineStyle,
                width: clamp(ref.width.value, 0.5, 10)
            },
            low: {
                faded: enumValue(low.style) === "faded",
                color: low.color.value.value,
                legendText: low.legendText.value,
                showInLegend: low.showInLegend.value
            },
            labels: {
                show: labels.show.value,
                inside: enumValue(labels.position) === "inside",
                autoHide: labels.autoHide.value,
                fontSize: clamp(labels.fontSize.value, 6, 40),
                color: labels.color.value.value,
                bold: labels.bold.value
            },
            axes: {
                showValue: axes.showValueAxis.value,
                valueTitle: axes.valueTitle.value ? (axes.valueTitleText.value || model?.names.value || "") : "",
                categoryTitle: axes.categoryTitle.value ? (axes.categoryTitleText.value || model?.names.category || "") : "",
                grid: axes.grid.value,
                gridColor: axes.gridColor.value.value,
                gridOpacity: clamp(axes.gridOpacity.value, 0, 100) / 100,
                fontSize: clamp(axes.fontSize.value, 6, 40),
                fontColor: axes.fontColor.value.value,
                catFontSize: clamp(axes.categoryFontSize.value, 6, 40),
                catColor: axes.categoryColor.value.value,
                extraFontSize: clamp(axes.extraFontSize.value, 6, 40),
                extraColor: axes.extraColor.value.value
            },
            legend: {
                show: legend.show.value,
                bottom: enumValue(legend.position) === "bottom",
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
        const rule = s.colorRuleCard;
        const ruleValue = enumValue(rule.rule);
        const hasSeries = !!model?.hasSeries;
        rule.aboveColor.visible = rule.belowColor.visible = ruleValue === "aboveBelow" && !hasSeries;
        rule.gradientMin.visible = rule.gradientMax.visible = ruleValue === "gradient";
        rule.normalColor.visible = !hasSeries;
        rule.themeColors.visible = hasSeries;
        // Referência vazia com a regra acima/abaixo: as barras usam a cor padrão e o painel avisa.
        rule.warning.visible = !!model?.referenceMissing;
        rule.warning.value = model?.referenceMissing ? this.strings("Warn_NoReference") : "";
        rule.rule.description = model?.referenceMissing ? this.strings("Warn_NoReference") : undefined;

        const layout = s.layoutCard;
        const card = layout.cardMode.value;
        layout.cardBarHeight.visible = card;
        layout.orientation.visible = !card;
        layout.labelWidth.visible = card || enumValue(layout.orientation) === "horizontal";
        s.referenceCard.constant.visible = s.referenceCard.useConstant.value;
        s.topNCard.count.visible = s.topNCard.show.value;
        const axes = s.axesCard;
        axes.valueTitleText.visible = axes.valueTitle.value;
        axes.categoryTitleText.visible = axes.categoryTitle.value;
        axes.gridColor.visible = axes.gridOpacity.visible = axes.grid.value;
        s.lowConfidenceCard.color.visible = enumValue(s.lowConfidenceCard.style) === "hatched";
        s.legendCard.titleText.visible = s.legendCard.showTitle.value;

        const cards = s.cards.slice();
        if (model?.hasSeries && model.series.length) {
            const slices = model.series.map(series => new formattingSettings.ColorPicker({
                name: "fill",
                displayName: series.name,
                value: { value: series.color },
                selector: series.selector
            }));
            class ColorsCard extends formattingSettings.SimpleCard {
                name = "dataColors";
                displayName = "Cores das séries";
                slices = slices;
            }
            // Cores logo depois de "Regra de cor".
            s.cards = [cards[0], cards[1], new ColorsCard(), ...cards.slice(2)];
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(s);
        s.cards = cards;
        return formattingModel;
    }
}
