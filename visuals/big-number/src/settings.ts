"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** Cores padrão do repositório (ver DESIGN.md na raiz). */
export const PRIMARY = "#6CBEEB";
export const DARK = "#0F2B45";
export const PANEL = "#F1F8FD";
export const MUTED = "#4E6175";
const SOFT = "#8FA7BC";
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/** Quantidade máxima de comparações (cada uma tem seu campo e seu cartão de formatação). */
export const MAX_COMPARISONS = 3;

const enumItems = (...pairs: Array<[string, string]>): powerbi.IEnumMember[] =>
    pairs.map(([value, displayName]) => ({ value, displayName }));

const color = (name: string, displayName: string, value: string): formattingSettings.ColorPicker =>
    new formattingSettings.ColorPicker({ name, displayName, value: { value } });
const num = (name: string, displayName: string, value: number, description?: string): formattingSettings.NumUpDown =>
    new formattingSettings.NumUpDown({ name, displayName, value, description });
const toggle = (name: string, displayName: string, value: boolean): formattingSettings.ToggleSwitch =>
    new formattingSettings.ToggleSwitch({ name, displayName, value });
const dropdown = (name: string, displayName: string, items: powerbi.IEnumMember[], index = 0): formattingSettings.ItemDropdown =>
    new formattingSettings.ItemDropdown({ name, displayName, items, value: items[index] });
const text = (name: string, displayName: string, value: string, placeholder: string, description?: string): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value, placeholder, description });

const ALIGN_ITEMS = enumItems(["left", "Esquerda"], ["center", "Centro"], ["right", "Direita"]);
const VALIGN_ITEMS = enumItems(["center", "Centro"], ["top", "Topo"]);
const UNIT_ITEMS = enumItems(["auto", "Automático"], ["none", "Nenhuma"], ["k", "Mil"], ["m", "Milhões"], ["b", "Bilhões"]);
const DECIMAL_ITEMS = enumItems(["auto", "Automático"], ["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"]);
const COUNT_ITEMS = enumItems(["0", "Nenhuma"], ["1", "1"], ["2", "2"], ["3", "3"]);
const COMP_LAYOUT_ITEMS = enumItems(["stacked", "Empilhadas"], ["side", "Lado a lado"]);
const COMP_STYLE_ITEMS = enumItems(["pill", "Selo (fundo suave)"], ["text", "Só o texto colorido"]);
const DIRECTION_ITEMS = enumItems(["up", "Melhor para cima (maior é melhor)"], ["down", "Melhor para baixo (menor é melhor)"],
    ["none", "Neutro (sem bom / ruim)"]);
const DIFF_UNIT_ITEMS = enumItems(
    ["pct", "Variação % ((atual ÷ anterior) − 1)"],
    ["abs", "Absoluta (no formato da medida)"],
    ["pp", "Pontos percentuais (p.p.)"]
);

class CardSettings extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);
    verticalAlign = dropdown("verticalAlign", "Alinhamento vertical", VALIGN_ITEMS, 0);
    background = color("background", "Cor de fundo", "#FFFFFF");
    radius = num("radius", "Arredondamento (px)", 14);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", "#E4EDF5");
    padding = num("padding", "Espaço interno (px)", 16);
    gap = num("gap", "Espaço entre as partes (px)", 8);
    accent = toggle("accent", "Faixa de destaque à esquerda", true);
    accentColor = color("accentColor", "Cor da faixa", PRIMARY);
    accentWidth = num("accentWidth", "Largura da faixa (px)", 6);

    name = "card";
    displayName = "Card";
    slices: FormattingSettingsSlice[] = [
        this.fontFamily, this.align, this.verticalAlign, this.background, this.radius, this.borderWidth, this.borderColor,
        this.padding, this.gap, this.accent, this.accentColor, this.accentWidth
    ];
}

class TitleSettings extends FormattingSettingsCard {
    show = toggle("show", "Mostrar título", true);
    text = text("text", "Texto do título", "", "Nome da medida", "Vazio = nome da medida do Big Number.");
    size = num("size", "Tamanho", 14);
    color = color("color", "Cor", MUTED);
    bold = toggle("bold", "Negrito", true);
    upper = toggle("upper", "Maiúsculas", false);
    subtitle = text("subtitle", "Subtítulo", "", "Opcional", "Texto pequeno abaixo do título (ex.: período, unidade).");
    subtitleSize = num("subtitleSize", "Tamanho do subtítulo", 11);
    subtitleColor = color("subtitleColor", "Cor do subtítulo", SOFT);

