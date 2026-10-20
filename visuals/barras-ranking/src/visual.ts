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

type Formatter = (v: PrimitiveValue) => string;

/** Uma barra (um valor da categoria). */
interface Item {
    index: number;
    label: string;
    value: number | null;
    valueText: string;
    /** Textos das medidas de Detalhe (já formatados). */
    details: string[];
    sortKey: PrimitiveValue;
    /** Cor vinda do fx (regras ou valor de campo), se houver. */
    color: string | undefined;
    selectionId: ISelectionId;
}

interface Model {
    categoryName: string;
    valueName: string;
    valueFormat: Formatter;
    detailColumns: DataViewValueColumn[];
    sortColumn: DataViewValueColumn | undefined;
    tooltipColumns: DataViewValueColumn[];
    /** Todas as categorias, na ordem do Power BI. */
    all: Item[];
    /** As barras exibidas (top N aplicado), já ordenadas. */
    items: Item[];
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

function toNumber(value: PrimitiveValue | undefined): number | null {
    return typeof value === "number" && isFinite(value) ? value : null;
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

function colorProp(objects: powerbi.DataViewObjects | undefined, object: string, prop: string): string | undefined {
    const fill = objects?.[object]?.[prop] as powerbi.Fill | undefined;
    return fill?.solid?.color || undefined;
}

/** Compara valores de ordenação: números, datas e textos (com números "naturais"). Vazios vão para o fim. */
function compareKeys(a: PrimitiveValue, b: PrimitiveValue, locale: string): number {
    const empty = (v: PrimitiveValue): boolean => v === null || v === undefined || v === "";
    if (empty(a) || empty(b)) {
        return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
    }
    const num = (v: PrimitiveValue): number | undefined =>
        typeof v === "number" ? v : v instanceof Date ? v.getTime() : typeof v === "boolean" ? Number(v) : undefined;
    const na = num(a);
    const nb = num(b);
    if (na !== undefined && nb !== undefined) {
        return na - nb;
    }
    return String(a).localeCompare(String(b), locale, { numeric: true, sensitivity: "base" });
}

/** Largura aproximada de um texto (para dimensionar as colunas de rótulo e valor). */
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

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "br-root");
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
            if (!(e.target as Element).closest(".br-row")) {
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
        const s = this.formattingSettings;
        const bars = s.barsCard;
        bars.highlightColor.visible = bars.highlightMax.value;
        bars.trackColor.visible = bars.showTrack.value;
        s.topNCard.count.visible = s.topNCard.basis.visible = s.topNCard.show.value;
        s.categoryLabelsCard.align.visible = s.categoryLabelsCard.show.value;
        const insight = s.insightCard;
        insight.scope.visible = s.topNCard.show.value;
        // Sem campo em Ordenar por, a opção não aparece.
        s.sortCard.orderBy.items = s.sortCard.orderBy.items.filter(i => i.value !== "sortBy" || !!this.model?.sortColumn);
        return this.formattingSettingsService.buildFormattingModel(s);
    }

    // ------------------------------------------------------------- dados

    private buildModel(dataView: DataView | undefined): Model | undefined {
        const categorical = dataView?.categorical;
        const category = categorical?.categories?.[0];
        const values = categorical?.values;
        const valueColumn = values ? Array.from(values).find(c => c.source.roles?.["value"]) : undefined;
        if (!category || !values || !valueColumn) {
            return undefined;
        }
        const locale = this.locale;
        const formatOf = (column: DataViewValueColumn): Formatter => {
            const f = valueFormatter.create({ format: column.source.format, cultureSelector: locale });
            return v => (v === null || v === undefined ? "—" : f.format(v));
        };
        const columns = Array.from(values);
        const detailColumns = columns.filter(c => c.source.roles?.["detail"]);
        const sortColumn = columns.find(c => c.source.roles?.["sortBy"]);
        const tooltipColumns = columns.filter(c => c.source.roles?.["tooltips"]);
        const valueFormat = formatOf(valueColumn);
        const detailFormats = detailColumns.map(formatOf);

        const all: Item[] = category.values.map((cat, i) => {
            const value = toNumber(valueColumn.values[i]);
            return {
                index: i,
                label: label(cat, category.source.format, locale),
                value,
                valueText: valueFormat(value),
                details: detailColumns
                    .map((c, k) => c.values[i] === null || c.values[i] === undefined ? "" : detailFormats[k](c.values[i]))
                    .filter(t => t !== ""),
                sortKey: sortColumn ? sortColumn.values[i] : null,
                color: colorProp(category.objects?.[i], "bars", "fill"),
                selectionId: this.host.createSelectionIdBuilder().withCategory(category, i).createSelectionId()
            };
        });

        const model: Model = {
            categoryName: category.source.displayName,
            valueName: valueColumn.source.displayName,
            valueFormat,
            detailColumns,
            sortColumn,
            tooltipColumns,
            all,
            items: []
        };
        model.items = this.arrange(model);
        return model;
    }

