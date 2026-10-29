"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
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
/** Fonte padrão. Nos textos, deixar esta fonte significa "usar a fonte do cartão Geral". */
export const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/** Textos padrão. Marcadores do resumo: {total}, {motivos}, {detalhamentos}. */
export const SUMMARY_TEMPLATE = "{total} no total · {motivos} motivos";
/** Marcadores do insight: {motivo}, {valor}, {percentual}, {detalhe}, {valorDetalhe}, {percentualDetalhe}. */
export const INSIGHT_TEMPLATE = "{motivo} é o principal motivo, com {percentual} do total. Dentro dele, destaca-se {detalhe} ({percentualDetalhe}).";
export const SEARCH_PLACEHOLDER = "Pesquisar motivo ou detalhamento";
export const NO_RESULT_TEMPLATE = "Nada encontrado para “{pesquisa}”.";

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
const group = (name: string, displayName: string, slices: FormattingSettingsSlice[], topLevelSlice?: formattingSettings.SimpleSlice,
    description?: string): FormattingSettingsGroup =>
    new FormattingSettingsGroup({ name, displayName, slices, topLevelSlice, description, collapsible: true });

/** Controle de fonte do Power BI (família, tamanho, negrito, itálico e sublinhado). */
export class Font extends formattingSettings.FontControl {
    constructor(prefix: string, size: number, bold = false, displayName = "Fonte") {
        super({
            name: prefix + "Font",
            displayName,
            fontFamily: new formattingSettings.FontPicker({ name: prefix + "FontFamily", value: FONT }),
            fontSize: new formattingSettings.NumUpDown({ name: prefix + "FontSize", value: size }),
            bold: new formattingSettings.ToggleSwitch({ name: prefix + "Bold", value: bold }),
            italic: new formattingSettings.ToggleSwitch({ name: prefix + "Italic", value: false }),
            underline: new formattingSettings.ToggleSwitch({ name: prefix + "Underline", value: false })
        });
    }
}

export const CLICK_MODE_ITEMS = enumItems(["expandFilter", "Abrir e filtrar os outros visuais"], ["expand", "Só abrir e fechar"]);
export const INITIAL_ITEMS = enumItems(["first", "Primeiro motivo aberto"], ["none", "Todos fechados"], ["all", "Todos abertos"]);
export const ORDER_BY_ITEMS = enumItems(["value", "Valor"], ["name", "Nome (A–Z)"], ["data", "Ordem do Power BI"]);
export const DIRECTION_ITEMS = enumItems(["auto", "Automática"], ["desc", "Decrescente"], ["asc", "Crescente"]);
export const SCALE_ITEMS = enumItems(["max", "Maior motivo = barra cheia"], ["total", "Total = barra cheia"]);
export const PERCENT_BASE_ITEMS = enumItems(["reason", "Do motivo"], ["total", "Do total"]);
export const RANK_SHAPE_ITEMS = enumItems(["circle", "Círculo"], ["rounded", "Quadrado arredondado"], ["none", "Só o número"]);
export const SIDE_ITEMS = enumItems(["right", "À direita"], ["left", "À esquerda"]);
export const UNITS_ITEMS = enumItems(
    ["none", "Nenhuma (formato da medida)"], ["auto", "Automática"], ["thousands", "Mil"], ["millions", "Milhões"], ["billions", "Bilhões"]
);
export const PERCENT_STYLE_ITEMS = enumItems(["plain", "33,0%"], ["paren", "(33,0%)"], ["dot", "· 33,0%"]);
export const POSITION_ITEMS = enumItems(["bottom", "Embaixo da lista"], ["top", "Em cima da lista"]);
export const LAYOUT_ITEMS = enumItems(
    ["horizontal", "Horizontal: detalhamento ao lado"], ["vertical", "Vertical: detalhamento embaixo (acordeão)"]
);
export const LINK_STYLE_ITEMS = enumItems(["ribbon", "Faixas proporcionais ao valor"], ["line", "Linhas finas"]);
export const HINT_TEXT = "Clique num motivo para ver o detalhamento.";