    name = "title";
    displayName = "Título";
    slices: FormattingSettingsSlice[] = [
        this.show, this.text, this.size, this.color, this.bold, this.upper, this.subtitle, this.subtitleSize, this.subtitleColor
    ];
}

class ValueSettings extends FormattingSettingsCard {
    size = num("size", "Tamanho", 44);
    color = color("color", "Cor", DARK);
    bold = toggle("bold", "Negrito", true);
    displayUnits = dropdown("displayUnits", "Unidades de exibição", UNIT_ITEMS, 0);
    decimals = dropdown("decimals", "Casas decimais", DECIMAL_ITEMS, 0);

    name = "value";
    displayName = "Big Number";
    slices: FormattingSettingsSlice[] = [this.size, this.color, this.bold, this.displayUnits, this.decimals];
}

class ComparisonsSettings extends FormattingSettingsCard {
    count = dropdown("count", "Quantidade de comparações", COUNT_ITEMS, 3);
    layout = dropdown("layout", "Disposição", COMP_LAYOUT_ITEMS, 0);
    style = dropdown("style", "Estilo da diferença", COMP_STYLE_ITEMS, 0);
    showArrow = toggle("showArrow", "Mostrar seta (▲ ▼)", true);
    showSign = toggle("showSign", "Sinal de + nos positivos", true);
    goodColor = color("goodColor", "Cor quando é bom", "#2E8B57");
    badColor = color("badColor", "Cor quando é ruim", "#D64545");
    neutralColor = color("neutralColor", "Cor quando é neutro / igual", MUTED);
    resultSize = num("resultSize", "Tamanho da diferença", 14);
    labelSize = num("labelSize", "Tamanho do nome", 12);
    labelColor = color("labelColor", "Cor do nome", MUTED);
    previousTemplate = text("previousTemplate", "Texto do valor anterior", "({valor})", "({valor})",
        "Use {valor} para o valor da comparação. Ex.: \"Anterior: {valor}\".");
    previousColor = color("previousColor", "Cor do valor anterior", SOFT);
    emptyText = text("emptyText", "Texto quando a comparação está vazia", "Sem dado", "Sem dado");
    dividers = toggle("dividers", "Linhas entre as comparações", false);
    dividerColor = color("dividerColor", "Cor das linhas", "#E4EDF5");

    name = "comparisons";
    displayName = "Comparações";
    slices: FormattingSettingsSlice[] = [
        this.count, this.layout, this.style, this.showArrow, this.showSign, this.goodColor, this.badColor, this.neutralColor,
        this.resultSize, this.labelSize, this.labelColor, this.previousTemplate, this.previousColor, this.emptyText,
        this.dividers, this.dividerColor
    ];
}

/** Opções de uma comparação (Comparação 1, 2 e 3). */
export class ComparisonItemSettings extends FormattingSettingsCard {
    label = text("label", "Título da comparação", "", "Nome da medida", "Vazio = nome da medida. Ex.: \"vs mês anterior\".");
    direction = dropdown("direction", "Melhor para", DIRECTION_ITEMS, 0);
    unit = dropdown("unit", "Unidade da diferença", DIFF_UNIT_ITEMS, 0);
    decimals = dropdown("decimals", "Casas decimais da diferença", DECIMAL_ITEMS, 0);
    showPrevious = toggle("showPrevious", "Mostrar o valor anterior", true);

    name = "";
    displayName = "";
    slices: FormattingSettingsSlice[] = [this.label, this.direction, this.unit, this.decimals, this.showPrevious];

    constructor(index: number) {
        super();
        this.name = `comparison${index}`;
        this.displayName = `Comparação ${index}`;
    }
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cardCard = new CardSettings();
    titleCard = new TitleSettings();
    valueCard = new ValueSettings();
    comparisonsCard = new ComparisonsSettings();
    comparisonItems = [1, 2, 3].map(i => new ComparisonItemSettings(i));

    cards: Array<formattingSettings.Cards> = [
        this.cardCard, this.titleCard, this.valueCard, this.comparisonsCard, ...this.comparisonItems
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");

/** "auto" → undefined; "0".."3" → número de casas. */
export const decimalsValue = (slice: formattingSettings.ItemDropdown): number | undefined => {
    const v = enumValue(slice);
    return v === "auto" || v === "" ? undefined : Number(v);
};
