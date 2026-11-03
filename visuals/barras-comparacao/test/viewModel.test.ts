import { BarsDeps, BarsSettings, MAX_CATEGORIES, buildBarsModel } from "../src/viewModel";
import { FakeData, fakeCategorical, fakeFormat, fakeId, fakeLabel } from "./helpers";

const SERIES_COLORS = ["#111111", "#222222", "#333333"];

const deps: BarsDeps = {
    format: fakeFormat,
    label: fakeLabel,
    pointId: (i, group) => fakeId(`p${i}:${group ? String(group.name) : ""}`),
    seriesId: group => fakeId(`s:${String(group.name)}`),
    seriesColor: (_group, k) => SERIES_COLORS[k % SERIES_COLORS.length],
    compare: (a, b) => a.localeCompare(b)
};

function settings(over: Partial<BarsSettings> = {}): BarsSettings {
    return {
        rule: "none",
        colors: {
            normal: "#3E9BD1",
            above: "#B5520F",
            below: "#3E9BD1",
            flag: "#0F2B45",
            low: "#4E6175",
            gradientMin: "#FFFFFF",
            gradientMax: "#000000"
        },
        lowStyle: "hatched",
        threshold: 1,
        referenceConstant: null,
        sort: "model",
        lowLast: false,
        topN: null,
        ...over
    };
}

function build(data: FakeData, over: Partial<BarsSettings> = {}) {
    const result = buildBarsModel(fakeCategorical(data), settings(over), deps);
    if (!result.model) {
        throw new Error("modelo vazio: " + result.missing.join(","));
    }
    return result.model;
}

const values = (model: ReturnType<typeof build>) => model.categories.map(c => c.bars[0].value);

describe("campos obrigatórios", () => {
    it("sem dataView pede Categoria e Valor", () => {
        expect(buildBarsModel(undefined, settings(), deps)).toEqual({ missing: ["category", "value"] });
    });

    it("só Categoria pede Valor", () => {
        const result = buildBarsModel(fakeCategorical({ categories: ["a"], measures: { tooltips: [1] } }), settings(), deps);
        expect(result.missing).toEqual(["value"]);
        expect(result.model).toBeUndefined();
    });
});

describe("casos-limite", () => {
    it("uma categoria", () => {
        const model = build({ categories: ["Jan"], measures: { value: [5] } });
        expect(model.categories).toHaveLength(1);
        expect(model.domain[0]).toBe(0);
        expect(model.domain[1]).toBe(5);
    });

    it("200 categorias: todas ficam (a rolagem é do layout)", () => {
        const cats = Array.from({ length: 200 }, (_, i) => `c${i}`);
        const model = build({ categories: cats, measures: { value: cats.map((_, i) => i) } });
        expect(model.categories).toHaveLength(200);
        expect(model.truncated.categories).toBe(false);
    });

    it("acima de 1.000 categorias: avisa em vez de truncar em silêncio", () => {
        const cats = Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => i);
        const model = build({ categories: cats, measures: { value: cats } });
        expect(model.categories).toHaveLength(MAX_CATEGORIES);
        expect(model.truncated.categories).toBe(true);
    });

    it("todas as barras abaixo da referência", () => {
        const model = build({ categories: ["a", "b", "c"], measures: { value: [1, 2, 3], reference: [10, 10, 10] } }, { rule: "aboveBelow" });
        expect(model.categories.every(c => c.bars[0].state === "below")).toBe(true);
        expect(model.categories.every(c => c.bars[0].fill === "#3E9BD1")).toBe(true);
        expect(model.reference).toMatchObject({ present: true, uniform: true, value: 10 });
        expect(model.domain[1]).toBe(10);
    });

    it("referência vazia com regra acima/abaixo: cor padrão e aviso", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [1, 2] } }, { rule: "aboveBelow" });
        expect(model.referenceMissing).toBe(true);
        expect(model.categories.map(c => c.bars[0].state)).toEqual(["normal", "normal"]);
        expect(model.categories.map(c => c.bars[0].fill)).toEqual(["#3E9BD1", "#3E9BD1"]);
    });

    it("campo Referência com valores vazios também avisa", () => {
        const model = build({ categories: ["a"], measures: { value: [1], reference: [null] } }, { rule: "aboveBelow" });
        expect(model.referenceMissing).toBe(true);
        expect(model.reference.present).toBe(false);
    });

    it("comparação maior que todas as barras entra no eixo", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [1, 2], comparison1: [3, 9] } });
        expect(model.domain[1]).toBe(9);
        expect(model.categories[1].bars[0].comparisons).toEqual([9, null]);
    });

    it("valores todos zero: eixo não degenera", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [0, 0] } });
        expect(model.domain[0]).toBe(0);
        expect(model.domain[1]).toBeGreaterThan(0);
    });

    it("valores negativos crescem para o outro lado do zero", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [-4, 2] } });
        expect(model.domain).toEqual([-4, 2]);
    });

    it("valor vazio não vira zero", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [null, 2] } });
        expect(values(model)).toEqual([null, 2]);
        expect(model.categories[0].total).toBe(0);
    });
});

describe("referência", () => {
    it("diferente por categoria: um traço por barra", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [1, 2], reference: [1.5, 1.8] } });
        expect(model.reference.uniform).toBe(false);
        expect(model.reference.value).toBeNull();
        expect(model.categories.map(c => c.bars[0].reference)).toEqual([1.5, 1.8]);
    });

    it("campo tem prioridade sobre a constante", () => {
        const model = build({ categories: ["a"], measures: { value: [1], reference: [4] } }, { referenceConstant: 99 });
        expect(model.categories[0].bars[0].reference).toBe(4);
    });

    it("constante do painel sem o campo", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [1, 3] } }, { referenceConstant: 2, rule: "aboveBelow" });
        expect(model.reference).toMatchObject({ present: true, fromField: false, uniform: true, value: 2 });
        expect(model.categories.map(c => c.bars[0].state)).toEqual(["below", "above"]);
        expect(model.categories[1].bars[0].fill).toBe("#B5520F");
    });
});

