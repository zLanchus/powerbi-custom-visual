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
import DataView = powerbi.DataView;

import { DARK, VisualFormattingSettingsModel } from "./settings";
import { MatrixModel, RowItem, ValueColumn, buildModel, cellValue } from "./model";
import { MeasureFormat, buildFormatCard, colorProp, mix, readFormat, readableText, ruleColor, toNumber } from "./conditional";

const MAX_RENDERED_ROWS = 5000;
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

function chevron(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "mx-chevron");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M9 6l6 6-6 6");
    svg.appendChild(path);
    return svg;
}

interface Stats {
    min: number;
    max: number;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private scroller: HTMLElement;
    private model: MatrixModel | undefined;
    private expanded = new Set<string>();
    private expandSignature = "";
    private formats = new Map<number, MeasureFormat>();
    private stats = new Map<number, Stats>();
    private selectedRows = new Set<string>();

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "mx-root");
        this.scroller = el("div", "mx-scroll");
        this.root.appendChild(this.scroller);
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI (fora das linhas).
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
        // Clique fora das linhas limpa a seleção.
        this.scroller.addEventListener("click", (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest("tbody tr, tfoot tr, thead")) {
                this.clearSelection();
            }
        });
        this.selectionManager.registerOnSelectCallback(() => {
            this.selectedRows.clear();
            this.render();
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

            const totalLabel = this.formattingSettings.totalsCard.label.value || "Total";
            this.model = buildModel(dataView, this.host.locale || "pt-BR", totalLabel);
            this.prepareFormats();
            this.initExpansion();
            this.applyStyles();
            this.render();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const settings = this.formattingSettings;
        const used = new Set(this.model?.sections || []);
        settings.sectionsCard.groups.forEach((group, k) => {
            group.visible = used.has(k + 1);
        });
        settings.tableCard.zebraColor.visible = settings.tableCard.zebra.value;

        const cards = settings.cards.slice();
        if (this.model) {
            settings.cards = cards.concat(buildFormatCard(this.model.measures));
        }
        const formattingModel = this.formattingSettingsService.buildFormattingModel(settings);
        settings.cards = cards;
        return formattingModel;
    }

    // ------------------------------------------------------------- preparo

    private prepareFormats(): void {
        this.formats.clear();
        this.stats.clear();
        const model = this.model;
        if (!model) {
            return;
        }
        for (const m of model.measures) {
            if (m.section > 0) {
                this.formats.set(m.index, readFormat(m));
            }
        }
        // Mínimo e máximo de cada medida-base (só linhas de detalhe), para a escala de cores.
        const leaves: RowItem[] = [];
        const collect = (items: RowItem[]): void => items.forEach(r => r.children.length ? collect(r.children) : leaves.push(r));
        collect(model.rows);
        for (const f of this.formats.values()) {
            if (f.mode !== "gradient") {
                continue;
            }
            const basis = this.basisIndex(f);
            if (this.stats.has(basis)) {
                continue;
            }
            let min = Infinity;
            let max = -Infinity;
            for (const row of leaves) {
                for (const group of model.groups) {
                    if (group.isSubtotal) {
                        continue;
                    }
                    const v = toNumber(cellValue(model, row, group.key, basis)?.value);
                    if (v !== undefined) {
                        min = Math.min(min, v);
                        max = Math.max(max, v);
                    }
                }
            }
            if (min <= max) {
                this.stats.set(basis, { min, max });
            }
        }
    }

    private basisIndex(f: MeasureFormat): number {
        return this.model?.measures.find(m => m.queryName === f.basis)?.index ?? -1;
    }

    /** Abre os níveis definidos em "Níveis abertos ao carregar" quando o visual é montado ou a opção muda. */
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

    // ---------------------------------------------------------------- render

    private render(): void {
        const scrollTop = this.scroller.scrollTop;
        const scrollLeft = this.scroller.scrollLeft;
        this.scroller.replaceChildren();

        const model = this.model;
        if (!model || model.columns.length === 0) {
            const empty = el("div", "mx-empty");
            empty.append(
                el("strong", undefined, "Matriz Estilizada"),
                el("span", undefined, "Coloque campos em \"Linhas\" e medidas em \"Seção 1 – valores\" (e nas outras seções, se quiser agrupar colunas).")
            );
            this.scroller.appendChild(empty);
            return;
        }

        const table = el("table", "mx-table");
        table.appendChild(this.renderHead(model));

        const body = el("tbody");
        let count = 0;
        const addRows = (items: RowItem[]): void => {
            for (const row of items) {
                if (count++ >= MAX_RENDERED_ROWS) {
                    return;
                }
                body.appendChild(this.renderRow(model, row));
                if (row.children.length && this.expanded.has(row.id)) {
                    addRows(row.children);
                }
            }
        };
        addRows(model.rows);
        body.classList.toggle("mx-has-selection", this.selectedRows.size > 0);
        table.appendChild(body);

        if (model.grandTotal && this.formattingSettings.totalsCard.showGrandTotal.value) {
            const foot = el("tfoot");
            foot.appendChild(this.renderRow(model, model.grandTotal));
            table.appendChild(foot);
        }

        this.scroller.appendChild(table);
        this.scroller.scrollTop = scrollTop;
        this.scroller.scrollLeft = scrollLeft;
    }

    private renderHead(model: MatrixModel): HTMLTableSectionElement {
        const s = this.formattingSettings;
        const head = el("thead");
        const cols = model.columns;
        const memberLevels = model.columnLevelNames.length;
        const showSections = s.sectionHeaderCard.show.value
            && (model.sections.length > 1 || model.sections.some(n => !!s.sectionTitle(n)));
        const headerRows = (showSections ? 1 : 0) + memberLevels + 1;

        const corner = el("th", "mx-corner", s.rowHeadersCard.title.value || model.rowLevelNames.join(" / "));
        corner.rowSpan = headerRows;
        corner.scope = "col";

        const isSectionStart = (i: number): boolean => i === 0 || cols[i].section !== cols[i - 1].section;

        // Faixas de cabeçalho: [seções] > [membros das colunas, um nível por linha] > medidas.
        const spanRow = (keyOf: (c: ValueColumn) => string, labelOf: (c: ValueColumn) => string, className: string,
            decorate?: (th: HTMLTableCellElement, c: ValueColumn) => void): HTMLTableRowElement => {
            const tr = el("tr");
            let i = 0;
            while (i < cols.length) {
                let j = i + 1;
                while (j < cols.length && keyOf(cols[j]) === keyOf(cols[i]) && !isSectionStart(j)) {
                    j++;
                }
                const th = el("th", className, labelOf(cols[i]));
                th.colSpan = j - i;
                th.scope = "colgroup";
                if (isSectionStart(i)) {
                    th.classList.add("mx-section-start");
                }
                decorate?.(th, cols[i]);
                tr.appendChild(th);
                i = j;
            }
            return tr;
        };

        const rows: HTMLTableRowElement[] = [];
        if (showSections) {
            rows.push(spanRow(c => String(c.section), c => s.sectionTitle(c.section), "mx-sec",
                (th, c) => th.style.setProperty("--mx-accent", s.sectionColor(c.section))));
        }
        for (let level = 0; level < memberLevels; level++) {
            rows.push(spanRow(
                c => c.section + "#" + c.group.labels.slice(0, level + 1).join("\u001f"),
                c => c.group.labels[level] ?? "",
                "mx-member"));
        }
        const measureRow = el("tr");
        cols.forEach((c, i) => {
            const th = el("th", "mx-measure", c.measure.name);
            th.scope = "col";
            th.title = c.measure.name;
            if (isSectionStart(i)) {
                th.classList.add("mx-section-start");
            }
            if (c.group.isSubtotal) {
                th.classList.add("mx-col-total");
            }
            measureRow.appendChild(th);
        });
        rows.push(measureRow);

        rows[0].insertBefore(corner, rows[0].firstChild);
        rows.forEach(r => head.appendChild(r));
        return head;
    }

    private renderRow(model: MatrixModel, row: RowItem): HTMLTableRowElement {
        const s = this.formattingSettings;
        const tr = el("tr", row.isGrandTotal ? "mx-total" : row.children.length ? "mx-parent" : "mx-leaf");
        tr.dataset.level = String(row.level);
        if (this.selectedRows.has(row.id)) {
            tr.classList.add("mx-selected");
        }

        const head = el("th", "mx-rowhead");
        head.scope = "row";
        head.style.setProperty("--mx-level", String(row.isGrandTotal ? 0 : row.level));
        const inner = el("div", "mx-rowhead-inner");
        if (row.children.length) {
            const open = this.expanded.has(row.id);
            const toggle = el("button", "mx-toggle" + (open ? " mx-open" : ""));
            toggle.type = "button";
            toggle.setAttribute("aria-expanded", String(open));
            toggle.setAttribute("aria-label", (open ? "Recolher " : "Expandir ") + row.label);
            toggle.appendChild(chevron());
            inner.appendChild(toggle);
            head.classList.add("mx-expandable");
            head.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                this.toggleRow(row);
            });
        } else if (model.rowLevelNames.length > 1) {
            inner.appendChild(el("span", "mx-toggle-spacer"));
        }
        const label = el("span", "mx-label", row.label);
        label.title = row.label;
        inner.appendChild(label);
        head.appendChild(inner);
        tr.appendChild(head);

        const isTotalRow = row.isGrandTotal || row.children.length > 0;
        const emptyText = s.valuesCard.emptyText.value ?? "–";
        model.columns.forEach((c, i) => {
            const cell = cellValue(model, row, c.group.key, c.measure.index);
            const raw = cell?.value;
            const empty = raw === null || raw === undefined || raw === "";
            const td = el("td", "mx-cell" + (empty ? " mx-empty-value" : ""), empty ? emptyText : c.measure.format(raw));
            if (i === 0 || c.section !== model.columns[i - 1].section) {
                td.classList.add("mx-section-start");
            }
            if (c.group.isSubtotal) {
                td.classList.add("mx-col-total");
            }
            this.applyCellFormat(td, model, row, c, cell?.objects, isTotalRow || c.group.isSubtotal);
            tr.appendChild(td);
        });

        if (!row.isGrandTotal) {
            tr.addEventListener("click", (e: MouseEvent) => this.selectRow(model, row, e.ctrlKey || e.metaKey));
            tr.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectionManager.showContextMenu(this.selectionId(model, row), { x: e.clientX, y: e.clientY });
            });
        }
        return tr;
    }

    /** Cores da célula: regra "fx" do Power BI > formatação rápida > cor fixa da medida. */
    private applyCellFormat(td: HTMLElement, model: MatrixModel, row: RowItem, c: ValueColumn,
        objects: powerbi.DataViewObjects | undefined, isTotal: boolean): void {
        const f = this.formats.get(c.measure.index);
        if (!f) {
            return;
        }
        let background = colorProp(objects, "fill") || "";
        let font = colorProp(objects, "fontColor") || "";

        if (f.mode !== "none" && (!isTotal || f.applyToTotals)) {
            const basis = this.basisIndex(f);
            const v = toNumber(cellValue(model, row, c.group.key, basis)?.value);
            let color: string | undefined;
            if (v !== undefined && f.mode === "gradient") {
                const st = this.stats.get(basis);
                if (st) {
                    color = mix(f.minColor, f.maxColor, st.max === st.min ? 1 : (v - st.min) / (st.max - st.min));
                }
            } else if (v !== undefined && f.mode === "rules") {
                color = ruleColor(f.rules, v);
            }
            if (color) {
                if (f.target === "font") {
                    font = font || color;
                } else {
                    background = background || color;
                }
            }
        }

        background = background || f.fill;
        font = font || f.fontColor;
        if (background) {
            td.style.background = background;
            td.style.color = font || readableText(background, DARK);
            td.classList.add("mx-formatted");
        } else if (font) {
            td.style.color = font;
        }
    }

    // ----------------------------------------------------------- interação

    private toggleRow(row: RowItem): void {
        if (this.expanded.has(row.id)) {
            this.expanded.delete(row.id);
        } else {
            this.expanded.add(row.id);
        }
        this.render();
    }

    private selectionId(model: MatrixModel, row: RowItem): ISelectionId {
        return this.host.createSelectionIdBuilder()
            .withMatrixNode(row.node, model.rowLevels)
            .createSelectionId();
    }

    /** Clique numa linha filtra os outros visuais, como na matriz nativa (Ctrl para várias). */
    private selectRow(model: MatrixModel, row: RowItem, multi: boolean): void {
        const already = this.selectedRows.has(row.id);
        if (multi) {
            // Ctrl + clique: adiciona ou remove a linha da seleção.
            if (already) {
                this.selectedRows.delete(row.id);
            } else {
                this.selectedRows.add(row.id);
            }
            this.selectionManager.select(this.selectionId(model, row), true);
        } else if (already && this.selectedRows.size === 1) {
            // Clicar de novo na única linha selecionada limpa a seleção.
            this.selectedRows.clear();
            this.selectionManager.clear();
        } else {
            this.selectedRows = new Set([row.id]);
            this.selectionManager.select(this.selectionId(model, row), false);
        }
        this.render();
    }

    private clearSelection(): void {
        if (this.selectedRows.size) {
            this.selectedRows.clear();
            this.selectionManager.clear();
            this.render();
        }
    }

    // ---------------------------------------------------------------- estilos

    private applyStyles(): void {
        const s = this.formattingSettings;
        const st = this.root.style;
        const px = (v: number, min = 0): string => Math.max(min, v || 0) + "px";
        const t = s.tableCard;
        st.setProperty("--mx-font", t.fontFamily.value);
        st.setProperty("--mx-bg", t.fill.value.value);
        st.setProperty("--mx-row-h", px(t.rowHeight.value, 20));
        st.setProperty("--mx-zebra", t.zebra.value ? t.zebraColor.value.value : "transparent");
        st.setProperty("--mx-hover", t.hoverColor.value.value);
        st.setProperty("--mx-grid", t.gridColor.value.value);
        st.setProperty("--mx-radius", px(t.radius.value));
        st.setProperty("--mx-bw", px(t.borderWidth.value));
        st.setProperty("--mx-bc", t.borderColor.value.value);

        const sh = s.sectionHeaderCard;
        st.setProperty("--mx-sec-bg", sh.fill.value.value);
        st.setProperty("--mx-sec-fg", sh.fontColor.value.value);
        st.setProperty("--mx-sec-size", px(sh.fontSize.value, 6));
        st.setProperty("--mx-sec-case", sh.uppercase.value ? "uppercase" : "none");
        st.setProperty("--mx-accent-h", px(sh.accentHeight.value));

        const ch = s.columnHeaderCard;
        st.setProperty("--mx-head-bg", ch.fill.value.value);
        st.setProperty("--mx-head-fg", ch.fontColor.value.value);
        st.setProperty("--mx-head-size", px(ch.fontSize.value, 6));
        st.setProperty("--mx-head-case", ch.uppercase.value ? "uppercase" : "none");
        st.setProperty("--mx-col-w", px(ch.minWidth.value, 40));

        const rh = s.rowHeadersCard;
        st.setProperty("--mx-row-bg", rh.fill.value.value);
        st.setProperty("--mx-row-fg", rh.fontColor.value.value);
        st.setProperty("--mx-row-size", px(rh.fontSize.value, 6));
        st.setProperty("--mx-row-w", px(rh.width.value, 60));
        st.setProperty("--mx-indent", px(rh.indent.value));
        st.setProperty("--mx-parent-weight", rh.parentBold.value ? "650" : "400");

        const v = s.valuesCard;
        st.setProperty("--mx-val-fg", v.fontColor.value.value);
        st.setProperty("--mx-val-size", px(v.fontSize.value, 6));

        const tt = s.totalsCard;
        st.setProperty("--mx-total-bg", tt.fill.value.value);
        st.setProperty("--mx-total-fg", tt.fontColor.value.value);
    }
}
