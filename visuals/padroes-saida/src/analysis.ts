"use strict";

// Busca de padrões de saída (sem dependência do Power BI, para poder ser testada à parte).
//
// Cada linha é uma combinação dos atributos (ex.: Sênior × Sem liderança × Até 1 ano) com o
// número de saídas e, opcionalmente, a base (headcount, clientes ativos…). As medidas precisam
// ser somáveis: os grupos são montados somando as linhas.
//
// - Modo "rate" (com Base): taxa do grupo = saídas / base; compara com a taxa média.
//   Um padrão precisa ter taxa acima da média (lift), saídas suficientes e, se pedido,
//   significância estatística (teste z de uma proporção, unilateral).
// - Modo "share" (sem Base): fatia das saídas que o grupo concentra.
//
// Combinações de 2+ atributos só entram se acrescentam algo aos grupos "pais" (sem um dos
// atributos): no modo taxa, o lift precisa subir pelo menos 5%; no modo concentração, a maior
// parte das saídas do pai (predominância) precisa ter também o novo atributo.

export type Mode = "rate" | "share";
export type RankBy = "excess" | "lift" | "exits";

export interface Row {
    /** Rótulo de cada atributo nesta linha. */
    values: string[];
    /** Se o valor de cada atributo está em branco. */
    blank: boolean[];
    exits: number;
    base: number;
    /** Índice da linha no dataView (para montar a seleção). */
    index: number;
}

export interface Condition {
    attr: number;
    value: string;
}

export interface Pattern {
    key: string;
    /** Condições na ordem dos atributos. */
    conditions: Condition[];
    /** Uma linha que satisfaz todas as condições. */
    row: number;
    exits: number;
    base: number;
    /** Fatia das saídas totais. */
    share: number;
    /** Fatia da base total. */
    baseShare: number;
    rate: number;
    /** Taxa do grupo ÷ taxa média. */
    lift: number;
    /** Saídas esperadas se o grupo tivesse a taxa média. */
    expected: number;
    /** Saídas acima do esperado. */
    excess: number;
    /** Estatística z da taxa do grupo contra a média. */
    z: number;
}

export interface Options {
    mode: Mode;
    attrCount: number;
    maxDepth: number;
    minExits: number;
    minLift: number;
    /** Valor crítico de z (-Infinity = sem teste). */
    zCrit: number;
    /** Fração mínima das saídas (modo concentração). */
    minShare: number;
    /** Fração mínima das saídas do grupo pai que precisa ter o novo atributo. */
    dominance: number;
    rankBy: RankBy;
    hideBlanks: boolean;
}

export interface Totals {
    exits: number;
    base: number;
    rate: number;
}

export interface Result {
    totals: Totals;
    /** Padrões relevantes, do mais forte para o mais fraco. */
    patterns: Pattern[];
    /** Perfil montado atributo a atributo (a "regra" das saídas). */
    profile: Pattern | undefined;
}

/** z crítico unilateral para cada nível de confiança. */
export const Z_CRITICAL: Record<string, number> = { none: -Infinity, "90": 1.2816, "95": 1.6449, "99": 2.3263 };

/** Folga mínima no lift para uma combinação valer mais que os pais. */
const LIFT_GAIN = 1.05;
const SEP_ITEM = "\u0001";
const SEP_VALUE = "\u0002";

export function keyOf(conditions: Condition[]): string {
    return conditions
        .slice()
        .sort((a, b) => a.attr - b.attr)
        .map(c => c.attr + SEP_VALUE + c.value)
        .join(SEP_ITEM);
}

export function totalsOf(rows: Row[]): Totals {
    let exits = 0;
    let base = 0;
    for (const row of rows) {
        exits += row.exits;
        base += row.base;
    }
    return { exits, base, rate: base > 0 ? exits / base : 0 };
}

export function evaluate(conditions: Condition[], exits: number, base: number, row: number, totals: Totals): Pattern {
    const sorted = conditions.slice().sort((a, b) => a.attr - b.attr);
    const rate = base > 0 ? exits / base : 0;
    const expected = base * totals.rate;
    let z = 0;
    if (base > 0 && totals.rate > 0) {
        // Binomial quando a taxa é uma proporção; acima de 100% (ex.: saídas do ano ÷ headcount
        // médio de um mês) usa a aproximação de Poisson.
        const variance = totals.rate < 1 ? base * totals.rate * (1 - totals.rate) : expected;
        z = variance > 0 ? (exits - expected) / Math.sqrt(variance) : 0;
    }
    return {
        key: keyOf(sorted),
        conditions: sorted,
        row,
        exits,
        base,
        share: totals.exits > 0 ? exits / totals.exits : 0,
        baseShare: totals.base > 0 ? base / totals.base : 0,
        rate,
        lift: totals.rate > 0 ? rate / totals.rate : 0,
        expected,
        excess: exits - expected,
        z
    };
}

