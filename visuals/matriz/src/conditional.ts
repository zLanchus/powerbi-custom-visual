"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";

import DataViewObjects = powerbi.DataViewObjects;
import PrimitiveValue = powerbi.PrimitiveValue;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;

import { Measure } from "./model";

export type FormatMode = "none" | "gradient" | "rules";
export type FormatTarget = "background" | "font";
type Operator = "none" | "gt" | "gte" | "lt" | "lte" | "eq";

export interface Rule {
    op: Operator;
    value: number;
    color: string;
}

/** Configuração de formatação condicional de uma medida exibida. */
export interface MeasureFormat {
    mode: FormatMode;
    /** queryName da medida usada como base (padrão: a própria). */
    basis: string;
    target: FormatTarget;
    minColor: string;
    maxColor: string;
    applyToTotals: boolean;
    rules: Rule[];
    /** Cores fixas (ou definidas por regra "fx" do Power BI) aplicadas à coluna inteira. */
    fill: string;
    fontColor: string;
}

const OBJECT = "cellFormat";

const MODE_ITEMS: powerbi.IEnumMember[] = [
    { value: "none", displayName: "Nenhuma" },
    { value: "gradient", displayName: "Escala de cores" },
    { value: "rules", displayName: "Regras" }
];
const TARGET_ITEMS: powerbi.IEnumMember[] = [
    { value: "background", displayName: "Cor de fundo" },
    { value: "font", displayName: "Cor da fonte" }
];
const OP_ITEMS: powerbi.IEnumMember[] = [
    { value: "none", displayName: "(desligada)" },
    { value: "gt", displayName: "Maior que" },
    { value: "gte", displayName: "Maior ou igual a" },
    { value: "lt", displayName: "Menor que" },
    { value: "lte", displayName: "Menor ou igual a" },
    { value: "eq", displayName: "Igual a" }
];
const RULE_DEFAULTS = ["#E5534B", "#F2B84B", "#3FAE6A"];

function prop<T>(objects: DataViewObjects | undefined, name: string, fallback: T): T {
    const value = objects?.[OBJECT]?.[name];
    return value === undefined || value === null ? fallback : value as T;
}

export function colorProp(objects: DataViewObjects | undefined, name: string, fallback = ""): string {
    const value = objects?.[OBJECT]?.[name] as { solid?: { color?: string } } | undefined;
    return value?.solid?.color || fallback;
}

export function readFormat(measure: Measure): MeasureFormat {
    const o = measure.source.objects;
    const rules: Rule[] = [1, 2, 3].map(r => ({
        op: prop<Operator>(o, `r${r}Op`, "none"),
        value: Number(prop<number>(o, `r${r}Value`, 0)),
        color: colorProp(o, `r${r}Color`, RULE_DEFAULTS[r - 1])
    }));
    return {
        mode: prop<FormatMode>(o, "mode", "none"),
        basis: prop<string>(o, "basis", measure.queryName),
        target: prop<FormatTarget>(o, "target", "background"),
        minColor: colorProp(o, "minColor", "#FFFFFF"),
        maxColor: colorProp(o, "maxColor", "#6CBEEB"),
        applyToTotals: prop<boolean>(o, "applyToTotals", false),
        rules,
        fill: colorProp(o, "fill"),
        fontColor: colorProp(o, "fontColor")
    };
}

// ------------------------------------------------------------------ cores

function hexToRgb(hex: string): [number, number, number] | undefined {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) {
        return undefined;
    }
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    if (!x || !y) {
        return t < 0.5 ? a : b;
    }
    const c = x.map((v, i) => Math.round(v + (y[i] - v) * Math.min(1, Math.max(0, t))));
    return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Cor de texto legível (escura ou branca) sobre um fundo. */
export function readableText(background: string, dark: string): string {
    const rgb = hexToRgb(background);
    if (!rgb) {
        return dark;
    }
    const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4 ? dark : "#FFFFFF";
}

export function toNumber(value: PrimitiveValue | undefined): number | undefined {
    if (typeof value === "number" && isFinite(value)) {
        return value;
    }
    return undefined;
}

export function ruleColor(rules: Rule[], value: number): string | undefined {
    for (const rule of rules) {
        const ok = rule.op === "gt" ? value > rule.value
            : rule.op === "gte" ? value >= rule.value
                : rule.op === "lt" ? value < rule.value
                    : rule.op === "lte" ? value <= rule.value
                        : rule.op === "eq" ? value === rule.value
                            : false;
        if (ok) {
            return rule.color;
        }
    }
    return undefined;
}

