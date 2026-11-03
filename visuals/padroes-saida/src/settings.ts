"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsCompositeCard = formattingSettings.CompositeCard;
import FormattingSettingsGroup = formattingSettings.Group;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;
import FontControl = formattingSettings.FontControl;

/** Cores padrão do repositório (ver DESIGN.md na raiz). */
export const PRIMARY = "#6CBEEB";
export const DARK = "#0F2B45";
export const PANEL = "#F1F8FD";
export const WHITE = "#FFFFFF";
export const MUTED = "#4E6175";
export const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/**
 * Textos padrão dos padrões. Marcadores: {padrao}, {saidas}, {total}, {pct}, {base}, {pctBase},
 * {taxa}, {media}, {lift} e {excesso}.
 */
export const RATE_TEMPLATE = "Taxa de {taxa} contra {media} na média ({lift}) · {saidas} saídas, {pct} do total.";
export const SHARE_TEMPLATE = "{pct} das saídas ({saidas} de {total}).";

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

/**
 * Fonte completa (família, tamanho, negrito, itálico, sublinhado). As propriedades ficam com o
 * prefixo dado (ex.: titleFontFamily, titleFontSize, titleBold…), únicas dentro do cartão.
 * A família padrão segue a "Fonte base" do cartão Geral.
 */
const font = (prefix: string, size: number, bold = false, displayName = "Fonte"): FontControl =>
    new formattingSettings.FontControl({
        name: prefix + "Font",
        displayName,
        fontFamily: new formattingSettings.FontPicker({ name: prefix + "FontFamily", value: FONT }),
        fontSize: new formattingSettings.NumUpDown({ name: prefix + "FontSize", value: size }),
        bold: new formattingSettings.ToggleSwitch({ name: prefix + "Bold", value: bold }),
        italic: new formattingSettings.ToggleSwitch({ name: prefix + "Italic", value: false }),
        underline: new formattingSettings.ToggleSwitch({ name: prefix + "Underline", value: false })
    });

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
export const ALIGN_ITEMS = enumItems(["left", "À esquerda"], ["center", "Centralizado"], ["right", "À direita"]);
export const SIDE_ITEMS = enumItems(["right", "À direita"], ["left", "À esquerda"]);
export const POSITION_ITEMS = enumItems(
    ["auto", "Automática (ao lado do título; sem título, no rodapé)"],
    ["top", "Em cima"],
    ["bottom", "Embaixo (no rodapé)"]
);

/** Fatias de caixa (fundo, borda, arredondamento, espaçamento interno e sombra) com prefixo. */
class Box {
    background: formattingSettings.ColorPicker;
    borderWidth: formattingSettings.NumUpDown;
    borderColor: formattingSettings.ColorPicker;
    radius: formattingSettings.NumUpDown;
    padding: formattingSettings.NumUpDown;
    shadow: formattingSettings.ToggleSwitch;

    constructor(prefix: string, background: string, radius: number, padding: number, shadow: boolean) {
        const p = (name: string): string => (prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name);
        this.background = color(p("background"), "Cor de fundo", background);
        this.borderWidth = num(p("borderWidth"), "Espessura da borda (px)", 0);
        this.borderColor = color(p("borderColor"), "Cor da borda", DARK);
        this.radius = num(p("radius"), "Arredondamento (px)", radius);
        this.padding = num(p("padding"), "Espaçamento interno (px)", padding);
        this.shadow = toggle(p("shadow"), "Sombra", shadow);
    }

    get slices(): FormattingSettingsSlice[] {
        return [this.background, this.borderWidth, this.borderColor, this.radius, this.padding, this.shadow];
    }
}

// ---------------------------------------------------------------- cartões

class GeneralCard extends FormattingSettingsCompositeCard {
    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Fonte base",
        description: "Usada em todos os textos que estão com a fonte padrão. Cada parte também tem a sua fonte.",
        value: FONT
    });
    background = color("background", "Cor de fundo", WHITE);
    transparency = num("transparency", "Transparência do fundo (%)", 100, "100 = sem fundo (só o fundo do Power BI).");
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);
    radius = num("radius", "Arredondamento (px)", 0);
    padding = num("padding", "Espaçamento interno (px)", 6);
    gap = num("gap", "Espaço entre os blocos (px)", 10);

    name = "general";
    displayName = "Geral";
    groups: FormattingSettingsGroup[] = [
        group("generalFont", "Fonte", [this.fontFamily]),
        group("generalBox", "Fundo e borda do visual", [this.background, this.transparency, this.borderWidth, this.borderColor, this.radius]),
        group("generalSpacing", "Espaçamento", [this.padding, this.gap])
    ];
}

