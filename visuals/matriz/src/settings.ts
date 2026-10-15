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
export const GRID = "#E4EDF5";
const FONT = "\"Segoe UI\", wf_segoe-ui_normal, helvetica, arial, sans-serif";

/** Quantidade de espaços "Seção N – valores". */
export const SECTION_COUNT = 8;

const color = (name: string, displayName: string, value: string): formattingSettings.ColorPicker =>
    new formattingSettings.ColorPicker({ name, displayName, value: { value } });
const num = (name: string, displayName: string, value: number, description?: string): formattingSettings.NumUpDown =>
    new formattingSettings.NumUpDown({ name, displayName, value, description });
const toggle = (name: string, displayName: string, value: boolean): formattingSettings.ToggleSwitch =>
    new formattingSettings.ToggleSwitch({ name, displayName, value });
const text = (name: string, displayName: string, value: string, placeholder = ""): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value, placeholder });

class TableCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    fill = color("fill", "Cor de fundo", "#FFFFFF");
    rowHeight = num("rowHeight", "Altura das linhas (px)", 36);
    zebra = toggle("zebra", "Linhas alternadas", false);
    zebraColor = color("zebraColor", "Cor das linhas alternadas", "#F8FBFE");
    hoverColor = color("hoverColor", "Cor ao passar o mouse", PANEL);
    gridColor = color("gridColor", "Cor das linhas de grade", GRID);
    radius = num("radius", "Arredondamento (px)", 12);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 1);
    borderColor = color("borderColor", "Cor da borda", GRID);

    name = "table";
    displayName = "Tabela";
    slices: FormattingSettingsSlice[] = [
        this.fontFamily, this.fill, this.rowHeight, this.zebra, this.zebraColor, this.hoverColor,
        this.gridColor, this.radius, this.borderWidth, this.borderColor
    ];
}

class SectionHeaderCard extends FormattingSettingsCard {
    show = toggle("show", "Mostrar cabeçalho das seções", true);
    fill = color("fill", "Cor de fundo", PANEL);
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    uppercase = toggle("uppercase", "Letras maiúsculas", true);
    accentHeight = num("accentHeight", "Espessura da faixa colorida (px)", 3);

    name = "sectionHeader";
    displayName = "Cabeçalho das seções";
    slices: FormattingSettingsSlice[] = [this.show, this.fill, this.fontColor, this.fontSize, this.uppercase, this.accentHeight];
}

class ColumnHeaderCard extends FormattingSettingsCard {
    fill = color("fill", "Cor de fundo", "#FFFFFF");
    fontColor = color("fontColor", "Cor do texto", MUTED);
    fontSize = num("fontSize", "Tamanho da fonte", 12);
    uppercase = toggle("uppercase", "Letras maiúsculas", false);
    minWidth = num("minWidth", "Largura mínima das colunas (px)", 96);

    name = "columnHeader";
    displayName = "Cabeçalho das colunas";
    slices: FormattingSettingsSlice[] = [this.fill, this.fontColor, this.fontSize, this.uppercase, this.minWidth];
}

class RowHeadersCard extends FormattingSettingsCard {
    title = text("title", "Título da coluna de linhas", "", "Nome dos campos");
    fill = color("fill", "Cor de fundo", "#FFFFFF");
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    width = num("width", "Largura (px)", 260);
    indent = num("indent", "Recuo por nível (px)", 18);
    parentBold = toggle("parentBold", "Níveis com filhos em negrito", true);
    expandLevel = num("expandLevel", "Níveis abertos ao carregar", 0,
        "0 = tudo recolhido; 1 = abre o primeiro nível; e assim por diante.");

    name = "rowHeaders";
    displayName = "Linhas";
    slices: FormattingSettingsSlice[] = [
        this.title, this.fill, this.fontColor, this.fontSize, this.width, this.indent, this.parentBold, this.expandLevel
    ];
}

class ValuesCard extends FormattingSettingsCard {
    fontColor = color("fontColor", "Cor do texto", DARK);
    fontSize = num("fontSize", "Tamanho da fonte", 13);
    emptyText = text("emptyText", "Texto para valor vazio", "–", "–");

    name = "values";
    displayName = "Valores";
    slices: FormattingSettingsSlice[] = [this.fontColor, this.fontSize, this.emptyText];
}

class TotalsCard extends FormattingSettingsCard {
    rowSubtotals = toggle("rowSubtotals", "Subtotais nas linhas com filhos", true);
    columnSubtotals = toggle("columnSubtotals", "Subtotais das colunas", false);
    showGrandTotal = toggle("showGrandTotal", "Mostrar total geral", true);
    label = text("label", "Rótulo do total", "Total", "Total");
    fill = color("fill", "Cor de fundo do total", PANEL);
    fontColor = color("fontColor", "Cor do texto do total", DARK);

    name = "totals";
    displayName = "Totais";
    slices: FormattingSettingsSlice[] = [
        this.rowSubtotals, this.columnSubtotals, this.showGrandTotal, this.label, this.fill, this.fontColor
    ];
}

/** Título e cor de cada seção (só aparecem as seções que têm medidas). */
class SectionsCard extends formattingSettings.CompositeCard {
    name = "sections";
    displayName = "Seções";
    groups: formattingSettings.Group[] = Array.from({ length: SECTION_COUNT }, (_, k) => {
        const i = k + 1;
        return new formattingSettings.Group({
            name: `section${i}`,
            displayName: `Seção ${i}`,
            slices: [
                text(`title${i}`, "Título", "", `Seção ${i}`),
                color(`color${i}`, "Cor da faixa", PRIMARY)
            ]
        });
    });
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    tableCard = new TableCard();
    sectionHeaderCard = new SectionHeaderCard();
    columnHeaderCard = new ColumnHeaderCard();
    rowHeadersCard = new RowHeadersCard();
    valuesCard = new ValuesCard();
    totalsCard = new TotalsCard();
    sectionsCard = new SectionsCard();

    cards: Array<formattingSettings.Cards> = [
        this.tableCard, this.sectionHeaderCard, this.columnHeaderCard, this.rowHeadersCard,
        this.valuesCard, this.totalsCard, this.sectionsCard
    ];

    sectionTitle(i: number): string {
        return String((this.sectionsCard.groups[i - 1].slices[0] as formattingSettings.TextInput).value || "");
    }

    sectionColor(i: number): string {
        return (this.sectionsCard.groups[i - 1].slices[1] as formattingSettings.ColorPicker).value.value;
    }
}

export type ColorValue = powerbi.ThemeColorData;
