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

/** Textos padrão. Marcadores do resumo: {total}, {motivos}, {detalhamentos}. */
export const SUMMARY_TEMPLATE = "{total} no total · {motivos} motivos";
/** Marcadores do insight: {motivo}, {valor}, {percentual}, {detalhe}, {valorDetalhe}, {percentualDetalhe}. */
export const INSIGHT_TEMPLATE = "{motivo} é o principal motivo, com {percentual} do total. Dentro dele, destaca-se {detalhe} ({percentualDetalhe}).";
export const SEARCH_PLACEHOLDER = "Pesquisar motivo ou detalhamento";

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

export const CLICK_MODE_ITEMS = enumItems(["expandFilter", "Abrir e filtrar os outros visuais"], ["expand", "Só abrir e fechar"]);
export const INITIAL_ITEMS = enumItems(["first", "Primeiro motivo aberto"], ["none", "Todos fechados"], ["all", "Todos abertos"]);
export const ORDER_BY_ITEMS = enumItems(["value", "Valor"], ["name", "Nome (A–Z)"], ["data", "Ordem do Power BI"]);
export const DIRECTION_ITEMS = enumItems(["auto", "Automática"], ["desc", "Decrescente"], ["asc", "Crescente"]);
export const SCALE_ITEMS = enumItems(["max", "Maior motivo = barra cheia"], ["total", "Total = barra cheia"]);
export const PERCENT_BASE_ITEMS = enumItems(["reason", "Do motivo"], ["total", "Do total"]);

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily];
}

class HeaderCard extends FormattingSettingsCard {
    title = text("title", "Título", "", "Ex.: Motivos de cancelamento");
    titleSize = num("titleSize", "Tamanho do título", 20);
    titleColor = color("titleColor", "Cor do título", DARK);
    subtitle = text("subtitle", "Subtítulo", "", "Ex.: Clique num motivo para ver o detalhamento");
    subtitleSize = num("subtitleSize", "Tamanho do subtítulo", 13);
    subtitleColor = color("subtitleColor", "Cor do subtítulo", MUTED);
    showSummary = toggle("showSummary", "Mostrar resumo", true);
    summary = text("summary", "Texto do resumo", SUMMARY_TEMPLATE, SUMMARY_TEMPLATE,
        "Marcadores: {total}, {motivos} e {detalhamentos}.");
    summarySize = num("summarySize", "Tamanho do resumo", 12);
    summaryColor = color("summaryColor", "Cor do resumo", MUTED);

    name = "header";
    displayName = "Cabeçalho";
    description = "Título, subtítulo e resumo dentro do visual (título e subtítulo em branco ficam escondidos).";
    slices: FormattingSettingsSlice[] = [
        this.title, this.titleSize, this.titleColor, this.subtitle, this.subtitleSize, this.subtitleColor,
        this.showSummary, this.summary, this.summarySize, this.summaryColor
    ];
}

class ToolbarCard extends FormattingSettingsCard {
    showSearch = toggle("showSearch", "Mostrar pesquisa", true);
    placeholder = text("placeholder", "Texto da caixa de pesquisa", SEARCH_PLACEHOLDER, SEARCH_PLACEHOLDER);
    showExpandAll = toggle("showExpandAll", "Botões abrir/fechar tudo", true);
    fill = color("fill", "Cor de fundo", WHITE);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    height = num("height", "Altura (px)", 36);
    radius = num("radius", "Arredondamento (px)", 10);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 1);
    borderColor = color("borderColor", "Cor da borda", PRIMARY);

    name = "toolbar";
    displayName = "Pesquisa e botões";
    slices: FormattingSettingsSlice[] = [
        this.showSearch, this.placeholder, this.showExpandAll, this.fill, this.fontColor, this.fontSize,
        this.height, this.radius, this.borderWidth, this.borderColor
    ];
}

class InteractionCard extends FormattingSettingsCard {
    clickMode = dropdown("clickMode", "Clique no motivo", CLICK_MODE_ITEMS, 0);
    accordion = toggle("accordion", "Abrir um motivo por vez", false, "Ao abrir um motivo, os outros se fecham.");
    initial = dropdown("initial", "Ao carregar", INITIAL_ITEMS, 0);
    animate = toggle("animate", "Animação ao abrir", true);
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 40);

    name = "interaction";
    displayName = "Interação";
    description = "Os detalhamentos sempre filtram os outros visuais ao clicar (Ctrl + clique para vários).";
    slices: FormattingSettingsSlice[] = [this.clickMode, this.accordion, this.initial, this.animate, this.selectedOpacity];
}

class SortCard extends FormattingSettingsCard {
    orderBy = dropdown("orderBy", "Ordenar por", ORDER_BY_ITEMS, 0);
    direction = dropdown("direction", "Direção", DIRECTION_ITEMS, 0);

    name = "sort";
    displayName = "Ordenação";
    description = "Vale para os motivos e para os detalhamentos. Automática: maior valor primeiro; nome, A–Z.";
    slices: FormattingSettingsSlice[] = [this.orderBy, this.direction];
}

