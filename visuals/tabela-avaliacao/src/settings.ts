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
export const LINE = "#E4EDF5";
export const GOOD = "#2E8B57";
export const BAD = "#D64545";
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

export const ORIENTATION_ITEMS = enumItems(
    ["auto", "Automático"],
    ["categoryRows", "Campo nas linhas, medidas nas colunas"],
    ["measureRows", "Medidas nas linhas, campo nas colunas"]
);
export const SORT_ITEMS = enumItems(
    ["data", "Ordem do Power BI"],
    ["best", "Maior média primeiro"],
    ["worst", "Menor média primeiro"],
    ["label", "Nome (A–Z)"]
);
export const FILL_ITEMS = enumItems(
    ["exact", "Exata (4,3 = 4 estrelas e 30%)"],
    ["half", "Meia estrela"],
    ["whole", "Estrela inteira"]
);
export const SHAPE_ITEMS = enumItems(["star", "Estrela"], ["circle", "Círculo"]);
export const ALIGN_ITEMS = enumItems(["center", "Centralizado"], ["left", "À esquerda"]);
export const POSITION_ITEMS = enumItems(["right", "À direita das estrelas"], ["below", "Abaixo das estrelas"]);

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily];
}

class HeaderCard extends FormattingSettingsCard {
    title = text("title", "Título", "", "Ex.: Pesquisa de satisfação");
    titleSize = num("titleSize", "Tamanho do título", 20);
    titleColor = color("titleColor", "Cor do título", DARK);
    subtitle = text("subtitle", "Subtítulo", "", "Ex.: Nota média de 1 a 5 por unidade");
    subtitleSize = num("subtitleSize", "Tamanho do subtítulo", 13);
    subtitleColor = color("subtitleColor", "Cor do subtítulo", MUTED);

    name = "header";
    displayName = "Cabeçalho";
    description = "Título e subtítulo dentro do visual (deixe em branco para esconder).";
    slices: FormattingSettingsSlice[] = [
        this.title, this.titleSize, this.titleColor, this.subtitle, this.subtitleSize, this.subtitleColor
    ];
}

class LayoutCard extends FormattingSettingsCard {
    orientation = new formattingSettings.ItemDropdown({
        name: "orientation",
        displayName: "Disposição",
        description: "Automático: com um campo em Linhas, cada valor do campo é uma linha e cada medida uma coluna; sem campo, cada medida vira uma linha.",
        items: ORIENTATION_ITEMS,
        value: ORIENTATION_ITEMS[0]
    });
    sortBy = dropdown("sortBy", "Ordenação inicial", SORT_ITEMS, 0);
    clickSort = toggle("clickSort", "Ordenar ao clicar no cabeçalho", true);
    rowHeaderTitle = text("rowHeaderTitle", "Título da primeira coluna", "", "Em branco = nome do campo");

    name = "layout";
    displayName = "Tabela";
    slices: FormattingSettingsSlice[] = [this.orientation, this.sortBy, this.clickSort, this.rowHeaderTitle];
}

class ScaleCard extends FormattingSettingsCard {
    maxValue = num("maxValue", "Nota máxima", 5, "Nota que corresponde a todas as estrelas cheias (ex.: 5, 10 ou 1 para 100%).");
    starCount = num("starCount", "Quantidade de estrelas", 5);
    fillMode = dropdown("fillMode", "Preenchimento", FILL_ITEMS, 0);

    name = "scale";
    displayName = "Escala";
    slices: FormattingSettingsSlice[] = [this.maxValue, this.starCount, this.fillMode];
}

class StarsCard extends FormattingSettingsCard {
    shape = dropdown("shape", "Forma", SHAPE_ITEMS, 0);
    size = num("size", "Tamanho (px)", 18);
    gap = num("gap", "Espaço entre estrelas (px)", 3);
    fill = color("fill", "Cor da estrela cheia", PRIMARY);
    empty = color("empty", "Cor da estrela vazia", PRIMARY);
    emptyOpacity = num("emptyOpacity", "Opacidade da estrela vazia (%)", 22);
    outlineWidth = num("outlineWidth", "Espessura do contorno (px)", 0);
    outlineColor = color("outlineColor", "Cor do contorno", PRIMARY);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);

    name = "stars";
    displayName = "Estrelas";
    slices: FormattingSettingsSlice[] = [
        this.shape, this.size, this.gap, this.fill, this.empty, this.emptyOpacity,
        this.outlineWidth, this.outlineColor, this.align
    ];
}

class BandsCard extends FormattingSettingsCard {
    show = toggle("show", "Colorir pela nota", false);
    lowLimit = num("lowLimit", "Nota baixa: abaixo de", 3);
    lowColor = color("lowColor", "Cor da nota baixa", BAD);
    highLimit = num("highLimit", "Nota alta: a partir de", 4);
    highColor = color("highColor", "Cor da nota alta", GOOD);
    applyToNumber = toggle("applyToNumber", "Aplicar também ao número", false);