// ---------------------------------------------------------------- Geral

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily", displayName: "Fonte base", value: FONT,
        description: "Usada em todos os textos que continuam com a fonte padrão."
    });
    showBackground = toggle("showBackground", "Cor de fundo do visual", false);
    background = color("background", "Cor de fundo", WHITE);
    padding = num("padding", "Margem interna (px)", 6);

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily, this.showBackground, this.background, this.padding];
}

// ---------------------------------------------------------------- Layout

class LayoutCard extends FormattingSettingsCompositeCard {
    mode = dropdown("mode", "Layout", LAYOUT_ITEMS, 0);
    breakpoint = num("breakpoint", "Virar vertical abaixo de (px)", 520,
        "Em visuais mais estreitos que isso, o horizontal vira acordeão. 0 = nunca.");
    leftWidth = num("leftWidth", "Largura da coluna de motivos (%)", 46);
    linkWidth = num("linkWidth", "Espaço entre as colunas (px)", 72);

    showLinks = toggle("showLinks", "Ligações", true);
    linkStyle = dropdown("linkStyle", "Estilo", LINK_STYLE_ITEMS, 0);
    linkColor = color("linkColor", "Cor", PRIMARY);
    linkOpacity = num("linkOpacity", "Opacidade (%)", 35);

    showColumnTitles = toggle("showColumnTitles", "Títulos das colunas", true);
    reasonsTitle = text("reasonsTitle", "Título dos motivos", "", "Nome do campo", "Em branco, usa o nome do campo.");
    detailsTitle = text("detailsTitle", "Título do detalhamento", "", "Nome do campo", "Em branco, usa o nome do campo.");
    columnTitleFont = new Font("columnTitle", 11, true);
    columnTitleColor = color("columnTitleColor", "Cor", MUTED);
    uppercase = toggle("uppercase", "Letras maiúsculas", true);

    activeFill = color("activeFill", "Cor de fundo", WHITE);
    activeBorderWidth = num("activeBorderWidth", "Espessura da borda (px)", 2);
    activeBorderColor = color("activeBorderColor", "Cor da borda", PRIMARY);

    showActiveHeader = toggle("showActiveHeader", "Motivo em destaque no painel", true);
    activeFont = new Font("active", 18, true);
    activeColor = color("activeColor", "Cor", DARK);
    hint = text("hint", "Texto antes de escolher um motivo", HINT_TEXT, HINT_TEXT);

    name = "layout";
    displayName = "Layout";
    description = "Horizontal: motivos à esquerda e detalhamento à direita, ligados por faixas. Vertical: acordeão.";
    groups: FormattingSettingsGroup[] = [
        group("layoutArrange", "Disposição", [this.mode, this.breakpoint, this.leftWidth, this.linkWidth]),
        group("layoutLinks", "Ligações (horizontal)", [this.linkStyle, this.linkColor, this.linkOpacity], this.showLinks),
        group("layoutTitles", "Títulos das colunas (horizontal)", [
            this.reasonsTitle, this.detailsTitle, this.columnTitleFont, this.columnTitleColor, this.uppercase
        ], this.showColumnTitles),
        group("layoutActive", "Motivo escolhido (horizontal)", [this.activeFill, this.activeBorderWidth, this.activeBorderColor]),
        group("layoutPanel", "Painel do detalhamento (horizontal)", [this.activeFont, this.activeColor, this.hint],
            this.showActiveHeader)
    ];
}

// ---------------------------------------------------------------- Cabeçalho

class HeaderCard extends FormattingSettingsCompositeCard {
    title = text("title", "Texto", "", "Ex.: Motivos de cancelamento", "Em branco, o título fica escondido.");
    titleFont = new Font("title", 20, true);
    titleColor = color("titleColor", "Cor", DARK);
    subtitle = text("subtitle", "Texto", "", "Ex.: Clique num motivo para ver o detalhamento", "Em branco, o subtítulo fica escondido.");
    subtitleFont = new Font("subtitle", 13);
    subtitleColor = color("subtitleColor", "Cor", MUTED);
    showSummary = toggle("showSummary", "Resumo", true);
    summary = text("summary", "Texto", SUMMARY_TEMPLATE, SUMMARY_TEMPLATE, "Marcadores: {total}, {motivos} e {detalhamentos}.");
    summaryFont = new Font("summary", 12);
    summaryColor = color("summaryColor", "Cor", MUTED);
    align = new formattingSettings.AlignmentGroup({
        name: "align", displayName: "Alinhamento", mode: powerbi.visuals.AlignmentGroupMode.Horizonal, value: "left"
    });
    spacing = num("spacing", "Espaço abaixo (px)", 10);

