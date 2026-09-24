/**
 * 补测规划（纯函数，与求解器的数据结构解耦，便于单测）。
 *
 * 一次展开裁决已有主见证，但仍存在同曲率、同总变差的替代圈数矩阵时，
 * 计量员从矩阵中选定 2–MAX_PROBES 个可触达单元安排下一轮人工测量：
 *   - 每个被选单元的测量真值预期取主见证的圈数；
 *   - 补测集合有效 ⇔ 每个替代矩阵都至少在一个被选单元上与主见证不同
 *     （即补测集击中每个替代矩阵的差异单元集合）；
 *   - 依次选择测点数最少、行优先坐标序列字典序最小的计划。
 *
 * 若允许的测点数上限内仍不能区分全部替代矩阵，则给出在同样偏好下
 * （测点最少、字典序最小）覆盖替代矩阵数最多的计划，以及首个未被
 * 区分的圈数矩阵与其差异单元。
 */

export const MIN_PROBES = 2;
export const MAX_PROBES = 10;
/** 替代矩阵枚举撞上预算时，规划不再可靠（见 solver 中同名预算） */
export const DEFAULT_ALTERNATIVE_BUDGET = 200;
/** 最佳努力搜索的节点预算，超过后取当时最优（确定性行为） */
const SEARCH_NODE_BUDGET = 500_000;

export interface ProbeWitness {
  /** 替代见证的完整行优先圈数序列 */
  cycles: number[];
  /** 与主见证不同的单元 */
  diffCells: { index: number; row: number; col: number }[];
}

export interface ProbePoint {
  index: number;
  row: number;
  col: number;
  /** 预期测量真值：主见证在该格的圈数 */
  expectedCycles: number;
  /** 该点是否为冗余点（移除后集合仍能区分全部替代矩阵） */
  redundant: boolean;
  /** 移除该点后首个重新无法区分的替代见证；冗余点为 null */
  reappear: ProbeWitness | null;
}

export type ProbePlan =
  | { status: 'unique' }
  | {
      status: 'ready';
      /** 参与区分的替代见证总数（不含主见证） */
      alternativeCount: number;
      points: ProbePoint[];
    }
  | {
      status: 'impossible';
      alternativeCount: number;
      /** 上限内覆盖替代矩阵数最多、字典序最小的努力计划 */
      points: ProbePoint[];
      /** 该计划下首个仍未被区分的圈数矩阵 */
      firstUndistinguished: ProbeWitness;
    }
  | {
      status: 'too-many';
      /** 枚举在找到该数量后撞上预算（实际替代矩阵数的下界） */
      alternativeCount: number;
      budget: number;
    };

interface DiffAlt {
  cycles: number[];
  /** 与主见证不同的单元下标，升序 */
  diff: number[];
}

function toWitness(alt: DiffAlt, cols: number): ProbeWitness {
  return {
    cycles: alt.cycles,
    diffCells: alt.diff.map((index) => ({
      index,
      row: Math.floor(index / cols),
      col: index % cols,
    })),
  };
}

/**
 * @param primary      主见证圈数序列（行优先）
 * @param alternatives 全部同分替代矩阵，须按行优先圈数序列字典序升序
 * @param anchorIndex  锚点格（不可触达；替代矩阵在该格必与主见证一致）
 * @param enumBudget   替代矩阵枚举预算：达到该数说明结果不可靠
 */
