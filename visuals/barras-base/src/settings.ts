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
export const GRID = "#E4EDF5";
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/** Paleta padrão da legenda: tons de azul do padrão do repositório, do claro ao escuro, alternados. */
export const SERIES_PALETTE = [
    "#6CBEEB", "#0F2B45", "#A9DBF5", "#2E6A99", "#3E9BD1", "#D4ECFA",
    "#1B4A73", "#86CCF0", "#5C7E99", "#C2D8E8", "#24384D", "#9FB7CC"
];

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
const text = (name: string, displayName: string, value: string, placeholder = ""): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value, placeholder });

export const TABLE_POS_ITEMS = enumItems(["right", "À direita do gráfico"], ["left", "À esquerda do gráfico"], ["bottom", "Abaixo do gráfico"]);
export const ORIENTATION_ITEMS = enumItems(["vertical", "Colunas (verticais)"], ["horizontal", "Barras (horizontais)"]);
export const ORDER_ITEMS = enumItems(["data", "Ordem do Power BI"], ["desc", "Maior total primeiro"], ["asc", "Menor total primeiro"], ["alpha", "Categoria (A–Z)"]);
export const SEGMENT_LABEL_ITEMS = enumItems(["none", "Nenhum"], ["value", "Valor"], ["percent", "% da barra"], ["both", "Valor e %"]);
export const LEGEND_POS_ITEMS = enumItems(["top", "Em cima"], ["bottom", "Embaixo"]);

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    crossFilter = toggle("crossFilter", "Filtrar também os outros visuais da página", true);

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily, this.crossFilter];
}

class LayoutCard extends FormattingSettingsCard {
    position = dropdown("position", "Posição da base nominal", TABLE_POS_ITEMS, 0);
    size = num("size", "Tamanho da base (% do visual)", 45);
    gap = num("gap", "Espaço entre gráfico e base (px)", 12);
    stackBelow = num("stackBelow", "Colocar a base embaixo quando a largura for menor que (px)", 560,
        "Em visuais estreitos, a base passa para baixo do gráfico. 0 = nunca.");

    name = "layout";
    displayName = "Layout";
    slices: FormattingSettingsSlice[] = [this.position, this.size, this.gap, this.stackBelow];
}

class BarsCard extends FormattingSettingsCard {
    orientation = dropdown("orientation", "Orientação", ORIENTATION_ITEMS, 0);
    order = dropdown("order", "Ordem das barras", ORDER_ITEMS, 0);
    gap = num("gap", "Espaço entre barras (%)", 30, "Porcentagem do espaço de cada barra.");
    maxWidth = num("maxWidth", "Espessura máxima da barra (px)", 64, "0 = sem limite.");
    radius = num("radius", "Arredondamento (px)", 6);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", "#FFFFFF");
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 30);

    name = "bars";
    displayName = "Barras";
    slices: FormattingSettingsSlice[] = [
        this.orientation, this.order, this.gap, this.maxWidth, this.radius, this.borderWidth, this.borderColor, this.selectedOpacity
    ];
}

class AxesCard extends FormattingSettingsCard {
    showCategory = toggle("showCategory", "Mostrar rótulos das categorias", true);
    categoryFontSize = num("categoryFontSize", "Tamanho da fonte das categorias", 12);
    categoryColor = color("categoryColor", "Cor das categorias", DARK);
    categoryWidth = num("categoryWidth", "Largura das categorias (px, barras horizontais)", 0, "0 = automática.");
    showValues = toggle("showValues", "Mostrar eixo de valores", true);
    valueFontSize = num("valueFontSize", "Tamanho da fonte do eixo de valores", 11);
    valueColor = color("valueColor", "Cor do eixo de valores", MUTED);
    showGrid = toggle("showGrid", "Mostrar linhas de grade", true);
    gridColor = color("gridColor", "Cor das linhas de grade", GRID);

    name = "axes";
    displayName = "Eixos";
    slices: FormattingSettingsSlice[] = [
        this.showCategory, this.categoryFontSize, this.categoryColor, this.categoryWidth,
        this.showValues, this.valueFontSize, this.valueColor, this.showGrid, this.gridColor
    ];
}

class DataLabelsCard extends FormattingSettingsCard {
    segment = dropdown("segment", "Rótulo dentro dos segmentos", SEGMENT_LABEL_ITEMS, 1);
    segmentFontSize = num("segmentFontSize", "Tamanho da fonte dos segmentos", 11);
    autoContrast = toggle("autoContrast", "Ajustar cor do texto ao fundo automaticamente", true);
    segmentColor = color("segmentColor", "Cor do texto dos segmentos", DARK);
    showTotal = toggle("showTotal", "Mostrar total da barra", true);
    totalFontSize = num("totalFontSize", "Tamanho da fonte do total", 12);
    totalColor = color("totalColor", "Cor do total", DARK);

