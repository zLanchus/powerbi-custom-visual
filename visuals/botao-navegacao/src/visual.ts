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

import { VisualFormattingSettingsModel, enumValue } from "./settings";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Ícones de traço (viewBox 24×24). */
const ICONS: Record<string, string> = {
    chart: "M6 20v-5M12 20V9M18 20V4M3 20h18",
    page: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
    table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
    people: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7",
    home: "M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5",
    filter: "M4 5h16l-6 7.5V19l-4 1.5v-8z",
    calendar: "M5 6h14v14H5zM5 10h14M9 3v5M15 3v5",
    money: "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.4 4.5 3.2-2 3-4.5 3-4.5-1.3-4.5-3",
    target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
    back: "M19 12H5M11 6l-6 6 6 6"
};

const ARROWS: Record<string, string> = {
    arrow: "M5 12h14M13 6l6 6-6 6",
    chevron: "M9 6l6 6-6 6",
    badge: "M7 12h10M13 8l4 4-4 4",
    external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
};

/** Folga em volta do botão para a sombra (e a elevação) não serem cortadas. */
const SHADOW_INSET: Record<string, number> = { none: 3, soft: 4, medium: 8, strong: 14 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    return node;
}

function icon(d: string, className: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
}

/** Cor escura? (luminância relativa, para o hover automático clarear em vez de escurecer). */
function isDark(hex: string): boolean {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) {
        return false;
    }
    const n = parseInt(m[1], 16);
    const lin = (c: number): number => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return l < 0.25;
}

/** Só links http(s) são abertos. */
function safeUrl(value: string): string | undefined {
    const v = value.trim();
    return /^https?:\/\/\S+$/i.test(v) ? v : undefined;
}

