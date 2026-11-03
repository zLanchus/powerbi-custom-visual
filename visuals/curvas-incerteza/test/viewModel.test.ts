import { CurvesDeps, CurvesSettings, MAX_SERIES, Point, buildCurvesModel, splitSegments, valueAt } from "../src/viewModel";
import { FakeData, fakeCategorical, fakeFormat, fakeId, fakeLabel } from "./helpers";

const deps: CurvesDeps = {
    format: fakeFormat,
    label: fakeLabel,
    pointId: (i, group) => fakeId(`p${i}:${group ? String(group.name) : ""}`),
    seriesId: group => fakeId(`s:${String(group.name)}`),
    seriesColor: (_group, k) => `#00000${k % 10}`,
    seriesStyle: () => "solid"
};

function settings(over: Partial<CurvesSettings> = {}): CurvesSettings {
    return {
        interpolation: "auto",
        threshold: 1,
        referenceConstant: null,
        maxSeries: 5,
        windows: { source: "field", start: null, end: null },
        milestones: [],
        y: { startAtZero: true, min: null, max: null },
        x: { min: null, max: null },
        ...over
    };
}

const numeric = { numeric: true, integer: true };

function build(data: FakeData, over: Partial<CurvesSettings> = {}) {
    const result = buildCurvesModel(fakeCategorical({ categoryRole: "x", ...data }), settings(over), deps);
    if (!result.model) {
        throw new Error("modelo vazio: " + result.missing.join(","));
    }
    return result.model;
}

const pt = (i: number, value: number | null, low = false): Point => ({
    i, x: i, value, lower: null, upper: null, confidence: null, threshold: null, low, mark: false, highlighted: false, id: fakeId(String(i)), tooltips: []
});

describe("campos obrigatórios", () => {
    it("sem dados pede Eixo X e Valor", () => {
        expect(buildCurvesModel(undefined, settings(), deps)).toEqual({ missing: ["x", "value"] });
    });

    it("só Eixo X e Valor preenchidos", () => {
        const model = build({ categories: [0, 1, 2], categoryType: numeric, measures: { value: [1, 0.9, 0.8] } });
        expect(model.curves).toHaveLength(1);
        expect(model.hasBand).toBe(false);
        expect(model.hasLow).toBe(false);
        expect(model.windows).toEqual([]);
        expect(model.reference.present).toBe(false);
        expect(model.interpolation).toBe("stepAfter");
    });
});

describe("eixo X", () => {
    it("numérico em ordem crescente, mesmo fora de ordem no modelo", () => {
        const model = build({ categories: [3, 1, 2], categoryType: numeric, measures: { value: [30, 10, 20] } });
        expect(model.axis.xs).toEqual([1, 2, 3]);
        expect(model.curves[0].points.map(p => p.value)).toEqual([10, 20, 30]);
    });

    it("texto respeita a ordem do modelo (Classificar por coluna)", () => {
        const model = build({ categories: ["Jan", "Fev", "Mar"], measures: { value: [1, 2, 3] } });
        expect(model.axis.kind).toBe("text");
        expect(model.axis.labels).toEqual(["Jan", "Fev", "Mar"]);
        expect(model.axis.xs).toEqual([0, 1, 2]);
        expect(model.interpolation).toBe("linear");
    });

    it("datas com meses faltando ficam no eixo contínuo", () => {
        const dates = [new Date(2025, 0, 1), new Date(2025, 1, 1), new Date(2025, 4, 1)];
        const model = build({ categories: dates, categoryType: { dateTime: true }, measures: { value: [1, 2, 3] } });
        expect(model.axis.kind).toBe("date");
        expect(model.axis.xs).toEqual(dates.map(d => d.getTime()));
        expect(model.interpolation).toBe("linear");
    });

    it("X repetido: não soma, usa o primeiro e avisa", () => {
        const model = build({ categories: [1, 2, 2, 3], categoryType: numeric, measures: { value: [10, 20, 99, 30] } });
        expect(model.duplicates).toBe(true);
        expect(model.axis.xs).toEqual([1, 2, 3]);
        expect(model.curves[0].points.map(p => p.value)).toEqual([10, 20, 30]);
    });

    it("um único ponto", () => {
        const model = build({ categories: [5], categoryType: numeric, measures: { value: [0.7] } });
        expect(model.axis.domain[1]).toBeGreaterThan(model.axis.domain[0]);
        expect(model.curves[0].segments).toHaveLength(1);
        expect(model.curves[0].segments[0].points).toHaveLength(1);
    });
});

