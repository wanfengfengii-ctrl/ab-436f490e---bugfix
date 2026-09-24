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
 * 若允许的测点数上限内仍不能区分全部替代矩阵，则凑满允许的测点，
 * 给出覆盖替代矩阵数最多的计划；覆盖数并列时取行优先坐标序列字典序
 * 最小者，并给出首个未被区分的圈数矩阵与其差异单元。
 */

export const MIN_PROBES = 2;
export const MAX_PROBES = 10;
/** 替代矩阵枚举撞上预算时，规划不再可靠（见 solver 中同名预算） */
export const DEFAULT_ALTERNATIVE_BUDGET = 200;
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

  /** 可触达单元（除锚点外的全部格），升序 */
  const reachable: number[] = [];
  for (let i = 0; i < N; i++) if (i !== anchorIndex) reachable.push(i);

  /** 未被选中点击中的替代矩阵位掩码（替代矩阵数 ≤ 枚举预算，用 bigint 稳妥） */
  const fullMask = (1n << BigInt(alts.length)) - 1n;
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

  /* ---- 上限内无法全部分辨：精确求覆盖替代矩阵数最多的努力计划 ---- */

  const planK = upperK;
  const reachCount = reachable.length;
  const popCounts = new Map<bigint, number>();
  const popCount = (mask: bigint): number => {
    const cached = popCounts.get(mask);
    if (cached !== undefined) return cached;
    let n = 0;
    for (let x = mask; x !== 0n; x &= x - 1n) n++;
    popCounts.set(mask, n);
    return n;
  };

  /**
   * 精确判定：从 reachable[pos] 起、至多再选 slotsLeft 个单元时，
   * 已选集合（其命中的补集为 uncovered）最终能否覆盖至少 need 个替代矩阵。
   *
   * 用“覆盖函数单调子模”的贪心序列上界剪枝：取贪心底线 F_t（前 t 步的
   * 边际新增之和）与下一步边际 δ_{t+1}，任何至多 k 个点的集合至多再覆盖
   * F_t + k·δ_{t+1}（取各 t 的最小值）。该上界是对最优值的有效上界，
   * 因此剪枝不会漏掉真正的最大覆盖方案（已对暴力枚举交叉验证）。
   */
  const makeCanReachTarget = (need: number) => {
    const cache = new Map<string, boolean>();

    /**
     * 同一贪心序列同时给出：
     *   - upper：覆盖函数单调子模的有效上界 min_t(F_t + k·δ_{t+1})；
     *   - greedyCovered：贪心底线实际覆盖数（下界）。
     */
    const greedyBounds = (
      uncovered: bigint,
      slots: number,
      pos: number,
    ): { upper: number; greedyCovered: number } => {
      const marginals: number[] = [];
      let rest = uncovered;
      for (let t = 0; t <= slots && rest !== 0n; t++) {
        let bestGain = 0n;
        for (let q = pos; q < reachCount; q++) {
          const gain = hitsOf(reachable[q]) & rest;
          if (popCount(gain) > popCount(bestGain)) bestGain = gain;
        }
        if (bestGain === 0n) break;
        marginals.push(popCount(bestGain));
        rest &= ~bestGain;
      }
      let prefix = 0;
      let upper = Number.POSITIVE_INFINITY;
      let greedyCovered = 0;
      for (let t = 0; t <= marginals.length; t++) {
        const next = t < marginals.length ? marginals[t] : 0;
        upper = Math.min(upper, prefix + slots * next);
        if (t < slots && t < marginals.length) greedyCovered += marginals[t];
        if (t < marginals.length) prefix += marginals[t];
      }
      return { upper, greedyCovered };
    };

    const canReach = (
      uncovered: bigint,
      slots: number,
      pos: number,
    ): boolean => {
      const covered = alts.length - popCount(uncovered);
      if (covered >= need) return true;
      if (slots === 0 || pos >= reachCount) return false;

      const key = uncovered.toString(36) + ':' + slots + ':' + pos;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      // 打包上界：在剩余见证中取一组两两差异集不相交的见证（贪心极大族）。
      // 一个被选单元至多命中其中一个，slots 个点至多覆盖其中 slots 个；
      // 其余（族外）见证即使全部覆盖，覆盖数上界也是 total - packing + slots。
      // 用位掩码计算邻域：某见证差异集的并集命中的全部见证都与它“相交”。
      {
        const minIndex = reachable[pos];
        let rest = uncovered;
        let packing = 0;
        let unreachable = 0;
        while (rest !== 0n) {
          const j = firstUncovered(rest);
          let neighborhood = 0n;
          for (const i of alts[j].diff) {
            if (i >= minIndex) neighborhood |= hitsOf(i);
          }
          if (neighborhood === 0n) {
            // 后缀没有任何差异单元可覆盖它：它必然无法再被区分。
            unreachable++;
            rest &= ~(1n << BigInt(j));
          } else {
            packing++;
            rest &= ~neighborhood;
          }
        }
        const coverable = popCount(uncovered) - unreachable;
        if (covered + (coverable - packing + slots) < need) {
          cache.set(key, false);
          return false;
        }
      }

      const { upper, greedyCovered } = greedyBounds(uncovered, slots, pos);
      if (covered + upper < need) {
        cache.set(key, false);
        return false;
      }
      if (covered + greedyCovered >= need) {
        cache.set(key, true);
        return true;
      }

      const candidates: { q: number; gain: bigint }[] = [];
      for (let q = pos; q < reachCount; q++) {
        const gain = hitsOf(reachable[q]) & uncovered;
        if (gain !== 0n) candidates.push({ q, gain });
      }
      // 先尝试覆盖更多的单元：可行时尽快返回；不可行时仍完整搜索。
      candidates.sort(
        (a, b) =>
          popCount(b.gain) - popCount(a.gain)
          || a.q - b.q,
      );

      for (const { q, gain } of candidates) {
        if (canReach(uncovered & ~gain, slots - 1, q + 1)) {
          cache.set(key, true);
          return true;
        }
      }
      cache.set(key, false);
      return false;
    };

    return canReach;
  };

  // 二分最大可覆盖数；判定是精确的，不能在搜索预算处提前停止而取近似值。
  let low = 0;
  let high = alts.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const canReach = makeCanReachTarget(mid);
    if (canReach(fullMask, planK, 0)) low = mid;
    else high = mid - 1;
  }
  const canReachBest = makeCanReachTarget(low);

  // 逐位置取仍可达到最大覆盖数的最小坐标；无覆盖贡献的单元作为稳定填充点。
  const selected: number[] = [];
  let uncovered = fullMask;
  let nextPos = 0;
  while (selected.length < planK) {
    const slotsAfter = planK - selected.length - 1;
    let advanced = false;
    for (let q = nextPos; q <= reachCount - 1 - slotsAfter; q++) {
      const idx = reachable[q];
      const nextUncovered = uncovered & ~hitsOf(idx);
      if (canReachBest(nextUncovered, slotsAfter, q + 1)) {
        selected.push(idx);
        uncovered = nextUncovered;
        nextPos = q + 1;
        advanced = true;
        break;
      }
    }
    if (!advanced) throw new Error('无法构造最大覆盖补测计划');
  }

  const firstIdx = firstUncovered(uncovered);
  return {
    status: 'impossible',
    alternativeCount: alts.length,
    points: makePoints(selected),
    firstUndistinguished: toWitness(alts[firstIdx], cols),
  };
}
