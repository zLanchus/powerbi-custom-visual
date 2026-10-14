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
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel } from "./settings";
import {
    FieldModel,
    FieldState,
    ValueItem,
    buildFilter,
    emptyState,
    formatValue,
    getKind,
    getTarget,
    isActive,
    sameTarget,
    stateFromFilter,
    valueKey
} from "./filters";
import { NestedGroup, TreeNode, buildTree, buildTreeFilter, treeStateFromFilters } from "./hierarchy";

/** Espaços de dados cujas colunas viram uma árvore, e o espaço de filtros independentes. */
const NESTED_ROLES = ["nest1", "nest2", "nest3", "nest4"];
const FLAT_ROLE = "fields";

/** Quantidade máxima de itens desenhados por lista (o resto aparece pela pesquisa). */
const MAX_RENDERED_ITEMS = 300;
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

/** Ícones desenhados em SVG (traço), no estilo do botão de referência. */
function icon(kind: "funnel" | "chevron" | "close" | "check" | "search" | "eraser", className?: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "fp-icon" + (className ? " " + className : ""));
    const paths: Record<string, string[]> = {
        funnel: ["M3.5 4.5h17a.6.6 0 0 1 .45 1L14.5 13v6.2a.6.6 0 0 1-.3.52l-3.6 2a.6.6 0 0 1-.9-.52V13L3.05 5.5a.6.6 0 0 1 .45-1Z"],
        chevron: ["M6 9.5l6 6 6-6"],
        close: ["M6 6l12 12", "M18 6L6 18"],
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
    private button: HTMLButtonElement;
    private buttonLabel: HTMLElement;
    private badge: HTMLElement;
    private backdrop: HTMLElement;
    private popup: HTMLElement;
    private popupTitle: HTMLElement;
    private popupBody: HTMLElement;
    private clearAllButton: HTMLButtonElement;

    /** Um item por bloco do pop-up (num bloco aninhado, um campo que representa a árvore toda). */
    private fields: FieldModel[] = [];
    /** Blocos aninhados, indexados pela chave do bloco. */
    private nested = new Map<string, NestedGroup>();
    private expanded = new Set<string>();
    private states = new Map<string, FieldState>();
    private searchText = new Map<string, string>();
    private collapsed = new Map<string, boolean>();
    private isOpen = false;
    private dataSignature = "";

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "fp-root");
        options.element.appendChild(this.root);
        this.buildButton();
        this.buildPopup();

        this.root.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Escape" && this.isOpen) {
                this.setOpen(false);
                this.button.focus();
            }
        });

        // Menu do botão direito do Power BI (copiar, colar, etc.), como nos visuais nativos.
        this.selectionManager = this.host.createSelectionManager();
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });

        // Cliques fora de campos de texto não puxam o foco do teclado para dentro do visual,
        // assim Ctrl+C / Ctrl+V continuam indo para o Power BI (copiar e colar o visual).
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

            // Volumes grandes chegam em segmentos: pede o restante.
            if (dataView?.metadata?.segment) {
                this.host.fetchMoreData(true);
            }

            this.readFields(dataView);
            this.syncStateFromHost((options.jsonFilters || []) as Array<IBasicFilter | IAdvancedFilter>);
            this.applyStyles();

            const signature = this.fields
                .map(f => f.key + "#" + f.values.length + "#" + (this.nested.get(f.key)?.nodes.size ?? 0)).join("|")
                + "|" + this.useRangeSignature();
            if (signature !== this.dataSignature) {
                this.dataSignature = signature;
                this.renderBody();
            } else {
                this.refreshSelection();
            }
            this.refreshButton();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private useRangeSignature(): string {
        const s = this.formattingSettings.slicerCard;
        return [s.rangeForNumbers.value, s.singleSelect.value, s.showSearch.value].join(",");
    }

    /**
     * Lê as colunas de cada espaço de dados. As colunas de um mesmo espaço
     * "Filtro aninhado N" viram uma árvore (na ordem em que foram adicionadas);
     * as de "Filtros sem aninhamento" viram um filtro cada.
     */
    private readFields(dataView: DataView | undefined): void {
        const categories = dataView?.categorical?.categories || [];
        const all = categories.map((category, index) => {
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
                key: (column.queryName || column.displayName) + "@" + index,
                displayName: column.displayName,
                kind,
                target: getTarget(column),
                // Mantém a ordem enviada pelo Power BI (respeita "Classificar por coluna").
                values: Array.from(unique.values())
            } as FieldModel;
        });

        const inRole = (role: string): number[] => {
            const indexes = categories.map((c, i) => i).filter(i => categories[i].source.roles?.[role]);
            const order = (i: number): number =>
                (categories[i].source as unknown as { rolesIndex?: Record<string, number[]> }).rolesIndex?.[role]?.[0] ?? i;
            return indexes.sort((a, b) => order(a) - order(b));
        };

        this.fields = [];
        this.nested = new Map();
        for (const role of NESTED_ROLES) {
            const indexes = inRole(role);
            if (indexes.length === 1) {
                this.fields.push(all[indexes[0]]);
            } else if (indexes.length > 1) {
                const levels = indexes.map(i => all[i]);
                const group = buildTree(levels, indexes.map(i => categories[i].values));
                const leaves = Array.from(group.leafPath.keys()).map(id => {
                    const node = group.nodes.get(id);
                    return { key: id, raw: node.item.raw, label: node.item.label };
                });
                const field: FieldModel = {
                    key: role,
                    displayName: levels.map(l => l.displayName).join(" › "),
                    kind: "text",
                    target: levels[0].target,
                    values: leaves
                };
                this.nested.set(field.key, group);
                this.fields.push(field);
            }
        }
        for (const i of inRole(FLAT_ROLE)) {
            this.fields.push(all[i]);
        }
    }

    /** Mantém o estado em sincronia com os filtros salvos no relatório (persistência/bookmarks). */
    private syncStateFromHost(jsonFilters: Array<IBasicFilter | IAdvancedFilter>): void {
        const next = new Map<string, FieldState>();
        for (const field of this.fields) {
            const group = this.nested.get(field.key);
            if (group) {
                next.set(field.key, treeStateFromFilters(group, jsonFilters));
                continue;
            }
            const filter = jsonFilters.find(f => f && f.target && !Array.isArray(f.target)
                && sameTarget(f.target as IFilterTarget, field.target));
            next.set(field.key, filter ? stateFromFilter(field, filter) : emptyState());
        }
        this.states = next;
    }

    private useRange(field: FieldModel): boolean {
        return !this.nested.has(field.key)
            && this.formattingSettings.slicerCard.rangeForNumbers.value
            && (field.kind === "number" || field.kind === "date");
    }

    // --------------------------------------------------------------- filters

    /** Envia ao Power BI os filtros de todos os campos (mesma mecânica do slicer nativo). */
    private applyFilters(): void {
        const single = this.formattingSettings.slicerCard.singleSelect.value;
        const filters = this.fields
            .map(f => {
                const state = this.states.get(f.key) || emptyState();
                const group = this.nested.get(f.key);
                return group ? buildTreeFilter(group, state, single) : buildFilter(f, state, this.useRange(f), single);
            })
            .filter(f => !!f);

        if (filters.length) {
            this.host.applyJsonFilter(filters, "general", "filter", FilterAction.merge);
        } else {
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
        }
        this.refreshSelection();
        this.refreshButton();
    }

    private clearAll(): void {
        for (const field of this.fields) {
            this.states.set(field.key, emptyState());
        }
        this.searchText.clear();
        this.applyFilters();
        this.renderBody();
    }

    private clearField(field: FieldModel): void {
        this.states.set(field.key, emptyState());
        this.applyFilters();
        this.renderBody();
    }

    private toggleValue(field: FieldModel, item: ValueItem): void {
        const state = this.states.get(field.key) || emptyState();
        const single = this.formattingSettings.slicerCard.singleSelect.value;
        if (state.selected.has(item.key)) {
            state.selected.delete(item.key);
        } else {
            if (single) {
                state.selected.clear();
            }
            state.selected.set(item.key, item.raw);
        }
        this.states.set(field.key, state);
        this.applyFilters();
    }

    private toggleAllVisible(field: FieldModel): void {
        const state = this.states.get(field.key) || emptyState();
        const visible = this.visibleValues(field);
        const allSelected = visible.length > 0 && visible.every(v => state.selected.has(v.key));
        if (allSelected) {
            visible.forEach(v => state.selected.delete(v.key));
        } else {
            visible.forEach(v => state.selected.set(v.key, v.raw));
        }
        // Marcar todos os valores equivale a não filtrar, como no slicer nativo.
        if (state.selected.size === field.values.length) {
            state.selected.clear();
        }
        this.states.set(field.key, state);
        this.applyFilters();
    }

    /** Marca/desmarca um nó da árvore: vale para todas as folhas abaixo dele. */
    private toggleNode(field: FieldModel, group: NestedGroup, node: TreeNode): void {
        const state = this.ensureState(field);
        const allSelected = node.leafKeys.every(k => state.selected.has(k));
        if (allSelected) {
            node.leafKeys.forEach(k => state.selected.delete(k));
        } else {
            if (this.formattingSettings.slicerCard.singleSelect.value) {
                state.selected.clear();
            }
            node.leafKeys.forEach(k => state.selected.set(k, null));
        }
        if (state.selected.size === field.values.length) {
            state.selected.clear();
        }
        this.applyFilters();
    }

    private searchTerm(field: FieldModel): string {
        return (this.searchText.get(field.key) || "").trim().toLocaleLowerCase("pt-BR");
    }

    private matches(label: string, term: string): boolean {
        return label.toLocaleLowerCase("pt-BR").includes(term);
    }

    private visibleValues(field: FieldModel): ValueItem[] {
        const term = this.searchTerm(field);
        if (!term) {
            return field.values;
        }
        const group = this.nested.get(field.key);
        if (!group) {
            return field.values.filter(v => this.matches(v.label, term));
        }
        // Na árvore, uma folha aparece se ela ou algum nível acima dela bater com a pesquisa.
        const keys = new Set<string>();
        const walk = (nodes: TreeNode[], ancestorMatch: boolean): void => {
            for (const node of nodes) {
                const hit = ancestorMatch || this.matches(node.item.label, term);
                if (node.children.length) {
                    walk(node.children, hit);
                } else if (hit) {
                    keys.add(node.id);
                }
            }
        };
        walk(group.roots, false);
        return field.values.filter(v => keys.has(v.key));
    }

    private activeCount(): number {
        let count = 0;
        for (const field of this.fields) {
            if (isActive(this.states.get(field.key))) {
                count++;
            }
        }
        return count;
    }

    // --------------------------------------------------------------- button

    private buildButton(): void {
        this.button = el("button", "fp-button");
        this.button.type = "button";
        this.button.setAttribute("aria-haspopup", "dialog");
        this.button.setAttribute("aria-expanded", "false");

        const main = el("span", "fp-button-main");
        main.appendChild(icon("funnel", "fp-button-icon"));
        this.buttonLabel = el("span", "fp-button-label");
        main.appendChild(this.buttonLabel);
        this.badge = el("span", "fp-badge");
        main.appendChild(this.badge);

        const divider = el("span", "fp-divider");
        const chevronWrap = el("span", "fp-button-chevron");
        chevronWrap.appendChild(icon("chevron"));

        this.button.append(main, divider, chevronWrap);
        this.button.addEventListener("click", (e: MouseEvent) => this.setOpen(!this.isOpen, e.detail === 0));
        this.root.appendChild(this.button);
    }

    private refreshButton(): void {
        const s = this.formattingSettings.buttonCard;
        this.buttonLabel.textContent = s.text.value || "Abrir Filtros";
        const count = this.activeCount();
        this.badge.textContent = String(count);
        this.badge.style.display = s.showBadge.value && count > 0 ? "" : "none";
        this.badge.title = count === 1 ? "1 filtro ativo" : count + " filtros ativos";
        this.clearAllButton.disabled = count === 0;
    }

    private setOpen(open: boolean, viaKeyboard = false): void {
        if (open && !this.isOpen && this.formattingSettings?.slicerCard.startCollapsed.value) {
            this.collapseAll();
        }
        this.isOpen = open;
        this.root.classList.toggle("fp-open", open);
        this.button.setAttribute("aria-expanded", String(open));
        if (open && viaKeyboard) {
            const first = this.popup.querySelector<HTMLElement>("input, button.fp-close");
            first?.focus();
        } else if (!open && this.root.contains(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
        }
    }

    /** Recolhe todos os blocos de filtro (usado ao abrir o pop-up). */
    private collapseAll(): void {
        for (const field of this.fields) {
            this.collapsed.set(field.key, true);
        }
        this.popupBody.querySelectorAll<HTMLElement>("section.fp-field")
            .forEach(section => section.classList.add("fp-collapsed"));
    }

    // ---------------------------------------------------------------- popup

    private buildPopup(): void {
        this.backdrop = el("div", "fp-backdrop");
        this.backdrop.addEventListener("click", () => this.setOpen(false));

        this.popup = el("div", "fp-popup");
        this.popup.setAttribute("role", "dialog");

        const header = el("div", "fp-popup-header");
        header.appendChild(icon("funnel", "fp-header-icon"));
        this.popupTitle = el("span", "fp-popup-title");
        header.appendChild(this.popupTitle);
        const close = el("button", "fp-close");
        close.type = "button";
        close.title = "Fechar";
        close.setAttribute("aria-label", "Fechar filtros");
        close.appendChild(icon("close"));
        close.addEventListener("click", () => this.setOpen(false));
        header.appendChild(close);

        this.popupBody = el("div", "fp-popup-body");

        const footer = el("div", "fp-popup-footer");
        const actions = el("div", "fp-actions");
        this.clearAllButton = el("button", "fp-action fp-action-secondary");
        this.clearAllButton.type = "button";
        this.clearAllButton.append(icon("eraser"), el("span", undefined, "Limpar todos os filtros"));
        this.clearAllButton.addEventListener("click", () => this.clearAll());

        const closeButton = el("button", "fp-action fp-action-primary");
        closeButton.type = "button";
        closeButton.append(icon("check"), el("span", undefined, "Fechar"));
        closeButton.addEventListener("click", () => this.setOpen(false));
        actions.append(this.clearAllButton, closeButton);
        footer.appendChild(actions);

        this.popup.append(header, this.popupBody, footer);
        this.root.append(this.backdrop, this.popup);
    }

    private renderBody(): void {
        const scrollTop = this.popupBody.scrollTop;
        this.popupBody.replaceChildren();

        if (this.fields.length === 0) {
            const empty = el("div", "fp-empty");
            empty.append(
                el("strong", undefined, "Nenhum campo adicionado"),
                el("span", undefined, "Arraste colunas para \"Filtro aninhado 1–4\" (as colunas de um mesmo espaço viram uma árvore) ou para \"Filtros sem aninhamento\".")
            );
            this.popupBody.appendChild(empty);
            return;
        }

        for (const field of this.fields) {
            this.popupBody.appendChild(this.renderField(field));
        }
        this.popupBody.scrollTop = scrollTop;
    }

    private renderField(field: FieldModel): HTMLElement {
        const section = el("section", "fp-field");
        section.dataset.field = field.key;
        if (this.collapsed.get(field.key)) {
            section.classList.add("fp-collapsed");
        }

        const header = el("div", "fp-field-header");
        const toggle = el("button", "fp-field-toggle");
        toggle.type = "button";
        const group = this.nested.get(field.key);
        const title = field.displayName;
        toggle.append(el("span", "fp-field-name", title), el("span", "fp-field-count"));
        toggle.appendChild(icon("chevron", "fp-field-chevron"));
        toggle.addEventListener("click", () => {
            const value = !this.collapsed.get(field.key);
            this.collapsed.set(field.key, value);
            section.classList.toggle("fp-collapsed", value);
        });

        const clear = el("button", "fp-field-clear");
        clear.type = "button";
        clear.title = "Limpar este filtro";
        clear.setAttribute("aria-label", "Limpar filtro de " + title);
        clear.appendChild(icon("eraser"));
        clear.addEventListener("click", () => this.clearField(field));

        header.append(toggle, clear);
        section.appendChild(header);

        const content = el("div", "fp-field-content");
        if (this.useRange(field)) {
            content.appendChild(this.renderRange(field));
        } else {
            const size = group ? group.nodes.size : field.values.length;
            if (this.formattingSettings.slicerCard.showSearch.value && size > 6) {
                content.appendChild(this.renderSearch(field, section));
            }
            const list = el("div", "fp-list" + (group ? " fp-tree" : ""));
            list.setAttribute("role", group ? "tree" : "listbox");
            content.appendChild(list);
            this.renderValues(field, list);
        }
        section.appendChild(content);
        this.refreshFieldHeader(field, section);
        return section;
    }

    private renderSearch(field: FieldModel, section: HTMLElement): HTMLElement {
        const wrap = el("label", "fp-search");
        wrap.appendChild(icon("search"));
        const input = el("input");
        input.type = "search";
        input.placeholder = "Pesquisar";
        input.value = this.searchText.get(field.key) || "";
        input.addEventListener("input", () => {
            this.searchText.set(field.key, input.value);
            const list = section.querySelector<HTMLElement>(".fp-list");
            if (list) {
                this.renderValues(field, list);
            }
        });
        wrap.appendChild(input);
        return wrap;
    }

    private renderValues(field: FieldModel, list: HTMLElement): void {
        const group = this.nested.get(field.key);
        if (group) {
            this.renderTree(field, group, list);
        } else {
            this.renderList(field, list);
        }
    }

    /** Lista em árvore (campos aninhados), com expandir/recolher e marcação parcial. */
    private renderTree(field: FieldModel, group: NestedGroup, list: HTMLElement): void {
        const scrollTop = list.scrollTop;
        list.replaceChildren();
        const single = this.formattingSettings.slicerCard.singleSelect.value;
        const term = this.searchTerm(field);

        if (!single && this.visibleValues(field).length > 1) {
            const all = this.renderItem("Selecionar tudo", false, true);
            all.classList.add("fp-item-all");
            all.addEventListener("click", () => this.toggleAllVisible(field));
            list.appendChild(all);
        }

        const subtreeHit = new Map<string, boolean>();
        const hasHit = (node: TreeNode): boolean => {
            let hit = subtreeHit.get(node.id);
            if (hit === undefined) {
                hit = this.matches(node.item.label, term) || node.children.some(hasHit);
                subtreeHit.set(node.id, hit);
            }
            return hit;
        };

        let rendered = 0;
        let truncated = false;
        const walk = (nodes: TreeNode[], ancestorMatch: boolean): void => {
            for (const node of nodes) {
                if (rendered >= MAX_RENDERED_ITEMS) {
                    truncated = true;
                    return;
                }
                const selfMatch = ancestorMatch || !term || this.matches(node.item.label, term);
                if (!selfMatch && !hasHit(node)) {
                    continue;
                }
                const expandKey = field.key + "#" + node.id;
                // Na pesquisa, abre automaticamente os níveis que têm resultados por dentro.
                const open = node.children.length > 0 && (this.expanded.has(expandKey) || !selfMatch);
                list.appendChild(this.renderTreeRow(field, group, node, open, expandKey, list));
                rendered++;
                if (open) {
                    walk(node.children, selfMatch && !!term);
                }
            }
        };
        walk(group.roots, false);

        if (rendered === 0) {
            list.appendChild(el("div", "fp-list-note", "Nenhum valor encontrado"));
        } else if (truncated) {
            list.appendChild(el("div", "fp-list-note",
                "Mostrando os primeiros " + MAX_RENDERED_ITEMS + " itens. Use a pesquisa para encontrar os demais."));
        }
        this.refreshTree(field, group, list);
        this.refreshSelectAll(field, list);
        list.scrollTop = scrollTop;
    }

    private renderTreeRow(field: FieldModel, group: NestedGroup, node: TreeNode, open: boolean, expandKey: string, list: HTMLElement): HTMLElement {
        const row = el("div", "fp-tree-row");
        row.style.setProperty("--fp-depth", String(node.level));
        row.setAttribute("role", "treeitem");

        if (node.children.length) {
            row.setAttribute("aria-expanded", String(open));
            const caret = el("button", "fp-caret" + (open ? " fp-caret-open" : ""));
            caret.type = "button";
            caret.title = open ? "Recolher" : "Expandir";
            caret.setAttribute("aria-label", (open ? "Recolher " : "Expandir ") + node.item.label);
            caret.appendChild(icon("chevron"));
            caret.addEventListener("click", () => {
                if (open) {
                    this.expanded.delete(expandKey);
                } else {
                    this.expanded.add(expandKey);
                }
                this.renderTree(field, group, list);
            });
            row.appendChild(caret);
        } else {
            row.appendChild(el("span", "fp-caret-spacer"));
        }

        const single = this.formattingSettings.slicerCard.singleSelect.value;
        const item = this.renderItem(node.item.label, false, !single || node.children.length > 0);
        item.dataset.node = node.id;
        if (node.children.length) {
            item.appendChild(el("span", "fp-item-count", String(node.leafKeys.length)));
        }
        item.addEventListener("click", () => this.toggleNode(field, group, node));
        row.appendChild(item);
        return row;
    }

    /** Atualiza marcado/parcial dos nós da árvore conforme as folhas selecionadas. */
    private refreshTree(field: FieldModel, group: NestedGroup, root: HTMLElement): void {
        const state = this.states.get(field.key) || emptyState();
        root.querySelectorAll<HTMLElement>(".fp-item[data-node]").forEach(item => {
            const node = group.nodes.get(item.dataset.node || "");
            if (!node) {
                return;
            }
            const count = node.leafKeys.filter(k => state.selected.has(k)).length;
            const full = count > 0 && count === node.leafKeys.length;
            item.classList.toggle("fp-selected", full);
            item.classList.toggle("fp-partial", count > 0 && !full);
            item.setAttribute("aria-selected", String(full));
        });
    }

    private renderList(field: FieldModel, list: HTMLElement): void {
        list.replaceChildren();
        const state = this.states.get(field.key) || emptyState();
        const single = this.formattingSettings.slicerCard.singleSelect.value;
        const visible = this.visibleValues(field);

        if (!single && visible.length > 1) {
            const all = this.renderItem("Selecionar tudo", false, true);
            all.classList.add("fp-item-all");
            all.addEventListener("click", () => this.toggleAllVisible(field));
            list.appendChild(all);
        }

        for (const item of visible.slice(0, MAX_RENDERED_ITEMS)) {
            const row = this.renderItem(item.label, state.selected.has(item.key), !single);
            row.dataset.key = item.key;
            row.addEventListener("click", () => this.toggleValue(field, item));
            list.appendChild(row);
        }

        if (visible.length === 0) {
            list.appendChild(el("div", "fp-list-note", "Nenhum valor encontrado"));
        } else if (visible.length > MAX_RENDERED_ITEMS) {
            list.appendChild(el("div", "fp-list-note",
                "Mostrando " + MAX_RENDERED_ITEMS + " de " + visible.length + " valores. Use a pesquisa para encontrar os demais."));
        }
        this.refreshSelectAll(field, list);
    }

    private renderItem(label: string, selected: boolean, checkbox: boolean): HTMLButtonElement {
        const row = el("button", "fp-item" + (checkbox ? "" : " fp-item-radio"));
        row.type = "button";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(selected));
        row.classList.toggle("fp-selected", selected);
        const box = el("span", "fp-check");
        box.appendChild(icon("check"));
        row.append(box, el("span", "fp-item-label", label));
        row.title = label;
        return row;
    }

    private renderRange(field: FieldModel): HTMLElement {
        const state = this.states.get(field.key) || emptyState();
        const wrap = el("div", "fp-range");
        const type = field.kind === "date" ? "date" : "number";

        const values = field.values.filter(v => v.key !== "blank");
        const first = values[0]?.raw;
        const last = values[values.length - 1]?.raw;
        const hint = (raw: PrimitiveValue): string => raw === undefined ? "" : formatValue(raw, field.kind);

        const make = (labelText: string, value: string, placeholder: string, onChange: (v: string) => void): HTMLElement => {
            const label = el("label", "fp-range-input");
            label.appendChild(el("span", undefined, labelText));
            const input = el("input");
            input.type = type;
            input.value = value;
            input.placeholder = placeholder;
            input.addEventListener("change", () => {
                onChange(input.value);
                this.applyFilters();
            });
            label.appendChild(input);
            return label;
        };

        wrap.append(
            make("De", state.rangeFrom, hint(first), v => { this.ensureState(field).rangeFrom = v; }),
            make("Até", state.rangeTo, hint(last), v => { this.ensureState(field).rangeTo = v; })
        );
        return wrap;
    }

    private ensureState(field: FieldModel): FieldState {
        let state = this.states.get(field.key);
        if (!state) {
            state = emptyState();
            this.states.set(field.key, state);
        }
        return state;
    }

    /** Atualiza marcações sem redesenhar tudo (preserva rolagem e pesquisa). */
    private refreshSelection(): void {
        for (const field of this.fields) {
            const section = this.popupBody.querySelector<HTMLElement>(`section[data-field="${CSS.escape(field.key)}"]`);
            if (!section) {
                continue;
            }
            const state = this.states.get(field.key) || emptyState();
            section.querySelectorAll<HTMLElement>(".fp-item[data-key]").forEach(row => {
                const selected = state.selected.has(row.dataset.key || "");
                row.classList.toggle("fp-selected", selected);
                row.setAttribute("aria-selected", String(selected));
            });
            section.querySelectorAll<HTMLInputElement>(".fp-range-input input").forEach((input, i) => {
                const value = i === 0 ? state.rangeFrom : state.rangeTo;
                if (document.activeElement !== input && input.value !== value) {
                    input.value = value;
                }
            });
            const group = this.nested.get(field.key);
            if (group) {
                this.refreshTree(field, group, section);
            }
            const list = section.querySelector<HTMLElement>(".fp-list");
            if (list) {
                this.refreshSelectAll(field, list);
            }
            this.refreshFieldHeader(field, section);
        }
    }

    private refreshSelectAll(field: FieldModel, list: HTMLElement): void {
        const all = list.querySelector<HTMLElement>(".fp-item-all");
        if (!all) {
            return;
        }
        const state = this.states.get(field.key) || emptyState();
        const visible = this.visibleValues(field);
        const allSelected = visible.length > 0 && visible.every(v => state.selected.has(v.key));
        const some = !allSelected && visible.some(v => state.selected.has(v.key));
        all.classList.toggle("fp-selected", allSelected);
        all.classList.toggle("fp-partial", some);
    }

    private refreshFieldHeader(field: FieldModel, section: HTMLElement): void {
        const state = this.states.get(field.key);
        const active = isActive(state);
        section.classList.toggle("fp-active", active);
        const count = section.querySelector<HTMLElement>(".fp-field-count");
        if (count) {
            if (!active || !state) {
                count.textContent = "Todos";
            } else if (this.useRange(field)) {
                count.textContent = "Intervalo";
            } else if (this.nested.has(field.key)) {
                const labels = this.treeSummary(this.nested.get(field.key).roots, state);
                count.textContent = labels.length === 1 ? labels[0] : labels.length + " selecionados";
            } else {
                const n = state.selected.size;
                count.textContent = n === 1
                    ? this.labelOf(field, state.selected.keys().next().value, state.selected.values().next().value)
                    : n + " selecionados";
            }
        }
    }

    /** Resume a seleção pelos nós mais altos que estão totalmente marcados. */
    private treeSummary(nodes: TreeNode[], state: FieldState): string[] {
        const labels: string[] = [];
        for (const node of nodes) {
            const count = node.leafKeys.filter(k => state.selected.has(k)).length;
            if (count === 0) {
                continue;
            }
            if (count === node.leafKeys.length) {
                labels.push(node.item.label);
            } else {
                labels.push(...this.treeSummary(node.children, state));
            }
        }
        return labels;
    }

    private labelOf(field: FieldModel, key: string, raw: PrimitiveValue): string {
        return field.values.find(v => v.key === key)?.label ?? formatValue(raw, field.kind);
    }

    // --------------------------------------------------------------- styles

    private px(size: number): string {
        return Math.max(6, size || 0) + "px";
    }

    private applyStyles(): void {
        const b = this.formattingSettings.buttonCard;
        const p = this.formattingSettings.popupCard;
        const style = this.root.style;
        style.setProperty("--fp-button-bg", b.fill.value.value);
        style.setProperty("--fp-button-fg", b.fontColor.value.value);
        style.setProperty("--fp-font-size", Math.max(8, b.fontSize.value) + "px");
        style.setProperty("--fp-font-family", b.fontFamily.value);
        style.setProperty("--fp-radius", Math.max(0, b.radius.value) + "px");
        style.setProperty("--fp-button-height", Math.max(24, b.height.value) + "px");
        style.setProperty("--fp-popup-bg", p.fill.value.value);
        style.setProperty("--fp-panel-bg", p.panelFill.value.value);
        style.setProperty("--fp-popup-fg", p.fontColor.value.value);
        style.setProperty("--fp-title-size", this.px(p.titleFontSize.value));
        style.setProperty("--fp-field-size", this.px(p.fieldFontSize.value));
        style.setProperty("--fp-value-size", this.px(p.valueFontSize.value));

        const f = this.formattingSettings.slicerCard;
        const border = (width: number): string => Math.max(0, width || 0) + "px";
        style.setProperty("--fp-button-bw", border(b.borderWidth.value));
        style.setProperty("--fp-button-bc", b.borderColor.value.value);
        style.setProperty("--fp-popup-bw", border(p.borderWidth.value));
        style.setProperty("--fp-popup-bc", p.borderColor.value.value);
        style.setProperty("--fp-field-bw", border(f.borderWidth.value));
        style.setProperty("--fp-field-bc", f.borderColor.value.value);

        const a = this.formattingSettings.actionsCard;
        const align = String(a.align.value?.value || "right");
        style.setProperty("--fp-action-align", align === "left" ? "flex-start" : align === "center" ? "center" : "flex-end");
        style.setProperty("--fp-action-size", this.px(a.fontSize.value));
        style.setProperty("--fp-action-font", a.fontFamily.value);
        style.setProperty("--fp-action-width", a.width.value > 0 ? a.width.value + "px" : "auto");
        style.setProperty("--fp-clear-bg", a.clearFill.value.value);
        style.setProperty("--fp-clear-fg", a.clearFontColor.value.value);
        style.setProperty("--fp-close-bg", a.closeFill.value.value);
        style.setProperty("--fp-close-fg", a.closeFontColor.value.value);

        this.root.classList.toggle("fp-no-icon", !b.showIcon.value);
        this.root.classList.toggle("fp-overlay", p.overlay.value);
        this.popupTitle.textContent = p.title.value || "Filtros";
        this.popup.setAttribute("aria-label", this.popupTitle.textContent);
    }
}
