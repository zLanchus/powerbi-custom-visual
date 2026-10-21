"use strict";

import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

import { Analysis, Hotspot, LevelStats, MeasureConfig, alpha } from "./analysis";
import { ColumnGroup, MatrixModel, Measure, RowItem, rowPath } from "./model";
import { ICONS, el, icon } from "./dom";

/** Tudo o que o painel "Como ler a referência" precisa saber do visual. */
export interface HelpContext {
    model: MatrixModel;
    analysis: Analysis;
    configs: Map<number, MeasureConfig>;
    /** Medida explicada (as outras aparecem em abas). */
    measure: Measure;
    keyMeasure: Measure | undefined;
    /** Ponto de atenção da medida-chave, usado como exemplo quando existe. */
    hotspot: Hotspot | undefined;
    colors: { worse: string; better: string; neutral: string; scale: string; accent: string; colorBetter: boolean };
    minBase: number;
    hatch: boolean;
    note: string;
    totalLabel: string;
    locale: string;
    onClose: () => void;
    onSelect: (measure: Measure) => void;
}

interface Example {
    row: RowItem;
    group: ColumnGroup;
    value: number;
    reference: number;
}

const FALLBACK_TEXT: Record<string, string> = {
    total: "o total geral da mesma coluna",
    median: "a mediana das linhas do mesmo nível",
    average: "a média das linhas do mesmo nível",
    parent: "o valor da linha de cima",
    none: ""
};

/** Parágrafo com trechos em **negrito** (montado com nós de texto, sem HTML vindo dos dados). */
function rich(tag: "p" | "li" | "span", text: string, className?: string): HTMLElement {
    const node = el(tag, className);
    text.split(/\*\*(.+?)\*\*/).forEach((part, i) => {
        if (part) {
            node.appendChild(i % 2 ? el("strong", undefined, part) : document.createTextNode(part));
        }
    });
    return node;
}

function section(iconPaths: string[], title: string): HTMLElement {
    const box = el("section", "md-help-section");
    const head = el("h4", "md-help-h");
    head.append(icon(iconPaths, "md-icon md-help-h-icon"), el("span", undefined, title));
    box.appendChild(head);
    return box;
}

/** Célula da tabela usada como exemplo: o ponto de atenção ou a linha mais acima da referência. */
function pickExample(ctx: HelpContext): Example | undefined {
    const { model, analysis, measure } = ctx;
    const make = (row: RowItem, group: ColumnGroup): Example | undefined => {
        const value = analysis.value(row, group, measure);
        const reference = analysis.reference(row, group, measure);
        return value === undefined || reference === undefined ? undefined : { row, group, value, reference };
    };
    if (ctx.hotspot && measure === ctx.keyMeasure) {
        const fromHotspot = make(ctx.hotspot.row, ctx.hotspot.group);
        if (fromHotspot) {
            return fromHotspot;
        }
    }
    const groups = model.totalGroup ? [model.totalGroup] : model.groups.filter(g => !g.isSubtotal);
    let best: Example | undefined;
    let bestScore = -Infinity;
    const walk = (items: RowItem[]): void => items.forEach(row => {
        for (const group of groups) {
            const ex = analysis.isLowBase(row, group) ? undefined : make(row, group);
            const s = ex ? analysis.signedDeviation(row, group, measure) : undefined;
            // Prefere as linhas mais detalhadas e a que está mais acima da referência.
            const score = s === undefined ? -Infinity : s + (row.children.length ? -1e9 : 0);
            if (ex && score > bestScore) {
                best = ex;
                bestScore = score;
            }
        }
        walk(row.children);
    });
    walk(model.rows);
    return best || (model.grandTotal ? groups.map(g => make(model.grandTotal as RowItem, g)).find(Boolean) : undefined);
}

function methodName(ctx: HelpContext, cfg: MeasureConfig): string {
    switch (cfg.reference) {
        case "total": return "total geral";
        case "median": return "mediana do nível";
        case "quartiles": return "faixa típica do nível";
        case "average": return "média do nível";
        case "rowAverage": return "média da própria linha";
        case "parent": return "linha de cima";
        case "measure": return cfg.refMeasure ? cfg.refMeasure.name : "total geral";
        default: return "valor fixo";
    }
}

