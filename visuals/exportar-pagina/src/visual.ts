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
import PrimitiveValue = powerbi.PrimitiveValue;

import { DEFAULT_EXPORT_URL, VisualFormattingSettingsModel, enumValue } from "./settings";

// Como funciona: o visual roda num iframe isolado e não enxerga a página do relatório, e o download
// direto (downloadService) depende de uma opção do administrador que vem desligada. Por isso o botão
// abre, com host.launchUrl (permitido para qualquer visual), a página de exportação (site/exportar).
// Lá o usuário escolhe a aba/janela do relatório, a página é capturada e o PDF/PNG é gerado no próprio
// navegador. As opções vão no "#" do endereço, que não é enviado a nenhum servidor.

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

/** Ícones desenhados em SVG (traço), no padrão do repositório. */
function icon(kind: "download" | "external", className?: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "ep-icon" + (className ? " " + className : ""));
    const paths: Record<string, string[]> = {
        download: ["M12 4v11", "M7 10.5l5 5 5-5", "M5 20h14"],
        external: ["M14 5h5v5", "M19 5l-8 8", "M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5"]
    };
    for (const d of paths[kind]) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

function asText(value: PrimitiveValue | undefined): string {
    return value === null || value === undefined ? "" : String(value).trim();
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private button: HTMLButtonElement;
    private label: HTMLElement;
    private measureFileName = "";
    private measureFooter = "";
    private feedbackTimer: number | undefined;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = el("div", "ep-root");
        options.element.appendChild(this.root);
        this.buildButton();

        // Menu do botão direito do Power BI.
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
    }

    // ---------------------------------------------------------------- update

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.readMeasures(dataView);
            this.applyStyles(options.viewport.height);
            this.refreshButton();
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const b = this.formattingSettings.buttonCard;
        b.borderColor.visible = b.borderWidth.value > 0;
        const x = this.formattingSettings.exportCard;
        const pdf = enumValue(x.format) === "pdf";
        x.paper.visible = pdf;
        x.orientation.visible = pdf && enumValue(x.paper) !== "fit";
        x.footerText.visible = x.footer.value;
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private readMeasures(dataView: DataView | undefined): void {
        const columns = Array.from(dataView?.categorical?.values ?? []);
        const byRole = (role: string): string => asText(columns.find(c => c.source.roles?.[role])?.values[0]);
        this.measureFileName = byRole("fileName");
        this.measureFooter = byRole("footer");
    }

    // ---------------------------------------------------------------- botão

    private buildButton(): void {
        this.button = el("button", "ep-button");
        this.button.type = "button";

        const main = el("span", "ep-button-main");
        main.appendChild(icon("download", "ep-button-icon"));
        this.label = el("span", "ep-button-label");
        main.appendChild(this.label);

        const arrow = el("span", "ep-button-arrow");
        arrow.appendChild(icon("external"));

        this.button.append(main, el("span", "ep-divider"), arrow);
        this.button.addEventListener("click", () => this.openExportPage());
        this.root.appendChild(this.button);
    }

    private refreshButton(): void {
        const b = this.formattingSettings.buttonCard;
        const allowed = this.host.hostCapabilities?.allowInteractions !== false;
        this.root.classList.toggle("ep-no-icon", !b.showIcon.value);
        this.root.classList.toggle("ep-no-arrow", !b.showArrow.value);
        this.button.disabled = !allowed;
        this.button.title = allowed
            ? "Abre a página de exportação numa nova aba. Lá você escolhe esta aba do relatório e baixa o PDF ou a imagem."
            : "A exportação não está disponível neste modo de exibição.";
        if (this.feedbackTimer === undefined) {
            this.label.textContent = b.text.value || "Exportar página";
        }
    }

    /** Endereço da página de exportação, com as opções no "#" (não vai para o servidor). */
    private exportUrl(): string {
        const x = this.formattingSettings.exportCard;
        let base = (x.url.value || "").trim() || DEFAULT_EXPORT_URL;
        if (!/^https?:\/\//i.test(base)) {
            base = DEFAULT_EXPORT_URL;
        }
        const params = new URLSearchParams();
        params.set("v", "1");
        params.set("nome", this.measureFileName || x.fileName.value || "Relatório");
        params.set("formato", enumValue(x.format) || "pdf");
        params.set("papel", enumValue(x.paper) || "fit");
        params.set("orientacao", enumValue(x.orientation) || "auto");
        params.set("datahora", x.timestamp.value ? "1" : "0");
        params.set("rodape", x.footer.value ? "1" : "0");
        const footer = this.measureFooter || x.footerText.value || "";
        if (footer) {
            // Limite para o endereço não ficar grande demais.
            params.set("texto", footer.slice(0, 1500));
        }
        params.set("auto", x.autoCapture.value ? "1" : "0");
        return base.split("#")[0] + "#" + params.toString();
    }

    private openExportPage(): void {
        if (this.button.disabled) {
            return;
        }
        this.host.launchUrl(this.exportUrl());

        // Aviso rápido no próprio botão.
        this.label.textContent = "Abrindo…";
        this.root.classList.add("ep-busy");
        window.clearTimeout(this.feedbackTimer);
        this.feedbackTimer = window.setTimeout(() => {
            this.feedbackTimer = undefined;
            this.root.classList.remove("ep-busy");
            this.refreshButton();
        }, 2500);
    }

    // ---------------------------------------------------------------- estilos

    private applyStyles(viewportHeight: number): void {
        const b = this.formattingSettings.buttonCard;
        const st = this.root.style;
        const height = b.height.value > 0 ? Math.min(Math.max(24, b.height.value), viewportHeight) : viewportHeight;
        st.setProperty("--ep-bg", b.fill.value.value);
        st.setProperty("--ep-fg", b.fontColor.value.value);
        st.setProperty("--ep-font", b.fontFamily.value);
        st.setProperty("--ep-font-size", Math.max(8, b.fontSize.value || 0) + "px");
        st.setProperty("--ep-weight", b.bold.value ? "600" : "400");
        st.setProperty("--ep-height", Math.max(0, height) + "px");
        st.setProperty("--ep-radius", Math.max(0, b.radius.value || 0) + "px");
        st.setProperty("--ep-bw", Math.max(0, b.borderWidth.value || 0) + "px");
        st.setProperty("--ep-bc", b.borderColor.value.value);
    }
}
