"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCompositeCard = formattingSettings.CompositeCard;
import FormattingSettingsGroup = formattingSettings.Group;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** Cores padrão do repositório (ver DESIGN.md na raiz). */
export const PRIMARY = "#6CBEEB";
export const DARK = "#0F2B45";
export const PANEL = "#F1F8FD";
export const WHITE = "#FFFFFF";
export const MUTED = "#4E6175";
/** Fonte padrão. Nas partes do visual, deixar esta fonte = usar a fonte de "Geral". */
export const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/** Cores das séries (colunas e linhas), em tons da paleta do repositório. */
export const SERIES_PALETTE = [
    "#6CBEEB", "#0F2B45", "#A9DBF5", "#2E6A99", "#3E9BD1", "#D4ECFA",
    "#1B4A73", "#86CCF0", "#5C7E99", "#C2D8E8", "#24384D", "#9FB7CC"
];
/** As linhas começam pelo azul-marinho, para contrastar com as colunas azul-claro. */
export const LINE_PALETTE = ["#0F2B45", "#3E9BD1", "#5C7E99", "#1B4A73", "#86CCF0", "#24384D"];

const enumItems = (...pairs: Array<[string, string]>): powerbi.IEnumMember[] =>
    pairs.map(([value, displayName]) => ({ value, displayName }));

const color = (name: string, displayName: string, value: string, description?: string): formattingSettings.ColorPicker =>
    new formattingSettings.ColorPicker({ name, displayName, value: { value }, description });
const num = (name: string, displayName: string, value: number, description?: string): formattingSettings.NumUpDown =>
    new formattingSettings.NumUpDown({ name, displayName, value, description });
const toggle = (name: string, displayName: string, value: boolean, description?: string): formattingSettings.ToggleSwitch =>
    new formattingSettings.ToggleSwitch({ name, displayName, value, description });
const dropdown = (name: string, displayName: string, items: powerbi.IEnumMember[], index = 0): formattingSettings.ItemDropdown =>
    new formattingSettings.ItemDropdown({ name, displayName, items, value: items[index] });
const text = (name: string, displayName: string, value: string, placeholder = "", description?: string): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value, placeholder, description });
const group = (name: string, displayName: string, slices: FormattingSettingsSlice[], description?: string): FormattingSettingsGroup =>
    new formattingSettings.Group({ name, displayName, slices, description });

/** Fonte, tamanho, negrito, itálico e sublinhado numa linha só (como no painel nativo). prefix: nome das propriedades. */
export class Font {
    family: formattingSettings.FontPicker;
    size: formattingSettings.NumUpDown;
    bold: formattingSettings.ToggleSwitch;
    italic: formattingSettings.ToggleSwitch;
    underline: formattingSettings.ToggleSwitch;
    control: formattingSettings.FontControl;

    constructor(prefix: string, displayName: string, size: number, bold = false) {
        const key = (s: string): string => (prefix ? prefix + s[0].toUpperCase() + s.slice(1) : s);
        this.family = new formattingSettings.FontPicker({ name: key("fontFamily"), value: FONT });
        this.size = num(key("fontSize"), "Tamanho", size);
        this.bold = toggle(key("bold"), "Negrito", bold);
        this.italic = toggle(key("italic"), "Itálico", false);
        this.underline = toggle(key("underline"), "Sublinhado", false);
        this.control = new formattingSettings.FontControl({
            name: key("font"), displayName,
            fontFamily: this.family, fontSize: this.size, bold: this.bold, italic: this.italic, underline: this.underline
        });
    }
}