/** Texto e passos de cada forma de calcular a referência. */
function methodContent(ctx: HelpContext, cfg: MeasureConfig): { summary: string; steps: string[] } {
    const m = ctx.measure;
    switch (cfg.reference) {
        case "total":
            return {
                summary: "Cada valor é comparado com o **total geral da mesma coluna**: o resultado da empresa inteira naquele recorte "
                    + "(ex.: o turnover da empresa em março). O total é calculado pelo próprio Power BI com a sua medida, "
                    + "então já leva em conta o tamanho de cada área.",
                steps: ["Pega o total geral da coluna.", "Compara cada célula com ele.", "Acima do total: **alto**. Abaixo: **baixo**."]
            };
        case "median":
            return {
                summary: "A mediana é o **valor do meio**: ordenando as linhas do mesmo nível (ex.: todas as áreas), metade fica acima "
                    + "dela e metade abaixo. Ao contrário da média, ela não é puxada por um ou dois casos extremos.",
                steps: [
                    "Junta os valores das linhas do mesmo nível, na mesma coluna.",
                    "Ordena do menor para o maior e pega o do meio.",
                    "Acima da mediana: **alto**. Abaixo: **baixo**."
                ]
            };
        case "quartiles":
            return {
                summary: "A faixa típica é onde ficam os **50% do meio** das linhas do mesmo nível. Os quartis dividem as linhas, "
                    + "em ordem, em quatro partes iguais: abaixo do 1º quartil estão os 25% mais baixos e acima do 3º, os 25% mais altos.",
                steps: [
                    "Ordena os valores das linhas do mesmo nível, na mesma coluna.",
                    "Calcula o 1º quartil (25%) e o 3º quartil (75%).",
                    "Acima do 3º quartil: **alto**. Abaixo do 1º: **baixo**. Entre os dois: **típico**, sem cor."
                ]
            };
        case "average":
            return {
                summary: "Cada valor é comparado com a **média simples** das linhas do mesmo nível, na mesma coluna. "
                    + "Cada linha pesa igual, seja uma área de 5 ou de 500 pessoas.",
                steps: ["Soma os valores das linhas do mesmo nível e divide pela quantidade de linhas.", "Acima da média: **alto**. Abaixo: **baixo**."]
            };
        case "rowAverage":
            return {
                summary: "Cada valor é comparado com a **média da própria linha ao longo das colunas** (ex.: os meses daquela área). "
                    + "A pergunta é \"este mês foi alto para esta área?\", e não \"esta área é alta?\".",
                steps: [
                    "Calcula a média da linha nas colunas (sem a coluna de total).",
                    "Compara cada coluna com essa média.",
                    "Na coluna de total, a comparação é com o total geral."
                ]
            };
        case "parent":
            return {
                summary: "Cada valor é comparado com o **nível anterior da hierarquia**: cada área com a própria diretoria, por exemplo. "
                    + "No primeiro nível, a comparação é com o total geral.",
                steps: ["Pega o valor da linha de cima, na mesma coluna.", "Acima dele: **alto**. Abaixo: **baixo**."]
            };
        case "measure": {
            const ref = cfg.refMeasure;
            if (!ref) {
                return { summary: "Nenhuma medida no campo **Referência**: a comparação é com o total geral.", steps: [] };
            }
            const steps = ["O valor de **" + ref.name + "** na própria célula."];
            if (cfg.refInherit) {
                steps.push("Se estiver vazio: o valor das **linhas de cima**, até o total geral (ex.: as áreas usam a meta da diretoria).");
            }
            steps.push(cfg.refFallback === "none"
                ? "Se não houver valor em nenhum nível: a célula fica **sem referência** (sem cor)."
                : `Se não houver valor em nenhum nível: **${FALLBACK_TEXT[cfg.refFallback]}**.`);
            return {
                summary: `A referência vem da medida **${ref.name}**, calculada pelo Power BI em cada célula como qualquer medida `
                    + "(ex.: a meta de cada diretoria). O visual procura o valor nesta ordem:",
                steps
            };
        }
        default:
            return {
                summary: `Todos os valores são comparados com um **valor fixo** definido no relatório: **${m.format(cfg.target)}**.`,
                steps: ["Acima do valor: **alto**. Abaixo: **baixo**."]
            };
    }
}

