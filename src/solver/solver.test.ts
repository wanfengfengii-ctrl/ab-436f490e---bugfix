import { describe, expect, it } from 'vitest';
import {
  evaluate,
  parseInteger,
  parseMatrixText,
  solve,
  validate,
  type RawInputs,
  type SolverParams,
} from './solver';

/* ---------------- 纯解析 ---------------- */

describe('parseInteger', () => {
  it('接受常见整数写法', () => {
    expect(parseInteger('12')).toBe(12);
    expect(parseInteger(' -3 ')).toBe(-3);
    expect(parseInteger('+0')).toBe(0);
    expect(parseInteger('007')).toBe(7);
  });
  it('拒绝非法与越界输入', () => {
    expect(parseInteger('')).toBeNull();
    expect(parseInteger('1.5')).toBeNull();
    expect(parseInteger('1e3')).toBeNull();
    expect(parseInteger('abc')).toBeNull();
    expect(parseInteger('1 2')).toBeNull();
    expect(parseInteger('999999999999999999999')).toBeNull();
  });
});

describe('parseMatrixText', () => {
  it('解析逗号、空白与混合分隔', () => {
    const r = parseMatrixText('1,2 3\n4 5\t6');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values).toEqual([
        [1, 2, 3],
        [4, 5, 6],
      ]);
      expect(r.rows).toBe(2);
      expect(r.cols).toBe(3);
    }
  });
  it('定位行列不齐', () => {
    const r = parseMatrixText('1 2 3\n4 5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.row).toBe(2);
  });
  it('定位非法单元', () => {
    const r = parseMatrixText('1 x\n3 4');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.row).toBe(1);
      expect(r.col).toBe(2);
    }
  });
  it.each([
    ['1 2', 1, 2],
    ['1 2 3 4 5', 1, 5],
    [Array.from({ length: 25 }, (_, i) => `${i} 0`).join('\n'), 25, 2],
  ])('拒绝越界尺寸', (text) => {
    const r = parseMatrixText(text);
    expect(r.ok).toBe(false);
  });
});

/* ---------------- 校验与定位 ---------------- */

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

describe('validate', () => {
  it('合法输入通过', () => {
    const r = validate(baseRaw());
    expect('params' in r).toBe(true);
  });
  it('非法读数单元带行列定位', () => {
    const r = validate(baseRaw({ cells: ['0', 'x', '2', ''] }));
    if ('issues' in r) {
      const cellIssues = r.issues.filter((i) => i.kind === 'cell');
      expect(cellIssues).toHaveLength(2);
      expect(cellIssues).toContainEqual(
        expect.objectContaining({ kind: 'cell', row: 0, col: 1 }),
      );
      expect(cellIssues).toContainEqual(
        expect.objectContaining({ kind: 'cell', row: 1, col: 1 }),
      );
    } else throw new Error('应当校验失败');
  });
  it('字段级规则：周期、区间跨度、锚点范围、负跳变', () => {
    expect('issues' in validate(baseRaw({ period: '0' }))).toBe(true);
    expect('issues' in validate(baseRaw({ cycleMin: '0', cycleMax: '3' }))).toBe(true);
    expect('issues' in validate(baseRaw({ cycleMin: '2', cycleMax: '1' }))).toBe(true);
    expect('issues' in validate(baseRaw({ jumpCap: '-1' }))).toBe(true);
    expect('issues' in validate(baseRaw({ anchorCycles: '5' }))).toBe(true);
  });
  it('锚点越界给出维度问题', () => {
    const r = validate(baseRaw({ anchorRow: 5 }));
    expect('issues' in r).toBe(true);
  });
});

/* ---------------- 暴力参照求解器 ---------------- */

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

  const obj = (): { o2: number; o1: number } => {
    let o2 = 0;
    let o1 = 0;
    const phi = (i: number) => rd[i] + cur[i] * P;
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
      // 硬约束：全部相邻边
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const j = r * C + c;
          if (c + 1 < C && Math.abs(phi(j + 1) - phi(j)) > limit) return;
          if (r + 1 < R && Math.abs(phi(j + C) - phi(j)) > limit) return;
        }
      }
      const { o2, o1 } = obj();
      out.push({ cycles: [...cur], o2, o1 });
      return;
    }
    for (const k of dom[i]) {
      cur[i] = k;
      rec(i + 1);
    }
  };
  const phi = (i: number) => rd[i] + cur[i] * P;
  rec(0);

  out.sort((a, b) => a.o2 - b.o2 || a.o1 - b.o1 || lex(a.cycles, b.cycles));
  return out;
}