class HeaderCard extends FormattingSettingsCompositeCard {
    title = text("title", "Título", "", "Ex.: Padrões de saída");
    titleFont = font("title", 20, true);
    titleColor = color("titleColor", "Cor", DARK);
    subtitle = text("subtitle", "Subtítulo", "", "Ex.: Quem mais sai, nos filtros da página");
    subtitleFont = font("subtitle", 13);
    subtitleColor = color("subtitleColor", "Cor", MUTED);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);
    background = color("background", "Cor de fundo", WHITE);
    transparency = num("transparency", "Transparência do fundo (%)", 100);
    padding = num("padding", "Espaçamento interno (px)", 0);

    name = "header";
    displayName = "Cabeçalho";
    description = "Título e subtítulo dentro do visual (deixe em branco para esconder).";
    groups: FormattingSettingsGroup[] = [
        group("headerTitle", "Título", [this.title, this.titleFont, this.titleColor]),
        group("headerSubtitle", "Subtítulo", [this.subtitle, this.subtitleFont, this.subtitleColor]),
        group("headerLayout", "Alinhamento e fundo", [this.align, this.background, this.transparency, this.padding])
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

class HighlightCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar destaque", true);
    content = dropdown("content", "Conteúdo", CONTENT_ITEMS, 0);
    box = new Box("", PRIMARY, 14, 16, true);
    label = text("label", "Texto do rótulo", "Padrão das saídas", "Ex.: Padrão dos cancelamentos (em branco = sem rótulo)");
    labelFont = font("label", 12, true);
    labelColor = color("labelColor", "Cor", DARK);
    labelUppercase = toggle("labelUppercase", "Letras maiúsculas", true);
    textFont = font("text", 13);
    textColor = color("textColor", "Cor", DARK);
    showMetric = toggle("showMetric", "Mostrar número em destaque", true);
    metricFont = font("metric", 30, true);
    metricColor = color("metricColor", "Cor", DARK);
    captionRate = text("captionRate", "Legenda (com Base)", "a taxa média");
    captionShare = text("captionShare", "Legenda (concentração)", "do total");
    captionFont = font("caption", 12, false, "Fonte da legenda");
    captionColor = color("captionColor", "Cor da legenda", DARK);
    showDivider = toggle("showDivider", "Linha divisória", true);
    dividerColor = color("dividerColor", "Cor da linha divisória", DARK);

    name = "highlight";
    displayName = "Destaque";
    description = "Cartão principal com a regra que melhor descreve as saídas.";
    groups: FormattingSettingsGroup[] = [
        group("highlightGeneral", "Geral", [this.show, this.content]),
        group("highlightBox", "Cartão", this.box.slices),
        group("highlightLabel", "Rótulo", [this.label, this.labelFont, this.labelColor, this.labelUppercase]),
        group("highlightText", "Frase", [this.textFont, this.textColor]),
        group("highlightMetric", "Número em destaque", [
            this.showMetric, this.metricFont, this.metricColor, this.captionRate, this.captionShare, this.captionFont,
            this.captionColor, this.showDivider, this.dividerColor
        ])
    ];
}

class PatternsCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar lista de padrões", true);
    count = num("count", "Quantidade de padrões", 6);
    minWidth = num("minWidth", "Largura mínima do cartão (px)", 260, "Os cartões se organizam em colunas conforme a largura do visual.");
    gap = num("gap", "Espaço entre os cartões (px)", 10);
    box = new Box("", PANEL, 10, 13, false);
    textFont = font("text", 12);
    textColor = color("textColor", "Cor", DARK);
    showMetric = toggle("showMetric", "Mostrar número", true);
    metricFont = font("metric", 18, true);
    metricColor = color("metricColor", "Cor", DARK);
    showBar = toggle("showBar", "Mostrar barra", true);
    barColor = color("barColor", "Cor da barra", PRIMARY);
    trackColor = color("trackColor", "Cor do trilho", WHITE);
    averageColor = color("averageColor", "Cor da marca da média", DARK);
    barHeight = num("barHeight", "Espessura (px)", 8);
    barRadius = num("barRadius", "Arredondamento (px)", 999);
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 35);

    name = "patterns";
    displayName = "Padrões";
    groups: FormattingSettingsGroup[] = [
        group("patternsGeneral", "Geral", [this.show, this.count, this.minWidth, this.gap, this.selectedOpacity]),
        group("patternsBox", "Cartão", this.box.slices),
        group("patternsText", "Frase", [this.textFont, this.textColor]),
        group("patternsMetric", "Número", [this.showMetric, this.metricFont, this.metricColor]),
        group("patternsBar", "Barra", [
            this.showBar, this.barColor, this.trackColor, this.averageColor, this.barHeight, this.barRadius
        ])
    ];
}

