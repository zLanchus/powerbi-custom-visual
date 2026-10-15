"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** Cores padrão do repositório (ver DESIGN.md na raiz). */
export const DEFAULT_FILL = "#6CBEEB";
export const DEFAULT_FONT_COLOR = "#0F2B45";

class ButtonCardSettings extends FormattingSettingsCard {
    text = new formattingSettings.TextInput({
        name: "text",
        displayName: "Texto",
        value: "Abrir Filtros",
        placeholder: "Abrir Filtros"
    });

    fill = new formattingSettings.ColorPicker({
        name: "fill",
        displayName: "Cor de fundo",
        value: { value: DEFAULT_FILL }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cor do texto e ícones",
        value: { value: DEFAULT_FONT_COLOR }
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Tamanho da fonte do texto",
        value: 16
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Fonte",
        value: "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif"
    });

    radius = new formattingSettings.NumUpDown({
        name: "radius",
        displayName: "Arredondamento (px)",
        value: 14
    });

    height = new formattingSettings.NumUpDown({
        name: "height",
        displayName: "Altura do botão (px)",
        value: 56
    });

    showIcon = new formattingSettings.ToggleSwitch({
        name: "showIcon",
        displayName: "Mostrar ícone de funil",
        value: true
    });

    showBadge = new formattingSettings.ToggleSwitch({
        name: "showBadge",
        displayName: "Mostrar contador de filtros ativos",
        value: true
    });

    name: string = "button";
    displayName: string = "Botão";
    borderWidth = new formattingSettings.NumUpDown({
        name: "borderWidth",
        displayName: "Espessura da borda (px)",
        value: 0
    });

    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Cor da borda",
        value: { value: DEFAULT_FONT_COLOR }
    });

    slices: Array<FormattingSettingsSlice> = [
        this.text, this.fill, this.fontColor, this.fontSize, this.fontFamily,
        this.radius, this.height, this.borderWidth, this.borderColor, this.showIcon, this.showBadge
    ];
}

class PopupCardSettings extends FormattingSettingsCard {
    title = new formattingSettings.TextInput({
        name: "title",
        displayName: "Título",
        value: "Filtros",
        placeholder: "Filtros"
    });

    fill = new formattingSettings.ColorPicker({
        name: "fill",
        displayName: "Cor de fundo",
        value: { value: DEFAULT_FILL }
    });

    panelFill = new formattingSettings.ColorPicker({
        name: "panelFill",
        displayName: "Cor dos painéis de filtro",
        value: { value: "#F1F8FD" }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cor do texto",
        value: { value: DEFAULT_FONT_COLOR }
    });

    titleFontSize = new formattingSettings.NumUpDown({
        name: "titleFontSize",
        displayName: "Tamanho da fonte do título",
        value: 16
    });

    fieldFontSize = new formattingSettings.NumUpDown({
        name: "fieldFontSize",
        displayName: "Tamanho da fonte do título dos filtros",
        value: 13
    });

    valueFontSize = new formattingSettings.NumUpDown({
        name: "valueFontSize",
        displayName: "Tamanho da fonte dos valores",
        value: 13
    });

    overlay = new formattingSettings.ToggleSwitch({
        name: "overlay",
        displayName: "Abrir por cima do botão",
        description: "Desligado: o pop-up abre abaixo do botão. Ligado: ocupa toda a área do visual.",
        value: false
    });

    name: string = "popup";
    displayName: string = "Pop-up";
    borderWidth = new formattingSettings.NumUpDown({
        name: "borderWidth",
        displayName: "Espessura da borda (px)",
        value: 0
    });

    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Cor da borda",
        value: { value: DEFAULT_FONT_COLOR }
    });

    slices: Array<FormattingSettingsSlice> = [
        this.title, this.titleFontSize, this.fieldFontSize, this.valueFontSize,
        this.fill, this.panelFill, this.fontColor, this.borderWidth, this.borderColor, this.overlay
    ];
}

class SlicerCardSettings extends FormattingSettingsCard {
    singleSelect = new formattingSettings.ToggleSwitch({
        name: "singleSelect",
        displayName: "Seleção única",
        value: false
    });

    showSearch = new formattingSettings.ToggleSwitch({
        name: "showSearch",
        displayName: "Mostrar caixa de pesquisa",
        value: true
    });

    rangeForNumbers = new formattingSettings.ToggleSwitch({
        name: "rangeForNumbers",
        displayName: "Intervalo (de/até) para números e datas",
        value: false
    });

    name: string = "slicer";
    displayName: string = "Filtros";
    startCollapsed = new formattingSettings.ToggleSwitch({
        name: "startCollapsed",
        displayName: "Abrir com os filtros retraídos",
        description: "Ao abrir o pop-up, todos os filtros aparecem fechados; clique no título para expandir.",
        value: true
    });

    borderWidth = new formattingSettings.NumUpDown({
        name: "borderWidth",
        displayName: "Espessura da borda dos filtros (px)",
        value: 0
    });

    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Cor da borda dos filtros",
        value: { value: DEFAULT_FONT_COLOR }
    });

    slices: Array<FormattingSettingsSlice> = [
        this.startCollapsed, this.singleSelect, this.showSearch, this.rangeForNumbers, this.borderWidth, this.borderColor
    ];
}

const ALIGN_ITEMS: powerbi.IEnumMember[] = [
    { value: "left", displayName: "Esquerda" },
    { value: "center", displayName: "Centro" },
    { value: "right", displayName: "Direita" }
];

/** Botões "Limpar todos os filtros" e "Fechar" no rodapé do pop-up. */
class ActionsCardSettings extends FormattingSettingsCard {
    align = new formattingSettings.ItemDropdown({
        name: "align",
        displayName: "Posição",
        items: ALIGN_ITEMS,
        value: ALIGN_ITEMS[2]
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Tamanho da fonte",
        value: 13
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Fonte",
        value: "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif"
    });

    width = new formattingSettings.NumUpDown({
        name: "width",
        displayName: "Largura dos botões (px)",
        description: "0 = automática. Os dois botões sempre têm a mesma largura e altura.",
        value: 0
    });

    clearFill = new formattingSettings.ColorPicker({
        name: "clearFill",
        displayName: "\"Limpar\": cor de fundo",
        value: { value: DEFAULT_FILL }
    });

    clearFontColor = new formattingSettings.ColorPicker({
        name: "clearFontColor",
        displayName: "\"Limpar\": cor do texto e borda",
        value: { value: DEFAULT_FONT_COLOR }
    });

    closeFill = new formattingSettings.ColorPicker({
        name: "closeFill",
        displayName: "\"Fechar\": cor de fundo",
        value: { value: DEFAULT_FONT_COLOR }
    });

    closeFontColor = new formattingSettings.ColorPicker({
        name: "closeFontColor",
        displayName: "\"Fechar\": cor do texto",
        value: { value: DEFAULT_FILL }
    });

    name: string = "actions";
    displayName: string = "Botões do pop-up";
    slices: Array<FormattingSettingsSlice> = [
        this.align, this.fontSize, this.fontFamily, this.width,
        this.clearFill, this.clearFontColor, this.closeFill, this.closeFontColor
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    buttonCard = new ButtonCardSettings();
    popupCard = new PopupCardSettings();
    slicerCard = new SlicerCardSettings();
    actionsCard = new ActionsCardSettings();

    cards = [this.buttonCard, this.popupCard, this.actionsCard, this.slicerCard];
}
