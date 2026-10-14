// Gera o site do GitHub Pages em _site/: página de download + arquivos .pbiviz.
//
// Uso: node site/build.mjs [pasta-com-os-pbiviz]
// Sem argumento, usa o .pbiviz que está em visuals/<id>/dist/.
// No GitHub Actions, recebe a pasta com os .pbiviz recém-gerados pelo build.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "_site");
const artifacts = process.argv[2] ? resolve(process.argv[2]) : null;
const repoUrl = "https://github.com/zLanchus/powerbi-custom-visual";

const visuals = JSON.parse(readFileSync(join(root, "site", "visuals.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "downloads"), { recursive: true });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

/** Procura o .pbiviz do visual (nos artefatos do build ou em dist/). */
function findPbiviz(id, guid) {
    const dirs = [];
    if (artifacts) {
        dirs.push(join(artifacts, `${id}-pbiviz`), artifacts);
    }
    dirs.push(join(root, "visuals", id, "dist"));
    for (const dir of dirs) {
        if (!existsSync(dir)) {
            continue;
        }
        const file = readdirSync(dir).find((f) => f.startsWith(guid) && f.endsWith(".pbiviz"));
        if (file) {
            return join(dir, file);
        }
    }
    throw new Error(`Arquivo .pbiviz de "${id}" não encontrado.`);
}

const cards = visuals.map((v) => {
    const pbiviz = JSON.parse(readFileSync(join(root, "visuals", v.id, "pbiviz.json"), "utf8"));
    const version = pbiviz.visual.version;
    const source = findPbiviz(v.id, pbiviz.visual.guid);

    // Nome fixo (link permanente para a última versão) e nome com a versão.
    copyFileSync(source, join(out, "downloads", `${v.id}.pbiviz`));
    copyFileSync(source, join(out, "downloads", `${v.id}-${version}.pbiviz`));

    const imgDir = join(out, "img", v.id);
    mkdirSync(imgDir, { recursive: true });
    for (const img of [v.cover, ...v.images]) {
        copyFileSync(join(root, "visuals", v.id, "docs", img), join(imgDir, img));
    }

    const features = v.features.map((f) => `<li>${esc(f)}</li>`).join("");
    const gallery = v.images.map((img) =>
        `<img src="img/${v.id}/${img}" alt="${esc(v.name)}">`).join("");

    return `
      <article class="card" id="${v.id}">
        <div class="cover"><img src="img/${v.id}/${v.cover}" alt="${esc(v.name)}"></div>
        <div class="info">
          <h2>${esc(v.name)} <span class="version">v${esc(version)}</span></h2>
          <p>${esc(v.summary)}</p>
          <ul>${features}</ul>
          <div class="actions">
            <a class="download" href="downloads/${v.id}.pbiviz" download="${v.id}-${esc(version)}.pbiviz">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>
              <span>Baixar .pbiviz</span>
              <i></i>
              <small>${esc(version)}</small>
            </a>
            <a class="docs" href="${repoUrl}/tree/main/visuals/${v.id}#readme">Documentação</a>
          </div>
          <div class="gallery">${gallery}</div>
        </div>
      </article>`;
}).join("");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Power BI Custom Visuals</title>
  <meta name="description" content="Visuais personalizados para Power BI prontos para baixar e importar.">
  <style>
    :root {
      --teal: #3BB39A; --dark: #1F2B2A; --panel: #F4FBF9; --bg: #EEF3F2; --muted: #51605E; --card: #FFFFFF;
      --line: rgba(31, 43, 42, .1);
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #111817; --card: #1A2322; --panel: #22302E; --dark: #E8F2EF; --muted: #A7B6B3; --line: rgba(255,255,255,.08); }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--dark); font: 16px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif; }
    a { color: inherit; }
    header { background: var(--teal); color: #1F2B2A; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
    header .wrap { padding-top: 48px; padding-bottom: 40px; }
    header h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 40px); line-height: 1.15; }
    header p { margin: 0; max-width: 640px; font-size: 18px; }
    main .wrap { padding-top: 32px; padding-bottom: 48px; display: grid; gap: 24px; }
    .card { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 24px; padding: 24px;
            background: var(--card); border: 1px solid var(--line); border-radius: 18px; }
    .cover { background: var(--panel); border-radius: 14px; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .cover img { max-width: 100%; height: auto; border-radius: 10px; }
    h2 { margin: 0 0 6px; font-size: 24px; }
    .version { font-size: 13px; font-weight: 600; color: var(--muted); vertical-align: middle; }
    .info p { margin: 0 0 10px; color: var(--muted); }
    ul { margin: 0 0 18px; padding-left: 20px; }
    li { margin: 2px 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 18px; }
    .download { display: inline-flex; align-items: center; gap: 12px; height: 52px; padding: 0 18px; border-radius: 14px;
                background: var(--teal); color: #1F2B2A; font-weight: 700; text-decoration: none;
                box-shadow: 0 1px 2px rgba(0,0,0,.12); transition: filter .15s, box-shadow .15s; }
    .download:hover { filter: brightness(1.05); box-shadow: 0 3px 10px rgba(0,0,0,.16); }
    .download svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .download i { width: 2px; align-self: stretch; margin: 10px 0; background: currentColor; opacity: .55; border-radius: 2px; }
    .download small { font-size: 13px; font-weight: 600; }
    .docs { font-weight: 600; text-underline-offset: 3px; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .gallery img { width: 100%; height: 150px; object-fit: cover; object-position: top; border-radius: 10px;
                   background: var(--panel); border: 1px solid var(--line); }
    .howto { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 24px; }
    .howto h2 { font-size: 20px; }
    .howto ol { margin: 0; padding-left: 20px; }
    footer { color: var(--muted); font-size: 14px; }
    footer .wrap { padding-bottom: 32px; }
    @media (max-width: 760px) { .card { grid-template-columns: 1fr; padding: 16px; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>Power BI Custom Visuals</h1>
      <p>Visuais personalizados para Power BI, prontos para baixar e importar no seu relatório.</p>
    </div>
  </header>
  <main>
    <div class="wrap">
      ${cards}
      <section class="howto">
        <h2>Como importar no Power BI</h2>
        <ol>
          <li>Baixe o arquivo <strong>.pbiviz</strong> do visual.</li>
          <li>No Power BI Desktop, no painel <strong>Visualizações</strong>, clique em <strong>…</strong> → <strong>Importar um visual de um arquivo</strong>.</li>
          <li>Selecione o arquivo baixado. O visual aparece no painel de visualizações do relatório.</li>
        </ol>
      </section>
    </div>
  </main>
  <footer>
    <div class="wrap">Código-fonte e documentação no <a href="${repoUrl}">GitHub</a> · Licença MIT</div>
  </footer>
</body>
</html>
`;

writeFileSync(join(out, "index.html"), html);
writeFileSync(join(out, ".nojekyll"), "");
console.log(`Site gerado em ${out}`);