    /** Ordena as barras e aplica o top N. */
    private arrange(model: Model): Item[] {
        const s = this.formattingSettings;
        const locale = this.locale;
        let orderBy = enumValue(s.sortCard.orderBy);
        if (orderBy === "auto" || (orderBy === "sortBy" && !model.sortColumn)) {
            orderBy = model.sortColumn ? "sortBy" : "value";
        }
        let direction = enumValue(s.sortCard.direction);
        if (direction === "auto") {
            direction = orderBy === "value" ? "desc" : "asc";
        }
        const sign = direction === "desc" ? -1 : 1;
        // Vazios sempre no fim, qualquer que seja a direção.
        const byKey = (key: (item: Item) => PrimitiveValue, dirSign: number) => (a: Item, b: Item): number => {
            const ka = key(a);
            const kb = key(b);
            const ea = ka === null || ka === undefined || ka === "";
            const eb = kb === null || kb === undefined || kb === "";
            if (ea || eb) {
                return ea === eb ? a.index - b.index : ea ? 1 : -1;
            }
            return dirSign * compareKeys(ka, kb, locale) || a.index - b.index;
        };
        const sorted = (list: Item[]): Item[] => {
            const copy = list.slice();
            if (orderBy === "value") {
                copy.sort(byKey(i => i.value, sign));
            } else if (orderBy === "sortBy") {
                copy.sort(byKey(i => i.sortKey, sign));
            } else if (orderBy === "category") {
                copy.sort(byKey(i => i.label, sign));
            } else if (direction === "desc") {
                copy.reverse();
            }
            return copy;
        };

        const top = s.topNCard;
        const n = Math.floor(top.count.value);
        if (!top.show.value || n <= 0 || n >= model.all.length) {
            return sorted(model.all);
        }
        const basis = enumValue(top.basis);
        if (basis === "order") {
            return sorted(model.all).slice(0, n);
        }
        // Escolhe pelos maiores (ou menores) valores e depois aplica a ordenação escolhida.
        const chosen = model.all.slice().sort(byKey(i => i.value, basis === "smallest" ? 1 : -1)).slice(0, n);
        return sorted(chosen);
    }

    private detailText(details: string[]): string {
        if (details.length === 0) {
            return "";
        }
        const joined = details.join(" · ");
        const style = enumValue(this.formattingSettings.detailLabelsCard.style);
        return style === "paren" ? `(${joined})` : style === "dot" ? `· ${joined}` : joined;
    }

    /** Item destacado pelo insight (maior ou menor valor). */
    private insightItem(model: Model): Item | undefined {
        const s = this.formattingSettings.insightCard;
        const pool = this.formattingSettings.topNCard.show.value && enumValue(s.scope) === "all" ? model.all : model.items;
        const max = enumValue(s.type) !== "min";
        let best: Item | undefined;
        for (const item of pool) {
            if (item.value === null) {
                continue;
            }
            if (!best || (max ? item.value > best.value : item.value < best.value)) {
                best = item;
            }
        }
        return best;
    }