    name = "header";
    displayName = "Cabeçalho";
    groups: FormattingSettingsGroup[] = [
        group("titleGroup", "Título", [this.title, this.titleFont, this.titleColor]),
        group("subtitleGroup", "Subtítulo", [this.subtitle, this.subtitleFont, this.subtitleColor]),
        group("summaryGroup", "Resumo", [this.summary, this.summaryFont, this.summaryColor], this.showSummary),
        group("headerLayout", "Layout", [this.align, this.spacing])
    ];
}

// ---------------------------------------------------------------- Pesquisa e botões

class ToolbarCard extends FormattingSettingsCompositeCard {
    showSearch = toggle("showSearch", "Pesquisa", true);
    placeholder = text("placeholder", "Texto da caixa", SEARCH_PLACEHOLDER, SEARCH_PLACEHOLDER);
    searchFont = new Font("search", 13);
    fontColor = color("fontColor", "Cor do texto", DARK);
    iconColor = color("iconColor", "Cor da lupa", DARK);
    fill = color("fill", "Cor de fundo", WHITE);
    height = num("height", "Altura (px)", 36, "Vale para a caixa de pesquisa e para os botões.");
    radius = num("radius", "Arredondamento (px)", 10);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 1);
    borderColor = color("borderColor", "Cor da borda", PRIMARY);
    markColor = color("markColor", "Cor do destaque do texto achado", PRIMARY);
    noResult = text("noResult", "Texto quando não acha nada", NO_RESULT_TEMPLATE, NO_RESULT_TEMPLATE, "Marcador: {pesquisa}.");

    showExpandAll = toggle("showExpandAll", "Botões abrir/fechar tudo", true);
    buttonFill = color("buttonFill", "Cor de fundo", WHITE);
    buttonIconColor = color("buttonIconColor", "Cor do ícone", DARK);
    buttonRadius = num("buttonRadius", "Arredondamento (px)", 10);
    buttonBorderWidth = num("buttonBorderWidth", "Espessura da borda (px)", 1);
    buttonBorderColor = color("buttonBorderColor", "Cor da borda", PRIMARY);
    buttonShadow = toggle("buttonShadow", "Sombra", true);

    name = "toolbar";
    displayName = "Pesquisa e botões";
    groups: FormattingSettingsGroup[] = [
        group("searchGroup", "Pesquisa", [
            this.placeholder, this.searchFont, this.fontColor, this.iconColor, this.fill, this.height, this.radius,
            this.borderWidth, this.borderColor, this.markColor, this.noResult
        ], this.showSearch),
        group("buttonsGroup", "Botões abrir/fechar tudo", [
            this.buttonFill, this.buttonIconColor, this.buttonRadius, this.buttonBorderWidth, this.buttonBorderColor, this.buttonShadow
        ], this.showExpandAll)
    ];
}

// ---------------------------------------------------------------- Interação e ordenação

class InteractionCard extends FormattingSettingsCard {
    clickMode = dropdown("clickMode", "Clique no motivo", CLICK_MODE_ITEMS, 0);
    accordion = toggle("accordion", "Abrir um motivo por vez", false, "Ao abrir um motivo, os outros se fecham.");
    initial = dropdown("initial", "Ao carregar", INITIAL_ITEMS, 0);
    animate = toggle("animate", "Animação ao abrir", true);
    duration = num("duration", "Duração da animação (ms)", 300);
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 40);

    name = "interaction";
    displayName = "Interação";
    description = "Os detalhamentos sempre filtram os outros visuais ao clicar (Ctrl + clique para vários).";
    slices: FormattingSettingsSlice[] = [
        this.clickMode, this.accordion, this.initial, this.animate, this.duration, this.selectedOpacity
    ];
}