    name = "bands";
    displayName = "Cores por faixa";
    description = "Notas entre as duas faixas usam a cor da estrela cheia.";
    slices: FormattingSettingsSlice[] = [
        this.show, this.lowLimit, this.lowColor, this.highLimit, this.highColor, this.applyToNumber
    ];
}

class NumbersCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar a nota", true);
    position = dropdown("position", "Posição", POSITION_ITEMS, 0);
    decimals = num("decimals", "Casas decimais", 1);
    useMeasureFormat = toggle("useMeasureFormat", "Usar o formato da medida", false);
    showMax = toggle("showMax", "Mostrar a nota máxima (ex.: 4,3 /5)", false);
    fontSize = num("fontSize", "Tamanho da fonte", 14);
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", true);

    name = "numbers";
    displayName = "Nota";
    slices: FormattingSettingsSlice[] = [
        this.show, this.position, this.decimals, this.useMeasureFormat, this.showMax,
        this.fontSize, this.fontColor, this.bold
    ];
}

class TableHeaderCard extends FormattingSettingsCard {
    background = color("background", "Cor de fundo", DARK);
    fontColor = color("fontColor", "Cor do texto", WHITE);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    bold = toggle("bold", "Negrito", true);
    uppercase = toggle("uppercase", "Letras maiúsculas", true);
    height = num("height", "Altura (px)", 40);

    name = "tableHeader";
    displayName = "Cabeçalho das colunas";
    slices: FormattingSettingsSlice[] = [
        this.background, this.fontColor, this.fontSize, this.bold, this.uppercase, this.height
    ];
}

class RowsCard extends FormattingSettingsCard {
    height = num("height", "Altura (px)", 48);
    fit = toggle("fit", "Ajustar à altura do visual", true);
    fontSize = num("fontSize", "Tamanho da fonte", 14);
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", false);
    background = color("background", "Cor de fundo", WHITE);
    zebra = toggle("zebra", "Linhas alternadas", true);
    zebraColor = color("zebraColor", "Cor das linhas alternadas", PANEL);
    separatorWidth = num("separatorWidth", "Espessura da divisória (px)", 1);
    separatorColor = color("separatorColor", "Cor da divisória", LINE);
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 35);

    name = "rows";
    displayName = "Linhas";
    description = "Com o ajuste ligado, as linhas encolhem para caber; sem ele, aparece a barra de rolagem.";
    slices: FormattingSettingsSlice[] = [
        this.height, this.fit, this.fontSize, this.fontColor, this.bold, this.background, this.zebra, this.zebraColor,
        this.separatorWidth, this.separatorColor, this.selectedOpacity
    ];
}

class CountsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    title = text("title", "Título", "", "Em branco = nome da medida");
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    fontColor = color("fontColor", "Cor do texto", MUTED);

    name = "counts";
    displayName = "Nº de respostas";
    description = "Medida do campo Nº de respostas, mostrada numa coluna (ou como base, sem campo em Linhas).";
    slices: FormattingSettingsSlice[] = [this.show, this.title, this.fontSize, this.fontColor];
}

class SummaryCard extends FormattingSettingsCard {
    showColumn = toggle("showColumn", "Coluna de média", true);
    columnTitle = text("columnTitle", "Título da coluna", "Média", "Média");
    showRow = toggle("showRow", "Linha de média", false);
    rowTitle = text("rowTitle", "Título da linha", "Média geral", "Média geral");
    dividerWidth = num("dividerWidth", "Espessura da divisória (px)", 2);
    dividerColor = color("dividerColor", "Cor da divisória", PRIMARY);

    name = "summary";
    displayName = "Média";
    description = "Média simples das notas exibidas (cada medida ou linha tem o mesmo peso).";
    slices: FormattingSettingsSlice[] = [
        this.showColumn, this.columnTitle, this.showRow, this.rowTitle, this.dividerWidth, this.dividerColor
    ];
}

class FrameCard extends FormattingSettingsCard {
    radius = num("radius", "Arredondamento (px)", 12);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);

    name = "frame";
    displayName = "Borda";
    slices: FormattingSettingsSlice[] = [this.radius, this.borderWidth, this.borderColor];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    headerCard = new HeaderCard();
    layoutCard = new LayoutCard();
    scaleCard = new ScaleCard();
    starsCard = new StarsCard();
    bandsCard = new BandsCard();
    numbersCard = new NumbersCard();
    tableHeaderCard = new TableHeaderCard();
    rowsCard = new RowsCard();
    countsCard = new CountsCard();
    summaryCard = new SummaryCard();
    frameCard = new FrameCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.headerCard, this.layoutCard, this.scaleCard, this.starsCard, this.bandsCard,
        this.numbersCard, this.tableHeaderCard, this.rowsCard, this.countsCard, this.summaryCard, this.frameCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
