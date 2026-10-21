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
/** Cores padrão do mapa de calor (pior / melhor que a referência). */
export const WORSE = "#E5534B";
export const BETTER = "#3FAE6A";
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

const enumItems = (...pairs: Array<[string, string]>): powerbi.IEnumMember[] =>
    pairs.map(([value, displayName]) => ({ value, displayName }));

const color = (name: string, displayName: string, value: string): formattingSettings.ColorPicker =>
    new formattingSettings.ColorPicker({ name, displayName, value: { value } });
const num = (name: string, displayName: string, value: number, description?: string): formattingSettings.NumUpDown =>
    new formattingSettings.NumUpDown({ name, displayName, value, description });
const toggle = (name: string, displayName: string, value: boolean, description?: string): formattingSettings.ToggleSwitch =>
    new formattingSettings.ToggleSwitch({ name, displayName, value, description });
const dropdown = (name: string, displayName: string, items: powerbi.IEnumMember[], index = 0, description?: string): formattingSettings.ItemDropdown =>
    new formattingSettings.ItemDropdown({ name, displayName, items, value: items[index], description });
const text = (name: string, displayName: string, value: string, placeholder = ""): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value, placeholder });

export const INITIAL_SORT_ITEMS = enumItems(
    ["model", "Ordem do Power BI"],
    ["keyDesc", "Medida-chave (maior primeiro)"],
    ["keyAsc", "Medida-chave (menor primeiro)"],
    ["label", "Nome (A–Z)"]
);
export const HOTSPOT_SCOPE_ITEMS = enumItems(["rowTotal", "Total de cada linha"], ["cells", "Cada célula (linha × coluna)"]);
export const HOTSPOT_LEVEL_ITEMS = enumItems(["deepest", "Nível mais detalhado"], ["top", "Primeiro nível"], ["all", "Todos os níveis"]);
export const HOTSPOT_RANK_ITEMS = enumItems(["deviation", "Distância acima da referência"], ["impact", "Impacto (distância × base)"]);
export const TREND_POSITION_ITEMS = enumItems(["end", "No fim"], ["start", "Logo depois das linhas"]);
export const TREND_WHEN_ITEMS = enumItems(
    ["time", "Só quando as colunas são datas ou períodos"],
    ["always", "Sempre que houver colunas"]
);
export const DETAIL_STYLE_ITEMS = enumItems(["paren", "Entre parênteses: (18)"], ["dot", "Após um ponto: · 18"], ["plain", "Sem separador: 18"]);
export const TOTAL_POSITION_ITEMS = enumItems(["bottom", "Embaixo"], ["top", "Em cima"]);

class ToolbarCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar barra de ferramentas", true);
    title = text("title", "Título", "", "Ex.: Turnover por área");
    titleSize = num("titleSize", "Tamanho do título", 15);
    titleColor = color("titleColor", "Cor do título", DARK);
    showFields = toggle("showFields", "Mostrar campos escolhidos", true,
        "Mostra embaixo do título quais campos estão nas linhas e nas colunas (útil com parâmetros de campo).");
    showSearch = toggle("showSearch", "Pesquisa", true);
    showExpand = toggle("showExpand", "Botões abrir e fechar níveis", true);
    showHeatmap = toggle("showHeatmap", "Botão mapa de calor", true);
    showDelta = toggle("showDelta", "Botão desvio", true);
    showFocus = toggle("showFocus", "Botão acima da referência", true);
    showExport = toggle("showExport", "Botão exportar para Excel", true);
    fontSize = num("fontSize", "Tamanho da fonte dos botões", 12);
    fill = color("fill", "Cor de fundo dos botões", PANEL);
    fontColor = color("fontColor", "Cor do texto e dos ícones", DARK);
    activeFill = color("activeFill", "Cor do botão ligado", PRIMARY);
    activeFontColor = color("activeFontColor", "Cor do texto do botão ligado", DARK);
    height = num("height", "Altura dos botões (px)", 32);
    radius = num("radius", "Arredondamento (px)", 10);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", GRID);

    name = "toolbar";
    displayName = "Barra de ferramentas";
    slices: FormattingSettingsSlice[] = [
        this.show, this.title, this.titleSize, this.titleColor, this.showFields, this.showSearch, this.showExpand,
        this.showHeatmap, this.showDelta, this.showFocus, this.showExport, this.fontSize, this.fill, this.fontColor,
        this.activeFill, this.activeFontColor, this.height, this.radius, this.borderWidth, this.borderColor
    ];
}