class SortCard extends FormattingSettingsCard {
    orderBy = dropdown("orderBy", "Ordenar por", ORDER_BY_ITEMS, 0);
    direction = dropdown("direction", "Direção", DIRECTION_ITEMS, 0);

    name = "sort";
    displayName = "Ordenação";
    description = "Vale para os motivos e para os detalhamentos. Automática: maior valor primeiro; nome, A–Z.";
    slices: FormattingSettingsSlice[] = [this.orderBy, this.direction];
}

// ---------------------------------------------------------------- Motivos

class ReasonsCard extends FormattingSettingsCompositeCard {
    labelFont = new Font("label", 14, true);
    fontColor = color("fontColor", "Cor do texto", DARK);
    wrap = toggle("wrap", "Quebrar texto longo", false, "Desligado, o texto que não cabe termina em reticências.");

    fill = color("fill", "Cor de fundo", PANEL);
    openFill = color("openFill", "Cor de fundo quando aberto", PANEL);
    radius = num("radius", "Arredondamento (px)", 10);
    gap = num("gap", "Espaço entre motivos (px)", 8);
    paddingX = num("paddingX", "Espaçamento lateral (px)", 12);
    paddingY = num("paddingY", "Espaçamento vertical (px)", 10);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", PRIMARY);
    openShadow = toggle("openShadow", "Sombra quando aberto", true);
    maxItems = num("maxItems", "Motivos visíveis (0 = todos)", 0, "Os demais ficam atrás do botão \"Ver mais\".");

    showRank = toggle("showRank", "Posição (1, 2, 3…)", true);
    rankShape = dropdown("rankShape", "Forma", RANK_SHAPE_ITEMS, 0);
    rankFill = color("rankFill", "Cor de fundo", PRIMARY);
    rankColor = color("rankColor", "Cor do número", DARK);
    rankSize = num("rankSize", "Tamanho (px)", 22);

    showCount = toggle("showCount", "Nº de detalhamentos", true);
    countFontSize = num("countFontSize", "Tamanho da fonte", 11);
    countColor = color("countColor", "Cor", MUTED);
    countSingular = text("countSingular", "Palavra no singular", "detalhamento", "detalhamento");
    countPlural = text("countPlural", "Palavra no plural", "detalhamentos", "detalhamentos");

    showChevron = toggle("showChevron", "Seta", true);
    chevronColor = color("chevronColor", "Cor", DARK);
    chevronSize = num("chevronSize", "Tamanho (px)", 18);
    chevronSide = dropdown("chevronSide", "Posição", SIDE_ITEMS, 0);

    name = "reasons";
    displayName = "Motivos";
    groups: FormattingSettingsGroup[] = [
        group("reasonText", "Texto", [this.labelFont, this.fontColor, this.wrap]),
        group("reasonCard", "Cartão", [
            this.fill, this.openFill, this.radius, this.gap, this.paddingX, this.paddingY, this.borderWidth, this.borderColor,
            this.openShadow, this.maxItems
        ]),
        group("reasonRank", "Posição", [this.rankShape, this.rankFill, this.rankColor, this.rankSize], this.showRank),
        group("reasonCount", "Nº de detalhamentos", [
            this.countFontSize, this.countColor, this.countSingular, this.countPlural
        ], this.showCount),
        group("reasonChevron", "Seta", [this.chevronColor, this.chevronSize, this.chevronSide], this.showChevron)
    ];
}

class ReasonBarsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar barras", true);
    fill = color("fill", "Cor da barra", PRIMARY, "Também é a cor de destaque do foco do teclado.");
    highlightTop = toggle("highlightTop", "Destacar o maior motivo", false);
    highlightColor = color("highlightColor", "Cor do destaque", DARK);
    trackColor = color("trackColor", "Cor do trilho", WHITE);
    thickness = num("thickness", "Espessura (px)", 8);
    radius = num("radius", "Arredondamento (px)", 999, "Valores altos deixam as pontas totalmente arredondadas.");
    scale = dropdown("scale", "Escala", SCALE_ITEMS, 0);

    name = "reasonBars";
    displayName = "Barras dos motivos";
    topLevelSlice = this.show;
    slices: FormattingSettingsSlice[] = [
        this.fill, this.highlightTop, this.highlightColor, this.trackColor, this.thickness, this.radius, this.scale
    ];
}

// ---------------------------------------------------------------- Detalhamentos

class DetailsCard extends FormattingSettingsCompositeCard {
    detailFont = new Font("detail", 13);
    fontColor = color("fontColor", "Cor do texto", DARK);
    wrap = toggle("wrap", "Quebrar texto longo", false, "Desligado, o texto que não cabe termina em reticências.");

    fill = color("fill", "Cor de fundo", WHITE);
    radius = num("radius", "Arredondamento (px)", 8);
    rowHeight = num("rowHeight", "Altura mínima da linha (px)", 30);
    hoverColor = color("hoverColor", "Cor ao passar o mouse", PANEL);

    showBars = toggle("showBars", "Barras", true);
    barFill = color("barFill", "Cor da barra", PRIMARY);
    trackColor = color("trackColor", "Cor do trilho", PANEL);
    thickness = num("thickness", "Espessura (px)", 6);
    barRadius = num("barRadius", "Arredondamento (px)", 999);

    showGuide = toggle("showGuide", "Linha guia", true);
    guideColor = color("guideColor", "Cor", PRIMARY);

    showStrip = toggle("showStrip", "Faixa de composição", true);
    stripColor = color("stripColor", "Cor", PRIMARY, "As fatias usam esta cor, cada vez mais clara.");
    stripHeight = num("stripHeight", "Altura (px)", 8);

    percentBase = dropdown("percentBase", "Percentual", PERCENT_BASE_ITEMS, 0);
    maxItems = num("maxItems", "Detalhamentos visíveis (0 = todos)", 5, "Os demais ficam atrás do botão \"Ver mais\".");
    showBlank = toggle("showBlank", "Mostrar detalhamentos em branco", false);
    moreColor = color("moreColor", "Cor do botão \"Ver mais\"", DARK);

    name = "details";
    displayName = "Detalhamentos";
    groups: FormattingSettingsGroup[] = [
        group("detailText", "Texto", [this.detailFont, this.fontColor, this.wrap]),
        group("detailArea", "Área", [this.fill, this.radius, this.rowHeight, this.hoverColor]),
        group("detailBars", "Barras", [this.barFill, this.trackColor, this.thickness, this.barRadius], this.showBars),
        group("detailGuide", "Linha guia", [this.guideColor], this.showGuide),
        group("detailStrip", "Faixa de composição", [this.stripColor, this.stripHeight], this.showStrip,
            "Barra 100% com a fatia de cada detalhamento no motivo."),
        group("detailContent", "Conteúdo", [this.percentBase, this.maxItems, this.showBlank, this.moreColor])
    ];
}

// ---------------------------------------------------------------- Valores

class ValuesCard extends FormattingSettingsCompositeCard {
    showValue = toggle("showValue", "Valor", true);
    valueFont = new Font("value", 13, true, "Fonte (motivos)");
    valueColor = color("valueColor", "Cor (motivos)", DARK);
    detailValueFontSize = num("detailValueFontSize", "Tamanho da fonte (detalhamentos)", 12);
    detailValueColor = color("detailValueColor", "Cor (detalhamentos)", DARK);
    displayUnits = dropdown("displayUnits", "Unidades de exibição", UNITS_ITEMS, 0);
    valueDecimals = num("valueDecimals", "Casas decimais (-1 = da medida)", -1);

    showPercent = toggle("showPercent", "Percentual", true);
    percentStyle = dropdown("percentStyle", "Estilo", PERCENT_STYLE_ITEMS, 0);
    decimals = num("decimals", "Casas decimais", 1);
    percentFont = new Font("percent", 12, false, "Fonte (motivos)");
    percentColor = color("percentColor", "Cor (motivos)", MUTED);
    detailPercentFontSize = num("detailPercentFontSize", "Tamanho da fonte (detalhamentos)", 11);
    detailPercentColor = color("detailPercentColor", "Cor (detalhamentos)", MUTED);