/** Todas as combinações de k elementos de 0..n-1. */
export function combinations(n: number, k: number): number[][] {
    const out: number[][] = [];
    const pick = (start: number, acc: number[]): void => {
        if (acc.length === k) {
            out.push(acc.slice());
            return;
        }
        for (let i = start; i < n; i++) {
            acc.push(i);
            pick(i + 1, acc);
            acc.pop();
        }
    };
    if (k > 0 && k <= n) {
        pick(0, []);
    }
    return out;
}

interface Group {
    conditions: Condition[];
    exits: number;
    base: number;
    row: number;
}

/** Soma as linhas por combinação de valores dos atributos dados. */
function groupBy(rows: Row[], attrs: number[], hideBlanks: boolean, prefix: Condition[] = []): Group[] {
    const groups = new Map<string, Group>();
    for (const row of rows) {
        if (hideBlanks && attrs.some(a => row.blank[a])) {
            continue;
        }
        const key = attrs.map(a => row.values[a]).join(SEP_ITEM);
        let group = groups.get(key);
        if (!group) {
            group = {
                conditions: prefix.concat(attrs.map(a => ({ attr: a, value: row.values[a] }))),
                exits: 0,
                base: 0,
                row: row.index
            };
            groups.set(key, group);
        }
        group.exits += row.exits;
        group.base += row.base;
    }
    return Array.from(groups.values());
}

function passes(p: Pattern, o: Options): boolean {
    if (p.exits < o.minExits || p.exits <= 0) {
        return false;
    }
    if (o.mode === "share") {
        return p.share >= o.minShare;
    }
    return p.base > 0 && p.excess > 0 && p.lift >= o.minLift && p.z >= o.zCrit;
}

function score(p: Pattern, o: Options): number {
    if (o.mode === "share") {
        return p.exits;
    }
    return o.rankBy === "lift" ? p.lift : o.rankBy === "exits" ? p.exits : p.excess;
}

function compare(o: Options) {
    return (a: Pattern, b: Pattern): number =>
        score(b, o) - score(a, o)
        // Empate (ex.: a combinação tem as mesmas saídas que o pai): a mais específica primeiro.
        || b.conditions.length - a.conditions.length
        || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function analyze(rows: Row[], o: Options): Result {
    const totals = totalsOf(rows);
    if (totals.exits <= 0 || o.attrCount === 0) {
        return { totals, patterns: [], profile: undefined };
    }
    const maxDepth = Math.max(1, Math.min(o.maxDepth, o.attrCount));

    const all = new Map<string, Pattern>();
    for (let depth = 1; depth <= maxDepth; depth++) {
        for (const attrs of combinations(o.attrCount, depth)) {
            for (const g of groupBy(rows, attrs, o.hideBlanks)) {
                const p = evaluate(g.conditions, g.exits, g.base, g.row, totals);
                all.set(p.key, p);
            }
        }
    }

    // A combinação precisa acrescentar algo a cada um dos grupos pais.
    const productive = (p: Pattern): boolean => p.conditions.every((_, drop) => {
        if (p.conditions.length === 1) {
            return true;
        }
        const parent = all.get(keyOf(p.conditions.filter((__, k) => k !== drop)));
        if (!parent) {
            return true;
        }
        return o.mode === "share"
            ? p.exits >= parent.exits * o.dominance
            : p.lift >= parent.lift * LIFT_GAIN;
    });

    const patterns = Array.from(all.values())
        .filter(p => passes(p, o) && productive(p))
        .sort(compare(o));

    return { totals, patterns, profile: profile(rows, o, totals, maxDepth) };
}

/**
 * Monta o perfil das saídas atributo a atributo: a cada passo escolhe a condição que mais
 * explica as saídas dentro do grupo atual e para quando nenhuma acrescenta o suficiente.
 */
function profile(rows: Row[], o: Options, totals: Totals, maxDepth: number): Pattern | undefined {
    let current: Pattern | undefined;
    let subset = rows;
    for (let step = 0; step < maxDepth; step++) {
        const prefix = current ? current.conditions : [];
        const used = new Set(prefix.map(c => c.attr));
        let best: Pattern | undefined;
        for (let attr = 0; attr < o.attrCount; attr++) {
            if (used.has(attr)) {
                continue;
            }
            for (const g of groupBy(subset, [attr], o.hideBlanks, prefix)) {
                const cand = evaluate(g.conditions, g.exits, g.base, g.row, totals);
                if (!passes(cand, o)) {
                    continue;
                }
                const ok = o.mode === "share"
                    ? cand.exits >= (current ? current.exits : totals.exits) * o.dominance
                    : !current || cand.lift >= current.lift * LIFT_GAIN;
                const s = o.mode === "share" ? cand.exits : cand.excess;
                if (ok && (!best || s > (o.mode === "share" ? best.exits : best.excess))) {
                    best = cand;
                }
            }
        }
        if (!best) {
            break;
        }
        current = best;
        const chosen = best.conditions.filter(c => !used.has(c.attr))[0];
        subset = subset.filter(r => r.values[chosen.attr] === chosen.value && !(o.hideBlanks && r.blank[chosen.attr]));
    }
    return current;
}
