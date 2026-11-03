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

import {
    ComparisonItemSettings, MAX_COMPARISONS, VisualFormattingSettingsModel, decimalsValue, enumValue
} from "./settings";

/** Uma medida lida do Power BI, com o formatador dela (já com as unidades e casas do Big Number). */
interface Measure {
    name: string;
    value: PrimitiveValue;
    number: number | undefined;
    format: (v: PrimitiveValue) => string;
    formatString: string | undefined;
}

interface Comparison {
    measure: Measure;
    settings: ComparisonItemSettings;
}

interface Model {
    main: Measure | undefined;
    comparisons: Comparison[];
    /** Unidade de exibição do Big Number (1000, 1e6…), usada também na diferença absoluta. */
    units: number | undefined;
    /** Unidades automáticas: a diferença absoluta escolhe a unidade pelo próprio tamanho. */
    autoUnits: boolean;
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

/** A medida está em formato de porcentagem (0,25 = 25%)? */
function isPercentFormat(format: string | undefined): boolean {
    return !!format && /%/.test(format.replace(/\\%|"[^"]*"|'[^']*'/g, ""));
}

const UNIT_VALUES: Record<string, number> = { none: 1, k: 1e3, m: 1e6, b: 1e9 };

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private model: Model | undefined;
    private locale = "pt-BR";

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "bn-root");
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
            this.model = this.buildModel(dataView);
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        const count = Number(enumValue(s.comparisonsCard.count));
        s.comparisonItems.forEach((item, i) => item.visible = i < count);

