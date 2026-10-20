"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;

/** Cores padrão do repositório (ver DESIGN.md na raiz). */
export const PRIMARY = "#6CBEEB";
export const DARK = "#0F2B45";
export const PANEL = "#F1F8FD";
export const MUTED = "#4E6175";
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/** Texto padrão do insight. Marcadores: {categoria}, {valor}, {detalhe}. */
export const INSIGHT_TEMPLATE = "Maior taxa: {categoria} · {valor} {detalhe}.";

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

export const ORDER_BY_ITEMS = enumItems(
    ["auto", "Automático (campo Ordenar por, se houver)"],
    ["value", "Valor"],
    ["sortBy", "Campo Ordenar por"],
    ["category", "Categoria (A–Z)"],
    ["data", "Ordem do Power BI"]
);
export const DIRECTION_ITEMS = enumItems(
    ["auto", "Automática"],
    ["desc", "Decrescente"],
    ["asc", "Crescente"]
);
export const TOP_BASIS_ITEMS = enumItems(
    ["largest", "Maiores valores"],
    ["smallest", "Menores valores"],
    ["order", "Primeiros da ordenação"]
);
export const DETAIL_STYLE_ITEMS = enumItems(["paren", "Entre parênteses: (18)"], ["dot", "Após um ponto: · 18"], ["plain", "Sem separador: 18"]);
export const ALIGN_ITEMS = enumItems(["left", "À esquerda"], ["right", "À direita"]);
export const INSIGHT_TYPE_ITEMS = enumItems(["max", "Maior valor"], ["min", "Menor valor"]);
export const INSIGHT_SCOPE_ITEMS = enumItems(["visible", "Só as barras exibidas"], ["all", "Todas as categorias"]);

class GeneralCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });

    name = "general";
    displayName = "Geral";
    slices: FormattingSettingsSlice[] = [this.fontFamily];
}

class HeaderCard extends FormattingSettingsCard {
    title = text("title", "Título", "", "Ex.: Senioridade");
    titleSize = num("titleSize", "Tamanho do título", 22);
    titleColor = color("titleColor", "Cor do título", DARK);
    subtitle = text("subtitle", "Subtítulo", "", "Ex.: Taxa de turnover por nível");
    subtitleSize = num("subtitleSize", "Tamanho do subtítulo", 14);
    subtitleColor = color("subtitleColor", "Cor do subtítulo", MUTED);

    name = "header";
    displayName = "Cabeçalho";
    description = "Título e subtítulo dentro do visual (deixe em branco para esconder).";
    slices: FormattingSettingsSlice[] = [
        this.title, this.titleSize, this.titleColor, this.subtitle, this.subtitleSize, this.subtitleColor
    ];
}

class SortCard extends FormattingSettingsCard {
    orderBy = dropdown("orderBy", "Ordenar por", ORDER_BY_ITEMS, 0);
    direction = dropdown("direction", "Direção", DIRECTION_ITEMS, 0);

    name = "sort";
    displayName = "Ordenação";
    description = "Automática: maior valor primeiro; com o campo Ordenar por ou categoria, crescente.";
    slices: FormattingSettingsSlice[] = [this.orderBy, this.direction];
}

class TopNCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar apenas o top N", false);
    count = num("count", "Quantidade (N)", 5);
    basis = dropdown("basis", "Escolher pelos", TOP_BASIS_ITEMS, 0);

    name = "topN";
    displayName = "Top N";
    slices: FormattingSettingsSlice[] = [this.show, this.count, this.basis];
}

