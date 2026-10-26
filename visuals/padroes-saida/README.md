# Padrões de Saída

Visual de **destaques e insights de turnover** que responde à pergunta *"quem está saindo?"*. Você coloca as características (senioridade, liderança, faixa de tempo de casa, área…) e a medida de saídas. O visual procura sozinho as **combinações desses atributos** que explicam as saídas e mostra:

- um **destaque** com a regra principal, como *Liderança: Não · Tempo de casa: Até 1 ano · Área: Comercial, com taxa 3,5× a média*;
- uma **lista de padrões** com uma frase pronta, um número em destaque e uma barra comparada à média.

Tudo é recalculado com os **filtros da página** (ano, empresa, gestor etc.). Serve para qualquer tipo de saída: desligamentos, cancelamentos de clientes, perda de contratos, evasão de alunos… Segue o padrão visual do repositório ([DESIGN.md](../../DESIGN.md)).

| Com Base: taxa contra a média | Sem Base: concentração | Outro uso: cancelamento de clientes |
|---|---|---|
| ![Taxa](docs/1-taxa.png) | ![Concentração](docs/2-concentracao.png) | ![Churn](docs/3-churn.png) |

## Como usar

1. Baixe [`dist/padroesSaidaA60F1C0244064A00B5604B4C1557A0AE.1.0.0.0.pbiviz`](dist/) e importe no Power BI (**Visualizações → `…` → Importar um visual de um arquivo**).
2. Arraste os campos:
   - **Atributos** (até 6): as características a investigar (ex.: *Senioridade*, *Liderança (Sim/Não)*, *Faixa de tempo de casa*, *Área*). Para números contínuos, como tempo de casa em meses, use uma coluna de **faixas**.
   - **Saídas**: medida com a **contagem** de saídas (ex.: `Desligados = COUNTROWS(Desligamentos)`).
   - **Base** (opcional, recomendado): medida com a população de comparação (ex.: headcount médio, clientes ativos). Também precisa ser uma **contagem**.

> As duas medidas são **somadas** entre as combinações de atributos, então precisam ser contagens (ou somas), não taxas nem médias já calculadas. A medida de Base deve dar valor também nas combinações sem saídas (ex.: headcount, e não "headcount de quem saiu").

## Como os padrões são encontrados

**Com Base (taxa comparada à média).** Para cada valor de atributo e cada combinação de até 3 atributos, o visual calcula a taxa de saída (*saídas ÷ base*) e compara com a taxa média de todo o filtro. Um perfil vira padrão quando:

- tem pelo menos **5 saídas** (configurável);
- a taxa é pelo menos **1,2× a média** (configurável);
- a diferença é **estatisticamente significativa** (teste z unilateral; 90% por padrão, ou 95%, 99% ou sem teste);
- no caso de combinações, a taxa precisa ser pelo menos 5% maior que a de cada parte isolada. Assim *Sênior + Até 1 ano* só aparece se juntar os dois atributos disser mais que cada um sozinho.

A lista é ordenada pelas **saídas acima do esperado** (quantas saídas a mais o perfil teve do que teria com a taxa média). Esse critério equilibra perfis grandes com taxa pouco acima da média e perfis pequenos com taxa muito alta. Também dá para ordenar por *quantas vezes a média* ou pelo *número de saídas*.

**Sem Base (concentração).** Sem a população, não dá para saber se um grupo sai *mais que o normal*, só que ele **concentra** as saídas. O visual mostra os perfis com pelo menos 20% das saídas e só combina atributos quando a maior parte das saídas do grupo (50%, configurável) também tem o novo atributo. Atenção: um grupo grande concentra muitas saídas mesmo saindo na média (ex.: *Liderança: Não* com 89% das saídas pode ser apenas porque 85% do quadro não tem liderança). Por isso a **Base é recomendada**.

**O destaque (a regra).** O perfil é montado atributo a atributo: começa pelo valor que mais explica as saídas (o maior excesso de saídas, ou a maior concentração sem Base) e, dentro dele, acrescenta o próximo atributo enquanto a regra continua relevante. O resultado é uma regra como *Sem liderança · Até 1 ano · Comercial*. Se preferir, o destaque pode mostrar só o padrão mais forte da lista.

## Recursos

- **Textos editáveis** (**Formatar visual → Textos**), com marcadores:
  - `{padrao}` (as condições), `{saidas}`, `{total}`, `{pct}` (% das saídas);
  - com Base: `{base}`, `{pctBase}` (% da base), `{taxa}`, `{media}`, `{lift}` (ex.: 2,4×) e `{excesso}` (saídas acima do esperado);
  - exemplo para clientes: `{taxa} cancelam contra {media} na média · {saidas} cancelamentos, {excesso} acima do esperado.`
  - **Termo para as saídas** (ex.: *cancelamentos*), usado no rodapé.
- **Rodapé** com a taxa média de referência e quantos padrões foram encontrados.
- **Filtro cruzado:** clique num padrão para filtrar os outros visuais exatamente por aquele perfil (ex.: Liderança = Não **e** Tempo de casa = Até 1 ano). Ctrl + clique seleciona vários. O que não está selecionado fica esmaecido. Menu do botão direito e Ctrl+C / Ctrl+V.
- **Dicas de ferramenta** com saídas, % do total, base, % da base, taxa, taxa média, quantas vezes a média e saídas acima do esperado.
- **Números** no formato das medidas e no idioma do relatório.

## Formatação

- **Geral:** fonte.
- **Cabeçalho:** título e subtítulo (texto, tamanho e cor).
- **Análise:** comparar por (automático, taxa ou concentração), máximo de atributos por padrão (1 a 4), mínimo de saídas, quanto acima da média, confiança estatística, % mínima das saídas e predominância (sem Base), ordenação e ignorar valores em branco.
- **Destaque:** mostrar, conteúdo (perfil ou padrão mais forte), rótulo, número em destaque, cores, tamanhos, arredondamento, espessura e cor da borda.
- **Padrões:** mostrar, quantidade, largura mínima do cartão (as colunas se ajustam à largura), cores, tamanhos, arredondamento, borda, barra (cor, trilho e marca da média) e opacidade do que não está selecionado.
- **Etiquetas dos atributos:** mostrar o nome do atributo, cores, tamanho, arredondamento e borda.
- **Textos:** frases com e sem Base, termo para as saídas e nota de rodapé.

## Observações

- Até 6 atributos e 30 mil combinações de valores. Se passar disso, o rodapé avisa. Prefira atributos com poucos valores (faixas em vez de valores contínuos).
- A taxa média é a do filtro atual: os padrões dizem quem sai mais **em relação ao restante do mesmo recorte**.
- Com taxas acima de 100% (ex.: saídas do ano ÷ headcount de um mês), o teste estatístico usa a aproximação de Poisson.
- Padrões estatísticos mostram associação, não causa. Use os perfis como ponto de partida para investigar.
