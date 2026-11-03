"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import { ACCENT, DARK, DATA_BLUE, MUTED, PANEL } from "../../common/src/colors";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";
/** Ponta escura do gradiente: azul-marinho do padrão; ponta clara: painel claro (ver DESIGN.md). */
export const GRADIENT_MIN = PANEL;

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
const text = (name: string, displayName: string, placeholder = ""): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value: "", placeholder });

export const ORIENTATION_ITEMS = enumItems(["vertical", "Vertical"], ["horizontal", "Horizontal"]);
export const RULE_ITEMS = enumItems(
    ["none", "Nenhuma"], ["aboveBelow", "Acima/abaixo da referência"], ["flag", "Por Sinalizador"], ["gradient", "Gradiente pelo valor"]
);
export const SHAPE_ITEMS = enumItems(["circle", "Círculo vazado"], ["dash", "Traço"], ["diamond", "Losango"]);
export const LINE_STYLE_ITEMS = enumItems(["dashed", "Tracejada"], ["solid", "Contínua"], ["dotted", "Pontilhada"]);
export const LOW_STYLE_ITEMS = enumItems(["hatched", "Cinza hachurado"], ["faded", "Esmaecido"]);
export const SORT_ITEMS = enumItems(
    ["model", "Ordem do modelo"], ["desc", "Valor decrescente"], ["asc", "Valor crescente"], ["alpha", "Alfabética"]
);
export const LABEL_POS_ITEMS = enumItems(["end", "Fim da barra"], ["inside", "Dentro da barra"]);
export const LEGEND_POS_ITEMS = enumItems(["top", "Em cima"], ["bottom", "Embaixo"]);

class LayoutCard extends FormattingSettingsCard {
    orientation = dropdown("orientation", "Orientação", ORIENTATION_ITEMS, 0);
    cardMode = toggle("cardMode", "Modo cartão (sem eixos: rótulo, barra fina, valor)", false);
    gap = num("gap", "Espaço entre barras (%)", 30, "Porcentagem da faixa de cada categoria.");
    radius = num("radius", "Arredondamento (px)", 3);
    labelWidth = num("labelWidth", "Largura dos rótulos (%, horizontal e cartão)", 32);
    cardBarHeight = num("cardBarHeight", "Espessura da barra no modo cartão (px)", 8);
    dimOpacity = num("dimOpacity", "Opacidade do que não está selecionado (%)", 35);
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });

    name = "layout";
    displayName = "Layout";
    slices: FormattingSettingsSlice[] = [
        this.orientation, this.cardMode, this.gap, this.radius, this.labelWidth, this.cardBarHeight, this.dimOpacity, this.fontFamily
    ];
}

class ColorRuleCard extends FormattingSettingsCard {
    rule = dropdown("rule", "Regra", RULE_ITEMS, 0);
    warning = new formattingSettings.ReadOnlyText({ name: "warning", displayName: "", value: "" });
    normalColor = color("normalColor", "Cor padrão", DATA_BLUE);
    aboveColor = color("aboveColor", "Acima da referência", ACCENT);
    belowColor = color("belowColor", "Abaixo da referência", DATA_BLUE);
    flagColor = color("flagColor", "Sinalizador (tem prioridade)", DARK);
    gradientMin = color("gradientMin", "Gradiente: menor valor", GRADIENT_MIN);
    gradientMax = color("gradientMax", "Gradiente: maior valor", DARK);
    themeColors = toggle("themeColors", "Séries com as cores do tema", true);

    name = "colorRule";
    displayName = "Regra de cor";
    slices: FormattingSettingsSlice[] = [
        this.rule, this.warning, this.normalColor, this.aboveColor, this.belowColor, this.flagColor,
        this.gradientMin, this.gradientMax, this.themeColors
    ];
}

class MarkerGroup extends formattingSettings.Group {
    shape: formattingSettings.ItemDropdown;
    size: formattingSettings.NumUpDown;
    color: formattingSettings.ColorPicker;
    showLabel: formattingSettings.ToggleSwitch;

    constructor(n: number, defaultColor: string, shapeIndex: number) {
        const shape = dropdown(`shape${n}`, "Forma", SHAPE_ITEMS, shapeIndex);
        const size = num(`size${n}`, "Tamanho (px)", 10);
        const markerColor = color(`color${n}`, "Cor", defaultColor);
        const showLabel = toggle(`showLabel${n}`, "Mostrar rótulo", false);
        super({
            name: `marker${n}`,
            displayName: `Comparação ${n}`,
            slices: [shape, size, markerColor, showLabel]
        });
        this.shape = shape;
        this.size = size;
        this.color = markerColor;
        this.showLabel = showLabel;
    }
}

class MarkersCard extends formattingSettings.CompositeCard {
    marker1 = new MarkerGroup(1, DARK, 0);
    marker2 = new MarkerGroup(2, MUTED, 2);

    name = "markers";
    displayName = "Marcadores";
    groups: formattingSettings.Group[] = [this.marker1, this.marker2];
}

class ReferenceCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    useConstant = toggle("useConstant", "Usar constante quando o campo Referência estiver vazio", false);
    constant = num("constant", "Valor constante", 0);
    label = text("label", "Rótulo", "Nome da medida");
    showValue = toggle("showValue", "Valor formatado no rótulo", true);
    color = color("color", "Cor", DARK);
    style = dropdown("style", "Estilo da linha", LINE_STYLE_ITEMS, 0);
    width = num("width", "Espessura (px)", 1.5);

    name = "reference";
    displayName = "Referência";
    slices: FormattingSettingsSlice[] = [
        this.show, this.useConstant, this.constant, this.label, this.showValue, this.color, this.style, this.width
    ];
}

class LowConfidenceCard extends FormattingSettingsCard {
    style = dropdown("style", "Estilo", LOW_STYLE_ITEMS, 0);
    threshold = num("threshold", "Limiar constante (Confiança < limiar)", 1, "Usado quando o campo Limiar de confiança está vazio.");
    color = color("color", "Cor (cinza hachurado)", MUTED);
    legendText = text("legendText", "Texto na legenda", "Baixa confiança");
    showInLegend = toggle("showInLegend", "Mostrar na legenda", true);

    name = "lowConfidence";
    displayName = "Baixa confiança";
    slices: FormattingSettingsSlice[] = [this.style, this.threshold, this.color, this.legendText, this.showInLegend];
}

class SortCard extends FormattingSettingsCard {
    order = dropdown("order", "Ordem", SORT_ITEMS, 0);
    lowLast = toggle("lowLast", "Baixa confiança sempre no fim", false);

    name = "sort";
    displayName = "Ordenação";
    slices: FormattingSettingsSlice[] = [this.order, this.lowLast];
}

class TopNCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar só as N primeiras", false);
    count = num("count", "N", 10);

    name = "topN";
    displayName = "Top N";
    slices: FormattingSettingsSlice[] = [this.show, this.count];
}

class DataLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar valor", true);
    position = dropdown("position", "Posição", LABEL_POS_ITEMS, 0);
    autoHide = toggle("autoHide", "Esconder quando não couber", true);
    fontSize = num("fontSize", "Tamanho da fonte", 11);
    color = color("color", "Cor", DARK);
    bold = toggle("bold", "Negrito", true);

    name = "dataLabels";
    displayName = "Rótulos de dados";
    slices: FormattingSettingsSlice[] = [this.show, this.position, this.autoHide, this.fontSize, this.color, this.bold];
}

class AxesCard extends FormattingSettingsCard {
    showValueAxis = toggle("showValueAxis", "Mostrar eixo de valores", true);
    valueTitle = toggle("valueTitle", "Título do eixo de valores", false);
    valueTitleText = text("valueTitleText", "Texto do título (valores)", "Nome da medida");
    categoryTitle = toggle("categoryTitle", "Título do eixo de categorias", false);
    categoryTitleText = text("categoryTitleText", "Texto do título (categorias)", "Nome do campo");
    grid = toggle("grid", "Linhas de grade", true);
    gridColor = color("gridColor", "Cor da grade", DARK);
    gridOpacity = num("gridOpacity", "Opacidade da grade (%)", 12);
    fontSize = num("fontSize", "Tamanho da fonte dos eixos", 11);
    fontColor = color("fontColor", "Cor do texto dos eixos", MUTED);
    categoryFontSize = num("categoryFontSize", "Tamanho dos rótulos de categoria", 12);
    categoryColor = color("categoryColor", "Cor dos rótulos de categoria", DARK);
    extraFontSize = num("extraFontSize", "Tamanho do rótulo extra", 10);
    extraColor = color("extraColor", "Cor do rótulo extra", MUTED);

    name = "axes";
    displayName = "Eixos";
    slices: FormattingSettingsSlice[] = [
        this.showValueAxis, this.valueTitle, this.valueTitleText, this.categoryTitle, this.categoryTitleText,
        this.grid, this.gridColor, this.gridOpacity, this.fontSize, this.fontColor,
        this.categoryFontSize, this.categoryColor, this.extraFontSize, this.extraColor
    ];
}

class LegendCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    position = dropdown("position", "Posição", LEGEND_POS_ITEMS, 0);
    showTitle = toggle("showTitle", "Mostrar título", true);
    titleText = text("titleText", "Título", "Nome do campo Série");
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    fontColor = color("fontColor", "Cor do texto", DARK);

    name = "legend";
    displayName = "Legenda";
    slices: FormattingSettingsSlice[] = [this.show, this.position, this.showTitle, this.titleText, this.fontSize, this.fontColor];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layoutCard = new LayoutCard();
    colorRuleCard = new ColorRuleCard();
    markersCard = new MarkersCard();
    referenceCard = new ReferenceCard();
    lowConfidenceCard = new LowConfidenceCard();
    sortCard = new SortCard();
    topNCard = new TopNCard();
    dataLabelsCard = new DataLabelsCard();
    axesCard = new AxesCard();
    legendCard = new LegendCard();

    cards: Array<formattingSettings.Cards> = [
        this.layoutCard, this.colorRuleCard, this.markersCard, this.referenceCard, this.lowConfidenceCard,
        this.sortCard, this.topNCard, this.dataLabelsCard, this.axesCard, this.legendCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
