"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import { DARK, MUTED, PRIMARY } from "../../common/src/colors";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

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
const text = (name: string, displayName: string, placeholder = "", description?: string): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value: "", placeholder, description });

export const INTERPOLATION_ITEMS = enumItems(
    ["auto", "Automática (degrau no eixo inteiro)"], ["stepAfter", "Degrau após o ponto"], ["linear", "Reta"], ["smooth", "Suave"]
);
export const LINE_STYLE_ITEMS = enumItems(["solid", "Contínua"], ["dashed", "Tracejada"], ["dotted", "Pontilhada"]);
export const REF_STYLE_ITEMS = enumItems(["dashed", "Tracejada"], ["solid", "Contínua"], ["dotted", "Pontilhada"]);
export const LOW_STYLE_ITEMS = enumItems(["dashed", "Tracejado"], ["faded", "Esmaecido"], ["hidden", "Oculto"]);
export const WINDOW_SOURCE_ITEMS = enumItems(["field", "Campo Destaque"], ["fixed", "Intervalo fixo (início–fim)"]);
export const LEGEND_POS_ITEMS = enumItems(["top", "Em cima"], ["bottom", "Embaixo"], ["right", "À direita"]);

class LinesCard extends FormattingSettingsCard {
    interpolation = dropdown("interpolation", "Interpolação", INTERPOLATION_ITEMS, 0);
    width = num("width", "Espessura (px)", 2);
    themeColors = toggle("themeColors", "Cores do tema do relatório", true);
    highlightSeries = text("highlightSeries", "Série em destaque", "Nome da série", "As demais séries ficam esmaecidas.");
    othersOpacity = num("othersOpacity", "Opacidade das demais séries (%)", 25);
    maxSeries = num("maxSeries", "Máximo de séries visíveis", 5);
    showPoints = toggle("showPoints", "Mostrar pontos", false);
    showMarks = toggle("showMarks", "Mostrar marcas (campo Marcas)", true);
    markSize = num("markSize", "Tamanho das marcas (px)", 6);
    dimOpacity = num("dimOpacity", "Opacidade do que não está selecionado (%)", 30);
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });

    name = "lines";
    displayName = "Linhas";
    slices: FormattingSettingsSlice[] = [
        this.interpolation, this.width, this.themeColors, this.highlightSeries, this.othersOpacity, this.maxSeries,
        this.showPoints, this.showMarks, this.markSize, this.dimOpacity, this.fontFamily
    ];
}

class BandCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    opacity = num("opacity", "Opacidade (%)", 15);
    sameColor = toggle("sameColor", "Mesma cor da série", true);
    color = color("color", "Cor", MUTED);

    name = "band";
    displayName = "Faixa";
    slices: FormattingSettingsSlice[] = [this.show, this.opacity, this.sameColor, this.color];
}

class LowConfidenceCard extends FormattingSettingsCard {
    style = dropdown("style", "Estilo", LOW_STYLE_ITEMS, 0);
    threshold = num("threshold", "Limiar constante (Confiança < limiar)", 1, "Usado quando o campo Limiar de confiança está vazio.");
    legendText = text("legendText", "Texto explicativo na legenda", "Baixa confiança");
    showInLegend = toggle("showInLegend", "Mostrar na legenda", true);

    name = "lowConfidence";
    displayName = "Baixa confiança";
    slices: FormattingSettingsSlice[] = [this.style, this.threshold, this.legendText, this.showInLegend];
}

class WindowsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    source = dropdown("source", "Fonte", WINDOW_SOURCE_ITEMS, 0);
    start = text("start", "Início (X)", "ex.: 3");
    end = text("end", "Fim (X)", "ex.: 8");
    color = color("color", "Cor", PRIMARY);
    opacity = num("opacity", "Opacidade (%)", 18);
    label = text("label", "Rótulo", "ex.: Janela crítica");

    name = "windows";
    displayName = "Janelas destacadas";
    slices: FormattingSettingsSlice[] = [this.show, this.source, this.start, this.end, this.color, this.opacity, this.label];
}

