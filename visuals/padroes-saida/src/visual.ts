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
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel, enumValue } from "./settings";
import { Mode, Options, Pattern, RankBy, Result, Row, Z_CRITICAL, analyze } from "./analysis";

type Formatter = (v: number) => string;

/** Limite de linhas lidas (combinações dos atributos), igual ao do capabilities.json. */
const ROW_LIMIT = 30000;

interface Model {
    attrNames: string[];
    attrColumns: DataViewCategoryColumn[];
    exitsName: string;
    baseName: string;
    mode: Mode;
    /** Pediu taxa, mas não há Base: caiu para concentração. */
    missingBase: boolean;
    truncated: boolean;
    result: Result;
    headline: Pattern | undefined;
    list: Pattern[];
    ids: Map<string, ISelectionId>;
    fmt: { exits: Formatter; base: Formatter; pct: Formatter; lift: Formatter; count: Formatter };
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

function toNumber(value: PrimitiveValue | undefined): number {
    return typeof value === "number" && isFinite(value) ? value : 0;
}

function isBlank(value: PrimitiveValue): boolean {
    return value === null || value === undefined || value === "";
}

function label(value: PrimitiveValue, format: string | undefined, locale: string): string {
    if (isBlank(value)) {
        return "(Em branco)";
    }
    if (format || value instanceof Date) {
        return valueFormatter.format(value, format, false, locale);
    }
    return String(value);
}

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

