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
export const WHITE = "#FFFFFF";
export const MUTED = "#4E6175";
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/** Cores das séries (colunas e linhas), em tons da paleta do repositório. */
export const SERIES_PALETTE = [
    "#6CBEEB", "#0F2B45", "#A9DBF5", "#2E6A99", "#3E9BD1", "#D4ECFA",
    "#1B4A73", "#86CCF0", "#5C7E99", "#C2D8E8", "#24384D", "#9FB7CC"
];
/** As linhas começam pelo azul-marinho, para contrastar com as colunas azul-claro. */
export const LINE_PALETTE = ["#0F2B45", "#3E9BD1", "#5C7E99", "#1B4A73", "#86CCF0", "#24384D"];

const enumItems = (...pairs: Array<[string, string]>): powerbi.IEnumMember[] =>
    pairs.map(([value, displayName]) => ({ value, displayName }));

const color = (name: string, displayName: string, value: string): formattingSettings.ColorPicker =>
    new formattingSettings.ColorPicker({ name, displayName, value: { value } });
const num = (name: string, displayName: string, value: number, description?: string): formattingSettings.NumUpDown =>
    new formattingSettings.NumUpDown({ name, displayName, value, description });
const toggle = (name: string, displayName: string, value: boolean, description?: string): formattingSettings.ToggleSwitch =>
    new formattingSettings.ToggleSwitch({ name, displayName, value, description });
const dropdown = (name: string, displayName: string, items: powerbi.IEnumMember[], index = 0): formattingSettings.ItemDropdown =>
    new formattingSettings.ItemDropdown({ name, displayName, items, value: items[index] });
const text = (name: string, displayName: string, value: string, placeholder = "", description?: string): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value, placeholder, description });
const fontSize = (value: number, name = "fontSize", displayName = "Tamanho da fonte"): formattingSettings.NumUpDown =>
    num(name, displayName, value);

export const POSITION_ITEMS = enumItems(["top", "Em cima"], ["bottom", "Embaixo"]);
export const ALIGN_ITEMS = enumItems(["left", "À esquerda"], ["center", "No centro"], ["right", "À direita"]);
export const LINE_STYLE_ITEMS = enumItems(["solid", "Contínua"], ["dashed", "Tracejada"], ["dotted", "Pontilhada"]);
export const CURVE_ITEMS = enumItems(["linear", "Reta"], ["smooth", "Suave (curva)"], ["step", "Degraus"]);
export const MARKER_SHAPE_ITEMS = enumItems(["circle", "Círculo"], ["square", "Quadrado"], ["diamond", "Losango"]);
export const MARKER_FILL_ITEMS = enumItems(["hollow", "Vazado (centro branco)"], ["filled", "Cheio"]);
export const NULLS_ITEMS = enumItems(["gap", "Interromper a linha"], ["connect", "Ligar os pontos"], ["zero", "Tratar como zero"]);
export const ROTATION_ITEMS = enumItems(["auto", "Automática"], ["0", "Horizontal"], ["45", "Inclinada (45°)"], ["90", "Vertical"]);
export const UNITS_ITEMS = enumItems(
    ["auto", "Automático"], ["none", "Nenhuma"], ["1000", "Mil"], ["1000000", "Milhões"], ["1000000000", "Bilhões"]
);
export const GRID_STYLE_ITEMS = enumItems(["solid", "Contínua"], ["dashed", "Tracejada"], ["dotted", "Pontilhada"]);
export const COLUMN_LABEL_POSITION_ITEMS = enumItems(["center", "No centro"], ["insideEnd", "Dentro, no topo"], ["insideBase", "Dentro, na base"]);
export const LINE_LABEL_POSITION_ITEMS = enumItems(["above", "Acima do ponto"], ["below", "Abaixo do ponto"]);
export const LINE_LABEL_POINTS_ITEMS = enumItems(
    ["all", "Todos os pontos"], ["last", "Só o último"], ["minmax", "Maior e menor"], ["ends", "Primeiro e último"]
);
export const TOOLTIP_MODE_ITEMS = enumItems(["category", "Todos os valores da categoria"], ["item", "Só o item sob o mouse"]);

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    animate = toggle("animate", "Animar ao mostrar e esconder", true);

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily, this.animate];
}

class HeaderCard extends FormattingSettingsCard {
    title = text("title", "Título", "", "Ex.: Receita e margem");
    titleSize = num("titleSize", "Tamanho do título", 18);
    titleColor = color("titleColor", "Cor do título", DARK);
    subtitle = text("subtitle", "Subtítulo", "", "Ex.: por mês");
    subtitleSize = num("subtitleSize", "Tamanho do subtítulo", 13);
    subtitleColor = color("subtitleColor", "Cor do subtítulo", MUTED);

