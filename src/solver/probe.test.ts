import { describe, expect, it } from 'vitest';
import {
  evaluate,
  solveWithAlternatives,
  validate,
  type RawInputs,
  type SolverParams,
} from './solver';
import {
  buildProbePlan,
  MAX_PROBES,
  MIN_PROBES,
} from './probe';

/* ---------------- buildProbePlan 纯逻辑 ---------------- */

describe('buildProbePlan', () => {
  it('无替代矩阵时结论唯一，无需补测', () => {
    const plan = buildProbePlan([0, 0, 0, 0], [], 0, 2);
    expect(plan.status).toBe('unique');
  });

  it('两个独占差异点：选 2 点，逐点给出移除后重现的见证', () => {
    const plan = buildProbePlan(
      [0, 0, 0, 0, 0, 0],
      [
        [1, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0],
      ],
      5,
      3,
    );
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.alternativeCount).toBe(2);
    expect(plan.points.map((p) => p.index)).toEqual([0, 1]);
    expect(plan.points.every((p) => p.expectedCycles === 0)).toBe(true);
    expect(plan.points[0].redundant).toBe(false);
    expect(plan.points[1].redundant).toBe(false);
    expect(plan.points[0].reappear?.cycles).toEqual([1, 0, 0, 0, 0, 0]);
    expect(plan.points[1].reappear?.cycles).toEqual([0, 1, 0, 0, 0, 0]);
    // 差异单元带行列定位
    expect(plan.points[0].reappear?.diffCells).toEqual([{ index: 0, row: 0, col: 0 }]);
  });

  it('三点两两相交的差异集：两点击中，重现见证为首个未分辨者', () => {
    // alt0~{0,2}, alt1~{1,2}, alt2~{0,1}
    const cycles = (i: number, j: number) => {
      const a = [0, 0, 0, 0];
      a[i] = 1;
      a[j] = 1;
      return a;
    };
    const plan = buildProbePlan(
      [0, 0, 0, 0],
      [cycles(0, 2), cycles(1, 2), cycles(0, 1)],
      3,
      2,
    );
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.points.map((p) => p.index)).toEqual([0, 1]);
    expect(plan.points[0].reappear?.cycles).toEqual(cycles(0, 2));
    expect(plan.points[1].reappear?.cycles).toEqual(cycles(1, 2));
  });

  it('一个核心点即可区分时仍补足到 2 点，且整体字典序最小', () => {
    // 两个替代矩阵差异集同为 {2}（anchor=0 不可选）
    const plan = buildProbePlan(
      [0, 0, 0, 0],
      [
        [0, 0, 1, 0],
        [0, 0, 1, 1],
      ],
      0,
      2,
    );
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.points.map((p) => p.index)).toEqual([1, 2]);
    expect(plan.points[0].redundant).toBe(true);
    expect(plan.points[0].reappear).toBeNull();
    // 移除核心点 2 后两个替代矩阵都重新出现，取字典序首个
    expect(plan.points[1].redundant).toBe(false);
    expect(plan.points[1].reappear?.cycles).toEqual([0, 0, 1, 0]);
  });

  it('同测点数下严格按行优先坐标序列取字典序最小', () => {
    // 差异集 {1,3}：单点即可击中，2 点计划最小序列是 [0,1]（anchor=2）
    const plan = buildProbePlan(
      [0, 0, 0, 0],
      [[0, 1, 0, 1]],
      2,
      2,
    );
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.points.map((p) => p.index)).toEqual([0, 1]);
  });

  it('10 点不能区分全部替代矩阵时给最佳努力计划与首个未分辨矩阵', () => {
    // 11 个替代矩阵，各自只在独占单元 j 上与主见证不同 → 需 11 点
    const N = 12;
    const alts: number[][] = [];
    for (let j = 0; j < 11; j++) {
      const a = new Array(N).fill(0);
      a[j] = 1;
      alts.push(a);
    }
    const plan = buildProbePlan(new Array(N).fill(0), alts, 11, 4);
    expect(plan.status).toBe('impossible');
    if (plan.status !== 'impossible') return;
    expect(plan.points.map((p) => p.index)).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(plan.firstUndistinguished.cycles).toEqual(alts[10]);
    expect(plan.firstUndistinguished.diffCells).toEqual([{ index: 10, row: 2, col: 2 }]);
  });

  it('努力计划必须真正达到最大覆盖：舍独占点保双见证点（21 替代 / 需 11 点）', () => {
    // 6×3、锚点在末格 17。21 个替代矩阵：
    //   - 9 个独占见证：各自只在单元 0..8 上与主见证不同；
    //   - 2 个见证只在单元 10 上不同（三值域：-1 与 +1）；
    //   - 10 个见证都在单元 11 上不同（各自再在 {9,12..16} 上带不同组合以相互区分）。
    // 完全区分需要 9 + 1 + 1 = 11 点；10 点的最大覆盖是 20：
    // 放弃一个独占点，保留 10 与 11，字典序最小为 [0..7,10,11]。
    const N = 18;
    const cols = 3;
    const anchor = 17;
    const primary = new Array(N).fill(0);
    const alts: number[][] = [];
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = new Array(N).fill(0);
      a[i] = 1;
      alts.push(a);
    }
    for (const v of [-1, 1]) {
      const a = new Array(N).fill(0);
      a[10] = v;
      alts.push(a);
    }
    const comboCells = [9, 12, 13, 14, 15, 16];
    for (let j = 1; j <= 10; j++) {
      const a = new Array(N).fill(0);
      a[11] = 1;
      comboCells.forEach((cell, b) => {
        if ((j >> b) & 1) a[cell] = 1;
      });
      alts.push(a);
    }
    alts.sort(lex);

    const plan = buildProbePlan(primary, alts, anchor, cols);
    expect(plan.status).toBe('impossible');
    if (plan.status !== 'impossible') return;
    expect(plan.alternativeCount).toBe(21);
    const selected = plan.points.map((p) => p.index);
    expect(selected).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 10, 11]);
    // 覆盖 20/21：唯一未分辨的是独占单元 8 的见证
    let covered = 0;
    for (const a of alts) {
      if (a.some((v, i) => v !== primary[i] && selected.includes(i))) covered++;
    }
    expect(covered).toBe(20);
    const uncovered = alts.find(
      (a) => !a.some((v, i) => v !== primary[i] && selected.includes(i)),
    );
    expect(plan.firstUndistinguished.cycles).toEqual(uncovered);
    expect(plan.firstUndistinguished.diffCells).toEqual([{ index: 8, row: 2, col: 2 }]);
  });

  it('努力计划对拍暴力：覆盖数最大、并列字典序最小、见证与计划一致', () => {
    const rand = mulberry32(20260924);
    let checked = 0;
    for (let trial = 0; trial < 400 && checked < 60; trial++) {
      const N = 12 + Math.floor(rand() * 5); // 12..16 格
      const cols = 3 + Math.floor(N / 6); // 仅影响行列换算
      const anchor = N - 1 - Math.floor(rand() * 2);
      const reachable: number[] = [];
      for (let i = 0; i < N; i++) if (i !== anchor) reachable.push(i);

      // 至少 11 个独占差异见证，保证 10 点不可能全部分辨
      const privN = 11 + Math.floor(rand() * Math.min(4, reachable.length - 11));
      const privCells = [...reachable].sort(() => rand() - 0.5).slice(0, privN);
      const rawAlts: number[][] = privCells.map((cell) => {
        const a = new Array(N).fill(0);
        a[cell] = 1;
        return a;
      });
      // 再混入若干共享/随机差异见证
      const extraN = Math.floor(rand() * 6);
      for (let e = 0; e < extraN; e++) {
        const a = new Array(N).fill(0);
        const sz = 1 + Math.floor(rand() * 3);
        for (let s = 0; s < sz; s++) a[reachable[Math.floor(rand() * reachable.length)]] = 1;
        if (a.some((v) => v !== 0) && !rawAlts.some((x) => x.every((v, i) => v === a[i]))) {
          rawAlts.push(a);
        }
      }
      rawAlts.sort(lex);

      const plan = buildProbePlan(new Array(N).fill(0), rawAlts, anchor, cols);
      if (plan.status !== 'impossible') continue;
      checked++;

      // 独立暴力：枚举全部 10 元可触达子集，取覆盖最多且字典序最小者
      const diffs = rawAlts.map((a) => {
        const s = new Set<number>();
        a.forEach((v, i) => {
          if (v !== 0) s.add(i);
        });
        return s;
      });
      let bestCover = -1;
      let bestCombo: number[] | null = null;
      const cur: number[] = [];
      const combos = (s: number) => {
        if (cur.length === 10) {
          const sel = new Set(cur);
          const c = diffs.filter((d) => [...d].some((i) => sel.has(i))).length;
          if (c > bestCover || (c === bestCover && lex(cur, bestCombo as number[]) < 0)) {
            bestCover = c;
            bestCombo = cur.slice();
          }
          return;
        }
        for (let i = s; i < reachable.length; i++) {
          cur.push(reachable[i]);
          combos(i + 1);
          cur.pop();
        }
      };
      combos(0);
      const brute = bestCombo!;

      expect(plan.points.map((p) => p.index)).toEqual(brute);
      const sel = new Set(brute);
      const firstJ = diffs.findIndex((d) => ![...d].some((i) => sel.has(i)));
      expect(plan.firstUndistinguished.cycles).toEqual(rawAlts[firstJ]);
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('大量互不相干独占见证下努力计划仍精确且快速', () => {
    // 95 个独占见证（24×4 规模、95 个可触达单元）→ 需 95 点，10 点只能覆盖 10 个
    const N = 96;
    const anchor = 95;
    const alts: number[][] = [];
    for (let j = 0; j < 95; j++) {
      const a = new Array(N).fill(0);
      a[j] = 1;
      alts.push(a);
    }
    const t0 = Date.now();
    const plan = buildProbePlan(new Array(N).fill(0), alts, anchor, 4);
    const ms = Date.now() - t0;
    expect(plan.status).toBe('impossible');
    if (plan.status !== 'impossible') return;
    expect(plan.points.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.firstUndistinguished.diffCells).toEqual([{ index: 10, row: 2, col: 2 }]);
    expect(ms).toBeLessThan(1000);
  });

  it('撞枚举预算时拒绝给出不可靠计划', () => {
    const alts: number[][] = [];
    for (let j = 0; j < 3; j++) {
      const a = new Array(6).fill(0);
      a[j] = 1;
      alts.push(a);
    }
    const plan = buildProbePlan(new Array(6).fill(0), alts, 5, 3, 3);
    expect(plan.status).toBe('too-many');
    if (plan.status === 'too-many') expect(plan.budget).toBe(3);
  });

  it('测点数上限常量为 2..10', () => {
    expect(MIN_PROBES).toBe(2);
    expect(MAX_PROBES).toBe(10);
  });
});

/* ---------------- solveWithAlternatives 与暴力枚举交叉验证 ---------------- */

const baseRaw = (over: Partial<RawInputs> = {}): RawInputs => ({
  rows: 2,
  cols: 2,
  cells: ['0', '1', '2', '3'],
  period: '4',
  cycleMin: '0',
  cycleMax: '2',
  jumpCap: '1',
  anchorRow: 0,
  anchorCol: 0,
  anchorCycles: '0',
  ...over,
});

function paramsFrom(over: Partial<RawInputs> = {}): SolverParams {
  const checked = validate(baseRaw(over));
  if ('issues' in checked) throw new Error('测试输入非法');
  return checked.params;
}

interface BruteCandidate {
  cycles: number[];
  o2: number;
  o1: number;
}

function bruteSolve(p: SolverParams): BruteCandidate[] {
  const { rows: R, cols: C, readings: rd, period: P } = p;
  const N = R * C;
  const limit = p.jumpCap * P;
  const anchor = p.anchorRow * C + p.anchorCol;
  const dom: number[][] = Array.from({ length: N }, (_, i) =>
    i === anchor
      ? [p.anchorCycles]
      : Array.from({ length: p.cycleMax - p.cycleMin + 1 }, (_, d) => p.cycleMin + d),
  );
  const out: BruteCandidate[] = [];
  const cur = new Array<number>(N);
  const phi = (i: number) => rd[i] + cur[i] * P;
  const obj = () => {
    let o2 = 0;
    let o1 = 0;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (c + 1 < C) {
          const d = phi(i + 1) - phi(i);
          o1 += Math.abs(d);
          if (c + 2 < C) o2 += Math.abs((phi(i + 2) - phi(i + 1)) - d);
        }
        if (r + 1 < R) {
          const d = phi(i + C) - phi(i);
          o1 += Math.abs(d);
          if (r + 2 < R) o2 += Math.abs((phi(i + 2 * C) - phi(i + C)) - d);
        }
      }
    }
    return { o2, o1 };
  };
  const rec = (i: number) => {
    if (i === N) {
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const j = r * C + c;
          if (c + 1 < C && Math.abs(phi(j + 1) - phi(j)) > limit) return;
          if (r + 1 < R && Math.abs(phi(j + C) - phi(j)) > limit) return;
        }
      }
      out.push({ cycles: [...cur], ...obj() });
      return;
    }
    for (const k of dom[i]) {
      cur[i] = k;
      rec(i + 1);
    }
  };
  rec(0);
  out.sort((a, b) => a.o2 - b.o2 || a.o1 - b.o1 || lex(a.cycles, b.cycles));
  return out;
}