// ------------------------------------------------------- painel de formatação

/**
 * Cartão "Formatação condicional": um grupo por medida exibida. Os valores
 * ficam gravados na própria medida (seletor por queryName), como na matriz nativa.
 */
export function buildFormatCard(measures: Measure[]): formattingSettings.CompositeCard {
    const shown = measures.filter(m => m.section > 0);
    const basisItems: powerbi.IEnumMember[] = measures.map(m => ({
        value: m.queryName,
        displayName: m.section > 0 ? m.name : m.name + " (apoio)"
    }));

    const groups = shown.map(measure => {
        const f = readFormat(measure);
        const selector = { metadata: measure.queryName };
        // Regras "fx" avaliadas em cada célula (linha × coluna) desta medida.
        const cellSelector = {
            ...dataViewWildcard.createDataViewWildcardSelector(dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals),
            metadata: measure.queryName
        };
        const pick = (items: powerbi.IEnumMember[], value: string): powerbi.IEnumMember =>
            items.find(i => i.value === value) || items[0];

        const slices: formattingSettings.Slice[] = [];

        // Cores com o botão "fx" do Power BI (regras, escala ou valor de campo, avaliadas por célula).
        slices.push(new formattingSettings.ColorPicker({
            name: "fill",
            displayName: "Cor de fundo (fx)",
            description: "Use o botão fx para formatar pelo valor de qualquer campo, como na matriz nativa.",
            value: { value: f.fill },
            selector: cellSelector,
            altConstantSelector: selector,
            instanceKind: VisualEnumerationInstanceKinds.ConstantOrRule
        }));
        slices.push(new formattingSettings.ColorPicker({
            name: "fontColor",
            displayName: "Cor da fonte (fx)",
            value: { value: f.fontColor },
            selector: cellSelector,
            altConstantSelector: selector,
            instanceKind: VisualEnumerationInstanceKinds.ConstantOrRule
        }));

        // Formatação embutida: escala de cores ou regras, baseada em qualquer medida do visual.
        slices.push(new formattingSettings.ItemDropdown({
            name: "mode", displayName: "Formatação rápida", items: MODE_ITEMS, value: pick(MODE_ITEMS, f.mode), selector
        }));
        if (f.mode !== "none") {
            slices.push(new formattingSettings.ItemDropdown({
                name: "basis", displayName: "Basear na medida", items: basisItems, value: pick(basisItems, f.basis), selector
            }));
            slices.push(new formattingSettings.ItemDropdown({
                name: "target", displayName: "Aplicar em", items: TARGET_ITEMS, value: pick(TARGET_ITEMS, f.target), selector
            }));
            slices.push(new formattingSettings.ToggleSwitch({
                name: "applyToTotals", displayName: "Aplicar também a totais e subtotais", value: f.applyToTotals, selector
            }));
        }
        if (f.mode === "gradient") {
            slices.push(new formattingSettings.ColorPicker({ name: "minColor", displayName: "Cor do menor valor", value: { value: f.minColor }, selector }));
            slices.push(new formattingSettings.ColorPicker({ name: "maxColor", displayName: "Cor do maior valor", value: { value: f.maxColor }, selector }));
        }
        if (f.mode === "rules") {
            f.rules.forEach((rule, k) => {
                const r = k + 1;
                slices.push(new formattingSettings.ItemDropdown({
                    name: `r${r}Op`, displayName: `Regra ${r}: condição`, items: OP_ITEMS, value: pick(OP_ITEMS, rule.op), selector
                }));
                slices.push(new formattingSettings.NumUpDown({
                    name: `r${r}Value`, displayName: `Regra ${r}: valor`, value: rule.value, selector,
                    description: "Para porcentagens, use o valor decimal (15% = 0,15)."
                }));
                slices.push(new formattingSettings.ColorPicker({
                    name: `r${r}Color`, displayName: `Regra ${r}: cor`, value: { value: rule.color }, selector
                }));
            });
        }

        return new formattingSettings.Group({
            name: "cf_" + measure.index,
            displayName: measure.name,
            slices
        });
    });

    class FormatCard extends formattingSettings.CompositeCard {
        name = OBJECT;
        displayName = "Formatação condicional";
        groups = groups;
    }
    return new FormatCard();
}