export const POSITION_ITEMS = enumItems(["top", "Em cima"], ["bottom", "Embaixo"]);
export const ALIGN_ITEMS = enumItems(["left", "À esquerda"], ["center", "No centro"], ["right", "À direita"]);
export const LINE_STYLE_ITEMS = enumItems(["solid", "Contínua"], ["dashed", "Tracejada"], ["dotted", "Pontilhada"]);
export const SERIES_LINE_STYLE_ITEMS = enumItems(["default", "Igual às outras"], ["solid", "Contínua"], ["dashed", "Tracejada"], ["dotted", "Pontilhada"]);
export const SERIES_TRISTATE_ITEMS = enumItems(["default", "Igual às outras"], ["on", "Mostrar"], ["off", "Esconder"]);
export const CURVE_ITEMS = enumItems(["linear", "Reta"], ["smooth", "Suave (curva)"], ["step", "Degraus"]);
export const MARKER_SHAPE_ITEMS = enumItems(["circle", "Círculo"], ["square", "Quadrado"], ["diamond", "Losango"]);
export const MARKER_FILL_ITEMS = enumItems(["hollow", "Vazado (centro de outra cor)"], ["filled", "Cheio"]);
export const NULLS_ITEMS = enumItems(["gap", "Interromper a linha"], ["connect", "Ligar os pontos"], ["zero", "Tratar como zero"]);
export const ROTATION_ITEMS = enumItems(["auto", "Automática"], ["0", "Horizontal"], ["45", "Inclinada (45°)"], ["90", "Vertical"]);
export const HIERARCHY_ITEMS = enumItems(
    ["grouped", "Agrupado (grupos embaixo, como no nativo)"], ["concat", "Concatenado (ex.: Jan 2024)"], ["inner", "Só o último nível"]
);
export const CONCAT_ORDER_ITEMS = enumItems(["innerFirst", "Do último para o primeiro (Jan 2024)"], ["outerFirst", "Do primeiro para o último (2024 Jan)"]);
export const UNITS_ITEMS = enumItems(
    ["auto", "Automático"], ["none", "Nenhuma"], ["1000", "Mil"], ["1000000", "Milhões"], ["1000000000", "Bilhões"]
);
export const GRID_STYLE_ITEMS = enumItems(["solid", "Contínua"], ["dashed", "Tracejada"], ["dotted", "Pontilhada"]);
export const COLUMN_LABEL_POSITION_ITEMS = enumItems(["center", "No centro"], ["insideEnd", "Dentro, no topo"], ["insideBase", "Dentro, na base"]);
export const LINE_LABEL_POSITION_ITEMS = enumItems(["above", "Acima do ponto"], ["below", "Abaixo do ponto"]);
export const LINE_LABEL_POINTS_ITEMS = enumItems(
    ["all", "Todos os pontos"], ["last", "Só o último"], ["minmax", "Maior e menor"], ["ends", "Primeiro e último"]
);
export const LINE_SEPARATE_ITEMS = enumItems(
    ["none", "Não (todas na mesma escala)"],
    ["spread", "Mesmo eixo, rótulos afastados (recomendado)"],
    ["lanes", "Em faixas (cada linha com escala própria, sai do eixo comum)"]
);
export const LINE_OVERLAP_ITEMS = enumItems(
    ["nudge", "Sempre visível (afasta o rótulo até achar espaço)"], ["hide", "Mudar de lado ou esconder"]
);
export const TOOLTIP_MODE_ITEMS = enumItems(["category", "Todos os valores da categoria"], ["item", "Só o item sob o mouse"]);
export const CHIP_ON_STYLE_ITEMS = enumItems(
    ["neutral", "Fundo neutro e amostra de cor"], ["filled", "Fundo na cor da série"], ["outline", "Borda na cor da série"]
);
export const SWATCH_SHAPE_ITEMS = enumItems(["auto", "Automática (quadrado / traço)"], ["square", "Quadrado"], ["circle", "Círculo"], ["line", "Traço"]);
export const HIDDEN_STYLE_ITEMS = enumItems(["fade", "Esmaecer"], ["fadeStrike", "Esmaecer e riscar"], ["strike", "Só riscar"]);

// ------------------------------------------------------------------ Geral

