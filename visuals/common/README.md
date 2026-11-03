# common

Código compartilhado pelos visuais de gráfico [Barras com Comparação](../barras-comparacao/) e [Curvas com Incerteza](../curvas-incerteza/). Não é um visual: não gera `.pbiviz`.

| Arquivo | O que tem |
|---|---|
| `src/axes.ts` | Eixos (d3-axis), grade e títulos de eixo com o estilo do painel |
| `src/format.ts` | Formatadores com a string de formato da medida e o idioma do relatório; medir e truncar texto |
| `src/values.ts` | Funções puras: número de uma célula (vazio = null), baixa confiança, domínio do eixo, listas do painel |
| `src/tooltip.ts` | Dicas de ferramenta nativas (e de página, via identidades) |
| `src/selection.ts` | Seleção (clique, Ctrl+clique, fundo, menu de contexto) e navegação por teclado |
| `src/emptyState.ts` | Estado vazio: mostra quais campos preencher |
| `src/colors.ts` | Cores padrão do [DESIGN.md](../../DESIGN.md), alto contraste, mistura e contraste de cores |
| `src/i18n.ts` | Textos da interface vindos de `stringResources` |
| `src/d3.ts` | Módulos do D3 usados pelos visuais (só os módulos, não o d3 inteiro) |
| `style/common.less` | Estilos comuns (raiz, legenda, aviso no canto, estado vazio) |

Os visuais importam por caminho relativo (`../../common/src/...`). As dependências do `common` (D3 e `powerbi-visuals-utils-formattingutils`) ficam em `common/node_modules` e são instaladas pelo `postinstall` de cada visual (`npm ci --prefix ../common`).
