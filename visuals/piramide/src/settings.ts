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

export const ORDER_ITEMS = enumItems(["desc", "Maior em cima (funil)"], ["asc", "Maior embaixo (pirâmide)"], ["data", "Ordem do Power BI"]);
export const CATEGORY_POS_ITEMS = enumItems(["left", "À esquerda"], ["top", "Acima da barra"]);
export const SEGMENT_LABEL_ITEMS = enumItems(["none", "Nenhum"], ["value", "Valor"], ["percent", "% da barra"], ["both", "Valor e %"]);
export const TOTAL_LABEL_ITEMS = enumItems(["none", "Nenhum"], ["value", "Total"], ["valueFirst", "Total e % do primeiro"], ["valuePrev", "Total e % do anterior"]);
export const LEGEND_POS_ITEMS = enumItems(["top", "Em cima"], ["bottom", "Embaixo"]);

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily];
}

class BarsCard extends FormattingSettingsCard {
    order = dropdown("order", "Ordem das barras", ORDER_ITEMS, 0);
    mirror = toggle("mirror", "Pirâmide espelhada (1º item da legenda à esquerda)", false);
    gap = num("gap", "Espaço entre barras (%)", 28, "Porcentagem da altura de cada faixa.");
    radius = num("radius", "Arredondamento (px)", 6);
    minWidth = num("minWidth", "Largura mínima da barra (%)", 2);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", "#FFFFFF");
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 35);

    name = "bars";
    displayName = "Barras";
    slices: FormattingSettingsSlice[] = [
        this.order, this.mirror, this.gap, this.radius, this.minWidth, this.borderWidth, this.borderColor, this.selectedOpacity
    ];
}

class ConnectorsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar conectores entre barras", true);
    color = color("color", "Cor", PRIMARY);
    opacity = num("opacity", "Opacidade (%)", 18);
    showRate = toggle("showRate", "Mostrar taxa de conversão", true);
    fontSize = num("fontSize", "Tamanho da fonte da taxa", 11);
    fontColor = color("fontColor", "Cor da taxa", MUTED);

    name = "connectors";
    displayName = "Conectores";
    slices: FormattingSettingsSlice[] = [this.show, this.color, this.opacity, this.showRate, this.fontSize, this.fontColor];
}

class CategoryLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    position = dropdown("position", "Posição", CATEGORY_POS_ITEMS, 0);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    fontColor = color("fontColor", "Cor do texto", DARK);
    width = num("width", "Largura (px, quando à esquerda)", 150);
    bold = toggle("bold", "Negrito", true);

    name = "categoryLabels";
    displayName = "Rótulos das categorias";
    slices: FormattingSettingsSlice[] = [this.show, this.position, this.fontSize, this.fontColor, this.width, this.bold];
}

class DataLabelsCard extends FormattingSettingsCard {
    segment = dropdown("segment", "Rótulo dentro dos segmentos", SEGMENT_LABEL_ITEMS, 1);
    segmentFontSize = num("segmentFontSize", "Tamanho da fonte dos segmentos", 11);
    segmentColor = color("segmentColor", "Cor do texto dos segmentos", DARK);
    autoContrast = toggle("autoContrast", "Ajustar cor do texto ao fundo automaticamente", true);
    total = dropdown("total", "Rótulo do total da barra", TOTAL_LABEL_ITEMS, 2);
    totalFontSize = num("totalFontSize", "Tamanho da fonte do total", 12);
    totalColor = color("totalColor", "Cor do total", DARK);

    name = "dataLabels";
    displayName = "Rótulos de dados";
    slices: FormattingSettingsSlice[] = [
        this.segment, this.segmentFontSize, this.segmentColor, this.autoContrast, this.total, this.totalFontSize, this.totalColor
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

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    barsCard = new BarsCard();
    connectorsCard = new ConnectorsCard();
    categoryLabelsCard = new CategoryLabelsCard();
    dataLabelsCard = new DataLabelsCard();
    legendCard = new LegendCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.barsCard, this.connectorsCard, this.categoryLabelsCard, this.dataLabelsCard, this.legendCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