        this.root = el("div", "ps-root");
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI (fora dos padrões).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
        // Clique no vazio limpa a seleção.
        this.root.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as Element).closest("[data-key]")) {
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
            this.model = this.buildModel(dataView);
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        const a = s.analysisCard;
        const rate = this.model ? this.model.mode === "rate" : enumValue(a.mode) !== "share";
        a.minLift.visible = a.confidence.visible = a.rankBy.visible = rate;
        a.minShare.visible = a.dominance.visible = !rate;
        const h = s.highlightCard;
        h.metricSize.visible = h.showMetric.value;
        const p = s.patternsCard;
        p.barColor.visible = p.trackColor.visible = p.showBar.value;
        p.averageColor.visible = p.showBar.value && rate;
        s.textsCard.footerColor.visible = s.textsCard.footerSize.visible = s.textsCard.showFooter.value;
        return this.formattingSettingsService.buildFormattingModel(s);
    }

    // ------------------------------------------------------------- dados

    private options(mode: Mode, attrCount: number): Options {
        const a = this.formattingSettings.analysisCard;
        const rank = enumValue(a.rankBy);
        return {
            mode,
            attrCount,
            maxDepth: Math.max(1, Math.min(4, Math.floor(a.maxDepth.value) || 1)),
            minExits: Math.max(0, a.minExits.value),
            minLift: Math.max(0, a.minLift.value),
            zCrit: Z_CRITICAL[enumValue(a.confidence)] ?? -Infinity,
            minShare: Math.max(0, Math.min(100, a.minShare.value)) / 100,
            dominance: Math.max(0, Math.min(100, a.dominance.value)) / 100,
            rankBy: (rank === "lift" || rank === "exits" ? rank : "excess") as RankBy,
            hideBlanks: a.hideBlanks.value
        };
    }

    private buildModel(dataView: DataView | undefined): Model | undefined {
        const categorical = dataView?.categorical;
        const attrColumns = (categorical?.categories ?? []).filter(c => c.source.roles?.["attributes"]);
        const values = categorical?.values ? Array.from(categorical.values) : [];
        const exitsColumn = values.find(c => c.source.roles?.["exits"]);
        const baseColumn = values.find(c => c.source.roles?.["base"]);
        if (attrColumns.length === 0 || !exitsColumn) {
            return undefined;
        }
        const locale = this.locale;

        const count = attrColumns[0].values.length;
        const rows: Row[] = [];
        for (let i = 0; i < count; i++) {
            rows.push({
                values: attrColumns.map(c => label(c.values[i], c.source.format, locale)),
                blank: attrColumns.map(c => isBlank(c.values[i])),
                exits: toNumber(exitsColumn.values[i]),
                base: baseColumn ? toNumber(baseColumn.values[i]) : 0,
                index: i
            });
        }

        const requested = enumValue(this.formattingSettings.analysisCard.mode);
        let mode: Mode = requested === "share" ? "share" : baseColumn ? "rate" : "share";
        if (mode === "rate" && rows.reduce((sum, r) => sum + r.base, 0) <= 0) {
            mode = "share";
        }
        const result = analyze(rows, this.options(mode, attrColumns.length));

        // Destaque: o perfil (regra) ou o padrão mais forte; a lista não repete o destaque.
        const h = this.formattingSettings.highlightCard;
        let headline: Pattern | undefined;
        if (h.show.value) {
            headline = enumValue(h.content) === "top" ? result.patterns[0] : result.profile ?? result.patterns[0];
        }
        const n = Math.max(0, Math.floor(this.formattingSettings.patternsCard.count.value));
        const list = this.formattingSettings.patternsCard.show.value
            ? result.patterns.filter(p => p.key !== headline?.key).slice(0, n)
            : [];

        // Uma seleção por padrão: só as colunas das condições (ex.: Senioridade = Sênior E Liderança = Não).
        const ids = new Map<string, ISelectionId>();
        for (const p of (headline ? [headline] : []).concat(list)) {
            const builder = this.host.createSelectionIdBuilder();
            p.conditions.forEach(c => builder.withCategory(attrColumns[c.attr], p.row));
            ids.set(p.key, builder.createSelectionId());
        }

        const numberFormat = (format: string | undefined): Formatter => {
            const f = valueFormatter.create({ format: format || "#,0", cultureSelector: locale });
            return v => f.format(v);
        };
        const pct = valueFormatter.create({ format: "0.0%", cultureSelector: locale });
        const lift = valueFormatter.create({ format: "0.0", cultureSelector: locale });
        const whole = valueFormatter.create({ format: "#,0", cultureSelector: locale });

        return {
            attrNames: attrColumns.map(c => c.source.displayName),
            attrColumns,
            exitsName: exitsColumn.source.displayName,
            baseName: baseColumn?.source.displayName ?? "",
            mode,
            missingBase: mode === "share" && requested !== "share",
            truncated: count >= ROW_LIMIT,
            result,
            headline,
            list,
            ids,
            fmt: {
                exits: numberFormat(exitsColumn.source.format),
                base: numberFormat(baseColumn?.source.format),
                pct: v => pct.format(v),
                lift: v => lift.format(v) + "×",
                count: v => whole.format(Math.round(v))
            }
        };
    }

    // ------------------------------------------------------------- textos

    private conditionText(model: Model, p: Pattern): string[] {
        const withName = this.formattingSettings.chipsCard.showAttribute.value;
        return p.conditions.map(c => (withName ? `${model.attrNames[c.attr]}: ${c.value}` : c.value));
    }

    private sentence(model: Model, p: Pattern): string {
        const t = this.formattingSettings.textsCard;
        const template = (model.mode === "rate" ? t.rateTemplate.value : t.shareTemplate.value) || "";
        const totals = model.result.totals;
        const f = model.fmt;
        const marks: Record<string, string> = {
            padrao: this.conditionText(model, p).join(" · "),
            saidas: f.exits(p.exits),
            total: f.exits(totals.exits),
            pct: f.pct(p.share),
            base: f.base(p.base),
            pctbase: f.pct(p.baseShare),
            taxa: f.pct(p.rate),
            media: f.pct(totals.rate),
            lift: f.lift(p.lift),
            excesso: f.count(p.excess)
        };
        return template
            .replace(/\{(\w+)\}/g, (m, name: string) => marks[name.toLowerCase()] ?? m)
            .replace(/\s+([.,;:!?)])/g, "$1")
            .replace(/\(\s*\)/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    /** Número em destaque: quantas vezes a média (com Base) ou a fatia das saídas. */
    private metric(model: Model, p: Pattern): { value: string; caption: string } {
        return model.mode === "rate"
            ? { value: model.fmt.lift(p.lift), caption: "a taxa média" }
            : { value: model.fmt.pct(p.share), caption: "do total" };
    }

    private term(): string {
        return this.formattingSettings.textsCard.term.value.trim() || "saídas";
    }

    private footerText(model: Model): string {
        const totals = model.result.totals;
        const f = model.fmt;
        const term = this.term();
        const parts: string[] = [];
        if (model.mode === "rate") {
            parts.push(`Taxa média: ${f.pct(totals.rate)} (${f.exits(totals.exits)} ${term} / ${f.base(totals.base)} na base)`);
        } else {
            parts.push(`${f.exits(totals.exits)} ${term} nos filtros atuais`);
        }
        const found = model.result.patterns.length;
        parts.push(found === 1 ? "1 padrão encontrado" : `${found} padrões encontrados`);
        if (model.missingBase) {
            parts.push("Coloque a Base para comparar com a taxa média");
        }
        if (model.truncated) {
            parts.push("Dados limitados às primeiras 30 mil combinações");
        }
        return parts.join(" · ");
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        const s = this.formattingSettings;
        root.style.fontFamily = s.generalCard.fontFamily.value;
        const model = this.model;

        // ---- cabeçalho
        const header = s.headerCard;
        if (header.title.value || header.subtitle.value) {
            const head = el("div", "ps-header");
            if (header.title.value) {
                const t = el("div", "ps-title", header.title.value);
                t.style.fontSize = header.titleSize.value + "px";
                t.style.color = header.titleColor.value.value;
                head.appendChild(t);
            }
            if (header.subtitle.value) {
                const t = el("div", "ps-subtitle", header.subtitle.value);
                t.style.fontSize = header.subtitleSize.value + "px";
                t.style.color = header.subtitleColor.value.value;
                head.appendChild(t);
            }
            root.appendChild(head);
        }

        if (!model) {
            this.empty("Padrões de Saída",
                "Coloque os campos que descrevem as pessoas (ou clientes) em Atributos (ex.: Senioridade, Liderança, " +
                "Faixa de tempo de casa) e a medida em Saídas. Opcional: Base (ex.: headcount), para comparar com a taxa média.");
            return;
        }
        if (model.result.totals.exits <= 0) {
            this.empty("Nada para analisar", `Não há ${this.term()} nos filtros atuais.`);
            return;
        }
        if (!model.headline && model.list.length === 0) {
            this.empty("Nenhum padrão relevante",
                model.mode === "rate"
                    ? "Nenhum perfil tem taxa de saída claramente acima da média. Tente diminuir o mínimo de saídas, " +
                      "o mínimo acima da média ou a confiança estatística (Formatar visual → Análise)."
                    : "Nenhum perfil concentra uma fatia relevante das saídas. Tente diminuir o mínimo de saídas ou a % mínima " +
                      "(Formatar visual → Análise).");
            this.footer(model);
            return;
        }

        const body = el("div", "ps-body");
        root.appendChild(body);
        if (model.headline) {
            body.appendChild(this.renderHeadline(model, model.headline));
        }
        if (model.list.length > 0) {
            const p = s.patternsCard;
            const grid = el("div", "ps-grid");
            grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(min(100%, ${Math.max(120, p.minWidth.value)}px), 1fr))`;
            const scale = model.mode === "rate"
                ? Math.max(model.result.totals.rate, ...model.list.map(i => i.rate)) * 1.05
                : 1;
            model.list.forEach(item => grid.appendChild(this.renderCard(model, item, scale)));
            body.appendChild(grid);
        }
        this.footer(model);
        this.paintSelection();
    }

    private empty(title: string, text: string): void {
        const box = el("div", "ps-empty");
        box.appendChild(el("div", "ps-empty-title", title));
        box.appendChild(el("div", "ps-empty-text", text));
        this.root.appendChild(box);
    }

    private footer(model: Model): void {
        const t = this.formattingSettings.textsCard;
        if (!t.showFooter.value) {
            return;
        }
        const f = el("div", "ps-footer", this.footerText(model));
        f.style.fontSize = t.footerSize.value + "px";
        f.style.color = t.footerColor.value.value;
        this.root.appendChild(f);
    }

    private chips(model: Model, p: Pattern): HTMLElement {
        const c = this.formattingSettings.chipsCard;
        const box = el("div", "ps-chips");
        this.conditionText(model, p).forEach(text => {
            const chip = el("span", "ps-chip", text);
            chip.title = text;
            chip.style.background = c.background.value.value;
            chip.style.color = c.fontColor.value.value;
            chip.style.fontSize = c.fontSize.value + "px";
            chip.style.borderRadius = Math.max(0, c.radius.value) + "px";
            if (c.borderWidth.value > 0) {
                chip.style.border = `${c.borderWidth.value}px solid ${c.borderColor.value.value}`;
            }
            box.appendChild(chip);
        });
        return box;
    }

    private renderHeadline(model: Model, p: Pattern): HTMLElement {
        const h = this.formattingSettings.highlightCard;
        const card = el("div", "ps-hero");
        card.dataset.key = p.key;
        card.tabIndex = 0;
        card.style.background = h.background.value.value;
        card.style.color = h.fontColor.value.value;
        card.style.borderRadius = Math.max(0, h.radius.value) + "px";
        if (h.borderWidth.value > 0) {
            card.style.border = `${h.borderWidth.value}px solid ${h.borderColor.value.value}`;
        }

        const main = el("div", "ps-hero-main");
        if (h.label.value) {
            const l = el("div", "ps-hero-label", h.label.value);
            l.style.fontSize = h.labelSize.value + "px";
            main.appendChild(l);
        }
        main.appendChild(this.chips(model, p));
        const text = el("div", "ps-hero-text", this.sentence(model, p));
        text.style.fontSize = h.textSize.value + "px";
        main.appendChild(text);
        card.appendChild(main);

        if (h.showMetric.value) {
            const m = this.metric(model, p);
            const box = el("div", "ps-hero-metric");
            const v = el("div", "ps-hero-value", m.value);
            v.style.fontSize = h.metricSize.value + "px";
            box.appendChild(v);
            const cap = el("div", "ps-hero-caption", m.caption);
            cap.style.fontSize = h.labelSize.value + "px";
            box.appendChild(cap);
            card.appendChild(box);
        }
        this.bind(card, model, p);
        return card;
    }

    private renderCard(model: Model, p: Pattern, scale: number): HTMLElement {
        const s = this.formattingSettings.patternsCard;
        const card = el("div", "ps-card");
        card.dataset.key = p.key;
        card.tabIndex = 0;
        card.style.background = s.background.value.value;
        card.style.color = s.fontColor.value.value;
        card.style.borderRadius = Math.max(0, s.radius.value) + "px";
        if (s.borderWidth.value > 0) {
            card.style.border = `${s.borderWidth.value}px solid ${s.borderColor.value.value}`;
        }

        const top = el("div", "ps-card-top");
        top.appendChild(this.chips(model, p));
        const m = this.metric(model, p);
        const metric = el("div", "ps-card-metric", m.value);
        metric.style.fontSize = s.metricSize.value + "px";
        metric.title = m.caption;
        top.appendChild(metric);
        card.appendChild(top);

        const text = el("div", "ps-card-text", this.sentence(model, p));
        text.style.fontSize = s.textSize.value + "px";
        card.appendChild(text);

        if (s.showBar.value) {
            const track = el("div", "ps-track");
            track.style.background = s.trackColor.value.value;
            const bar = el("div", "ps-bar");
            const share = model.mode === "rate" ? p.rate / scale : p.share;
            bar.style.width = (Math.min(1, Math.max(0, share)) * 100).toFixed(2) + "%";
            bar.style.background = s.barColor.value.value;
            track.appendChild(bar);
            if (model.mode === "rate") {
                const avg = el("div", "ps-avg");
                avg.style.left = (Math.min(1, model.result.totals.rate / scale) * 100).toFixed(2) + "%";
                avg.style.background = s.averageColor.value.value;
                avg.title = "Taxa média";
                track.appendChild(avg);
            }
            card.appendChild(track);
        }
        this.bind(card, model, p);
        return card;
    }

    // ------------------------------------------------------------- interação

    private tooltip(model: Model, p: Pattern): VisualTooltipDataItem[] {
        const f = model.fmt;
        const totals = model.result.totals;
        const items: VisualTooltipDataItem[] = p.conditions.map(c => ({ displayName: model.attrNames[c.attr], value: c.value }));
        items.push({ displayName: model.exitsName, value: f.exits(p.exits) });
        items.push({ displayName: "% do total", value: f.pct(p.share) });
        if (model.mode === "rate") {
            items.push({ displayName: model.baseName, value: f.base(p.base) });
            items.push({ displayName: "% da base", value: f.pct(p.baseShare) });
            items.push({ displayName: "Taxa de saída", value: f.pct(p.rate) });
            items.push({ displayName: "Taxa média", value: f.pct(totals.rate) });
            items.push({ displayName: "Quantas vezes a média", value: f.lift(p.lift) });
            items.push({ displayName: "Acima do esperado", value: f.count(p.excess) });
        }
        return items;
    }

    private bind(node: HTMLElement, model: Model, p: Pattern): void {
        const id = model.ids.get(p.key);
        if (!id) {
            return;
        }
        const args = (e: MouseEvent) => ({
            coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: this.tooltip(model, p), identities: [id]
        });
        node.addEventListener("mouseenter", (e: MouseEvent) => this.host.tooltipService.show(args(e)));
        node.addEventListener("mousemove", (e: MouseEvent) => this.host.tooltipService.move(args(e)));
        node.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
        node.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
        });
        node.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.selectionManager.select(id, e.ctrlKey || e.metaKey).then(() => this.paintSelection());
            }
        });
        node.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectionManager.showContextMenu(id, { x: e.clientX, y: e.clientY });
        });
    }

    /** Esmaece os padrões que não estão selecionados. */
    private paintSelection(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const selected = this.selectionManager.getSelectionIds() as ISelectionId[];
        const dim = String(Math.min(100, Math.max(0, this.formattingSettings.patternsCard.selectedOpacity.value)) / 100);
        this.root.querySelectorAll<HTMLElement>("[data-key]").forEach(node => {
            const id = model.ids.get(node.dataset.key || "");
            const on = selected.length === 0 || (!!id && selected.some(sel => sel.equals(id)));
            node.style.opacity = on ? "1" : dim;
        });
    }
}
