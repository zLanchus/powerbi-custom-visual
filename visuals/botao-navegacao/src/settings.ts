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
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

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

export const LAYOUT_ITEMS = enumItems(
    ["spread", "Texto à esquerda, seta na ponta"],
    ["left", "Tudo à esquerda"],
    ["center", "Tudo centralizado"]
);
export const SHADOW_ITEMS = enumItems(["none", "Sem sombra"], ["soft", "Leve"], ["medium", "Média"], ["strong", "Forte"]);
export const ICON_ITEMS = enumItems(
    ["chart", "Gráfico"],
    ["page", "Página"],
    ["table", "Tabela"],
    ["people", "Pessoas"],
    ["home", "Início"],
    ["filter", "Filtro"],
    ["calendar", "Calendário"],
    ["money", "Dinheiro"],
    ["target", "Meta"],
    ["back", "Voltar"]
);
export const ARROW_ITEMS = enumItems(
    ["arrow", "Seta →"],
    ["chevron", "Chevron ›"],
    ["badge", "Seta em círculo"],
    ["external", "Abrir fora ↗"],
    ["none", "Nenhuma"]
);
export const HOVER_ITEMS = enumItems(
    ["auto", "Automático (escurece ou clareia)"],
    ["custom", "Cores próprias"],
    ["none", "Sem mudança de cor"]
);

class ButtonCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    background = color("background", "Cor de fundo", PRIMARY);
    gradient = toggle("gradient", "Degradê sutil", true);
    layout = dropdown("layout", "Disposição", LAYOUT_ITEMS, 0);
    radius = num("radius", "Arredondamento (px)", 14, "Valores altos deixam o botão em formato de pílula.");
    height = num("height", "Altura (px, 0 = ocupa o visual)", 0);
    padding = num("padding", "Espaço interno lateral (px)", 20);
    gap = num("gap", "Espaço entre ícone, texto e seta (px)", 14);
    shadow = dropdown("shadow", "Sombra", SHADOW_ITEMS, 1);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);

    name = "button";
    displayName = "Botão";
    slices: FormattingSettingsSlice[] = [
        this.fontFamily, this.background, this.gradient, this.layout, this.radius, this.height,
        this.padding, this.gap, this.shadow, this.borderWidth, this.borderColor
    ];
}

class LabelCard extends FormattingSettingsCard {
    text = text("text", "Texto", "Ir para a página", "Ex.: Base nominal");
    fontSize = num("fontSize", "Tamanho da fonte", 16);
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", true);
    uppercase = toggle("uppercase", "Maiúsculas", false);
    subtitle = text("subtitle", "Subtítulo", "", "Ex.: Ver detalhamento por colaborador");
    subtitleSize = num("subtitleSize", "Tamanho do subtítulo", 12);
    subtitleColor = color("subtitleColor", "Cor do subtítulo", DARK);

    name = "label";
    displayName = "Texto";
    description = "Os campos Texto e Subtítulo (medidas), se preenchidos, substituem estes textos.";
    slices: FormattingSettingsSlice[] = [
        this.text, this.fontSize, this.fontColor, this.bold, this.uppercase,
        this.subtitle, this.subtitleSize, this.subtitleColor
    ];
}

class IconCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar ícone", true);
    icon = dropdown("icon", "Ícone", ICON_ITEMS, 0);
    size = num("size", "Tamanho (px)", 20);
    color = color("color", "Cor", DARK);

    name = "icon";
    displayName = "Ícone à esquerda";
    slices: FormattingSettingsSlice[] = [this.show, this.icon, this.size, this.color];
}

class ArrowCard extends FormattingSettingsCard {
    type = dropdown("type", "Tipo", ARROW_ITEMS, 0);
    size = num("size", "Tamanho (px)", 20);
    color = color("color", "Cor", DARK);
    animate = toggle("animate", "Deslizar ao passar o mouse", true);
    divider = toggle("divider", "Divisória antes da seta", true);
    dividerColor = color("dividerColor", "Cor da divisória", DARK);

    name = "arrow";
    displayName = "Seta à direita";
    slices: FormattingSettingsSlice[] = [this.type, this.size, this.color, this.animate, this.divider, this.dividerColor];
}

class EffectsCard extends FormattingSettingsCard {
    hover = dropdown("hover", "Cor ao passar o mouse", HOVER_ITEMS, 0);
    hoverBackground = color("hoverBackground", "Fundo ao passar o mouse", DARK);
    hoverColor = color("hoverColor", "Texto e ícones ao passar o mouse", WHITE);
    lift = toggle("lift", "Elevar ao passar o mouse", true);
    shine = toggle("shine", "Brilho ao passar o mouse", true);
    press = toggle("press", "Afundar ao clicar", true);
    ripple = toggle("ripple", "Onda ao clicar", true);

    name = "effects";
    displayName = "Efeitos";
    slices: FormattingSettingsSlice[] = [
        this.hover, this.hoverBackground, this.hoverColor, this.lift, this.shine, this.press, this.ripple
    ];
}

class ActionCard extends FormattingSettingsCard {
    url = new formattingSettings.TextInput({
        name: "url",
        displayName: "Link (URL)",
        description: "Endereço da página no Power BI Service (copie da barra do navegador) ou qualquer link https. O campo Link (medida) tem prioridade.",
        value: "",
        placeholder: "https://app.powerbi.com/groups/…/reports/…/ReportSection…"
    });
    tooltip = text("tooltip", "Dica ao passar o mouse", "", "Ex.: Abre a base nominal");

    name = "action";
    displayName = "Ação";
    description = "Para trocar de página na mesma aba, deixe o link em branco e use um botão nativo transparente por cima (veja o README).";
    slices: FormattingSettingsSlice[] = [this.url, this.tooltip];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    buttonCard = new ButtonCard();
    labelCard = new LabelCard();
    iconCard = new IconCard();
    arrowCard = new ArrowCard();
    effectsCard = new EffectsCard();
    actionCard = new ActionCard();

    cards: Array<formattingSettings.Cards> = [
        this.buttonCard, this.labelCard, this.iconCard, this.arrowCard, this.effectsCard, this.actionCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
