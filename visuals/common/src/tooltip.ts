"use strict";

import powerbi from "powerbi-visuals-api";
import { BaseType, Selection } from "d3-selection";

import ITooltipService = powerbi.extensibility.ITooltipService;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

export interface TooltipContent {
    items: VisualTooltipDataItem[];
    /** Identidades do ponto: habilitam a dica de ferramenta de página. */
    ids: ISelectionId[];
}

/** Dicas de ferramenta nativas do Power BI (também as de página, via identidades). */
export class TooltipHelper {
    private visible = false;

    constructor(private service: ITooltipService | undefined) {}

    public show(e: MouseEvent, content: TooltipContent | undefined): void {
        if (!this.service?.enabled() || !content || content.items.length === 0) {
            this.hide();
            return;
        }
        const args = { coordinates: [e.clientX, e.clientY], isTouchEvent: false, dataItems: content.items, identities: content.ids };
        if (this.visible) {
            this.service.move(args);
        } else {
            this.service.show(args);
            this.visible = true;
        }
    }

    public hide(): void {
        if (this.visible) {
            this.service?.hide({ immediately: true, isTouchEvent: false });
            this.visible = false;
        }
    }

    /** Liga a dica aos elementos; o conteúdo é calculado no momento, a partir do dado atual do elemento. */
    public bind<E extends Element, D, P extends BaseType>(selection: Selection<E, D, P, unknown>, content: (d: D, e: MouseEvent) => TooltipContent | undefined): void {
        selection
            .on("mouseenter.cvtooltip mousemove.cvtooltip", (e: Event, d: D) => this.show(e as MouseEvent, content(d, e as MouseEvent)))
            .on("mouseleave.cvtooltip", () => this.hide());
    }
}
