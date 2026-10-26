"use strict";

// Textos do pop-up de ajuda (para quem lê o relatório) e do guia de medidas (para quem desenvolve).
// Aqui só se monta o conteúdo; o desenho fica em visual.ts.

export type Block =
    | { kind: "h"; text: string }
    | { kind: "p"; text: string }
    | { kind: "list"; items: string[] }
    | { kind: "terms"; items: Array<[string, string]> }
    | { kind: "steps"; items: Array<{ label: string; expr: string; result: string; note?: string }> }
    | { kind: "code"; text: string }
    | { kind: "checks"; items: Array<{ ok: boolean | "info"; text: string }> };

/** Números já formatados que o pop-up usa no exemplo e nas regras. */
export interface HelpContext {
    mode: "rate" | "share";
    term: string;
    attrNames: string[];
    baseName: string;
    /** Perfil usado no exemplo (o destaque ou o primeiro padrão). */
    example?: {
        name: string;
        exits: string;
        base: string;
        rate: string;
        share: string;
        lift: string;
        expected: string;
        excess: string;
    };
    total: string;
    baseTotal: string;
    average: string;
    minExits: string;
    minLift: string;
    /** Ex.: "90%"; vazio = sem teste. */
    confidence: string;
    minShare: string;
    dominance: string;
    rankBy: "excess" | "lift" | "exits";
    sections: { example: boolean; rules: boolean; glossary: boolean; cautions: boolean };
    extraTitle: string;
    extraText: string;
}

const listOf = (names: string[]): string =>
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;

