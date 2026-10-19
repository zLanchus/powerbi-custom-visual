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

    maxRows = new formattingSettings.NumUpDown({
        name: "maxRows",
        displayName: "Limite de combinações lidas (mil)",
        description: "O Power BI envia as combinações entre todas as colunas do visual. Acima deste limite o visual para de ler "
            + "(para não travar o Power BI) e avisa que alguma lista pode estar incompleta. Padrão: 200 mil.",
        value: 200
    });

    catalogFilters = new formattingSettings.TextInput({
        name: "catalogFilters",
        displayName: "Modo catálogo: filtros desta página",
        description: "Nomes dos filtros do catálogo a mostrar, separados por vírgula, na ordem desejada. Vazio = todos, em ordem alfabética.",
        value: "",
        placeholder: "Ex.: Período, Área, Cargo"
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
        this.startCollapsed, this.singleSelect, this.showSearch, this.rangeForNumbers, this.maxRows, this.catalogFilters, this.borderWidth, this.borderColor
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

export const CHECK_SYMBOL_ITEMS: powerbi.IEnumMember[] = [
    { value: "check", displayName: "Visto (✓)" },
    { value: "x", displayName: "Xis (✕)" },
    { value: "dot", displayName: "Bolinha (●)" },
    { value: "square", displayName: "Quadrado (■)" },
    { value: "none", displayName: "Nenhum (só a cor de fundo)" }
];

const CHECK_SHAPE_ITEMS: powerbi.IEnumMember[] = [
    { value: "rounded", displayName: "Quadrada arredondada" },
    { value: "square", displayName: "Quadrada" },
    { value: "circle", displayName: "Redonda" }
];

/** Caixinha de seleção ao lado de cada valor dos filtros. */
class CheckboxCardSettings extends FormattingSettingsCard {
    symbol = new formattingSettings.ItemDropdown({
        name: "symbol", displayName: "Símbolo quando selecionado", items: CHECK_SYMBOL_ITEMS, value: CHECK_SYMBOL_ITEMS[0]
    });
    shape = new formattingSettings.ItemDropdown({
        name: "shape", displayName: "Formato", items: CHECK_SHAPE_ITEMS, value: CHECK_SHAPE_ITEMS[0]
    });
    size = new formattingSettings.NumUpDown({ name: "size", displayName: "Tamanho (px)", value: 18 });
    borderWidth = new formattingSettings.NumUpDown({ name: "borderWidth", displayName: "Espessura da borda (px)", value: 2 });
    fill = new formattingSettings.ColorPicker({ name: "fill", displayName: "Não selecionado: cor de fundo", value: { value: "#FFFFFF" } });
    borderColor = new formattingSettings.ColorPicker({
        name: "borderColor", displayName: "Não selecionado: cor da borda", value: { value: DEFAULT_FONT_COLOR }
    });
    selectedFill = new formattingSettings.ColorPicker({
        name: "selectedFill", displayName: "Selecionado: cor de fundo", value: { value: DEFAULT_FONT_COLOR }
    });
    selectedBorderColor = new formattingSettings.ColorPicker({
        name: "selectedBorderColor", displayName: "Selecionado: cor da borda", value: { value: DEFAULT_FONT_COLOR }
    });
    symbolColor = new formattingSettings.ColorPicker({
        name: "symbolColor", displayName: "Selecionado: cor do símbolo", value: { value: "#FFFFFF" }
    });

    name: string = "checkbox";
    displayName: string = "Caixa de seleção";
    slices: Array<FormattingSettingsSlice> = [
        this.symbol, this.shape, this.size, this.borderWidth, this.fill, this.borderColor,
        this.selectedFill, this.selectedBorderColor, this.symbolColor
    ];
}

export const TITLE_MODE_ITEMS: powerbi.IEnumMember[] = [
    { value: "all", displayName: "Todos os níveis (A › B › C)" },
    { value: "firstLast", displayName: "Primeiro e último (A › C)" },
    { value: "first", displayName: "Só o primeiro (A)" },
    { value: "last", displayName: "Só o último (C)" },
    { value: "custom", displayName: "Nome personalizado" }
];

/** Como aparece o título de um filtro aninhado (uma árvore com várias colunas). */
class NestedTitleGroup extends formattingSettings.Group {
    mode: formattingSettings.ItemDropdown;
    text: formattingSettings.TextInput;

    constructor(n: number) {
        const mode = new formattingSettings.ItemDropdown({
            name: `nest${n}Mode`, displayName: "Mostrar no título", items: TITLE_MODE_ITEMS, value: TITLE_MODE_ITEMS[0]
        });
        const text = new formattingSettings.TextInput({
            name: `nest${n}Text`, displayName: "Nome personalizado", value: "", placeholder: "Ex.: Estrutura"
        });
        super({ name: `nest${n}`, displayName: `Filtro aninhado ${n}`, slices: [mode, text] });
        this.mode = mode;
        this.text = text;
    }
}

class NestedTitlesCardSettings extends formattingSettings.CompositeCard {
    nests = [1, 2, 3, 4].map(n => new NestedTitleGroup(n));

    name: string = "nestedTitles";
    displayName: string = "Títulos dos filtros aninhados";
    groups: Array<formattingSettings.Group> = this.nests;
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    buttonCard = new ButtonCardSettings();
    popupCard = new PopupCardSettings();
    slicerCard = new SlicerCardSettings();
    actionsCard = new ActionsCardSettings();
    checkboxCard = new CheckboxCardSettings();
    nestedTitlesCard = new NestedTitlesCardSettings();

    cards = [this.buttonCard, this.popupCard, this.actionsCard, this.slicerCard, this.nestedTitlesCard, this.checkboxCard];
}
