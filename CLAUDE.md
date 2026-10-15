# Instruções para este repositório

- Antes de criar ou alterar um visual, leia e siga o **[DESIGN.md](DESIGN.md)**: cores padrão (primária azul-claro `#6CBEEB`, texto `#0F2B45`, painel `#F1F8FD`), formas, opções de formatação e comportamento esperados.
- Cada visual fica em `visuals/<nome>/` com `README.md`, `docs/` (imagens) e `dist/` (`.pbiviz` gerado por `npx pbiviz package`).
- Ao mudar um visual: aumente a versão em `pbiviz.json` e `package.json`, rode `npm run lint`, `npx tsc --noEmit -p .` e `npx pbiviz package`, e faça commit do novo `dist/*.pbiviz` (removendo o antigo).
- Visual novo: siga o checklist no fim do `DESIGN.md`.
