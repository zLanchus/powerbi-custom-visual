"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
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

import { DARK, VisualFormattingSettingsModel, enumValue } from "./settings";
import { ColumnGroup, MatrixModel, Measure, RowItem, ValueColumn, buildModel, cellValue, rowPath } from "./model";
import { Analysis, Hotspot, MeasureConfig, alpha, buildMeasureCard, colorProp, readConfig, readableText } from "./analysis";
import { Cell, Sheet, buildXlsx } from "./xlsx";

const MAX_RENDERED_ROWS = 5000;
const SVG_NS = "http://www.w3.org/2000/svg";
const PATH_SEP = " › ";

/** Linha visível depois da pesquisa, do filtro "acima da referência" e da ordenação. */
interface ViewNode {
    row: RowItem;
    children: ViewNode[];
    /** Aberta à força porque só os filhos passaram no filtro. */
    forceOpen: boolean;
}

interface SortState {
    /** cellKey(grupo, medida) ou "#label" para ordenar pelo nome. */
    key: string;
    dir: 1 | -1;
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

function icon(paths: string[], className = "md-icon"): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", className);
    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

const ICONS = {
    search: ["M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", "M20 20l-4.6-4.6"],
    expand: ["M4 5h16v14H4z", "M12 9v6", "M9 12h6"],
    collapse: ["M4 5h16v14H4z", "M9 12h6"],
    heat: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    delta: ["M12 5l8 14H4z"],
    focus: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
    download: ["M12 4v11", "M7 10.5l5 5 5-5", "M5 20h14"],
    chevron: ["M9 6l6 6-6 6"],
    clear: ["M7 7l10 10", "M17 7L7 17"],
    alert: ["M12 4l9 16H3z", "M12 10v4", "M12 17.2v.3"]
};

/** Texto sem acentos e em minúsculas, para a pesquisa. */
function normalize(text: string): string {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Converte a string de formato do Power BI para o Excel (são quase sempre compatíveis). */
function excelFormat(format: string | undefined): string | undefined {
    if (!format || /^[GgCcDdNnPp]\d*$/.test(format)) {
        if (format && /^[Pp]\d*$/.test(format)) {
            const decimals = Number(format.slice(1) || 2);
            return (decimals > 0 ? "0." + "0".repeat(decimals) : "0") + "%";
        }
        return undefined;
    }
    return format;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private locale = "pt-BR";

    // elementos fixos
    private root: HTMLElement;
    private bar: HTMLElement;
    private titleEl: HTMLElement;
    private fieldsEl: HTMLElement;
    private countEl: HTMLElement;
    private searchBox: HTMLElement;
    private searchInput: HTMLInputElement;
    private searchClear: HTMLButtonElement;
    private expandBtn: HTMLButtonElement;
    private collapseBtn: HTMLButtonElement;
    private heatBtn: HTMLButtonElement;
    private deltaBtn: HTMLButtonElement;
    private focusBtn: HTMLButtonElement;
    private exportBtn: HTMLButtonElement;
    private insights: HTMLElement;
    private scroller: HTMLElement;

    // dados
    private model: MatrixModel | undefined;
    private analysis: Analysis | undefined;
    private keyMeasure: Measure | undefined;
    private keyQuery = "";
    private configs = new Map<number, MeasureConfig>();
    private hotspotList: Hotspot[] = [];

    // estado de quem usa o relatório
    private expanded = new Set<string>();
    private expandSignature = "";
    private sort: SortState | undefined;
    private sortSignature = "";
    private heatmapOn = true;
    private deltaOn = false;
    private focusOn = false;
    private toggleDefaults = "";
    private search = "";
    private searchTimer: number | undefined;
    private selected = new Set<string>();
    private visibleRows = 0;
    private totalRows = 0;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "md-root");
        this.buildToolbar();
        this.insights = el("div", "md-insights");
        this.scroller = el("div", "md-scroll");
        this.root.append(this.bar, this.insights, this.scroller);
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI (fora das células).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando),
        // exceto na caixa de pesquisa.
        this.root.addEventListener("mousedown", (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest("input")) {
                e.preventDefault();
            }
        });
        // Clique fora das células limpa a seleção.
        this.scroller.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest("tbody tr, tfoot tr, thead")) {
                this.clearSelection();
            }
        });
        this.selectionManager.registerOnSelectCallback(() => {
            this.selected.clear();
            this.renderBody();
        });
    }

    // ------------------------------------------------------------- barra

    private button(paths: string[], label: string, title: string, onClick: () => void): HTMLButtonElement {
        const b = el("button", "md-btn" + (label ? "" : " md-icon-only"));
        b.type = "button";
        b.title = title;
        b.setAttribute("aria-label", title);
        b.appendChild(icon(paths));
        if (label) {
            b.appendChild(el("span", "md-btn-label", label));
        }
        b.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            onClick();
        });
        return b;
    }

    private buildToolbar(): void {
        this.bar = el("div", "md-bar");
        const heading = el("div", "md-heading");
        this.titleEl = el("div", "md-title");
        this.fieldsEl = el("div", "md-fields");
        heading.append(this.titleEl, this.fieldsEl);

        const tools = el("div", "md-tools");
        this.countEl = el("span", "md-count");
        this.countEl.title = "Linhas visíveis com a pesquisa e o filtro atuais";
        this.searchBox = el("label", "md-search");
        this.searchInput = el("input", "md-search-input");
        this.searchInput.type = "text";
        this.searchInput.placeholder = "Pesquisar linhas";
        this.searchInput.setAttribute("aria-label", "Pesquisar linhas");
        this.searchInput.addEventListener("input", () => {
            window.clearTimeout(this.searchTimer);
            this.searchTimer = window.setTimeout(() => this.setSearch(this.searchInput.value), 160);
        });
        this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                this.searchInput.value = "";
                this.setSearch("");
            }
        });
        this.searchClear = el("button", "md-search-clear");
        this.searchClear.type = "button";
        this.searchClear.title = "Limpar pesquisa";
        this.searchClear.setAttribute("aria-label", "Limpar pesquisa");
        this.searchClear.appendChild(icon(ICONS.clear));
        this.searchClear.addEventListener("click", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.searchInput.value = "";
            this.setSearch("");
        });
        this.searchBox.append(icon(ICONS.search), this.searchInput, this.searchClear);

        this.expandBtn = this.button(ICONS.expand, "", "Abrir o próximo nível da hierarquia", () => this.expandNextLevel());
        this.collapseBtn = this.button(ICONS.collapse, "", "Fechar todos os níveis", () => {
            this.expanded.clear();
            this.renderBody();
        });
        this.heatBtn = this.button(ICONS.heat, "Mapa de calor", "Ligar ou desligar o mapa de calor", () => {
            this.heatmapOn = !this.heatmapOn;
            this.refreshToggles();
            this.renderBody();
        });
        this.deltaBtn = this.button(ICONS.delta, "Desvio", "Mostrar a diferença de cada valor para a referência", () => {
            this.deltaOn = !this.deltaOn;
            this.refreshToggles();
            this.renderBody();
        });
        this.focusBtn = this.button(ICONS.focus, "Acima da ref.", "Mostrar só as linhas piores que a referência na medida-chave", () => {
            this.focusOn = !this.focusOn;
            this.refreshToggles();
            this.renderBody();
        });
        this.exportBtn = this.button(ICONS.download, "", "Exportar para Excel", () => this.exportExcel());
        for (const b of [this.heatBtn, this.deltaBtn, this.focusBtn]) {
            b.classList.add("md-switch");
        }
        tools.append(this.countEl, this.searchBox, this.expandBtn, this.collapseBtn, this.heatBtn, this.deltaBtn, this.focusBtn, this.exportBtn);
        this.bar.append(heading, tools);
    }

    private refreshToggles(): void {
        const set = (b: HTMLButtonElement, on: boolean): void => {
            b.classList.toggle("md-on", on);
            b.setAttribute("aria-pressed", String(on));
        };
        set(this.heatBtn, this.heatmapOn);
        set(this.deltaBtn, this.deltaOn);
        set(this.focusBtn, this.focusOn);
    }

    private updateToolbar(): void {
        const t = this.formattingSettings.toolbarCard;
        const model = this.model;
        const hasHierarchy = (model?.rowLevelNames.length || 0) > 1;
        const anyHeat = !!model && model.values.some(m => this.configs.get(m.index)?.heatmap);
        const show = (node: HTMLElement, on: boolean): void => {
            node.style.display = on ? "" : "none";
        };
        show(this.bar, t.show.value && !!model);
        this.titleEl.textContent = t.title.value || "";
        show(this.titleEl, !!t.title.value);
        show(this.fieldsEl, t.showFields.value);
        show(this.searchBox, t.showSearch.value && (model?.rows.length || 0) > 0);
        show(this.expandBtn, t.showExpand.value && hasHierarchy);
        show(this.collapseBtn, t.showExpand.value && hasHierarchy);
        show(this.heatBtn, t.showHeatmap.value && anyHeat);
        show(this.deltaBtn, t.showDelta.value);
        show(this.focusBtn, t.showFocus.value && !!this.keyMeasure && (model?.rows.length || 0) > 0);
        show(this.exportBtn, t.showExport.value);
        this.refreshToggles();
    }

    /** "Linhas: Diretoria › Gerente · Colunas: Mês", mais a contagem quando há filtro. */
    private updateFields(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        this.fieldsEl.replaceChildren();
        const part = (name: string, value: string): void => {
            const span = el("span", "md-field");
            span.append(el("span", "md-field-name", name + ": "), el("strong", undefined, value));
            this.fieldsEl.appendChild(span);
        };
        if (model.rowLevelNames.length) {
            part("Linhas", model.rowLevelNames.join(PATH_SEP));
        }
        if (model.columnLevelNames.length) {
            part("Colunas", model.columnLevelNames.join(PATH_SEP));
        }
        const filtering = !!this.search || this.focusOn;
        this.countEl.textContent = filtering ? `${this.visibleRows} de ${this.totalRows} ${this.totalRows === 1 ? "linha" : "linhas"}` : "";
        this.countEl.style.display = filtering ? "" : "none";
    }

    // ---------------------------------------------------------------- update

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            // Só redimensionar não muda os dados: evita redesenhar milhares de linhas a cada arraste.
            const layoutOnly = (options.type & ~(powerbi.VisualUpdateType.Resize | powerbi.VisualUpdateType.ResizeEnd)) === 0;
            this.root.classList.toggle("md-compact", options.viewport.width < 640);
            this.root.classList.toggle("md-tiny", options.viewport.width < 420);
            if (layoutOnly && this.model) {
                this.events?.renderingFinished(options);
                return;
            }

            const dataView: DataView | undefined = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.locale = this.host.locale || "pt-BR";

            if (dataView?.metadata?.segment) {
                this.host.fetchMoreData(true);
            }

            const s = this.formattingSettings;
            this.model = buildModel(dataView, this.locale, s.totalsCard.label.value || "Total");
            this.prepareAnalysis(dataView);
            this.initExpansion();
            this.initSort();
            this.initToggles();
            this.applyStyles();
            this.updateToolbar();
            this.renderBody();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const settings = this.formattingSettings || (this.formattingSettings = new VisualFormattingSettingsModel());
        const model = this.model;

        const key = settings.analysisCard.keyMeasure;
        key.items = [{ value: "", displayName: "(primeira medida)" }].concat(
            (model?.values || []).map(m => ({ value: m.queryName, displayName: m.name })));
        key.value = key.items.find(i => i.value === this.keyQuery) || key.items[0];

        settings.tableCard.zebraColor.visible = settings.tableCard.zebra.value;
        settings.smallBaseCard.visible = !!model?.base;
        settings.trendCard.visible = !!model && model.columnLevelNames.length > 0;
        settings.hotspotsCard.rank.visible = !!model?.base;

        const cards = settings.cards.slice();
        if (model?.values.length) {
            const index = cards.indexOf(settings.trendCard);
            settings.cards = cards.slice(0, index + 1).concat(buildMeasureCard(model.values, this.configs), cards.slice(index + 1));
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(settings);
        settings.cards = cards;
        return formattingModel;
    }

    // ------------------------------------------------------------- preparo

    private prepareAnalysis(dataView: DataView | undefined): void {
        const model = this.model;
        this.configs.clear();
        this.analysis = undefined;
        this.keyMeasure = undefined;
        this.hotspotList = [];
        if (!model) {
            return;
        }
        // A lista do painel só tem as medidas atuais, então o valor salvo é lido direto do objeto.
        this.keyQuery = String(dataView?.metadata?.objects?.analysis?.keyMeasure ?? "");
        this.keyMeasure = model.values.find(m => m.queryName === this.keyQuery) || model.values[0];
        for (const m of model.values) {
            this.configs.set(m.index, readConfig(m, m === this.keyMeasure));
        }
        const a = this.formattingSettings.analysisCard;
        this.analysis = new Analysis(model, this.configs, {
            locale: this.locale,
            minBase: Math.max(0, this.formattingSettings.smallBaseCard.minBase.value || 0),
            worse: a.worseColor.value.value,
            better: a.betterColor.value.value,
            neutral: a.neutralColor.value.value,
            scale: a.scaleColor.value.value,
            colorBetter: a.colorBetter.value,
            intensity: Math.min(100, Math.max(10, a.intensity.value || 0)) / 100
        });
        const h = this.formattingSettings.hotspotsCard;
        if (h.show.value && this.keyMeasure && model.rows.length) {
            this.hotspotList = this.analysis.hotspots(this.keyMeasure, Math.min(5, Math.max(1, Math.round(h.count.value || 3))),
                enumValue(h.scope), enumValue(h.level), enumValue(h.rank));
        }
    }

    private layoutSignature(): string {
        const model = this.model;
        return model ? model.rowLevelNames.join("|") + "#" + model.columnLevelNames.join("|") + "#" + model.values.map(m => m.queryName).join("|") : "";
    }

    /** Abre os níveis de "Níveis abertos ao carregar" quando o visual é montado, a opção muda ou os campos mudam. */
    private initExpansion(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const depth = Math.max(0, Math.round(this.formattingSettings.rowHeadersCard.expandLevel.value || 0));
        const signature = depth + "|" + model.rowLevelNames.join("|");
        if (signature === this.expandSignature) {
            return;
        }
        this.expandSignature = signature;
        this.expanded.clear();
        const walk = (items: RowItem[]): void => {
            for (const row of items) {
                if (row.children.length && row.level < depth) {
                    this.expanded.add(row.id);
                    walk(row.children);
                }
            }
        };
        walk(model.rows);
    }

    /** Coluna usada para ordenar pela medida-chave: a de total, ou a primeira com a medida. */
    private keyColumn(): ValueColumn | undefined {
        const model = this.model;
        const key = this.keyMeasure;
        if (!model || !key) {
            return undefined;
        }
        const total = model.totalGroup ? model.columns.find(c => c.group === model.totalGroup && c.measure === key) : undefined;
        return total || model.columns.find(c => c.measure === key);
    }

    private initSort(): void {
        const initial = enumValue(this.formattingSettings.analysisCard.initialSort);
        const signature = initial + "#" + this.keyQuery + "#" + this.layoutSignature();
        if (signature === this.sortSignature) {
            return;
        }
        this.sortSignature = signature;
        const keyCol = this.keyColumn();
        this.sort = initial === "label" ? { key: "#label", dir: 1 }
            : (initial === "keyDesc" || initial === "keyAsc") && keyCol ? { key: keyCol.key, dir: initial === "keyDesc" ? -1 : 1 }
                : undefined;
    }

    /** Estado inicial dos botões; volta ao padrão quando o autor muda a opção. */
    private initToggles(): void {
        const a = this.formattingSettings.analysisCard;
        const signature = [a.heatmapOn.value, a.deltaOn.value, a.focusOn.value].join("|");
        if (signature === this.toggleDefaults) {
            return;
        }
        this.toggleDefaults = signature;
        this.heatmapOn = a.heatmapOn.value;
        this.deltaOn = a.deltaOn.value;
        this.focusOn = a.focusOn.value;
    }

    // ------------------------------------------------------- linhas visíveis

    /** Colunas usadas pelo botão "Acima da ref.": a de total ou, sem ela, todas (basta uma estar pior). */
    private focusGroups(): ColumnGroup[] {
        const model = this.model;
        if (!model) {
            return [];
        }
        return model.totalGroup ? [model.totalGroup] : model.groups.filter(g => !g.isSubtotal);
    }

    private buildView(items: RowItem[], needText: boolean, query: string): ViewNode[] {
        const analysis = this.analysis;
        const key = this.keyMeasure;
        const groups = this.focusGroups();
        const focus = this.focusOn && !!analysis && !!key && groups.length > 0;
        const out: ViewNode[] = [];
        for (const row of items) {
            const textHit = !needText || normalize(row.label).includes(query);
            // Quando a linha bate com a pesquisa, os filhos aparecem todos (ao abrir).
            const children = this.buildView(row.children, needText && !textHit, query);
            const focusHit = !focus || groups.some(g => (analysis as Analysis).isWorse(row, g, key as Measure));
            const selfHit = textHit && focusHit;
            if (selfHit || children.length) {
                out.push({ row, children, forceOpen: !selfHit || (needText && !textHit) });
            }
        }
        return this.sortNodes(out);
    }

    private sortNodes(nodes: ViewNode[]): ViewNode[] {
        const sort = this.sort;
        const model = this.model;
        if (!sort || !model) {
            return nodes;
        }
        if (sort.key === "#label") {
            return nodes.sort((a, b) =>
                sort.dir * a.row.label.localeCompare(b.row.label, this.locale, { numeric: true, sensitivity: "base" }) || a.row.order - b.row.order);
        }
        const col = model.columns.find(c => c.key === sort.key);
        if (!col || !this.analysis) {
            return nodes;
        }
        const analysis = this.analysis;
        const value = (r: RowItem): number | undefined => analysis.value(r, col.group, col.measure);
        return nodes.sort((a, b) => {
            const va = value(a.row);
            const vb = value(b.row);
            if (va === undefined || vb === undefined) {
                return va === vb ? a.row.order - b.row.order : va === undefined ? 1 : -1;
            }
            return sort.dir * (va - vb) || a.row.order - b.row.order;
        });
    }

    private setSearch(value: string): void {
        const q = normalize(value.trim());
        this.searchBox.classList.toggle("md-has-text", !!value);
        if (q === this.search) {
            return;
        }
        this.search = q;
        this.renderBody();
    }

    private toggleSort(key: string): void {
        const current = this.sort?.key === key ? this.sort.dir : 0;
        // Nome: A–Z > Z–A > ordem do Power BI. Valores: maior primeiro > menor primeiro > ordem do Power BI.
        const first: 1 | -1 = key === "#label" ? 1 : -1;
        this.sort = current === 0 ? { key, dir: first } : current === first ? { key, dir: -first as 1 | -1 } : undefined;
        this.renderBody();
    }

    private expandNextLevel(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        // Menor nível que ainda tem linhas fechadas (entre as que estão à vista).
        let level = Infinity;
        const find = (items: RowItem[]): void => {
            for (const row of items) {
                if (!row.children.length) {
                    continue;
                }
                if (this.expanded.has(row.id)) {
                    find(row.children);
                } else {
                    level = Math.min(level, row.level);
                }
            }
        };
        find(model.rows);
        if (level === Infinity) {
            return;
        }
        const open = (items: RowItem[]): void => {
            for (const row of items) {
                if (row.children.length && row.level <= level) {
                    this.expanded.add(row.id);
                    open(row.children);
                }
            }
        };
        open(model.rows);
        this.renderBody();
    }

    // ---------------------------------------------------------------- render

    private renderBody(): void {
        const scrollTop = this.scroller.scrollTop;
        const scrollLeft = this.scroller.scrollLeft;
        this.scroller.replaceChildren();
        this.insights.replaceChildren();

        const model = this.model;
        if (!model || model.columns.length === 0) {
            this.insights.style.display = "none";
            const empty = el("div", "md-empty");
            empty.append(
                el("strong", undefined, "Matriz Diagnóstica"),
                el("span", undefined, "Coloque campos (ou um parâmetro de campo) em \"Linhas\" e \"Colunas\" e as medidas em \"Valores\". "
                    + "Opcional: uma medida de volume (ex.: Headcount) em \"Base\" para marcar amostras pequenas.")
            );
            this.scroller.appendChild(empty);
            return;
        }

        const view = this.buildView(model.rows, !!this.search, this.search);
        this.renderTable(model, view);
        this.renderInsights(model);
        this.updateFields();

        this.scroller.scrollTop = scrollTop;
        this.scroller.scrollLeft = scrollLeft;
    }

    private showTrend(model: MatrixModel): boolean {
        return this.formattingSettings.trendCard.show.value && !!this.keyMeasure
            && model.groups.filter(g => !g.isSubtotal).length > 1;
    }

    private renderTable(model: MatrixModel, view: ViewNode[]): void {
        const s = this.formattingSettings;
        const table = el("table", "md-table");
        const head = this.renderHead(model);
        table.appendChild(head);

        const body = el("tbody");
        let count = 0;
        const addRows = (nodes: ViewNode[]): void => {
            for (const node of nodes) {
                if (count++ >= MAX_RENDERED_ROWS) {
                    return;
                }
                const open = node.children.length > 0 && (node.forceOpen || this.expanded.has(node.row.id));
                body.appendChild(this.renderRow(model, node.row, node.children.length > 0, open));
                if (open) {
                    addRows(node.children);
                }
            }
        };
        addRows(view);
        this.countRows(model, view);
        table.appendChild(body);
        table.classList.toggle("md-has-selection", this.selected.size > 0);

        if (model.grandTotal && s.totalsCard.showGrandTotal.value) {
            const totalRow = this.renderRow(model, model.grandTotal, false, false);
            if (enumValue(s.totalsCard.position) === "top" && model.rows.length) {
                totalRow.classList.add("md-total-top");
                head.appendChild(totalRow);
            } else {
                const foot = el("tfoot");
                foot.appendChild(totalRow);
                table.appendChild(foot);
            }
        }
        if (count === 0 && model.rows.length) {
            const tr = el("tr", "md-noresult");
            const td = el("td", undefined, this.focusOn && !this.search
                ? "Nenhuma linha está pior que a referência."
                : "Nenhuma linha encontrada.");
            td.colSpan = model.columns.length + 2;
            tr.appendChild(td);
            body.appendChild(tr);
        }
        this.scroller.appendChild(table);
    }

    private countRows(model: MatrixModel, view: ViewNode[]): void {
        let total = 0;
        const all = (items: RowItem[]): void => items.forEach(r => {
            total++;
            all(r.children);
        });
        all(model.rows);
        let visible = 0;
        const shown = (nodes: ViewNode[]): void => nodes.forEach(n => {
            visible++;
            shown(n.children);
        });
        shown(view);
        this.totalRows = total;
        this.visibleRows = visible;
    }

    private cornerTitle(model: MatrixModel): string {
        return this.formattingSettings.rowHeadersCard.title.value || model.rowLevelNames.join(PATH_SEP);
    }

    private sortMark(th: HTMLElement, key: string): void {
        th.classList.add("md-sortable");
        if (this.sort?.key === key) {
            th.classList.add(this.sort.dir < 0 ? "md-sort-desc" : "md-sort-asc");
            th.setAttribute("aria-sort", this.sort.dir < 0 ? "descending" : "ascending");
        }
        th.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.toggleSort(key);
        });
    }

    private renderHead(model: MatrixModel): HTMLTableSectionElement {
        const s = this.formattingSettings;
        const head = el("thead");
        const cols = model.columns;
        const memberLevels = model.columnLevelNames.length;
        const showMeasureRow = model.values.length > 1 || memberLevels === 0;
        const headerRows = memberLevels + (showMeasureRow ? 1 : 0);
        const multi = model.values.length > 1;
        const trend = this.showTrend(model);
        const trendAtStart = enumValue(s.trendCard.position) === "start";

        // Canto: campos das colunas em cima e das linhas embaixo (clique ordena pelo nome).
        const corner = el("th", "md-corner");
        corner.rowSpan = headerRows;
        corner.scope = "col";
        const cornerInner = el("div", "md-corner-inner");
        if (memberLevels) {
            cornerInner.appendChild(el("span", "md-corner-cols", model.columnLevelNames.join(PATH_SEP) + " →"));
        }
        const rowTitle = el("span", "md-corner-rows", this.cornerTitle(model) || " ");
        cornerInner.appendChild(rowTitle);
        corner.appendChild(cornerInner);
        if (model.rows.length) {
            this.sortMark(corner, "#label");
            corner.title = "Ordenar pelo nome";
        }

        const trendHead = (): HTMLTableCellElement => {
            const th = el("th", "md-trend-head");
            th.rowSpan = headerRows;
            th.append(el("span", "md-trend-title", s.trendCard.title.value || "Tendência"),
                el("span", "md-trend-measure", this.keyMeasure?.name || ""));
            return th;
        };

        const isGroupStart = (i: number): boolean => multi && (i === 0 || cols[i].group !== cols[i - 1].group);
        const rows: HTMLTableRowElement[] = [];
        for (let level = 0; level < memberLevels; level++) {
            const tr = el("tr");
            const leafRow = !showMeasureRow && level === memberLevels - 1;
            let i = 0;
            while (i < cols.length) {
                const prefix = (c: ValueColumn): string => c.group.labels.slice(0, level + 1).join("\u001f") + (c.group.isSubtotal ? "#t" : "");
                let j = i + 1;
                while (j < cols.length && prefix(cols[j]) === prefix(cols[i])) {
                    j++;
                }
                const c = cols[i];
                const label = c.group.labels[level] ?? "";
                const th = el("th", "md-member" + (c.group.isSubtotal ? " md-col-total" : ""), label);
                th.colSpan = j - i;
                th.scope = "colgroup";
                th.title = label;
                if (isGroupStart(i) || (i > 0 && cols[i].group.labels[0] !== cols[i - 1].group.labels[0])) {
                    th.classList.add("md-group-start");
                }
                if (leafRow) {
                    th.classList.add("md-leafhead");
                    this.sortMark(th, c.key);
                    th.title = `${label} · ${c.measure.name}`;
                }
                tr.appendChild(th);
                i = j;
            }
            rows.push(tr);
        }
        if (showMeasureRow) {
            const tr = el("tr");
            cols.forEach((c, i) => {
                // Nomes curtos não quebram (ex.: "Turnover %"); os longos quebram se a opção estiver ligada.
                const th = el("th", "md-measure md-leafhead" + (c.measure.name.length <= 18 ? " md-nowrap" : ""), c.measure.name);
                th.scope = "col";
                th.title = c.measure.name;
                if (isGroupStart(i)) {
                    th.classList.add("md-group-start");
                }
                if (c.group.isSubtotal) {
                    th.classList.add("md-col-total");
                }
                this.sortMark(th, c.key);
                tr.appendChild(th);
            });
            rows.push(tr);
        }

        rows[0].insertBefore(corner, rows[0].firstChild);
        if (trend) {
            if (trendAtStart) {
                rows[0].insertBefore(trendHead(), corner.nextSibling);
            } else {
                rows[0].appendChild(trendHead());
            }
        }
        rows.forEach(r => head.appendChild(r));
        return head;
    }

    private renderRow(model: MatrixModel, row: RowItem, hasChildren: boolean, open: boolean): HTMLTableRowElement {
        const s = this.formattingSettings;
        const tr = el("tr", row.isGrandTotal ? "md-total" : hasChildren ? "md-parent" : "md-leaf");
        tr.dataset.id = row.id;
        if (row.children.length) {
            tr.classList.add("md-has-children");
        }

        // ---- nome da linha
        const head = el("th", "md-rowhead");
        head.scope = "row";
        head.style.setProperty("--md-level", String(row.isGrandTotal ? 0 : row.level));
        const inner = el("div", "md-rowhead-inner");
        if (hasChildren) {
            const toggle = el("button", "md-toggle" + (open ? " md-open" : ""));
            toggle.type = "button";
            toggle.setAttribute("aria-expanded", String(open));
            toggle.setAttribute("aria-label", (open ? "Fechar " : "Abrir ") + row.label);
            toggle.appendChild(icon(ICONS.chevron, "md-chevron"));
            inner.appendChild(toggle);
            head.classList.add("md-expandable");
        } else if (model.rowLevelNames.length > 1 && !row.isGrandTotal) {
            inner.appendChild(el("span", "md-toggle-spacer"));
        }
        inner.appendChild(this.labelWithMatch(row.label));
        if (this.hotspotList.some(h => h.row === row)) {
            const flag = el("span", "md-flag");
            flag.title = "Ponto de atenção";
            inner.appendChild(flag);
        }
        head.appendChild(inner);
        if (this.isRowTouched(row)) {
            head.classList.add("md-sel");
        }
        head.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (hasChildren) {
                this.toggleRow(row, open);
            } else if (!row.isGrandTotal) {
                this.select(row, undefined, e.ctrlKey || e.metaKey);
            }
        });
        if (!row.isGrandTotal) {
            head.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectionManager.showContextMenu(this.selectionId(model, row, undefined), { x: e.clientX, y: e.clientY });
            });
        }
        tr.appendChild(head);

        // ---- tendência e valores
        const trend = this.showTrend(model);
        const trendAtStart = enumValue(s.trendCard.position) === "start";
        if (trend && trendAtStart) {
            tr.appendChild(this.renderTrend(model, row));
        }
        model.columns.forEach((c, i) => tr.appendChild(this.renderCell(model, row, c, i)));
        if (trend && !trendAtStart) {
            tr.appendChild(this.renderTrend(model, row));
        }
        return tr;
    }

    /** Nome da linha com o trecho pesquisado destacado. */
    private labelWithMatch(label: string): HTMLElement {
        const span = el("span", "md-label");
        span.title = label;
        const q = this.search;
        if (!q) {
            span.textContent = label;
            return span;
        }
        // Texto sem acentos com a posição de cada letra no original, para destacar o trecho certo.
        let plain = "";
        const origin: number[] = [];
        for (let i = 0; i < label.length; i++) {
            for (const ch of normalize(label[i])) {
                plain += ch;
                origin.push(i);
            }
        }
        const at = plain.indexOf(q);
        if (at < 0) {
            span.textContent = label;
            return span;
        }
        const start = origin[at];
        const end = origin[at + q.length - 1] + 1;
        span.append(label.slice(0, start), el("mark", "md-mark", label.slice(start, end)), label.slice(end));
        return span;
    }

    private renderCell(model: MatrixModel, row: RowItem, c: ValueColumn, i: number): HTMLTableCellElement {
        const s = this.formattingSettings;
        const analysis = this.analysis as Analysis;
        const cfg = this.configs.get(c.measure.index);
        const cell = cellValue(model, row, c.group.key, c.measure.index);
        const raw = cell?.value;
        const empty = raw === null || raw === undefined || raw === "";
        const lowBase = analysis.isLowBase(row, c.group);
        const hide = lowBase && s.smallBaseCard.hideValues.value;

        const td = el("td", "md-cell");
        if (model.values.length > 1 && (i === 0 || c.group !== model.columns[i - 1].group)) {
            td.classList.add("md-group-start");
        }
        if (c.group.isSubtotal) {
            td.classList.add("md-col-total");
        }
        const content = el("div", "md-cv");
        const valueText = hide ? "•••" : empty ? (s.valuesCard.emptyText.value ?? "–") : c.measure.format(raw);
        const valueEl = el("span", "md-val" + (empty && !hide ? " md-empty-value" : ""), valueText);
        content.appendChild(valueEl);

        // Cores: fx do Power BI > mapa de calor > barras de dados.
        const fxFill = colorProp(cell?.objects, "fill") || cfg?.fill || "";
        const fxFont = colorProp(cell?.objects, "fontColor") || cfg?.fontColor || "";
        const heat = !fxFill && this.heatmapOn && !hide ? analysis.heatColor(row, c.group, c.measure) : undefined;
        const background = fxFill || heat || "";
        if (background) {
            td.style.background = background;
            td.style.color = fxFont || readableText(background, DARK);
            td.classList.add("md-colored");
        } else if (fxFont) {
            td.style.color = fxFont;
        }
        if (!background && cfg?.dataBars && !empty && !lowBase && !row.isGrandTotal) {
            const ratio = analysis.barRatio(row, c.group, c.measure);
            if (ratio !== undefined && ratio > 0) {
                const pct = (ratio * 100).toFixed(1);
                td.style.backgroundImage = `linear-gradient(90deg, ${alpha(s.valuesCard.barColor.value.value, 0.32)} ${pct}%, transparent ${pct}%)`;
            }
        }

        // Desvio para a referência.
        if (this.deltaOn && cfg?.delta && !empty && !lowBase) {
            const dev = analysis.deviation(row, c.group, c.measure);
            if (dev !== undefined) {
                const signed = analysis.signedDeviation(row, c.group, c.measure) as number;
                const neutral = cfg.direction === "neutral" || analysis.isZeroDelta(c.measure, dev);
                const delta = el("span", "md-delta" + (neutral ? "" : signed > 0 ? " md-worse" : signed < 0 ? " md-better" : ""),
                    analysis.formatDelta(c.measure, dev));
                content.appendChild(delta);
            }
        }

        if (lowBase) {
            td.classList.add("md-lowbase");
            if (s.smallBaseCard.pattern.value) {
                td.classList.add("md-hatch");
            }
        }
        if (this.isCellSelected(row, c.group)) {
            td.classList.add("md-sel");
        }
        td.appendChild(content);
        this.bindCell(td, model, row, c.group, c.measure);
        return td;
    }

    private renderTrend(model: MatrixModel, row: RowItem): HTMLTableCellElement {
        const s = this.formattingSettings;
        const td = el("td", "md-trend");
        const analysis = this.analysis;
        const key = this.keyMeasure;
        if (!analysis || !key) {
            return td;
        }
        const groups = model.groups.filter(g => !g.isSubtotal);
        const values = groups.map(g => analysis.value(row, g, key));
        const nums = values.filter((v): v is number => v !== undefined);
        if (nums.length < 2) {
            return td;
        }
        const w = Math.max(40, (s.trendCard.width.value || 120) - 20);
        const h = Math.max(14, (s.tableCard.rowHeight.value || 34) - 14);
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const x = (i: number): number => 3 + (groups.length === 1 ? 0 : i * (w - 6) / (groups.length - 1));
        const y = (v: number): number => max === min ? h / 2 : 3 + (1 - (v - min) / (max - min)) * (h - 6);

        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "md-spark");
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        svg.style.setProperty("--md-spark", s.trendCard.lineColor.value.value);

        // Linha em segmentos (meses sem valor quebram a linha).
        let d = "";
        let pen = false;
        values.forEach((v, i) => {
            if (v === undefined) {
                pen = false;
                return;
            }
            d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
            pen = true;
        });
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("class", "md-spark-line");
        svg.appendChild(path);

        const dot = (i: number, v: number, cls: string, r: number): void => {
            const c = document.createElementNS(SVG_NS, "circle");
            c.setAttribute("cx", x(i).toFixed(1));
            c.setAttribute("cy", y(v).toFixed(1));
            c.setAttribute("r", String(r));
            c.setAttribute("class", cls);
            svg.appendChild(c);
        };
        if (s.trendCard.markWorse.value) {
            const worse = this.formattingSettings.analysisCard.worseColor.value.value;
            values.forEach((v, i) => {
                if (v !== undefined && analysis.isWorse(row, groups[i], key) && !row.isGrandTotal) {
                    dot(i, v, "md-spark-worse", 2.2);
                }
            });
            svg.style.setProperty("--md-spark-worse", worse);
        }
        let last = values.length - 1;
        while (last >= 0 && values[last] === undefined) {
            last--;
        }
        dot(last, values[last] as number, "md-spark-last", 2.6);
        td.appendChild(svg);

        // Dica de ferramenta: valor de cada coluna.
        const items = (): VisualTooltipDataItem[] => groups.map((g, i) => ({
            displayName: g.labels.join(PATH_SEP),
            value: values[i] === undefined ? "–" : key.format(values[i] as number)
        }));
        this.bindTooltip(td, () => [{ displayName: key.name, value: "", header: this.rowTitle(row) } as VisualTooltipDataItem].concat(items()), []);
        return td;
    }

    // ------------------------------------------------------------- insights

    private renderInsights(model: MatrixModel): void {
        const s = this.formattingSettings;
        const box = this.insights;
        const analysis = this.analysis;
        const key = this.keyMeasure;
        let any = false;

        if (this.hotspotList.length && analysis && key) {
            any = true;
            const list = el("div", "md-hotspots");
            const title = s.hotspotsCard.title.value;
            if (title) {
                const t = el("span", "md-hot-title");
                t.append(icon(ICONS.alert, "md-icon md-hot-icon"), el("span", undefined, title));
                list.appendChild(t);
            }
            this.hotspotList.forEach(h => {
                const chip = el("button", "md-chip");
                chip.type = "button";
                // Só o nome da linha (o caminho completo aparece na dica de ferramenta).
                const where = h.group.isSubtotal || !h.group.labels.length ? h.row.label : h.row.label + " · " + h.group.labels.join(PATH_SEP);
                chip.append(
                    el("span", "md-chip-dot"),
                    el("span", "md-chip-label", where),
                    el("strong", "md-chip-value", key.format(h.value)),
                    el("span", "md-chip-delta", analysis.formatDelta(key, h.deviation))
                );
                chip.title = "Mostrar na tabela";
                chip.addEventListener("click", (e: MouseEvent) => {
                    e.stopPropagation();
                    this.reveal(h);
                });
                this.bindTooltip(chip, () => this.cellTooltip(model, h.row, h.group, key), []);
                list.appendChild(chip);
            });
            box.appendChild(list);
            // A roda do mouse rola os pontos de atenção para o lado quando eles não cabem.
            list.addEventListener("wheel", (e: WheelEvent) => {
                if (list.scrollWidth > list.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    e.preventDefault();
                    list.scrollLeft += e.deltaY;
                }
            }, { passive: false });
            window.requestAnimationFrame(() => list.classList.toggle("md-overflow", list.scrollWidth > list.clientWidth + 1));
        }

        // Legenda do mapa de calor (para a medida-chave).
        const cfg = key ? this.configs.get(key.index) : undefined;
        if (this.heatmapOn && key && cfg?.heatmap && analysis) {
            any = true;
            const a = s.analysisCard;
            const legend = el("div", "md-legend");
            const neutral = cfg.direction === "neutral";
            const ramp = el("span", "md-ramp");
            const lo = neutral ? a.neutralColor.value.value : a.colorBetter.value ? a.betterColor.value.value : a.neutralColor.value.value;
            const hi = neutral ? a.scaleColor.value.value : a.worseColor.value.value;
            ramp.style.background = neutral
                ? `linear-gradient(90deg, ${lo}, ${hi})`
                : `linear-gradient(90deg, ${lo}, ${a.neutralColor.value.value} 50%, ${hi})`;
            const refText = this.referenceText(model, key, cfg);
            legend.append(
                el("span", "md-legend-end", neutral ? "Menor" : "Melhor"),
                ramp,
                el("span", "md-legend-end", neutral ? "Maior" : "Pior")
            );
            if (refText && !neutral) {
                const ref = el("span", "md-legend-ref", refText);
                ref.title = `${key.name} comparado com ${analysis.referenceLabel(key).toLowerCase()}`;
                legend.appendChild(ref);
            }
            if (model.base && this.formattingSettings.smallBaseCard.minBase.value > 0 && s.smallBaseCard.pattern.value) {
                const lb = el("span", "md-legend-low");
                lb.title = `${model.base.name} abaixo de ${model.base.format(s.smallBaseCard.minBase.value)}: amostra pequena`;
                lb.append(el("span", "md-legend-hatch"), el("span", undefined, `base < ${model.base.format(s.smallBaseCard.minBase.value)}`));
                legend.appendChild(lb);
            }
            box.appendChild(legend);
        }
        box.style.display = any ? "" : "none";
    }

    /** "ref.: total geral 7,9%". */
    private referenceText(model: MatrixModel, key: Measure, cfg: MeasureConfig): string {
        const analysis = this.analysis as Analysis;
        const label = analysis.referenceLabel(key).toLowerCase();
        let value: number | undefined;
        if (cfg.reference === "fixed") {
            value = cfg.target;
        } else if (cfg.reference === "total" && model.grandTotal && model.totalGroup) {
            value = analysis.value(model.grandTotal, model.totalGroup, key);
        }
        return `ref.: ${label}` + (value !== undefined ? ` ${key.format(value)}` : "");
    }

    /** Abre a hierarquia até a linha do ponto de atenção, rola até ela e pisca a célula. */
    private reveal(h: Hotspot): void {
        for (let r = h.row.parent; r; r = r.parent) {
            this.expanded.add(r.id);
        }
        const isVisible = (): boolean => {
            const find = (nodes: ViewNode[]): boolean => nodes.some(n => n.row === h.row || find(n.children));
            return find(this.buildView(this.model?.rows || [], !!this.search, this.search));
        };
        if (!isVisible()) {
            this.search = "";
            this.searchInput.value = "";
            this.searchBox.classList.remove("md-has-text");
            if (!isVisible()) {
                this.focusOn = false;
                this.refreshToggles();
            }
        }
        this.renderBody();
        const tr = Array.from(this.scroller.querySelectorAll<HTMLElement>("tbody tr")).find(t => t.dataset.id === h.row.id);
        if (!tr) {
            return;
        }
        const col = this.model?.columns.findIndex(c => c.group === h.group && c.measure === this.keyMeasure) ?? -1;
        const target = col >= 0 ? tr.querySelectorAll<HTMLElement>(".md-cell")[col] : undefined;
        const box = this.scroller.getBoundingClientRect();
        const rect = tr.getBoundingClientRect();
        this.scroller.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2;
        if (target) {
            const rowHead = tr.querySelector<HTMLElement>(".md-rowhead");
            const t = target.getBoundingClientRect();
            const left = box.left + (rowHead?.offsetWidth || 0);
            if (t.left < left || t.right > box.right) {
                this.scroller.scrollLeft += t.left - left - 24;
            }
        }
        tr.classList.add("md-flash");
        target?.classList.add("md-flash-cell");
        window.setTimeout(() => {
            tr.classList.remove("md-flash");
            target?.classList.remove("md-flash-cell");
        }, 1800);
    }

    // ------------------------------------------------------- dicas de ferramenta

    private rowTitle(row: RowItem): string {
        return row.isGrandTotal ? row.label : rowPath(row).map(r => r.label).join(PATH_SEP);
    }

    private ordinal(n: number): string {
        return n + "º";
    }

    private cellTooltip(model: MatrixModel, row: RowItem, group: ColumnGroup, measure: Measure): VisualTooltipDataItem[] {
        const analysis = this.analysis as Analysis;
        const s = this.formattingSettings;
        const items: VisualTooltipDataItem[] = [];
        const header = this.rowTitle(row);
        const add = (displayName: string, value: string, color?: string): void => {
            items.push({ displayName, value, color, header });
        };
        if (group.labels.length) {
            add(model.columnLevelNames.join(PATH_SEP) || "Coluna", group.labels.join(PATH_SEP));
        }
        const lowBase = analysis.isLowBase(row, group);
        const hide = lowBase && s.smallBaseCard.hideValues.value;
        const fmt = (m: Measure, v: unknown): string => v === null || v === undefined || v === "" ? "–" : m.format(v as powerbi.PrimitiveValue);
        add(measure.name, hide ? "oculto (base pequena)" : fmt(measure, cellValue(model, row, group.key, measure.index)?.value));

        const cfg = this.configs.get(measure.index);
        if (cfg && !hide) {
            const ref = analysis.reference(row, group, measure);
            const dev = analysis.deviation(row, group, measure);
            if (ref !== undefined) {
                add(`Referência (${analysis.referenceLabel(measure).toLowerCase()})`, measure.format(ref));
            }
            if (dev !== undefined && ref !== undefined && !lowBase) {
                const signed = analysis.signedDeviation(row, group, measure) as number;
                const a = s.analysisCard;
                const color = cfg.direction === "neutral" || analysis.isZeroDelta(measure, dev) ? undefined
                    : signed > 0 ? a.worseColor.value.value : a.betterColor.value.value;
                const rel = analysis.formatRelative(dev, ref);
                add("Desvio", analysis.formatDelta(measure, dev) + (rel ? ` (${rel})` : ""), color);
                if (model.base && measure.isPercent) {
                    const base = analysis.baseValue(row, group);
                    if (base !== undefined) {
                        const impact = dev * base;
                        add(`Impacto (desvio × ${model.base.name})`, (impact > 0 ? "+" : impact < 0 ? "−" : "") + Math.abs(impact).toLocaleString(this.locale, { maximumFractionDigits: 1 }));
                    }
                }
            }
            const rank = analysis.rank(row, group, measure);
            if (rank && rank.count > 1) {
                add("Posição no nível", `${this.ordinal(rank.position)} maior de ${rank.count}`);
            }
        }
        // Outras medidas da mesma célula (dão contexto: desligados, headcount…).
        for (const m of model.values) {
            if (m !== measure && !hide) {
                add(m.name, fmt(m, cellValue(model, row, group.key, m.index)?.value));
            }
        }
        if (model.base) {
            add(model.base.name, fmt(model.base, cellValue(model, row, group.key, model.base.index)?.value));
        }
        for (const m of model.tooltips) {
            add(m.name, fmt(m, cellValue(model, row, group.key, m.index)?.value));
        }
        if (lowBase) {
            add("Atenção", `amostra pequena (${model.base?.name} abaixo de ${model.base?.format(s.smallBaseCard.minBase.value)}): interprete com cautela`);
        }
        return items;
    }

    private bindTooltip(node: HTMLElement, items: () => VisualTooltipDataItem[], identities: ISelectionId[]): void {
        const args = (e: MouseEvent) => ({ coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: items(), identities });
        node.addEventListener("mouseenter", (e: MouseEvent) => this.host.tooltipService.show(args(e)));
        node.addEventListener("mousemove", (e: MouseEvent) => this.host.tooltipService.move(args(e)));
        node.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
    }

    private bindCell(td: HTMLElement, model: MatrixModel, row: RowItem, group: ColumnGroup, measure: Measure): void {
        const id = row.isGrandTotal ? undefined : this.selectionId(model, row, group);
        this.bindTooltip(td, () => this.cellTooltip(model, row, group, measure), id ? [id] : []);
        if (!id) {
            return;
        }
        td.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            this.select(row, group, e.ctrlKey || e.metaKey);
        });
        td.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectionManager.showContextMenu(id, { x: e.clientX, y: e.clientY });
        });
    }

    // ----------------------------------------------------------- seleção

    private selectionKey(row: RowItem, group: ColumnGroup | undefined): string {
        return group?.node ? row.id + "||" + group.key : row.id;
    }

    private isCellSelected(row: RowItem, group: ColumnGroup): boolean {
        return this.selected.has(row.id) || this.selected.has(row.id + "||" + group.key);
    }

    private isRowTouched(row: RowItem): boolean {
        for (const key of this.selected) {
            if (key === row.id || key.startsWith(row.id + "||")) {
                return true;
            }
        }
        return false;
    }

    private selectionId(model: MatrixModel, row: RowItem, group: ColumnGroup | undefined): ISelectionId {
        const builder = this.host.createSelectionIdBuilder().withMatrixNode(row.node, model.rowLevels);
        if (group?.node) {
            builder.withMatrixNode(group.node, model.columnLevels);
        }
        return builder.createSelectionId();
    }

    /** Clique numa célula filtra os outros visuais pela linha × coluna; no nome da linha, só pela linha (Ctrl para várias). */
    private select(row: RowItem, group: ColumnGroup | undefined, multi: boolean): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const key = this.selectionKey(row, group);
        const id = this.selectionId(model, row, group);
        const already = this.selected.has(key);
        if (multi) {
            if (already) {
                this.selected.delete(key);
            } else {
                this.selected.add(key);
            }
            this.selectionManager.select(id, true);
        } else if (already && this.selected.size === 1) {
            this.selected.clear();
            this.selectionManager.clear();
        } else {
            this.selected = new Set([key]);
            this.selectionManager.select(id, false);
        }
        this.renderBody();
    }

    private clearSelection(): void {
        if (this.selected.size) {
            this.selected.clear();
            this.selectionManager.clear();
            this.renderBody();
        }
    }

    private toggleRow(row: RowItem, open: boolean): void {
        if (open) {
            this.expanded.delete(row.id);
        } else {
            this.expanded.add(row.id);
        }
        this.renderBody();
    }

    // --------------------------------------------------------------- exportar

    /** Gera um .xlsx com a matriz (hierarquia, totais e cores do mapa de calor) e baixa pelo Power BI. */
    private async exportExcel(): Promise<void> {
        const model = this.model;
        const download = this.host.downloadService;
        if (!model || !download) {
            return;
        }
        try {
            const status = await download.exportStatus();
            if (status !== powerbi.PrivilegeStatus.Allowed) {
                this.toast(status === powerbi.PrivilegeStatus.DisabledByAdmin
                    ? "O download por visuais personalizados está desativado pelo administrador do Power BI."
                    : "Este ambiente do Power BI não permite downloads a partir de visuais personalizados.");
                return;
            }
            const name = (this.formattingSettings.exportCard.fileName.value || "Matriz").replace(/[\\/:*?"<>|]/g, " ").trim() || "Matriz";
            const content = buildXlsx(this.buildSheet(model, name));
            const ok = await download.exportVisualsContent(content, name + ".xlsx", "xlsx", "Matriz exportada");
            if (!ok) {
                this.toast("O download foi cancelado.");
            }
        } catch (e) {
            this.toast("Não foi possível exportar: " + String(e));
        }
    }

    private buildSheet(model: MatrixModel, name: string): Sheet {
        const s = this.formattingSettings;
        const analysis = this.analysis as Analysis;
        const cols = model.columns;
        const headFill = s.columnHeaderCard.fill.value.value;
        const headFont = s.columnHeaderCard.memberColor.value.value;
        const rows: Cell[][] = [];
        const merges: Sheet["merges"] = [];
        const header = (value: string): Cell => ({
            value,
            style: { bold: true, fill: headFill, font: headFont, align: "center", borderBottom: true }
        });

        // Cabeçalho: um nível de membros por linha e, embaixo, as medidas.
        model.columnLevelNames.forEach((_, level) => {
            const r = rows.length;
            const row: Cell[] = [header("")];
            let i = 0;
            while (i < cols.length) {
                const prefix = (c: ValueColumn): string => c.group.labels.slice(0, level + 1).join("\u001f") + (c.group.isSubtotal ? "#t" : "");
                let j = i + 1;
                while (j < cols.length && prefix(cols[j]) === prefix(cols[i])) {
                    j++;
                }
                row[i + 1] = header(cols[i].group.labels[level] ?? "");
                for (let k = i + 1; k < j; k++) {
                    row[k + 1] = header("");
                }
                if (j - i > 1) {
                    merges.push({ r1: r, c1: i + 1, r2: r, c2: j });
                }
                i = j;
            }
            rows.push(row);
        });
        rows.push([header(this.cornerTitle(model))].concat(cols.map(c => header(c.measure.name))));
        const headerRows = rows.length;
        if (headerRows > 1) {
            merges.push({ r1: 0, c1: 0, r2: headerRows - 1, c2: 0 });
            rows[0][0] = header(this.cornerTitle(model));
            rows[headerRows - 1][0] = header("");
        }

        const allRows = s.exportCard.allRows.value;
        const totalFill = s.totalsCard.fill.value.value;
        const hideLow = s.smallBaseCard.hideValues.value;
        const addRow = (row: RowItem): void => {
            const bold = row.isGrandTotal || (row.children.length > 0 && s.rowHeadersCard.parentBold.value);
            const cells: Cell[] = [{
                value: row.label,
                style: { bold, indent: row.isGrandTotal ? 0 : row.level, align: "left", fill: row.isGrandTotal ? totalFill : undefined }
            }];
            for (const c of cols) {
                const cell = cellValue(model, row, c.group.key, c.measure.index);
                const raw = cell?.value;
                const hidden = hideLow && analysis.isLowBase(row, c.group);
                const fx = colorProp(cell?.objects, "fill") || this.configs.get(c.measure.index)?.fill || "";
                const heat = !fx && this.heatmapOn && !hidden ? analysis.heatColor(row, c.group, c.measure) : undefined;
                const fill = fx || heat || (row.isGrandTotal ? totalFill : undefined);
                cells.push({
                    value: hidden ? null : typeof raw === "number" ? raw : raw === null || raw === undefined ? null : String(raw),
                    style: {
                        bold: bold || c.group.isSubtotal,
                        numFmt: excelFormat(c.measure.source.format),
                        fill,
                        font: fx || heat ? readableText(fx || heat as string, DARK) : undefined,
                        align: "right"
                    }
                });
            }
            rows.push(cells);
        };
        const walk = (nodes: ViewNode[]): void => {
            for (const node of nodes) {
                addRow(node.row);
                if (node.children.length && (allRows || node.forceOpen || this.expanded.has(node.row.id))) {
                    walk(node.children);
                }
            }
        };
        // Exporta o que está filtrado e ordenado na tela.
        walk(this.buildView(model.rows, !!this.search, this.search));
        if (model.grandTotal && s.totalsCard.showGrandTotal.value) {
            addRow(model.grandTotal);
        }

        const labelWidth = Math.min(60, Math.max(18, ...model.rows.map(r => r.label.length + 4)));
        return {
            name,
            rows,
            merges,
            colWidths: [labelWidth].concat(cols.map(c => Math.min(28, Math.max(12, c.measure.name.length + 2)))),
            freeze: { rows: headerRows, cols: 1 }
        };
    }

    /** Mensagem rápida dentro do visual. */
    private toast(message: string): void {
        const box = el("div", "md-toast", message);
        this.root.appendChild(box);
        window.setTimeout(() => box.remove(), 5000);
    }

    // ---------------------------------------------------------------- estilos

    private applyStyles(): void {
        const s = this.formattingSettings;
        const st = this.root.style;
        const px = (v: number, min = 0): string => Math.max(min, v || 0) + "px";

        const t = s.tableCard;
        st.setProperty("--md-font", t.fontFamily.value);
        st.setProperty("--md-bg", t.fill.value.value);
        st.setProperty("--md-row-h", px(t.rowHeight.value, 20));
        st.setProperty("--md-zebra", t.zebraColor.value.value);
        this.root.classList.toggle("md-zebra", t.zebra.value);
        st.setProperty("--md-hover", t.hoverColor.value.value);
        st.setProperty("--md-grid", t.gridColor.value.value);
        st.setProperty("--md-radius", px(t.radius.value));
        st.setProperty("--md-bw", px(t.borderWidth.value));
        st.setProperty("--md-bc", t.borderColor.value.value);

        const tb = s.toolbarCard;
        st.setProperty("--md-title-size", px(tb.titleSize.value, 8));
        st.setProperty("--md-title-fg", tb.titleColor.value.value);
        st.setProperty("--md-btn-size", px(tb.fontSize.value, 8));
        st.setProperty("--md-btn-bg", tb.fill.value.value);
        st.setProperty("--md-btn-fg", tb.fontColor.value.value);
        st.setProperty("--md-btn-on-bg", tb.activeFill.value.value);
        st.setProperty("--md-btn-on-fg", tb.activeFontColor.value.value);
        st.setProperty("--md-btn-h", px(tb.height.value, 22));
        st.setProperty("--md-btn-radius", px(tb.radius.value));
        st.setProperty("--md-btn-bw", px(tb.borderWidth.value));
        st.setProperty("--md-btn-bc", tb.borderColor.value.value);

        const a = s.analysisCard;
        st.setProperty("--md-worse", a.worseColor.value.value);
        st.setProperty("--md-better", a.betterColor.value.value);

        const h = s.hotspotsCard;
        st.setProperty("--md-chip-bg", h.fill.value.value);
        st.setProperty("--md-chip-fg", h.fontColor.value.value);
        st.setProperty("--md-chip-size", px(h.fontSize.value, 8));
        st.setProperty("--md-chip-radius", px(h.radius.value));
        st.setProperty("--md-chip-bw", px(h.borderWidth.value));
        st.setProperty("--md-chip-bc", h.borderColor.value.value);

        st.setProperty("--md-trend-w", px(s.trendCard.width.value, 60));

        const ch = s.columnHeaderCard;
        st.setProperty("--md-head-bg", ch.fill.value.value);
        st.setProperty("--md-head-fg", ch.fontColor.value.value);
        st.setProperty("--md-member-fg", ch.memberColor.value.value);
        st.setProperty("--md-head-size", px(ch.fontSize.value, 6));
        st.setProperty("--md-head-case", ch.uppercase.value ? "uppercase" : "none");
        st.setProperty("--md-head-wrap", ch.wrap.value ? "normal" : "nowrap");
        st.setProperty("--md-col-w", px(ch.minWidth.value, 40));

        const rh = s.rowHeadersCard;
        st.setProperty("--md-row-bg", rh.fill.value.value);
        st.setProperty("--md-row-fg", rh.fontColor.value.value);
        st.setProperty("--md-row-size", px(rh.fontSize.value, 6));
        st.setProperty("--md-row-w", px(rh.width.value, 60));
        st.setProperty("--md-indent", px(rh.indent.value));
        st.setProperty("--md-parent-weight", rh.parentBold.value ? "650" : "400");

        const v = s.valuesCard;
        st.setProperty("--md-val-fg", v.fontColor.value.value);
        st.setProperty("--md-val-size", px(v.fontSize.value, 6));

        const tt = s.totalsCard;
        st.setProperty("--md-total-bg", tt.fill.value.value);
        st.setProperty("--md-total-fg", tt.fontColor.value.value);
    }
}

