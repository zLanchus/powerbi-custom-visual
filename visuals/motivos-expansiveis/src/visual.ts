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

import { Formatter, Item, Model, buildModel, rawValue } from "./model";
import { FONT, Font, HINT_TEXT, NO_RESULT_TEMPLATE, VisualFormattingSettingsModel, enumValue } from "./settings";

/** Um motivo como aparece na lista (depois de ordenar e pesquisar). */
interface ReasonView {
    reason: Item;
    rank: number;
    /** Todos os detalhamentos exibíveis do motivo, ordenados (base da faixa de composição). */
    allDetails: Item[];
    /** Detalhamentos que aparecem (todos, ou só os que batem com a pesquisa). */
    details: Item[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
    chevron: ["M6 9l6 6 6-6"],
    search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-4.3-4.3"],
    clear: ["M18 6L6 18", "M6 6l12 12"],
    expandAll: ["M7 6l5 5 5-5", "M7 13l5 5 5-5"],
    collapseAll: ["M7 11l5-5 5 5", "M7 18l5-5 5 5"],
    arrowLeft: ["M19 12H5", "M11 18l-6-6 6-6"],
    insight: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"]
};

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

function icon(paths: string[], className = "me-icon"): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

/** Texto sem acentos e em minúsculas, com o índice de cada caractere no texto original. */
function fold(text: string): { folded: string; map: number[] } {
    let folded = "";
    const map: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const f = text[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        for (let k = 0; k < f.length; k++) {
            folded += f[k];
            map.push(i);
        }
    }
    return { folded, map };
}

const foldQuery = (query: string): string => fold(query.trim()).folded;
const matches = (label: string, query: string): boolean => !query || fold(label).folded.includes(query);

/** Escreve o texto em `node`, marcando os trechos que batem com a pesquisa. */
function writeHighlighted(node: HTMLElement, label: string, query: string): void {
    if (!query) {
        node.textContent = label;
        return;
    }
    const { folded, map } = fold(label);
    let last = 0;
    let at = folded.indexOf(query);
    while (at >= 0) {
        const start = map[at];
        const end = map[at + query.length - 1] + 1;
        if (start > last) {
            node.appendChild(document.createTextNode(label.slice(last, start)));
        }
        node.appendChild(el("mark", "me-mark", label.slice(start, end)));
        last = end;
        at = folded.indexOf(query, at + query.length);
    }
    if (last < label.length) {
        node.appendChild(document.createTextNode(label.slice(last)));
    }
}

/** Largura aproximada de um texto (para alinhar a coluna de valores). */
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

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private toolbar: HTMLElement;
    private searchBox: HTMLElement;
    private searchIcon: SVGSVGElement;
    private searchInput: HTMLInputElement;
    private searchCount: HTMLElement;
    private searchClear: HTMLButtonElement;
    private expandAllButton: HTMLButtonElement;
    private collapseAllButton: HTMLButtonElement;
    private list: HTMLElement;
    /** Layout horizontal: coluna de motivos, ligações e painel do detalhamento. */
    private leftScroll: HTMLElement | undefined;
    private links: SVGSVGElement | undefined;
    private panel: HTMLElement | undefined;
    private panelFiguresW = 0;
    private linkFrame = 0;

    private model: Model | undefined;
    /** Formatador dos valores da renderização atual. */
    private fmt: Formatter = v => String(v);
    private views: ReasonView[] = [];
    private ids = new Map<string, ISelectionId>();
    private locale = "pt-BR";
    private width = 0;