function lex(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

describe('solveWithAlternatives 枚举与暴力一致', () => {
  const seeds = [1, 2, 3, 7, 42, 99, 123, 777, 31, 57, 88, 201, 314];
  for (const seed of seeds) {
    const rand = mulberry32(seed);
    const R = 2 + Math.floor(rand() * 2);
    const C = 2 + Math.floor(rand() * 2);
    const P = 1 + Math.floor(rand() * 5);
    const cells = Array.from({ length: R * C }, () => String(Math.floor(rand() * P)));
    const cmin = -1 + Math.floor(rand() * 2);
    const cmax = cmin + Math.floor(rand() * 3);
    const cap = Math.floor(rand() * 3);
    const ar = Math.floor(rand() * R);
    const ac = Math.floor(rand() * C);
    const anchorK = cmin + Math.floor(rand() * (cmax - cmin + 1));

    const p = paramsFrom({
      rows: R,
      cols: C,
      cells,
      period: String(P),
      cycleMin: String(cmin),
      cycleMax: String(cmax),
      jumpCap: String(cap),
      anchorRow: ar,
      anchorCol: ac,
      anchorCycles: String(anchorK),
    });

    it(`seed=${seed} ${R}x${C}`, () => {
      const expected = bruteSolve(p);
      const got = solveWithAlternatives(p);
      if (expected.length === 0) {
        expect(got.status).toBe('unsat');
        return;
      }
      expect(got.status).toBe('ok');
      if (got.status !== 'ok') return;
      const tied = expected.filter(
        (e) => e.o2 === expected[0].o2 && e.o1 === expected[0].o1,
      );
      expect(got.truncated).toBe(tied.length >= 201);
      if (!got.truncated) {
        expect(got.result.primary.cycles).toEqual(tied[0].cycles);
        expect(got.alternatives).toEqual(tied.slice(1).map((t) => t.cycles));
        // 替代矩阵按行优先字典序升序
        for (let i = 1; i < got.alternatives.length; i++) {
          expect(lex(got.alternatives[i - 1], got.alternatives[i])).toBeLessThan(0);
        }

        // 补测计划与独立暴力集合覆盖一致（测点数最少、字典序最小、确实可区分）
        const plan = buildProbePlan(
          got.result.primary.cycles,
          got.alternatives,
          p.anchorRow * C + p.anchorCol,
          C,
        );
        const diffSets = got.alternatives.map((a) =>
          new Set(a.map((k, i) => (k !== tied[0].cycles[i] ? i : -1)).filter((i) => i >= 0)),
        );
        const brute = bruteMinCover(N_CELLS(p), diffSets, p.anchorRow * C + p.anchorCol);
        if (got.alternatives.length === 0) {
          expect(plan.status).toBe('unique');
        } else if (brute === null) {
          expect(plan.status).toBe('impossible');
        } else {
          expect(plan.status).toBe('ready');
          if (plan.status === 'ready') {
            expect(plan.points.map((q) => q.index)).toEqual(brute);
            for (const a of got.alternatives) {
              const diff = new Set(
                a.map((k, i) => (k !== tied[0].cycles[i] ? i : -1)).filter((i) => i >= 0),
              );
              expect(brute.some((i) => diff.has(i))).toBe(true);
            }
          }
        }
      }
    });
  }
});

function N_CELLS(p: SolverParams): number {
  return p.rows * p.cols;
}

describe('补测集合覆盖对拍暴力（大批小网格）', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rand = mulberry32(seed * 101 + 3);
    const R = 2 + Math.floor(rand() * 3); // 2..4
    const C = 2 + Math.floor(rand() * 2); // 2..3
    const P = 2 + Math.floor(rand() * 5);
    const cells = Array.from({ length: R * C }, () => String(Math.floor(rand() * P)));
    const cmin = 0;
    const cmax = 1;
    const cap = Math.floor(rand() * 3);
    const ar = Math.floor(rand() * R);
    const ac = Math.floor(rand() * C);
    const anchorK = Math.floor(rand() * 2);
    const raw = baseRaw({
      rows: R,
      cols: C,
      cells,
      period: String(P),
      cycleMin: String(cmin),
      cycleMax: String(cmax),
      jumpCap: String(cap),
      anchorRow: ar,
      anchorCol: ac,
      anchorCycles: String(anchorK),
    });
    const checked = validate(raw);
    if ('issues' in checked) throw new Error('fuzz 输入非法');

    it(`seed=${seed} ${R}x${C}`, () => {
      const got = solveWithAlternatives(checked.params);
      if (got.status !== 'ok') return;
      const primary = got.result.primary.cycles;
      const plan = buildProbePlan(primary, got.alternatives, ar * C + ac, C);
      if (got.alternatives.length === 0) {
        expect(plan.status).toBe('unique');
        return;
      }
      const diffSets = got.alternatives.map((a) => {
        const s = new Set<number>();
        a.forEach((k, i) => {
          if (k !== primary[i]) s.add(i);
        });
        return s;
      });
      const brute = bruteMinCover(R * C, diffSets, ar * C + ac);
      if (brute === null) {
        expect(plan.status).toBe('impossible');
      } else {
        expect(plan.status).toBe('ready');
        if (plan.status === 'ready') {
          expect(plan.points.map((q) => q.index)).toEqual(brute);
        }
      }
    });
  }
});

