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
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

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

const LAYOUT_ITEMS = enumItems(["auto", "Automático"], ["horizontal", "Lado a lado"], ["vertical", "Empilhado"]);
const UNIT_ITEMS = enumItems(["none", "Nenhuma"], ["auto", "Automático"], ["k", "Mil"], ["m", "Milhões"], ["b", "Bilhões"]);
const ALIGN_ITEMS = enumItems(["center", "Centro"], ["left", "Esquerda"]);
const MODE_ITEMS = enumItems(
    ["diff", "Diferença (principal − comparação)"],
    ["variation", "Variação % ((principal ÷ comparação) − 1)"],
    ["both", "Diferença e variação %"],
    ["value", "Só o valor da comparação"]
);
const LABEL_POS_ITEMS = enumItems(["right", "À direita"], ["left", "À esquerda"]);

class CardSettings extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    layout = dropdown("layout", "Disposição", LAYOUT_ITEMS, 0);
    background = color("background", "Cor de fundo", "#FFFFFF");
    radius = num("radius", "Arredondamento (px)", 16);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", "#E4EDF5");
    padding = num("padding", "Espaço interno (px)", 14);
    gap = num("gap", "Espaço entre as partes (px)", 24);

    name = "card";
    displayName = "Card";
    slices: FormattingSettingsSlice[] = [
        this.fontFamily, this.layout, this.background, this.radius, this.borderWidth, this.borderColor, this.padding, this.gap
    ];
}

class MainSettings extends FormattingSettingsCard {
    title = text("title", "Título", "", "Nome da medida", "Vazio = nome da medida principal.");
    titleSize = num("titleSize", "Tamanho do título", 15);
    titleUpper = toggle("titleUpper", "Título em maiúsculas", true);
    periodSize = num("periodSize", "Tamanho do período", 12);
    periodUpper = toggle("periodUpper", "Período em maiúsculas", true);
    valueSize = num("valueSize", "Tamanho do valor", 40);
    displayUnits = dropdown("displayUnits", "Unidades de exibição", UNIT_ITEMS, 0);
    fill = color("fill", "Cor de fundo", DARK);
    titleColor = color("titleColor", "Cor do título", "#FFFFFF");
    periodColor = color("periodColor", "Cor do período", PRIMARY);
    valueColor = color("valueColor", "Cor do valor", "#FFFFFF");
    width = num("width", "Largura (% do card, lado a lado)", 32);
    radius = num("radius", "Arredondamento (px)", 14);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);

    name = "main";
    displayName = "Valor principal";
    slices: FormattingSettingsSlice[] = [
        this.title, this.titleSize, this.titleUpper, this.periodSize, this.periodUpper, this.valueSize, this.displayUnits,
        this.fill, this.titleColor, this.periodColor, this.valueColor, this.width, this.radius, this.align
    ];
}

class ComparisonSettings extends FormattingSettingsCard {
    mode = dropdown("mode", "Mostrar", MODE_ITEMS, 0);
    showValue = toggle("showValue", "Mostrar o valor da comparação entre parênteses", true);
    showSign = toggle("showSign", "Sinal de + nos positivos", true);
    showArrow = toggle("showArrow", "Mostrar seta (▲ ▼)", true);
    higherIsBetter = toggle("higherIsBetter", "Maior é melhor", true);
    colorByResult = toggle("colorByResult", "Colorir pelo resultado (bom / ruim)", true);
    positiveColor = color("positiveColor", "Cor quando é bom", "#2E8B57");
    negativeColor = color("negativeColor", "Cor quando é ruim", "#D64545");
    neutralColor = color("neutralColor", "Cor quando é igual", MUTED);
    valueSize = num("valueSize", "Tamanho do resultado", 18);
    valueColor = color("valueColor", "Cor do resultado (sem colorir pelo resultado)", DARK);
    labelPosition = dropdown("labelPosition", "Posição do nome", LABEL_POS_ITEMS, 0);
    labelSize = num("labelSize", "Tamanho do nome", 15);
    labelColor = color("labelColor", "Cor do nome", DARK);
    labelBold = toggle("labelBold", "Nome em negrito", false);
    emptyText = text("emptyText", "Texto quando a comparação está vazia", "Não definido", "Não definido",
        "Use {nome} para o nome da comparação. Ex.: \"{nome} não definida\".");
    emptyColor = color("emptyColor", "Cor do texto vazio", "#8FA7BC");
    dividers = toggle("dividers", "Linhas entre as comparações", false);
    dividerColor = color("dividerColor", "Cor das linhas", "#E4EDF5");

    name = "comparisons";
    displayName = "Comparações";
    slices: FormattingSettingsSlice[] = [
        this.mode, this.showValue, this.showSign, this.showArrow, this.higherIsBetter, this.colorByResult,
        this.positiveColor, this.negativeColor, this.neutralColor, this.valueSize, this.valueColor,
        this.labelPosition, this.labelSize, this.labelColor, this.labelBold, this.emptyText, this.emptyColor,
        this.dividers, this.dividerColor
    ];
}

class DetailSettings extends FormattingSettingsCard {
    size = num("size", "Tamanho", 30);
    color = color("color", "Cor", DARK);
    lineColor = color("lineColor", "Cor do traço", DARK);
    bold = toggle("bold", "Negrito", true);

    name = "details";
    displayName = "Detalhes (à direita)";
    slices: FormattingSettingsSlice[] = [this.size, this.color, this.lineColor, this.bold];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cardCard = new CardSettings();
    mainCard = new MainSettings();
    comparisonCard = new ComparisonSettings();
    detailCard = new DetailSettings();

    cards: Array<formattingSettings.Cards> = [this.cardCard, this.mainCard, this.comparisonCard, this.detailCard];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