        const k = s.cardCard;
        k.accentColor.visible = k.accentWidth.visible = k.accent.value;
        const t = s.titleCard;
        t.text.visible = t.size.visible = t.color.visible = t.bold.visible = t.upper.visible = t.show.value;
        t.subtitleSize.visible = t.subtitleColor.visible = !!t.subtitle.value;
        const c = s.comparisonsCard;
        c.dividerColor.visible = c.dividers.value;
        c.previousColor.visible = c.previousTemplate.visible = s.comparisonItems.some(item => item.showPrevious.value);
        return this.formattingSettingsService.buildFormattingModel(s);
    }

    // ------------------------------------------------------------- dados

    private measure(column: DataViewValueColumn | undefined, units: number | undefined): Measure | undefined {
        if (!column) {
            return undefined;
        }
        const value = column.values[0];
        const formatter = valueFormatter.create({
            format: column.source.format,
            value: units,
            precision: decimalsValue(this.formattingSettings.valueCard.decimals),
            cultureSelector: this.locale
        });
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
        const byRole = (role: string): DataViewValueColumn | undefined => columns.find(c => c.source.roles?.[role]);

        const mainColumn = byRole("main");
        const unit = enumValue(this.formattingSettings.valueCard.displayUnits);
        const mainNumber = toNumber(mainColumn?.values[0]);
        const units = unit === "auto" ? (mainNumber !== undefined ? Math.abs(mainNumber) : undefined) : UNIT_VALUES[unit];

        const count = Math.min(MAX_COMPARISONS, Number(enumValue(this.formattingSettings.comparisonsCard.count)) || 0);
        const comparisons: Comparison[] = [];
        for (let i = 0; i < count; i++) {
            const measure = this.measure(byRole(`comp${i + 1}`), units);
            if (measure) {
                comparisons.push({ measure, settings: this.formattingSettings.comparisonItems[i] });
            }
        }

        return { main: this.measure(mainColumn, units), comparisons, units, autoUnits: unit === "auto" };
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        this.applyStyles();
        const model = this.model;

        if (!model?.main) {
            const empty = el("div", "bn-empty");
            empty.appendChild(el("div", "bn-empty-title", "Big Number"));
            empty.appendChild(el("div", "bn-empty-text",
                "Coloque a medida principal em Big Number e até 3 medidas (mês anterior, ano anterior, meta…) em Comparação 1, 2 e 3."));
            root.appendChild(empty);
            return;
        }

        const content = el("div", "bn-content");
        const t = this.formattingSettings.titleCard;
        const title = t.text.value || model.main.name;
        if ((t.show.value && title) || t.subtitle.value) {
            const head = el("div", "bn-head");
            if (t.show.value && title) {
                head.appendChild(el("div", "bn-title", title));
            }
            if (t.subtitle.value) {
                head.appendChild(el("div", "bn-subtitle", t.subtitle.value));
            }
            content.appendChild(head);
        }

        const main = model.main;
        const value = el("div", "bn-value", isBlank(main.value) ? "—" : main.format(main.value));
        value.title = main.name;
        content.appendChild(value);

        if (model.comparisons.length) {
            content.appendChild(this.renderComparisons(model));
        }
        root.appendChild(content);
        this.fit();
    }

    private renderComparisons(model: Model): HTMLElement {
        const c = this.formattingSettings.comparisonsCard;
        const list = el("div", "bn-comps");
        list.classList.toggle("bn-side", enumValue(c.layout) === "side");
        list.classList.toggle("bn-dividers", c.dividers.value);
        const main = model.main as Measure;

        for (const comp of model.comparisons) {
            const s = comp.settings;
            const item = el("div", "bn-comp");
            const result = el("div", "bn-result");
            result.classList.toggle("bn-pill", enumValue(c.style) === "pill");

            if (main.number === undefined || comp.measure.number === undefined) {
                result.classList.add("bn-result-empty");
                result.appendChild(el("span", "bn-delta", c.emptyText.value || "Sem dado"));
            } else {
                const { text, tone, delta } = this.compare(main, comp, model);
                result.dataset.tone = tone;
                if (c.showArrow.value && delta !== 0) {
                    result.appendChild(el("span", "bn-arrow", delta > 0 ? "▲" : "▼"));
                }
                result.appendChild(el("span", "bn-delta", text));
            }
            item.appendChild(result);

            const label = s.label.value || comp.measure.name;
            if (label) {
                item.appendChild(el("span", "bn-label", label));
            }
            if (s.showPrevious.value && !isBlank(comp.measure.value)) {
                const template = c.previousTemplate.value || "({valor})";
                const prevText = template.includes("{valor}")
                    ? template.replace(/\{valor\}/g, comp.measure.format(comp.measure.value))
                    : `${template} ${comp.measure.format(comp.measure.value)}`;
                item.appendChild(el("span", "bn-prev", prevText));
            }
            this.bindTooltip(item, main, comp.measure);
            list.appendChild(item);
        }
        return list;
    }

    /** Texto e tom (bom/ruim) da diferença entre o Big Number e uma comparação. */
    private compare(main: Measure, comp: Comparison, model: Model): { text: string; tone: Tone; delta: number } {
        const c = this.formattingSettings.comparisonsCard;
        const s = comp.settings;
        const a = main.number as number;
        const b = comp.measure.number as number;
        const delta = a - b;
        const direction = enumValue(s.direction);
        const better = direction === "down" ? delta < 0 : delta > 0;
        const tone: Tone = delta === 0 || direction === "none" ? "neutral" : better ? "good" : "bad";
        const decimals = decimalsValue(s.decimals);
        const unit = enumValue(s.unit);

        let magnitude: number | undefined;
        let text: string;
        if (unit === "abs") {
            magnitude = delta;
            const units = model.autoUnits ? Math.abs(delta) : model.units;
            const formatter = valueFormatter.create({ format: main.formatString, value: units, precision: decimals, cultureSelector: this.locale });
            text = formatter.format(Math.abs(delta));
        } else if (unit === "pp") {
            magnitude = isPercentFormat(main.formatString) ? delta * 100 : delta;
            text = this.fixed(Math.abs(magnitude), decimals ?? 1) + " p.p.";
        } else {
            magnitude = b !== 0 ? delta / Math.abs(b) : undefined;
            text = magnitude === undefined ? "—" : this.fixed(Math.abs(magnitude) * 100, decimals ?? 1) + "%";
        }
        if (magnitude !== undefined && text !== "—") {
            text = (magnitude > 0 ? (c.showSign.value ? "+" : "") : magnitude < 0 ? "-" : "") + text;
        }
        return { text, tone, delta };
    }

    /** Número com casas fixas no idioma do relatório (1.234,5). */
    private fixed(value: number, decimals: number): string {
        const format = decimals > 0 ? "#,0." + "0".repeat(decimals) : "#,0";
        return valueFormatter.create({ format, cultureSelector: this.locale }).format(value);
    }

    private bindTooltip(node: HTMLElement, main: Measure, comp: Measure): void {
        const items = (): VisualTooltipDataItem[] => {
            const list: VisualTooltipDataItem[] = [
                { displayName: main.name, value: isBlank(main.value) ? "(vazio)" : main.format(main.value) },
                { displayName: comp.name, value: isBlank(comp.value) ? "(vazio)" : comp.format(comp.value) }
            ];
            if (main.number !== undefined && comp.number !== undefined) {
                const delta = main.number - comp.number;
                const diff = valueFormatter.create({ format: main.formatString, cultureSelector: this.locale });
                list.push({ displayName: "Diferença", value: (delta < 0 ? "-" : "") + diff.format(Math.abs(delta)) });
                if (isPercentFormat(main.formatString)) {
                    list.push({ displayName: "Pontos percentuais", value: this.fixed(delta * 100, 1) + " p.p." });
                }
                if (comp.number !== 0) {
                    list.push({ displayName: "Variação %", value: this.fixed(delta / Math.abs(comp.number) * 100, 1) + "%" });
                }
            }
            return list;
        };
        node.addEventListener("mouseenter", (e: MouseEvent) => {
            this.host.tooltipService.show({ coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: items(), identities: [] });
        });
        node.addEventListener("mousemove", (e: MouseEvent) => {
            this.host.tooltipService.move({ coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: items(), identities: [] });
        });
        node.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
    }

    /** Diminui tudo proporcionalmente quando o conteúdo não cabe no tamanho do visual. */
    private fit(): void {
        const root = this.root;
        const texts = Array.from(root.querySelectorAll<HTMLElement>(".bn-title, .bn-subtitle, .bn-value, .bn-comp"));
        const overflows = (): boolean => root.scrollHeight > root.clientHeight + 1
            || root.scrollWidth > root.clientWidth + 1
            || texts.some(n => n.scrollWidth > n.clientWidth + 1);
        let scale = 1;
        root.style.setProperty("--bn-scale", "1");
        for (let i = 0; i < 12 && overflows(); i++) {
            scale *= 0.9;
            root.style.setProperty("--bn-scale", scale.toFixed(3));
        }
    }

    // ------------------------------------------------------------- estilos

    private applyStyles(): void {
        const st = this.root.style;
        const k = this.formattingSettings.cardCard;
        const t = this.formattingSettings.titleCard;
        const v = this.formattingSettings.valueCard;
        const c = this.formattingSettings.comparisonsCard;
        const px = (n: number, min = 0): string => Math.max(min, n || 0) + "px";
        const align = enumValue(k.align);

        st.setProperty("--bn-font", k.fontFamily.value);
        st.setProperty("--bn-align", align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start");
        st.setProperty("--bn-text-align", align || "left");
        st.setProperty("--bn-valign", enumValue(k.verticalAlign) === "top" ? "flex-start" : "center");
        st.setProperty("--bn-bg", k.background.value.value);
        st.setProperty("--bn-radius", px(k.radius.value));
        st.setProperty("--bn-bw", px(k.borderWidth.value));
        st.setProperty("--bn-bc", k.borderColor.value.value);
        st.setProperty("--bn-pad", px(k.padding.value));
        st.setProperty("--bn-gap", px(k.gap.value));
        st.setProperty("--bn-accent", k.accentColor.value.value);
        st.setProperty("--bn-accent-width", k.accent.value ? px(k.accentWidth.value) : "0px");

        st.setProperty("--bn-title-size", px(t.size.value, 6));
        st.setProperty("--bn-title-color", t.color.value.value);
        st.setProperty("--bn-title-weight", t.bold.value ? "600" : "400");
        st.setProperty("--bn-title-case", t.upper.value ? "uppercase" : "none");
        st.setProperty("--bn-subtitle-size", px(t.subtitleSize.value, 6));
        st.setProperty("--bn-subtitle-color", t.subtitleColor.value.value);

        st.setProperty("--bn-value-size", px(v.size.value, 8));
        st.setProperty("--bn-value-color", v.color.value.value);
        st.setProperty("--bn-value-weight", v.bold.value ? "700" : "400");

        st.setProperty("--bn-good", c.goodColor.value.value);
        st.setProperty("--bn-bad", c.badColor.value.value);
        st.setProperty("--bn-neutral", c.neutralColor.value.value);
        st.setProperty("--bn-result-size", px(c.resultSize.value, 6));
        st.setProperty("--bn-label-size", px(c.labelSize.value, 6));
        st.setProperty("--bn-label-color", c.labelColor.value.value);
        st.setProperty("--bn-prev-color", c.previousColor.value.value);
        st.setProperty("--bn-divider", c.dividerColor.value.value);
    }
}