    private insightText(model: Model): string {
        const item = this.insightItem(model);
        if (!item) {
            return "";
        }
        const template = this.formattingSettings.insightCard.template.value || "";
        return template
            .replace(/\{categoria\}/gi, item.label)
            .replace(/\{valor\}/gi, item.valueText)
            .replace(/\{detalhe\}/gi, this.detailText(item.details))
            .replace(/\s+([.,;:!?)])/g, "$1")
            .replace(/\(\s*\)/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        root.style.fontFamily = font;
        const model = this.model;

        // ---- cabeçalho
        const header = s.headerCard;
        if (header.title.value || header.subtitle.value) {
            const head = el("div", "br-header");
            if (header.title.value) {
                const t = el("div", "br-title", header.title.value);
                t.style.fontSize = header.titleSize.value + "px";
                t.style.color = header.titleColor.value.value;
                head.appendChild(t);
            }
            if (header.subtitle.value) {
                const t = el("div", "br-subtitle", header.subtitle.value);
                t.style.fontSize = header.subtitleSize.value + "px";
                t.style.color = header.subtitleColor.value.value;
                head.appendChild(t);
            }
            root.appendChild(head);
        }

        if (!model || model.items.length === 0) {
            const empty = el("div", "br-empty");
            empty.appendChild(el("div", "br-empty-title", "Barras com Insight"));
            empty.appendChild(el("div", "br-empty-text",
                "Coloque um campo em Categoria e uma medida em Valor. Opcional: Detalhe (ao lado do valor) e Ordenar por."));
            root.appendChild(empty);
            return;
        }

        const list = el("div", "br-list");
        root.appendChild(list);

        // ---- insight
        const ins = s.insightCard;
        let insightEl: HTMLElement | undefined;
        const insightText = ins.show.value ? this.insightText(model) : "";
        if (insightText) {
            insightEl = el("div", "br-insight", insightText);
            insightEl.style.fontSize = ins.fontSize.value + "px";
            insightEl.style.color = ins.fontColor.value.value;
            insightEl.style.fontWeight = ins.bold.value ? "600" : "400";
            root.appendChild(insightEl);
        }

        // ---- tamanhos
        const cats = s.categoryLabelsCard;
        const vals = s.valueLabelsCard;
        const det = s.detailLabelsCard;
        const bars = s.barsCard;
        const rows = s.rowsCard;
        const width = Math.max(0, this.width);
        const gap = Math.max(0, rows.gap.value);
        const showDetail = det.show.value && model.detailColumns.length > 0;
        const detailTexts = model.items.map(item => (showDetail ? this.detailText(item.details) : ""));

        let labelW = 0;
        if (cats.show.value) {
            labelW = cats.width.value > 0 ? cats.width.value
                : Math.max(...model.items.map(i => textWidth(i.label, cats.fontSize.value, font, cats.bold.value))) + 4;
            labelW = Math.ceil(Math.min(labelW, width * 0.4));
        }
        let valueW = 0;
        if (vals.show.value || showDetail) {
            valueW = Math.max(...model.items.map((item, k) => {
                const v = vals.show.value ? textWidth(item.valueText, vals.fontSize.value, font, vals.bold.value) : 0;
                const d = detailTexts[k] ? textWidth(detailTexts[k], det.fontSize.value, font, det.bold.value) : 0;
                return v + d + (v && d ? 6 : 0);
            })) + 4;
            valueW = Math.ceil(Math.min(valueW, width * 0.4));
        }

        const used = root.querySelector(".br-header")?.getBoundingClientRect().height || 0;
        const insightH = insightEl ? insightEl.getBoundingClientRect().height || ins.fontSize.value * 1.4 + 10 : 0;
        const available = Math.max(0, this.height - used - insightH - 8);
        const minRow = Math.max(cats.fontSize.value, vals.fontSize.value, 6) + 4;
        let rowH = Math.max(minRow, rows.height.value);
        if (rows.fit.value) {
            rowH = Math.max(minRow, Math.min(rowH, available / model.items.length));
        }
        const thickness = Math.max(2, Math.min(bars.thickness.value, rowH - 2));
        const radius = Math.max(0, Math.min(bars.radius.value, thickness / 2));
        const borderW = Math.max(0, bars.borderWidth.value);
        list.style.maxHeight = available + "px";

        const visibleMax = Math.max(0, ...model.items.map(i => i.value ?? 0));
        const scaleMax = bars.scaleMax.value > 0 ? bars.scaleMax.value : visibleMax;
        const highlightIndex = bars.highlightMax.value
            ? model.items.reduce<Item | undefined>((best, i) => (i.value !== null && (!best || i.value > (best.value ?? 0)) ? i : best), undefined)?.index
            : undefined;

        const template = [labelW > 0 ? labelW + "px" : "", "minmax(20px, 1fr)", valueW > 0 ? valueW + "px" : ""]
            .filter(Boolean).join(" ");

        model.items.forEach((item, row) => {
            const r = el("div", "br-row");
            r.dataset.index = String(item.index);
            r.style.gridTemplateColumns = template;
            r.style.columnGap = gap + "px";
            r.style.height = rowH + "px";
            r.tabIndex = 0;

            if (labelW > 0) {
                const l = el("div", "br-label", item.label);
                l.title = item.label;
                l.style.fontSize = cats.fontSize.value + "px";
                l.style.color = cats.fontColor.value.value;
                l.style.fontWeight = cats.bold.value ? "600" : "400";
                l.style.textAlign = enumValue(cats.align) === "right" ? "right" : "left";
                r.appendChild(l);
            }

            const track = el("div", "br-track");
            track.style.height = thickness + "px";
            track.style.borderRadius = radius + "px";
            track.style.background = bars.showTrack.value ? bars.trackColor.value.value : "transparent";
            const bar = el("div", "br-bar");
            const share = scaleMax > 0 && item.value !== null ? Math.min(1, Math.max(0, item.value / scaleMax)) : 0;
            bar.style.width = (share * 100).toFixed(3) + "%";
            bar.style.borderRadius = radius + "px";
            bar.style.background = item.index === highlightIndex ? bars.highlightColor.value.value
                : item.color || bars.fill.value.value;
            if (borderW > 0 && share > 0) {
                bar.style.boxShadow = `inset 0 0 0 ${borderW}px ${bars.borderColor.value.value}`;
            }
            track.appendChild(bar);
            r.appendChild(track);

            if (valueW > 0) {
                const v = el("div", "br-value");
                if (vals.show.value) {
                    const t = el("span", "br-value-text", item.valueText);
                    t.style.fontSize = vals.fontSize.value + "px";
                    t.style.color = vals.fontColor.value.value;
                    t.style.fontWeight = vals.bold.value ? "600" : "400";
                    v.appendChild(t);
                }
                if (detailTexts[row]) {
                    const d = el("span", "br-detail", detailTexts[row]);
                    d.style.fontSize = det.fontSize.value + "px";
                    d.style.color = det.fontColor.value.value;
                    d.style.fontWeight = det.bold.value ? "600" : "400";
                    v.appendChild(d);
                }
                r.appendChild(v);
            }

            this.bindRow(r, model, item);
            list.appendChild(r);
        });
        this.paintSelection();
    }

