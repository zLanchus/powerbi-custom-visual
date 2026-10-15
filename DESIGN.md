# Padrão visual dos visuais

Todos os visuais deste repositório seguem o mesmo padrão de cores, formas e opções de formatação. **Todo visual novo deve seguir este guia.**

## Cores padrão

| Papel | Cor | Uso |
|---|---|---|
| **Primária** (azul-claro) | `#6CBEEB` | Botões principais, itens selecionados, fundo do pop-up, caixa do suspenso, cabeçalho da página de download |
| **Texto / escuro** (azul-marinho) | `#0F2B45` | Texto e ícones sobre a primária e sobre painéis claros; botão de ação principal ("Fechar") |
| **Painel claro** | `#F1F8FD` | Fundo de blocos, itens não selecionados, listas |
| **Branco** | `#FFFFFF` | Caixas de pesquisa, listas suspensas abertas, caixas de seleção marcadas |

- Estas são apenas as cores **padrão**: toda cor deve poder ser trocada pelo painel **Formatar visual**.
- Não use outras cores fixas no código. Se precisar de um tom intermediário, use transparência (`rgba(0, 0, 0, .08)` para hover, por exemplo) ou `filter: brightness(...)`.
- No código, as cores ficam como constantes em `src/settings.ts` (valores padrão do painel) e como variáveis CSS no topo de `style/visual.less` — mantenha as duas em sincronia.

## Formas e tipografia

- Fonte padrão: `"Segoe UI", wf_segoe-ui_normal, helvetica, arial, sans-serif`.
- Cantos arredondados: botões principais 14px, itens 10px, pop-ups/listas abertas iguais ao botão que os abre.
- Botão principal: altura ~48–56px, texto em negrito (600), ícone à esquerda, **divisória vertical** e **seta (chevron)** à direita, que gira ao abrir.
- Ícones em SVG de traço (`stroke`), espessura ~2.2, sem preenchimento.
- Sombra leve nos botões (`0 1px 2px rgba(0,0,0,.12)`, mais forte no hover) e sombra média em pop-ups.

## Opções de formatação esperadas

Todo visual deve oferecer, no mínimo, para cada parte relevante (botão, pop-up/lista, itens):

- cor de fundo e cor do texto (incluindo o estado **selecionado**, quando houver);
- tamanho da fonte e fonte;
- arredondamento e altura;
- **espessura e cor da borda** (padrão 0 = sem borda).

## Comportamento esperado

- Filtros aplicados com `applyJsonFilter` (mesma mecânica da segmentação nativa) e estado restaurado de `options.jsonFilters`.
- `supportsSynchronizingFilterState: true` (sincronizar segmentações) quando o visual filtra.
- Menu do botão direito (`selectionManager.showContextMenu`) e `mousedown` com `preventDefault` fora de campos de texto, para `Ctrl+C` / `Ctrl+V` funcionarem.
- Textos da interface em português do Brasil.
- Números formatados com `valueFormatter` (`powerbi-visuals-utils-formattingutils`) usando o formato da medida e `host.locale`. Nesse caso, inclua `stringResources/pt-BR/resources.resjson` (e `en-US`): sem isso o empacotador remove os formatos de país e os números saem no padrão americano.

## Checklist para um visual novo

1. Copiar as cores padrão acima para `src/settings.ts` e `style/visual.less`.
2. Ícone (`assets/icon.png`, 20×20) usando a primária e o azul-marinho.
3. Imagens em `docs/` geradas com as cores padrão.
4. Adicionar o visual em `site/visuals.json`, na tabela do `README.md` e em `matrix.visual` do workflow.
