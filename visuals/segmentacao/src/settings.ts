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
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

export type LayoutMode = "blocks" | "list" | "dropdown";

const MODE_ITEMS: powerbi.IEnumMember[] = [
    { value: "blocks", displayName: "Blocos (botões)" },
    { value: "list", displayName: "Lista vertical" },
    { value: "dropdown", displayName: "Suspenso" }
];

class LayoutCardSettings extends FormattingSettingsCard {
    mode = new formattingSettings.ItemDropdown({
        name: "mode",
        displayName: "Estilo",
        items: MODE_ITEMS,
        value: MODE_ITEMS[0]
    });

    singleSelect = new formattingSettings.ToggleSwitch({
        name: "singleSelect",
        displayName: "Seleção única",
        value: false
    });

    showSelectAll = new formattingSettings.ToggleSwitch({
        name: "showSelectAll",
        displayName: "Mostrar \"Selecionar tudo\"",
        value: false
    });

    showSearch = new formattingSettings.ToggleSwitch({
        name: "showSearch",
        displayName: "Mostrar pesquisa (lista e suspenso)",
        value: true
    });

    columns = new formattingSettings.NumUpDown({
        name: "columns",
        displayName: "Colunas dos blocos",
        description: "0 = automático (os blocos se ajustam à largura).",
        value: 0
    });

    gap = new formattingSettings.NumUpDown({
        name: "gap",
        displayName: "Espaçamento entre itens (px)",
        value: 8
    });

    name: string = "layout";
    displayName: string = "Layout";
    slices: Array<FormattingSettingsSlice> = [
        this.mode, this.singleSelect, this.showSelectAll, this.showSearch, this.columns, this.gap
    ];
}

class HeaderCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Mostrar cabeçalho",
        value: true
    });

    text = new formattingSettings.TextInput({
        name: "text",
        displayName: "Texto",
        description: "Vazio = nome do campo.",
        value: "",
        placeholder: "Nome do campo"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Tamanho da fonte",
        value: 14
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Fonte",
        value: FONT
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cor do texto",
        value: { value: DARK }
    });

    showClear = new formattingSettings.ToggleSwitch({
        name: "showClear",
        displayName: "Mostrar botão de limpar",
        value: true
    });

    name: string = "header";
    displayName: string = "Cabeçalho";
    slices: Array<FormattingSettingsSlice> = [
        this.show, this.text, this.fontSize, this.fontFamily, this.fontColor, this.showClear
    ];
}

class ItemsCardSettings extends FormattingSettingsCard {
    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Tamanho da fonte",
        value: 13
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Fonte",
        value: FONT
    });

    fill = new formattingSettings.ColorPicker({
        name: "fill",
        displayName: "Cor de fundo",
        value: { value: PANEL }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cor do texto",
        value: { value: DARK }
    });

    selectedFill = new formattingSettings.ColorPicker({
        name: "selectedFill",
        displayName: "Selecionado: cor de fundo",
        value: { value: PRIMARY }
    });

    selectedFontColor = new formattingSettings.ColorPicker({
        name: "selectedFontColor",
        displayName: "Selecionado: cor do texto",
        value: { value: DARK }
    });

    radius = new formattingSettings.NumUpDown({
        name: "radius",
        displayName: "Arredondamento (px)",
        value: 10
    });

    height = new formattingSettings.NumUpDown({
        name: "height",
        displayName: "Altura (px)",
        value: 36
    });

    borderWidth = new formattingSettings.NumUpDown({
        name: "borderWidth",
        displayName: "Espessura da borda (px)",
        value: 0
    });

    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Cor da borda",
        value: { value: DARK }
    });

    showCheck = new formattingSettings.ToggleSwitch({
        name: "showCheck",
        displayName: "Mostrar caixa de seleção",
        value: true
    });

    name: string = "items";
    displayName: string = "Itens";
    slices: Array<FormattingSettingsSlice> = [
        this.fontSize, this.fontFamily, this.fill, this.fontColor, this.selectedFill, this.selectedFontColor,
        this.radius, this.height, this.borderWidth, this.borderColor, this.showCheck
    ];
}

class DropdownCardSettings extends FormattingSettingsCard {
    placeholder = new formattingSettings.TextInput({
        name: "placeholder",
        displayName: "Texto quando nada está selecionado",
        value: "Todos",
        placeholder: "Todos"
    });

    fill = new formattingSettings.ColorPicker({
        name: "fill",
        displayName: "Cor de fundo da caixa",
        value: { value: PRIMARY }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cor do texto da caixa",
        value: { value: DARK }
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Tamanho da fonte da caixa",
        value: 15
    });

    radius = new formattingSettings.NumUpDown({
        name: "radius",
        displayName: "Arredondamento (px)",
        value: 14
    });

    height = new formattingSettings.NumUpDown({
        name: "height",
        displayName: "Altura da caixa (px)",
        value: 48
    });

    borderWidth = new formattingSettings.NumUpDown({
        name: "borderWidth",
        displayName: "Espessura da borda (px)",
        value: 0
    });

    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor",
        displayName: "Cor da borda",
        value: { value: DARK }
    });

    panelFill = new formattingSettings.ColorPicker({
        name: "panelFill",
        displayName: "Cor de fundo da lista aberta",
        value: { value: "#FFFFFF" }
    });

    name: string = "dropdown";
    displayName: string = "Suspenso";
    slices: Array<FormattingSettingsSlice> = [
        this.placeholder, this.fill, this.fontColor, this.fontSize, this.radius, this.height,
        this.borderWidth, this.borderColor, this.panelFill
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layoutCard = new LayoutCardSettings();
    headerCard = new HeaderCardSettings();
    itemsCard = new ItemsCardSettings();
    dropdownCard = new DropdownCardSettings();

    cards = [this.layoutCard, this.headerCard, this.itemsCard, this.dropdownCard];
}