    /** Motivos abertos (fora da pesquisa) e abertos durante a pesquisa. */
    private expanded = new Set<string>();
    private searchOpen = new Set<string>();
    /** Motivos com todos os detalhamentos à mostra ("Ver mais"). */
    private showAllDetails = new Set<string>();
    private showAllReasons = false;
    private query = "";
    /** Seleção atual: chave do motivo ou do detalhamento → identidade. */
    private selected = new Map<string, ISelectionId>();
    /** Quando muda, o estado inicial (abertos/fechados) é aplicado de novo. */
    private initialKey = "";

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "me-root");
        options.element.appendChild(this.root);
        this.buildToolbar();
        this.list = el("div", "me-list");
        this.list.setAttribute("role", "tree");

        // Menu do botão direito do Power BI (fora dos itens).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando),
        // exceto na caixa de pesquisa.
        this.root.addEventListener("mousedown", (e: MouseEvent) => {
            if (!(e.target as Element).closest("input")) {
                e.preventDefault();
            }
        });
        // Clique no vazio limpa a seleção.
        this.list.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as Element).closest(".me-head, .me-detail, .me-more")) {
                this.setSelection([]);
            }
        });
        this.list.addEventListener("keydown", (e: KeyboardEvent) => this.onListKey(e));
        this.selectionManager.registerOnSelectCallback((ids: ISelectionId[]) => this.syncSelection(ids));
    }

    // ---------------------------------------------------------------- update

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            const palette = this.host.colorPalette;
            if (palette?.isHighContrast) {
                this.formattingSettings.applyHighContrast(palette.foreground.value, palette.background.value);
            }
            this.locale = this.host.locale || "pt-BR";
            this.width = options.viewport.width;
            this.model = buildModel(dataView, this.locale);
            this.buildIds();
            this.applyInitialState();
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        // Os grupos com chave (Resumo, Posição, Seta…) já ficam desativados quando a chave está desligada.
        s.generalCard.background.visible = s.generalCard.showBackground.value;
        s.interactionCard.duration.visible = s.interactionCard.animate.value;
        s.reasonBarsCard.highlightColor.visible = s.reasonBarsCard.highlightTop.value;
        s.insightCard.iconColor.visible = s.insightCard.showIcon.value;
        return this.formattingSettingsService.buildFormattingModel(s);
    }

    // ------------------------------------------------------------- dados

    private buildIds(): void {
        this.ids.clear();
        const model = this.model;
        if (!model) {
            return;
        }
        const add = (item: Item): void => {
            this.ids.set(item.key, this.host.createSelectionIdBuilder()
                .withMatrixNode(item.node, model.rowLevels)
                .createSelectionId());
        };
        for (const reason of model.reasons) {
            add(reason);
            reason.children.forEach(add);
        }
        // A seleção guardada passa a usar as identidades novas; o que sumiu dos dados sai da seleção.
        for (const key of Array.from(this.selected.keys())) {
            const id = this.ids.get(key);
            if (id) {
                this.selected.set(key, id);
            } else {
                this.selected.delete(key);
            }
        }
    }

    /** Abre o primeiro motivo, todos ou nenhum: ao carregar, ao trocar os campos ou ao mudar a opção. */
    private applyInitialState(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const initial = enumValue(this.formattingSettings.interactionCard.initial);
        const key = model.signature + "\u001e" + initial + "\u001e" + this.horizontal();
        if (key === this.initialKey) {
            return;
        }
        this.initialKey = key;
        this.expanded.clear();
        this.showAllDetails.clear();
        this.showAllReasons = false;
        const expandable = this.sorted(model.reasons).filter(r => this.detailsOf(r).length > 0);
        if (initial === "all") {
            expandable.forEach(r => this.expanded.add(r.key));
        } else if (initial === "first" && expandable.length > 0) {
            this.expanded.add(expandable[0].key);
        }
    }

    /** Ordena motivos ou detalhamentos conforme o cartão Ordenação. */
    private sorted(items: Item[]): Item[] {
        const s = this.formattingSettings.sortCard;
        const orderBy = enumValue(s.orderBy);
        let direction = enumValue(s.direction);
        if (direction === "auto") {
            direction = orderBy === "value" ? "desc" : "asc";
        }
        const sign = direction === "desc" ? -1 : 1;
        const copy = items.slice();
        if (orderBy === "value") {
            // Vazios sempre no fim.
            copy.sort((a, b) => {
                if (a.value === null || b.value === null) {
                    return a.value === b.value ? a.order - b.order : a.value === null ? 1 : -1;
                }
                return sign * (a.value - b.value) || a.order - b.order;
            });
        } else if (orderBy === "name") {
            copy.sort((a, b) => (a.blank !== b.blank ? (a.blank ? 1 : -1)
                : sign * a.label.localeCompare(b.label, this.locale, { numeric: true, sensitivity: "base" }) || a.order - b.order));
        } else if (direction === "desc") {
            copy.reverse();
        }
        return copy;
    }

    /** Detalhamentos exibíveis de um motivo (sem os em branco, se a opção estiver desligada). */
    private detailsOf(reason: Item): Item[] {
        const showBlank = this.formattingSettings.detailsCard.showBlank.value;
        return reason.children.filter(d => showBlank || !d.blank);
    }

    private computeViews(): ReasonView[] {
        const model = this.model;
        if (!model) {
            return [];
        }
        const query = foldQuery(this.query);
        const views: ReasonView[] = [];
        this.sorted(model.reasons).forEach((reason, i) => {
            const allDetails = this.sorted(this.detailsOf(reason));
            const reasonMatch = matches(reason.label, query);
            const detailMatches = query ? allDetails.filter(d => matches(d.label, query)) : allDetails;
            if (!reasonMatch && detailMatches.length === 0) {
                return;
            }
            views.push({ reason, rank: i + 1, allDetails, details: reasonMatch ? allDetails : detailMatches });
        });
        return views;
    }

    /** Layout horizontal (detalhamento ao lado), a não ser que o visual esteja estreito demais. */
    private horizontal(): boolean {
        const lay = this.formattingSettings.layoutCard;
        const breakpoint = Math.max(0, lay.breakpoint.value);
        // Sem o campo Detalhamento não há painel ao lado: vira um ranking simples.
        return enumValue(lay.mode) === "horizontal" && (breakpoint === 0 || this.width >= breakpoint) && !!this.model?.hasDetail;
    }

    /** Motivo cujo detalhamento aparece no painel (layout horizontal). */
    private activeView(): ReasonView | undefined {
        const open = this.views.find(v => this.isOpen(v.reason.key));
        if (open || !this.query.trim()) {
            return open;
        }
        // Na pesquisa, sem motivo escolhido, mostra o primeiro que tem detalhamento.
        return this.views.find(v => v.allDetails.length > 0);
    }

    /** Visual estreito: sem contador e com a barra do detalhamento embaixo do nome. */
    private isCompact(): boolean {
        return this.width > 0 && this.width < 380;
    }

    private isOpen(key: string): boolean {
        return this.query.trim() ? this.searchOpen.has(key) : this.expanded.has(key);
    }

    private openSet(): Set<string> {
        return this.query.trim() ? this.searchOpen : this.expanded;
    }

    // ------------------------------------------------------------- textos e números

    /** Fonte de um texto: a escolhida nele ou, se ficou a padrão, a fonte base do cartão Geral. */
    private family(font: Font): string {
        const f = font.fontFamily.value;
        return f && f !== FONT ? f : this.formattingSettings.generalCard.fontFamily.value || FONT;
    }

    /** Aplica fonte, tamanho, negrito, itálico, sublinhado e cor num elemento. */
    private applyFont(node: HTMLElement, font: Font, color: string, size = font.fontSize.value, boldWeight = "600"): void {
        node.style.fontFamily = this.family(font);
        node.style.fontSize = Math.max(6, size) + "px";
        node.style.fontWeight = font.bold?.value ? boldWeight : "400";
        node.style.fontStyle = font.italic?.value ? "italic" : "normal";
        node.style.textDecoration = font.underline?.value ? "underline" : "none";
        node.style.color = color;
    }

    /** Formatador dos valores: formato da medida, ou unidades de exibição e casas decimais escolhidas. */
    private valueFormatter(model: Model): Formatter {
        const v = this.formattingSettings.valuesCard;
        const units = enumValue(v.displayUnits);
        const decimals = Math.floor(v.valueDecimals.value);
        if (units === "none" && decimals < 0) {
            return model.value.format;
        }
        const largest = Math.max(Math.abs(model.total ?? 0), ...model.reasons.map(r => Math.abs(r.value ?? 0)));
        const auto = units === "auto"
            ? (largest >= 1e9 ? "billions" : largest >= 1e6 ? "millions" : largest >= 1e3 ? "thousands" : "none")
            : units;
        const [unit, suffix] = auto === "billions" ? [1e9, " bi"] : auto === "millions" ? [1e6, " mi"]
            : auto === "thousands" ? [1e3, " mil"] : [1, ""];
        if (unit === 1 && decimals < 0) {
            return model.value.format;
        }
        // Com unidade e sem casas definidas, até 1 casa (ex.: 1,2 mil); com casas definidas, sempre elas.
        const places = decimals >= 0 ? "0".repeat(Math.min(decimals, 6)) : unit > 1 ? "#" : "";
        const f = valueFormatter.create({ format: "#,0" + (places ? "." + places : ""), cultureSelector: this.locale });
        return x => (typeof x === "number" ? f.format(x / unit) + suffix : x === null || x === undefined ? "—" : String(x));
    }

    private percentFormatter(): (share: number | null) => string {
        const v = this.formattingSettings.valuesCard;
        const decimals = Math.max(0, Math.min(4, Math.floor(v.decimals.value)));
        const format = "0" + (decimals > 0 ? "." + "0".repeat(decimals) : "") + "%";
        const f = valueFormatter.create({ format, cultureSelector: this.locale });
        return share => (share === null || !isFinite(share) ? "—" : f.format(share));
    }

    /** Percentual ao lado do valor, no estilo escolhido: 33,0% · (33,0%) · · 33,0%. */
    private percentLabel(share: number | null): string {
        const t = this.percentFormatter()(share);
        const style = enumValue(this.formattingSettings.valuesCard.percentStyle);
        return style === "paren" ? `(${t})` : style === "dot" ? `· ${t}` : t;
    }

    private share(part: number | null, whole: number | null): number | null {
        return part === null || whole === null || whole === 0 ? null : part / whole;
    }

    /** Percentual exibido ao lado do item. */
    private percentOf(item: Item): number | null {
        const model = this.model;
        if (!item.parent) {
            return this.share(item.value, model?.total ?? null);
        }
        const base = enumValue(this.formattingSettings.detailsCard.percentBase);
        return this.share(item.value, base === "total" ? model?.total ?? null : item.parent.value);
    }

    private countLabel(n: number): string {
        const r = this.formattingSettings.reasonsCard;
        return `${n} ${n === 1 ? r.countSingular.value || "detalhamento" : r.countPlural.value || "detalhamentos"}`;
    }

    // ------------------------------------------------------------- desenho

    private buildToolbar(): void {
        this.toolbar = el("div", "me-toolbar");

        this.searchBox = el("label", "me-search");
        this.searchIcon = icon(ICONS.search, "me-icon me-search-icon");
        this.searchBox.appendChild(this.searchIcon);
        this.searchInput = el("input", "me-search-input");
        this.searchInput.type = "text";
        this.searchInput.setAttribute("aria-label", "Pesquisar");
        this.searchInput.addEventListener("input", () => this.onSearch(this.searchInput.value));
        this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Escape" && this.searchInput.value) {
                e.stopPropagation();
                this.searchInput.value = "";
                this.onSearch("");
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                this.list.querySelector<HTMLElement>(".me-head")?.focus();
            }
        });
        this.searchBox.appendChild(this.searchInput);
        this.searchCount = el("span", "me-search-count");
        this.searchBox.appendChild(this.searchCount);
        this.searchClear = el("button", "me-icon-button me-search-clear");
        this.searchClear.type = "button";
        this.searchClear.title = "Limpar pesquisa";
        this.searchClear.appendChild(icon(ICONS.clear));
        this.searchClear.addEventListener("click", (e: MouseEvent) => {
            e.preventDefault();
            this.searchInput.value = "";
            this.onSearch("");
        });
        this.searchBox.appendChild(this.searchClear);
        this.toolbar.appendChild(this.searchBox);

        const button = (paths: string[], title: string, open: boolean): HTMLButtonElement => {
            const b = el("button", "me-icon-button me-tool");
            b.type = "button";
            b.title = title;
            b.setAttribute("aria-label", title);
            b.appendChild(icon(paths));
            b.addEventListener("click", () => this.setAll(open));
            this.toolbar.appendChild(b);
            return b;
        };
        this.expandAllButton = button(ICONS.expandAll, "Abrir todos", true);
        this.collapseAllButton = button(ICONS.collapseAll, "Fechar todos", false);
    }

    private render(): void {
        const root = this.root;
        const scrollTop = this.list.scrollTop;
        const searchFocused = document.activeElement === this.searchInput;
        root.replaceChildren();
        const s = this.formattingSettings;
        const g = s.generalCard;
        root.style.fontFamily = g.fontFamily.value || FONT;
        root.style.background = g.showBackground.value ? g.background.value.value : "transparent";
        root.style.padding = Math.max(0, g.padding.value) + "px";
        root.classList.toggle("no-anim", !s.interactionCard.animate.value);
        root.classList.toggle("is-compact", this.isCompact());
        root.classList.toggle("wrap-reasons", s.reasonsCard.wrap.value);
        root.classList.toggle("wrap-details", s.detailsCard.wrap.value);
        root.style.setProperty("--me-dur", Math.max(0, Math.min(3000, s.interactionCard.duration.value)) + "ms");
        // Cor de destaque (foco do teclado) = cor da barra dos motivos.
        root.style.setProperty("--me-accent", s.reasonBarsCard.fill.value.value);
        root.style.setProperty("--me-mark", s.toolbarCard.markColor.value.value);
        const model = this.model;

        this.renderHeader(model);

        if (!model || model.reasons.length === 0) {
            const empty = el("div", "me-empty");
            empty.appendChild(el("div", "me-empty-title", "Motivos Expansíveis"));
            empty.appendChild(el("div", "me-empty-text",
                "Coloque o campo do motivo em Motivo principal, o do detalhamento em Detalhamento e uma medida em Valor " +
                "(ex.: Contagem de respostas)."));
            root.appendChild(empty);
            return;
        }

        this.fmt = this.valueFormatter(model);
        this.styleToolbar(model);
        const insight = this.renderInsight(model);
        const top = insight && enumValue(s.insightCard.position) === "top";
        if (insight && top) {
            insight.style.marginBottom = "10px";
            root.appendChild(insight);
        }
        root.appendChild(this.list);
        if (insight && !top) {
            insight.style.marginTop = "10px";
            root.appendChild(insight);
        }
        this.renderList();
        this.list.scrollTop = scrollTop;
        if (searchFocused) {
            this.searchInput.focus();
        }
    }

    private renderHeader(model: Model | undefined): void {
        const header = this.formattingSettings.headerCard;
        const summary = model && header.showSummary.value ? this.summaryText(model) : "";
        if (!header.title.value && !header.subtitle.value && !summary) {
            return;
        }
        const head = el("div", "me-header");
        head.style.textAlign = header.align.value || "left";
        head.style.marginBottom = Math.max(0, header.spacing.value) + "px";
        const line = (value: string, className: string, font: Font, color: string, boldWeight = "600"): void => {
            if (value) {
                const t = el("div", className, value);
                this.applyFont(t, font, color, font.fontSize.value, boldWeight);
                head.appendChild(t);
            }
        };
        line(header.title.value, "me-title", header.titleFont, header.titleColor.value.value, "700");
        line(header.subtitle.value, "me-subtitle", header.subtitleFont, header.subtitleColor.value.value);
        line(summary, "me-summary", header.summaryFont, header.summaryColor.value.value);
        this.root.appendChild(head);
    }

    private summaryText(model: Model): string {
        const template = this.formattingSettings.headerCard.summary.value || "";
        const details = model.reasons.reduce((n, r) => n + this.detailsOf(r).length, 0);
        return template
            .replace(/\{total\}/gi, this.valueFormatter(model)(model.total))
            .replace(/\{motivos\}/gi, String(model.reasons.length))
            .replace(/\{detalhamentos\}/gi, String(details))
            .trim();
    }

    private styleToolbar(model: Model): void {
        const t = this.formattingSettings.toolbarCard;
        const showSearch = t.showSearch.value;
        const showButtons = t.showExpandAll.value && model.hasDetail && !this.horizontal();
        if (!showSearch && !showButtons) {
            return;
        }
        const height = Math.max(20, t.height.value);
        const shape = (node: HTMLElement, fill: string, radius: number, border: number, borderColor: string): void => {
            node.style.height = height + "px";
            node.style.borderRadius = Math.min(Math.max(0, radius), height / 2) + "px";
            node.style.background = fill;
            node.style.boxShadow = border > 0 ? `inset 0 0 0 ${border}px ${borderColor}` : "";
        };

        this.searchBox.style.display = showSearch ? "" : "none";
        shape(this.searchBox, t.fill.value.value, t.radius.value, t.borderWidth.value, t.borderColor.value.value);
        this.searchBox.style.color = t.fontColor.value.value;
        this.searchIcon.style.color = t.iconColor.value.value;
        this.searchInput.placeholder = t.placeholder.value || "";
        this.applyFont(this.searchInput, t.searchFont, t.fontColor.value.value);
        this.searchCount.style.fontSize = Math.max(9, t.searchFont.fontSize.value - 2) + "px";

        for (const b of [this.expandAllButton, this.collapseAllButton]) {
            b.style.display = showButtons ? "" : "none";
            shape(b, t.buttonFill.value.value, t.buttonRadius.value, t.buttonBorderWidth.value, t.buttonBorderColor.value.value);
            b.style.color = t.buttonIconColor.value.value;
            b.style.width = height + "px";
            b.classList.toggle("has-shadow", t.buttonShadow.value);
            if (t.buttonShadow.value && t.buttonBorderWidth.value > 0) {
                b.style.boxShadow = `inset 0 0 0 ${t.buttonBorderWidth.value}px ${t.buttonBorderColor.value.value}, 0 1px 2px rgba(0, 0, 0, .12)`;
            } else if (t.buttonShadow.value) {
                b.style.boxShadow = "0 1px 2px rgba(0, 0, 0, .12)";
            }
        }
        this.toolbar.style.marginBottom = "10px";
        this.root.appendChild(this.toolbar);
    }

    /** Monta a lista de motivos (chamado também ao pesquisar e no "Ver mais"). */
    private renderList(): void {
        const model = this.model;
        const list = this.list;
        const leftTop = this.leftScroll?.scrollTop ?? 0;
        list.replaceChildren();
        list.classList.remove("is-split");
        this.leftScroll = this.links = this.panel = undefined;
        if (!model) {
            return;
        }
        const s = this.formattingSettings;
        const query = foldQuery(this.query);
        const horizontal = this.horizontal();
        this.views = this.computeViews();

        // Pesquisa: contador e botão de limpar.
        this.searchClear.style.visibility = this.query ? "visible" : "hidden";
        this.searchCount.textContent = query ? plural(this.views.length, "motivo", "motivos") : "";

        if (this.views.length === 0) {
            const template = s.toolbarCard.noResult.value || NO_RESULT_TEMPLATE;
            const message = el("div", "me-noresult", template.replace(/\{pesquisa\}/gi, this.query.trim()));
            message.style.color = s.reasonsCard.fontColor.value.value;
            list.appendChild(message);
            return;
        }

        const limit = Math.floor(s.reasonsCard.maxItems.value);
        const limited = !query && !this.showAllReasons && limit > 0 && this.views.length > limit;
        const views = limited ? this.views.slice(0, limit) : this.views;

        // Largura da coluna de valores, igual em todos os motivos (e em todos os detalhamentos).
        const v = s.valuesCard;
        // No horizontal, cada coluna tem a sua largura; no vertical, a lista ocupa tudo.
        const lay = s.layoutCard;
        const linkW = Math.max(0, lay.linkWidth.value);
        const leftShare = Math.min(80, Math.max(20, lay.leftWidth.value)) / 100;
        const available = Math.max(0, this.width - 2 * Math.max(0, s.generalCard.padding.value) - linkW);
        const reasonsW = horizontal ? available * leftShare : this.width;
        const detailsW = horizontal ? available - available * leftShare : this.width;
        const figuresWidth = (items: Item[], valueSize: number, percentSize: number, columnW: number): number => {
            if (!v.showValue.value && !v.showPercent.value) {
                return 0;
            }
            const valueFamily = this.family(v.valueFont);
            const percentFamily = this.family(v.percentFont);
            const w = Math.max(0, ...items.map(item => {
                const a = v.showValue.value ? textWidth(this.fmt(item.value), valueSize, valueFamily, !!v.valueFont.bold?.value) : 0;
                const b = v.showPercent.value
                    ? textWidth(this.percentLabel(this.percentOf(item)), percentSize, percentFamily, !!v.percentFont.bold?.value) : 0;
                return a + b + (a && b ? 8 : 0);
            }));
            return Math.ceil(Math.min(w + 6, Math.max(60, columnW * 0.45)));
        };
        const reasonFigures = figuresWidth(views.map(view => view.reason), v.valueFont.fontSize.value, v.percentFont.fontSize.value,
            reasonsW);
        const detailFigures = figuresWidth(views.flatMap(view => view.details), v.detailValueFontSize.value,
            v.detailPercentFontSize.value, detailsW);

        const maxReason = Math.max(0, ...model.reasons.map(r => r.value ?? 0));
        const cards = views.map(view => this.renderReason(view, maxReason, reasonFigures, detailFigures, query, !horizontal));
        if (limited) {
            cards.push(this.moreButton(`Ver mais ${plural(this.views.length - limit, "motivo", "motivos")}`, () => {
                this.showAllReasons = true;
                this.renderList();
            }, "me-more-reasons"));
        } else if (!query && this.showAllReasons && limit > 0 && this.views.length > limit) {
            cards.push(this.moreButton("Ver menos motivos", () => {
                this.showAllReasons = false;
                this.renderList();
            }, "me-more-reasons"));
        }

        if (horizontal) {
            this.panelFiguresW = detailFigures;
            this.renderSplit(model, cards, linkW, leftShare);
            if (this.leftScroll) {
                this.leftScroll.scrollTop = leftTop;
            }
        } else {
            cards.forEach(card => list.appendChild(card));
        }
        this.paintSelection();
    }

    private columnTitle(label: string): HTMLElement {
        const lay = this.formattingSettings.layoutCard;
        const t = el("div", "me-coltitle", label);
        this.applyFont(t, lay.columnTitleFont, lay.columnTitleColor.value.value, lay.columnTitleFont.fontSize.value, "700");
        t.style.textTransform = lay.uppercase.value ? "uppercase" : "none";
        return t;
    }

    /** Layout horizontal: motivos à esquerda, ligações no meio e o detalhamento do motivo escolhido à direita. */
    private renderSplit(model: Model, cards: HTMLElement[], linkW: number, leftShare: number): void {
        const lay = this.formattingSettings.layoutCard;
        const list = this.list;
        list.classList.add("is-split");
        const ring = Math.max(0, lay.activeBorderWidth.value);
        list.style.setProperty("--me-active-ring", ring > 0 ? `inset 0 0 0 ${ring}px ${lay.activeBorderColor.value.value}` : "0 0 0 0 transparent");

        const left = el("div", "me-col me-col-left");
        left.style.flex = `0 0 calc((100% - ${linkW}px) * ${leftShare})`;
        const right = el("div", "me-col me-col-right");
        if (lay.showColumnTitles.value) {
            left.appendChild(this.columnTitle(lay.reasonsTitle.value || model.reasonName));
            right.appendChild(this.columnTitle(lay.detailsTitle.value || model.detailName || "Detalhamento"));
        }
        const leftScroll = el("div", "me-col-scroll");
        cards.forEach(card => leftScroll.appendChild(card));
        left.appendChild(leftScroll);
        const links = document.createElementNS(SVG_NS, "svg");
        links.setAttribute("class", "me-links");
        links.setAttribute("aria-hidden", "true");
        links.style.width = linkW + "px";
        const panel = el("div", "me-col-scroll me-panel");
        right.appendChild(panel);
        list.append(left, links, right);
        this.leftScroll = leftScroll;
        this.links = links;
        this.panel = panel;

        // As ligações acompanham a rolagem das duas colunas.
        const redraw = (): void => {
            cancelAnimationFrame(this.linkFrame);
            this.linkFrame = requestAnimationFrame(() => this.drawLinks(false));
        };
        leftScroll.addEventListener("scroll", redraw);
        panel.addEventListener("scroll", redraw);
        this.renderPanel(false);
    }

    /** Monta o painel do detalhamento do motivo escolhido. */
    private renderPanel(animate: boolean): void {
        const panel = this.panel;
        if (!panel) {
            return;
        }
        const s = this.formattingSettings;
        const lay = s.layoutCard;
        const view = this.activeView();
        this.leftScroll?.querySelectorAll<HTMLElement>(".me-card").forEach(card => {
            const on = card.dataset.key === view?.reason.key;
            card.classList.toggle("is-active", on);
            card.style.background = this.cardBackground(on);
            const head = card.querySelector<HTMLElement>(".me-head.is-expandable");
            head?.setAttribute("aria-expanded", String(on));
        });
        panel.replaceChildren();
        panel.classList.remove("is-open");
        panel.scrollTop = 0;

        const hint = (text: string, arrow: boolean): void => {
            const h = el("div", "me-hint");
            if (arrow) {
                h.appendChild(icon(ICONS.arrowLeft));
            }
            h.appendChild(el("span", "", text));
            h.style.color = lay.columnTitleColor.value.value;
            h.style.fontFamily = this.family(s.detailsCard.detailFont);
            panel.appendChild(h);
        };
        if (!view) {
            hint(lay.hint.value || HINT_TEXT, true);
            this.drawLinks(false);
            return;
        }
        if (lay.showActiveHeader.value) {
            const head = el("div", "me-active");
            const title = el("div", "me-active-title", view.reason.label);
            this.applyFont(title, lay.activeFont, lay.activeColor.value.value, lay.activeFont.fontSize.value, "700");
            head.appendChild(title);
            const parts = [this.fmt(view.reason.value), `${this.percentFormatter()(this.percentOf(view.reason))} do total`];
            if (view.allDetails.length > 0) {
                parts.push(this.countLabel(view.allDetails.length));
            }
            const sub = el("div", "me-active-sub", parts.join(" · "));
            sub.style.color = s.valuesCard.percentColor.value.value;
            sub.style.fontFamily = this.family(s.valuesCard.percentFont);
            sub.style.fontSize = Math.max(10, Math.round(lay.activeFont.fontSize.value * 0.65)) + "px";
            head.appendChild(sub);
            panel.appendChild(head);
        }
        if (view.allDetails.length === 0) {
            hint("Este motivo não tem detalhamento.", false);
        } else {
            panel.appendChild(this.renderDetails(view, this.panelFiguresW, foldQuery(this.query)));
        }
        this.paintSelection();
        const show = (): void => {
            panel.classList.add("is-open");
            this.drawLinks(animate);
        };
        if (animate && s.interactionCard.animate.value) {
            // Um quadro depois, para as barras crescerem a partir do zero.
            requestAnimationFrame(show);
        } else {
            show();
        }
    }

    /** Desenha as ligações do motivo escolhido para cada detalhamento (faixas com grossura proporcional ao valor). */
    private drawLinks(animate: boolean): void {
        const svg = this.links;
        const panel = this.panel;
        const leftScroll = this.leftScroll;
        if (!svg || !panel || !leftScroll || !svg.isConnected) {
            return;
        }
        svg.replaceChildren();
        const s = this.formattingSettings;
        const lay = s.layoutCard;
        const view = this.activeView();
        const head = leftScroll.querySelector<HTMLElement>(".me-card.is-active .me-head");
        const box = svg.getBoundingClientRect();
        const W = box.width;
        if (!lay.showLinks.value || !view || !head || W <= 0) {
            return;
        }
        const leftRect = leftScroll.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const clamp = (y: number, r: DOMRect): number => Math.min(r.bottom - box.top, Math.max(r.top - box.top, y));
        const center = (node: Element): number => {
            const r = node.getBoundingClientRect();
            return r.top + r.height / 2 - box.top;
        };

        // Destinos: cada linha de detalhamento e, se houver, o "+ N" com o que ficou escondido.
        const targets: Array<{ key: string; value: number; y: number; x: number }> = [];
        const shown = new Set<string>();
        const guide = s.detailsCard.showGuide.value ? 5 : 0;
        panel.querySelectorAll<HTMLElement>(".me-detail").forEach(row => {
            const key = row.dataset.key || "";
            shown.add(key);
            const item = view.details.find(d => d.key === key);
            // A faixa termina na linha guia do detalhamento.
            targets.push({ key, value: Math.max(0, item?.value ?? 0), y: center(row), x: row.getBoundingClientRect().left - box.left + guide });
        });
        const more = panel.querySelector<HTMLElement>(".me-details > .me-more");
        const rest = view.details.filter(d => !shown.has(d.key)).reduce((sum, d) => sum + Math.max(0, d.value ?? 0), 0);
        if (more && rest > 0) {
            targets.push({ key: "#more", value: rest, y: center(more), x: more.getBoundingClientRect().left - box.left });
        }
        if (targets.length === 0) {
            return;
        }

        // A banda inteira é o motivo: se a pesquisa esconde detalhamentos, as faixas que sobram ficam proporcionais.
        const total = Math.max(targets.reduce((sum, t) => sum + t.value, 0), view.reason.value ?? 0);
        const ribbon = enumValue(lay.linkStyle) === "ribbon";
        const color = lay.linkColor.value.value;
        const opacity = Math.min(100, Math.max(0, lay.linkOpacity.value)) / 100;
        const headRect = head.getBoundingClientRect();
        const band = Math.max(4, headRect.height * 0.66);
        let y = headRect.top + (headRect.height - band) / 2 - box.top;
        const source = clamp(headRect.top + headRect.height / 2 - box.top, leftRect);
        const g = document.createElementNS(SVG_NS, "g");
        if (animate && s.interactionCard.animate.value) {
            g.setAttribute("class", "me-links-anim");
        }
        // A faixa sai da borda do cartão do motivo.
        const x0 = Math.min(0, headRect.right - box.left);
        for (const t of targets) {
            const x1 = Math.max(W, t.x);
            const mid = (x0 + x1) / 2;
            const share = total > 0 ? t.value / total : 1 / targets.length;
            const path = document.createElementNS(SVG_NS, "path");
            path.setAttribute("class", "me-link");
            path.setAttribute("data-key", t.key);
            const ty = clamp(t.y, panelRect);
            if (ribbon) {
                // Na origem as faixas se empilham (somam a altura da banda); no destino, centradas na linha.
                const th = Math.max(1.5, band * share);
                const s0 = clamp(y, leftRect);
                const s1 = clamp(y + th, leftRect);
                y += th;
                const a = ty - th / 2;
                const b = ty + th / 2;
                path.setAttribute("d",
                    `M${x0} ${s0} C${mid} ${s0} ${mid} ${a} ${x1} ${a} L${x1} ${b} C${mid} ${b} ${mid} ${s1} ${x0} ${s1} Z`);
                path.setAttribute("fill", color);
                path.setAttribute("fill-opacity", String(opacity));
            } else {
                path.setAttribute("d", `M${x0} ${source} C${mid} ${source} ${mid} ${ty} ${x1} ${ty}`);
                path.setAttribute("fill", "none");
                path.setAttribute("stroke", color);
                path.setAttribute("stroke-width", "1.6");
                path.setAttribute("stroke-opacity", String(Math.min(1, opacity * 2)));
            }
            g.appendChild(path);
        }
        svg.appendChild(g);
        this.paintSelection();
    }

    private moreButton(label: string, action: () => void, extraClass = ""): HTMLButtonElement {
        const b = el("button", "me-more " + extraClass, label);
        b.type = "button";
        b.style.color = this.formattingSettings.detailsCard.moreColor.value.value;
        b.style.fontFamily = this.family(this.formattingSettings.detailsCard.detailFont);
        b.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            action();
        });
        return b;
    }

    private bar(value: number | null, base: number | null, fill: string, track: string, thickness: number, radius: number,
        className: string): HTMLElement {
        const t = el("div", "me-track " + className);
        t.style.height = thickness + "px";
        t.style.borderRadius = radius + "px";
        t.style.background = track;
        const b = el("div", "me-bar");
        const share = value !== null && base !== null && base > 0 ? Math.min(1, Math.max(0, value / base)) : 0;
        b.style.setProperty("--w", (share * 100).toFixed(3) + "%");
        b.style.borderRadius = radius + "px";
        b.style.background = fill;
        t.appendChild(b);
        return t;
    }

    /** Valor e percentual de um motivo ou detalhamento. */
    private figures(item: Item, width: number): HTMLElement | undefined {
        const v = this.formattingSettings.valuesCard;
        if (width <= 0) {
            return undefined;
        }
        const detail = !!item.parent;
        const box = el("div", "me-figures");
        box.style.width = width + "px";
        if (v.showValue.value) {
            const t = el("span", "me-value", this.fmt(item.value));
            this.applyFont(t, v.valueFont, detail ? v.detailValueColor.value.value : v.valueColor.value.value,
                detail ? v.detailValueFontSize.value : v.valueFont.fontSize.value);
            box.appendChild(t);
        }
        if (v.showPercent.value) {
            const t = el("span", "me-pct", this.percentLabel(this.percentOf(item)));
            this.applyFont(t, v.percentFont, detail ? v.detailPercentColor.value.value : v.percentColor.value.value,
                detail ? v.detailPercentFontSize.value : v.percentFont.fontSize.value);
            box.appendChild(t);
        }
        return box;
    }

    private cardBackground(open: boolean): string {
        const r = this.formattingSettings.reasonsCard;
        if (this.horizontal()) {
            return open ? this.formattingSettings.layoutCard.activeFill.value.value : r.fill.value.value;
        }
        return open ? r.openFill.value.value : r.fill.value.value;
    }

    private renderReason(view: ReasonView, maxReason: number, figuresW: number, detailFiguresW: number, query: string,
        withBody = true): HTMLElement {
        const s = this.formattingSettings;
        const r = s.reasonsCard;
        const rb = s.reasonBarsCard;
        const model = this.model as Model;
        const reason = view.reason;
        const expandable = view.allDetails.length > 0;
        const open = expandable && withBody && this.isOpen(reason.key);
        const padX = Math.max(0, r.paddingX.value);
        const padY = Math.max(0, r.paddingY.value);

        const card = el("div", "me-card" + (open ? " is-open" : "") + (r.openShadow.value ? " has-shadow" : ""));
        card.dataset.key = reason.key;
        card.style.background = this.cardBackground(open);
        card.style.borderRadius = Math.max(0, r.radius.value) + "px";
        card.style.marginBottom = Math.max(0, r.gap.value) + "px";
        if (r.borderWidth.value > 0) {
            card.style.setProperty("--me-border", `inset 0 0 0 ${r.borderWidth.value}px ${r.borderColor.value.value}`);
        }

        // ---- cabeçalho do motivo
        const head = el("div", "me-head me-focus" + (expandable ? " is-expandable" : ""));
        head.dataset.key = reason.key;
        head.tabIndex = 0;
        head.setAttribute("role", "treeitem");
        head.setAttribute("aria-level", "1");
        if (expandable) {
            head.setAttribute("aria-expanded", String(open));
        }
        head.style.padding = `${padY}px ${padX}px`;
        const columns: string[] = [];
        const chevronLeft = enumValue(r.chevronSide) === "left";
        const chevronSize = Math.max(8, r.chevronSize.value);

        const addChevron = (): void => {
            if (!r.showChevron.value) {
                return;
            }
            const chevron = el("span", "me-chevron");
            chevron.style.color = r.chevronColor.value.value;
            chevron.style.width = chevron.style.height = chevronSize + "px";
            if (expandable) {
                const svg = icon(ICONS.chevron);
                svg.style.width = svg.style.height = chevronSize + "px";
                chevron.appendChild(svg);
            }
            head.appendChild(chevron);
            columns.push(chevronSize + "px");
        };
        if (chevronLeft) {
            addChevron();
        }

        if (r.showRank.value) {
            const shape = enumValue(r.rankShape);
            const rank = el("span", "me-rank", String(view.rank));
            const size = Math.max(12, r.rankSize.value);
            rank.style.width = rank.style.height = size + "px";
            rank.style.fontSize = Math.max(8, Math.round(size * 0.5)) + "px";
            rank.style.fontFamily = this.family(r.labelFont);
            rank.style.color = shape === "none" ? r.rankFill.value.value : r.rankColor.value.value;
            rank.style.background = shape === "none" ? "transparent" : r.rankFill.value.value;
            rank.style.borderRadius = shape === "circle" ? "50%" : shape === "rounded" ? Math.round(size * 0.28) + "px" : "0";
            if (shape === "none") {
                rank.style.fontSize = Math.max(9, Math.round(size * 0.7)) + "px";
            }
            head.appendChild(rank);
            columns.push("auto");
        }

        const main = el("div", "me-main");
        const line = el("div", "me-line");
        const label = el("span", "me-label");
        writeHighlighted(label, reason.label, query);
        label.title = reason.label;
        this.applyFont(label, r.labelFont, r.fontColor.value.value);
        line.appendChild(label);
        // No horizontal, a contagem aparece no painel do detalhamento.
        if (r.showCount.value && expandable && !this.isCompact() && withBody) {
            const count = query && view.details.length !== view.allDetails.length
                ? `${view.details.length} de ${view.allDetails.length}`
                : this.countLabel(view.allDetails.length);
            const c = el("span", "me-count", count);
            c.style.fontSize = Math.max(6, r.countFontSize.value) + "px";
            c.style.color = r.countColor.value.value;
            line.appendChild(c);
        }
        main.appendChild(line);
        if (rb.show.value) {
            const base = enumValue(rb.scale) === "total" ? model.total : maxReason;
            const isTop = rb.highlightTop.value && reason.value !== null && reason.value === maxReason && maxReason > 0;
            main.appendChild(this.bar(reason.value, base, isTop ? rb.highlightColor.value.value : rb.fill.value.value,
                rb.trackColor.value.value, Math.max(1, rb.thickness.value), Math.max(0, rb.radius.value), "me-reason-track"));
        }
        head.appendChild(main);
        columns.push("minmax(0, 1fr)");

        const figures = this.figures(reason, figuresW);
        if (figures) {
            head.appendChild(figures);
            columns.push("auto");
        }
        if (!chevronLeft) {
            addChevron();
        }
        head.style.gridTemplateColumns = columns.join(" ");
        this.bindReason(head, view);
        card.appendChild(head);

        // ---- detalhamentos (sempre montados, para a animação de abrir/fechar)
        if (expandable && withBody) {
            const body = el("div", "me-body");
            const inner = el("div", "me-body-inner");
            const details = this.renderDetails(view, detailFiguresW, query);
            details.style.margin = `0 ${Math.max(0, padX - 2)}px ${padY}px`;
            inner.appendChild(details);
            body.appendChild(inner);
            card.appendChild(body);
        }
        return card;
    }

    private renderDetails(view: ReasonView, figuresW: number, query: string): HTMLElement {
        const s = this.formattingSettings;
        const d = s.detailsCard;
        const reason = view.reason;
        const box = el("div", "me-details" + (d.showGuide.value ? "" : " no-guide"));
        box.setAttribute("role", "group");
        box.style.background = d.fill.value.value;
        box.style.borderRadius = Math.max(0, d.radius.value) + "px";
        box.style.setProperty("--me-guide", d.guideColor.value.value);
        box.style.setProperty("--me-hover", d.hoverColor.value.value);

        // Faixa de composição: a fatia de cada detalhamento no motivo.
        if (d.showStrip.value && view.allDetails.length > 1) {
            const strip = el("div", "me-strip");
            strip.style.height = Math.max(2, d.stripHeight.value) + "px";
            const n = view.allDetails.length;
            view.allDetails.forEach((detail, i) => {
                const share = this.share(detail.value, reason.value);
                if (!share || share <= 0) {
                    return;
                }
                const seg = el("div", "me-seg");
                seg.dataset.key = detail.key;
                seg.style.flexGrow = String(share);
                seg.style.background = d.stripColor.value.value;
                seg.style.opacity = (1 - (0.7 * i) / Math.max(1, n - 1)).toFixed(3);
                this.bindTooltip(seg, () => this.detailTooltip(detail));
                seg.addEventListener("mouseenter", () => this.hot(box, detail.key, true));
                seg.addEventListener("mouseleave", () => this.hot(box, detail.key, false));
                strip.appendChild(seg);
            });
            box.appendChild(strip);
        }

        const limit = Math.floor(d.maxItems.value);
        const showAll = !!query || this.showAllDetails.has(reason.key) || limit <= 0;
        const visible = showAll ? view.details : view.details.slice(0, limit);
        const scale = enumValue(s.reasonBarsCard.scale);
        const maxDetail = Math.max(0, ...view.allDetails.map(x => x.value ?? 0));
        const thickness = Math.max(1, d.thickness.value);
        const radius = Math.max(0, d.barRadius.value);

        for (const detail of visible) {
            const row = el("div", "me-detail me-focus");
            row.dataset.key = detail.key;
            row.tabIndex = -1;
            row.setAttribute("role", "treeitem");
            row.setAttribute("aria-level", "2");
            row.style.minHeight = Math.max(0, d.rowHeight.value) + "px";
            const label = el("span", "me-dlabel");
            writeHighlighted(label, detail.label, query);
            label.title = detail.label;
            this.applyFont(label, d.detailFont, d.fontColor.value.value);
            row.appendChild(label);
            const columns = ["minmax(0, 1.2fr)"];
            if (d.showBars.value) {
                // Escala "total": a barra mostra o percentual; "maior": o maior detalhamento enche a barra.
                const base = scale === "total"
                    ? (enumValue(d.percentBase) === "total" ? this.model?.total ?? null : reason.value)
                    : maxDetail;
                row.appendChild(this.bar(detail.value, base, d.barFill.value.value, d.trackColor.value.value, thickness, radius,
                    "me-detail-track"));
                columns.push("minmax(36px, 1fr)");
            }
            const figures = this.figures(detail, figuresW);
            if (figures) {
                row.appendChild(figures);
                columns.push("auto");
            }
            row.style.gridTemplateColumns = columns.join(" ");
            row.addEventListener("mouseenter", () => this.hot(box, detail.key, true));
            row.addEventListener("mouseleave", () => this.hot(box, detail.key, false));
            this.bindDetail(row, detail);
            box.appendChild(row);
        }

        const hidden = view.details.length - visible.length;
        if (hidden > 0) {
            box.appendChild(this.moreButton(`+ ${this.countLabel(hidden)}`, () => {
                this.showAllDetails.add(reason.key);
                this.refreshDetails();
            }));
        } else if (!query && limit > 0 && view.details.length > limit) {
            box.appendChild(this.moreButton("Ver menos", () => {
                this.showAllDetails.delete(reason.key);
                this.refreshDetails();
            }));
        }
        return box;
    }

    /** "Ver mais" de detalhamentos: no horizontal, só o painel é remontado. */
    private refreshDetails(): void {
        if (this.panel) {
            this.renderPanel(false);
        } else {
            this.renderList();
        }
    }

    /** Destaca juntos a linha do detalhamento, a fatia dele na faixa de composição e a ligação. */
    private hot(box: HTMLElement, key: string, on: boolean): void {
        this.list.querySelectorAll<Element>(".me-seg, .me-detail, .me-link").forEach(node => {
            if (node.getAttribute("data-key") === key) {
                node.classList.toggle("is-hot", on);
            }
        });
        box.classList.toggle("has-hot", on);
    }

    private renderInsight(model: Model): HTMLElement | undefined {
        const ins = this.formattingSettings.insightCard;
        if (!ins.show.value) {
            return undefined;
        }
        const top = model.reasons.reduce<Item | undefined>(
            (best, r) => (r.value !== null && (!best || r.value > (best.value ?? 0)) ? r : best), undefined);
        if (!top) {
            return undefined;
        }
        const topDetail = this.detailsOf(top).reduce<Item | undefined>(
            (best, d) => (d.value !== null && (!best || d.value > (best.value ?? 0)) ? d : best), undefined);
        const pct = this.percentFormatter();
        const marks: Record<string, string> = {
            motivo: top.label,
            valor: this.fmt(top.value),
            percentual: pct(this.share(top.value, model.total)),
            detalhe: topDetail?.label ?? "",
            valordetalhe: topDetail ? this.fmt(topDetail.value) : "",
            percentualdetalhe: topDetail ? pct(this.share(topDetail.value, top.value)) : ""
        };
        let template = ins.template.value || "";
        if (!topDetail) {
            // Sem detalhamento, saem as frases que falam dele.
            template = (template.match(/[^.!?]+[.!?]*\s*/g) || [])
                .filter(sentence => !/\{(detalhe|valorDetalhe|percentualDetalhe)\}/i.test(sentence))
                .join("");
        }
        template = template.trim();
        if (!template) {
            return undefined;
        }

        const box = el("div", "me-insight");
        box.style.background = ins.fill.value.value;
        box.style.borderRadius = Math.max(0, ins.radius.value) + "px";
        if (ins.borderWidth.value > 0) {
            box.style.boxShadow = `inset 0 0 0 ${ins.borderWidth.value}px ${ins.borderColor.value.value}`;
        }
        if (ins.showIcon.value) {
            const svg = icon(ICONS.insight, "me-icon me-insight-icon");
            svg.style.color = ins.iconColor.value.value;
            const size = Math.round(Math.max(12, ins.insightFont.fontSize.value * 1.4));
            svg.style.width = svg.style.height = size + "px";
            box.appendChild(svg);
        }
        const textEl = el("div", "me-insight-text");
        this.applyFont(textEl, ins.insightFont, ins.fontColor.value.value);
        const parts = template.split(/(\{(?:motivo|valor|percentual|detalhe|valorDetalhe|percentualDetalhe)\})/i);
        for (const part of parts) {
            const mark = /^\{(\w+)\}$/.exec(part);
            const key = mark?.[1].toLowerCase();
            if (key && key in marks) {
                const strong = el("strong", "", marks[key]);
                strong.style.color = ins.markColor.value.value;
                strong.style.fontWeight = ins.boldMarks.value ? "600" : "inherit";
                textEl.appendChild(strong);
            } else if (part) {
                textEl.appendChild(document.createTextNode(part));
            }
        }
        box.appendChild(textEl);
        // Clique no insight abre o motivo principal.
        box.addEventListener("click", () => this.reveal(top.key));
        box.title = "Mostrar este motivo";
        return box;
    }

    // ------------------------------------------------------------- abrir e fechar

    private setOpen(key: string, open: boolean): void {
        const set = this.openSet();
        if (open && (this.formattingSettings.interactionCard.accordion.value || this.horizontal())) {
            set.clear();
        }
        if (open) {
            set.add(key);
        } else {
            set.delete(key);
        }
        this.paintOpen();
    }

    private setAll(open: boolean): void {
        const set = this.openSet();
        set.clear();
        if (open) {
            this.views.filter(v => v.allDetails.length > 0).forEach(v => set.add(v.reason.key));
        }
        this.paintOpen();
    }

    /** Atualiza só as classes (sem remontar), para a animação de abrir/fechar funcionar. */
    private paintOpen(): void {
        if (this.panel) {
            this.renderPanel(true);
            return;
        }
        this.list.querySelectorAll<HTMLElement>(".me-card").forEach(card => {
            const head = card.querySelector<HTMLElement>(".me-head");
            if (!head?.classList.contains("is-expandable")) {
                return;
            }
            const open = this.isOpen(card.dataset.key || "");
            card.classList.toggle("is-open", open);
            card.style.background = this.cardBackground(open);
            head.setAttribute("aria-expanded", String(open));
        });
    }

    /** Abre um motivo e rola até ele. */
    private reveal(key: string): void {
        if (this.query) {
            this.searchInput.value = "";
            this.query = "";
            this.searchOpen.clear();
            this.views = this.computeViews();
        }
        const index = this.views.findIndex(v => v.reason.key === key);
        const limit = Math.floor(this.formattingSettings.reasonsCard.maxItems.value);
        if (limit > 0 && index >= limit) {
            this.showAllReasons = true;
        }
        if (this.formattingSettings.interactionCard.accordion.value || this.horizontal()) {
            this.expanded.clear();
        }
        this.expanded.add(key);
        this.renderList();
        const card = Array.from(this.list.querySelectorAll<HTMLElement>(".me-card")).find(c => c.dataset.key === key);
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    private onSearch(value: string): void {
        const wasSearching = !!this.query.trim();
        this.query = value;
        const query = foldQuery(value);
        if (query) {
            // Os motivos abertos continuam abertos; os que têm detalhamento achado abrem sozinhos.
            if (!wasSearching) {
                this.searchOpen = new Set(this.expanded);
            }
            for (const view of this.computeViews()) {
                if (view.allDetails.some(d => matches(d.label, query))) {
                    this.searchOpen.add(view.reason.key);
                }
            }
        } else {
            this.searchOpen.clear();
        }
        this.renderList();
    }

    // ------------------------------------------------------------- seleção

    private setSelection(keys: string[]): void {
        // Em painéis (dashboards) e outros lugares sem interação, o clique só abre e fecha.
        if (this.host.hostCapabilities?.allowInteractions === false) {
            return;
        }
        this.selected = new Map(keys.filter(k => this.ids.has(k)).map(k => [k, this.ids.get(k) as ISelectionId]));
        const ids = Array.from(this.selected.values());
        const done = ids.length > 0 ? this.selectionManager.select(ids, false) : this.selectionManager.clear();
        done.then(() => this.paintSelection());
        this.paintSelection();
    }

    /** Clique comum: só este item (ou limpa, se já era o único); Ctrl + clique: soma ou tira da seleção. */
    private toggleSelection(key: string, multi: boolean): void {
        const keys = Array.from(this.selected.keys());
        if (multi) {
            this.setSelection(keys.includes(key) ? keys.filter(k => k !== key) : keys.concat(key));
        } else {
            this.setSelection(keys.length === 1 && keys[0] === key ? [] : [key]);
        }
    }

    /** Seleção vinda de fora (favoritos, outro visual): reconstrói as chaves pelas identidades. */
    private syncSelection(ids: ISelectionId[]): void {
        this.selected.clear();
        for (const [key, id] of this.ids) {
            if (ids.some(other => other.equals(id))) {
                this.selected.set(key, id);
            }
        }
        this.paintSelection();
    }

    /** Esmaece o que não está selecionado. */
    private paintSelection(): void {
        const dim = String(Math.min(100, Math.max(0, this.formattingSettings.interactionCard.selectedOpacity.value)) / 100);
        const any = this.selected.size > 0;
        const selectedKeys = Array.from(this.selected.keys());
        const reasonOf = (key: string): string => key.split("\u001f")[0];
        this.list.querySelectorAll<HTMLElement>(".me-head").forEach(node => {
            const key = node.dataset.key || "";
            const on = !any || selectedKeys.some(k => reasonOf(k) === key);
            node.classList.toggle("is-selected", any && this.selected.has(key));
            node.style.opacity = on ? "1" : dim;
        });
        this.list.querySelectorAll<HTMLElement>(".me-detail").forEach(node => {
            const key = node.dataset.key || "";
            const on = !any || this.selected.has(key) || this.selected.has(reasonOf(key));
            node.classList.toggle("is-selected", any && this.selected.has(key));
            node.style.opacity = on ? "1" : dim;
        });
        this.links?.querySelectorAll<SVGElement>(".me-link").forEach(node => {
            const key = node.getAttribute("data-key") || "";
            const on = !any || this.selected.has(key) || this.selected.has(reasonOf(key));
            node.style.opacity = on ? "1" : dim;
        });
    }

    // ------------------------------------------------------------- interação

    private tooltipFor(item: Item, base: VisualTooltipDataItem[]): VisualTooltipDataItem[] {
        const model = this.model as Model;
        const items = base.slice();
        for (const m of model.measures) {
            if (!m.isValue) {
                items.push({ displayName: m.name, value: m.format(rawValue(item.valuesNode, m.index) ?? null) });
            }
        }
        return items;
    }

    private reasonTooltip(reason: Item): VisualTooltipDataItem[] {
        const model = this.model as Model;
        const pct = this.percentFormatter();
        const items: VisualTooltipDataItem[] = [
            { displayName: model.reasonName, value: reason.label },
            { displayName: model.value.name, value: model.value.format(reason.value) },
            { displayName: "% do total", value: pct(this.share(reason.value, model.total)) }
        ];
        const n = this.detailsOf(reason).length;
        if (n > 0) {
            items.push({ displayName: model.detailName || "Detalhamentos", value: plural(n, "detalhamento", "detalhamentos") });
        }
        return this.tooltipFor(reason, items);
    }

    private detailTooltip(detail: Item): VisualTooltipDataItem[] {
        const model = this.model as Model;
        const pct = this.percentFormatter();
        const reason = detail.parent as Item;
        return this.tooltipFor(detail, [
            { displayName: model.reasonName, value: reason.label },
            { displayName: model.detailName, value: detail.label },
            { displayName: model.value.name, value: model.value.format(detail.value) },
            { displayName: "% do motivo", value: pct(this.share(detail.value, reason.value)) },
            { displayName: "% do total", value: pct(this.share(detail.value, model.total)) }
        ]);
    }

    private bindTooltip(node: HTMLElement, items: () => VisualTooltipDataItem[], key?: string): void {
        const args = (e: MouseEvent) => ({
            coordinates: [e.clientX, e.clientY],
            isTouchEvent: false,
            dataItems: items(),
            identities: key && this.ids.has(key) ? [this.ids.get(key) as ISelectionId] : []
        });
        node.addEventListener("mouseenter", (e: MouseEvent) => this.host.tooltipService.show(args(e)));
        node.addEventListener("mousemove", (e: MouseEvent) => this.host.tooltipService.move(args(e)));
        node.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
    }

    private bindContextMenu(node: HTMLElement, key: string): void {
        node.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectionManager.showContextMenu(this.ids.get(key) || ({} as ISelectionId), { x: e.clientX, y: e.clientY });
        });
    }

    private activateReason(view: ReasonView, multi: boolean): void {
        const key = view.reason.key;
        const filters = enumValue(this.formattingSettings.interactionCard.clickMode) === "expandFilter";
        if (view.allDetails.length === 0) {
            // Motivo sem detalhamento: o clique só filtra.
            if (filters) {
                this.toggleSelection(key, multi);
            }
            return;
        }
        const open = !this.isOpen(key);
        this.setOpen(key, open);
        if (!filters) {
            return;
        }
        // O que está aberto é o que filtra: abrir seleciona o motivo, fechar tira ele (e os detalhamentos dele) da seleção.
        const keys = Array.from(this.selected.keys());
        if (open) {
            this.setSelection(multi ? keys.filter(k => k !== key).concat(key) : [key]);
        } else if (keys.some(k => k === key || k.startsWith(key + "\u001f"))) {
            this.setSelection(keys.filter(k => k !== key && !k.startsWith(key + "\u001f")));
        }
    }

    private bindReason(head: HTMLElement, view: ReasonView): void {
        const key = view.reason.key;
        this.bindTooltip(head, () => this.reasonTooltip(view.reason), key);
        this.bindContextMenu(head, key);
        head.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.activateReason(view, e.ctrlKey || e.metaKey);
        });
    }

    private bindDetail(row: HTMLElement, detail: Item): void {
        this.bindTooltip(row, () => this.detailTooltip(detail), detail.key);
        this.bindContextMenu(row, detail.key);
        row.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.toggleSelection(detail.key, e.ctrlKey || e.metaKey);
        });
    }

    /** Teclado: setas navegam, → abre, ← fecha (ou volta ao motivo), Enter/Espaço clicam. */
    private onListKey(e: KeyboardEvent): void {
        const target = e.target as HTMLElement;
        if (!target.classList.contains("me-focus")) {
            return;
        }
        // No horizontal, as setas andam dentro da coluna (motivos ou detalhamento).
        const scope = this.panel ? target.closest<HTMLElement>(".me-col-scroll") || this.list : this.list;
        const focusables = Array.from(scope.querySelectorAll<HTMLElement>(".me-focus"))
            .filter(n => !n.closest(".me-body") || !!n.closest(".me-card.is-open"));
        const index = focusables.indexOf(target);
        const card = target.closest<HTMLElement>(".me-card");
        const key = card?.dataset.key || "";
        const view = this.views.find(v => v.reason.key === key);
        const isHead = target.classList.contains("me-head");
        const move = (to: number): void => {
            const next = focusables[Math.max(0, Math.min(focusables.length - 1, to))];
            next?.focus();
            next?.scrollIntoView({ block: "nearest" });
        };
        let handled = true;
        switch (e.key) {
            case "ArrowDown":
                move(index + 1);
                break;
            case "ArrowUp":
                if (index === 0 && this.formattingSettings.toolbarCard.showSearch.value) {
                    this.searchInput.focus();
                } else {
                    move(index - 1);
                }
                break;
            case "Home":
                move(0);
                break;
            case "End":
                move(focusables.length - 1);
                break;
            case "ArrowRight":
                if (isHead && view && view.allDetails.length > 0) {
                    if (!this.isOpen(key)) {
                        this.setOpen(key, true);
                    } else if (this.panel) {
                        this.panel.querySelector<HTMLElement>(".me-detail")?.focus();
                    } else {
                        move(index + 1);
                    }
                }
                break;
            case "ArrowLeft":
                if (this.panel) {
                    if (!isHead) {
                        this.leftScroll?.querySelector<HTMLElement>(".me-card.is-active .me-head")?.focus();
                    }
                } else if (isHead) {
                    this.setOpen(key, false);
                } else {
                    card?.querySelector<HTMLElement>(".me-head")?.focus();
                }
                break;
            case "Enter":
            case " ":
                target.click();
                break;
            default:
                handled = false;
        }
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
}