/** Estilo de uma etiqueta (destaque ou padrões). */
class ChipStyle {
    font: FontControl;
    color: formattingSettings.ColorPicker;
    background: formattingSettings.ColorPicker;
    borderWidth: formattingSettings.NumUpDown;
    borderColor: formattingSettings.ColorPicker;
    radius: formattingSettings.NumUpDown;
    paddingX: formattingSettings.NumUpDown;
    paddingY: formattingSettings.NumUpDown;

    constructor(prefix: string, size: number) {
        this.font = font(prefix, size, true);
        this.color = color(prefix + "Color", "Cor do texto", DARK);
        this.background = color(prefix + "Background", "Cor de fundo", WHITE);
        this.borderWidth = num(prefix + "BorderWidth", "Espessura da borda (px)", 0);
        this.borderColor = color(prefix + "BorderColor", "Cor da borda", DARK);
        this.radius = num(prefix + "Radius", "Arredondamento (px)", 8);
        this.paddingX = num(prefix + "PaddingX", "Espaçamento lateral (px)", 9);
        this.paddingY = num(prefix + "PaddingY", "Espaçamento vertical (px)", 3);
    }

    get slices(): FormattingSettingsSlice[] {
        return [this.font, this.color, this.background, this.borderWidth, this.borderColor, this.radius, this.paddingX, this.paddingY];
    }
}

class ChipsCard extends FormattingSettingsCompositeCard {
    showAttribute = toggle("showAttribute", "Mostrar nome do atributo", true, "Ex.: \"Senioridade: Sênior\" em vez de \"Sênior\".");
    separator = text("separator", "Separador entre atributo e valor", ": ");
    hero = new ChipStyle("hero", 13);
    card = new ChipStyle("card", 13);

    name = "chips";
    displayName = "Etiquetas dos atributos";
    description = "Cada condição do padrão (ex.: Senioridade: Sênior) aparece como uma etiqueta.";
    groups: FormattingSettingsGroup[] = [
        group("chipsGeneral", "Geral", [this.showAttribute, this.separator]),
        group("chipsHero", "No destaque", this.hero.slices),
        group("chipsCard", "Nos padrões", this.card.slices)
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

    name = "texts";
    displayName = "Textos";
    description = "O termo aparece no rodapé, nas dicas de ferramenta e na ajuda; nos textos dos padrões, edite as frases acima.";
    slices: FormattingSettingsSlice[] = [this.rateTemplate, this.shareTemplate, this.term];
}

class FooterCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar nota de rodapé", true);
    font = font("footer", 11);
    color = color("color", "Cor", MUTED);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);

    name = "footer";
    displayName = "Rodapé";
    description = "Taxa média de referência e quantos padrões foram encontrados.";
    slices: FormattingSettingsSlice[] = [this.show, this.font, this.color, this.align];
}

class HelpCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar botão de ajuda", true);
    text = text("text", "Texto do botão", "Como ler", "Em branco = só o ícone");
    showIcon = toggle("showIcon", "Mostrar ícone", true);
    position = dropdown("position", "Posição", POSITION_ITEMS, 0);
    side = dropdown("side", "Lado", SIDE_ITEMS, 0);
    font = font("button", 12, true);
    color = color("color", "Cor do texto e do ícone", DARK);
    background = color("background", "Cor de fundo", PANEL);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);
    radius = num("radius", "Arredondamento (px)", 14);
    height = num("height", "Altura (px)", 28);
    shadow = toggle("shadow", "Sombra", true);

    name = "help";
    displayName = "Botão de ajuda";
    description = "Abre um pop-up que explica para o usuário como as contas são feitas e o que significa cada número.";
    groups: FormattingSettingsGroup[] = [
        group("helpGeneral", "Geral", [this.show, this.text, this.showIcon, this.position, this.side]),
        group("helpButton", "Botão", [
            this.font, this.color, this.background, this.borderWidth, this.borderColor, this.radius, this.height, this.shadow
        ])
    ];
}