    // ------------------------------------------------------------- interação

    private tooltip(model: Model, item: Item): VisualTooltipDataItem[] {
        const items: VisualTooltipDataItem[] = [
            { displayName: model.categoryName, value: item.label },
            { displayName: model.valueName, value: item.valueText }
        ];
        const extra = (column: DataViewValueColumn): void => {
            const f = valueFormatter.create({ format: column.source.format, cultureSelector: this.locale });
            const v = column.values[item.index];
            items.push({ displayName: column.source.displayName, value: v === null || v === undefined ? "—" : f.format(v) });
        };
        model.detailColumns.forEach(extra);
        if (model.sortColumn) {
            extra(model.sortColumn);
        }
        model.tooltipColumns.forEach(extra);
        return items;
    }

    private bindRow(row: HTMLElement, model: Model, item: Item): void {
        const id = item.selectionId;
        const args = (e: MouseEvent) => ({
            coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: this.tooltip(model, item), identities: [id]
        });
        row.addEventListener("mouseenter", (e: MouseEvent) => this.host.tooltipService.show(args(e)));
        row.addEventListener("mousemove", (e: MouseEvent) => this.host.tooltipService.move(args(e)));
        row.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
        row.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
        });
        row.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
            }
        });
        row.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectionManager.showContextMenu(id, { x: e.clientX, y: e.clientY });
        });
    }

    /** Esmaece as linhas que não estão selecionadas. */
    private paintSelection(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const dim = String(Math.min(100, Math.max(0, this.formattingSettings.barsCard.selectedOpacity.value)) / 100);
        this.root.querySelectorAll<HTMLElement>(".br-row").forEach(node => {
            const item = model.all[Number(node.dataset.index)];
            const on = selected.length === 0 || selected.some(sel => sel.equals(item.selectionId));
            node.style.opacity = on ? "1" : dim;
        });
    }
}