export function helpContent(c: HelpContext): Block[] {
    const t = c.term;
    const base = c.baseName || "base";
    const attrs = listOf(c.attrNames);
    const blocks: Block[] = [];
    const ex = c.example;

    if (c.mode === "rate") {
        blocks.push({
            kind: "p",
            text: `Este visual procura, entre as características ${attrs ? `(${attrs})` : "selecionadas"}, os perfis com mais ` +
                `${t} do que o esperado para o seu tamanho, comparando cada perfil com a média do grupo todo. As contas usam ` +
                "só os dados dos filtros da página: ao mudar um filtro, tudo é recalculado."
        });
        if (c.sections.example) {
            blocks.push({ kind: "h", text: "Como a conta é feita" });
            if (ex) {
                blocks.push({ kind: "p", text: `Exemplo com o perfil ${ex.name}:` });
                blocks.push({
                    kind: "steps",
                    items: [
                        { label: "Taxa do perfil", expr: `${ex.exits} ÷ ${ex.base}`, result: ex.rate, note: `quantidade de ${t} ÷ ${base} do perfil` },
                        { label: "Taxa média", expr: `${c.total} ÷ ${c.baseTotal}`, result: c.average, note: `todos os perfis juntos (total dos filtros atuais)` },
                        { label: "Quantas vezes a média", expr: `${ex.rate} ÷ ${c.average}`, result: ex.lift },
                        { label: "Esperado com a taxa média", expr: `${ex.base} × ${c.average}`, result: ex.expected },
                        { label: "Acima do esperado", expr: `${ex.exits} − ${ex.expected}`, result: ex.excess }
                    ]
                });
            } else {
                blocks.push({
                    kind: "steps",
                    items: [
                        { label: "Taxa do perfil", expr: `${t} do perfil ÷ ${base} do perfil`, result: "" },
                        { label: "Taxa média", expr: `total de ${t} ÷ ${base} total`, result: c.average },
                        { label: "Quantas vezes a média", expr: "taxa do perfil ÷ taxa média", result: "" },
                        { label: "Acima do esperado", expr: `${t} do perfil − (${base} do perfil × taxa média)`, result: "" }
                    ]
                });
            }
        }
        if (c.sections.rules) {
            const rank = c.rankBy === "lift" ? "quantas vezes a taxa fica acima da média"
                : c.rankBy === "exits" ? `quantidade de ${t}` : `quantidade acima do esperado (o tamanho do impacto)`;
            blocks.push({ kind: "h", text: "Quando um perfil vira padrão" });
            blocks.push({
                kind: "list",
                items: [
                    `Tem pelo menos ${c.minExits} ${t}.`,
                    `A taxa do perfil é pelo menos ${c.minLift} a taxa média.`,
                    c.confidence
                        ? `A diferença para a média é grande demais para ser acaso, com ${c.confidence} de confiança (teste estatístico).`
                        : "Não há teste estatístico (desligado nas configurações do visual).",
                    "Uma combinação (ex.: A + B) só aparece quando juntar as características dá uma taxa pelo menos 5% maior " +
                    "do que cada uma sozinha.",
                    `A lista é ordenada pela ${rank}.`,
                    `O destaque é montado uma característica por vez: começa pela que tem mais ${t} acima do esperado e ` +
                    "acrescenta outras enquanto a taxa continua subindo de forma relevante."
                ]
            });
        }
        if (c.sections.glossary) {
            blocks.push({ kind: "h", text: "O que significa cada número" });
            blocks.push({
                kind: "terms",
                items: [
                    ["Taxa de saída", `Quantidade de ${t} do perfil dividida pela ${base} do perfil.`],
                    ["Taxa média", "A mesma conta para todos os perfis juntos. É a referência de comparação."],
                    ["× a média (ex.: 2,4×)", "Quantas vezes a taxa do perfil é maior que a média: 1,0× = igual à média; 2,0× = o dobro."],
                    ["Acima do esperado", `Diferença entre a quantidade real de ${t} e a esperada se o perfil tivesse a taxa média. ` +
                        "Mostra o tamanho do impacto: um perfil grande um pouco acima da média pode somar mais casos que um perfil pequeno muito acima."],
                    ["% do total", `Fatia do total de ${t} que pertence ao perfil.`],
                    ["% da base", `Fatia da ${base} que pertence ao perfil. Se a % do total é bem maior que a % da base, o perfil sai mais do que o seu tamanho.`],
                    ["Confiança estatística", "Quanto podemos confiar que a diferença não é coincidência. Com poucos casos, até taxas altas podem ser " +
                        "acaso; por isso perfis pequenos precisam de diferenças maiores para aparecer."],
                    ["Barra", "Comprimento = taxa do perfil. A marca vertical é a taxa média."]
                ]
            });
        }
    } else {
        blocks.push({
            kind: "p",
            text: `Este visual mostra quais perfis ${attrs ? `(${attrs}) ` : ""}reúnem a maior parte do total de ${t}, considerando os ` +
                "filtros da página. Sem uma base de comparação (ex.: headcount, clientes ativos), ele não diz se um perfil sai mais " +
                "que o normal, só onde estão os casos."
        });
        if (c.sections.example) {
            blocks.push({ kind: "h", text: "Como a conta é feita" });
            if (ex) {
                blocks.push({ kind: "p", text: `Exemplo com o perfil ${ex.name}:` });
                blocks.push({ kind: "steps", items: [{ label: "% do total", expr: `${ex.exits} ÷ ${c.total}`, result: ex.share, note: `quantidade de ${t} do perfil ÷ total de ${t}` }] });
            } else {
                blocks.push({ kind: "steps", items: [{ label: "% do total", expr: `${t} do perfil ÷ total de ${t}`, result: "" }] });
            }
        }
        if (c.sections.rules) {
            blocks.push({ kind: "h", text: "Quando um perfil vira padrão" });
            blocks.push({
                kind: "list",
                items: [
                    `Tem pelo menos ${c.minExits} ${t}.`,
                    `Reúne pelo menos ${c.minShare} do total de ${t}.`,
                    `Uma combinação (ex.: A + B) só aparece quando pelo menos ${c.dominance} dos casos de A também têm B.`,
                    "O destaque é montado uma característica por vez: começa pela mais frequente e acrescenta outras enquanto " +
                    `elas continuarem predominantes (pelo menos ${c.dominance} dos casos).`
                ]
            });
        }
        if (c.sections.glossary) {
            blocks.push({ kind: "h", text: "O que significa cada número" });
            blocks.push({
                kind: "terms",
                items: [
                    ["% do total", `Fatia do total de ${t} que pertence ao perfil.`],
                    ["Barra", "Comprimento = % do total (a barra cheia seria 100%)."]
                ]
            });
        }
    }

    if (c.sections.cautions) {
        blocks.push({ kind: "h", text: "Cuidados na leitura" });
        const items = [
            "Os padrões mostram associação, não causa: indicam onde olhar, não o porquê.",
            "Um mesmo grupo pode aparecer em mais de um padrão (sozinho e combinado com outras características).",
            "Com filtros muito restritos há poucos casos, e menos padrões passam nas regras."
        ];
        if (c.mode === "share") {
            items.unshift("Grupos grandes reúnem muitos casos mesmo saindo na média: se a maioria das pessoas (ou clientes) tem uma " +
                "característica, é natural que a maioria dos casos também tenha.");
        }
        blocks.push({ kind: "list", items });
    }
    if (c.extraText.trim()) {
        if (c.extraTitle.trim()) {
            blocks.push({ kind: "h", text: c.extraTitle.trim() });
        }
        c.extraText.split(/\n{2,}/).forEach(p => blocks.push({ kind: "p", text: p.trim() }));
    }
    return blocks;
}