    name = "values";
    displayName = "Valores";
    groups: FormattingSettingsGroup[] = [
        group("valueGroup", "Valor", [
            this.valueFont, this.valueColor, this.detailValueFontSize, this.detailValueColor, this.displayUnits, this.valueDecimals
        ], this.showValue),
        group("percentGroup", "Percentual", [
            this.percentStyle, this.decimals, this.percentFont, this.percentColor, this.detailPercentFontSize, this.detailPercentColor
        ], this.showPercent)
    ];
}

// ---------------------------------------------------------------- Insight

class InsightCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar insight", true);
    template = text("template", "Texto", INSIGHT_TEMPLATE, INSIGHT_TEMPLATE,
        "Marcadores: {motivo}, {valor}, {percentual}, {detalhe}, {valorDetalhe} e {percentualDetalhe}. " +
        "Frases com marcadores do detalhe somem quando o motivo não tem detalhamento.");
    insightFont = new Font("insight", 12);
    fontColor = color("fontColor", "Cor do texto", DARK);
    boldMarks = toggle("boldMarks", "Destacar os marcadores em negrito", true);
    markColor = color("markColor", "Cor dos marcadores", DARK);

    position = dropdown("position", "Posição", POSITION_ITEMS, 0);
    fill = color("fill", "Cor de fundo", PANEL);
    radius = num("radius", "Arredondamento (px)", 10);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", PRIMARY);
    showIcon = toggle("showIcon", "Mostrar ícone", true);
    iconColor = color("iconColor", "Cor do ícone", PRIMARY);

    name = "insight";
    displayName = "Insight";
    topLevelSlice = this.show;
    groups: FormattingSettingsGroup[] = [
        group("insightText", "Texto", [this.template, this.insightFont, this.fontColor, this.boldMarks, this.markColor]),
        group("insightBox", "Caixa", [
            this.position, this.fill, this.radius, this.borderWidth, this.borderColor, this.showIcon, this.iconColor
        ])
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    layoutCard = new LayoutCard();
    headerCard = new HeaderCard();
    toolbarCard = new ToolbarCard();
    interactionCard = new InteractionCard();
    sortCard = new SortCard();
    reasonsCard = new ReasonsCard();
    reasonBarsCard = new ReasonBarsCard();
    detailsCard = new DetailsCard();
    valuesCard = new ValuesCard();
    insightCard = new InsightCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.layoutCard, this.headerCard, this.toolbarCard, this.interactionCard, this.sortCard,
        this.reasonsCard, this.reasonBarsCard, this.detailsCard, this.valuesCard, this.insightCard
    ];

    /** Alto contraste: fundos ficam com a cor de fundo do tema e o resto com a cor de primeiro plano. */
    public applyHighContrast(foreground: string, background: string): void {
        const backgrounds = new Set([
            "general.background", "toolbar.fill", "toolbar.buttonFill", "reasons.fill", "reasons.openFill", "reasons.rankColor",
            "reasonBars.trackColor", "details.fill", "details.trackColor", "details.hoverColor", "insight.fill",
            "layout.activeFill"
        ]);
        for (const card of this.cards) {
            const slices = "groups" in card ? card.groups.flatMap(g => g.slices || []) : card.slices || [];
            for (const slice of slices) {
                if (slice instanceof formattingSettings.ColorPicker) {
                    slice.value = { value: backgrounds.has(card.name + "." + slice.name) ? background : foreground };
                }
            }
        }
        this.reasonsCard.borderWidth.value = Math.max(1, this.reasonsCard.borderWidth.value);
        this.toolbarCard.borderWidth.value = Math.max(1, this.toolbarCard.borderWidth.value);
        this.toolbarCard.buttonBorderWidth.value = Math.max(1, this.toolbarCard.buttonBorderWidth.value);
    }
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
