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

import { Item, Model, buildModel, rawValue } from "./model";
import { VisualFormattingSettingsModel, enumValue } from "./settings";

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
    private searchInput: HTMLInputElement;
    private searchCount: HTMLElement;
    private searchClear: HTMLButtonElement;
    private expandAllButton: HTMLButtonElement;
    private collapseAllButton: HTMLButtonElement;
    private list: HTMLElement;

    private model: Model | undefined;
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
        const header = s.headerCard;
        header.summary.visible = header.summarySize.visible = header.summaryColor.visible = header.showSummary.value;
        s.toolbarCard.placeholder.visible = s.toolbarCard.showSearch.value;
        s.reasonsCard.rankFill.visible = s.reasonsCard.rankColor.visible = s.reasonsCard.showRank.value;
        const bars = s.reasonBarsCard;
        bars.fill.visible = bars.trackColor.visible = bars.thickness.visible = bars.radius.visible = bars.show.value;
        const values = s.valuesCard;
        values.decimals.visible = values.percentColor.visible = values.showPercent.value;
        values.valueColor.visible = values.bold.visible = values.showValue.value;
        const insight = s.insightCard;
        insight.template.visible = insight.fontSize.visible = insight.fontColor.visible = insight.fill.visible = insight.show.value;
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
        const key = model.signature + "\u001e" + initial;
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

    // ------------------------------------------------------------- formatação de números

    private percentFormatter(): (share: number | null) => string {
        const decimals = Math.max(0, Math.min(4, Math.floor(this.formattingSettings.valuesCard.decimals.value)));
        const format = "0" + (decimals > 0 ? "." + "0".repeat(decimals) : "") + "%";
        const f = valueFormatter.create({ format, cultureSelector: this.locale });
        return share => (share === null || !isFinite(share) ? "—" : f.format(share));
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

    // ------------------------------------------------------------- desenho

    private buildToolbar(): void {
        this.toolbar = el("div", "me-toolbar");

        this.searchBox = el("label", "me-search");
        this.searchBox.appendChild(icon(ICONS.search));
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
        root.style.fontFamily = s.generalCard.fontFamily.value;
        root.classList.toggle("no-anim", !s.interactionCard.animate.value);
        root.classList.toggle("is-compact", this.isCompact());
        // Cor de destaque (foco, pesquisa, ícone do insight) = cor da barra dos motivos.
        root.style.setProperty("--me-accent", s.reasonBarsCard.fill.value.value);
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

        this.styleToolbar(model);
        root.appendChild(this.list);
        this.renderList();
        this.list.scrollTop = scrollTop;
        this.renderInsight(model);
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
        const line = (value: string, className: string, size: number, color: string): void => {
            if (value) {
                const t = el("div", className, value);
                t.style.fontSize = size + "px";
                t.style.color = color;
                head.appendChild(t);
            }
        };
        line(header.title.value, "me-title", header.titleSize.value, header.titleColor.value.value);
        line(header.subtitle.value, "me-subtitle", header.subtitleSize.value, header.subtitleColor.value.value);
        line(summary, "me-summary", header.summarySize.value, header.summaryColor.value.value);
        this.root.appendChild(head);
    }

    private summaryText(model: Model): string {
        const template = this.formattingSettings.headerCard.summary.value || "";
        const details = model.reasons.reduce((n, r) => n + this.detailsOf(r).length, 0);
        return template
            .replace(/\{total\}/gi, model.value.format(model.total))
            .replace(/\{motivos\}/gi, String(model.reasons.length))
            .replace(/\{detalhamentos\}/gi, String(details))
            .trim();
    }

    private styleToolbar(model: Model): void {
        const t = this.formattingSettings.toolbarCard;
        const showSearch = t.showSearch.value;
        const showButtons = t.showExpandAll.value && model.hasDetail;
        if (!showSearch && !showButtons) {
            return;
        }
        const height = Math.max(24, t.height.value);
        const radius = Math.max(0, t.radius.value);
        const border = Math.max(0, t.borderWidth.value);
        const paint = (node: HTMLElement): void => {
            node.style.height = height + "px";
            node.style.borderRadius = Math.min(radius, height / 2) + "px";
            node.style.background = t.fill.value.value;
            node.style.color = t.fontColor.value.value;
            node.style.boxShadow = border > 0 ? `inset 0 0 0 ${border}px ${t.borderColor.value.value}` : "";
        };
        this.searchBox.style.display = showSearch ? "" : "none";
        paint(this.searchBox);
        this.searchInput.placeholder = t.placeholder.value || "";
        this.searchInput.style.fontSize = t.fontSize.value + "px";
        this.searchInput.style.color = t.fontColor.value.value;
        this.searchCount.style.fontSize = Math.max(9, t.fontSize.value - 2) + "px";
        for (const b of [this.expandAllButton, this.collapseAllButton]) {
            b.style.display = showButtons ? "" : "none";
            paint(b);
            b.style.width = height + "px";
        }
        this.root.appendChild(this.toolbar);
    }

    /** Monta a lista de motivos (chamado também ao pesquisar e no "Ver mais"). */
    private renderList(): void {
        const model = this.model;
        const list = this.list;
        list.replaceChildren();
        if (!model) {
            return;
        }
        const s = this.formattingSettings;
        const font = s.generalCard.fontFamily.value;
        const query = foldQuery(this.query);
        this.views = this.computeViews();

        // Pesquisa: contador e botão de limpar.
        this.searchClear.style.visibility = this.query ? "visible" : "hidden";
        this.searchCount.textContent = query ? plural(this.views.length, "motivo", "motivos") : "";

        if (this.views.length === 0) {
            list.appendChild(el("div", "me-noresult", `Nada encontrado para “${this.query.trim()}”.`));
            return;
        }

        const limit = Math.floor(s.reasonsCard.maxItems.value);
        const limited = !query && !this.showAllReasons && limit > 0 && this.views.length > limit;
        const views = limited ? this.views.slice(0, limit) : this.views;

        // Largura da coluna de valores, igual em todos os motivos (e em todos os detalhamentos).
        const v = s.valuesCard;
        const pct = this.percentFormatter();
        const figuresWidth = (items: Item[], size: number): number => {
            if (!v.showValue.value && !v.showPercent.value) {
                return 0;
            }
            const w = Math.max(0, ...items.map(item => {
                const a = v.showValue.value ? textWidth(model.value.format(item.value), size, font, v.bold.value) : 0;
                const b = v.showPercent.value ? textWidth(pct(this.percentOf(item)), size * 0.92, font) : 0;
                return a + b + (a && b ? 8 : 0);
            }));
            return Math.ceil(Math.min(w + 4, Math.max(60, this.width * 0.4)));
        };
        const reasonFigures = figuresWidth(views.map(view => view.reason), v.fontSize.value);
        const detailFigures = figuresWidth(views.flatMap(view => view.details), Math.max(8, v.fontSize.value - 1));

        const maxReason = Math.max(0, ...model.reasons.map(r => r.value ?? 0));
        views.forEach(view => list.appendChild(this.renderReason(view, maxReason, reasonFigures, detailFigures, query)));

        if (limited) {
            list.appendChild(this.moreButton(`Ver mais ${plural(this.views.length - limit, "motivo", "motivos")}`, () => {
                this.showAllReasons = true;
                this.renderList();
            }, "me-more-reasons"));
        } else if (!query && this.showAllReasons && limit > 0 && this.views.length > limit) {
            list.appendChild(this.moreButton("Ver menos motivos", () => {
                this.showAllReasons = false;
                this.renderList();
            }, "me-more-reasons"));
        }
        this.paintSelection();
    }

    private moreButton(label: string, action: () => void, extraClass = ""): HTMLButtonElement {
        const b = el("button", "me-more " + extraClass, label);
        b.type = "button";
        b.style.color = this.formattingSettings.reasonsCard.fontColor.value.value;
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

    private figures(item: Item, size: number, width: number): HTMLElement | undefined {
        const v = this.formattingSettings.valuesCard;
        if (width <= 0) {
            return undefined;
        }
        const box = el("div", "me-figures");
        box.style.width = width + "px";
        if (v.showValue.value) {
            const t = el("span", "me-value", this.model?.value.format(item.value));
            t.style.fontSize = size + "px";
            t.style.color = v.valueColor.value.value;
            t.style.fontWeight = v.bold.value ? "600" : "400";
            box.appendChild(t);
        }
        if (v.showPercent.value) {
            const t = el("span", "me-pct", this.percentFormatter()(this.percentOf(item)));
            t.style.fontSize = (size * 0.92).toFixed(1) + "px";
            t.style.color = v.percentColor.value.value;
            box.appendChild(t);
        }
        return box;
    }

    private renderReason(view: ReasonView, maxReason: number, figuresW: number, detailFiguresW: number, query: string): HTMLElement {
        const s = this.formattingSettings;
        const r = s.reasonsCard;
        const rb = s.reasonBarsCard;
        const model = this.model as Model;
        const reason = view.reason;
        const expandable = view.allDetails.length > 0;
        const open = expandable && this.isOpen(reason.key);

        const card = el("div", "me-card" + (open ? " is-open" : ""));
        card.dataset.key = reason.key;
        card.style.background = r.fill.value.value;
        card.style.borderRadius = Math.max(0, r.radius.value) + "px";
        card.style.marginBottom = Math.max(0, r.gap.value) + "px";
        if (r.borderWidth.value > 0) {
            card.style.boxShadow = `inset 0 0 0 ${r.borderWidth.value}px ${r.borderColor.value.value}`;
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
        const columns: string[] = [];

        if (r.showRank.value) {
            const rank = el("span", "me-rank", String(view.rank));
            rank.style.background = r.rankFill.value.value;
            rank.style.color = r.rankColor.value.value;
            const size = Math.round(Math.max(18, r.fontSize.value * 1.6));
            rank.style.width = rank.style.height = size + "px";
            rank.style.fontSize = Math.max(9, Math.round(r.fontSize.value * 0.8)) + "px";
            head.appendChild(rank);
            columns.push("auto");
        }

        const main = el("div", "me-main");
        const line = el("div", "me-line");
        const label = el("span", "me-label");
        writeHighlighted(label, reason.label, query);
        label.title = reason.label;
        label.style.fontSize = r.fontSize.value + "px";
        label.style.color = r.fontColor.value.value;
        label.style.fontWeight = r.bold.value ? "600" : "400";
        line.appendChild(label);
        if (r.showCount.value && expandable && !this.isCompact()) {
            const count = query && view.details.length !== view.allDetails.length
                ? `${view.details.length} de ${view.allDetails.length}`
                : plural(view.allDetails.length, "detalhamento", "detalhamentos");
            const c = el("span", "me-count", count);
            c.style.fontSize = Math.max(9, r.fontSize.value - 3) + "px";
            c.style.color = s.valuesCard.percentColor.value.value;
            line.appendChild(c);
        }
        main.appendChild(line);
        if (rb.show.value) {
            const base = enumValue(rb.scale) === "total" ? model.total : maxReason;
            main.appendChild(this.bar(reason.value, base, rb.fill.value.value, rb.trackColor.value.value,
                Math.max(2, rb.thickness.value), Math.max(0, rb.radius.value), "me-reason-track"));
        }
        head.appendChild(main);
        columns.push("minmax(0, 1fr)");

        const figures = this.figures(reason, s.valuesCard.fontSize.value, figuresW);
        if (figures) {
            head.appendChild(figures);
            columns.push("auto");
        }

        const chevron = el("span", "me-chevron");
        chevron.style.color = r.fontColor.value.value;
        if (expandable) {
            chevron.appendChild(icon(ICONS.chevron));
        }
        head.appendChild(chevron);
        columns.push("20px");
        head.style.gridTemplateColumns = columns.join(" ");
        this.bindReason(head, view);
        card.appendChild(head);

        // ---- detalhamentos (sempre montados, para a animação de abrir/fechar)
        if (expandable) {
            const body = el("div", "me-body");
            const inner = el("div", "me-body-inner");
            inner.appendChild(this.renderDetails(view, detailFiguresW, query));
            body.appendChild(inner);
            card.appendChild(body);
        }
        return card;
    }

    private renderDetails(view: ReasonView, figuresW: number, query: string): HTMLElement {
        const s = this.formattingSettings;
        const d = s.detailsCard;
        const reason = view.reason;
        const box = el("div", "me-details");
        box.setAttribute("role", "group");
        box.style.background = d.fill.value.value;
        box.style.borderRadius = Math.max(0, s.reasonsCard.radius.value - 2) + "px";
        box.style.setProperty("--me-guide", d.guideColor.value.value);

        // Faixa de composição: a fatia de cada detalhamento no motivo.
        const segments: Array<[Item, HTMLElement]> = [];
        if (d.showStrip.value && view.allDetails.length > 1) {
            const strip = el("div", "me-strip");
            const n = view.allDetails.length;
            view.allDetails.forEach((detail, i) => {
                const share = this.share(detail.value, reason.value);
                if (!share || share <= 0) {
                    return;
                }
                const seg = el("div", "me-seg");
                seg.dataset.key = detail.key;
                seg.style.flexGrow = String(share);
                seg.style.background = d.barFill.value.value;
                seg.style.opacity = (1 - (0.7 * i) / Math.max(1, n - 1)).toFixed(3);
                this.bindTooltip(seg, () => this.detailTooltip(detail));
                seg.addEventListener("mouseenter", () => this.hot(box, detail.key, true));
                seg.addEventListener("mouseleave", () => this.hot(box, detail.key, false));
                strip.appendChild(seg);
                segments.push([detail, seg]);
            });
            box.appendChild(strip);
        }

        const limit = Math.floor(d.maxItems.value);
        const showAll = !!query || this.showAllDetails.has(reason.key) || limit <= 0;
        const visible = showAll ? view.details : view.details.slice(0, limit);
        const scale = enumValue(s.reasonBarsCard.scale);
        const maxDetail = Math.max(0, ...view.allDetails.map(x => x.value ?? 0));
        const thickness = Math.max(2, d.thickness.value);
        const radius = Math.max(0, s.reasonBarsCard.radius.value);
        const size = d.fontSize.value;

        for (const detail of visible) {
            const row = el("div", "me-detail me-focus");
            row.dataset.key = detail.key;
            row.tabIndex = -1;
            row.setAttribute("role", "treeitem");
            row.setAttribute("aria-level", "2");
            const label = el("span", "me-dlabel");
            writeHighlighted(label, detail.label, query);
            label.title = detail.label;
            label.style.fontSize = size + "px";
            label.style.color = d.fontColor.value.value;
            label.style.fontWeight = d.bold.value ? "600" : "400";
            row.appendChild(label);
            // Escala "total": a barra mostra o percentual; "maior": o maior detalhamento enche a barra.
            const base = scale === "total"
                ? (enumValue(d.percentBase) === "total" ? this.model?.total ?? null : reason.value)
                : maxDetail;
            row.appendChild(this.bar(detail.value, base, d.barFill.value.value, d.trackColor.value.value, thickness, radius,
                "me-detail-track"));
            const figures = this.figures(detail, Math.max(8, s.valuesCard.fontSize.value - 1), figuresW);
            if (figures) {
                row.appendChild(figures);
            }
            row.style.gridTemplateColumns = `minmax(0, 1.2fr) minmax(36px, 1fr)${figures ? " auto" : ""}`;
            row.addEventListener("mouseenter", () => this.hot(box, detail.key, true));
            row.addEventListener("mouseleave", () => this.hot(box, detail.key, false));
            this.bindDetail(row, detail);
            box.appendChild(row);
        }

        const hidden = view.details.length - visible.length;
        if (hidden > 0) {
            box.appendChild(this.moreButton(`+ ${plural(hidden, "detalhamento", "detalhamentos")}`, () => {
                this.showAllDetails.add(reason.key);
                this.renderList();
            }));
        } else if (!query && limit > 0 && view.details.length > limit) {
            box.appendChild(this.moreButton("Ver menos", () => {
                this.showAllDetails.delete(reason.key);
                this.renderList();
            }));
        }
        return box;
    }

    /** Destaca juntos a linha do detalhamento e a fatia dele na faixa de composição. */
    private hot(box: HTMLElement, key: string, on: boolean): void {
        box.querySelectorAll<HTMLElement>(".me-seg, .me-detail").forEach(node => {
            if (node.dataset.key === key) {
                node.classList.toggle("is-hot", on);
            }
        });
        box.classList.toggle("has-hot", on);
    }

    private renderInsight(model: Model): void {
        const ins = this.formattingSettings.insightCard;
        if (!ins.show.value) {
            return;
        }
        const top = model.reasons.reduce<Item | undefined>(
            (best, r) => (r.value !== null && (!best || r.value > (best.value ?? 0)) ? r : best), undefined);
        if (!top) {
            return;
        }
        const topDetail = this.detailsOf(top).reduce<Item | undefined>(
            (best, d) => (d.value !== null && (!best || d.value > (best.value ?? 0)) ? d : best), undefined);
        const pct = this.percentFormatter();
        const marks: Record<string, string> = {
            motivo: top.label,
            valor: model.value.format(top.value),
            percentual: pct(this.share(top.value, model.total)),
            detalhe: topDetail?.label ?? "",
            valordetalhe: topDetail ? model.value.format(topDetail.value) : "",
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
            return;
        }

        const box = el("div", "me-insight");
        box.style.background = ins.fill.value.value;
        box.style.color = ins.fontColor.value.value;
        box.style.fontSize = ins.fontSize.value + "px";
        box.appendChild(icon(ICONS.insight, "me-icon me-insight-icon"));
        const textEl = el("div", "me-insight-text");
        const parts = template.split(/(\{(?:motivo|valor|percentual|detalhe|valorDetalhe|percentualDetalhe)\})/i);
        for (const part of parts) {
            const mark = /^\{(\w+)\}$/.exec(part);
            const key = mark?.[1].toLowerCase();
            if (key && key in marks) {
                textEl.appendChild(el("strong", "", marks[key]));
            } else if (part) {
                textEl.appendChild(document.createTextNode(part));
            }
        }
        box.appendChild(textEl);
        // Clique no insight abre o motivo principal.
        box.addEventListener("click", () => this.reveal(top.key));
        box.title = "Mostrar este motivo";
        this.root.appendChild(box);
    }

    // ------------------------------------------------------------- abrir e fechar

    private setOpen(key: string, open: boolean): void {
        const set = this.openSet();
        if (open && this.formattingSettings.interactionCard.accordion.value) {
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
        this.list.querySelectorAll<HTMLElement>(".me-card").forEach(card => {
            const head = card.querySelector<HTMLElement>(".me-head");
            if (!head?.classList.contains("is-expandable")) {
                return;
            }
            const open = this.isOpen(card.dataset.key || "");
            card.classList.toggle("is-open", open);
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
        if (this.formattingSettings.interactionCard.accordion.value) {
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
        const focusables = Array.from(this.list.querySelectorAll<HTMLElement>(".me-focus"))
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
                    if (this.isOpen(key)) {
                        move(index + 1);
                    } else {
                        this.setOpen(key, true);
                    }
                }
                break;
            case "ArrowLeft":
                if (isHead) {
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
