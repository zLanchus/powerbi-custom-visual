"use strict";

/**
 * Gerador mínimo de arquivo .xlsx (Office Open XML), sem dependências:
 * uma planilha, estilos (negrito, cores, formato de número, recuo, bordas),
 * células mescladas, larguras de coluna e painéis congelados.
 * O resultado é empacotado num .zip sem compressão e devolvido em base64.
 */

export interface CellStyle {
    bold?: boolean;
    fill?: string;
    font?: string;
    numFmt?: string;
    indent?: number;
    align?: "left" | "center" | "right";
    borderBottom?: boolean;
}

export interface Cell {
    value: string | number | null | undefined;
    style?: CellStyle;
}

export interface Sheet {
    name: string;
    rows: Cell[][];
    merges: Array<{ r1: number; c1: number; r2: number; c2: number }>;
    colWidths: number[];
    freeze?: { rows: number; cols: number };
}

const esc = (s: string): string => s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(index: number): string {
    let n = index + 1;
    let s = "";
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

const ref = (r: number, c: number): string => colName(c) + (r + 1);
const argb = (hex: string): string => "FF" + hex.replace("#", "").toUpperCase().padStart(6, "0").slice(-6);

/** Registra combinações de estilo e devolve o índice de cada uma (cellXfs). */
class Styles {
    private numFmts = new Map<string, number>();
    private fonts = new Map<string, number>([["0|", 0]]);
    private fills = new Map<string, number>([["none", 0], ["gray125", 1]]);
    private xfs = new Map<string, number>([["0|0|0|0|0||0", 0]]);
    private fontList = ["<font><sz val=\"11\"/><name val=\"Calibri\"/></font>"];
    private fillList = ["<fill><patternFill patternType=\"none\"/></fill>", "<fill><patternFill patternType=\"gray125\"/></fill>"];
    private xfList = ["<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"];

    index(style: CellStyle | undefined): number {
        if (!style) {
            return 0;
        }
        const numFmt = this.numFmt(style.numFmt);
        const font = this.font(!!style.bold, style.font);
        const fill = this.fill(style.fill);
        const border = style.borderBottom ? 1 : 0;
        const indent = Math.max(0, Math.min(15, style.indent || 0));
        const align = style.align || "";
        const key = [numFmt, font, fill, border, indent, align, 0].join("|");
        let id = this.xfs.get(key);
        if (id === undefined) {
            id = this.xfList.length;
            const alignment = indent || align
                ? `<alignment${align ? ` horizontal="${align}"` : ""}${indent ? ` indent="${indent}"` : ""} vertical="center"/>`
                : "";
            this.xfList.push(`<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"`
                + `${numFmt ? " applyNumberFormat=\"1\"" : ""}${font ? " applyFont=\"1\"" : ""}${fill ? " applyFill=\"1\"" : ""}`
                + `${border ? " applyBorder=\"1\"" : ""}${alignment ? " applyAlignment=\"1\">" + alignment + "</xf>" : "/>"}`);
            this.xfs.set(key, id);
        }
        return id;
    }

    private numFmt(format: string | undefined): number {
        if (!format) {
            return 0;
        }
        let id = this.numFmts.get(format);
        if (id === undefined) {
            id = 164 + this.numFmts.size;
            this.numFmts.set(format, id);
        }
        return id;
    }

    private font(bold: boolean, color: string | undefined): number {
        const key = (bold ? 1 : 0) + "|" + (color || "");
        let id = this.fonts.get(key);
        if (id === undefined) {
            id = this.fontList.length;
            this.fontList.push(`<font>${bold ? "<b/>" : ""}<sz val="11"/>${color ? `<color rgb="${argb(color)}"/>` : ""}<name val="Calibri"/></font>`);
            this.fonts.set(key, id);
        }
        return id;
    }

    private fill(color: string | undefined): number {
        if (!color) {
            return 0;
        }
        let id = this.fills.get(color);
        if (id === undefined) {
            id = this.fillList.length;
            this.fillList.push(`<fill><patternFill patternType="solid"><fgColor rgb="${argb(color)}"/><bgColor indexed="64"/></patternFill></fill>`);
            this.fills.set(color, id);
        }
        return id;
    }

    xml(): string {
        const numFmts = Array.from(this.numFmts.entries())
            .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join("");
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
            + (numFmts ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : "")
            + `<fonts count="${this.fontList.length}">${this.fontList.join("")}</fonts>`
            + `<fills count="${this.fillList.length}">${this.fillList.join("")}</fills>`
            + "<borders count=\"2\"><border><left/><right/><top/><bottom/><diagonal/></border>"
            + "<border><left/><right/><top/><bottom style=\"thin\"><color rgb=\"FFB7C9D9\"/></bottom><diagonal/></border></borders>"
            + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
            + `<cellXfs count="${this.xfList.length}">${this.xfList.join("")}</cellXfs>`
            + "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
            + "</styleSheet>";
    }
}

function sheetXml(sheet: Sheet, styles: Styles): string {
    const rows = sheet.rows.map((cells, r) => {
        const xml = cells.map((cell, c) => {
            if (!cell) {
                return "";
            }
            const s = styles.index(cell.style);
            const attrs = `r="${ref(r, c)}"${s ? ` s="${s}"` : ""}`;
            const v = cell.value;
            if (typeof v === "number" && isFinite(v)) {
                return `<c ${attrs}><v>${v}</v></c>`;
            }
            if (v === null || v === undefined || v === "") {
                return s ? `<c ${attrs}/>` : "";
            }
            return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        }).join("");
        return `<row r="${r + 1}">${xml}</row>`;
    }).join("");

    const freeze = sheet.freeze && (sheet.freeze.rows || sheet.freeze.cols)
        ? `<sheetViews><sheetView workbookViewId="0"><pane${sheet.freeze.cols ? ` xSplit="${sheet.freeze.cols}"` : ""}`
        + `${sheet.freeze.rows ? ` ySplit="${sheet.freeze.rows}"` : ""} topLeftCell="${ref(sheet.freeze.rows, sheet.freeze.cols)}"`
        + " activePane=\"bottomRight\" state=\"frozen\"/></sheetView></sheetViews>"
        : "";
    const cols = sheet.colWidths.length
        ? "<cols>" + sheet.colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>"
        : "";
    const merges = sheet.merges.length
        ? `<mergeCells count="${sheet.merges.length}">`
        + sheet.merges.map(m => `<mergeCell ref="${ref(m.r1, m.c1)}:${ref(m.r2, m.c2)}"/>`).join("") + "</mergeCells>"
        : "";

    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
        + freeze + cols + `<sheetData>${rows}</sheetData>` + merges + "</worksheet>";
}

// ---------------------------------------------------------------- zip

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Monta um .zip sem compressão (método "stored"), suficiente para o Excel. */
function zip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
        const name = encoder.encode(file.name);
        const crc = crc32(file.data);
        const size = file.data.length;

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034B50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, size, true);
        local.setUint32(22, size, true);
        local.setUint16(26, name.length, true);
        chunks.push(new Uint8Array(local.buffer), name, file.data);

        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014B50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, size, true);
        entry.setUint32(24, size, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(new Uint8Array(entry.buffer), name);

        offset += 30 + name.length + size;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
    let pos = 0;
    for (const c of all) {
        out.set(c, pos);
        pos += c.length;
    }
    return out;
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
    }
    return btoa(binary);
}

/** Gera o .xlsx e devolve o conteúdo em base64. */
export function buildXlsx(sheet: Sheet): string {
    const encoder = new TextEncoder();
    const styles = new Styles();
    const sheetData = sheetXml(sheet, styles);
    const name = esc(sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Planilha");
    const head = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";
    const files = [
        {
            name: "[Content_Types].xml",
            xml: head + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"
                + "</Types>"
        },
        {
            name: "_rels/.rels",
            xml: head + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
                + "</Relationships>"
        },
        {
            name: "xl/workbook.xml",
            xml: head + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                + `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            xml: head + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
                + "</Relationships>"
        },
        { name: "xl/worksheets/sheet1.xml", xml: sheetData },
        { name: "xl/styles.xml", xml: styles.xml() }
    ];
    return toBase64(zip(files.map(f => ({ name: f.name, data: encoder.encode(f.xml) }))));
}