class BarsCard extends FormattingSettingsCard {
    fill = new formattingSettings.ColorPicker({
        name: "fill",
        displayName: "Cor da barra (fx)",
        description: "Use o botão fx para colorir cada barra por regras ou pelo valor de um campo.",
        value: { value: PRIMARY },
        selector: dataViewWildcard.createDataViewWildcardSelector(dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals),
        instanceKind: VisualEnumerationInstanceKinds.ConstantOrRule
    });
    highlightMax = toggle("highlightMax", "Destacar a maior barra", false);
    highlightColor = color("highlightColor", "Cor do destaque", DARK);
    showTrack = toggle("showTrack", "Mostrar trilho (fundo da barra)", true);
    trackColor = color("trackColor", "Cor do trilho", PANEL);
    thickness = num("thickness", "Espessura (px)", 16);
    radius = num("radius", "Arredondamento (px)", 999, "Valores altos deixam as pontas totalmente arredondadas.");
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);
    scaleMax = num("scaleMax", "Máximo da escala (0 = maior valor)", 0, "Para porcentagens, use o valor decimal (100% = 1).");
    selectedOpacity = num("selectedOpacity", "Opacidade do que não está selecionado (%)", 35);

    name = "bars";
    displayName = "Barras";
    slices: FormattingSettingsSlice[] = [
        this.fill, this.highlightMax, this.highlightColor, this.showTrack, this.trackColor, this.thickness,
        this.radius, this.borderWidth, this.borderColor, this.scaleMax, this.selectedOpacity
    ];
}

class RowsCard extends FormattingSettingsCard {
    height = num("height", "Altura da linha (px)", 40);
    fit = toggle("fit", "Ajustar à altura do visual", true);
    gap = num("gap", "Espaço entre colunas (px)", 18);

    name = "rows";
    displayName = "Linhas";
    description = "Com o ajuste ligado, as linhas encolhem para caber; sem ele, aparece a barra de rolagem.";
    slices: FormattingSettingsSlice[] = [this.height, this.fit, this.gap];
}

class CategoryLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    fontSize = num("fontSize", "Tamanho da fonte", 15);
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", false);
    width = num("width", "Largura (px, 0 = automática)", 0);
    align = dropdown("align", "Alinhamento", ALIGN_ITEMS, 0);

    name = "categoryLabels";
    displayName = "Rótulos das categorias";
    slices: FormattingSettingsSlice[] = [this.show, this.fontSize, this.fontColor, this.bold, this.width, this.align];
}

class ValueLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    fontSize = num("fontSize", "Tamanho da fonte", 15);
    fontColor = color("fontColor", "Cor do texto", DARK);
    bold = toggle("bold", "Negrito", true);

    name = "valueLabels";
    displayName = "Rótulos de valor";
    slices: FormattingSettingsSlice[] = [this.show, this.fontSize, this.fontColor, this.bold];
}

class DetailLabelsCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar", true);
    style = dropdown("style", "Estilo", DETAIL_STYLE_ITEMS, 0);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    bold = toggle("bold", "Negrito", false);

    name = "detailLabels";
    displayName = "Detalhe";
    description = "Medidas do campo Detalhe, mostradas ao lado do valor.";
    slices: FormattingSettingsSlice[] = [this.show, this.style, this.fontSize, this.fontColor, this.bold];
}

class InsightCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar insight", true);
    type = dropdown("type", "Destacar", INSIGHT_TYPE_ITEMS, 0);
    scope = dropdown("scope", "Considerar", INSIGHT_SCOPE_ITEMS, 0);
    template = new formattingSettings.TextInput({
        name: "template",
        displayName: "Texto",
        description: "Marcadores: {categoria}, {valor} e {detalhe}.",
        value: INSIGHT_TEMPLATE,
        placeholder: INSIGHT_TEMPLATE
    });
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    fontColor = color("fontColor", "Cor do texto", MUTED);
    bold = toggle("bold", "Negrito", false);

    name = "insight";
    displayName = "Insight";
    slices: FormattingSettingsSlice[] = [
        this.show, this.type, this.scope, this.template, this.fontSize, this.fontColor, this.bold
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    generalCard = new GeneralCard();
    headerCard = new HeaderCard();
    sortCard = new SortCard();
    topNCard = new TopNCard();
    barsCard = new BarsCard();
    rowsCard = new RowsCard();
    categoryLabelsCard = new CategoryLabelsCard();
    valueLabelsCard = new ValueLabelsCard();
    detailLabelsCard = new DetailLabelsCard();
    insightCard = new InsightCard();

    cards: Array<formattingSettings.Cards> = [
        this.generalCard, this.headerCard, this.sortCard, this.topNCard, this.barsCard, this.rowsCard,
        this.categoryLabelsCard, this.valueLabelsCard, this.detailLabelsCard, this.insightCard
    ];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
