"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
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

import { VisualFormattingSettingsModel, enumValue } from "./settings";

/** Uma medida lida do Power BI, com o formatador dela. */
interface Measure {
    name: string;
    value: PrimitiveValue;
    number: number | undefined;
    format: (v: PrimitiveValue) => string;
    formatString: string | undefined;
}

interface Model {
    main: Measure | undefined;
    period: string;
    comparisons: Measure[];
    detailTop: Measure | undefined;
    detailBottom: Measure | undefined;
}

type Tone = "good" | "bad" | "neutral";

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

function toNumber(value: PrimitiveValue): number | undefined {
    return typeof value === "number" && isFinite(value) ? value : undefined;
}

function isBlank(value: PrimitiveValue): boolean {
    return value === null || value === undefined || value === "";
}

const UNIT_VALUES: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private model: Model | undefined;
    private locale = "pt-BR";
    private width = 0;
    private height = 0;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "cc-root");
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI.
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
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
            this.model = this.buildModel(dataView);
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const c = this.formattingSettings.comparisonCard;
        const byResult = c.colorByResult.value;
        c.positiveColor.visible = c.negativeColor.visible = c.neutralColor.visible = c.higherIsBetter.visible = byResult;
        c.valueColor.visible = !byResult;
        c.dividerColor.visible = c.dividers.value;
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    // ------------------------------------------------------------- dados

    private measure(column: DataViewValueColumn | undefined, units?: number): Measure | undefined {
        if (!column) {
            return undefined;
        }
        const value = column.values[0];
        const formatter = valueFormatter.create({ format: column.source.format, value: units, cultureSelector: this.locale });
        return {
            name: column.source.displayName,
            value,
            number: toNumber(value),
            format: v => formatter.format(v),
            formatString: column.source.format
        };
    }

    private buildModel(dataView: DataView | undefined): Model | undefined {
        const values = dataView?.categorical?.values;
        if (!values || values.length === 0) {
            return undefined;
        }
        const columns = Array.from(values);
        const byRole = (role: string): DataViewValueColumn[] => columns.filter(c => c.source.roles?.[role]);

        const mainColumn = byRole("main")[0];
        const unit = enumValue(this.formattingSettings.mainCard.displayUnits);
        const mainNumber = toNumber(mainColumn?.values[0]);
        const units = unit === "auto" ? (mainNumber !== undefined ? Math.abs(mainNumber) : undefined) : UNIT_VALUES[unit];

        const periodColumn = byRole("period")[0];
        const periodValue = periodColumn?.values[0];
        let period = "";
        if (!isBlank(periodValue)) {
            period = typeof periodValue === "string"
                ? periodValue
                : valueFormatter.format(periodValue, periodColumn.source.format, false, this.locale);
        }

        return {
            main: this.measure(mainColumn, units),
            period,
            comparisons: byRole("comparisons").map(c => this.measure(c)).filter((m): m is Measure => !!m),
            detailTop: this.measure(byRole("detailTop")[0]),
            detailBottom: this.measure(byRole("detailBottom")[0])
        };
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        this.applyStyles();
        const model = this.model;

        if (!model?.main) {
            const empty = el("div", "cc-empty");
            empty.appendChild(el("div", "cc-empty-title", "Card Comparativo"));
            empty.appendChild(el("div", "cc-empty-text",
                "Coloque uma medida em Valor principal e as medidas de comparação (meta, mês anterior…) em Comparações."));
            root.appendChild(empty);
            return;
        }

        const layout = enumValue(this.formattingSettings.cardCard.layout);
        const vertical = layout === "vertical" || (layout === "auto" && this.width < 460);
        root.classList.toggle("cc-vertical", vertical);

        root.appendChild(this.renderMain(model));
        if (model.comparisons.length) {
            root.appendChild(this.renderComparisons(model));
        }
        if (model.detailTop || model.detailBottom) {
            root.appendChild(this.renderDetails(model));
        }
        this.fit();
    }

    private renderMain(model: Model): HTMLElement {
        const s = this.formattingSettings.mainCard;
        const main = model.main as Measure;
        const block = el("div", "cc-main");
        const title = s.title.value || main.name;
        if (title) {
            block.appendChild(el("div", "cc-title", title));
        }
        if (model.period) {
            block.appendChild(el("div", "cc-period", model.period));
        }
        block.appendChild(el("div", "cc-value", isBlank(main.value) ? "—" : main.format(main.value)));
        block.title = title + (model.period ? " · " + model.period : "");
        return block;
    }

    private renderComparisons(model: Model): HTMLElement {
        const c = this.formattingSettings.comparisonCard;
        const list = el("div", "cc-comps");
        list.classList.toggle("cc-dividers", c.dividers.value);
        list.classList.toggle("cc-label-left", enumValue(c.labelPosition) === "left");

        for (const comp of model.comparisons) {
            const row = el("div", "cc-row");
            const result = el("div", "cc-result");
            const label = el("div", "cc-label", comp.name);
            const main = model.main as Measure;

            if (main.number === undefined || comp.number === undefined) {
                const emptyText = (c.emptyText.value || "Não definido").replace(/\{nome\}/gi, comp.name);
                result.appendChild(el("span", "cc-empty-value", emptyText));
            } else {
                const { text, tone, delta } = this.compare(main, comp);
                result.dataset.tone = tone;
                if (c.showArrow.value && enumValue(c.mode) !== "value" && delta !== 0) {
                    result.appendChild(el("span", "cc-arrow", delta > 0 ? "▲" : "▼"));
                }
                result.appendChild(el("span", "cc-delta", text));
                if (c.showValue.value && enumValue(c.mode) !== "value") {
                    result.appendChild(el("span", "cc-ref", `(${comp.format(comp.value)})`));
                }
            }
            row.append(result, label);
            this.bindTooltip(row, model, comp);
            list.appendChild(row);
        }
        return list;
    }

    /** Texto e tom (bom/ruim) da comparação entre o valor principal e uma medida. */
    private compare(main: Measure, comp: Measure): { text: string; tone: Tone; delta: number } {
        const c = this.formattingSettings.comparisonCard;
        const mode = enumValue(c.mode);
        const a = main.number as number;
        const b = comp.number as number;
        const delta = a - b;
        const better = c.higherIsBetter.value ? delta > 0 : delta < 0;
        const tone: Tone = delta === 0 ? "neutral" : better ? "good" : "bad";
        const sign = (v: number): string => (v > 0 && c.showSign.value ? "+" : v < 0 ? "-" : "");

        // Diferença no formato da medida principal (em % se ela for %).
        const diffFormatter = valueFormatter.create({ format: main.formatString, cultureSelector: this.locale });
        const diffText = sign(delta) + diffFormatter.format(Math.abs(delta));
        const pctFormatter = valueFormatter.create({ format: "0.0%", cultureSelector: this.locale });
        const variation = b !== 0 ? a / b - 1 : undefined;
        const varText = variation === undefined ? "—" : sign(variation) + pctFormatter.format(Math.abs(variation));

        const text = mode === "variation" ? varText
            : mode === "both" ? `${diffText} · ${varText}`
                : mode === "value" ? comp.format(comp.value)
                    : diffText;
        return { text, tone, delta };
    }

    private renderDetails(model: Model): HTMLElement {
        const box = el("div", "cc-details");
        const add = (m: Measure | undefined, cls: string): void => {
            if (m) {
                const node = el("div", "cc-detail " + cls, isBlank(m.value) ? "—" : m.format(m.value));
                node.title = m.name;
                box.appendChild(node);
            }
        };
        add(model.detailTop, "cc-detail-top");
        if (model.detailTop && model.detailBottom) {
            box.appendChild(el("div", "cc-detail-line"));
        }
        add(model.detailBottom, "cc-detail-bottom");
        return box;
    }

    private bindTooltip(row: HTMLElement, model: Model, comp: Measure): void {
        const main = model.main as Measure;
        const items = (): VisualTooltipDataItem[] => {
            const list: VisualTooltipDataItem[] = [
                { displayName: main.name, value: main.format(main.value) },
                { displayName: comp.name, value: isBlank(comp.value) ? "(vazio)" : comp.format(comp.value) }
            ];
            if (main.number !== undefined && comp.number !== undefined) {
                const diffFormatter = valueFormatter.create({ format: main.formatString, cultureSelector: this.locale });
                const pct = valueFormatter.create({ format: "0.0%", cultureSelector: this.locale });
                list.push({ displayName: "Diferença", value: diffFormatter.format(main.number - comp.number) });
                if (comp.number !== 0) {
                    list.push({ displayName: "Variação %", value: pct.format(main.number / comp.number - 1) });
                }
            }
            if (model.period) {
                list.push({ displayName: "Período", value: model.period });
            }
            return list;
        };
        row.addEventListener("mouseenter", (e: MouseEvent) => {
            this.host.tooltipService.show({ coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: items(), identities: [] });
        });
        row.addEventListener("mousemove", (e: MouseEvent) => {
            this.host.tooltipService.move({ coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: items(), identities: [] });
        });
        row.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
    }

    /** Diminui tudo proporcionalmente quando o conteúdo não cabe no tamanho do visual. */
    private fit(): void {
        const root = this.root;
        // Blocos não podem estourar na altura; textos não podem ser cortados na largura.
        const blocks = Array.from(root.querySelectorAll<HTMLElement>(".cc-main, .cc-comps, .cc-details"));
        const texts = Array.from(root.querySelectorAll<HTMLElement>(".cc-title, .cc-period, .cc-value, .cc-result, .cc-label, .cc-detail"));
        const overflows = (): boolean => root.scrollHeight > root.clientHeight + 2
            || blocks.some(n => n.scrollHeight > n.clientHeight + 2)
            || texts.some(n => n.scrollWidth > n.clientWidth + 1);
        let scale = 1;
        root.style.setProperty("--cc-scale", "1");
        for (let i = 0; i < 10 && overflows(); i++) {
            scale *= 0.9;
            root.style.setProperty("--cc-scale", scale.toFixed(3));
        }
    }

    // ------------------------------------------------------------- estilos

    private applyStyles(): void {
        const st = this.root.style;
        const k = this.formattingSettings.cardCard;
        const m = this.formattingSettings.mainCard;
        const c = this.formattingSettings.comparisonCard;
        const d = this.formattingSettings.detailCard;
        const px = (v: number, min = 0): string => Math.max(min, v || 0) + "px";

        st.setProperty("--cc-font", k.fontFamily.value);
        st.setProperty("--cc-bg", k.background.value.value);
        st.setProperty("--cc-radius", px(k.radius.value));
        st.setProperty("--cc-bw", px(k.borderWidth.value));
        st.setProperty("--cc-bc", k.borderColor.value.value);
        st.setProperty("--cc-pad", px(k.padding.value));
        st.setProperty("--cc-gap", px(k.gap.value));

        st.setProperty("--cc-main-bg", m.fill.value.value);
        st.setProperty("--cc-main-radius", px(m.radius.value));
        st.setProperty("--cc-main-width", Math.min(80, Math.max(10, m.width.value || 32)) + "%");
        st.setProperty("--cc-main-align", enumValue(m.align) === "left" ? "flex-start" : "center");
        st.setProperty("--cc-main-text-align", enumValue(m.align) === "left" ? "left" : "center");
        st.setProperty("--cc-title-size", px(m.titleSize.value, 6));
        st.setProperty("--cc-title-color", m.titleColor.value.value);
        st.setProperty("--cc-title-case", m.titleUpper.value ? "uppercase" : "none");
        st.setProperty("--cc-period-size", px(m.periodSize.value, 6));
        st.setProperty("--cc-period-color", m.periodColor.value.value);
        st.setProperty("--cc-period-case", m.periodUpper.value ? "uppercase" : "none");
        st.setProperty("--cc-value-size", px(m.valueSize.value, 8));
        st.setProperty("--cc-value-color", m.valueColor.value.value);

        st.setProperty("--cc-good", c.colorByResult.value ? c.positiveColor.value.value : c.valueColor.value.value);
        st.setProperty("--cc-bad", c.colorByResult.value ? c.negativeColor.value.value : c.valueColor.value.value);
        st.setProperty("--cc-neutral", c.colorByResult.value ? c.neutralColor.value.value : c.valueColor.value.value);
        st.setProperty("--cc-result-size", px(c.valueSize.value, 6));
        st.setProperty("--cc-label-size", px(c.labelSize.value, 6));
        st.setProperty("--cc-label-color", c.labelColor.value.value);
        st.setProperty("--cc-label-weight", c.labelBold.value ? "600" : "400");
        st.setProperty("--cc-empty-color", c.emptyColor.value.value);
        st.setProperty("--cc-divider", c.dividerColor.value.value);

        st.setProperty("--cc-detail-size", px(d.size.value, 6));
        st.setProperty("--cc-detail-color", d.color.value.value);
        st.setProperty("--cc-detail-line", d.lineColor.value.value);
        st.setProperty("--cc-detail-weight", d.bold.value ? "700" : "400");
    }
}