class ReasonsCard extends FormattingSettingsCard {
    fill = color("fill", "Cor de fundo", PANEL);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 14);
    bold = toggle("bold", "Negrito", true);
    showRank = toggle("showRank", "Mostrar posição (1, 2, 3…)", true);
    rankFill = color("rankFill", "Cor de fundo da posição", PRIMARY);
    rankColor = color("rankColor", "Cor do número da posição", DARK);
    showCount = toggle("showCount", "Mostrar nº de detalhamentos", true);
    radius = num("radius", "Arredondamento (px)", 10);
    gap = num("gap", "Espaço entre motivos (px)", 8);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", PRIMARY);
    maxItems = num("maxItems", "Motivos visíveis (0 = todos)", 0, "Os demais ficam atrás do botão \"Ver mais\".");

    name = "reasons";
    displayName = "Motivos";
    slices: FormattingSettingsSlice[] = [
        this.fill, this.fontColor, this.fontSize, this.bold, this.showRank, this.rankFill, this.rankColor,
        this.showCount, this.radius, this.gap, this.borderWidth, this.borderColor, this.maxItems
    ];
}

class ReasonBarsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar barras", true);
    fill = color("fill", "Cor da barra", PRIMARY);
    trackColor = color("trackColor", "Cor do trilho", WHITE);
    thickness = num("thickness", "Espessura (px)", 8);
    radius = num("radius", "Arredondamento (px)", 999, "Valores altos deixam as pontas totalmente arredondadas.");
    scale = dropdown("scale", "Escala", SCALE_ITEMS, 0);

    name = "reasonBars";
    displayName = "Barras dos motivos";
    slices: FormattingSettingsSlice[] = [this.show, this.fill, this.trackColor, this.thickness, this.radius, this.scale];
}

class DetailsCard extends FormattingSettingsCard {
    fill = color("fill", "Cor de fundo", WHITE);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    bold = toggle("bold", "Negrito", false);
    barFill = color("barFill", "Cor da barra", PRIMARY);
    trackColor = color("trackColor", "Cor do trilho", PANEL);
    thickness = num("thickness", "Espessura da barra (px)", 6);
    guideColor = color("guideColor", "Cor da linha guia", PRIMARY);
    percentBase = dropdown("percentBase", "Percentual", PERCENT_BASE_ITEMS, 0);
    maxItems = num("maxItems", "Detalhamentos visíveis (0 = todos)", 5, "Os demais ficam atrás do botão \"Ver mais\".");
    showStrip = toggle("showStrip", "Mostrar faixa de composição", true, "Barra 100% com a fatia de cada detalhamento no motivo.");
    showBlank = toggle("showBlank", "Mostrar detalhamentos em branco", false);

    name = "details";
    displayName = "Detalhamentos";
    slices: FormattingSettingsSlice[] = [
        this.fill, this.fontColor, this.fontSize, this.bold, this.barFill, this.trackColor, this.thickness,
        this.guideColor, this.percentBase, this.maxItems, this.showStrip, this.showBlank
    ];
}

class ValuesCard extends FormattingSettingsCard {
    showValue = toggle("showValue", "Mostrar valor", true);
    showPercent = toggle("showPercent", "Mostrar percentual", true);
    decimals = num("decimals", "Casas decimais do percentual", 1);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    valueColor = color("valueColor", "Cor do valor", DARK);
    percentColor = color("percentColor", "Cor do percentual", MUTED);
    bold = toggle("bold", "Valor em negrito", true);

    name = "values";
    displayName = "Valores";
    slices: FormattingSettingsSlice[] = [
        this.showValue, this.showPercent, this.decimals, this.fontSize, this.valueColor, this.percentColor, this.bold
    ];
}

class InsightCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar insight", true);
    template = text("template", "Texto", INSIGHT_TEMPLATE, INSIGHT_TEMPLATE,
        "Marcadores: {motivo}, {valor}, {percentual}, {detalhe}, {valorDetalhe} e {percentualDetalhe}. " +
        "Frases com marcadores do detalhe somem quando o motivo não tem detalhamento.");
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fill = color("fill", "Cor de fundo", PANEL);

    name = "insight";
    displayName = "Insight";
    slices: FormattingSettingsSlice[] = [this.show, this.template, this.fontSize, this.fontColor, this.fill];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
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
        this.generalCard, this.headerCard, this.toolbarCard, this.interactionCard, this.sortCard,
        this.reasonsCard, this.reasonBarsCard, this.detailsCard, this.valuesCard, this.insightCard
    ];

    /** Alto contraste: fundos ficam com a cor de fundo do tema e o resto com a cor de primeiro plano. */
    public applyHighContrast(foreground: string, background: string): void {
        const backgrounds = new Set([
            "toolbar.fill", "reasons.fill", "reasons.rankColor", "reasonBars.trackColor", "details.fill", "details.trackColor", "insight.fill"
        ]);
        for (const card of this.cards as FormattingSettingsCard[]) {
            for (const slice of card.slices) {
                if (slice instanceof formattingSettings.ColorPicker) {
                    slice.value = { value: backgrounds.has(card.name + "." + slice.name) ? background : foreground };
                }
            }
        }
        this.reasonsCard.borderWidth.value = Math.max(1, this.reasonsCard.borderWidth.value);
        this.toolbarCard.borderWidth.value = Math.max(1, this.toolbarCard.borderWidth.value);
    }
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
