# Colunas Empilhadas e Linha

Réplica do gráfico nativo **"Gráfico de colunas empilhadas e de linhas"** do Power BI, com uma **legenda interativa** em botões arredondados: clique para **mostrar ou esconder** cada série (um produto da legenda, uma medida de coluna ou uma linha) ou use os botões **Colunas** e **Linhas** para ligar e desligar todas de uma vez. A escala se reajusta ao que fica visível, com uma animação suave. Segue o padrão visual do repositório ([DESIGN.md](../../DESIGN.md)).

| Padrão | Legenda interativa (itens escondidos) | Várias medidas e rótulos |
|---|---|---|
| ![Padrão](docs/1-padrao.png) | ![Legenda interativa](docs/2-legenda-interativa.png) | ![Medidas e rótulos](docs/3-medidas-rotulos.png) |

## Como usar

1. Baixe [`dist/colunasLinha621BDED5AAC041AC84F6559C9571914C.1.0.0.0.pbiviz`](dist/) e importe no Power BI (**Visualizações → `…` → Importar um visual de um arquivo**).
2. Arraste os campos (os mesmos nomes do visual nativo):
   - **Eixo X**: cada valor vira uma coluna (ex.: Mês, Região).
   - **Eixo Y da coluna**: medidas empilhadas. Sem legenda, cada medida vira um segmento da pilha.
   - **Legenda da coluna** (opcional): divide a coluna em segmentos (ex.: Produto). Com legenda, use uma medida só no Eixo Y da coluna, como no nativo.
   - **Eixo Y da linha**: uma ou mais medidas desenhadas como linhas (ex.: Margem %, Meta).
   - **Dicas de ferramenta** (opcional): medidas extras mostradas ao passar o mouse.

## Legenda interativa

- **Um botão por série**: clique para esconder ou mostrar. A série escondida fica esmaecida, riscada e com a amostra de cor vazada.
- **Duplo clique** numa série mostra só ela (as do outro tipo continuam como estão).
- **Botões Colunas / Linhas**: escondem ou mostram todas as colunas ou todas as linhas de uma vez.
- **↺ Mostrar tudo** aparece quando há algo escondido.
- Escala, totais e dica de ferramenta consideram só o que está visível. Com tudo escondido, aparece um aviso.
- Dá para escolher o que começa visível ao abrir (ex.: só as colunas) em **Legenda interativa → Colunas/Linhas visíveis ao abrir**.

## Recursos

- **Linha calculada na categoria inteira**: a linha não é dividida pela legenda (como no nativo). Uma Margem % continua certa mesmo com Produto na legenda.
- **Eixo Y secundário** para as linhas, ou a mesma escala das colunas.
- **Colunas**: negativos empilham para baixo, arredondamento do topo, espaço entre colunas, opacidade, borda e cor de cada série.
- **Linhas**: reta, suave ou em degraus; contínua, tracejada ou pontilhada; marcadores (círculo, quadrado ou losango, cheio ou vazado); área sombreada; vazios interrompem, ligam os pontos ou viram zero.
- **Rótulos**: valor de cada segmento (com contraste automático), **total** acima de cada pilha e rótulos das linhas (todos os pontos, último, primeiro e último, ou maior e menor), com fundo atrás do texto. Rótulos que se sobrepõem são desviados ou escondidos.
- **Eixos**: mínimo e máximo, unidades de exibição (automático, mil, milhões, bilhões), casas decimais, títulos, grade (cor, opacidade, estilo) e rotação dos rótulos do eixo X (automática, horizontal, 45°, vertical).
- **Rolagem horizontal**: com uma largura mínima por categoria, o gráfico rola e os eixos ficam fixos.
- **Filtro cruzado**: clique num segmento (categoria × legenda) ou na categoria para filtrar os outros visuais (Ctrl + clique para vários); o resto fica esmaecido. Menu do botão direito e Ctrl+C / Ctrl+V.
- **Dica de ferramenta** com todos os valores da categoria (e o total) ou só o item sob o mouse; destaque da categoria sob o mouse.
- **Números** no formato de cada medida e no idioma do relatório.

## Formatação

- **Geral:** fonte e animação.
- **Cabeçalho:** título e subtítulo (texto, tamanho e cor).
- **Legenda interativa:** mostrar, posição (em cima ou embaixo), alinhamento, botões Colunas / Linhas e por série, textos, o que começa visível, tamanho da fonte, altura, arredondamento, cores (fundo, texto, botões ligados), opacidade do que está escondido, espessura e cor da borda.
- **Colunas** e **Cores das colunas:** espaço, arredondamento, opacidade, borda e cor de cada série.
- **Linhas** e **Cores das linhas:** espessura, estilo, traçado, marcadores, área, vazios e cor de cada linha.
- **Eixo X:** mostrar, fonte, cor, negrito, rotação, largura mínima da categoria, linha do eixo e título.
- **Eixo Y (colunas)** e **Eixo Y secundário (linhas):** mostrar, fonte, cor, mínimo, máximo, unidades, casas decimais, título e grade.
- **Rótulos das colunas**, **do total** e **das linhas:** mostrar, posição, fonte, cor, negrito, unidades e casas decimais.
- **Interação:** tipo da dica de ferramenta, destaque da categoria sob o mouse e opacidade do que não está selecionado.

## Observações

- Até 1000 categorias no eixo X e 60 itens na legenda.
- O que foi escondido na legenda vale enquanto o relatório está aberto. Para definir o estado inicial, use as opções "visíveis ao abrir".
- Os dados chegam no formato matriz (linhas = Eixo X, colunas = Legenda, com subtotal), para que a linha seja calculada sem o filtro da legenda.