class GeneralCard extends FormattingSettingsCompositeCard {
    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily", displayName: "Fonte", value: FONT,
        description: "Fonte de todo o visual. Nas outras seções, mantenha a fonte padrão para usar esta."
    });
    animate = toggle("animate", "Animar ao mostrar e esconder", true);
    animationDuration = num("animationDuration", "Duração da animação (ms)", 450);
    showBackground = toggle("showBackground", "Fundo na área do gráfico", false);
    background = color("background", "Cor do fundo", PANEL);
    backgroundRadius = num("backgroundRadius", "Arredondamento do fundo (px)", 10);
    paddingX = num("paddingX", "Margem lateral (px)", 8);
    paddingY = num("paddingY", "Margem em cima e embaixo (px)", 4);

    name = "general";
    displayName = "Geral";
    groups: FormattingSettingsGroup[] = [
        group("generalText", "Texto e animação", [this.fontFamily, this.animate, this.animationDuration]),
        group("generalLayout", "Margens e fundo", [
            this.paddingX, this.paddingY, this.showBackground, this.background, this.backgroundRadius
        ])
    ];
}

class HeaderCard extends FormattingSettingsCompositeCard {
    title = text("title", "Texto", "", "Ex.: Receita e margem");
    titleFont = new Font("title", "Fonte", 18, true);
    titleColor = color("titleColor", "Cor", DARK);
    subtitle = text("subtitle", "Texto", "", "Ex.: por mês");
    subtitleFont = new Font("subtitle", "Fonte", 13);
    subtitleColor = color("subtitleColor", "Cor", MUTED);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);
    spacing = num("spacing", "Espaço abaixo (px)", 8);

    name = "header";
    displayName = "Cabeçalho";
    description = "Título e subtítulo dentro do visual (deixe em branco para esconder).";
    groups: FormattingSettingsGroup[] = [
        group("headerTitle", "Título", [this.title, this.titleFont.control, this.titleColor]),
        group("headerSubtitle", "Subtítulo", [this.subtitle, this.subtitleFont.control, this.subtitleColor]),
        group("headerLayout", "Posição", [this.align, this.spacing])
    ];
}

// ------------------------------------------------------------------ Legenda interativa

class TogglesCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar a legenda interativa", true);
    position = dropdown("position", "Posição", POSITION_ITEMS, 0);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);
    gap = num("gap", "Espaço entre os botões (px)", 6);
    spacing = num("spacing", "Distância até o gráfico (px)", 10);
    showDivider = toggle("showDivider", "Divisória entre os grupos", true);
    dividerColor = color("dividerColor", "Cor da divisória", DARK);
    startColumns = toggle("startColumns", "Colunas visíveis ao abrir", true);
    startLines = toggle("startLines", "Linhas visíveis ao abrir", true);
    doubleClickSolo = toggle("doubleClickSolo", "Duplo clique mostra só a série", true);
    allHiddenText = text("allHiddenText", "Aviso quando tudo está escondido",
        "Tudo escondido. Use os botões da legenda para mostrar colunas ou linhas.", "Texto do aviso");

    font = new Font("", "Fonte dos botões", 12, true);

    height = num("height", "Altura (px)", 30);
    paddingX = num("paddingX", "Espaço interno lateral (px, -1 = automático)", -1);
    radius = num("radius", "Arredondamento (px)", 999, "Valores altos deixam os botões em formato de pílula.");
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    shadow = toggle("shadow", "Sombra", true);
    iconSize = num("iconSize", "Tamanho dos ícones (px, 0 = automático)", 0);
    hiddenStyle = dropdown("hiddenStyle", "Como mostrar o que está escondido", HIDDEN_STYLE_ITEMS, 1);
    hiddenOpacity = num("hiddenOpacity", "Opacidade do que está escondido (%)", 45);

    groupButtons = toggle("groupButtons", "Mostrar botões Colunas / Linhas", true, "Mostram ou escondem todas as colunas ou todas as linhas de uma vez.");
    columnsLabel = text("columnsLabel", "Texto do botão de colunas", "Colunas", "Colunas");
    linesLabel = text("linesLabel", "Texto do botão de linhas", "Linhas", "Linhas");
    showIcons = toggle("showIcons", "Mostrar ícones", true);
    activeBackground = color("activeBackground", "Fundo (ligado)", PRIMARY);
    activeFontColor = color("activeFontColor", "Texto (ligado)", DARK);
    activeBorderColor = color("activeBorderColor", "Borda (ligado)", DARK);
    inactiveBackground = color("inactiveBackground", "Fundo (desligado)", PANEL);
    inactiveFontColor = color("inactiveFontColor", "Texto (desligado)", DARK);
    inactiveBorderColor = color("inactiveBorderColor", "Borda (desligado)", DARK);

    seriesChips = toggle("seriesChips", "Mostrar um botão por série", true, "Cada série da legenda vira um botão para mostrar ou esconder.");
    chipStyle = dropdown("chipStyle", "Estilo quando visível", CHIP_ON_STYLE_ITEMS, 0);
    background = color("background", "Fundo (visível)", PANEL);
    fontColor = color("fontColor", "Texto (visível)", DARK);
    borderColor = color("borderColor", "Borda (visível)", DARK);
    chipHiddenBackground = color("chipHiddenBackground", "Fundo (escondida)", PANEL);
    chipHiddenFontColor = color("chipHiddenFontColor", "Texto (escondida)", DARK);
    chipHiddenBorderColor = color("chipHiddenBorderColor", "Borda (escondida)", DARK);
    showSwatch = toggle("showSwatch", "Mostrar amostra de cor", true);
    swatchShape = dropdown("swatchShape", "Forma da amostra", SWATCH_SHAPE_ITEMS, 0);
    swatchSize = num("swatchSize", "Tamanho da amostra (px, 0 = automático)", 0);
    chipMaxWidth = num("chipMaxWidth", "Largura máxima do texto (px, 0 = sem limite)", 180);

    showReset = toggle("showReset", "Mostrar botão \"Mostrar tudo\"", true, "Aparece quando há algo escondido.");
    resetLabel = text("resetLabel", "Texto do botão", "", "Só o ícone");
    resetColor = color("resetColor", "Cor do texto e do ícone", DARK);
    resetBackground = toggle("resetBackground", "Fundo igual ao dos botões", false);

    name = "toggles";
    displayName = "Legenda interativa";
    description = "Clique num botão para mostrar ou esconder a série no gráfico.";
    topLevelSlice = this.show;
    groupLayout = group("togglesLayout", "Posição e comportamento", [
        this.position, this.align, this.gap, this.spacing, this.showDivider, this.dividerColor, this.startColumns,
        this.startLines, this.doubleClickSolo, this.allHiddenText
    ]);
    groupShape = group("togglesShape", "Texto e forma dos botões", [
        this.font.control, this.height, this.paddingX, this.radius, this.borderWidth, this.shadow, this.iconSize,
        this.hiddenStyle, this.hiddenOpacity
    ]);
    groupGroups = group("togglesGroups", "Botões Colunas / Linhas", [
        this.groupButtons, this.columnsLabel, this.linesLabel, this.showIcons, this.activeBackground, this.activeFontColor,
        this.activeBorderColor, this.inactiveBackground, this.inactiveFontColor, this.inactiveBorderColor
    ]);
    groupChips = group("togglesChips", "Botões das séries", [
        this.seriesChips, this.chipStyle, this.background, this.fontColor, this.borderColor, this.chipHiddenBackground,
        this.chipHiddenFontColor, this.chipHiddenBorderColor, this.showSwatch, this.swatchShape, this.swatchSize, this.chipMaxWidth
    ]);
    groupReset = group("togglesReset", "Botão \"Mostrar tudo\"", [this.showReset, this.resetLabel, this.resetColor, this.resetBackground]);
    groups: FormattingSettingsGroup[] = [this.groupLayout, this.groupShape, this.groupGroups, this.groupChips, this.groupReset];
}

