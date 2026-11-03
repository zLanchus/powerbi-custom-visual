"use strict";

import powerbi from "powerbi-visuals-api";

import IVisualHost = powerbi.extensibility.visual.IVisualHost;

/** Texto da interface (stringResources) com substituição de {0}, {1}… */
export type Strings = (key: string, ...args: Array<string | number>) => string;

export function createStrings(host: IVisualHost): Strings {
    let manager: powerbi.extensibility.ILocalizationManager | undefined;
    try {
        manager = host.createLocalizationManager?.();
    } catch {
        manager = undefined;
    }
    return (key, ...args) => {
        let text = manager?.getDisplayName(key) || key;
        args.forEach((arg, i) => {
            text = text.split(`{${i}}`).join(String(arg));
        });
        return text;
    };
}
