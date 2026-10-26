"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
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
import FontControl = formattingSettings.FontControl;

import { FONT, VisualFormattingSettingsModel, enumValue } from "./settings";
import { Mode, Options, Pattern, RankBy, Result, Row, Z_CRITICAL, analyze } from "./analysis";
import { Block, HelpContext, guideContent, helpContent } from "./help";

type Formatter = (v: number) => string;
type Check = { ok: boolean | "info"; text: string };

/** Limite de linhas lidas (combinações dos atributos), igual ao do capabilities.json. */
const ROW_LIMIT = 30000;
/** Atributos com mais valores que isso geram aviso no guia de medidas. */
const MANY_VALUES = 30;

const SVG_NS = "http://www.w3.org/2000/svg";

interface Model {
    attrNames: string[];
    attrColumns: DataViewCategoryColumn[];
    exitsName: string;
    baseName: string;
    mode: Mode;
    /** Pediu taxa, mas não há Base: caiu para concentração. */
    missingBase: boolean;
    truncated: boolean;
    options: Options;
    result: Result;
    headline: Pattern | undefined;
    list: Pattern[];
    ids: Map<string, ISelectionId>;
    checks: Check[];
    fmt: { exits: Formatter; base: Formatter; pct: Formatter; lift: Formatter; count: Formatter; decimal: Formatter };
}

/** Caixa com fundo, borda, arredondamento, espaçamento e sombra (ver Box em settings.ts). */
interface BoxSettings {
    background: formattingSettings.ColorPicker;
    borderWidth: formattingSettings.NumUpDown;
    borderColor: formattingSettings.ColorPicker;
    radius: formattingSettings.NumUpDown;
    padding: formattingSettings.NumUpDown;
    shadow: formattingSettings.ToggleSwitch;
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

/** Ícone de traço (padrão do repositório). */
function icon(paths: string[], size: number): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const d of paths) {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        svg.appendChild(p);
    }
    return svg;
}
const ICON_HELP = ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.4-2.5 3.9", "M12 17h.01"];
const ICON_CLOSE = ["M6 6l12 12", "M18 6L6 18"];

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