// ------------------------------------------------------------------ Colunas e linhas

class ColumnsCard extends FormattingSettingsCompositeCard {
    spacing = num("spacing", "Espaço entre colunas (%)", 30, "Porcentagem da largura de cada categoria deixada vazia.");
    maxWidth = num("maxWidth", "Largura máxima da coluna (px, 0 = sem limite)", 0);
    radius = num("radius", "Arredondamento do topo (px)", 4);
    radiusBase = num("radiusBase", "Arredondamento da base (px)", 0);
    roundEachSegment = toggle("roundEachSegment", "Arredondar cada segmento", false, "Desligado, só a ponta da pilha é arredondada.");
    segmentGap = num("segmentGap", "Espaço entre segmentos (px)", 0);
    opacity = num("opacity", "Opacidade (%)", 100);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", WHITE);
    hoverBrightness = num("hoverBrightness", "Clarear ao passar o mouse (%)", 8);
    alwaysBelow = toggle("alwaysBelow", "Colunas sempre abaixo das linhas", false,
        "As colunas ficam na parte de baixo do gráfico e as linhas na de cima, sem se cruzarem. Vale mesmo com \"Usar a escala das colunas\" ligado.");
    belowShare = num("belowShare", "Altura da coluna mais alta (%)", 60, "Porcentagem da altura do gráfico que a coluna mais alta ocupa.");
    belowGapPx = num("belowGapPx", "Espaço entre colunas e linhas (px)", 8, "Distância entre o topo da coluna mais alta e o ponto mais baixo das linhas.");
    linesHeight = num("linesHeight", "Altura da área das linhas (%)", 30,
        "Quanto da altura do gráfico as linhas ocupam, logo acima das colunas. Mais alto = mais variação visível. 0 = todo o espaço acima das colunas.");

    name = "columns";
    displayName = "Colunas";
    groupBelow = group("columnsBelowLines", "Posição em relação às linhas", [this.alwaysBelow, this.belowShare, this.belowGapPx, this.linesHeight]);
    groups: FormattingSettingsGroup[] = [
        this.groupBelow,
        group("columnsShape", "Forma", [
            this.spacing, this.maxWidth, this.radius, this.radiusBase, this.roundEachSegment, this.segmentGap
        ]),
        group("columnsLook", "Aparência", [this.opacity, this.borderWidth, this.borderColor, this.hoverBrightness])
    ];
}

class LinesCard extends FormattingSettingsCompositeCard {
    width = num("width", "Espessura (px)", 3);
    style = dropdown("style", "Estilo", LINE_STYLE_ITEMS, 0);
    curve = dropdown("curve", "Traçado", CURVE_ITEMS, 1);
    opacity = num("opacity", "Opacidade (%)", 100);
    nulls = dropdown("nulls", "Valores vazios", NULLS_ITEMS, 0);
    showMarkers = toggle("showMarkers", "Mostrar marcadores", true);
    markerShape = dropdown("markerShape", "Forma", MARKER_SHAPE_ITEMS, 0);
    markerSize = num("markerSize", "Tamanho (px)", 4);
    markerFill = dropdown("markerFill", "Preenchimento", MARKER_FILL_ITEMS, 0);
    markerCenterColor = color("markerCenterColor", "Cor do centro (vazado)", WHITE);
    markerBorderWidth = num("markerBorderWidth", "Espessura da borda (px, 0 = automática)", 0);
    markerGrow = num("markerGrow", "Aumentar ao passar o mouse (%)", 45);
    showArea = toggle("showArea", "Sombrear a área abaixo", false);
    areaOpacity = num("areaOpacity", "Opacidade da área (%)", 15);
    separate = dropdown("separate", "Separar as linhas", LINE_SEPARATE_ITEMS, 1);
    laneGap = num("laneGap", "Espaço entre os rótulos / faixas (px, 0 = automático)", 0,
        "Rótulos afastados: espaço mínimo entre os rótulos de linhas diferentes no mesmo ponto. Em faixas: espaço entre as faixas.");