class MilestonesCard extends FormattingSettingsCard {
    values = text("values", "Valores de X (separados por ;)", "3;6;12;18");
    showLines = toggle("showLines", "Linhas verticais", true);
    showLabels = toggle("showLabels", "Rótulo do valor no ponto", true);
    showTable = toggle("showTable", "Tabela de marcos abaixo do gráfico", false);
    color = color("color", "Cor das linhas", MUTED);
    fontSize = num("fontSize", "Tamanho da fonte", 11);

    name = "milestones";
    displayName = "Marcos";
    slices: FormattingSettingsSlice[] = [this.values, this.showLines, this.showLabels, this.showTable, this.color, this.fontSize];
}

class ReferenceCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    useConstant = toggle("useConstant", "Usar constante quando o campo Referência estiver vazio", false);
    constant = num("constant", "Valor constante", 0);
    label = text("label", "Rótulo", "Nome da medida");
    showValue = toggle("showValue", "Valor formatado no rótulo", true);
    color = color("color", "Cor", DARK);
    style = dropdown("style", "Estilo da linha", REF_STYLE_ITEMS, 0);
    width = num("width", "Espessura (px)", 1.5);

    name = "reference";
    displayName = "Referência";
    slices: FormattingSettingsSlice[] = [
        this.show, this.useConstant, this.constant, this.label, this.showValue, this.color, this.style, this.width
    ];
}

class AxisCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    title = toggle("title", "Título", false);
    titleText = text("titleText", "Texto do título", "Nome do campo");
    startAtZero = toggle("startAtZero", "Começar em zero", true);
    min = text("min", "Mínimo", "Automático");
    max = text("max", "Máximo", "Automático");
    grid = toggle("grid", "Linhas de grade", true);
    gridColor = color("gridColor", "Cor da grade", DARK);
    gridOpacity = num("gridOpacity", "Opacidade da grade (%)", 12);
    fontSize = num("fontSize", "Tamanho da fonte", 11);
    fontColor = color("fontColor", "Cor do texto", MUTED);

    constructor(public name: string, public displayName: string, isX: boolean) {
        super();
        this.grid.value = !isX;
        this.slices = isX
            ? [this.show, this.title, this.titleText, this.min, this.max, this.grid, this.gridColor, this.gridOpacity, this.fontSize, this.fontColor]
            : [this.show, this.title, this.titleText, this.startAtZero, this.min, this.max, this.grid, this.gridColor, this.gridOpacity,
                this.fontSize, this.fontColor];
    }

    slices: FormattingSettingsSlice[] = [];
}

class LabelsCard extends FormattingSettingsCard {
    endValue = toggle("endValue", "Valor no fim de cada curva", false);
    endName = toggle("endName", "Nome da série no fim (substitui a legenda até 4 séries)", false);
    fontSize = num("fontSize", "Tamanho da fonte", 11);
    color = color("color", "Cor do texto", DARK);
    useSeriesColor = toggle("useSeriesColor", "Usar a cor da série", true);

    name = "labels";
    displayName = "Rótulos";
    slices: FormattingSettingsSlice[] = [this.endValue, this.endName, this.fontSize, this.color, this.useSeriesColor];
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
    linesCard = new LinesCard();
    bandCard = new BandCard();
    lowConfidenceCard = new LowConfidenceCard();
    windowsCard = new WindowsCard();
    milestonesCard = new MilestonesCard();
    referenceCard = new ReferenceCard();
    xAxisCard = new AxisCard("xAxis", "Eixo X", true);
    yAxisCard = new AxisCard("yAxis", "Eixo Y", false);
    labelsCard = new LabelsCard();
    legendCard = new LegendCard();

    cards: Array<formattingSettings.Cards> = [
        this.linesCard, this.bandCard, this.lowConfidenceCard, this.windowsCard, this.milestonesCard, this.referenceCard,
        this.xAxisCard, this.yAxisCard, this.labelsCard, this.legendCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
