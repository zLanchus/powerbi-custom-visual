# Power BI Custom Visuals

**⬇️ Baixe os visuais em: https://zlanchus.github.io/powerbi-custom-visual/**

Coleção de **visuais personalizados para Power BI**, feitos em TypeScript + HTML/CSS com o SDK oficial (`powerbi-visuals-tools`). Cada visual tem sua pasta em [`visuals/`](visuals/) com código, documentação e o arquivo **`.pbiviz` pronto para importar**.

## Visuais

| Visual | O que faz | Download |
|---|---|---|
| [**Filtro em Pop-up**](visuals/filtro-popup/) | Botão "Abrir Filtros" que abre um pop-up com slicers: filtros simples, filtros aninhados em árvore (ex.: Ano › Mês), colunas de várias tabelas, pesquisa, limpar todos, copiar/colar, sincronização entre páginas, modo catálogo (muitos filtros, leve e completo) e formatação completa. | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/filtro-popup.pbiviz) |
| [**Segmentação Estilizada**](visuals/segmentacao/) | Substituto da segmentação nativa com três estilos: blocos (botões), lista vertical ou suspenso. Mesmo padrão visual e de formatação do Filtro em Pop-up. | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/segmentacao.pbiviz) |
| [**Matriz Estilizada**](visuals/matriz/) | Matriz com linhas, colunas e valores como a nativa, com seções de colunas configuráveis, hierarquia expansível, subtotais e formatação condicional por célula. | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/matriz.pbiviz) |
| [**Pirâmide Segmentada**](visuals/piramide/) | Funil/pirâmide como o nativo, com as barras divididas em segmentos coloridos por um campo de legenda. Tem modo pirâmide espelhada (etária), conectores com taxa de conversão e rótulos de total e %. | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/piramide.pbiviz) |
| [**Card Comparativo**](visuals/card-comparativo/) | Card de KPI com o valor principal em destaque, o período selecionado (medida do calendário) e até 5 comparações com outras medidas (meta, mês anterior, ano anterior), com diferença ou variação %, cores e setas. | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/card-comparativo.pbiviz) |
| [**Barras com Insight**](visuals/barras-ranking/) | Barras horizontais com trilho no estilo de ranking: valor e detalhe ao lado (ex.: 24,2% (18)), top N, ordenação por outro campo (ex.: ordem do nível), cor com fx e frase de insight automática (maior ou menor valor). | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/barras-ranking.pbiviz) |
| [**Colunas Empilhadas e Linha**](visuals/colunas-linha/) | Réplica do gráfico nativo de colunas empilhadas e linhas com legenda interativa: botões para mostrar ou esconder cada série ou todas as colunas / linhas, eixo secundário, rótulos de total e formatação completa. | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/colunas-linha.pbiviz) |
| [**Colunas Agrupadas e Linha**](visuals/colunas-agrupadas-linha/) | A versão agrupada (clusterizada) do Colunas Empilhadas e Linha: colunas lado a lado, com a mesma legenda interativa, rótulos acima das colunas, eixos por medida, colunas sempre abaixo das linhas, Ano e Mês aninhados e formatação completa. | [`.pbiviz`](https://zlanchus.github.io/powerbi-custom-visual/downloads/colunas-agrupadas-linha.pbiviz) |

<p align="center">
  <img src="visuals/filtro-popup/docs/1-fechado.png" width="300" alt="Botão Abrir Filtros">
  <img src="visuals/filtro-popup/docs/3-aninhado.png" width="300" alt="Pop-up com filtros aninhados">
</p>

## Como importar um visual no Power BI

1. Baixe o arquivo `.pbiviz` na [página de download](https://zlanchus.github.io/powerbi-custom-visual/) (ou na pasta `dist/` do visual).
2. No Power BI Desktop: painel **Visualizações → `…` → Importar um visual de um arquivo**.
3. Selecione o `.pbiviz`. O visual aparece no painel de visualizações do relatório.

## Padrão visual

Todos os visuais usam o mesmo padrão: **azul-claro `#6CBEEB`** como cor principal, **azul-marinho `#0F2B45`** para texto e **`#F1F8FD`** para painéis, além das mesmas formas e opções de formatação. Visuais novos devem seguir o **[DESIGN.md](DESIGN.md)**.

## Estrutura do repositório

```
powerbi-custom-visual/
├── visuals/
│   ├── filtro-popup/        # um visual por pasta
│   ├── segmentacao/
│   ├── matriz/
│   ├── piramide/
│   ├── card-comparativo/
│   ├── barras-ranking/
│   ├── colunas-linha/
│   └── colunas-agrupadas-linha/
│       ├── src/             # código TypeScript
│       ├── style/           # estilos (LESS)
│       ├── assets/          # ícone
│       ├── docs/            # imagens do README
│       ├── dist/            # .pbiviz pronto para importar
│       ├── capabilities.json
│       ├── pbiviz.json
│       └── README.md
├── site/                    # página de download (GitHub Pages)
├── DESIGN.md                # padrão visual (cores, formas, opções) para todos os visuais
└── .github/workflows/       # build de todos os visuais + publicação do site
```

## Desenvolvimento

Requisitos: Node.js 18 ou superior.

```bash
cd visuals/<nome-do-visual>
npm install
npm run lint        # ESLint
npm run package     # gera dist/*.pbiviz
npm start           # servidor de desenvolvimento (Developer Visual no Power BI Service)
```

A cada push na `main`, o GitHub Actions instala, valida e empacota todos os visuais e publica a página de download no GitHub Pages com os `.pbiviz` recém-gerados. Para ver o site localmente: `node site/build.mjs` e abra `_site/index.html`.

### Adicionando um novo visual

1. `npx powerbi-visuals-tools new <nome>` dentro de `visuals/` e aplique o padrão do [DESIGN.md](DESIGN.md).
2. Preencha `pbiviz.json` (nome, descrição, autor) e escreva um `README.md` para ele.
3. Rode `npm run package` e faça commit do `dist/*.pbiviz`.
4. Adicione uma linha na tabela de visuais acima, o visual em `site/visuals.json` e o nome da pasta na lista `matrix.visual` de `.github/workflows/build.yml`.

## Licença

[MIT](LICENSE)