    name = "header";
    displayName = "Cabeçalho";
    description = "Título e subtítulo dentro do visual (deixe em branco para esconder).";
    slices: FormattingSettingsSlice[] = [
        this.title, this.titleSize, this.titleColor, this.subtitle, this.subtitleSize, this.subtitleColor
    ];
}

class TogglesCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    position = dropdown("position", "Posição", POSITION_ITEMS, 0);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);
    groupButtons = toggle("groupButtons", "Botões Colunas / Linhas", true, "Mostram ou escondem todas as colunas ou todas as linhas de uma vez.");
    seriesChips = toggle("seriesChips", "Um botão por série", true, "Cada série da legenda vira um botão para mostrar ou esconder.");
    columnsLabel = text("columnsLabel", "Texto do botão de colunas", "Colunas", "Colunas");
    linesLabel = text("linesLabel", "Texto do botão de linhas", "Linhas", "Linhas");
    startColumns = toggle("startColumns", "Colunas visíveis ao abrir", true);
    startLines = toggle("startLines", "Linhas visíveis ao abrir", true);
    fontSize = fontSize(12);
    height = num("height", "Altura (px)", 30);
    radius = num("radius", "Arredondamento (px)", 999);
    background = color("background", "Cor de fundo", PANEL);
    fontColor = color("fontColor", "Cor do texto", DARK);
    activeBackground = color("activeBackground", "Fundo dos botões Colunas / Linhas ligados", PRIMARY);
    activeFontColor = color("activeFontColor", "Texto dos botões Colunas / Linhas ligados", DARK);
    hiddenOpacity = num("hiddenOpacity", "Opacidade do que está escondido (%)", 45);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);

    name = "toggles";
    displayName = "Legenda interativa";
    description = "Clique num botão para mostrar ou esconder a série no gráfico.";
    slices: FormattingSettingsSlice[] = [
        this.show, this.position, this.align, this.groupButtons, this.seriesChips, this.columnsLabel, this.linesLabel,
        this.startColumns, this.startLines, this.fontSize, this.height, this.radius, this.background, this.fontColor,
        this.activeBackground, this.activeFontColor, this.hiddenOpacity, this.borderWidth, this.borderColor
    ];
}

class ColumnsCard extends FormattingSettingsCard {
    spacing = num("spacing", "Espaço entre colunas (%)", 30, "Porcentagem da largura de cada categoria deixada vazia.");
    radius = num("radius", "Arredondamento do topo (px)", 4);
    opacity = num("opacity", "Opacidade (%)", 100);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", WHITE);

    name = "columns";
    displayName = "Colunas";
    slices: FormattingSettingsSlice[] = [this.spacing, this.radius, this.opacity, this.borderWidth, this.borderColor];
}

class LinesCard extends FormattingSettingsCard {
    width = num("width", "Espessura (px)", 3);
    style = dropdown("style", "Estilo", LINE_STYLE_ITEMS, 0);
    curve = dropdown("curve", "Traçado", CURVE_ITEMS, 1);
    showMarkers = toggle("showMarkers", "Mostrar marcadores", true);
    markerShape = dropdown("markerShape", "Forma do marcador", MARKER_SHAPE_ITEMS, 0);
    markerSize = num("markerSize", "Tamanho do marcador (px)", 4);
    markerFill = dropdown("markerFill", "Preenchimento do marcador", MARKER_FILL_ITEMS, 0);
    showArea = toggle("showArea", "Sombrear a área abaixo", false);
    areaOpacity = num("areaOpacity", "Opacidade da área (%)", 15);
    nulls = dropdown("nulls", "Valores vazios", NULLS_ITEMS, 0);

    name = "lines";
    displayName = "Linhas";
    slices: FormattingSettingsSlice[] = [
        this.width, this.style, this.curve, this.showMarkers, this.markerShape, this.markerSize, this.markerFill,
        this.showArea, this.areaOpacity, this.nulls
    ];
}

class XAxisCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    fontSize = fontSize(12);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    bold = toggle("bold", "Negrito", false);
    rotation = dropdown("rotation", "Rotação dos rótulos", ROTATION_ITEMS, 0);
    minWidth = num("minWidth", "Largura mínima da categoria (px)", 0, "0 = tudo cabe na largura do visual. Acima disso, aparece a rolagem horizontal.");
    showLine = toggle("showLine", "Mostrar linha do eixo", true);
    lineColor = color("lineColor", "Cor da linha do eixo", DARK);
    showTitle = toggle("showTitle", "Mostrar título", false);
    titleText = text("titleText", "Título", "", "Nome do campo");

    name = "xAxis";
    displayName = "Eixo X";
    slices: FormattingSettingsSlice[] = [
        this.show, this.fontSize, this.fontColor, this.bold, this.rotation, this.minWidth, this.showLine, this.lineColor,
        this.showTitle, this.titleText
    ];
}

class YAxisCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    fontSize = fontSize(11);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    min = text("min", "Mínimo", "", "Automático");
    max = text("max", "Máximo", "", "Automático");
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);
    showGrid = toggle("showGrid", "Linhas de grade", true);
    gridColor = color("gridColor", "Cor da grade", DARK);
    gridOpacity = num("gridOpacity", "Opacidade da grade (%)", 10);
    gridStyle = dropdown("gridStyle", "Estilo da grade", GRID_STYLE_ITEMS, 1);
    showTitle = toggle("showTitle", "Mostrar título", false);
    titleText = text("titleText", "Título", "", "Nome da medida");

    name = "yAxis";
    displayName = "Eixo Y (colunas)";
    slices: FormattingSettingsSlice[] = [
        this.show, this.fontSize, this.fontColor, this.min, this.max, this.units, this.decimals, this.showGrid,
        this.gridColor, this.gridOpacity, this.gridStyle, this.showTitle, this.titleText
    ];
}

class Y2AxisCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    sameScale = toggle("sameScale", "Usar a escala das colunas", false, "Linhas e colunas na mesma escala (sem eixo secundário).");
    fontSize = fontSize(11);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    min = text("min", "Mínimo", "", "Automático");
    max = text("max", "Máximo", "", "Automático");
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);
    showTitle = toggle("showTitle", "Mostrar título", false);
    titleText = text("titleText", "Título", "", "Nome da medida");

    name = "y2Axis";
    displayName = "Eixo Y secundário (linhas)";
    slices: FormattingSettingsSlice[] = [
        this.show, this.sameScale, this.fontSize, this.fontColor, this.min, this.max, this.units, this.decimals,
        this.showTitle, this.titleText
    ];
}

class ColumnLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", false);
    position = dropdown("position", "Posição", COLUMN_LABEL_POSITION_ITEMS, 0);
    fontSize = fontSize(11);
    autoColor = toggle("autoColor", "Cor automática (contraste)", true, "Texto claro sobre colunas escuras e escuro sobre colunas claras.");
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", false);
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);

    name = "columnLabels";
    displayName = "Rótulos das colunas";
    description = "Valor de cada segmento. Só aparece quando cabe dentro do segmento.";
    slices: FormattingSettingsSlice[] = [
        this.show, this.position, this.fontSize, this.autoColor, this.fontColor, this.bold, this.units, this.decimals
    ];
}

class TotalLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    fontSize = fontSize(12);
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", true);
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);

    name = "totalLabels";
    displayName = "Rótulos do total";
    description = "Soma das colunas visíveis, acima de cada pilha.";
    slices: FormattingSettingsSlice[] = [this.show, this.fontSize, this.fontColor, this.bold, this.units, this.decimals];
}

class LineLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    points = dropdown("points", "Quais pontos", LINE_LABEL_POINTS_ITEMS, 0);
    position = dropdown("position", "Posição", LINE_LABEL_POSITION_ITEMS, 0);
    fontSize = fontSize(11);
    useLineColor = toggle("useLineColor", "Usar a cor da linha", true);
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", true);
    halo = toggle("halo", "Fundo atrás do texto", true, "Contorno que deixa o rótulo legível sobre as colunas.");
    haloColor = color("haloColor", "Cor do fundo", WHITE);
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);

    name = "lineLabels";
    displayName = "Rótulos das linhas";
    slices: FormattingSettingsSlice[] = [
        this.show, this.points, this.position, this.fontSize, this.useLineColor, this.fontColor, this.bold, this.halo,
        this.haloColor, this.units, this.decimals
    ];
}

class InteractionCard extends FormattingSettingsCard {
    tooltipMode = dropdown("tooltipMode", "Dica de ferramenta", TOOLTIP_MODE_ITEMS, 0);
    hoverBand = toggle("hoverBand", "Destacar a categoria sob o mouse", true);
    hoverColor = color("hoverColor", "Cor do destaque", DARK);
    hoverOpacity = num("hoverOpacity", "Opacidade do destaque (%)", 5);
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 35);

    name = "interaction";
    displayName = "Interação";
    slices: FormattingSettingsSlice[] = [
        this.tooltipMode, this.hoverBand, this.hoverColor, this.hoverOpacity, this.selectedOpacity
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    headerCard = new HeaderCard();
    togglesCard = new TogglesCard();
    columnsCard = new ColumnsCard();
    linesCard = new LinesCard();
    xAxisCard = new XAxisCard();
    yAxisCard = new YAxisCard();
    y2AxisCard = new Y2AxisCard();
    columnLabelsCard = new ColumnLabelsCard();
    totalLabelsCard = new TotalLabelsCard();
    lineLabelsCard = new LineLabelsCard();
    interactionCard = new InteractionCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.headerCard, this.togglesCard, this.columnsCard, this.linesCard, this.xAxisCard,
        this.yAxisCard, this.y2AxisCard, this.columnLabelsCard, this.totalLabelsCard, this.lineLabelsCard,
        this.interactionCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