class AnalysisCard extends FormattingSettingsCard {
    // Itens preenchidos em getFormattingModel com as medidas de Valores.
    keyMeasure = new formattingSettings.ItemDropdown({
        name: "keyMeasure",
        displayName: "Medida-chave",
        description: "Usada nos pontos de atenção, no botão \"Acima da referência\", na tendência e na ordenação inicial.",
        items: [{ value: "", displayName: "(primeira medida)" }],
        value: { value: "", displayName: "(primeira medida)" }
    });
    heatmapOn = toggle("heatmapOn", "Mapa de calor ligado ao abrir", true);
    deltaOn = toggle("deltaOn", "Desvio ligado ao abrir", false);
    focusOn = toggle("focusOn", "Só acima da referência ao abrir", false);
    initialSort = dropdown("initialSort", "Ordenação inicial", INITIAL_SORT_ITEMS, 0,
        "Quem usa o relatório pode mudar clicando no cabeçalho das colunas.");
    worseColor = color("worseColor", "Cor do pior que a referência", WORSE);
    neutralColor = color("neutralColor", "Cor da referência (neutra)", "#FFFFFF");
    betterColor = color("betterColor", "Cor do melhor que a referência", BETTER);
    colorBetter = toggle("colorBetter", "Colorir também o lado melhor", true);
    scaleColor = color("scaleColor", "Cor da escala (medidas neutras)", PRIMARY);
    intensity = num("intensity", "Intensidade máxima das cores (%)", 85);

    name = "analysis";
    displayName = "Análise";
    slices: FormattingSettingsSlice[] = [
        this.keyMeasure, this.heatmapOn, this.deltaOn, this.focusOn, this.initialSort, this.worseColor,
        this.neutralColor, this.betterColor, this.colorBetter, this.scaleColor, this.intensity
    ];
}

class SmallBaseCard extends FormattingSettingsCard {
    minBase = num("minBase", "Base mínima", 10,
        "Células em que a medida do campo \"Base (volume)\" fica abaixo deste valor são marcadas como amostra pequena. 0 = desligado.");
    hideValues = toggle("hideValues", "Ocultar valores com base pequena", false,
        "Evita expor grupos com poucas pessoas e números instáveis (ex.: 1 saída em 3 pessoas = 33%).");
    pattern = toggle("pattern", "Hachurar células com base pequena", true);

    name = "smallBase";
    displayName = "Base mínima (amostra pequena)";
    slices: FormattingSettingsSlice[] = [this.minBase, this.hideValues, this.pattern];
}

class HotspotsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar pontos de atenção", true);
    title = text("title", "Título", "Pontos de atenção", "Pontos de atenção");
    count = num("count", "Quantidade (1 a 5)", 3);
    scope = dropdown("scope", "Comparar", HOTSPOT_SCOPE_ITEMS);
    level = dropdown("level", "Linhas consideradas", HOTSPOT_LEVEL_ITEMS);
    rank = dropdown("rank", "Ordenar por", HOTSPOT_RANK_ITEMS, 0,
        "Impacto = distância × base: mostra onde o problema atinge mais gente (precisa do campo Base).");
    fill = color("fill", "Cor de fundo", PANEL);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    radius = num("radius", "Arredondamento (px)", 10);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", GRID);

    name = "hotspots";
    displayName = "Pontos de atenção";
    slices: FormattingSettingsSlice[] = [
        this.show, this.title, this.count, this.scope, this.level, this.rank, this.fill, this.fontColor,
        this.fontSize, this.radius, this.borderWidth, this.borderColor
    ];
}

class TrendCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar coluna de tendência", true,
        "Minigráfico da medida-chave ao longo das colunas (ex.: meses).");
    when = dropdown("when", "Quando mostrar", TREND_WHEN_ITEMS, 0,
        "Com campos que não são tempo nas colunas (ex.: Tempo de casa, Senioridade), uma linha de tendência não faz sentido e a coluna some sozinha.");
    title = text("title", "Título da coluna", "Tendência", "Tendência");
    position = dropdown("position", "Posição", TREND_POSITION_ITEMS);
    lineColor = color("lineColor", "Cor da linha", DARK);
    markWorse = toggle("markWorse", "Marcar pontos piores que a referência", true);
    width = num("width", "Largura (px)", 120);

    name = "trend";
    displayName = "Tendência";
    slices: FormattingSettingsSlice[] = [this.show, this.when, this.title, this.position, this.lineColor, this.markWorse, this.width];
}

class TableCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    fill = color("fill", "Cor de fundo", "#FFFFFF");
    rowHeight = num("rowHeight", "Altura das linhas (px)", 34);
    zebra = toggle("zebra", "Linhas alternadas", false);
    zebraColor = color("zebraColor", "Cor das linhas alternadas", "#F8FBFE");
    hoverColor = color("hoverColor", "Cor ao passar o mouse", PANEL);
    gridColor = color("gridColor", "Cor das linhas de grade", GRID);
    radius = num("radius", "Arredondamento (px)", 12);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 1);
    borderColor = color("borderColor", "Cor da borda", GRID);

    name = "table";
    displayName = "Tabela";
    slices: FormattingSettingsSlice[] = [
        this.fontFamily, this.fill, this.rowHeight, this.zebra, this.zebraColor, this.hoverColor,
        this.gridColor, this.radius, this.borderWidth, this.borderColor
    ];
}