/** Guia para quem desenvolve: como devem ser os campos e as medidas, mais a conferência dos dados atuais. */
export function guideContent(missing: string[], checks: Array<{ ok: boolean | "info"; text: string }>): Block[] {
    const blocks: Block[] = [
        { kind: "h", text: "Guia de medidas (para quem desenvolve)" },
        {
            kind: "p",
            text: "Este quadro aparece enquanto faltam campos ou quando Formatar visual → Guia de medidas está ligado. " +
                "Desligue antes de publicar: quem lê o relatório usa o botão de ajuda."
        }
    ];
    if (missing.length > 0) {
        blocks.push({ kind: "checks", items: missing.map(m => ({ ok: false, text: `Falta: ${m}` })) });
    }
    blocks.push(
        { kind: "h", text: "1. Atributos (até 6)" },
        {
            kind: "list",
            items: [
                "Colunas com poucos valores: Senioridade, Liderança (Sim/Não), Faixa de tempo de casa, Área, Gênero, Plano, Canal…",
                "Números contínuos (idade, meses de casa, salário) precisam virar faixas numa coluna calculada.",
                "Use o valor do momento da saída (ex.: a senioridade quando a pessoa saiu), em tabelas relacionadas às tabelas das medidas."
            ]
        },
        { kind: "h", text: "2. Saídas (obrigatória)" },
        {
            kind: "p",
            text: "Uma contagem que possa ser somada entre os perfis: Saídas(Sênior) = Saídas(Sênior, com liderança) + " +
                "Saídas(Sênior, sem liderança). Não use taxas, médias nem percentuais."
        },
        { kind: "code", text: "Saídas = COUNTROWS ( Desligamentos )" },
        {
            kind: "list",
            items: [
                "A tabela de desligamentos deve estar relacionada ao calendário pela data de saída e às tabelas dos atributos.",
                "Para cancelamentos de clientes, contratos perdidos etc., a ideia é a mesma: uma linha por caso."
            ]
        },
        { kind: "h", text: "3. Base (opcional, recomendada)" },
        {
            kind: "p",
            text: "A população de onde as saídas vieram, no mesmo período e com os mesmos atributos. Com ela, o visual compara a " +
                "taxa de cada perfil com a média; sem ela, só mostra onde os casos se concentram."
        },
        {
            kind: "code",
            text: "Headcount médio =\nAVERAGEX (\n    VALUES ( Calendário[Mês] ),\n    VAR Fim = CALCULATE ( MAX ( Calendário[Data] ) )\n" +
                "    RETURN\n        CALCULATE (\n            COUNTROWS ( Colaboradores ),\n            Colaboradores[Data de admissão] <= Fim,\n" +
                "            Colaboradores[Data de desligamento] > Fim\n                || ISBLANK ( Colaboradores[Data de desligamento] )\n        )\n)"
        },
        {
            kind: "list",
            items: [
                "Também precisa ser somável (contagem, soma ou média de contagens por mês, como acima).",
                "Precisa ter valor nos perfis sem saídas, senão a taxa média fica errada.",
                "Quem saiu precisa estar na Base do seu perfil: perfil com saídas e Base vazia indica medida ou relacionamento errado.",
                "Para clientes: Clientes ativos = DISTINCTCOUNT ( Contratos[Cliente] ), no mesmo período dos cancelamentos."
            ]
        },
        { kind: "h", text: "4. Como o visual usa as medidas" },
        {
            kind: "p",
            text: "O visual pede ao Power BI as duas medidas para cada combinação dos atributos (até 30 mil combinações) e soma " +
                "as linhas para montar cada perfil. Taxa = Saídas ÷ Base; taxa média = total de Saídas ÷ total da Base. " +
                "Por isso as medidas precisam ser somáveis. Os filtros da página e de outros visuais valem normalmente."
        }
    );
    if (checks.length > 0) {
        blocks.push({ kind: "h", text: "Conferência dos dados atuais" }, { kind: "checks", items: checks });
    }
    return blocks;
}