/** Cor com transparência (aceita #RGB e #RRGGBB; outras cores passam direto). */
function withAlpha(color: string, alpha: number): string {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!m) {
        return color;
    }
    const hex = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1];
    const n = parseInt(hex, 16);
    const a = Math.min(1, Math.max(0, alpha));
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

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
    private editing = false;
    /** Pop-up de ajuda aberto (sobrevive às atualizações). */
    private helpOpen = false;
    /** Guia de medidas aberto pelo aviso do rodapé (sem mexer na formatação). */
    private guideOpen = false;
    /** Campos que faltam (para o guia). */
    private missing: string[] = [];

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
        // No pop-up e no guia, o clique fica livre para selecionar texto e rolar.
        this.root.addEventListener("mousedown", (e: MouseEvent) => {
            if (!(e.target as Element).closest(".ps-dialog, .ps-guide")) {
                e.preventDefault();
            }
        });
        // Clique no vazio limpa a seleção.
        this.root.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as Element).closest("[data-key], .ps-help, .ps-overlay, .ps-guide, .ps-warning")) {
                this.selectionManager.clear().then(() => this.paintSelection());
            }
        });
        this.root.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Escape" && this.helpOpen) {
                this.setHelp(false);
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
            this.editing = options.viewMode === 1 || options.viewMode === 2;
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
        [h.metricFont, h.metricColor, h.captionRate, h.captionShare, h.captionFont, h.captionColor, h.showDivider]
            .forEach(x => (x.visible = h.showMetric.value));
        h.dividerColor.visible = h.showMetric.value && h.showDivider.value;

        const p = s.patternsCard;
        p.metricFont.visible = p.metricColor.visible = p.showMetric.value;
        [p.barColor, p.trackColor, p.barHeight, p.barRadius].forEach(x => (x.visible = p.showBar.value));
        p.averageColor.visible = p.showBar.value && rate;

        s.chipsCard.separator.visible = s.chipsCard.showAttribute.value;
        s.textsCard.rateTemplate.visible = rate;
        s.textsCard.shareTemplate.visible = !rate;
        const f = s.footerCard;
        f.font.visible = f.color.visible = f.align.visible = f.show.value;
        return this.formattingSettingsService.buildFormattingModel(s);
    }

    // ------------------------------------------------------------- dados

    private analysisOptions(mode: Mode, attrCount: number): Options {
        const a = this.formattingSettings.analysisCard;
        const rank = enumValue(a.rankBy);
        return {
            mode,
            attrCount,
            maxDepth: clamp(Math.floor(a.maxDepth.value) || 1, 1, 4),
            minExits: Math.max(0, a.minExits.value),
            minLift: Math.max(0, a.minLift.value),
            zCrit: Z_CRITICAL[enumValue(a.confidence)] ?? -Infinity,
            minShare: clamp(a.minShare.value, 0, 100) / 100,
            dominance: clamp(a.dominance.value, 0, 100) / 100,
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
        this.missing = [];
        if (attrColumns.length === 0) {
            this.missing.push("Atributos (ex.: Senioridade, Liderança, Faixa de tempo de casa)");
        }
        if (!exitsColumn) {
            this.missing.push("Saídas (medida com a contagem de saídas)");
        }
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
        const options = this.analysisOptions(mode, attrColumns.length);
        const result = analyze(rows, options);

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
        const decimal = valueFormatter.create({ format: "#,0.0", cultureSelector: locale });

        const attrNames = attrColumns.map(c => c.source.displayName);
        return {
            attrNames,
            attrColumns,
            exitsName: exitsColumn.source.displayName,
            baseName: baseColumn?.source.displayName ?? "",
            mode,
            missingBase: mode === "share" && requested !== "share",
            truncated: count >= ROW_LIMIT,
            options,
            result,
            headline,
            list,
            ids,
            checks: this.checks(rows, attrNames, !!baseColumn, result, count),
            fmt: {
                exits: numberFormat(exitsColumn.source.format),
                base: numberFormat(baseColumn?.source.format),
                pct: v => pct.format(v),
                lift: v => lift.format(v) + "×",
                count: v => whole.format(Math.round(v)),
                decimal: v => decimal.format(v)
            }
        };
    }

    /** Conferência das medidas para o guia de quem desenvolve. */
    private checks(rows: Row[], attrNames: string[], hasBase: boolean, result: Result, count: number): Check[] {
        const out: Check[] = [];
        out.push({ ok: true, text: `${attrNames.length} atributo(s): ${attrNames.join(", ")}. ${count} combinações lidas.` });
        if (attrNames.length === 1) {
            out.push({ ok: "info", text: "Com um só atributo não há combinações: coloque mais atributos para encontrar perfis." });
        }
        attrNames.forEach((name, a) => {
            const distinct = new Set(rows.map(r => r.values[a])).size;
            if (distinct > MANY_VALUES) {
                out.push({ ok: false, text: `O atributo ${name} tem ${distinct} valores diferentes: prefira faixas ou agrupamentos (perfis com poucos casos não aparecem).` });
            }
        });
        const decimals = rows.filter(r => r.exits % 1 !== 0).length;
        out.push(decimals > 0
            ? { ok: false, text: `Saídas tem casas decimais em ${decimals} combinação(ões): confira se é uma contagem, e não taxa, média ou percentual.` }
            : { ok: true, text: "Saídas: contagens inteiras." });
        if (rows.some(r => r.exits < 0) || rows.some(r => r.base < 0)) {
            out.push({ ok: false, text: "Há valores negativos nas medidas: Saídas e Base precisam ser contagens." });
        }
        if (result.totals.exits <= 0) {
            out.push({ ok: false, text: "O total de Saídas é zero nos filtros atuais." });
        }
        if (!hasBase) {
            out.push({ ok: "info", text: "Sem Base: o visual mostra só a concentração. Coloque a população (ex.: headcount) para comparar taxas." });
        } else {
            const orphan = rows.filter(r => r.exits > 0 && r.base <= 0).length;
            out.push(orphan > 0
                ? { ok: false, text: `${orphan} combinação(ões) têm saídas mas Base vazia ou zero: a Base precisa incluir quem saiu (no mesmo período e com os mesmos atributos).` }
                : { ok: true, text: "Base: todas as combinações com saídas têm Base." });
            if (result.totals.rate > 1) {
                out.push({ ok: false, text: "A taxa média passa de 100%: a Base parece menor que o total de saídas (períodos diferentes?)." });
            }
        }
        if (count >= ROW_LIMIT) {
            out.push({ ok: false, text: "Chegou ao limite de 30 mil combinações: use menos atributos ou atributos com menos valores." });
        }
        return out;
    }

    // ------------------------------------------------------------- textos

    private term(): string {
        return this.formattingSettings.textsCard.term.value.trim() || "saídas";
    }

    private conditionText(model: Model, p: Pattern): string[] {
        const c = this.formattingSettings.chipsCard;
        return p.conditions.map(x => (c.showAttribute.value ? `${model.attrNames[x.attr]}${c.separator.value}${x.value}` : x.value));
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
        const h = this.formattingSettings.highlightCard;
        return model.mode === "rate"
            ? { value: model.fmt.lift(p.lift), caption: h.captionRate.value }
            : { value: model.fmt.pct(p.share), caption: h.captionShare.value };
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

    private helpContext(model: Model | undefined): HelpContext {
        const s = this.formattingSettings;
        const pop = s.popupCard;
        const o = model?.options;
        const ex = model ? model.headline ?? model.list[0] : undefined;
        const f = model?.fmt;
        const pct = (v: number): string => (f ? f.pct(v) : `${Math.round(v * 100)}%`);
        const conf = enumValue(s.analysisCard.confidence);
        return {
            mode: model?.mode ?? (enumValue(s.analysisCard.mode) === "share" ? "share" : "rate"),
            term: this.term(),
            attrNames: model?.attrNames ?? [],
            baseName: model?.baseName ?? "",
            example: model && ex && f ? {
                name: this.conditionText(model, ex).join(" · "),
                exits: f.exits(ex.exits),
                base: f.base(ex.base),
                rate: f.pct(ex.rate),
                share: f.pct(ex.share),
                lift: f.lift(ex.lift),
                expected: f.decimal(ex.expected),
                excess: f.decimal(ex.excess)
            } : undefined,
            total: model && f ? f.exits(model.result.totals.exits) : "",
            baseTotal: model && f ? f.base(model.result.totals.base) : "",
            average: model && f ? f.pct(model.result.totals.rate) : "",
            minExits: String(o?.minExits ?? s.analysisCard.minExits.value),
            minLift: f ? f.lift(o?.minLift ?? s.analysisCard.minLift.value) : `${s.analysisCard.minLift.value}×`,
            confidence: conf === "none" ? "" : `${conf}%`,
            minShare: pct(o?.minShare ?? s.analysisCard.minShare.value / 100),
            dominance: pct(o?.dominance ?? s.analysisCard.dominance.value / 100),
            rankBy: o?.rankBy ?? "excess",
            sections: {
                example: pop.showExample.value,
                rules: pop.showRules.value,
                glossary: pop.showGlossary.value,
                cautions: pop.showCautions.value
            },
            extraTitle: pop.extraTitle.value,
            extraText: pop.extraText.value
        };
    }

    // ------------------------------------------------------------- estilo

    /** Fonte da parte; se estiver na fonte padrão, segue a fonte base do cartão Geral. */
    private family(f: FontControl): string {
        const own = f.fontFamily.value;
        return !own || own === FONT ? this.formattingSettings.generalCard.fontFamily.value || FONT : own;
    }

    private applyFont(node: HTMLElement, f: FontControl, color?: string): void {
        node.style.fontFamily = this.family(f);
        node.style.fontSize = Math.max(1, f.fontSize.value) + "px";
        node.style.fontWeight = f.bold?.value ? "600" : "400";
        node.style.fontStyle = f.italic?.value ? "italic" : "normal";
        node.style.textDecoration = f.underline?.value ? "underline" : "none";
        if (color) {
            node.style.color = color;
        }
    }

    private applyBox(node: HTMLElement, b: BoxSettings): void {
        node.style.background = b.background.value.value;
        node.style.borderRadius = Math.max(0, b.radius.value) + "px";
        node.style.padding = Math.max(0, b.padding.value) + "px";
        node.style.border = b.borderWidth.value > 0 ? `${b.borderWidth.value}px solid ${b.borderColor.value.value}` : "none";
        node.style.boxShadow = b.shadow.value ? "0 1px 2px rgba(0, 0, 0, .12), 0 2px 8px rgba(0, 0, 0, .06)" : "none";
    }

    // ------------------------------------------------------------- desenho

    private render(): void {
        const root = this.root;
        root.replaceChildren();
        const s = this.formattingSettings;
        const g = s.generalCard;
        root.style.fontFamily = g.fontFamily.value || FONT;
        root.style.background = withAlpha(g.background.value.value, 1 - clamp(g.transparency.value, 0, 100) / 100);
        root.style.border = g.borderWidth.value > 0 ? `${g.borderWidth.value}px solid ${g.borderColor.value.value}` : "none";
        root.style.borderRadius = Math.max(0, g.radius.value) + "px";
        root.style.padding = Math.max(0, g.padding.value) + "px";
        root.style.gap = Math.max(0, g.gap.value) + "px";
        const model = this.model;

        const help = s.helpCard;
        const header = s.headerCard;
        const hasHeader = !!(header.title.value || header.subtitle.value);
        const position = enumValue(help.position);
        // Sem os campos, o visual mostra o guia de medidas: o botão de ajuda só aparece com dados.
        const showHelp = help.show.value && !!model;
        const helpOnTop = showHelp && (position === "top" || (position === "auto" && hasHeader));
        const helpOnBottom = showHelp && !helpOnTop;

        // ---- cabeçalho (com o botão de ajuda, se for em cima)
        if (hasHeader || helpOnTop) {
            const top = el("div", "ps-top");
            if (hasHeader) {
                top.appendChild(this.renderHeader());
            } else {
                top.appendChild(el("div", "ps-spacer"));
            }
            if (helpOnTop) {
                this.placeButton(top, this.renderHelpButton());
            }
            root.appendChild(top);
        }

        const guide = s.guideCard;
        if (!model || guide.show.value || this.guideOpen) {
            root.appendChild(this.renderGuide(model ? [] : this.missing, model?.checks ?? []));
        } else if (model.result.totals.exits <= 0) {
            this.message("Nada para analisar", `Não há ${this.term()} nos filtros atuais.`);
        } else if (!model.headline && model.list.length === 0) {
            this.message("Nenhum padrão relevante",
                model.mode === "rate"
                    ? "Nenhum perfil tem taxa de saída claramente acima da média. Tente diminuir o mínimo de saídas, " +
                      "o mínimo acima da média ou a confiança estatística (Formatar visual → Análise)."
                    : "Nenhum perfil concentra uma fatia relevante das saídas. Tente diminuir o mínimo de saídas ou a % mínima " +
                      "(Formatar visual → Análise).");
        } else {
            const body = el("div", "ps-body");
            body.style.gap = Math.max(0, g.gap.value) + "px";
            root.appendChild(body);
            if (model.headline) {
                body.appendChild(this.renderHeadline(model, model.headline));
            }
            if (model.list.length > 0) {
                const p = s.patternsCard;
                const grid = el("div", "ps-grid");
                grid.style.gap = Math.max(0, p.gap.value) + "px";
                grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(min(100%, ${Math.max(80, p.minWidth.value)}px), 1fr))`;
                const scale = model.mode === "rate"
                    ? Math.max(model.result.totals.rate, ...model.list.map(i => i.rate)) * 1.05
                    : 1;
                model.list.forEach(item => grid.appendChild(this.renderCard(model, item, scale)));
                body.appendChild(grid);
            }
        }

        // ---- rodapé (nota, aviso de medidas e, se for embaixo, o botão de ajuda)
        const footer = s.footerCard;
        const warnings = model ? model.checks.filter(c => c.ok === false).length : 0;
        const showWarning = !!model && warnings > 0 && guide.warnings.value && this.editing && !guide.show.value && !this.guideOpen;
        const showNote = !!model && footer.show.value && model.result.totals.exits > 0;
        if (showNote || showWarning || helpOnBottom) {
            const bottom = el("div", "ps-bottom");
            const left = el("div", "ps-footer-text");
            if (showNote) {
                const note = el("div", "ps-footer", this.footerText(model));
                this.applyFont(note, footer.font, footer.color.value.value);
                note.style.textAlign = enumValue(footer.align) || "left";
                left.appendChild(note);
            }
            if (showWarning) {
                const w = el("button", "ps-warning", `⚠ ${warnings} aviso(s) sobre as medidas — clique para ver o guia (só aparece na edição)`);
                this.applyFont(w, footer.font, guide.warningColor.value.value);
                w.addEventListener("click", (e: MouseEvent) => {
                    e.stopPropagation();
                    this.guideOpen = true;
                    this.render();
                });
                left.appendChild(w);
            }
            bottom.appendChild(left);
            if (helpOnBottom) {
                this.placeButton(bottom, this.renderHelpButton());
            }
            root.appendChild(bottom);
        }

        if (this.helpOpen && showHelp) {
            root.appendChild(this.renderPopup());
        }
        this.paintSelection();
    }

    private placeButton(row: HTMLElement, button: HTMLElement): void {
        if (enumValue(this.formattingSettings.helpCard.side) === "left") {
            row.insertBefore(button, row.firstChild);
            row.classList.add("ps-left");
        } else {
            row.appendChild(button);
        }
    }

    private renderHeader(): HTMLElement {
        const h = this.formattingSettings.headerCard;
        const head = el("div", "ps-header");
        head.style.textAlign = enumValue(h.align) || "left";
        head.style.background = withAlpha(h.background.value.value, 1 - clamp(h.transparency.value, 0, 100) / 100);
        head.style.padding = Math.max(0, h.padding.value) + "px";
        if (h.title.value) {
            const t = el("div", "ps-title", h.title.value);
            this.applyFont(t, h.titleFont, h.titleColor.value.value);
            head.appendChild(t);
        }
        if (h.subtitle.value) {
            const t = el("div", "ps-subtitle", h.subtitle.value);
            this.applyFont(t, h.subtitleFont, h.subtitleColor.value.value);
            head.appendChild(t);
        }
        return head;
    }

    private message(title: string, text: string): void {
        const g = this.formattingSettings.guideCard;
        const box = el("div", "ps-empty");
        this.applyBox(box, g.box);
        const t = el("div", "ps-empty-title", title);
        this.applyFont(t, g.font, g.color.value.value);
        t.style.fontSize = g.font.fontSize.value + 3 + "px";
        t.style.fontWeight = "600";
        box.appendChild(t);
        const p = el("div", "ps-empty-text", text);
        this.applyFont(p, g.font, g.color.value.value);
        box.appendChild(p);
        this.root.appendChild(box);
    }

    private chips(model: Model, p: Pattern, where: "hero" | "card"): HTMLElement {
        const c = this.formattingSettings.chipsCard[where];
        const box = el("div", "ps-chips");
        this.conditionText(model, p).forEach(text => {
            const chip = el("span", "ps-chip", text);
            chip.title = text;
            this.applyFont(chip, c.font, c.color.value.value);
            chip.style.background = c.background.value.value;
            chip.style.borderRadius = Math.max(0, c.radius.value) + "px";
            chip.style.padding = `${Math.max(0, c.paddingY.value)}px ${Math.max(0, c.paddingX.value)}px`;
            chip.style.border = c.borderWidth.value > 0 ? `${c.borderWidth.value}px solid ${c.borderColor.value.value}` : "none";
            box.appendChild(chip);
        });
        return box;
    }

    private renderHeadline(model: Model, p: Pattern): HTMLElement {
        const h = this.formattingSettings.highlightCard;
        const card = el("div", "ps-hero");
        card.dataset.key = p.key;
        card.tabIndex = 0;
        this.applyBox(card, h.box);

        const main = el("div", "ps-hero-main");
        if (h.label.value) {
            const l = el("div", "ps-hero-label", h.label.value);
            this.applyFont(l, h.labelFont, h.labelColor.value.value);
            l.style.textTransform = h.labelUppercase.value ? "uppercase" : "none";
            l.style.letterSpacing = h.labelUppercase.value ? ".04em" : "normal";
            main.appendChild(l);
        }
        main.appendChild(this.chips(model, p, "hero"));
        const text = el("div", "ps-hero-text", this.sentence(model, p));
        this.applyFont(text, h.textFont, h.textColor.value.value);
        main.appendChild(text);
        card.appendChild(main);

        if (h.showMetric.value) {
            const m = this.metric(model, p);
            const box = el("div", "ps-hero-metric");
            box.style.borderLeft = h.showDivider.value ? `1px solid ${withAlpha(h.dividerColor.value.value, .3)}` : "none";
            box.style.paddingLeft = h.showDivider.value ? "16px" : "0";
            const v = el("div", "ps-hero-value", m.value);
            this.applyFont(v, h.metricFont, h.metricColor.value.value);
            box.appendChild(v);
            if (m.caption) {
                const cap = el("div", "ps-hero-caption", m.caption);
                this.applyFont(cap, h.captionFont, h.captionColor.value.value);
                box.appendChild(cap);
            }
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
        this.applyBox(card, s.box);

        const top = el("div", "ps-card-top");
        top.appendChild(this.chips(model, p, "card"));
        if (s.showMetric.value) {
            const m = this.metric(model, p);
            const metric = el("div", "ps-card-metric", m.value);
            this.applyFont(metric, s.metricFont, s.metricColor.value.value);
            metric.title = m.caption;
            top.appendChild(metric);
        }
        card.appendChild(top);

        const text = el("div", "ps-card-text", this.sentence(model, p));
        this.applyFont(text, s.textFont, s.textColor.value.value);
        card.appendChild(text);

        if (s.showBar.value) {
            const radius = Math.max(0, s.barRadius.value) + "px";
            const track = el("div", "ps-track");
            track.style.height = Math.max(1, s.barHeight.value) + "px";
            track.style.borderRadius = radius;
            track.style.background = s.trackColor.value.value;
            const bar = el("div", "ps-bar");
            const share = model.mode === "rate" ? p.rate / scale : p.share;
            bar.style.width = (clamp(share, 0, 1) * 100).toFixed(2) + "%";
            bar.style.borderRadius = radius;
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

    // ------------------------------------------------------------- ajuda e guia

    private renderHelpButton(): HTMLElement {
        const h = this.formattingSettings.helpCard;
        const button = el("button", "ps-help");
        button.type = "button";
        const label = h.text.value.trim();
        const size = Math.max(1, h.font.fontSize.value);
        this.applyFont(button, h.font, h.color.value.value);
        button.style.background = h.background.value.value;
        button.style.borderRadius = Math.max(0, h.radius.value) + "px";
        button.style.height = Math.max(12, h.height.value) + "px";
        button.style.minWidth = Math.max(12, h.height.value) + "px";
        button.style.padding = label ? `0 ${Math.round(size * .9)}px` : "0";
        button.style.border = h.borderWidth.value > 0 ? `${h.borderWidth.value}px solid ${h.borderColor.value.value}` : "none";
        button.style.boxShadow = h.shadow.value ? "0 1px 2px rgba(0, 0, 0, .12)" : "none";
        if (h.showIcon.value || !label) {
            button.appendChild(icon(ICON_HELP, Math.round(size * 1.35)));
        }
        if (label) {
            button.appendChild(el("span", "ps-help-text", label));
        }
        button.title = label || "Como ler este visual";
        button.setAttribute("aria-label", button.title);
        button.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.setHelp(true);
        });
        return button;
    }

    private setHelp(open: boolean): void {
        this.helpOpen = open;
        this.root.querySelector(".ps-overlay")?.remove();
        if (open) {
            const popup = this.renderPopup();
            this.root.appendChild(popup);
            popup.querySelector<HTMLElement>(".ps-dialog")?.focus();
        }
    }

    private renderPopup(): HTMLElement {
        const p = this.formattingSettings.popupCard;
        const overlay = el("div", "ps-overlay");
        overlay.style.background = withAlpha(p.overlayColor.value.value, clamp(p.overlayOpacity.value, 0, 100) / 100);
        overlay.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (e.target === overlay) {
                this.setHelp(false);
            }
        });

        const dialog = el("div", "ps-dialog");
        dialog.tabIndex = -1;
        dialog.setAttribute("role", "dialog");
        this.applyBox(dialog, p.box);
        dialog.style.padding = "0";
        if (p.box.shadow.value) {
            dialog.style.boxShadow = "0 8px 28px rgba(0, 0, 0, .22)";
        }
        const width = Math.max(160, Math.min(p.width.value, this.width - 16));
        dialog.style.width = width + "px";
        dialog.classList.toggle("ps-narrow", width < 440);
        dialog.style.height = Math.max(120, Math.min(p.height.value, this.height - 16)) + "px";
        const pad = Math.max(0, p.box.padding.value);

        const head = el("div", "ps-dialog-head");
        head.style.padding = `${Math.round(pad * .75)}px ${pad}px`;
        const title = el("div", "ps-dialog-title", p.title.value || "Como ler este visual");
        this.applyFont(title, p.titleFont, p.titleColor.value.value);
        head.appendChild(title);
        const close = el("button", "ps-close");
        close.type = "button";
        close.title = "Fechar";
        close.setAttribute("aria-label", "Fechar");
        close.style.color = p.closeColor.value.value;
        close.appendChild(icon(ICON_CLOSE, 18));
        close.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.setHelp(false);
        });
        head.appendChild(close);
        dialog.appendChild(head);

        const body = el("div", "ps-dialog-body");
        body.style.padding = `0 ${pad}px ${pad}px`;
        this.renderBlocks(body, helpContent(this.helpContext(this.model)), {
            heading: [p.headingFont, p.headingColor.value.value],
            text: [p.textFont, p.textColor.value.value],
            accent: p.accent.value.value,
            accentText: p.accentText.value.value,
            code: p.accent.value.value,
            warning: p.textColor.value.value
        });
        dialog.appendChild(body);
        overlay.appendChild(dialog);
        return overlay;
    }

    private renderGuide(missing: string[], checks: Check[]): HTMLElement {
        const g = this.formattingSettings.guideCard;
        const box = el("div", "ps-guide");
        this.applyBox(box, g.box);
        const color = g.color.value.value;
        if (this.guideOpen && !g.show.value && this.model) {
            const close = el("button", "ps-guide-close", "Fechar guia");
            this.applyFont(close, g.font, color);
            close.style.borderColor = withAlpha(color, .3);
            close.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.guideOpen = false;
                this.render();
            });
            box.appendChild(close);
        }
        this.renderBlocks(box, guideContent(missing, checks), {
            heading: [g.font, color],
            text: [g.font, color],
            accent: g.codeBackground.value.value,
            accentText: color,
            code: g.codeBackground.value.value,
            warning: g.warningColor.value.value
        });
        return box;
    }

    /** Desenha os blocos de texto do pop-up e do guia. */
    private renderBlocks(container: HTMLElement, blocks: Block[], st: {
        heading: [FontControl, string]; text: [FontControl, string]; accent: string; accentText: string; code: string; warning: string;
    }): void {
        const text = (node: HTMLElement): HTMLElement => {
            this.applyFont(node, st.text[0], st.text[1]);
            return node;
        };
        let first = true;
        for (const b of blocks) {
            if (b.kind === "h") {
                const h = el("div", "ps-h", b.text);
                this.applyFont(h, st.heading[0], st.heading[1]);
                if (st.heading[0] === st.text[0]) {
                    // Guia: títulos com a mesma fonte do texto, um pouco maiores e em negrito.
                    h.style.fontSize = st.text[0].fontSize.value + (first ? 4 : 2) + "px";
                    h.style.fontWeight = "600";
                }
                if (first) {
                    h.style.marginTop = "0";
                }
                container.appendChild(h);
            } else if (b.kind === "p") {
                container.appendChild(text(el("p", "ps-p", b.text)));
            } else if (b.kind === "list") {
                const ul = el("ul", "ps-list");
                b.items.forEach(i => ul.appendChild(text(el("li", undefined, i))));
                container.appendChild(ul);
            } else if (b.kind === "terms") {
                const dl = el("dl", "ps-terms");
                b.items.forEach(([term, def]) => {
                    const dt = text(el("dt", undefined, term));
                    dt.style.fontWeight = "600";
                    dl.appendChild(dt);
                    dl.appendChild(text(el("dd", undefined, def)));
                });
                container.appendChild(dl);
            } else if (b.kind === "steps") {
                const box = el("div", "ps-steps");
                box.style.background = st.accent;
                b.items.forEach(i => {
                    const row = el("div", "ps-step");
                    const l = text(el("div", "ps-step-label", i.label));
                    l.style.color = st.accentText;
                    l.style.fontWeight = "600";
                    row.appendChild(l);
                    const expr = text(el("div", "ps-step-expr"));
                    expr.style.color = st.accentText;
                    expr.appendChild(document.createTextNode(i.expr + (i.result ? " = " : "")));
                    if (i.result) {
                        const r = el("strong", undefined, i.result);
                        r.style.fontWeight = "700";
                        expr.appendChild(r);
                    }
                    if (i.note) {
                        const n = el("div", "ps-step-note", i.note);
                        expr.appendChild(n);
                    }
                    row.appendChild(expr);
                    box.appendChild(row);
                });
                container.appendChild(box);
            } else if (b.kind === "code") {
                const pre = el("pre", "ps-code", b.text);
                pre.style.background = st.code;
                pre.style.color = st.accentText;
                pre.style.fontSize = Math.max(9, st.text[0].fontSize.value - 1) + "px";
                container.appendChild(pre);
            } else if (b.kind === "checks") {
                const ul = el("ul", "ps-checks");
                b.items.forEach(i => {
                    const li = text(el("li"));
                    const mark = el("span", "ps-check-mark", i.ok === true ? "✓" : i.ok === "info" ? "ℹ" : "⚠");
                    if (i.ok === false) {
                        li.style.color = st.warning;
                        li.style.fontWeight = "600";
                    }
                    li.appendChild(mark);
                    li.appendChild(document.createTextNode(i.text));
                    ul.appendChild(li);
                });
                container.appendChild(ul);
            }
            first = false;
        }
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
        const dim = String(clamp(this.formattingSettings.patternsCard.selectedOpacity.value, 0, 100) / 100);
        this.root.querySelectorAll<HTMLElement>("[data-key]").forEach(node => {
            const id = model.ids.get(node.dataset.key || "");
            const on = selected.length === 0 || (!!id && selected.some(sel => sel.equals(id)));
            node.style.opacity = on ? "1" : dim;
        });
    }
}
