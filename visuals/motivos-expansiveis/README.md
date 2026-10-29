# Motivos Expansíveis

Ranking dos **motivos principais** de uma pesquisa (ou de qualquer par categoria › subcategoria) em que cada motivo **abre ao clicar** e mostra os **motivos de detalhamento** dele. Cada linha tem a posição, uma barra, o valor e o percentual do total; ao abrir, aparece uma **faixa de composição** (a fatia de cada detalhamento no motivo) e as barras dos detalhamentos crescem com animação. Tem **pesquisa** (sem diferenciar acentos), **filtro cruzado** e uma **frase de insight** automática. Segue o padrão visual do repositório ([DESIGN.md](../../DESIGN.md)).

| Padrão (primeiro motivo aberto) | Pesquisa | Filtro cruzado por detalhamento |
|---|---|---|
| ![Padrão](docs/1-padrao.png) | ![Pesquisa](docs/2-pesquisa.png) | ![Filtro](docs/3-filtro.png) |

## Como usar

1. Baixe [`dist/motivosExpansiveis5E8B4DD7DA854EB5ABE37E7ADD5E5227.1.0.0.0.pbiviz`](dist/) e importe no Power BI (**Visualizações → `…` → Importar um visual de um arquivo**).
2. Arraste os campos:
   - **Motivo principal**: a coluna do motivo (ex.: *Motivo do cancelamento*). Cada valor vira uma linha.
   - **Detalhamento**: a coluna do detalhamento do motivo (ex.: *Submotivo*). Aparece ao abrir o motivo. Opcional: sem ela, o visual vira um ranking simples.
   - **Valor**: a medida que dá o tamanho de cada item. Para contar respostas, arraste o ID da resposta e escolha **Contagem** (ou **Contagem (distinta)**), ou use uma medida como `Respostas = COUNTROWS(Pesquisa)`.
   - **Dicas de ferramenta** (opcional): medidas extras mostradas ao passar o mouse (ex.: nota média).

## Recursos

- **Abrir e fechar:** clique no motivo (ou na seta) para abrir o detalhamento, com animação. Botões **Abrir todos** e **Fechar todos** ao lado da pesquisa. Opção **Abrir um motivo por vez** (acordeão).
- **Ao carregar:** primeiro motivo aberto (padrão), todos fechados ou todos abertos.
- **Pesquisa:** procura nos motivos e nos detalhamentos, sem diferenciar maiúsculas e acentos (`servico` acha *Serviço*). O trecho encontrado fica marcado, os motivos achados pelo detalhamento abrem sozinhos e mostram só os detalhamentos que batem (`1 de 3`). `Esc` limpa a pesquisa.
- **Percentuais:** o motivo mostra o % do total; o detalhamento, o % **do motivo** (padrão) ou **do total**.
- **Faixa de composição:** barra 100% com a fatia de cada detalhamento. Passar o mouse numa fatia destaca a linha correspondente (e vice-versa).
- **Ver mais:** limite de detalhamentos por motivo (padrão 5) e de motivos na lista (padrão todos), com os botões **+ N detalhamentos** / **Ver mais N motivos**.
- **Insight** automático, embaixo da lista: *"Preço é o principal motivo, com 33,0% do total. Dentro dele, destaca-se Mensalidade alta (40,8%)."*. O texto é editável com os marcadores `{motivo}`, `{valor}`, `{percentual}`, `{detalhe}`, `{valorDetalhe}` e `{percentualDetalhe}` (este é sempre o % dentro do motivo). Se o motivo não tiver detalhamento, as frases que falam dele somem sozinhas. Clicar no insight abre o motivo citado.
- **Resumo** no cabeçalho: `1.248 no total · 6 motivos` (marcadores `{total}`, `{motivos}` e `{detalhamentos}`).
- **Filtro cruzado:**
  - abrir um motivo filtra os outros visuais por ele, e fechar tira o filtro (ou escolha **Só abrir e fechar** em *Interação → Clique no motivo*);
  - clicar num detalhamento filtra por motivo + detalhamento;
  - Ctrl + clique soma itens à seleção; o que não está selecionado fica esmaecido; clique no vazio limpa.
  - Menu do botão direito e Ctrl+C / Ctrl+V do Power BI.
- **Teclado:** `↑`/`↓` navegam, `→` abre (ou entra no detalhamento), `←` fecha (ou volta ao motivo), `Enter`/`Espaço` clicam, `Home`/`End`. Da pesquisa, `↓` vai para a lista.
- **Visual estreito** (menos de 380 px): o contador some e a barra do detalhamento vai para baixo do nome, para o texto não ser cortado.
- **Alto contraste** do Windows e lugares sem interação (como painéis/dashboards) são respeitados.
- **Números** no formato da medida e no idioma do relatório.

## Formatação

- **Geral:** fonte.
- **Cabeçalho:** título, subtítulo e resumo (texto, tamanho e cor).
- **Pesquisa e botões:** mostrar pesquisa, texto da caixa, botões abrir/fechar tudo, fundo, texto, tamanho, altura, arredondamento, espessura e cor da borda.
- **Interação:** clique no motivo (abrir e filtrar ou só abrir), abrir um motivo por vez, estado ao carregar, animação e opacidade do que não está selecionado.
- **Ordenação:** valor (padrão, maior primeiro), nome (A–Z) ou ordem do Power BI, e direção. Vale para motivos e detalhamentos.
- **Motivos:** fundo, texto, tamanho, negrito, posição (cores do círculo), nº de detalhamentos, arredondamento, espaço entre motivos, espessura e cor da borda, motivos visíveis.
- **Barras dos motivos:** mostrar, cor, trilho, espessura, arredondamento e escala (maior motivo = barra cheia, ou total = barra cheia). A cor da barra também é a cor de destaque (foco, pesquisa e ícone do insight).
- **Detalhamentos:** fundo, texto, tamanho, negrito, cor da barra, trilho, espessura, linha guia, percentual (do motivo ou do total), detalhamentos visíveis, faixa de composição e detalhamentos em branco.
- **Valores:** mostrar valor e percentual, casas decimais, tamanho, cores e negrito.
- **Insight:** mostrar, texto, tamanho, cor do texto e de fundo.

## Observações

- O valor de cada motivo e o total vêm do próprio Power BI (subtotais da consulta), então medidas não somáveis, como **Contagem (distinta)** ou médias, ficam corretas.
- Detalhamentos em branco ficam escondidos por padrão; um motivo sem detalhamento não abre (o clique só filtra).
- Até 30 mil combinações de motivo e detalhamento.