    name = "lines";
    displayName = "Linhas";
    description = "Valem para todas as linhas. Em \"Linhas — por série\" dá para mudar cada uma.";
    groups: FormattingSettingsGroup[] = [
        group("linesStroke", "Traço", [this.width, this.style, this.curve, this.opacity, this.nulls]),
        group("linesMarkers", "Marcadores", [
            this.showMarkers, this.markerShape, this.markerSize, this.markerFill, this.markerCenterColor,
            this.markerBorderWidth, this.markerGrow
        ]),
        group("linesArea", "Área", [this.showArea, this.areaOpacity]),
        group("linesSpacing", "Várias linhas", [this.separate, this.laneGap],
            "Rótulos afastados: as linhas ficam no valor real, no mesmo eixo; em cada ponto o rótulo da linha de cima vai acima e o da de baixo vai abaixo, sem se sobreporem. Em faixas: cada linha ganha uma faixa com escala própria (o eixo secundário some).")
    ];
}

// ------------------------------------------------------------------ Eixos

class XAxisCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar", true);
    font = new Font("", "Fonte", 12);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    rotation = dropdown("rotation", "Rotação dos rótulos", ROTATION_ITEMS, 0);
    maxLabelWidth = num("maxLabelWidth", "Largura máxima do rótulo (px, 0 = automática)", 0);
    labelSpacing = num("labelSpacing", "Distância do eixo (px)", 6);
    minWidth = num("minWidth", "Largura mínima da categoria (px)", 0, "0 = tudo cabe na largura do visual. Acima disso, aparece a rolagem horizontal.");
    showLine = toggle("showLine", "Mostrar linha do eixo", true);
    lineColor = color("lineColor", "Cor da linha", DARK);
    lineWidth = num("lineWidth", "Espessura da linha (px)", 1);
    lineOpacity = num("lineOpacity", "Opacidade da linha (%)", 35);
    showTitle = toggle("showTitle", "Mostrar título", false);
    titleText = text("titleText", "Texto do título", "", "Nome do campo");
    titleFont = new Font("title", "Fonte do título", 12, true);
    titleColor = color("titleColor", "Cor do título", MUTED);
    hierarchy = dropdown("hierarchy", "Como mostrar", HIERARCHY_ITEMS, 0);
    concatOrder = dropdown("concatOrder", "Ordem dos níveis", CONCAT_ORDER_ITEMS, 0);
    concatSeparator = text("concatSeparator", "Separador", " ", "Espaço", "Texto entre os níveis, como \" \", \" / \" ou \" - \".");
    groupFont = new Font("group", "Fonte dos grupos", 12, true);
    groupColor = color("groupColor", "Cor dos grupos", DARK);
    groupSpacing = num("groupSpacing", "Espaço entre os níveis (px)", 4);
    showSeparators = toggle("showSeparators", "Divisórias entre os grupos", true);
    separatorColor = color("separatorColor", "Cor das divisórias", DARK);
    separatorOpacity = num("separatorOpacity", "Opacidade das divisórias (%)", 20);
    separatorInPlot = toggle("separatorInPlot", "Divisórias também dentro do gráfico", false);

    name = "xAxis";
    displayName = "Eixo X";
    topLevelSlice = this.show;
    groups: FormattingSettingsGroup[] = [
        group("xLabels", "Rótulos", [this.font.control, this.fontColor, this.rotation, this.maxLabelWidth, this.labelSpacing, this.minWidth]),
        group("xHierarchy", "Vários campos (ex.: Ano e Mês)", [
            this.hierarchy, this.concatOrder, this.concatSeparator, this.groupFont.control, this.groupColor, this.groupSpacing,
            this.showSeparators, this.separatorColor, this.separatorOpacity, this.separatorInPlot
        ], "Com mais de um campo no Eixo X, os valores ficam aninhados (ex.: os meses dentro de cada ano)."),
        group("xLine", "Linha do eixo", [this.showLine, this.lineColor, this.lineWidth, this.lineOpacity]),
        group("xTitle", "Título", [this.showTitle, this.titleText, this.titleFont.control, this.titleColor])
    ];
}

class ValueAxisCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar", true);
    font = new Font("", "Fonte", 11);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    min = text("min", "Mínimo", "", "Automático", "Também dá para usar uma medida: arraste-a para o campo \"Mínimo do eixo\" do visual.");
    max = text("max", "Máximo", "", "Automático", "Também dá para usar uma medida: arraste-a para o campo \"Máximo do eixo\" do visual.");
    tickCount = num("tickCount", "Quantidade de marcas (0 = automática)", 0);
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);
    showTitle = toggle("showTitle", "Mostrar título", false);
    titleText = text("titleText", "Texto do título", "", "Nome da medida");
    titleFont = new Font("title", "Fonte do título", 11, true);
    titleColor = color("titleColor", "Cor do título", MUTED);
    showGrid = toggle("showGrid", "Linhas de grade", true);
    gridColor = color("gridColor", "Cor", DARK);
    gridOpacity = num("gridOpacity", "Opacidade (%)", 10);
    gridWidth = num("gridWidth", "Espessura (px)", 1);
    gridStyle = dropdown("gridStyle", "Estilo", GRID_STYLE_ITEMS, 1);

    sameScale = toggle("sameScale", "Usar a escala das colunas", false, "Linhas e colunas na mesma escala (sem eixo secundário).");
    topLevelSlice = this.show;
    name = "";
    displayName = "";
    groups: FormattingSettingsGroup[] = [];

    constructor(name: string, displayName: string, secondary: boolean) {
        super();
        this.name = name;
        this.displayName = displayName;
        const sameScale = this.sameScale;
        this.groups = [
            group(name + "Scale", "Escala", secondary
                ? [sameScale, this.min, this.max, this.tickCount]
                : [this.min, this.max, this.tickCount]),
            group(name + "Labels", "Rótulos", [this.font.control, this.fontColor, this.units, this.decimals]),
            group(name + "Title", "Título", [this.showTitle, this.titleText, this.titleFont.control, this.titleColor]),
            group(name + "Grid", secondary ? "Linhas de grade (quando as colunas estão escondidas)" : "Linhas de grade",
                [this.showGrid, this.gridColor, this.gridOpacity, this.gridWidth, this.gridStyle])
        ];
    }
}

// ------------------------------------------------------------------ Rótulos de dados

class ColumnLabelsCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar", false);
    position = dropdown("position", "Posição", COLUMN_LABEL_POSITION_ITEMS, 0);
    font = new Font("", "Fonte", 11);
    autoColor = toggle("autoColor", "Cor automática (contraste)", true, "Texto claro sobre colunas escuras e escuro sobre colunas claras.");
    fontColor = color("fontColor", "Cor do texto", DARK);
    lightColor = color("lightColor", "Cor sobre colunas escuras", WHITE);
    darkColor = color("darkColor", "Cor sobre colunas claras", DARK);
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);
    hideSmall = toggle("hideSmall", "Esconder quando não cabe no segmento", true);

    name = "columnLabels";
    displayName = "Rótulos das colunas";
    description = "Valor de cada segmento.";
    topLevelSlice = this.show;
    groups: FormattingSettingsGroup[] = [
        group("colLabelsText", "Texto", [this.position, this.font.control, this.autoColor, this.fontColor, this.lightColor, this.darkColor, this.hideSmall]),
        group("colLabelsNumbers", "Números", [this.units, this.decimals])
    ];
}

class TotalLabelsCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar", true);
    font = new Font("", "Fonte", 12, true);
    fontColor = color("fontColor", "Cor do texto", DARK);
    offset = num("offset", "Distância da coluna (px)", 5);
    halo = toggle("halo", "Contorno atrás do texto", false);
    haloColor = color("haloColor", "Cor do contorno", WHITE);
    haloWidth = num("haloWidth", "Espessura do contorno (px)", 3);
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);
    showWhenNotFit = toggle("showWhenNotFit", "Mostrar mesmo sem caber na largura", false, "Desligado, os totais somem quando algum não cabe na largura da coluna.");

    name = "totalLabels";
    displayName = "Rótulos do total";
    description = "Soma das colunas visíveis, acima de cada pilha.";
    topLevelSlice = this.show;
    groups: FormattingSettingsGroup[] = [
        group("totalText", "Texto", [this.font.control, this.fontColor, this.offset, this.showWhenNotFit]),
        group("totalHalo", "Contorno", [this.halo, this.haloColor, this.haloWidth]),
        group("totalNumbers", "Números", [this.units, this.decimals])
    ];
}

class LineLabelsCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar", true);
    points = dropdown("points", "Quais pontos", LINE_LABEL_POINTS_ITEMS, 0);
    position = dropdown("position", "Posição", LINE_LABEL_POSITION_ITEMS, 0);
    offset = num("offset", "Distância do ponto (px)", 4);
    avoidOverlap = toggle("avoidOverlap", "Evitar sobreposição", true);
    overlapMode = dropdown("overlapMode", "Quando bater em outro rótulo", LINE_OVERLAP_ITEMS, 0);
    font = new Font("", "Fonte", 11, true);
    useLineColor = toggle("useLineColor", "Usar a cor da linha", true);
    fontColor = color("fontColor", "Cor do texto", DARK);
    halo = toggle("halo", "Contorno atrás do texto", true, "Deixa o rótulo legível sobre as colunas.");
    haloColor = color("haloColor", "Cor do contorno", WHITE);
    haloWidth = num("haloWidth", "Espessura do contorno (px)", 3.5);
    units = dropdown("units", "Unidades de exibição", UNITS_ITEMS, 0);
    decimals = num("decimals", "Casas decimais (-1 = automático)", -1);

    name = "lineLabels";
    displayName = "Rótulos das linhas";
    topLevelSlice = this.show;
    groups: FormattingSettingsGroup[] = [
        group("lineLabelsPlace", "Posição", [this.points, this.position, this.offset, this.avoidOverlap, this.overlapMode]),
        group("lineLabelsText", "Texto", [this.font.control, this.useLineColor, this.fontColor]),
        group("lineLabelsHalo", "Contorno", [this.halo, this.haloColor, this.haloWidth]),
        group("lineLabelsNumbers", "Números", [this.units, this.decimals])
    ];
}

// ------------------------------------------------------------------ Interação

class InteractionCard extends FormattingSettingsCompositeCard {
    tooltipMode = dropdown("tooltipMode", "Conteúdo", TOOLTIP_MODE_ITEMS, 0);
    tooltipTotal = toggle("tooltipTotal", "Mostrar o total das colunas", true);
    totalText = text("totalText", "Nome do total", "Total", "Total");
    hoverBand = toggle("hoverBand", "Destacar a categoria sob o mouse", true);
    hoverColor = color("hoverColor", "Cor do destaque", DARK);
    hoverOpacity = num("hoverOpacity", "Opacidade do destaque (%)", 5);
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 35);

    name = "interaction";
    displayName = "Interação";
    groups: FormattingSettingsGroup[] = [
        group("tooltip", "Dica de ferramenta", [this.tooltipMode, this.tooltipTotal, this.totalText]),
        group("hover", "Mouse e seleção", [this.hoverBand, this.hoverColor, this.hoverOpacity, this.selectedOpacity])
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    headerCard = new HeaderCard();
    togglesCard = new TogglesCard();
    columnsCard = new ColumnsCard();
    linesCard = new LinesCard();
    xAxisCard = new XAxisCard();
    yAxisCard = new ValueAxisCard("yAxis", "Eixo Y (colunas)", false);
    y2AxisCard = new ValueAxisCard("y2Axis", "Eixo Y secundário (linhas)", true);
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
