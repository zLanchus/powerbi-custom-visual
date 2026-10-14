"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { IAdvancedFilter, IBasicFilter, IFilterTarget } from "powerbi-models";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import FilterAction = powerbi.FilterAction;

import { LayoutMode, VisualFormattingSettingsModel } from "./settings";
import {
    FieldModel,
    FieldState,
    ValueItem,
    buildFilter,
    emptyState,
    formatValue,
    getKind,
    getTarget,
    sameTarget,
    stateFromFilter,
    valueKey
} from "./filters";

/** Quantidade máxima de itens desenhados (o resto aparece pela pesquisa). */
const MAX_RENDERED_ITEMS = 500;
const SVG_NS = "http://www.w3.org/2000/svg";

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

function icon(kind: "chevron" | "check" | "search" | "eraser", className?: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "fs-icon" + (className ? " " + className : ""));
    const paths: Record<string, string[]> = {
        chevron: ["M6 9.5l6 6 6-6"],
        check: ["M5 12.5l4.5 4.5L19 7.5"],
        search: ["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Z", "M15.5 15.5L20 20"],
        eraser: ["M8 20h12", "M4.6 15.4l9.8-9.8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8.2L4.6 15.4a1.4 1.4 0 0 1 0-2Z"]
    };
    for (const d of paths[kind]) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private header: HTMLElement;
    private title: HTMLElement;
    private clearButton: HTMLButtonElement;
    private body: HTMLElement;

    private field: FieldModel | undefined;
    private state: FieldState = emptyState();
    private search = "";
    private dropdownOpen = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "fs-root");
        options.element.appendChild(this.root);

        this.header = el("div", "fs-header");
        this.title = el("span", "fs-title");
        this.clearButton = el("button", "fs-clear");
        this.clearButton.type = "button";
        this.clearButton.title = "Limpar seleção";
        this.clearButton.setAttribute("aria-label", "Limpar seleção");
        this.clearButton.appendChild(icon("eraser"));
        this.clearButton.addEventListener("click", () => this.clear());
        this.header.append(this.title, this.clearButton);

        this.body = el("div", "fs-body");
        this.root.append(this.header, this.body);

        this.root.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Escape" && this.dropdownOpen) {
                this.setDropdown(false);
            }
        });

        // Menu do botão direito do Power BI (copiar, colar, etc.).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });

        // Cliques fora da pesquisa não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI).
        this.root.addEventListener("mousedown", (e: MouseEvent) => {
            if (!(e.target instanceof HTMLInputElement)) {
                e.preventDefault();
            }
        });
    }

    // ---------------------------------------------------------------- update

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);

            if (dataView?.metadata?.segment) {
                this.host.fetchMoreData(true);
            }

            this.field = this.readField(dataView);
            const filters = (options.jsonFilters || []) as Array<IBasicFilter | IAdvancedFilter>;
            const filter = this.field && filters.find(f => f && f.target && !Array.isArray(f.target)
                && sameTarget(f.target as IFilterTarget, this.field.target));
            this.state = this.field && filter ? stateFromFilter(this.field, filter) : emptyState();

            this.applyStyles();
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private readField(dataView: DataView | undefined): FieldModel | undefined {
        const category = dataView?.categorical?.categories?.[0];
        if (!category) {
            return undefined;
        }
        const column = category.source;
        const kind = getKind(column);
        const unique = new Map<string, ValueItem>();
        for (const raw of category.values) {
            const key = valueKey(raw);
            if (!unique.has(key)) {
                unique.set(key, { key, raw, label: formatValue(raw, kind) });
            }
        }
        return {
            key: column.queryName || column.displayName,
            displayName: column.displayName,
            kind,
            target: getTarget(column),
            // Mantém a ordem enviada pelo Power BI (respeita "Classificar por coluna").
            values: Array.from(unique.values())
        };
    }

    private get mode(): LayoutMode {
        return String(this.formattingSettings.layoutCard.mode.value?.value || "blocks") as LayoutMode;
    }

    private get single(): boolean {
        return this.formattingSettings.layoutCard.singleSelect.value;
    }

    // --------------------------------------------------------------- filters

    /** Envia o filtro ao Power BI, com a mesma mecânica da segmentação nativa. */
    private applyFilter(): void {
        const filter = this.field && buildFilter(this.field, this.state, false, this.single);
        if (filter) {
            this.host.applyJsonFilter(filter, "general", "filter", FilterAction.merge);
        } else {
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
        }
        this.render();
    }

    private toggle(item: ValueItem): void {
        if (this.state.selected.has(item.key)) {
            this.state.selected.delete(item.key);
        } else {
            if (this.single) {
                this.state.selected.clear();
            }
            this.state.selected.set(item.key, item.raw);
        }
        if (this.single && this.mode === "dropdown") {
            this.dropdownOpen = false;
        }
        this.applyFilter();
    }

    private toggleAll(): void {
        const visible = this.visibleValues();
        const allSelected = visible.length > 0 && visible.every(v => this.state.selected.has(v.key));
        if (allSelected) {
            visible.forEach(v => this.state.selected.delete(v.key));
        } else {
            visible.forEach(v => this.state.selected.set(v.key, v.raw));
        }
        // Marcar tudo equivale a não filtrar, como na segmentação nativa.
        if (this.field && this.state.selected.size === this.field.values.length) {
            this.state.selected.clear();
        }
        this.applyFilter();
    }

    private clear(): void {
        this.state = emptyState();
        this.search = "";
        this.applyFilter();
    }

    private visibleValues(): ValueItem[] {
        const values = this.field?.values || [];
        const term = this.search.trim().toLocaleLowerCase("pt-BR");
        return term ? values.filter(v => v.label.toLocaleLowerCase("pt-BR").includes(term)) : values;
    }

    // ---------------------------------------------------------------- render

    private render(): void {
        const h = this.formattingSettings.headerCard;
        const active = this.state.selected.size > 0;
        this.header.style.display = h.show.value ? "" : "none";
        this.title.textContent = h.text.value || this.field?.displayName || "Segmentação";
        this.clearButton.style.display = h.showClear.value && active ? "" : "none";
        this.root.classList.toggle("fs-active", active);

        const scroll = this.body.querySelector<HTMLElement>(".fs-scroll")?.scrollTop ?? 0;
        this.body.replaceChildren();
        this.root.dataset.mode = this.mode;

        if (!this.field) {
            const empty = el("div", "fs-empty");
            empty.append(el("strong", undefined, "Nenhum campo"), el("span", undefined, "Arraste uma coluna para \"Campo\"."));
            this.body.appendChild(empty);
            return;
        }

        if (this.mode === "dropdown") {
            this.renderDropdown();
        } else if (this.mode === "list") {
            this.renderList(this.body);
        } else {
            this.renderBlocks();
        }
        const scroller = this.body.querySelector<HTMLElement>(".fs-scroll");
        if (scroller) {
            scroller.scrollTop = scroll;
        }
    }

    private renderBlocks(): void {
        const grid = el("div", "fs-blocks fs-scroll");
        const columns = Math.max(0, Math.round(this.formattingSettings.layoutCard.columns.value || 0));
        if (columns > 0) {
            grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
            grid.classList.add("fs-grid");
        }
        this.fillItems(grid, "fs-block");
        this.body.appendChild(grid);
    }

    /** Lista vertical (também usada dentro do suspenso). */
    private renderList(container: HTMLElement): void {
        const values = this.field?.values || [];
        if (this.formattingSettings.layoutCard.showSearch.value && values.length > 6) {
            container.appendChild(this.renderSearch());
        }
        const list = el("div", "fs-list fs-scroll");
        list.setAttribute("role", "listbox");
        this.fillItems(list, "fs-row");
        container.appendChild(list);
    }

    private fillItems(container: HTMLElement, itemClass: string): void {
        container.replaceChildren();
        const visible = this.visibleValues();
        const showCheck = this.formattingSettings.itemsCard.showCheck.value;

        if (!this.single && this.formattingSettings.layoutCard.showSelectAll.value && visible.length > 1) {
            const allSelected = visible.every(v => this.state.selected.has(v.key));
            const some = !allSelected && visible.some(v => this.state.selected.has(v.key));
            const all = this.renderItem("Selecionar tudo", allSelected, itemClass + " fs-item-all", showCheck);
            all.classList.toggle("fs-partial", some);
            all.addEventListener("click", () => this.toggleAll());
            container.appendChild(all);
        }

        for (const item of visible.slice(0, MAX_RENDERED_ITEMS)) {
            const row = this.renderItem(item.label, this.state.selected.has(item.key), itemClass, showCheck);
            row.addEventListener("click", () => this.toggle(item));
            container.appendChild(row);
        }

        if (visible.length === 0) {
            container.appendChild(el("div", "fs-note", "Nenhum valor encontrado"));
        } else if (visible.length > MAX_RENDERED_ITEMS) {
            container.appendChild(el("div", "fs-note",
                "Mostrando " + MAX_RENDERED_ITEMS + " de " + visible.length + ". Use a pesquisa para encontrar os demais."));
        }
    }

    private renderItem(label: string, selected: boolean, className: string, showCheck: boolean): HTMLButtonElement {
        const item = el("button", "fs-item " + className + (this.single ? " fs-radio" : ""));
        item.type = "button";
        item.title = label;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(selected));
        item.classList.toggle("fs-selected", selected);
        if (showCheck) {
            const box = el("span", "fs-check");
            box.appendChild(icon("check"));
            item.appendChild(box);
        }
        item.appendChild(el("span", "fs-label", label));
        return item;
    }

    private renderSearch(): HTMLElement {
        const wrap = el("label", "fs-search");
        wrap.appendChild(icon("search"));
        const input = el("input");
        input.type = "search";
        input.placeholder = "Pesquisar";
        input.value = this.search;
        input.addEventListener("input", () => {
            this.search = input.value;
            const list = wrap.parentElement?.querySelector<HTMLElement>(".fs-list");
            if (list) {
                this.fillItems(list, "fs-row");
            }
        });
        wrap.appendChild(input);
        return wrap;
    }

    /** Caixa suspensa no mesmo estilo do botão "Abrir Filtros". */
    private renderDropdown(): void {
        const trigger = el("button", "fs-trigger");
        trigger.type = "button";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", String(this.dropdownOpen));
        const label = el("span", "fs-trigger-label", this.selectionLabel());
        const chevron = el("span", "fs-trigger-chevron");
        chevron.appendChild(icon("chevron"));
        trigger.append(label, el("span", "fs-divider"), chevron);
        trigger.addEventListener("click", () => this.setDropdown(!this.dropdownOpen));

        const backdrop = el("div", "fs-backdrop");
        backdrop.addEventListener("click", () => this.setDropdown(false));

        const panel = el("div", "fs-panel");
        this.renderList(panel);

        this.body.append(trigger, backdrop, panel);
        this.root.classList.toggle("fs-dropdown-open", this.dropdownOpen);
    }

    private setDropdown(open: boolean): void {
        this.dropdownOpen = open;
        if (!open && this.root.contains(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
        }
        this.render();
    }

    private selectionLabel(): string {
        const n = this.state.selected.size;
        if (n === 0) {
            return this.formattingSettings.dropdownCard.placeholder.value || "Todos";
        }
        if (n === 1) {
            const [key, raw] = this.state.selected.entries().next().value;
            return this.field?.values.find(v => v.key === key)?.label ?? formatValue(raw, this.field?.kind || "text");
        }
        return n + " selecionados";
    }

    // --------------------------------------------------------------- styles

    private applyStyles(): void {
        const px = (v: number, min = 0): string => Math.max(min, v || 0) + "px";
        const s = this.root.style;
        const l = this.formattingSettings.layoutCard;
        const h = this.formattingSettings.headerCard;
        const i = this.formattingSettings.itemsCard;
        const d = this.formattingSettings.dropdownCard;

        s.setProperty("--fs-gap", px(l.gap.value));
        s.setProperty("--fs-header-size", px(h.fontSize.value, 6));
        s.setProperty("--fs-header-font", h.fontFamily.value);
        s.setProperty("--fs-header-fg", h.fontColor.value.value);

        s.setProperty("--fs-item-size", px(i.fontSize.value, 6));
        s.setProperty("--fs-item-font", i.fontFamily.value);
        s.setProperty("--fs-item-bg", i.fill.value.value);
        s.setProperty("--fs-item-fg", i.fontColor.value.value);
        s.setProperty("--fs-sel-bg", i.selectedFill.value.value);
        s.setProperty("--fs-sel-fg", i.selectedFontColor.value.value);
        s.setProperty("--fs-item-radius", px(i.radius.value));
        s.setProperty("--fs-item-height", px(i.height.value, 16));
        s.setProperty("--fs-item-bw", px(i.borderWidth.value));
        s.setProperty("--fs-item-bc", i.borderColor.value.value);

        s.setProperty("--fs-dd-bg", d.fill.value.value);
        s.setProperty("--fs-dd-fg", d.fontColor.value.value);
        s.setProperty("--fs-dd-size", px(d.fontSize.value, 6));
        s.setProperty("--fs-dd-radius", px(d.radius.value));
        s.setProperty("--fs-dd-height", px(d.height.value, 20));
        s.setProperty("--fs-dd-bw", px(d.borderWidth.value));
        s.setProperty("--fs-dd-bc", d.borderColor.value.value);
        s.setProperty("--fs-dd-panel", d.panelFill.value.value);
    }
}