    name = "dataLabels";
    displayName = "Rótulos de dados";
    slices: FormattingSettingsSlice[] = [
        this.segment, this.segmentFontSize, this.autoContrast, this.segmentColor, this.showTotal, this.totalFontSize, this.totalColor
    ];
}

class LegendCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    position = dropdown("position", "Posição", LEGEND_POS_ITEMS, 0);
    showTitle = toggle("showTitle", "Mostrar título (nome do campo)", true);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    fontColor = color("fontColor", "Cor do texto", DARK);

    name = "legend";
    displayName = "Legenda";
    slices: FormattingSettingsSlice[] = [this.show, this.position, this.showTitle, this.fontSize, this.fontColor];
}

class TableCard extends FormattingSettingsCard {
    title = text("title", "Título", "Base nominal", "Base nominal");
    titleFontSize = num("titleFontSize", "Tamanho da fonte do título", 14);
    titleColor = color("titleColor", "Cor do título", DARK);
    showCount = toggle("showCount", "Mostrar contagem de registros", true);
    showSearch = toggle("showSearch", "Mostrar pesquisa", true);
    showCategoryColumn = toggle("showCategoryColumn", "Mostrar coluna do Eixo", true);
    showLegendColumn = toggle("showLegendColumn", "Mostrar coluna da Legenda", true);
    showValueColumn = toggle("showValueColumn", "Mostrar coluna de Valores", false);
    colorMarker = toggle("colorMarker", "Marcador com a cor da legenda", true);
    emptyText = text("emptyText", "Texto para valor vazio", "–", "–");
    maxRows = num("maxRows", "Máximo de registros lidos (mil)", 30,
        "O Power BI envia a base em partes de 10 mil registros. Mais registros = mais memória.");

    name = "table";
    displayName = "Base nominal";
    slices: FormattingSettingsSlice[] = [
        this.title, this.titleFontSize, this.titleColor, this.showCount, this.showSearch,
        this.showCategoryColumn, this.showLegendColumn, this.showValueColumn, this.colorMarker, this.emptyText, this.maxRows
    ];
}

class PanelCard extends FormattingSettingsCard {
    fill = color("fill", "Cor de fundo", PANEL);
    radius = num("radius", "Arredondamento (px)", 14);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", PRIMARY);
    chipFill = color("chipFill", "Cor do filtro ativo", PRIMARY);
    chipColor = color("chipColor", "Cor do texto do filtro ativo", DARK);

    name = "panel";
    displayName = "Painel da base";
    slices: FormattingSettingsSlice[] = [this.fill, this.radius, this.borderWidth, this.borderColor, this.chipFill, this.chipColor];
}

class HeaderCard extends FormattingSettingsCard {
    fill = color("fill", "Cor de fundo", PRIMARY);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    uppercase = toggle("uppercase", "Letras maiúsculas", false);

    name = "header";
    displayName = "Cabeçalho da tabela";
    slices: FormattingSettingsSlice[] = [this.fill, this.fontColor, this.fontSize, this.uppercase];
}

class RowsCard extends FormattingSettingsCard {
    fill = color("fill", "Cor de fundo", "#FFFFFF");
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    height = num("height", "Altura das linhas (px)", 32);
    zebra = toggle("zebra", "Linhas alternadas", true);
    zebraColor = color("zebraColor", "Cor das linhas alternadas", "#F8FBFE");
    gridColor = color("gridColor", "Cor das linhas de grade", GRID);
    radius = num("radius", "Arredondamento da tabela (px)", 10);

    name = "rows";
    displayName = "Linhas da tabela";
    slices: FormattingSettingsSlice[] = [
        this.fill, this.fontColor, this.fontSize, this.height, this.zebra, this.zebraColor, this.gridColor, this.radius
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    layoutCard = new LayoutCard();
    barsCard = new BarsCard();
    axesCard = new AxesCard();
    dataLabelsCard = new DataLabelsCard();
    legendCard = new LegendCard();
    tableCard = new TableCard();
    panelCard = new PanelCard();
    headerCard = new HeaderCard();
    rowsCard = new RowsCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.layoutCard, this.barsCard, this.axesCard, this.dataLabelsCard, this.legendCard,
        this.tableCard, this.panelCard, this.headerCard, this.rowsCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