describe("regras de cor", () => {
    it("o Sinalizador tem prioridade sobre acima/abaixo", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [5, 5], reference: [1, 1], flag: [1, 0] } }, { rule: "aboveBelow" });
        expect(model.categories.map(c => c.bars[0].state)).toEqual(["flag", "above"]);
        expect(model.categories[0].bars[0].fill).toBe("#0F2B45");
        expect(model.hasFlag).toBe(true);
    });

    it("gradiente pelo valor vai da cor do menor à do maior", () => {
        const model = build({ categories: ["a", "b", "c"], measures: { value: [0, 5, 10] } }, { rule: "gradient" });
        expect(model.categories.map(c => c.bars[0].fill)).toEqual(["#FFFFFF", "#808080", "#000000"]);
    });

    it("com Série, acima/abaixo muda a saturação da cor da série", () => {
        const model = build({
            categories: ["a"],
            series: [
                { name: "2024", measures: { value: [5], reference: [3] } },
                { name: "2025", measures: { value: [1], reference: [3] } }
            ]
        }, { rule: "aboveBelow" });
        const [above, below] = model.categories[0].bars;
        expect(above.fill).toBe(SERIES_COLORS[0]);
        expect(below.state).toBe("below");
        expect(below.fill).not.toBe(SERIES_COLORS[1]);
        expect(below.fill).not.toBe("#3E9BD1");
    });
});

describe("baixa confiança", () => {
    it("Confiança < Limiar (campo tem prioridade sobre a constante)", () => {
        const model = build({
            categories: ["a", "b", "c"],
            measures: { value: [1, 2, 3], confidence: [5, 50, 5], threshold: [30, 30, null] }
        }, { threshold: 1 });
        expect(model.categories.map(c => c.bars[0].low)).toEqual([true, false, false]);
        expect(model.categories[0].bars[0].hatch).toBe(true);
        expect(model.categories[0].bars[0].fill).toBe("#4E6175");
    });

    it("confiança vazia = barra normal (ex.: mês 0)", () => {
        const model = build({ categories: ["0", "1"], measures: { value: [1, 1], confidence: [null, 0] } }, { threshold: 1 });
        expect(model.categories.map(c => c.bars[0].low)).toEqual([false, true]);
    });

    it("estilo esmaecido mantém a cor da regra", () => {
        const model = build({ categories: ["a"], measures: { value: [1], confidence: [0] } }, { lowStyle: "faded" });
        expect(model.categories[0].bars[0]).toMatchObject({ faded: true, hatch: false, fill: "#3E9BD1" });
    });
});

describe("ordenação e Top N", () => {
    const data: FakeData = { categories: ["b", "a", "c", "d"], measures: { value: [2, 5, 1, 4], confidence: [10, 0, 10, 10] } };

    it("valor decrescente e crescente", () => {
        expect(values(build(data, { sort: "desc" }))).toEqual([5, 4, 2, 1]);
        expect(values(build(data, { sort: "asc" }))).toEqual([1, 2, 4, 5]);
    });

    it("alfabética", () => {
        expect(build(data, { sort: "alpha" }).categories.map(c => c.label)).toEqual(["a", "b", "c", "d"]);
    });

    it("ordem do modelo", () => {
        expect(build(data).categories.map(c => c.label)).toEqual(["b", "a", "c", "d"]);
    });

    it("baixa confiança sempre no fim", () => {
        expect(build(data, { sort: "desc", lowLast: true }).categories.map(c => c.label)).toEqual(["d", "b", "c", "a"]);
    });

    it("Top N mostra as N primeiras e conta as escondidas", () => {
        const model = build(data, { sort: "desc", topN: 2 });
        expect(model.categories.map(c => c.label)).toEqual(["a", "d"]);
        expect(model.hiddenCount).toBe(2);
        expect(model.domain[1]).toBe(5);
    });
});

describe("séries, destaque e rótulos", () => {
    it("barras agrupadas por série", () => {
        const model = build({
            categories: ["a", "b"],
            series: [
                { name: "X", measures: { value: [1, 2] } },
                { name: "Y", measures: { value: [3, null] } }
            ]
        });
        expect(model.hasSeries).toBe(true);
        expect(model.series.map(s => s.name)).toEqual(["X", "Y"]);
        expect(model.categories[1].bars.map(b => b.value)).toEqual([2, null]);
        expect(model.categories[0].total).toBe(4);
    });

    it("destaque de filtro cruzado (supportsHighlight)", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [4, 6] }, highlights: [2, null] });
        expect(model.hasHighlights).toBe(true);
        expect(model.categories.map(c => c.bars[0].highlight)).toEqual([2, null]);
    });

    it("rótulo extra de texto ou número", () => {
        const model = build({ categories: ["a", "b"], measures: { value: [1, 2], extraLabel: ["56 saídas", 7] } });
        expect(model.categories.map(c => c.extra)).toEqual(["56 saídas", "7"]);
    });

    it("dicas de ferramenta extras", () => {
        const model = build({ categories: ["a"], measures: { value: [1], tooltips: [42] } });
        expect(model.categories[0].bars[0].tooltips).toEqual([{ name: "tooltips", value: "42" }]);
    });
});
