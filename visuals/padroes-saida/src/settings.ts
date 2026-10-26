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

/**
 * Textos padrão dos padrões. Marcadores: {padrao}, {saidas}, {total}, {pct}, {base}, {pctBase},
 * {taxa}, {media}, {lift} e {excesso}.
 */
export const RATE_TEMPLATE = "Taxa de {taxa} contra {media} na média ({lift}) · {saidas} saídas, {pct} do total.";
export const SHARE_TEMPLATE = "{pct} das saídas ({saidas} de {total}).";

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

export const MODE_ITEMS = enumItems(
    ["auto", "Automático (taxa, se houver Base)"],
    ["rate", "Taxa comparada à média"],
    ["share", "Concentração das saídas"]
);
export const CONFIDENCE_ITEMS = enumItems(["none", "Nenhuma"], ["90", "90%"], ["95", "95%"], ["99", "99%"]);
export const RANK_ITEMS = enumItems(
    ["auto", "Automático"],
    ["excess", "Saídas acima do esperado"],
    ["lift", "Quanto acima da média (×)"],
    ["exits", "Número de saídas"]
);
export const CONTENT_ITEMS = enumItems(["profile", "Perfil (regra com vários atributos)"], ["top", "Padrão mais forte da lista"]);

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily];
}

class HeaderCard extends FormattingSettingsCard {
    title = text("title", "Título", "", "Ex.: Padrões de saída");
    titleSize = num("titleSize", "Tamanho do título", 20);
    titleColor = color("titleColor", "Cor do título", DARK);
    subtitle = text("subtitle", "Subtítulo", "", "Ex.: Quem mais sai, nos filtros da página");
    subtitleSize = num("subtitleSize", "Tamanho do subtítulo", 13);
    subtitleColor = color("subtitleColor", "Cor do subtítulo", MUTED);

    name = "header";
    displayName = "Cabeçalho";
    description = "Título e subtítulo dentro do visual (deixe em branco para esconder).";
    slices: FormattingSettingsSlice[] = [
        this.title, this.titleSize, this.titleColor, this.subtitle, this.subtitleSize, this.subtitleColor
    ];
}

class AnalysisCard extends FormattingSettingsCard {
    mode = dropdown("mode", "Comparar por", MODE_ITEMS, 0);
    maxDepth = num("maxDepth", "Máximo de atributos por padrão (1 a 4)", 3);
    minExits = num("minExits", "Mínimo de saídas no padrão", 5,
        "Padrões com menos saídas que isso são ignorados (evita conclusões com poucos casos).");
    minLift = num("minLift", "Quanto acima da média, no mínimo (×)", 1.2,
        "Ex.: 1,2 = taxa pelo menos 20% acima da taxa média.");
    confidence = dropdown("confidence", "Confiança estatística", CONFIDENCE_ITEMS, 1);
    minShare = num("minShare", "% mínima das saídas", 20, "Padrões com uma fatia menor das saídas são ignorados.");
    dominance = num("dominance", "Predominância para combinar (%)", 50,
        "Um atributo só entra na combinação se pelo menos esta % das saídas do grupo anterior também o tiver.");
    rankBy = dropdown("rankBy", "Ordenar padrões por", RANK_ITEMS, 0);
    hideBlanks = toggle("hideBlanks", "Ignorar valores em branco", true);

    name = "analysis";
    displayName = "Análise";
    description = "Com Base, compara a taxa de saída de cada perfil com a média. Sem Base, mostra onde as saídas se concentram.";
    slices: FormattingSettingsSlice[] = [
        this.mode, this.maxDepth, this.minExits, this.minLift, this.confidence, this.minShare, this.dominance,
        this.rankBy, this.hideBlanks
    ];
}

class HighlightCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar destaque", true);
    content = dropdown("content", "Conteúdo", CONTENT_ITEMS, 0);
    label = text("label", "Rótulo", "Padrão das saídas", "Ex.: Padrão dos cancelamentos");
    showMetric = toggle("showMetric", "Mostrar número em destaque", true);
    background = color("background", "Cor de fundo", PRIMARY);
    fontColor = color("fontColor", "Cor do texto", DARK);
    labelSize = num("labelSize", "Tamanho do rótulo", 12);
    textSize = num("textSize", "Tamanho do texto", 13);
    metricSize = num("metricSize", "Tamanho do número", 30);
    radius = num("radius", "Arredondamento (px)", 14);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);

    name = "highlight";
    displayName = "Destaque";
    description = "Cartão principal com a regra que melhor descreve as saídas.";
    slices: FormattingSettingsSlice[] = [
        this.show, this.content, this.label, this.showMetric, this.background, this.fontColor, this.labelSize,
        this.textSize, this.metricSize, this.radius, this.borderWidth, this.borderColor
    ];
}

class PatternsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar lista de padrões", true);
    count = num("count", "Quantidade de padrões", 6);
    minWidth = num("minWidth", "Largura mínima do cartão (px)", 260, "Os cartões se organizam em colunas conforme a largura do visual.");
    background = color("background", "Cor de fundo", PANEL);
    fontColor = color("fontColor", "Cor do texto", DARK);
    textSize = num("textSize", "Tamanho do texto", 12);
    metricSize = num("metricSize", "Tamanho do número", 18);
    radius = num("radius", "Arredondamento (px)", 10);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);
    showBar = toggle("showBar", "Mostrar barra", true);
    barColor = color("barColor", "Cor da barra", PRIMARY);
    trackColor = color("trackColor", "Cor do trilho", WHITE);
    averageColor = color("averageColor", "Cor da marca da média", DARK);
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 35);

    name = "patterns";
    displayName = "Padrões";
    slices: FormattingSettingsSlice[] = [
        this.show, this.count, this.minWidth, this.background, this.fontColor, this.textSize, this.metricSize,
        this.radius, this.borderWidth, this.borderColor, this.showBar, this.barColor, this.trackColor,
        this.averageColor, this.selectedOpacity
    ];
}

class ChipsCard extends FormattingSettingsCard {
    showAttribute = toggle("showAttribute", "Mostrar nome do atributo", true);
    background = color("background", "Cor de fundo", WHITE);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    radius = num("radius", "Arredondamento (px)", 8);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);

    name = "chips";
    displayName = "Etiquetas dos atributos";
    description = "Cada condição do padrão (ex.: Senioridade: Sênior) aparece como uma etiqueta.";
    slices: FormattingSettingsSlice[] = [
        this.showAttribute, this.background, this.fontColor, this.fontSize, this.radius, this.borderWidth, this.borderColor
    ];
}

class TextsCard extends FormattingSettingsCard {
    rateTemplate = new formattingSettings.TextInput({
        name: "rateTemplate",
        displayName: "Texto (com Base)",
        description: "Marcadores: {padrao}, {saidas}, {total}, {pct}, {base}, {pctBase}, {taxa}, {media}, {lift}, {excesso}.",
        value: RATE_TEMPLATE,
        placeholder: RATE_TEMPLATE
    });
    shareTemplate = new formattingSettings.TextInput({
        name: "shareTemplate",
        displayName: "Texto (concentração)",
        description: "Marcadores: {padrao}, {saidas}, {total} e {pct}.",
        value: SHARE_TEMPLATE,
        placeholder: SHARE_TEMPLATE
    });
    term = text("term", "Termo para as saídas", "saídas", "Ex.: cancelamentos, desligamentos");
    showFooter = toggle("showFooter", "Mostrar nota de rodapé", true);
    footerColor = color("footerColor", "Cor da nota", MUTED);
    footerSize = num("footerSize", "Tamanho da nota", 11);

    name = "texts";
    displayName = "Textos";
    description = "O termo aparece no rodapé e nas dicas de ferramenta; nos textos dos padrões, edite as frases acima.";
    slices: FormattingSettingsSlice[] = [
        this.rateTemplate, this.shareTemplate, this.term, this.showFooter, this.footerColor, this.footerSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    headerCard = new HeaderCard();
    analysisCard = new AnalysisCard();
    highlightCard = new HighlightCard();
    patternsCard = new PatternsCard();
    chipsCard = new ChipsCard();
    textsCard = new TextsCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.headerCard, this.analysisCard, this.highlightCard, this.patternsCard,
        this.chipsCard, this.textsCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