export function buildProbePlan(
  primary: number[],
  alternatives: number[][],
  anchorIndex: number,
  cols: number,
  enumBudget: number = DEFAULT_ALTERNATIVE_BUDGET,
): ProbePlan {
  const N = primary.length;
  if (alternatives.length === 0) return { status: 'unique' };
  if (alternatives.length >= enumBudget) {
    return { status: 'too-many', alternativeCount: alternatives.length, budget: enumBudget };
  }

  const alts: DiffAlt[] = alternatives.map((cycles) => {
    const diff: number[] = [];
    for (let i = 0; i < N; i++) if (cycles[i] !== primary[i]) diff.push(i);
    return { cycles, diff };
  });

  /** 每个单元击中的替代矩阵位掩码 */
  const cellHits = new Map<number, bigint>();
  for (let j = 0; j < alts.length; j++) {
    for (const i of alts[j].diff) cellHits.set(i, (cellHits.get(i) ?? 0n) | (1n << BigInt(j)));
  }
  const hitsOf = (i: number): bigint => cellHits.get(i) ?? 0n;

  /** 出现过差异的单元（只有这些点能提供区分度），升序 */
  const varying: number[] = [];
  {
    const seen = new Set<number>();
    for (const a of alts) for (const i of a.diff) if (!seen.has(i)) seen.add(i);
    varying.push(...seen);
    varying.sort((x, y) => x - y);
  }

  /** 可触达单元（除锚点外的全部格），升序 */
  const reachable: number[] = [];
  for (let i = 0; i < N; i++) if (i !== anchorIndex) reachable.push(i);

  /** 未被选中点击中的替代矩阵位掩码（替代矩阵数 ≤ 枚举预算，用 bigint 稳妥） */
  const fullMask = (1n << BigInt(alts.length)) - 1n;
  const uncoveredOf = (chosen: Set<number>): bigint => {
    let m = fullMask;
    for (const i of chosen) m &= ~hitsOf(i);
    return m;
  };
  const firstUncovered = (mask: bigint): number => {
    if (mask === 0n) return -1;
    for (let j = 0; j < alts.length; j++) if (mask & (1n << BigInt(j))) return j;
    return -1;
  };

  /**
   * 是否能用至多 rem 个下标 ≥ minIdx 的差异点击中 mask 中的全部替代矩阵。
   * 后缀点下标须严格递增：候选取“击中任一未覆盖集且下标 ≥ minIdx”的全部单元
   * （不能只取首个未覆盖集的差异点——较小点可能先击中别的集合，如方案
   * [3,10] 中 3 并不击中首个集合，但必须排在 10 之前）。
   */
  const feasibleCache = new Map<string, boolean>();
  const canCover = (mask: bigint, rem: number, minIdx: number): boolean => {
    if (mask === 0n) return true;
    if (rem === 0) return false;
    const key = mask.toString(36) + ':' + rem + ':' + minIdx;
    const cached = feasibleCache.get(key);
    if (cached !== undefined) return cached;

    // 快速下界：贪心选取两两不相交的差异集（打包），每个都需不同点来击中，
    // 打包数 > 名额 → 不可能
    let disjoint = 0;
    let rest = mask;
    while (rest) {
      const j = firstUncovered(rest);
      disjoint++;
      const d = new Set(alts[j].diff);
      for (let t = 0; t < alts.length; t++) {
        if (rest & (1n << BigInt(t)) && alts[t].diff.some((i) => d.has(i))) {
          rest &= ~(1n << BigInt(t));
        }
      }
    }
    if (disjoint > rem) {
      feasibleCache.set(key, false);
      return false;
    }

    // 击中至少一个未覆盖集合、下标 ≥ minIdx 的全部候选单元（升序）
    let candBits = 0n;
    for (let t = 0; t < alts.length; t++) {
      if (mask & (1n << BigInt(t))) {
        for (const i of alts[t].diff) if (i >= minIdx) candBits |= 1n << BigInt(i);
      }
    }

    let out = false;
    for (let idx = minIdx; idx < N; idx++) {
      if (!(candBits & (1n << BigInt(idx)))) continue;
      if (canCover(mask & ~hitsOf(idx), rem - 1, idx + 1)) {
        out = true;
        break;
      }
    }
    feasibleCache.set(key, out);
    return out;
  };

  /** 剩余可作填充（含非差异点）的可触达单元是否够数 */
  const enoughFillers = (chosen: number[], rem: number, minIdx: number): boolean => {
    let avail = 0;
    for (const i of reachable) {
      if (i >= minIdx && !chosen.includes(i)) avail++;
    }
    return avail >= rem;
  };

  /**
   * 逐位置构造恰好 k 个点的字典序最小有效集合：
   * 每个位置从小到大试探单元，仅当剩余名额仍可覆盖全部替代矩阵、
   * 且有足够填充点时才提交。
   */
  const lexicographicallySmallestPlan = (k: number): number[] | null => {
    const chosen: number[] = [];
    let mask = fullMask;
    let prev = -1;
    while (chosen.length < k) {
      const rem = k - chosen.length;
      let advanced = false;
      for (let n = 0; n < reachable.length; n++) {
        const idx = reachable[n];
        if (idx <= prev) continue;
        const nm = mask & ~hitsOf(idx);
        const rest = rem - 1;
        if (
          enoughFillers([...chosen, idx], rest, idx + 1) &&
          canCover(nm, rest, idx + 1)
        ) {
          chosen.push(idx);
          mask = nm;
          prev = idx;
          advanced = true;
          break;
        }
      }
      if (!advanced) return null;
    }
    return mask === 0n ? chosen : null;
  };

  const makePoints = (selected: number[]): ProbePoint[] =>
    selected.map((s) => {
      // 移除 s 后，首个差异集与剩余选点不相交的替代矩阵重新出现
      const rest = new Set(selected.filter((x) => x !== s));
      let reappearAlt: DiffAlt | null = null;
      for (const a of alts) {
        if (!a.diff.some((i) => rest.has(i))) {
          reappearAlt = a;
          break;
        }
      }
      return {
        index: s,
        row: Math.floor(s / cols),
        col: s % cols,
        expectedCycles: primary[s],
        redundant: reappearAlt === null,
        reappear: reappearAlt ? toWitness(reappearAlt, cols) : null,
      };
    });

  // 测点数下限为 MIN_PROBES，依次向上完整比较
  const upperK = Math.min(MAX_PROBES, reachable.length);
  for (let k = MIN_PROBES; k <= upperK; k++) {
    const got = lexicographicallySmallestPlan(k);
    if (got) {
      return { status: 'ready', alternativeCount: alts.length, points: makePoints(got) };
    }
  }

  /* ---- 上限内无法全部分辨：求覆盖替代矩阵数最多的努力计划 ---- */

  // 目标测点数：尽量凑满 MAX_PROBES（差异点不足时用最小可触达格填充）
  const coreK = Math.min(MAX_PROBES, varying.length);
  let bestSelected: number[] = varying.slice(0, coreK);
  let bestCovered = -1;
  let nodes = 0;

  const coverageOf = (sel: Set<number>): number => {
    let n = 0;
    for (const a of alts) if (a.diff.some((i) => sel.has(i))) n++;
    return n;
  };

  const chosen: number[] = [];
  const inChosen = new Set<number>();
  const maximize = (start: number): void => {
    const covered = coverageOf(inChosen);
    const remaining = coreK - chosen.length;
    const uncoveredCount = alts.length - covered;
    // 乐观上界：剩余名额每点最多新覆盖一个“当前未覆盖”的替代矩阵组
    if (covered + Math.min(remaining, uncoveredCount) < bestCovered) return;
    if (chosen.length === coreK) {
      // 仅在满深度（coreK 个差异点）叶子上比较，避免短序列误入
      if (
        covered > bestCovered ||
        (covered === bestCovered && lexSeq(chosen, bestSelected) < 0)
      ) {
        bestCovered = covered;
        bestSelected = chosen.slice();
      }
      return;
    }
    if (++nodes > SEARCH_NODE_BUDGET) return; // 预算耗尽：停止扩展，保留已找到的满深度最优
    // 候选：击中任一未覆盖集合且下标 ≥ start 的全部单元（升序），
    // 保证按字典序完整搜索，而非只沿首个未覆盖集的差异点贪心。
    let candBits = 0n;
    for (let t = 0; t < alts.length; t++) {
      if (uncoveredOf(inChosen) & (1n << BigInt(t))) {
        for (const i of alts[t].diff) if (i >= start) candBits |= 1n << BigInt(i);
      }
    }
    for (let idx = start; idx < N; idx++) {
      if (!(candBits & (1n << BigInt(idx)))) continue;
      chosen.push(idx);
      inChosen.add(idx);
      maximize(idx + 1);
      inChosen.delete(idx);
      chosen.pop();
      if (nodes > SEARCH_NODE_BUDGET) break;
    }
  };
  maximize(0);

  // 用行优先最小的可触达格补足到 MIN_PROBES（不改变覆盖数）
  const filled = bestSelected.slice();
  for (const idx of reachable) {
    if (filled.length >= MIN_PROBES) break;
    if (!filled.includes(idx)) filled.push(idx);
  }
  filled.sort((a, b) => a - b);

  const selectedSet = new Set(filled);
  let firstIdx = 0;
  for (let j = 0; j < alts.length; j++) {
    if (!alts[j].diff.some((i) => selectedSet.has(i))) {
      firstIdx = j;
      break;
    }
  }
  return {
    status: 'impossible',
    alternativeCount: alts.length,
    points: makePoints(filled),
    firstUndistinguished: toWitness(alts[firstIdx], cols),
  };
}

/** 等长坐标序列字典序比较：-1 / 0 / 1 */
function lexSeq(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
