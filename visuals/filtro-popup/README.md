# Filtro em Pop-up — visual customizado do Power BI

Botão **"Abrir Filtros"** (verde-água, ícone de funil, divisória e seta) que abre um **pop-up no mesmo estilo** com os filtros/slicers dos campos que você adicionar ao visual. Os filtros funcionam como o **segmentação de dados (slicer) nativo**: filtram os outros visuais da página, ficam salvos no relatório e respeitam indicadores (bookmarks).

| Fechado | Aberto |
|---|---|
| ![Botão fechado](docs/1-fechado.png) | ![Pop-up aberto](docs/2-aberto.png) |

## Como usar no Power BI

1. Baixe o arquivo pronto: [`dist/filtroPopup7AA90184E2E143838BC5449850609E02.1.2.0.0.pbiviz`](dist/).
2. No Power BI Desktop: painel **Visualizações → `...` → Importar um visual de um arquivo** e selecione o `.pbiviz`.
3. Insira o visual na página e arraste as colunas para os espaços de dados:
   - **Filtro aninhado 1, 2, 3 e 4** — todas as colunas colocadas no mesmo espaço viram **um único filtro em árvore**, na ordem em que foram adicionadas (a primeira é o nível de cima). Ex.: *Ano* e *Mês* no "Filtro aninhado 1" e *Área* e *Curso* no "Filtro aninhado 2". Até 6 colunas por espaço.
   - **Filtros sem aninhamento** — cada coluna vira um filtro separado (até 20).
4. Clique no botão para abrir o pop-up.

### O que tem no pop-up

- Um bloco por campo, com **pesquisa**, **"Selecionar tudo"** e lista com caixas de seleção (ou botão de opção, se "Seleção única" estiver ligado).
- Resumo do que está selecionado no cabeçalho de cada bloco e botão de borracha para **limpar só aquele filtro**. Os blocos podem ser recolhidos.
- **Filtros aninhados:** cada espaço "Filtro aninhado N" vira uma árvore, com setas para expandir/recolher, marcação parcial no nível de cima e contador de itens.
- Opcional: modo **intervalo (De/Até)** para campos numéricos e de data.
- **Limpar todos os filtros** e **Fechar** no rodapé; também fecha com `Esc`, no `X` ou clicando fora do pop-up.
- O botão mostra um contador com quantos campos estão filtrados.

### Formatação (painel "Formatar visual")

- **Botão:** texto, cor de fundo, cor do texto/ícones, fonte, tamanho da fonte do texto, arredondamento, altura, ícone e contador.
- **Pop-up:** título, tamanho da fonte do título, tamanho da fonte do título dos filtros, tamanho da fonte dos valores, cor de fundo, cor dos painéis, cor do texto, abrir abaixo do botão ou por cima dele.
- **Botões do pop-up** ("Limpar todos os filtros" e "Fechar"): posição (esquerda, centro ou direita), tamanho da fonte, fonte, largura (0 = automática), cor de fundo e cor do texto de cada um. Os dois botões têm sempre a mesma largura e altura.
- **Filtros:** seleção única, caixa de pesquisa, intervalo para números e datas.

## Como funciona o aninhamento

![Filtro aninhado](docs/3-aninhado.png)

- A ordem das colunas dentro do espaço define os níveis: a primeira adicionada é o nível de cima. Para mudar, arraste para reordenar dentro do espaço.
- Marcar um item de cima marca tudo o que está abaixo dele; marcar só alguns filhos deixa o pai com marcação parcial.
- Funciona com qualquer combinação de colunas, inclusive quando o mesmo valor se repete em vários pais (ex.: *Mar* em 2024 e em 2025 são itens diferentes).
- O filtro enviado ao Power BI:
  - se só itens inteiros do primeiro nível estão marcados → filtro simples nessa coluna;
  - caso contrário → filtro de várias colunas (*tuple filter* da API de visuais), com o caminho completo de cada item marcado. Por isso ele é exato: marcar *2025 › Mar* filtra só março de 2025.
- As colunas de uma mesma árvore devem ser da mesma tabela (ou de tabelas relacionadas) para o filtro de várias colunas funcionar.
- A ordem dos itens segue a ordem do Power BI, incluindo "Classificar por coluna" (ex.: meses em ordem de calendário).

## Importante: tamanho do visual

Visuais customizados rodam dentro de uma área isolada (iframe) e **não conseguem desenhar fora da própria caixa**. Por isso o pop-up abre **dentro da área do visual**:

- Redimensione o visual para o tamanho que o pop-up deve ter. O botão fica no topo (altura configurável) e o pop-up ocupa o espaço abaixo.
- Com o pop-up fechado essa área fica transparente, mas **continua sendo do visual** (cliques ali não chegam aos visuais que estiverem embaixo). Posicione-o sobre um espaço livre ou deixe-o por cima e aceite que o pop-up cubra os visuais ao abrir.
- Se preferir um botão pequeno, ligue **Pop-up → Abrir por cima do botão**: o pop-up ocupa a área inteira do visual.

Outras observações:

- Use a **coluna de data** diretamente (não a hierarquia automática Ano/Trimestre/Mês) para os filtros de data funcionarem melhor.
- Os valores listados vêm de até 30.000 combinações de todas as colunas do visual; com volumes maiores o visual busca o restante automaticamente. Muitas colunas com muitos valores aumentam o número de combinações.

## Desenvolvimento

Requisitos: Node.js 18+.

```bash
cd visuals/filtro-popup
npm install
npm run lint          # ESLint
npx tsc --noEmit -p . # checagem de tipos
npm run package       # gera dist/*.pbiviz
npm start             # servidor de desenvolvimento (visual "Developer Visual" no Power BI Service)
```

Estrutura:

- `capabilities.json` — espaços de dados ("Filtro aninhado 1–4" e "Filtros sem aninhamento"), propriedades do painel de formatação e a propriedade `general.filter` usada para aplicar os filtros.
- `src/visual.ts` — interface (botão, pop-up, listas) e integração com o host (`applyJsonFilter`).
- `src/hierarchy.ts` — monta a árvore dos espaços aninhados e o filtro de várias colunas (tuple) dela.
- `src/filters.ts` — monta os filtros JSON (`BasicFilter` "In" e `AdvancedFilter` de intervalo) e reconstrói o estado a partir dos filtros salvos.
- `src/settings.ts` — cartões do painel de formatação.
- `style/visual.less` — estilos.
