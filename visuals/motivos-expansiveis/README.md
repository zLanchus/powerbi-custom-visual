# Motivos Expansíveis

Mostra os **motivos principais** de uma pesquisa (ou de qualquer par categoria › subcategoria) e, ao clicar num motivo, os **motivos de detalhamento** dele. No layout **horizontal** (padrão), os motivos ficam numa coluna à esquerda e o detalhamento do motivo escolhido aparece ao lado, **ligado por faixas** cuja grossura é proporcional ao valor de cada detalhamento (como num Sankey). No layout **vertical**, o motivo abre para baixo, como um acordeão. Cada motivo tem a posição, uma barra, o valor e o % do total. Tem **pesquisa** (sem diferenciar acentos), **filtro cruzado**, **insight** automático e mais de 190 opções de formatação. Segue o padrão visual do repositório ([DESIGN.md](../../DESIGN.md)).

![Layout horizontal](docs/1-horizontal.png)

| Pesquisa | Filtro cruzado por detalhamento |
|---|---|
| ![Pesquisa](docs/2-pesquisa.png) | ![Filtro](docs/3-filtro.png) |

| Layout vertical (acordeão) | Personalizado pelo painel |
|---|---|
| ![Vertical](docs/4-vertical.png) | ![Personalizado](docs/5-personalizado.png) |

A última imagem é o mesmo visual só com opções do painel: fundo escuro, fonte Georgia, título centralizado em itálico, insight em cima, seta à esquerda, posição em quadrado, maior motivo e motivo escolhido em destaque, "submotivos" no lugar de "detalhamentos" e percentual entre parênteses.

## Como usar

1. Baixe [`dist/motivosExpansiveis5E8B4DD7DA854EB5ABE37E7ADD5E5227.1.2.0.0.pbiviz`](dist/) e importe no Power BI (**Visualizações → `…` → Importar um visual de um arquivo**).
2. Arraste os campos:
   - **Motivo principal**: a coluna do motivo (ex.: *Motivo do cancelamento*). Cada valor vira uma linha.
   - **Detalhamento**: a coluna do detalhamento do motivo (ex.: *Submotivo*). Aparece ao abrir o motivo. Opcional: sem ela, o visual vira um ranking simples.
   - **Valor**: a medida que dá o tamanho de cada item. Para contar respostas, arraste o ID da resposta e escolha **Contagem** (ou **Contagem (distinta)**), ou use uma medida como `Respostas = COUNTROWS(Pesquisa)`.
   - **Dicas de ferramenta** (opcional): medidas extras mostradas ao passar o mouse (ex.: nota média).

## Recursos

- **Layout horizontal** (padrão):
  - motivos à esquerda e o detalhamento do motivo escolhido à direita, com o nome dele em destaque, o valor, o % do total e o nº de detalhamentos;
  - **faixas** ligam o motivo a cada detalhamento, com grossura proporcional ao valor (ou **linhas finas**, se preferir); a ligação de quem está escondido atrás do "+ N" vai para o botão;
  - as faixas "saem" do motivo com animação ao trocar de motivo e acompanham a rolagem das duas colunas;
  - passar o mouse num detalhamento destaca a linha, a fatia na faixa de composição e a ligação;
  - clicar de novo no motivo escolhido fecha o painel (e tira o filtro);
  - em visuais estreitos (padrão: menos de 520 px) ele vira o layout vertical sozinho; sem o campo Detalhamento, vira um ranking simples.
- **Layout vertical:** o motivo abre para baixo, como acordeão.
- **Abrir e fechar (vertical):** clique no motivo (ou na seta) para abrir o detalhamento, com animação. Botões **Abrir todos** e **Fechar todos** ao lado da pesquisa. Opção **Abrir um motivo por vez**.
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
- **Teclado:** `↑`/`↓` navegam (no horizontal, dentro da coluna), `→` abre o motivo (ou entra no detalhamento), `←` fecha (ou volta ao motivo), `Enter`/`Espaço` clicam, `Home`/`End`. Da pesquisa, `↓` vai para a lista.
- **Visual estreito** (menos de 380 px): o contador some e a barra do detalhamento vai para baixo do nome, para o texto não ser cortado.
- **Alto contraste** do Windows e lugares sem interação (como painéis/dashboards) são respeitados.
- **Números** no formato da medida e no idioma do relatório.

