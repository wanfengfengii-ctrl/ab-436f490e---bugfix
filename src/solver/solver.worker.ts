import { evaluate, type RawInputs } from './solver';

/**
 * 裁决 Worker：主线程把最新输入投递过来，后台完成 DP 后回传。
 * 每次输入变化都会由主线程 terminate 旧 Worker，因此不会有过期结果回灌。
 */

interface RequestMsg {
  token: number;
  raw: RawInputs;
}

interface ResponseMsg {
  token: number;
  result: ReturnType<typeof evaluate>;
}

// 不引入 webworker lib（与 DOM lib 全局声明冲突），按最小结构使用
const ctx = globalThis as unknown as {
  onmessage: ((e: MessageEvent<RequestMsg>) => void) | null;
  postMessage(msg: ResponseMsg): void;
};

ctx.onmessage = (e) => {
  const { token, raw } = e.data;
  ctx.postMessage({ token, result: evaluate(raw) });
};

export {};
