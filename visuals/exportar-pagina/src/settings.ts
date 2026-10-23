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

/** Página de exportação publicada no GitHub Pages do repositório (pasta site/exportar). */
export const DEFAULT_EXPORT_URL = "https://zlanchus.github.io/powerbi-custom-visual/exportar/";

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
const text = (name: string, displayName: string, value: string, placeholder: string, description?: string): formattingSettings.TextInput =>
    new formattingSettings.TextInput({ name, displayName, value, placeholder, description });

const FORMAT_ITEMS = enumItems(["pdf", "PDF"], ["png", "Imagem PNG"], ["jpg", "Imagem JPG"]);
const PAPER_ITEMS = enumItems(["fit", "Do tamanho da página"], ["a4", "A4"], ["letter", "Carta"]);
const ORIENTATION_ITEMS = enumItems(["auto", "Automática"], ["landscape", "Paisagem"], ["portrait", "Retrato"]);

class ButtonSettings extends FormattingSettingsCard {
    text = text("text", "Texto", "Exportar página", "Exportar página");
    showIcon = toggle("showIcon", "Mostrar ícone", true);
    showArrow = toggle("showArrow", "Mostrar divisória e seta", true);
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Fonte", value: FONT });
    fontSize = num("fontSize", "Tamanho da fonte", 15);
    bold = toggle("bold", "Negrito", true);
    fill = color("fill", "Cor de fundo", PRIMARY);
    fontColor = color("fontColor", "Cor do texto", DARK);
    height = num("height", "Altura (px)", 52, "0 = altura toda do visual.");
    radius = num("radius", "Arredondamento (px)", 14);
    borderWidth = num("borderWidth", "Espessura da borda (px)", 0);
    borderColor = color("borderColor", "Cor da borda", DARK);

    name = "button";
    displayName = "Botão";
    slices: FormattingSettingsSlice[] = [
        this.text, this.showIcon, this.showArrow, this.fontFamily, this.fontSize, this.bold, this.fill, this.fontColor,
        this.height, this.radius, this.borderWidth, this.borderColor
    ];
}

class ExportSettings extends FormattingSettingsCard {
    format = dropdown("format", "Formato", FORMAT_ITEMS, 0);
    paper = dropdown("paper", "Papel (PDF)", PAPER_ITEMS, 0);
    orientation = dropdown("orientation", "Orientação (PDF)", ORIENTATION_ITEMS, 0);
    fileName = text("fileName", "Nome do arquivo", "", "Relatório",
        "A medida em \"Nome do arquivo\" (campos do visual), se houver, tem prioridade.");
    timestamp = toggle("timestamp", "Data e hora no nome do arquivo", true);
    footer = toggle("footer", "Rodapé com data e hora", true);
    footerText = text("footerText", "Texto do rodapé", "", "Ex.: Diretoria Comercial",
        "A medida em \"Texto do rodapé\" (campos do visual), se houver, tem prioridade.");
    autoCapture = toggle("autoCapture", "Capturar assim que a aba for escolhida", true);
    url = text("url", "Endereço da página de exportação", "", DEFAULT_EXPORT_URL,
        "Vazio = página pública do repositório. Para usar uma cópia hospedada na empresa, cole o endereço https dela.");

    name = "export";
    displayName = "Exportação";
    slices: FormattingSettingsSlice[] = [
        this.format, this.paper, this.orientation, this.fileName, this.timestamp, this.footer, this.footerText,
        this.autoCapture, this.url
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    buttonCard = new ButtonSettings();
    exportCard = new ExportSettings();

    cards: Array<formattingSettings.Cards> = [this.buttonCard, this.exportCard];
}

export const enumValue = (slice: formattingSettings.ItemDropdown): string => String(slice.value?.value ?? "");