/** Régua com o menor e o maior valor do nível, a referência (ou a faixa típica) e o exemplo. */
function scaleDiagram(ctx: HelpContext, ex: Example, stats: LevelStats | undefined, range: [number, number] | undefined,
    judged: number | undefined, refLabel: string): HTMLElement | undefined {
    const m = ctx.measure;
    let lo = stats ? stats.min : Math.min(ex.value, ex.reference);
    let hi = stats ? stats.max : Math.max(ex.value, ex.reference);
    lo = Math.min(lo, ex.value, ex.reference, range ? range[0] : Infinity);
    hi = Math.max(hi, ex.value, ex.reference, range ? range[1] : -Infinity);
    if (!(hi > lo)) {
        return undefined;
    }
    const pct = (v: number): number => (v - lo) / (hi - lo) * 100;
    const place = (node: HTMLElement, v: number): void => {
        const p = pct(v);
        node.style.left = p + "%";
        node.classList.add(p < 14 ? "md-at-start" : p > 86 ? "md-at-end" : "md-at-mid");
    };

    const box = el("div", "md-scale");
    const refTag = el("div", "md-scale-tag md-scale-tag-ref");
    refTag.append(el("span", undefined, refLabel), el("strong", undefined, m.format(ex.reference)));
    place(refTag, ex.reference);

    const track = el("div", "md-scale-track");
    if (range) {
        const band = el("div", "md-scale-band");
        band.style.left = pct(range[0]) + "%";
        band.style.width = Math.max(1, pct(range[1]) - pct(range[0])) + "%";
        band.title = "Faixa típica";
        track.appendChild(band);
    }
    const marker = el("div", "md-scale-ref");
    marker.style.left = pct(ex.reference) + "%";
    const dot = el("div", "md-scale-dot");
    dot.style.left = pct(ex.value) + "%";
    const c = ctx.colors;
    const neutral = ctx.configs.get(m.index)?.direction === "neutral";
    dot.style.background = neutral ? c.scale : judged === undefined || judged === 0 ? "var(--md-help-fg)" : judged > 0 ? c.worse : c.better;
    track.append(marker, dot);

    const valueTag = el("div", "md-scale-tag md-scale-tag-value");
    valueTag.append(el("span", undefined, ex.row.isGrandTotal ? ctx.totalLabel : ex.row.label), el("strong", undefined, m.format(ex.value)));
    place(valueTag, ex.value);

    const ends = el("div", "md-scale-ends");
    const unit = ctx.configs.get(m.index)?.reference === "rowAverage" ? "da linha" : "do nível";
    ends.append(el("span", undefined, `menor ${unit}: ${m.format(lo)}`), el("span", undefined, `maior ${unit}: ${m.format(hi)}`));

    const top = el("div", "md-scale-row");
    top.appendChild(refTag);
    const bottom = el("div", "md-scale-row");
    bottom.appendChild(valueTag);
    box.append(top, track, bottom, ends);
    if (range) {
        const legend = el("div", "md-scale-note");
        const swatch = el("span", "md-scale-note-band");
        legend.append(swatch, el("span", undefined, `faixa típica: ${m.format(range[0])} a ${m.format(range[1])}`));
        box.appendChild(legend);
    }
    return box;
}

