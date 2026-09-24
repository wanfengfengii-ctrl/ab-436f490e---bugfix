import { useEffect, useRef, useState } from 'react';
import { evaluate, type Evaluation, type RawInputs } from './solver/solver';

/**
 * 裁决结果 Hook。
 *
 * 输入每次变化：
 *   1. 立即把结果置空（旧结果当场撤下，绝不残留）；
 *   2. 终止仍在计算的旧 Worker，投递新输入；
 *   3. 仅当回传令牌与最新令牌一致时才落定结果。
 *
 * 测试环境（vitest/happy-dom，无 Worker）同步计算，保证断言即时可读。
 */
export function useUnwrap(raw: RawInputs): { evaluation: Evaluation | null } {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const tokenRef = useRef(0);
  const sync = import.meta.env?.MODE === 'test' || typeof Worker === 'undefined';

  useEffect(() => {
    const token = ++tokenRef.current;
    setEvaluation(null);

    if (sync) {
      setEvaluation(evaluate(raw));
      return;
    }

    const worker = new Worker(
      new URL('./solver/solver.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e: MessageEvent<{ token: number; result: Evaluation }>) => {
      if (e.data.token === tokenRef.current) setEvaluation(e.data.result);
    };
    worker.postMessage({ token, raw } satisfies { token: number; raw: RawInputs });

    return () => worker.terminate();
  }, [raw, sync]);

  return { evaluation };
}