describe("valores", () => {
    it("todas as medidas vazias: sem trechos, eixo não degenera", () => {
        const model = build({ categories: [0, 1], categoryType: numeric, measures: { value: [null, null], lower: [null, null], upper: [null, null] } });
        expect(model.curves[0].segments).toEqual([]);
        expect(model.curves[0].last).toBeUndefined();
        expect(model.yDomain[1]).toBeGreaterThan(model.yDomain[0]);
    });

    it("valor vazio interrompe a curva (nunca vira zero)", () => {
        const model = build({ categories: [0, 1, 2, 3], categoryType: numeric, measures: { value: [1, 0.9, null, 0.7] } });
        const segs = model.curves[0].segments;
        expect(segs.map(s => s.points.map(p => p.value))).toEqual([[1, 0.9], [0.7]]);
    });

    it("coorte recente termina onde os dados acabam", () => {
        const model = build({ categories: [0, 1, 2, 3], categoryType: numeric, measures: { value: [1, 0.95, null, null] } });
        expect(model.curves[0].last?.x).toBe(1);
    });

    it("valores negativos entram no eixo Y", () => {
        const model = build({ categories: [0, 1], categoryType: numeric, measures: { value: [-3, 2] } });
        expect(model.yDomain).toEqual([-3, 2]);
    });

    it("mínimo e máximo fixos do eixo Y", () => {
        const model = build({ categories: [0, 1], categoryType: numeric, measures: { value: [0.5, 0.6] } }, { y: { startAtZero: false, min: 0.4, max: 1 } });
        expect(model.yDomain).toEqual([0.4, 1]);
    });
});

describe("baixa confiança", () => {
    it("o trecho entre i e i+1 herda o estado de i+1, sem lacuna", () => {
        const segs = splitSegments([pt(0, 1), pt(1, 0.9), pt(2, 0.8, true), pt(3, 0.7, true), pt(4, 0.6)]);
        expect(segs.map(s => ({ low: s.low, xs: s.points.map(p => p.x) }))).toEqual([
            { low: false, xs: [0, 1] },
            { low: true, xs: [1, 2, 3] },
            { low: false, xs: [3, 4] }
        ]);
    });

    it("Confiança < Limiar; campo de limiar tem prioridade; confiança vazia = normal", () => {
        const model = build({
            categories: [0, 1, 2, 3],
            categoryType: numeric,
            measures: { value: [1, 0.9, 0.8, 0.7], confidence: [null, 50, 20, 5], threshold: [30, 30, 30, null] }
        }, { threshold: 10 });
        expect(model.curves[0].points.map(p => p.low)).toEqual([false, false, true, true]);
        expect(model.hasLow).toBe(true);
    });
});

describe("faixa", () => {
    it("só aparece com os dois limites; limite vazio interrompe a faixa", () => {
        const model = build({
            categories: [0, 1, 2, 3],
            categoryType: numeric,
            measures: { value: [1, 0.9, 0.8, 0.7], lower: [0.9, 0.8, null, 0.6], upper: [1, 0.95, 0.9, 0.8] }
        });
        expect(model.curves[0].bands.map(b => b.map(p => p.x))).toEqual([[0, 1], [3]]);
        expect(model.curves[0].points[2].upper).toBeNull();
        expect(model.yDomain[1]).toBe(1);
    });
});