class PopupCard extends FormattingSettingsCompositeCard {
    width = num("width", "Largura (px)", 600, "O pop-up abre dentro da área do visual: se ela for menor, ele encolhe para caber.");
    height = num("height", "Altura (px)", 460);
    title = text("title", "Título", "Como ler este visual");
    showExample = toggle("showExample", "Conta passo a passo (com os números atuais)", true);
    showRules = toggle("showRules", "Quando um perfil vira padrão", true);
    showGlossary = toggle("showGlossary", "O que significa cada número", true);
    showCautions = toggle("showCautions", "Cuidados na leitura", true);
    extraTitle = text("extraTitle", "Título da seção extra", "Observações");
    extraText = new formattingSettings.TextArea({
        name: "extraText",
        displayName: "Texto extra",
        description: "Aparece no fim do pop-up (ex.: fonte dos dados, contato do time de People Analytics).",
        value: "",
        placeholder: "Ex.: Dados do sistema de RH, atualizados todo dia 5."
    });
    box = new Box("", WHITE, 14, 22, true);
    overlayColor = color("overlayColor", "Cor do fundo atrás do pop-up", DARK);
    overlayOpacity = num("overlayOpacity", "Opacidade do fundo atrás (%)", 35);
    accent = color("accent", "Cor dos quadros (exemplo e fórmulas)", PANEL);
    accentText = color("accentText", "Cor do texto dos quadros", DARK);
    closeColor = color("closeColor", "Cor do botão fechar", DARK);
    titleFont = font("title", 18, true);
    titleColor = color("titleColor", "Cor", DARK);
    headingFont = font("heading", 14, true);
    headingColor = color("headingColor", "Cor", DARK);
    textFont = font("text", 13);
    textColor = color("textColor", "Cor", DARK);

    name = "popup";
    displayName = "Pop-up de ajuda";
    groups: FormattingSettingsGroup[] = [
        group("popupSize", "Tamanho", [this.width, this.height]),
        group("popupContent", "Conteúdo", [
            this.title, this.showExample, this.showRules, this.showGlossary, this.showCautions, this.extraTitle, this.extraText
        ]),
        group("popupBox", "Janela", this.box.slices.concat([
            this.overlayColor, this.overlayOpacity, this.accent, this.accentText, this.closeColor
        ])),
        group("popupTitle", "Título", [this.titleFont, this.titleColor]),
        group("popupHeading", "Títulos das seções", [this.headingFont, this.headingColor]),
        group("popupText", "Texto", [this.textFont, this.textColor])
    ];
}

class GuideCard extends FormattingSettingsCompositeCard {
    show = toggle("show", "Mostrar guia de medidas no visual", false,
        "Para quem desenvolve: explica como devem ser as medidas e confere os dados atuais. Desligue antes de publicar.");
    warnings = toggle("warnings", "Avisar sobre problemas nas medidas (só na edição)", true,
        "Mostra um aviso no rodapé quando os dados parecem errados (ex.: Saídas com casas decimais, Base vazia).");
    box = new Box("", PANEL, 14, 18, false);
    font = font("guide", 12);
    color = color("color", "Cor do texto", DARK);
    codeBackground = color("codeBackground", "Fundo dos exemplos de DAX", WHITE);
    warningColor = color("warningColor", "Cor dos avisos", DARK);

    name = "guide";
    displayName = "Guia de medidas";
    description = "Explicação para quem desenvolve o relatório. Também aparece enquanto faltam campos.";
    groups: FormattingSettingsGroup[] = [
        group("guideGeneral", "Geral", [this.show, this.warnings]),
        group("guideBox", "Quadro", this.box.slices),
        group("guideText", "Texto", [this.font, this.color, this.codeBackground, this.warningColor])
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
    footerCard = new FooterCard();
    helpCard = new HelpCard();
    popupCard = new PopupCard();
    guideCard = new GuideCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.headerCard, this.analysisCard, this.highlightCard, this.patternsCard,
        this.chipsCard, this.textsCard, this.footerCard, this.helpCard, this.popupCard, this.guideCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