function lex(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function paramsFrom(over: Partial<RawInputs> = {}): SolverParams {
  const checked = validate(baseRaw(over));
  if ('issues' in checked) throw new Error('测试输入非法');
  return checked.params;
}

/* ---------------- DP 与暴力的一致性（随机交叉验证） ---------------- */

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

describe('solve 与暴力枚举一致', () => {
  const seeds = [1, 2, 3, 7, 42, 99, 123, 777];
  for (const seed of seeds) {
    const rand = mulberry32(seed);
    const R = 2 + Math.floor(rand() * 2); // 2..3
    const C = 2 + Math.floor(rand() * 2); // 2..3
    const P = 1 + Math.floor(rand() * 5);
    const cells = Array.from({ length: R * C }, () => String(Math.floor(rand() * P)));
    const cmin = -1 + Math.floor(rand() * 2);
    const cmax = cmin + Math.floor(rand() * 3); // 区间 1..3 个整数
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

    it(`seed=${seed} ${R}x${C} P=${P} 区间=[${cmin},${cmax}] cap=${cap}`, () => {
      const expected = bruteSolve(p);
      const got = solve(p);
      if (expected.length === 0) {
        expect(got.status).toBe('unsat');
        return;
      }
      expect(got.status).toBe('ok');
      if (got.status !== 'ok') return;
      const best = expected[0];
      expect(got.primary.cycles).toEqual(best.cycles);
      expect(got.primary.objective2).toBe(best.o2);
      expect(got.primary.objective1).toBe(best.o1);
      // 真值公式核对
      got.primary.cycles.forEach((k, i) => {
        expect(got.primary.unwrapped[i]).toBe(p.readings[i] + k * p.period);
      });

      const tied = expected.filter((e) => e.o2 === best.o2 && e.o1 === best.o1);
      if (tied.length >= 2) {
        expect(got.witness).not.toBeNull();
        expect(got.witness!.cycles).toEqual(tied[1].cycles);
        expect(got.witness!.objective2).toBe(best.o2);
        expect(got.witness!.objective1).toBe(best.o1);
        expect(lex(got.primary.cycles, got.witness!.cycles)).toBeLessThan(0);
      } else {
        expect(got.witness).toBeNull();
      }
    });
  }
});

/* ---------------- 定向语义用例 ---------------- */

describe('solve 定向语义', () => {
  it('锚点强制选择非平凡圈数', () => {
    // 读数全 0，P=10，区间 [-1,1]，cap=1：锚点圈数 1 时全 1 才平滑
    const p = paramsFrom({
      cells: ['0', '0', '0', '0'],
      period: '10',
      cycleMin: '-1',
      cycleMax: '1',
      jumpCap: '1',
      anchorCycles: '1',
    });
    const got = solve(p);
    expect(got.status).toBe('ok');
    if (got.status === 'ok') expect(got.primary.cycles).toEqual([1, 1, 1, 1]);
  });

  it('二阶差分优先于相邻差：优先选择等间隔折返', () => {
    // 构造：读数使两条可行路径 o1 相同但曲率不同
    // 2x3, P=6, cap=1, 区间 {0,1}
    const cells = ['0', '2', '4', '0', '2', '4'];
    const p = paramsFrom({
      rows: 2,
      cols: 3,
      cells,
      period: '6',
      cycleMin: '0',
      cycleMax: '1',
      jumpCap: '1',
      anchorRow: 0,
      anchorCol: 0,
      anchorCycles: '0',
    });
    const got = solve(p);
    const expected = bruteSolve(p);
    expect(got.status).toBe('ok');
    if (got.status === 'ok') {
      expect(got.primary.cycles).toEqual(expected[0].cycles);
      // 全部加 0 圈即等间隔（二阶差分为 0）
      expect(got.primary.objective2).toBe(0);
    }
  });

  it('边级冲突被定位到具体相邻边', () => {
    // 区间只有 {0}，读数相邻差超过 cap*P → 边预检失败
    const p = paramsFrom({
      cells: ['0', '5', '5', '0'],
      period: '10',
      cycleMin: '0',
      cycleMax: '0',
      jumpCap: '0',
      anchorCycles: '0',
    });
    const got = solve(p);
    expect(got.status).toBe('unsat');
    if (got.status === 'unsat') {
      expect(got.edgeFailures.length).toBeGreaterThan(0);
      // (0,0)-(0,1) 读数差 5 > 0 必在其中
      expect(got.edgeFailures).toContainEqual(
        expect.objectContaining({ r1: 0, c1: 0, r2: 0, c2: 1 }),
      );
    }
  });

  it('单边预检全过但锚点传播后组合无解时给出失败格定位', () => {
    // P=10, cap=1, 圈数域 {0,1}，锚点 (0,0) 固定 0 圈。
    // 第一行读数 [0, -15, -30]（相邻差均为 -15）：
    //  - 边 (0,0)-(0,1)：锚点 0 圈下只有 k1=1 可行（真值 -5，差 5）；
    //  - 边 (0,1)-(0,2)：完整域上唯一可行对是 (k1=0,k2=1)（预检通过），
    //    锚点迫使 k1=1 后，k2 需要取 2（越出域顶），k2∈{0,1} 全部超限。
    // 2x3 第二行读数与首行相同，竖边差为 0，不早于该格失败。
    const p = paramsFrom({
      rows: 2,
      cols: 3,
      cells: ['0', '-15', '-30', '0', '-15', '-30'],
      period: '10',
      cycleMin: '0',
      cycleMax: '1',
      jumpCap: '1',
      anchorRow: 0,
      anchorCol: 0,
      anchorCycles: '0',
    });
    const got = solve(p);
    expect(got.status).toBe('unsat');
    if (got.status === 'unsat') {
      expect(got.edgeFailures).toEqual([]);
      expect(got.failCell).toEqual({ row: 0, col: 2 });
    }
  });

  it('全部并列时字典序最小且无见证', () => {
    const p = paramsFrom({
      cells: ['1', '1', '1', '1'],
      period: '2',
      cycleMin: '0',
      cycleMax: '0',
      jumpCap: '1',
    });
    const got = solve(p);
    expect(got.status).toBe('ok');
    if (got.status === 'ok') {
      expect(got.primary.cycles).toEqual([0, 0, 0, 0]);
      expect(got.witness).toBeNull();
    }
  });
});

describe('solve 与暴力枚举一致（更大尺寸/全域三值）', () => {
  const cases: { seed: number; R: number; C: number }[] = [
    { seed: 31, R: 2, C: 4 },
    { seed: 57, R: 2, C: 4 },
    { seed: 88, R: 4, C: 2 },
    { seed: 201, R: 4, C: 2 },
    { seed: 314, R: 3, C: 3 },
  ];
  for (const { seed, R, C } of cases) {
    const rand = mulberry32(seed * 7 + 1);
    const P = 1 + Math.floor(rand() * 4);
    const cells = Array.from({ length: R * C }, () => String(Math.floor(rand() * (P + 2)) - 1));
    const cmin = -1;
    const cmax = 1;
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

    it(`seed=${seed} ${R}x${C} P=${P} cap=${cap} 锚点(${ar},${ac})=${anchorK}`, () => {
      const expected = bruteSolve(p);
      const got = solve(p);
      if (expected.length === 0) {
        expect(got.status).toBe('unsat');
        return;
      }
      expect(got.status).toBe('ok');
      if (got.status !== 'ok') return;
      expect([got.primary.objective2, got.primary.objective1]).toEqual([
        expected[0].o2,
        expected[0].o1,
      ]);
      expect(got.primary.cycles).toEqual(expected[0].cycles);
      const tied = expected.filter(
        (e) => e.o2 === expected[0].o2 && e.o1 === expected[0].o1,
      );
      if (tied.length >= 2) {
        expect(got.witness!.cycles).toEqual(tied[1].cycles);
      } else {
        expect(got.witness).toBeNull();
      }
    });
  }
});

/* ---------------- 24x4 规模性能 ---------------- */

describe('规模与性能', () => {
  it('24x4、三整数区间在时限内完成', () => {
    const R = 24;
    const C = 4;
    const P = 8;
    const cells = Array.from({ length: R * C }, (_, i) =>
      String((i * 3 + (i % 7)) % P),
    );
    const p = paramsFrom({
      rows: R,
      cols: C,
      cells,
      period: String(P),
      cycleMin: '-1',
      cycleMax: '1',
      jumpCap: '1',
    });
    const t0 = Date.now();
    const got = solve(p);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(5000);
    // cap=1, P=8，相邻读数模 8 差总可由 ±1 圈弥合，通常有解
    expect(['ok', 'unsat']).toContain(got.status);
  });
});

/* ---------------- evaluate 聚合入口 ---------------- */

describe('evaluate', () => {
  it('非法输入回 invalid 并定位', () => {
    const e = evaluate(baseRaw({ period: 'x', cells: ['a', '0', '0', '0'] }));
    expect(e.status).toBe('invalid');
    if (e.status === 'invalid') {
      expect(e.issues.some((i) => i.kind === 'field' && i.field === 'period')).toBe(true);
      expect(e.issues.some((i) => i.kind === 'cell' && i.row === 0 && i.col === 0)).toBe(true);
    }
  });
  it('合法输入回 ok', () => {
    const e = evaluate(baseRaw());
    expect(e.status).toBe('ok');
  });
  it('无解回 unsat', () => {
    const e = evaluate(
      baseRaw({ cycleMin: '0', cycleMax: '0', jumpCap: '0', cells: ['0', '9', '0', '0'] }),
    );
    expect(e.status).toBe('unsat');
  });
});
