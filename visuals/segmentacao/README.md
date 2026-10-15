# Segmentação Estilizada

Substituto mais bonito da **segmentação de dados (slicer) nativa** do Power BI, no mesmo padrão visual do [Filtro em Pop-up](../filtro-popup/). Funciona como a segmentação nativa: filtra os outros visuais da página, fica salva no relatório, respeita indicadores (bookmarks) e pode ser sincronizada entre páginas.

| Blocos (botões) | Lista vertical | Suspenso |
|---|---|---|
| ![Blocos](docs/1-blocos.png) | ![Lista](docs/2-lista.png) | ![Suspenso](docs/3-suspenso.png) |

## Como usar

1. Baixe [`dist/segmentacaoEstilizada9140412062C0470F98172EC5D1A911C8.1.1.0.0.pbiviz`](dist/).
2. No Power BI Desktop: **Visualizações → `…` → Importar um visual de um arquivo**.
3. Arraste **uma coluna** para **Campo**.
4. Em **Formatar visual → Layout → Estilo**, escolha **Blocos (botões)**, **Lista vertical** ou **Suspenso**.

## Recursos

- **Três estilos:** blocos lado a lado (com número de colunas automático ou fixo), lista vertical com rolagem, ou caixa suspensa no estilo do botão "Abrir Filtros".
- **Seleção múltipla** (clique marca/desmarca) ou **seleção única**.
- **Selecionar tudo** (opcional), **pesquisa** na lista e no suspenso (aparece com mais de 6 valores).
- **Cabeçalho** com o nome do campo (ou texto próprio) e botão de **limpar seleção**.
- **Copiar e colar** (`Ctrl+C` / `Ctrl+V` e menu do botão direito) e **sincronizar segmentações** entre páginas.
- A ordem dos valores segue o Power BI (inclusive "Classificar por coluna").

## Formatação (painel "Formatar visual")

- **Layout:** estilo, seleção única, "Selecionar tudo", pesquisa, colunas dos blocos (0 = automático), espaçamento entre itens.
- **Cabeçalho:** mostrar, texto, tamanho da fonte, fonte, cor, botão de limpar.
- **Itens:** tamanho da fonte, fonte, cor de fundo e do texto, cor de fundo e do texto quando **selecionado**, arredondamento, altura, espessura e cor da borda, mostrar caixa de seleção.
- **Suspenso:** texto quando nada está selecionado, cor de fundo e do texto da caixa, tamanho da fonte, arredondamento, altura, espessura e cor da borda, cor da lista aberta.

## Observações

- **Suspenso:** como em todo visual personalizado, a lista aberta só aparece **dentro da área do visual** (o Power BI não deixa desenhar fora dela). Deixe o visual alto o suficiente para a lista; com ela fechada, a área abaixo da caixa fica transparente.
- Um campo por visual, como na segmentação nativa. Para vários campos num lugar só, use o [Filtro em Pop-up](../filtro-popup/).
