"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { BasicFilter, FilterType, IAdvancedFilter, IBasicFilter, IFilterTarget, PrimitiveValueType } from "powerbi-models";
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
import { NestedGroup, TreeNode, buildTree, buildTreeFilter, coverNodes, treeStateFromFilters } from "./hierarchy";
import { hiddenKeyTarget, hiddenKeyValues } from "./fieldkey";

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

function icon(kind: "chevron" | "check" | "search" | "eraser" | "close" | "dot" | "square", className?: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "fs-icon" + (className ? " " + className : ""));
    const paths: Record<string, string[]> = {
        chevron: ["M6 9.5l6 6 6-6"],
        check: ["M5 12.5l4.5 4.5L19 7.5"],
        search: ["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Z", "M15.5 15.5L20 20"],
        eraser: ["M8 20h12", "M4.6 15.4l9.8-9.8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8.2L4.6 15.4a1.4 1.4 0 0 1 0-2Z"],
        // Símbolos da caixa de seleção.
        close: ["M6 6l12 12", "M18 6L6 18"],
        dot: ["M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z"],
        square: ["M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"]
    };
    if (kind === "dot" || kind === "square") {
        svg.classList.add("fs-icon-fill");
    }
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
    /** Hierarquia quando há mais de uma coluna em "Campo" (ex.: Ano › Mês). Os valores do campo são as folhas. */
    private tree: NestedGroup | undefined;
    private expanded = new Set<string>();
    private category: powerbi.DataViewCategoryColumn | undefined;
    /** Primeira linha do data view de cada valor (para criar a seleção). */
    private rowOf = new Map<string, number>();
    /** true quando a coluna é filtrada por seleção (reserva para colunas com chave oculta). */
    private selectionMode = false;
    private selectionRestored = false;
    /** Último valor salvo de "state.selected" que o visual leu (no modo seleção). */
    private savedSeen: string | undefined;
    /** Coluna oculta pela qual o visual filtra (parâmetros de campo), e a chave de cada item. */
    private keyTarget: IFilterTarget | undefined;
    private keyOf = new Map<string, PrimitiveValue>();
    private keyMigrated = false;
    /** "Forçar seleção" já mandou o item padrão e espera o Power BI devolver o filtro. */
    private forcePending = false;
    private state: FieldState = emptyState();
    private search = "";
    private dropdownOpen = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        // Indicadores e "Redefinir" devolvem a seleção por aqui (modo seleção).
        this.selectionManager.registerOnSelectCallback?.((ids: ISelectionId[]) => this.onHostSelect(ids));
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

        // Fecha o suspenso ao clicar fora do visual. O visual roda num iframe, então cliques no
        // resto do relatório não chegam aqui; mas, com o foco dentro do iframe (ver captureFocus),
        // clicar fora tira o foco da janela e dispara "blur".
        this.root.tabIndex = -1;
        window.addEventListener("blur", () => {
            if (this.dropdownOpen) {
                this.setDropdown(false, false);
            }
        });

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
            const mode = this.field && !this.tree ? this.filterMode() : "filter";
            const wasSelectionMode = this.selectionMode;
            this.selectionMode = mode === "selection";
            if (mode !== "key") {
                this.keyTarget = undefined;
                this.keyOf.clear();
            }
            if (this.selectionMode) {
                if (!wasSelectionMode) {
                    // Remove um filtro antigo que tenha ficado do modo "filtro".
                    this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
                }
                this.state = this.selectionState(dataView);
                this.restoreSelection();
            } else {
                if (wasSelectionMode) {
                    // Saiu do modo seleção: a seleção antiga não pode continuar filtrando os outros visuais.
                    this.selectionManager.clear();
                }
                const filters = (options.jsonFilters || []) as Array<IBasicFilter | IAdvancedFilter>;
                if (this.tree) {
                    this.state = treeStateFromFilters(this.tree, filters);
                } else if (this.keyTarget) {
                    this.state = this.keyState(filters);
                    this.migrateSavedSelection(dataView);
                } else {
                    const filter = this.field && filters.find(f => f && f.target && !Array.isArray(f.target)
                        && sameTarget(f.target as IFilterTarget, this.field.target));
                    this.state = this.field && filter ? stateFromFilter(this.field, filter) : emptyState();
                }
            }
            if (!dataView?.metadata?.segment) {
                this.enforceSelection();
            }

            this.applyStyles();
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const l = this.formattingSettings.layoutCard;
        l.forceSelection.visible = l.singleSelect.value;
        l.defaultItem.visible = l.singleSelect.value && l.forceSelection.value;
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private readField(dataView: DataView | undefined): FieldModel | undefined {
        // Nível de cima ("Campo") primeiro; depois os "Níveis abaixo", na ordem em que foram adicionados.
        const order = (c: powerbi.DataViewCategoryColumn): number => {
            const roles = c.source.roles || {};
            const index = (c.source as unknown as { rolesIndex?: Record<string, number[]> }).rolesIndex?.["levels"]?.[0] ?? 0;
            return roles["field"] ? -1 : index;
        };
        const categories = (dataView?.categorical?.categories || []).slice().sort((a, b) => order(a) - order(b));
        const category = categories[0];
        this.category = category;
        this.rowOf.clear();
        this.tree = undefined;
        if (!category) {
            return undefined;
        }
        const levels = categories.map(c => this.levelOf(c));
        if (levels.length === 1) {
            category.values.forEach((raw, row) => {
                const key = valueKey(raw);
                if (!this.rowOf.has(key)) {
                    this.rowOf.set(key, row);
                }
            });
            return levels[0];
        }

        // Várias colunas: uma árvore, na ordem em que as colunas foram adicionadas.
        const tree = buildTree(levels, categories.map(c => c.values));
        this.tree = tree;
        return {
            key: levels.map(l => l.key).join("|"),
            displayName: levels.map(l => l.displayName).join(" › "),
            kind: "text",
            target: levels[0].target,
            values: Array.from(tree.leafPath.keys()).map(id => {
                const node = tree.nodes.get(id);
                return { key: id, raw: node.item.raw, label: node.item.label };
            })
        };
    }

    private levelOf(category: powerbi.DataViewCategoryColumn): FieldModel {
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

    /**
     * Como filtrar. Colunas com chave oculta (parâmetros de campo, colunas com "Agrupar por") não aceitam
     * filtro pelo texto exibido: nelas o visual filtra pela coluna oculta, como a segmentação nativa.
     * Assim a escolha aparece marcada, vale em indicadores, "Redefinir" e sincronização entre páginas.
     * Se a chave de algum item não puder ser lida, usa a seleção do Power BI como reserva.
     */
    private filterMode(): "filter" | "key" | "selection" {
        const mode = String(this.formattingSettings.layoutCard.filterMode.value?.value || "auto");
        if (mode === "filter" || mode === "selection") {
            return mode;
        }
        const target = hiddenKeyTarget(this.category);
        if (!target) {
            return mode === "key" ? "selection" : "filter";
        }
        if (this.prepareKeys(target)) {
            return "key";
        }
        return "selection";
    }

    /** Lê a chave oculta de cada item; false se alguma não puder ser lida. */
    private prepareKeys(target: IFilterTarget): boolean {
        const category = this.category;
        const keys = category && hiddenKeyValues(category, target);
        if (!category || !keys) {
            return false;
        }
        this.keyOf.clear();
        category.values.forEach((raw, row) => {
            const key = valueKey(raw);
            if (!this.keyOf.has(key)) {
                this.keyOf.set(key, keys[row]);
            }
        });
        this.keyTarget = target;
        return true;
    }

    /** Estado a partir do filtro na coluna oculta (salvo, de indicador ou de outra página sincronizada). */
    private keyState(filters: Array<IBasicFilter | IAdvancedFilter>): FieldState {
        const state = emptyState();
        const target = this.keyTarget;
        const filter = target && filters.find(f => f && f.target && !Array.isArray(f.target)
            && sameTarget(f.target as IFilterTarget, target));
        if (!this.field || !filter || filter.filterType !== FilterType.Basic) {
            return state;
        }
        const wanted = new Set((filter as IBasicFilter).values.map(v => valueKey(v as PrimitiveValue)));
        for (const item of this.field.values) {
            if (wanted.has(valueKey(this.keyOf.get(item.key)))) {
                state.selected.set(item.key, item.raw);
            }
        }
        return state;
    }

    private keyFilter(): IBasicFilter | undefined {
        if (!this.keyTarget || this.state.selected.size === 0) {
            return undefined;
        }
        const values = Array.from(this.state.selected.keys())
            .filter(key => this.keyOf.has(key))
            .map(key => this.keyOf.get(key) as PrimitiveValueType);
        if (!values.length) {
            return undefined;
        }
        const filter = new BasicFilter(this.keyTarget, "In", values);
        filter.requireSingleSelection = this.single;
        return filter.toJSON();
    }

    /**
     * Relatórios feitos com a versão anterior guardavam a escolha como seleção. Na primeira vez no modo
     * chave, ela vira o filtro equivalente e a seleção antiga é limpa.
     */
    private migrateSavedSelection(dataView: DataView | undefined): void {
        if (this.keyMigrated || !this.field) {
            return;
        }
        this.keyMigrated = true;
        const saved = this.savedSelection(dataView);
        if (this.state.selected.size > 0 || saved.selected.size === 0) {
            return;
        }
        this.state = saved;
        this.selectionManager.clear();
        this.sendFilter();
        this.host.persistProperties({ merge: [{ objectName: "state", selector: null, properties: { selected: "" } }] });
    }

    /** Seleção salva no relatório (o Power BI não guarda seleções sozinho). */
    private savedSelection(dataView: DataView | undefined): FieldState {
        const state = emptyState();
        const saved = dataView?.metadata?.objects?.state?.selected;
        if (typeof saved === "string" && saved && this.field) {
            try {
                const keys = JSON.parse(saved) as string[];
                for (const item of this.field.values) {
                    if (keys.includes(item.key)) {
                        state.selected.set(item.key, item.raw);
                    }
                }
            } catch {
                // valor salvo inválido: começa sem seleção
            }
        }
        return state;
    }

    private selectionIds(): ISelectionId[] {
        const category = this.category;
        if (!category) {
            return [];
        }
        return Array.from(this.state.selected.keys())
            .map(key => this.rowOf.get(key))
            .filter((row): row is number => row !== undefined && row >= 0)
            .map(row => this.host.createSelectionIdBuilder().withCategory(category, row).createSelectionId());
    }

    /**
     * Estado no modo seleção. Só relê o valor salvo quando ele muda: se o Power BI não gravar
     * (ex.: no modo de leitura), a escolha feita aqui continua marcada em vez de "desmarcar".
     */
    private selectionState(dataView: DataView | undefined): FieldState {
        const raw = dataView?.metadata?.objects?.state?.selected;
        const saved = typeof raw === "string" ? raw : "";
        if (saved !== this.savedSeen) {
            this.savedSeen = saved;
            return this.savedSelection(dataView);
        }
        const state = emptyState();
        for (const item of this.field?.values || []) {
            if (this.state.selected.has(item.key)) {
                state.selected.set(item.key, item.raw);
            }
        }
        return state;
    }

    /** O Power BI trocou a seleção (indicador, "Redefinir"): atualiza o que aparece marcado. */
    private onHostSelect(ids: ISelectionId[]): void {
        if (!this.selectionMode || !this.field) {
            return;
        }
        const state = emptyState();
        for (const item of this.field.values) {
            const row = this.rowOf.get(item.key);
            if (row === undefined || !this.category) {
                continue;
            }
            const id = this.host.createSelectionIdBuilder().withCategory(this.category, row).createSelectionId();
            if (ids.some(other => other.equals(id))) {
                state.selected.set(item.key, item.raw);
            }
        }
        this.state = state;
        this.forcePending = false;
        this.persistSelection();
        if (!this.enforceSelection()) {
            this.render();
        }
    }

    private persistSelection(): void {
        const saved = JSON.stringify(Array.from(this.state.selected.keys()));
        this.savedSeen = saved;
        this.host.persistProperties({
            merge: [{ objectName: "state", selector: null, properties: { selected: saved } }]
        });
    }

    // --------------------------------------------------------- forçar seleção

    private get forcing(): boolean {
        const l = this.formattingSettings.layoutCard;
        return this.single && l.forceSelection.value && !!this.field && this.field.values.length > 0;
    }

    /** Item marcado quando nada está selecionado: o "Item padrão" (pelo texto) ou o primeiro. */
    private defaultItem(): ValueItem | undefined {
        const values = this.field?.values || [];
        const wanted = (this.formattingSettings.layoutCard.defaultItem.value || "").trim().toLocaleLowerCase("pt-BR");
        return (wanted && values.find(v => v.label.trim().toLocaleLowerCase("pt-BR") === wanted)) || values[0];
    }

    private selectDefault(): boolean {
        const item = this.defaultItem();
        if (!item) {
            return false;
        }
        this.state = emptyState();
        this.state.selected.set(item.key, this.tree ? null : item.raw);
        return true;
    }

    /**
     * "Forçar seleção": com seleção única, se nada estiver marcado (ao abrir, depois de "Redefinir"
     * ou de um indicador), marca o item padrão. Se o Power BI não devolver o filtro, não tenta de novo
     * até haver uma seleção (evita repetir sem fim).
     */
    private enforceSelection(): boolean {
        if (this.state.selected.size > 0) {
            this.forcePending = false;
            return false;
        }
        if (!this.forcing || this.forcePending || !this.selectDefault()) {
            return false;
        }
        this.forcePending = true;
        this.applyFilter();
        return true;
    }

    /** Ao abrir o relatório, reaplica a seleção salva (uma vez). */
    private restoreSelection(): void {
        if (this.selectionRestored || this.state.selected.size === 0) {
            this.selectionRestored = this.selectionRestored || !!this.field;
            return;
        }
        this.selectionRestored = true;
        const ids = this.selectionIds();
        if (ids.length) {
            this.selectionManager.select(ids, false);
        }
    }

    private applySelection(): void {
        const ids = this.selectionIds();
        if (ids.length) {
            this.selectionManager.select(ids, false);
        } else {
            this.selectionManager.clear();
        }
        this.persistSelection();
    }

    /** Envia a escolha ao Power BI (filtro, como a segmentação nativa, ou seleção no modo reserva). */
    private sendFilter(): void {
        if (this.selectionMode) {
            this.applySelection();
            return;
        }
        const filter = this.tree
            ? buildTreeFilter(this.tree, this.state, this.single)
            : this.keyTarget
                ? this.keyFilter()
                : this.field && buildFilter(this.field, this.state, false, this.single);
        if (filter) {
            this.host.applyJsonFilter(filter, "general", "filter", FilterAction.merge);
        } else {
            this.host.applyJsonFilter(null, "general", "filter", FilterAction.remove);
        }
    }

    private applyFilter(): void {
        this.sendFilter();
        this.render();
    }

    private toggle(item: ValueItem): void {
        if (this.state.selected.has(item.key) && this.forcing) {
            // Forçar seleção: clicar no item marcado não deixa a segmentação vazia.
            if (this.single && this.mode === "dropdown") {
                this.setDropdown(false);
            }
            return;
        }
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
            this.releaseFocus(true);
        }
        this.applyFilter();
    }

    /** Marca/desmarca um nó da hierarquia: vale para todas as folhas abaixo dele. */
    private toggleNode(node: TreeNode): void {
        const allSelected = node.leafKeys.every(k => this.state.selected.has(k));
        if (allSelected && this.forcing) {
            return;
        }
        if (allSelected) {
            node.leafKeys.forEach(k => this.state.selected.delete(k));
        } else {
            if (this.single) {
                this.state.selected.clear();
            }
            node.leafKeys.forEach(k => this.state.selected.set(k, null));
        }
        if (this.field && this.state.selected.size === this.field.values.length) {
            this.state.selected.clear();
        }
        if (this.single && this.mode === "dropdown" && !allSelected) {
            this.dropdownOpen = false;
            this.releaseFocus(true);
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
        // Forçar seleção: limpar volta para o item padrão.
        if (this.forcing) {
            this.selectDefault();
        }
        this.applyFilter();
    }

    private visibleValues(): ValueItem[] {
        const values = this.field?.values || [];
        const term = this.searchTerm();
        if (!term) {
            return values;
        }
        if (this.tree) {
            // Na hierarquia, uma folha aparece se ela ou algum nível acima dela bate com a pesquisa.
            return values.filter(v => this.pathLabels(v.key).some(label => this.matches(label, term)));
        }
        return values.filter(v => this.matches(v.label, term));
    }

    private searchTerm(): string {
        return this.search.trim().toLocaleLowerCase("pt-BR");
    }

    private matches(label: string, term: string): boolean {
        return label.toLocaleLowerCase("pt-BR").includes(term);
    }

    /** Rótulos de todos os níveis de uma folha da hierarquia (do mais alto ao mais baixo). */
    private pathLabels(leafId: string): string[] {
        const labels: string[] = [];
        const parts = leafId.split("\u001f");
        for (let i = 1; i <= parts.length; i++) {
            const node = this.tree?.nodes.get(parts.slice(0, i).join("\u001f"));
            if (node) {
                labels.push(node.item.label);
            }
        }
        return labels;
    }

    // ---------------------------------------------------------------- render

    private render(): void {
        const h = this.formattingSettings.headerCard;
        const active = this.state.selected.size > 0;
        this.header.style.display = h.show.value ? "" : "none";
        this.title.textContent = h.text.value || this.field?.displayName || "Segmentação";
        // Forçar seleção: o botão de limpar só aparece quando dá para voltar ao item padrão.
        const atDefault = this.forcing && this.state.selected.size === 1 && this.state.selected.has(this.defaultItem()?.key ?? "");
        this.clearButton.style.display = h.showClear.value && active && !atDefault ? "" : "none";
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
        if (this.tree) {
            this.renderGroupedBlocks(this.tree);
            return;
        }
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
        const list = el("div", "fs-list fs-scroll" + (this.tree ? " fs-tree" : ""));
        list.setAttribute("role", this.tree ? "tree" : "listbox");
        this.fillItems(list, "fs-row");
        container.appendChild(list);
    }

    private fillItems(container: HTMLElement, itemClass: string): void {
        if (this.tree) {
            this.fillTree(container, this.tree);
            return;
        }
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

    // --------------------------------------------------------- hierarquia

    /** Lista em árvore: setas para abrir/fechar, recuo por nível e marcação parcial nos níveis de cima. */
    private fillTree(container: HTMLElement, tree: NestedGroup): void {
        container.replaceChildren();
        const term = this.searchTerm();
        const showCheck = this.formattingSettings.itemsCard.showCheck.value;
        const visible = this.visibleValues();

        if (!this.single && this.formattingSettings.layoutCard.showSelectAll.value && visible.length > 1) {
            const allSelected = visible.every(v => this.state.selected.has(v.key));
            const some = !allSelected && visible.some(v => this.state.selected.has(v.key));
            const all = this.renderItem("Selecionar tudo", allSelected, "fs-row fs-item-all", showCheck);
            all.classList.toggle("fs-partial", some);
            all.addEventListener("click", () => this.toggleAll());
            container.appendChild(all);
        }

        const hit = new Map<string, boolean>();
        const hasHit = (node: TreeNode): boolean => {
            let h = hit.get(node.id);
            if (h === undefined) {
                h = this.matches(node.item.label, term) || node.children.some(hasHit);
                hit.set(node.id, h);
            }
            return h;
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
                // Na pesquisa, abre sozinho os níveis que têm resultado por dentro.
                const open = node.children.length > 0 && (this.expanded.has(node.id) || !selfMatch);
                container.appendChild(this.renderTreeRow(node, open, container, tree));
                rendered++;
                if (open) {
                    walk(node.children, selfMatch && !!term);
                }
            }
        };
        walk(tree.roots, false);

        if (rendered === 0) {
            container.appendChild(el("div", "fs-note", "Nenhum valor encontrado"));
        } else if (truncated) {
            container.appendChild(el("div", "fs-note",
                "Mostrando os primeiros " + MAX_RENDERED_ITEMS + " itens. Use a pesquisa para encontrar os demais."));
        }
    }

    private renderTreeRow(node: TreeNode, open: boolean, container: HTMLElement, tree: NestedGroup): HTMLElement {
        const row = el("div", "fs-tree-row");
        row.style.setProperty("--fs-depth", String(node.level));
        row.setAttribute("role", "treeitem");
        if (node.children.length) {
            row.setAttribute("aria-expanded", String(open));
            const caret = el("button", "fs-caret" + (open ? " fs-caret-open" : ""));
            caret.type = "button";
            caret.title = open ? "Recolher" : "Expandir";
            caret.setAttribute("aria-label", (open ? "Recolher " : "Expandir ") + node.item.label);
            caret.appendChild(icon("chevron"));
            caret.addEventListener("click", () => {
                if (open) {
                    this.expanded.delete(node.id);
                } else {
                    this.expanded.add(node.id);
                }
                const scroll = container.scrollTop;
                this.fillTree(container, tree);
                container.scrollTop = scroll;
            });
            row.appendChild(caret);
        } else {
            row.appendChild(el("span", "fs-caret-spacer"));
        }
        const item = this.renderNodeItem(node, "fs-row");
        row.appendChild(item);
        return row;
    }

    /** Botão de um nó: marcado quando todas as folhas abaixo estão marcadas, parcial quando só algumas. */
    private renderNodeItem(node: TreeNode, className: string, label = node.item.label): HTMLButtonElement {
        const count = node.leafKeys.filter(k => this.state.selected.has(k)).length;
        const selected = count > 0 && count === node.leafKeys.length;
        const showCheck = this.formattingSettings.itemsCard.showCheck.value;
        const item = this.renderItem(label, selected, className, showCheck);
        if (node.children.length) {
            item.classList.remove("fs-radio");
            item.classList.toggle("fs-partial", count > 0 && !selected);
            item.appendChild(el("span", "fs-count", String(node.leafKeys.length)));
        }
        item.addEventListener("click", () => this.toggleNode(node));
        return item;
    }

    /**
     * Blocos agrupados: cada grupo é o nível logo acima do último (ex.: o ano), com um título
     * clicável que marca o grupo inteiro, e os blocos do último nível (ex.: os meses) embaixo.
     */
    private renderGroupedBlocks(tree: NestedGroup): void {
        const wrap = el("div", "fs-groups fs-scroll");
        const term = this.searchTerm();
        const columns = Math.max(0, Math.round(this.formattingSettings.layoutCard.columns.value || 0));
        const depth = tree.levels.length;
        const visible = new Set(this.visibleValues().map(v => v.key));
        if (this.formattingSettings.layoutCard.showSearch.value && (this.field?.values.length || 0) > 12) {
            this.body.appendChild(this.renderSearch());
        }

        // Pais das folhas (nível depth-2), na ordem da árvore.
        const parents: TreeNode[] = [];
        const collect = (nodes: TreeNode[]): void => nodes.forEach(n => {
            if (n.level === depth - 2) {
                parents.push(n);
            } else {
                collect(n.children);
            }
        });
        collect(tree.roots);

        let rendered = 0;
        for (const parent of parents) {
            const leaves = parent.children.filter(c => visible.has(c.id));
            if (!leaves.length || rendered >= MAX_RENDERED_ITEMS) {
                continue;
            }
            const group = el("div", "fs-group");
            const path = this.pathLabels(parent.id).join(" › ");
            const head = this.renderNodeItem(parent, "fs-group-head", path);
            group.appendChild(head);
            const grid = el("div", "fs-blocks");
            if (columns > 0) {
                grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
                grid.classList.add("fs-grid");
            }
            for (const leaf of leaves) {
                grid.appendChild(this.renderNodeItem(leaf, "fs-block"));
                rendered++;
            }
            group.appendChild(grid);
            wrap.appendChild(group);
        }
        if (!wrap.childElementCount) {
            wrap.appendChild(el("div", "fs-note", term ? "Nenhum valor encontrado" : "Sem valores"));
        }
        this.body.appendChild(wrap);
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
            const symbol = String(this.formattingSettings.checkboxCard.symbol.value?.value || "check");
            if (symbol !== "none") {
                box.appendChild(icon(symbol === "x" ? "close" : symbol as "check" | "dot" | "square"));
            }
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
            } else {
                // Blocos agrupados: redesenha e devolve o foco à pesquisa.
                this.render();
                const again = this.body.querySelector<HTMLInputElement>(".fs-search input");
                again?.focus();
                again?.setSelectionRange(again.value.length, again.value.length);
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

    /** Abre/fecha o suspenso. toHost=false quando o foco já saiu do visual (clique fora). */
    private setDropdown(open: boolean, toHost = true): void {
        this.dropdownOpen = open;
        if (open) {
            this.captureFocus();
        } else {
            this.releaseFocus(toHost);
        }
        this.render();
    }

    /** Põe o foco dentro do visual, para saber (pelo "blur" da janela) quando clicarem fora. */
    private captureFocus(): void {
        try {
            window.focus();
        } catch {
            // ignora: alguns hosts não deixam focar a janela
        }
        this.root.focus({ preventScroll: true });
    }

    /** Tira o foco do visual; com toHost, devolve ao relatório para Ctrl+C / Ctrl+V continuarem. */
    private releaseFocus(toHost: boolean): void {
        if (this.root.contains(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
        }
        if (toHost) {
            try {
                window.parent?.focus();
            } catch {
                // ignora: sem acesso à janela do relatório
            }
        }
    }

    private selectionLabel(): string {
        const n = this.state.selected.size;
        if (n === 0) {
            return this.formattingSettings.dropdownCard.placeholder.value || "Todos";
        }
        if (this.tree) {
            // Descreve a seleção pelos nós inteiros marcados (ex.: "2025" ou "2025 › mar").
            const cover = coverNodes(this.tree.roots, this.state.selected);
            return cover.length === 1 ? this.pathLabels(cover[0].id).join(" › ") : cover.length + " selecionados";
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

        const cb = this.formattingSettings.checkboxCard;
        const shape = String(cb.shape.value?.value || "rounded");
        s.setProperty("--fs-cb-size", Math.min(40, Math.max(8, cb.size.value || 16)) + "px");
        s.setProperty("--fs-cb-bw", px(cb.borderWidth.value));
        s.setProperty("--fs-cb-radius", shape === "circle" ? "50%" : shape === "square" ? "0px" : "4px");
        s.setProperty("--fs-cb-bg", cb.fill.value.value);
        s.setProperty("--fs-cb-bc", cb.borderColor.value.value);
        s.setProperty("--fs-cb-sel-bg", cb.selectedFill.value.value);
        s.setProperty("--fs-cb-sel-bc", cb.selectedBorderColor.value.value);
        s.setProperty("--fs-cb-symbol", cb.symbolColor.value.value);
    }
}