describe("janelas, marcas, referência e marcos", () => {
    it("janelas: sequências com Destaque ≠ 0, união entre séries", () => {
        const model = build({
            categories: [0, 1, 2, 3, 4, 5],
            categoryType: numeric,
            series: [
                { name: "A", measures: { value: [1, 1, 1, 1, 1, 1], highlight: [0, 1, 1, 0, 0, 0] } },
                { name: "B", measures: { value: [1, 1, 1, 1, 1, 1], highlight: [0, 0, 1, 1, 0, 1] } }
            ]
        });
        expect(model.windows).toEqual([{ start: 1, end: 3 }, { start: 5, end: 5 }]);
    });

    it("janela de intervalo fixo", () => {
        const model = build({ categories: [0, 1, 2], categoryType: numeric, measures: { value: [1, 1, 1] } },
            { windows: { source: "fixed", start: 2, end: 1 } });
        expect(model.windows).toEqual([{ start: 1, end: 2 }]);
    });

    it("marcas com valor > 0", () => {
        const model = build({ categories: [0, 1, 2], categoryType: numeric, measures: { value: [1, 1, 1], marks: [0, 2, null] } });
        expect(model.curves[0].points.map(p => p.mark)).toEqual([false, true, false]);
        expect(model.hasMarks).toBe(true);
    });

    it("referência: campo igual em tudo vira linha única; constante quando não há campo", () => {
        const field = build({ categories: [0, 1], categoryType: numeric, measures: { value: [1, 2], reference: [1.5, 1.5] } }, { referenceConstant: 9 });
        expect(field.reference).toMatchObject({ present: true, uniform: true, value: 1.5 });
        const constant = build({ categories: [0, 1], categoryType: numeric, measures: { value: [1, 2] } }, { referenceConstant: 9 });
        expect(constant.reference).toMatchObject({ present: true, uniform: true, value: 9 });
        expect(constant.yDomain[1]).toBe(9);
    });

    it("marcos no degrau usam o último valor até o X; fora do eixo são ignorados", () => {
        const model = build({
            categories: [0, 2, 4, 6],
            categoryType: numeric,
            series: [
                { name: "2024", measures: { value: [1, 0.9, 0.8, 0.7] } },
                { name: "2025", measures: { value: [1, 0.85, null, null] } }
            ]
        }, { milestones: ["3", "6", "40"] });
        expect(model.milestones.map(m => m.x)).toEqual([3, 6]);
        expect(model.milestones[0].values).toEqual([0.9, null]);
        expect(model.milestones[1].values).toEqual([0.7, null]);
    });

    it("valor no marco com interpolação reta", () => {
        expect(valueAt([pt(0, 0), pt(2, 10)], 1, "linear")).toBe(5);
        expect(valueAt([pt(0, 0), pt(2, 10)], 1, "stepAfter")).toBe(0);
    });
});

describe("séries", () => {
    it("acima do máximo visível: excedentes ocultas e contadas", () => {
        const series = Array.from({ length: 8 }, (_, k) => ({ name: `C${k}`, measures: { value: [1, 0.9] } }));
        const model = build({ categories: [0, 1], categoryType: numeric, series }, { maxSeries: 3 });
        expect(model.curves.map(c => c.name)).toEqual(["C0", "C1", "C2"]);
        expect(model.hiddenCount).toBe(5);
    });

    it("30 séries", () => {
        const series = Array.from({ length: MAX_SERIES }, (_, k) => ({ name: `C${k}`, measures: { value: Array.from({ length: 60 }, (_, i) => 1 - i * 0.01 * (k + 1) / 30) } }));
        const model = build({ categories: Array.from({ length: 60 }, (_, i) => i), categoryType: numeric, series }, { maxSeries: 30 });
        expect(model.curves).toHaveLength(30);
        expect(model.hiddenCount).toBe(0);
        expect(model.truncated.series).toBe(false);
    });

    it("mais de 30 séries: avisa", () => {
        const series = Array.from({ length: MAX_SERIES + 1 }, (_, k) => ({ name: `C${k}`, measures: { value: [1] } }));
        const model = build({ categories: [0], categoryType: numeric, series }, { maxSeries: 30 });
        expect(model.truncated.series).toBe(true);
        expect(model.hiddenCount).toBe(1);
    });
});
