"use strict";

import powerbi from "powerbi-visuals-api";

import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

/**
 * Seleção como nos visuais nativos: clique seleciona e filtra os outros visuais,
 * Ctrl+clique soma, clique no fundo limpa e o botão direito abre o menu de contexto
 * (que habilita "Analisar" e "Drill through").
 */
export class SelectionHelper {
    private manager: ISelectionManager;
    private host: IVisualHost;

    constructor(host: IVisualHost, private onChange: () => void) {
        this.host = host;
        this.manager = host.createSelectionManager();
        this.manager.registerOnSelectCallback(() => this.onChange());
    }

    /** Alguns hosts (ex.: blocos de dashboard) não permitem interação com o visual. */
    public get allowInteractions(): boolean {
        return this.host.hostCapabilities?.allowInteractions !== false;
    }

    public get ids(): ISelectionId[] {
        return this.manager.getSelectionIds() as ISelectionId[];
    }

    public get hasSelection(): boolean {
        return this.manager.hasSelection();
    }

    public isSelected(id: ISelectionId | undefined): boolean {
        return !!id && this.ids.some(sel => sel.equals(id));
    }

    public select(ids: ISelectionId | ISelectionId[], multi: boolean): void {
        const list = Array.isArray(ids) ? ids : [ids];
        if (list.length === 0 || !this.allowInteractions) {
            return;
        }
        this.manager.select(list.length === 1 ? list[0] : list, multi).then(() => this.onChange());
    }

    public clear(): void {
        if (!this.allowInteractions) {
            return;
        }
        this.manager.clear().then(() => this.onChange());
    }

    public contextMenu(id: ISelectionId | undefined, e: MouseEvent): void {
        e.preventDefault();
        e.stopPropagation();
        this.manager.showContextMenu(id || ({} as ISelectionId), { x: e.clientX, y: e.clientY });
    }

    /**
     * Eventos do fundo do visual. `isItem` diz se o alvo do clique é um elemento de dados
     * (esses tratam o próprio clique).
     */
    public bindBackground(root: HTMLElement, isItem: (target: Element) => boolean): void {
        root.addEventListener("contextmenu", (e: MouseEvent) => {
            if (!isItem(e.target as Element)) {
                this.contextMenu(undefined, e);
            }
        });
        // Cliques não prendem o teclado no visual (Ctrl+C / Ctrl+V do Power BI continuam funcionando).
        root.addEventListener("mousedown", (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest("input, textarea, select")) {
                e.preventDefault();
            }
        });
        root.addEventListener("click", (e: MouseEvent) => {
            if (!isItem(e.target as Element)) {
                this.clear();
            }
        });
    }
}

/** Navegação por teclado: Tab entra no visual, setas percorrem, Enter seleciona, Esc sai. */
export interface KeyboardTarget {
    count(): number;
    focus(index: number): void;
    activate(index: number, multi: boolean): void;
    leave(): void;
}

export function bindKeyboard(element: HTMLElement | SVGElement, target: KeyboardTarget): void {
    let index = -1;
    element.addEventListener("focus", () => {
        if (target.count() > 0) {
            index = Math.min(Math.max(0, index), target.count() - 1);
            target.focus(index);
        }
    });
    element.addEventListener("blur", () => target.focus(-1));
    element.addEventListener("keydown", (e: KeyboardEvent) => {
        const n = target.count();
        if (n === 0) {
            return;
        }
        let next = index;
        switch (e.key) {
            case "ArrowRight":
            case "ArrowDown":
                next = Math.min(n - 1, index + 1);
                break;
            case "ArrowLeft":
            case "ArrowUp":
                next = Math.max(0, index - 1);
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = n - 1;
                break;
            case "Enter":
            case " ":
                e.preventDefault();
                if (index >= 0) {
                    target.activate(index, e.ctrlKey || e.metaKey || e.shiftKey);
                }
                return;
            case "Escape":
                e.preventDefault();
                index = -1;
                target.leave();
                (element as HTMLElement).blur();
                return;
            default:
                return;
        }
        e.preventDefault();
        index = next;
        target.focus(index);
    });
}