class ColumnHeaderCard extends FormattingSettingsCard {
    fill = color("fill", "Cor de fundo", "#FFFFFF");
    fontColor = color("fontColor", "Cor do texto", MUTED);
    memberColor = color("memberColor", "Cor dos valores das colunas", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    uppercase = toggle("uppercase", "Letras maiúsculas", false);
    wrap = toggle("wrap", "Quebrar texto longo", true);
    minWidth = num("minWidth", "Largura mínima das colunas (px)", 84);

    name = "columnHeader";
    displayName = "Cabeçalho das colunas";
    slices: FormattingSettingsSlice[] = [
        this.fill, this.fontColor, this.memberColor, this.fontSize, this.uppercase, this.wrap, this.minWidth
    ];
}

class RowHeadersCard extends FormattingSettingsCard {
    title = text("title", "Título da coluna de linhas", "", "Nome dos campos");
    fill = color("fill", "Cor de fundo", "#FFFFFF");
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    width = num("width", "Largura (px)", 240);
    indent = num("indent", "Recuo por nível (px)", 18);
    parentBold = toggle("parentBold", "Níveis com filhos em negrito", true);
    expandLevel = num("expandLevel", "Níveis abertos ao carregar", 0,
        "0 = tudo recolhido; 1 = abre o primeiro nível; e assim por diante.");

    name = "rowHeaders";
    displayName = "Linhas";
    slices: FormattingSettingsSlice[] = [
        this.title, this.fill, this.fontColor, this.fontSize, this.width, this.indent, this.parentBold, this.expandLevel
    ];
}

class ValuesCard extends FormattingSettingsCard {
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    emptyText = text("emptyText", "Texto para valor vazio", "–", "–");
    barColor = color("barColor", "Cor das barras de dados", PRIMARY);

    name = "values";
    displayName = "Valores";
    slices: FormattingSettingsSlice[] = [this.fontColor, this.fontSize, this.emptyText, this.barColor];
}

class DetailCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar detalhe", true,
        "Medidas do campo Detalhe ao lado do valor (ex.: 24,2% (18)). Em Medidas, escolha em quais colunas ele aparece.");
    style = dropdown("style", "Estilo", DETAIL_STYLE_ITEMS);
    fontSize = num("fontSize", "Tamanho da fonte", 11);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    bold = toggle("bold", "Negrito", false);

    name = "detailLabels";
    displayName = "Detalhe";
    slices: FormattingSettingsSlice[] = [this.show, this.style, this.fontSize, this.fontColor, this.bold];
}

class TotalsCard extends FormattingSettingsCard {
    rowSubtotals = toggle("rowSubtotals", "Subtotais nas linhas com filhos", true);
    columnSubtotals = toggle("columnSubtotals", "Coluna de total", true);
    showGrandTotal = toggle("showGrandTotal", "Mostrar total geral", true);
    position = dropdown("position", "Posição do total geral", TOTAL_POSITION_ITEMS);
    label = text("label", "Rótulo do total", "Total", "Total");
    fill = color("fill", "Cor de fundo do total", PANEL);
    fontColor = color("fontColor", "Cor do texto do total", DARK);

    name = "totals";
    displayName = "Totais";
    slices: FormattingSettingsSlice[] = [
        this.rowSubtotals, this.columnSubtotals, this.showGrandTotal, this.position, this.label, this.fill, this.fontColor
    ];
}

class ExportCard extends FormattingSettingsCard {
    fileName = text("fileName", "Nome do arquivo", "Matriz", "Matriz");
    allRows = toggle("allRows", "Exportar todos os níveis (mesmo os recolhidos)", true);

    name = "export";
    displayName = "Exportar para Excel";
    description = "O botão fica na barra de ferramentas.";
    slices: FormattingSettingsSlice[] = [this.fileName, this.allRows];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    toolbarCard = new ToolbarCard();
    analysisCard = new AnalysisCard();
    smallBaseCard = new SmallBaseCard();
    hotspotsCard = new HotspotsCard();
    trendCard = new TrendCard();
    tableCard = new TableCard();
    columnHeaderCard = new ColumnHeaderCard();
    rowHeadersCard = new RowHeadersCard();
    valuesCard = new ValuesCard();
    detailCard = new DetailCard();
    totalsCard = new TotalsCard();
    exportCard = new ExportCard();

    cards: Array<formattingSettings.Cards> = [
        this.toolbarCard, this.analysisCard, this.smallBaseCard, this.hotspotsCard, this.trendCard, this.tableCard,
        this.columnHeaderCard, this.rowHeadersCard, this.valuesCard, this.detailCard, this.totalsCard, this.exportCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