function textOf(value: PrimitiveValue | undefined): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const s = String(value).trim();
    return s === "" ? undefined : s;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private button: HTMLElement;
    private url: string | undefined;
    private rippleOn = true;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();
        this.formattingSettings = new VisualFormattingSettingsModel();

        this.root = el("div", "bn-root");
        this.button = el("div", "bn-btn");
        this.button.setAttribute("role", "button");
        this.button.tabIndex = 0;
        this.root.appendChild(this.button);
        options.element.appendChild(this.root);

        // Menu do botão direito do Power BI.
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            this.selectionManager.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        this.root.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
        this.button.addEventListener("pointerdown", (e: PointerEvent) => this.ripple(e));
        this.button.addEventListener("click", () => this.activate());
        this.button.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.button.classList.add("bn-pressed");
                this.activate();
            }
        });
        this.button.addEventListener("keyup", () => this.button.classList.remove("bn-pressed"));
        this.button.addEventListener("blur", () => this.button.classList.remove("bn-pressed"));
    }

    public update(options: VisualUpdateOptions): void {
        this.events?.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.render(dataView, options.viewport);
            this.events?.renderingFinished(options);
        } catch (e) {
            this.events?.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const s = this.formattingSettings;
        const icon = s.iconCard;
        icon.icon.visible = icon.size.visible = icon.color.visible = icon.show.value;
        const arrow = s.arrowCard;
        const hasArrow = enumValue(arrow.type) !== "none";
        arrow.size.visible = arrow.color.visible = arrow.animate.visible = arrow.divider.visible = hasArrow;
        arrow.dividerColor.visible = hasArrow && arrow.divider.value;
        const fx = s.effectsCard;
        fx.hoverBackground.visible = fx.hoverColor.visible = enumValue(fx.hover) === "custom";
        return this.formattingSettingsService.buildFormattingModel(s);
    }

    // ------------------------------------------------------------- clique

    /** Segue o link com um clique normal, também no Desktop (lá o relatório está sempre em modo de edição e o Ctrl + clique seleciona visuais). */
    private activate(): void {
        if (!this.url) {
            return;
        }
        this.host.launchUrl(this.url);
    }

    private ripple(e: PointerEvent): void {
        if (!this.rippleOn || e.button !== 0) {
            return;
        }
        const rect = this.button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const wave = el("span", "bn-ripple");
        wave.style.width = wave.style.height = `${size}px`;
        wave.style.left = `${e.clientX - rect.left - size / 2}px`;
        wave.style.top = `${e.clientY - rect.top - size / 2}px`;
        wave.addEventListener("animationend", () => wave.remove());
        this.button.appendChild(wave);
    }

    // ------------------------------------------------------------- desenho

    private render(dataView: DataView | undefined, viewport: powerbi.IViewport): void {
        const s = this.formattingSettings;
        const b = s.buttonCard;
        const l = s.labelCard;
        const ic = s.iconCard;
        const ar = s.arrowCard;
        const fx = s.effectsCard;

        // Campos (medidas) opcionais: Texto, Subtítulo e Link.
        const fields: Record<string, string | undefined> = {};
        for (const column of dataView?.categorical?.values ?? []) {
            for (const role of ["label", "subtitle", "url"]) {
                if (column.source.roles?.[role]) {
                    fields[role] = textOf(column.values?.[0]);
                }
            }
        }
        const title = fields["label"] ?? l.text.value ?? "";
        const subtitle = fields["subtitle"] ?? l.subtitle.value ?? "";
        this.url = safeUrl(fields["url"] ?? s.actionCard.url.value ?? "");
        this.rippleOn = fx.ripple.value;

        const shadow = enumValue(b.shadow);
        const hover = enumValue(fx.hover);
        const arrowType = enumValue(ar.type);
        // Em visuais baixos a folga encolhe, para o botão não ficar fino demais.
        const inset = Math.min(SHADOW_INSET[shadow] ?? 4, Math.max(2, Math.round(viewport.height * 0.12)));
        const background = b.background.value.value;

        const root = this.root;
        const vars: Record<string, string> = {
            "--bn-bg": background,
            "--bn-fg": l.fontColor.value.value,
            "--bn-sub": l.subtitleColor.value.value,
            "--bn-icon": ic.color.value.value,
            "--bn-arrow": ar.color.value.value,
            "--bn-divider": ar.dividerColor.value.value,
            "--bn-border": b.borderColor.value.value,
            "--bn-border-width": `${Math.max(0, b.borderWidth.value)}px`,
            "--bn-hover-bg": fx.hoverBackground.value.value,
            "--bn-hover-fg": fx.hoverColor.value.value,
            "--bn-radius": `${Math.max(0, b.radius.value)}px`,
            "--bn-pad": `${Math.max(0, b.padding.value)}px`,
            "--bn-gap": `${Math.max(0, b.gap.value)}px`,
            "--bn-inset": `${inset}px`
        };
        for (const [k, v] of Object.entries(vars)) {
            root.style.setProperty(k, v);
        }
        root.style.fontFamily = b.fontFamily.value;

        const classes = [
            "bn-root",
            `bn-layout-${enumValue(b.layout)}`,
            `bn-shadow-${shadow}`,
            `bn-hover-${hover}`,
            hover === "auto" ? (isDark(background) ? "bn-dark" : "bn-light") : "",
            b.gradient.value ? "bn-gradient" : "",
            fx.lift.value ? "bn-lift" : "",
            fx.shine.value ? "bn-shine-on" : "",
            fx.press.value ? "bn-press" : "",
            ar.animate.value ? "bn-animate" : "",
            this.url ? "bn-link" : ""
        ];
        root.className = classes.filter(c => c).join(" ");

        const button = this.button;
        const maxHeight = Math.max(0, viewport.height - 2 * inset);
        button.style.height = b.height.value > 0 ? `${Math.min(b.height.value, maxHeight)}px` : "";
        button.replaceChildren();

        if (ic.show.value) {
            const svg = icon(ICONS[enumValue(ic.icon)] ?? ICONS.chart, "bn-icon");
            svg.style.width = svg.style.height = `${Math.max(8, ic.size.value)}px`;
            button.appendChild(svg);
        }

        const texts = el("span", "bn-texts");
        const titleNode = el("span", "bn-title");
        titleNode.textContent = title;
        titleNode.style.fontSize = `${Math.max(6, l.fontSize.value)}px`;
        titleNode.style.fontWeight = l.bold.value ? "600" : "400";
        titleNode.style.textTransform = l.uppercase.value ? "uppercase" : "none";
        titleNode.style.letterSpacing = l.uppercase.value ? "0.04em" : "";
        texts.appendChild(titleNode);
        if (subtitle) {
            const sub = el("span", "bn-subtitle");
            sub.textContent = subtitle;
            sub.style.fontSize = `${Math.max(6, l.subtitleSize.value)}px`;
            texts.appendChild(sub);
        }
        button.appendChild(texts);

        if (arrowType !== "none") {
            if (ar.divider.value) {
                button.appendChild(el("span", "bn-divider"));
            }
            const wrap = el("span", `bn-arrow bn-arrow-${arrowType}`);
            const size = Math.max(8, ar.size.value);
            const svg = icon(ARROWS[arrowType] ?? ARROWS.arrow, "bn-arrow-svg");
            svg.style.width = svg.style.height = `${size}px`;
            if (arrowType === "badge") {
                wrap.style.width = wrap.style.height = `${Math.round(size * 1.7)}px`;
            }
            wrap.appendChild(svg);
            button.appendChild(wrap);
        }
        button.appendChild(el("span", "bn-shine"));

        // Acessibilidade e dica.
        const tip = s.actionCard.tooltip.value?.trim() ?? "";
        button.title = tip;
        button.setAttribute("aria-label", [title, subtitle].filter(t => t).join(". "));
        if (this.url) {
            button.setAttribute("role", "link");
        } else {
            button.setAttribute("role", "button");
        }
    }
}