/** Monta o painel "Como ler a referência" da medida escolhida. */
export function buildHelp(ctx: HelpContext): HTMLElement {
    const { model, analysis, measure: m } = ctx;
    const cfg = ctx.configs.get(m.index) as MeasureConfig;
    const pp = valueFormatter.create({ format: "0.0", cultureSelector: ctx.locale });
    const num = valueFormatter.create({ format: "#,0.0", cultureSelector: ctx.locale });

    const layer = el("div", "md-help-layer");
    layer.addEventListener("click", (e: MouseEvent) => {
        if (e.target === layer) {
            ctx.onClose();
        }
    });
    const panel = el("div", "md-help");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Como ler a referência");
    layer.appendChild(panel);

    // ---- cabeçalho
    const head = el("div", "md-help-head");
    const badge = el("span", "md-help-badge");
    badge.appendChild(icon(ICONS.target));
    const titles = el("div", "md-help-titles");
    titles.append(el("div", "md-help-title", "Como ler a referência"),
        rich("span", `**${m.name}** · referência: **${methodName(ctx, cfg)}**`, "md-help-sub"));
    const close = el("button", "md-help-close");
    close.type = "button";
    close.title = "Fechar";
    close.setAttribute("aria-label", "Fechar");
    close.appendChild(icon(ICONS.clear));
    close.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        ctx.onClose();
    });
    head.append(badge, titles, close);
    panel.appendChild(head);

    // ---- abas (uma por medida)
    if (model.values.length > 1) {
        const tabs = el("div", "md-help-tabs");
        for (const v of model.values) {
            const tab = el("button", "md-help-tab" + (v === m ? " md-on" : ""), v.name);
            tab.type = "button";
            tab.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();
                ctx.onSelect(v);
            });
            tabs.appendChild(tab);
        }
        panel.appendChild(tabs);
    }

    const body = el("div", "md-help-body");
    panel.appendChild(body);
    if (ctx.note) {
        const note = el("div", "md-help-note");
        note.append(icon(ICONS.info, "md-icon md-help-note-icon"), el("span", undefined, ctx.note));
        body.appendChild(note);
    }

    // ---- o que é
    const what = section(ICONS.target, "O que é a referência");
    what.appendChild(rich("p", "A referência é a **base de comparação** de cada valor da tabela. Ela não diz se um número é bom ou ruim "
        + "sozinho: diz se ele está **alto** ou **baixo** em relação a algo que faz sentido comparar."));
    what.appendChild(rich("p", cfg.reference === "measure" || cfg.reference === "fixed"
        ? "Aqui ela funciona como uma meta: o que passa dela é alto."
        : "Aqui ela não é uma meta a bater: é o \"normal\" do grupo, calculado a partir dos próprios dados."));
    body.appendChild(what);

    // ---- como é calculada
    const how = section(ICONS.ruler, "Como é calculada");
    const pill = el("span", "md-help-pill", methodName(ctx, cfg));
    how.appendChild(pill);
    const content = methodContent(ctx, cfg);
    how.appendChild(rich("p", content.summary));
    if (content.steps.length) {
        const ol = el("ol", "md-help-steps");
        content.steps.forEach(step => ol.appendChild(rich("li", step)));
        how.appendChild(ol);
    }
    if (cfg.reference === "measure" && cfg.refMeasure) {
        const cov = analysis.referenceCoverage(m);
        const parts: string[] = [];
        if (cov.own) {
            parts.push(`**${cov.own}** com valor próprio`);
        }
        if (cov.inherited) {
            parts.push(`**${cov.inherited}** herdaram de uma linha de cima`);
        }
        if (cov.fallback) {
            parts.push(`**${cov.fallback}** usaram a alternativa`);
        }
        if (cov.none) {
            parts.push(`**${cov.none}** sem referência`);
        }
        if (parts.length) {
            how.appendChild(rich("p", "Nesta tabela, das células com valor: " + parts.join(" · ") + ".", "md-help-muted"));
        }
    }

    // exemplo real da tabela
    const ex = pickExample(ctx);
    if (ex) {
        const stats = ex.row.isGrandTotal ? undefined : analysis.levelStats(ex.row, ex.group, m);
        const range = analysis.typicalRange(ex.row, ex.group, m);
        const judged = analysis.judgement(ex.row, ex.group, m);
        const position = analysis.position(ex.row, ex.group, m);
        const info = analysis.referenceInfo(ex.row, ex.group, m);
        const where = ex.row.isGrandTotal ? ctx.totalLabel : rowPath(ex.row).map(r => r.label).join(" › ");
        const column = ex.group.isSubtotal ? `coluna ${ctx.totalLabel}` : ex.group.labels.length ? `coluna ${ex.group.labels.join(" › ")}` : "";
        const card = el("div", "md-help-example");
        card.appendChild(rich("p", `**Exemplo da tabela:** ${where}${column ? ", " + column : ""}`, "md-help-example-title"));
        const refName = range ? "mediana" : info.label || "referência";
        const diagram = scaleDiagram(ctx, ex, stats, range, judged, refName.charAt(0).toUpperCase() + refName.slice(1));
        if (diagram) {
            card.appendChild(diagram);
        }
        const verdict = range
            ? (position === 1 ? `**Alto**: ${m.format(ex.value)} está acima do 3º quartil (${m.format(range[1])}).`
                : position === -1 ? `**Baixo**: ${m.format(ex.value)} está abaixo do 1º quartil (${m.format(range[0])}).`
                    : `**Típico**: ${m.format(ex.value)} está dentro da faixa (${m.format(range[0])} a ${m.format(range[1])}).`)
            : (position === 1 ? `**Alto**: ${m.format(ex.value)} está acima da referência (${m.format(ex.reference)}).`
                : position === -1 ? `**Baixo**: ${m.format(ex.value)} está abaixo da referência (${m.format(ex.reference)}).`
                    : `**Na referência**: ${m.format(ex.value)} está praticamente igual a ${m.format(ex.reference)}.`);
        const verdictEl = rich("p", "→ " + verdict, "md-help-verdict");
        if (judged && cfg.direction !== "neutral") {
            verdictEl.style.setProperty("--md-verdict", judged > 0 ? ctx.colors.worse : ctx.colors.better);
            verdictEl.classList.add("md-help-verdict-colored");
        }
        card.appendChild(verdictEl);
        if (stats && !range && cfg.reference !== "rowAverage") {
            card.appendChild(rich("p", `No nível ${model.rowLevelNames[ex.row.level] || ""}${column ? ", " + column : ""}: `
                + `${stats.count} linhas · mediana ${m.format(stats.median)} · média ${m.format(stats.mean)}.`, "md-help-muted"));
        }
        how.appendChild(card);
    }
    body.appendChild(how);

    // ---- como interpretar
    const read = section(ICONS.palette, "Como interpretar as cores");
    const list = el("ul", "md-help-legend");
    const item = (swatch: HTMLElement, text: string): void => {
        const li = el("li");
        li.append(swatch, rich("span", text));
        list.appendChild(li);
    };
    const sw = (color: string, extra = ""): HTMLElement => {
        const s = el("span", "md-help-swatch" + extra);
        if (color) {
            s.style.background = color;
        }
        return s;
    };
    const c = ctx.colors;
    if (cfg.direction === "neutral") {
        const ramp = sw("", " md-help-swatch-ramp");
        ramp.style.background = `linear-gradient(90deg, ${c.neutral}, ${c.scale})`;
        item(ramp, "Medida **neutra**: quanto mais forte a cor, **maior o valor**. A cor não indica bom ou ruim.");
    } else {
        const highWorse = cfg.direction === "higherWorse";
        item(sw(c.worse), highWorse
            ? "**Alto**: acima da referência. Para esta medida, maior é **pior**."
            : "**Baixo**: abaixo da referência. Para esta medida, menor é **pior**.");
        item(sw(c.neutral, " md-help-swatch-line"), cfg.reference === "quartiles"
            ? "**Típico**: dentro da faixa típica, fica sem cor."
            : "**Na referência**: muito perto dela, fica sem cor ou bem clara.");
        item(sw(c.colorBetter ? c.better : c.neutral, c.colorBetter ? "" : " md-help-swatch-line"), highWorse
            ? "**Baixo**: abaixo da referência (melhor)." + (c.colorBetter ? "" : " Neste relatório, só o lado pior ganha cor.")
            : "**Alto**: acima da referência (melhor)." + (c.colorBetter ? "" : " Neste relatório, só o lado pior ganha cor."));
    }
    if (model.base && ctx.minBase > 0) {
        item(sw("", " md-help-swatch-hatch"), `**Hachurado**: amostra pequena (menos de ${model.base.format(ctx.minBase)} em ${model.base.name}). `
            + "Fica fora das comparações.");
    }
    read.appendChild(list);
    if (cfg.direction !== "neutral") {
        read.appendChild(rich("p", "A cor fica **mais forte quanto mais longe da referência**, em comparação com as outras linhas do mesmo nível."
            + (cfg.heatmap ? "" : " O mapa de calor está desligado para esta medida, mas a referência continua valendo para a dica de ferramenta, "
                + "os pontos de atenção e o botão Acima da ref."), "md-help-muted"));
    }
    read.appendChild(rich("p", "Passe o mouse numa célula: a dica de ferramenta mostra a **referência usada** e a **situação** (alto, baixo ou na referência).",
        "md-help-muted"));
    body.appendChild(read);

    // ---- a diferença
    if (ex) {
        const diff = section(ICONS.scale, "E a diferença?");
        const dev = ex.value - ex.reference;
        const up = dev >= 0;
        // Para porcentagens, a conta usa os mesmos números (em p.p., com 1 casa) que aparecem no texto.
        const shown = (v: number): number => m.isPercent ? Math.round(Math.abs(v) * 1000) / 10 : Math.abs(v);
        const rel = shown(ex.reference) ? shown(dev) / shown(ex.reference) : undefined;
        const relText = rel === undefined ? "" : valueFormatter.format(rel, "0%", false, ctx.locale);
        const deltaText = analysis.formatDelta(m, dev);
        const end = (text: string): string => text.endsWith(".") ? "" : ".";
        const fromRef = (up ? "acima" : "abaixo") + (cfg.reference === "quartiles" ? " da mediana" : " da referência");
        if (m.isPercent) {
            diff.appendChild(rich("p", `Entre porcentagens, a diferença é em **pontos percentuais (p.p.)**: `
                + `${m.format(ex.value)} − ${m.format(ex.reference)} = **${deltaText}**${end(deltaText)}`));
            if (relText) {
                diff.appendChild(rich("p", `Em termos relativos, o valor está **${relText} ${fromRef}** `
                    + `(${pp.format(shown(dev))} ÷ ${pp.format(shown(ex.reference))}).`));
            }
            const callout = el("div", "md-help-callout");
            callout.appendChild(rich("span", `Não confunda: **${deltaText}** não é **${up ? "+" : "−"}${pp.format(shown(dev))}%**.`));
            diff.appendChild(callout);
            const base = model.base ? analysis.baseValue(ex.row, ex.group) : undefined;
            if (model.base && base !== undefined) {
                const impact = Math.abs(dev) * base;
                diff.appendChild(rich("p", `Na prática: ${pp.format(shown(dev))} p.p. × ${model.base.format(base)} (${model.base.name}) `
                    + `≈ **${num.format(impact)} ${up ? "a mais" : "a menos"}** do que o esperado se estivesse na referência.`));
            }
        } else {
            diff.appendChild(rich("p", `A diferença fica no formato da medida: ${m.format(ex.value)} − ${m.format(ex.reference)} = **${deltaText}**`
                + (relText ? ` (**${relText} ${fromRef}**).` : end(deltaText))));
        }
        diff.appendChild(rich("p", "Na tabela, esses números aparecem com o botão **Desvio**. Para saber se é alto ou baixo, "
            + "basta a cor ou a situação na dica de ferramenta.", "md-help-muted"));
        body.appendChild(diff);
    }

    // ---- cuidados
    const care = section(ICONS.shield, "Cuidados na leitura");
    const ul = el("ul", "md-help-bullets");
    const add = (text: string): void => {
        ul.appendChild(rich("li", text));
    };
    if (cfg.reference === "rowAverage") {
        add("A comparação é **dentro da própria linha**: um mês vermelho numa área tranquila pode ter valor menor que um mês branco numa área crítica.");
    } else if (cfg.reference !== "fixed") {
        add("A comparação é sempre **dentro do mesmo nível e da mesma coluna**: diretorias com diretorias, áreas com áreas, março com março.");
    }
    if (cfg.reference !== "fixed") {
        add("A referência acompanha os **filtros da página**: filtrando uma diretoria, o total, a mediana e os quartis passam a ser só dela.");
    }
    if (model.base && ctx.minBase > 0) {
        add(`Grupos com menos de **${model.base.format(ctx.minBase)}** em ${model.base.name} ficam fora das médias, medianas e quartis: `
            + "com poucas pessoas, uma única saída muda muito a taxa.");
    }
    if (cfg.reference === "quartiles") {
        add("Por definição, cerca de **1 em cada 4** linhas fica acima da faixa típica, mesmo num grupo em que todos vão bem. "
            + "A faixa mostra quem **se destaca do grupo**, não o que é bom ou ruim em absoluto.");
    }
    if (ex && !ex.row.isGrandTotal && (cfg.reference === "median" || cfg.reference === "average" || cfg.reference === "quartiles")) {
        const stats = analysis.levelStats(ex.row, ex.group, m);
        if (stats && stats.count < 5) {
            add(`Este nível tem só **${stats.count}** linhas nesta coluna: com tão poucas, a referência muda bastante com cada uma.`);
        }
    }
    if (model.totalGroup && model.columnLevelNames.length) {
        add(`Na coluna **${ctx.totalLabel}**, a comparação é do período ou do grupo inteiro, não a soma das colunas.`);
    }
    if (cfg.reference === "measure") {
        add("A medida de referência é calculada em cada célula: se a meta é mensal, ela precisa devolver a meta do período na coluna Total.");
    }
    care.appendChild(ul);
    body.appendChild(care);

    // Tom suave da cor de destaque (selo, pílula e faixa típica).
    panel.style.setProperty("--md-help-soft", alpha(ctx.colors.accent, 0.2));
    return layer;
}