/** 独立暴力：按测点数升序、组合字典序枚举，返回首个击中全部差异集的组合 */
function bruteMinCover(
  n: number,
  diffSets: Set<number>[],
  anchor: number,
): number[] | null {
  if (diffSets.length === 0) return [];
  const reachable: number[] = [];
  for (let i = 0; i < n; i++) if (i !== anchor) reachable.push(i);
  const combo = (k: number): Iterable<number[]> => {
    const out: number[][] = [];
    const cur: number[] = [];
    const rec = (s: number) => {
      if (cur.length === k) {
        out.push(cur.slice());
        return;
      }
      for (let i = s; i < reachable.length; i++) {
        cur.push(reachable[i]);
        rec(i + 1);
        cur.pop();
      }
    };
    rec(0);
    return out;
  };
  for (let k = MIN_PROBES; k <= Math.min(MAX_PROBES, reachable.length); k++) {
    for (const c of combo(k)) {
      const sel = new Set(c);
      if (diffSets.every((d) => [...d].some((i) => sel.has(i)))) return c;
    }
  }
  return null;
}

describe('补测规划接入 evaluate 的端到端语义', () => {
  it('唯一最优时无需补测', () => {
    const e = evaluate(baseRaw());
    expect(e.status).toBe('ok');
    if (e.status === 'ok') expect(e.probe.status).toBe('unique');
  });

  it('并列时给出 ready 计划且每点预期圈数为主见证圈数', () => {
    const e = evaluate(
      baseRaw({
        cells: ['3', '2', '1', '4'],
        period: '5',
        cycleMin: '0',
        cycleMax: '1',
        jumpCap: '1',
      }),
    );
    expect(e.status).toBe('ok');
    if (e.status !== 'ok') return;
    expect(e.probe.status).toBe('ready');
    if (e.probe.status !== 'ready') return;
    expect(e.probe.points.length).toBeGreaterThanOrEqual(MIN_PROBES);
    expect(e.probe.points.length).toBeLessThanOrEqual(MAX_PROBES);
    for (const pt of e.probe.points) {
      expect(pt.expectedCycles).toBe(e.result.primary.cycles[pt.index]);
    }
  });

  const case11Raw: RawInputs = {
    rows: 6,
    cols: 3,
    cells: ['1', '1', '0', '0', '1', '1', '1', '1', '1', '1', '0', '0', '0', '0', '0', '0', '1', '1'],
    period: '2',
    cycleMin: '0',
    cycleMax: '1',
    jumpCap: '1',
    anchorRow: 0,
    anchorCol: 0,
    anchorCycles: '0',
  };

  it('真实多替代实例：完整比较后给出测点数最少且字典序最小的计划', () => {
    const e = evaluate(case11Raw);
    expect(e.status).toBe('ok');
    if (e.status !== 'ok') return;
    // 11 个替代矩阵：单看任一差异点都不够，点 2、点 3 各自独占一类，
    // 还需 10–15 中一个点 → 最小测点数 3，字典序最小序列 [2,3,10]
    expect(e.probe.status).toBe('ready');
    if (e.probe.status !== 'ready') return;
    expect(e.probe.alternativeCount).toBe(11);
    expect(e.probe.points.map((p) => p.index)).toEqual([2, 3, 10]);
    expect(e.probe.points.every((p) => !p.redundant)).toBe(true);
    // 每点移除后都有替代见证重现（三点击中集无冗余）
    for (const pt of e.probe.points) {
      expect(pt.reappear).not.toBeNull();
    }
  });

  it('撞枚举预算时 evaluate 返回 too-many 且不在预算外猜测计划', () => {
    const p = paramsFrom(case11Raw);
    const got = solveWithAlternatives(p, 3);
    expect(got.status).toBe('ok');
    if (got.status !== 'ok') return;
    expect(got.truncated).toBe(true);
    // 已收集主解 + 2 个替代即撞限；规划层见到预算数量个替代时拒绝给计划
    expect(got.alternatives.length).toBe(2);
    const plan = buildProbePlan(got.result.primary.cycles, got.alternatives, 0, 3, 2);
    expect(plan.status).toBe('too-many');
  });
});

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