## Formatação

São mais de 190 opções, organizadas em grupos como nos visuais nativos. Todo texto tem o controle de fonte completo do Power BI (**fonte, tamanho, negrito, itálico e sublinhado**) e cor própria. Os textos que ficam com a fonte padrão usam a **fonte base** do cartão Geral, então dá para trocar a fonte de tudo num lugar só e ainda mudar um texto específico.

- **Geral:** fonte base, cor de fundo do visual e margem interna.
- **Layout:**
  - *Disposição*: horizontal ou vertical, largura mínima para o horizontal (abaixo dela vira vertical), largura da coluna de motivos (%) e espaço entre as colunas;
  - *Ligações* (liga e desliga): faixas proporcionais ou linhas finas, cor e opacidade;
  - *Títulos das colunas* (liga e desliga): textos (em branco = nome do campo), fonte, cor e letras maiúsculas;
  - *Motivo escolhido*: fundo, espessura e cor da borda;
  - *Painel do detalhamento*: motivo em destaque (fonte e cor) e texto antes de escolher um motivo.
- **Cabeçalho:**
  - *Título*, *Subtítulo* e *Resumo*: texto, fonte e cor (o resumo liga e desliga e aceita `{total}`, `{motivos}` e `{detalhamentos}`);
  - *Layout*: alinhamento (esquerda, centro, direita) e espaço abaixo.
- **Pesquisa e botões:**
  - *Pesquisa* (liga e desliga): texto da caixa, fonte, cor do texto e da lupa, fundo, altura, arredondamento, borda, cor do destaque do texto achado e mensagem quando não acha nada (`{pesquisa}`);
  - *Botões abrir/fechar tudo* (liga e desliga): fundo, cor do ícone, arredondamento, borda e sombra.
- **Interação:** clique no motivo (abrir e filtrar ou só abrir), abrir um por vez, estado ao carregar, animação e duração (ms), opacidade do que não está selecionado.
- **Ordenação:** valor, nome (A–Z) ou ordem do Power BI, e direção.
- **Motivos:**
  - *Texto*: fonte, cor e quebrar texto longo (em vez de reticências);
  - *Cartão*: fundo, fundo quando aberto, arredondamento, espaço entre motivos, espaçamento lateral e vertical, borda, sombra quando aberto e motivos visíveis;
  - *Posição*: forma (círculo, quadrado arredondado ou só o número), cores e tamanho;
  - *Nº de detalhamentos*: tamanho, cor e as palavras no singular e no plural (ex.: *submotivo / submotivos*);
  - *Seta*: cor, tamanho e posição (direita ou esquerda).
- **Barras dos motivos:** mostrar, cor, destacar o maior motivo com outra cor, trilho, espessura, arredondamento e escala.
- **Detalhamentos:**
  - *Texto*: fonte, cor e quebrar texto longo;
  - *Área*: fundo, arredondamento, altura mínima da linha e cor ao passar o mouse;
  - *Barras* (liga e desliga): cor, trilho, espessura e arredondamento;
  - *Linha guia* (liga e desliga): cor;
  - *Faixa de composição* (liga e desliga): cor e altura;
  - *Conteúdo*: percentual do motivo ou do total, detalhamentos visíveis, detalhamentos em branco e cor do botão "Ver mais".
- **Valores:**
  - *Valor* (liga e desliga): fonte e cor dos motivos, tamanho e cor nos detalhamentos, unidades de exibição (nenhuma, automática, mil, milhões, bilhões) e casas decimais;
  - *Percentual* (liga e desliga): estilo (`33,0%`, `(33,0%)` ou `· 33,0%`), casas decimais, fonte e cor dos motivos, tamanho e cor nos detalhamentos.
- **Insight** (liga e desliga):
  - *Texto*: modelo com marcadores, fonte, cor, marcadores em negrito e cor dos marcadores;
  - *Caixa*: posição (embaixo ou em cima da lista), fundo, arredondamento, borda, ícone e cor do ícone.

## Observações

- O valor de cada motivo e o total vêm do próprio Power BI (subtotais da consulta), então medidas não somáveis, como **Contagem (distinta)** ou médias, ficam corretas.
- Detalhamentos em branco ficam escondidos por padrão; um motivo sem detalhamento não abre (o clique só filtra).
- Até 30 mil combinações de motivo e detalhamento.
