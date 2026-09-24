import { useState } from 'react';
import {
  parseMatrixText,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  type Evaluation,
  type Issue,
  type RawInputs,
} from './solver/solver';
import type { ProbePlan, ProbePoint, ProbeWitness } from './solver/probe';
import { useUnwrap } from './useUnwrap';

/* ---------------- 默认与示例 ---------------- */

const DEFAULT: RawInputs = {
  rows: 3,
  cols: 3,
  cells: ['0', '3', '6', '5', '0', '3', '2', '5', '0'],
  period: '8',
  cycleMin: '-1',
  cycleMax: '1',
  jumpCap: '1',
  anchorRow: 0,
  anchorCol: 0,
  anchorCycles: '0',
};

const RAMP: RawInputs = {
  rows: 4,
  cols: 4,
  cells: [
    '0', '1', '2', '3',
    '3', '0', '1', '2',
    '2', '3', '0', '1',
    '1', '2', '3', '0',
  ],
  period: '4',
  cycleMin: '0',
  cycleMax: '1',
  jumpCap: '1',
  anchorRow: 0,
  anchorCol: 0,
  anchorCycles: '0',
};

/* ---------------- 小部件 ---------------- */

function NumberField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  hint?: string;
  width?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        className={props.invalid ? 'input input-bad' : 'input'}
        value={props.value}
        inputMode="numeric"
        spellCheck={false}
        onChange={(e) => props.onChange(e.target.value)}
        style={props.width ? { width: props.width } : undefined}
      />
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  );
}

function MatrixView(props: {
  rows: number;
  cols: number;
  values: number[];
  badge: number[];
  mark?: Set<number>;
  probeMark?: Set<number>;
  anchorIndex?: number;
  title: string;
  caption?: string;
}) {
  const { rows, cols } = props;
  return (
    <div className="result-block">
      <h4>{props.title}</h4>
      {props.caption && <p className="caption">{props.caption}</p>}
      <div
        className="matrix-view"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(64px, 1fr))` }}
      >
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols);
          const c = i % cols;
          return (
            <div
              key={i}
              className={
                'mv-cell' +
                (props.mark?.has(i) ? ' mv-mark' : '') +
                (props.probeMark?.has(i) ? ' mv-probe' : '') +
                (props.anchorIndex === i ? ' mv-anchor' : '')
              }
              title={`第 ${r + 1} 行第 ${c + 1} 列`}
            >
              <span className="mv-coord">
                {r + 1},{c + 1}
              </span>
              <span className="mv-value">{props.values[i]}</span>
              <span className="mv-badge">k = {props.badge[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 主组件 ---------------- */

export default function App(props: { initial?: RawInputs }) {
  const [raw, setRaw] = useState<RawInputs>(props.initial ?? DEFAULT);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<{ message: string; row?: number; col?: number } | null>(null);

  const patch = (p: Partial<RawInputs>) => setRaw((s) => ({ ...s, ...p }));

  /* 输入一变：旧结果立即撤下（置空），由 Worker 重新裁决 */
  const { evaluation } = useUnwrap(raw);

  const issues: Issue[] = evaluation?.status === 'invalid' ? evaluation.issues : [];
  const cellIssues = new Map<number, string>();
  const fieldIssues = new Map<string, string>();
  for (const iss of issues) {
    if (iss.kind === 'cell') cellIssues.set(iss.row * raw.cols + iss.col, iss.message);
    if (iss.kind === 'field') fieldIssues.set(iss.field, iss.message);
  }

  const anchorIndex = raw.anchorRow * raw.cols + raw.anchorCol;
  const dimBad = issues.some((i) => i.kind === 'dim');

  const setCell = (i: number, text: string) => {
    const cells = raw.cells.slice();
    cells[i] = text;
    patch({ cells });
  };

  const resize = (rows: number, cols: number) => {
    const cells: string[] = new Array(rows * cols).fill('0');
    for (let r = 0; r < Math.min(rows, raw.rows); r++) {
      for (let c = 0; c < Math.min(cols, raw.cols); c++) {
        cells[r * cols + c] = raw.cells[r * raw.cols + c];
      }
    }
    setRaw((s) => ({
      ...s,
      rows,
      cols,
      cells,
      anchorRow: Math.min(s.anchorRow, rows - 1),
      anchorCol: Math.min(s.anchorCol, cols - 1),
    }));
  };

  const applyImport = () => {
    const parsed = parseMatrixText(importText);
    if (!parsed.ok) {
      setImportError({ message: parsed.error, row: parsed.row, col: parsed.col });
      return;
    }
    setImportError(null);
    patch({
      rows: parsed.rows,
      cols: parsed.cols,
      cells: parsed.values.flat().map(String),
      anchorRow: Math.min(raw.anchorRow, parsed.rows - 1),
      anchorCol: Math.min(raw.anchorCol, parsed.cols - 1),
    });
  };

  const edgeMark = new Set<number>();
  let failCellIndex: number | null = null;
  if (evaluation?.status === 'unsat') {
    for (const e of evaluation.result.edgeFailures) {
      edgeMark.add(e.r1 * raw.cols + e.c1);
      edgeMark.add(e.r2 * raw.cols + e.c2);
    }
    if (evaluation.result.failCell) {
      failCellIndex = evaluation.result.failCell.row * raw.cols + evaluation.result.failCell.col;
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>干涉相位展开台</h1>
        <p>
          每格真实相位 <code>Φ = 读数 + 圈数 × 周期</code>。在锚点、全局圈数区间与相邻跳变上限约束下，
          依次最小化 <strong>横纵连续三格二阶差分绝对值之和</strong>、<strong>相邻差绝对值之和</strong>，
          再取行优先圈数序列字典序最小者。
        </p>
      </header>

      <div className="layout">
        {/* ---------------- 左：输入 ---------------- */}
        <section className="card">
          <h2>① 读数矩阵</h2>
          <div className="row-controls">
            <label className="field">
              <span className="field-label">行数</span>
              <select
                className="input narrow"
                value={raw.rows}
                onChange={(e) => resize(Number(e.target.value), raw.cols)}
              >
                {range(MIN_ROWS, MAX_ROWS).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">列数</span>
              <select
                className="input narrow"
                value={raw.cols}
                onChange={(e) => resize(raw.rows, Number(e.target.value))}
              >
                {range(MIN_COLS, MAX_COLS).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="spacer" />
            <button type="button" className="btn ghost" onClick={() => setRaw(DEFAULT)}>
              载入示例 A
            </button>
            <button type="button" className="btn ghost" onClick={() => setRaw(RAMP)}>
              载入示例 B
            </button>
          </div>

          <div
            className={'grid-inputs' + (dimBad ? ' dim-bad' : '')}
            style={{ gridTemplateColumns: `repeat(${raw.cols}, minmax(76px, 1fr))` }}
          >
            {raw.cells.map((text, i) => {
              const r = Math.floor(i / raw.cols);
              const c = i % raw.cols;
              const isAnchor = raw.anchorRow === r && raw.anchorCol === c;
              const err = cellIssues.get(i);
              const marked =
                evaluation?.status === 'unsat' &&
                (edgeMark.has(i) || failCellIndex === i);
              return (
                <div
                  key={i}
                  className={
                    'cell-wrap' +
                    (isAnchor ? ' is-anchor' : '') +
                    (err || marked ? ' is-bad' : '')
                  }
                >
                  <span className="cell-coord">
                    {r + 1},{c + 1}
                  </span>
                  <input
                    className={'cell-input' + (err ? ' input-bad' : '')}
                    value={text}
                    inputMode="numeric"
                    spellCheck={false}
                    aria-label={`第 ${r + 1} 行第 ${c + 1} 列读数`}
                    onChange={(e) => setCell(i, e.target.value)}
                  />
                  <button
                    type="button"
                    className={'anchor-btn' + (isAnchor ? ' on' : '')}
                    title="把该格设为锚点"
                    onClick={() => patch({ anchorRow: r, anchorCol: c })}
                  >
                    {isAnchor ? '⚓ 锚点' : '设锚'}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hint">
            蓝框为锚点（真实相位由此格指定）；红框为非法单元或无解定位。
          </p>

          <h2>② 参数</h2>
          <div className="params">
            <NumberField
              label="周期 P（正整数）"
              value={raw.period}
              onChange={(v) => patch({ period: v })}
              invalid={fieldIssues.has('period')}
              width="96px"
            />
            <NumberField
              label="圈数下限"
              value={raw.cycleMin}
              onChange={(v) => patch({ cycleMin: v })}
              invalid={fieldIssues.has('cycleMin')}
              width="96px"
            />
            <NumberField
              label="圈数上限"
              value={raw.cycleMax}
              onChange={(v) => patch({ cycleMax: v })}
              invalid={fieldIssues.has('cycleMax')}
              hint="区间至多 3 个整数"
              width="96px"
            />
            <NumberField
              label="相邻跳变上限（圈）"
              value={raw.jumpCap}
              onChange={(v) => patch({ jumpCap: v })}
              invalid={fieldIssues.has('jumpCap')}
              hint="|ΔΦ| ≤ 上限 × P"
              width="96px"
            />
            <label className="field">
              <span className="field-label">锚点行</span>
              <select
                className="input narrow"
                value={raw.anchorRow}
                onChange={(e) => patch({ anchorRow: Number(e.target.value) })}
              >
                {range(0, raw.rows - 1).map((n) => (
                  <option key={n} value={n}>{n + 1}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">锚点列</span>
              <select
                className="input narrow"
                value={raw.anchorCol}
                onChange={(e) => patch({ anchorCol: Number(e.target.value) })}
              >
                {range(0, raw.cols - 1).map((n) => (
                  <option key={n} value={n}>{n + 1}</option>
                ))}
              </select>
            </label>
            <NumberField
              label="锚点真实圈数"
              value={raw.anchorCycles}
              onChange={(v) => patch({ anchorCycles: v })}
              invalid={fieldIssues.has('anchorCycles')}
              hint="须在圈数区间内"
              width="96px"
            />
          </div>

          <h2>③ 导入读数</h2>
          <p className="hint">每行一行，单元间用逗号、空格或制表符分隔；导入后按其行列数重建矩阵。</p>
          <textarea
            className="textarea"
            rows={4}
            placeholder={'例如：\n0, 3, 6\n5, 0, 3\n2, 5, 0'}
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError(null);
            }}
          />
          <div className="row-controls">
            <button type="button" className="btn" onClick={applyImport}>
              导入并重建矩阵
            </button>
            {importError && (
              <span className="err-text">
                {importError.row ? `第 ${importError.row} 行${importError.col ? `第 ${importError.col} 列` : ''}：` : ''}
                {importError.message}
              </span>
            )}
          </div>
        </section>

        {/* ---------------- 右：结果 ---------------- */}
        <section className="card result-card">
          <h2>裁决结果</h2>

          {evaluation === null && (
            <div className="panel panel-pending">
              <h3>正在裁决…</h3>
              <p className="sub">输入已变化，旧结果已撤下，正在按新输入求解。</p>
            </div>
          )}

          {evaluation?.status === 'invalid' && (
            <div className="panel panel-bad">
              <h3>输入非法，已停止求解</h3>
              <ul className="issue-list">
                {issues.map((iss, idx) => {
                  if (iss.kind === 'cell') {
                    return (
                      <li key={idx}>
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => focusCell(iss.row, iss.col)}
                        >
                          单元（{iss.row + 1}, {iss.col + 1}）
                        </button>
                        ：{iss.message}
                      </li>
                    );
                  }
                  if (iss.kind === 'field') {
                    return <li key={idx}>参数「{fieldLabel(iss.field)}」：{iss.message}</li>;
                  }
                  return <li key={idx}>{iss.message}</li>;
                })}
              </ul>
            </div>
          )}

          {evaluation?.status === 'unsat' && (
            <div className="panel panel-bad">
              <h3>无解</h3>
              <p>{evaluation.result.message}</p>
              {evaluation.result.edgeFailures.length > 0 && (
                <>
                  <p className="sub">下列相邻边在任意圈数选择下都无法满足跳变上限（矩阵中红框定位）：</p>
                  <ul className="issue-list">
                    {evaluation.result.edgeFailures.map((e, idx) => (
                      <li key={idx}>
                        （{e.r1 + 1}, {e.c1 + 1}）—（{e.r2 + 1}, {e.c2 + 1}）
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {evaluation.result.failCell && (
                <p className="sub">
                  按行优先传播，首个无法与已有格同时相容的位置：第{' '}
                  <strong>{evaluation.result.failCell.row + 1}</strong> 行第{' '}
                  <strong>{evaluation.result.failCell.col + 1}</strong> 列（红框）。
                </p>
              )}
            </div>
          )}

          {evaluation?.status === 'ok' && (
            <ResultView
              result={evaluation.result}
              probe={evaluation.probe}
              rows={raw.rows}
              cols={raw.cols}
              anchorIndex={anchorIndex}
            />
          )}
        </section>
      </div>

      <footer className="page-footer">
        纯前端实现 · 全部计算在浏览器内完成 · React + TypeScript
      </footer>
    </div>
  );
}

/* ---------------- 补测计划展示 ---------------- */

function coordText(index: number, cols: number): string {
  return `（${Math.floor(index / cols) + 1}, ${(index % cols) + 1}）`;
}

/** 以行优先小矩阵展示圈数序列，差异单元加粗标红 */
function CyclesGrid(props: { cycles: number[]; diff: Set<number>; cols: number }) {
  return (
    <span className="cycle-grid" role="img">
      {props.cycles.map((k, i) => (
        <span
          key={i}
          className={'cycle-cell' + (props.diff.has(i) ? ' cycle-diff' : '')}
          title={`第 ${Math.floor(i / props.cols) + 1} 行第 ${(i % props.cols) + 1} 列`}
        >
          {k}
          {(i + 1) % props.cols === 0 ? ';' : ''}
        </span>
      ))}
    </span>
  );
}

function witnessDiffSet(w: ProbeWitness): Set<number> {
  return new Set(w.diffCells.map((d) => d.index));
}

function ProbePointRow(props: { point: ProbePoint; cols: number }) {
  const { point, cols } = props;
  return (
    <li className="probe-point">
      <span className="probe-coord">测点 {coordText(point.index, cols)}</span>
      <span className="probe-expect">预期圈数 k = {point.expectedCycles}</span>
      {point.redundant ? (
        <span className="probe-note">冗余点：移除后其余测点仍能区分全部替代见证</span>
      ) : (
        <span className="probe-note">
          移除后重现替代见证：
          <CyclesGrid
            cycles={point.reappear!.cycles}
            diff={witnessDiffSet(point.reappear!)}
            cols={cols}
          />
          <span className="probe-diff">
            差异单元{' '}
            {point.reappear!.diffCells.map((d) => coordText(d.index, cols)).join('、')}
          </span>
        </span>
      )}
    </li>
  );
}

export function ProbePlanPanel(props: { plan: ProbePlan; cols: number }) {
  const { plan, cols } = props;

  if (plan.status === 'unique') {
    return (
      <div className="probe-panel probe-unique">
        <h4>补测规划</h4>
        <p className="ok-note">不存在同分替代圈数矩阵，结论已唯一，无需安排补测。</p>
      </div>
    );
  }

  if (plan.status === 'too-many') {
    return (
      <div className="probe-panel probe-bad">
        <h4>补测规划</h4>
        <p>
          同分替代圈数矩阵已枚举到 <strong>{plan.alternativeCount}</strong> 个仍未穷尽
          （枚举预算 {plan.budget}），候选范围过大，无法可靠给出补测集合。请收紧约束或调整输入后再规划。
        </p>
      </div>
    );
  }

  const impossible = plan.status === 'impossible';
  return (
    <div className={'probe-panel' + (impossible ? ' probe-warn' : '')}>
      <h4>补测规划（下一轮人工测量）</h4>
      <p className="caption">
        共 {plan.alternativeCount} 个同分替代圈数矩阵。下列计划在全部能区分这些见证的候选子集中
        {impossible ? '覆盖替代矩阵数最多，且' : '测点数最少、'}按行优先坐标序列字典序最小；
        每点预期测量真值取当前主见证圈数。
      </p>
      <ol className="probe-list">
        {plan.points.map((pt) => (
          <ProbePointRow key={pt.index} point={pt} cols={cols} />
        ))}
      </ol>
      {impossible && (
        <div className="probe-undistinguished">
          <p>
            即使安排 {plan.points.length} 个测点（上限 10 个）仍不能区分全部替代矩阵。
            首个未被区分的圈数矩阵为：
          </p>
          <CyclesGrid
            cycles={plan.firstUndistinguished.cycles}
            diff={witnessDiffSet(plan.firstUndistinguished)}
            cols={cols}
          />
          <p className="probe-diff">
            与主见证的差异单元：
            {plan.firstUndistinguished.diffCells.map((d) => coordText(d.index, cols)).join('、')}
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------- 结果展示 ---------------- */

function ResultView(props: {
  result: Extract<Evaluation, { status: 'ok' }>['result'];
  probe: ProbePlan;
  rows: number;
  cols: number;
  anchorIndex: number;
}) {
  const { result, rows, cols, anchorIndex } = props;
  const { primary, witness } = result;
  const probeIndices =
    props.probe.status === 'ready' || props.probe.status === 'impossible'
      ? new Set(props.probe.points.map((p) => p.index))
      : new Set<number>();
  return (
    <>
      <div className="objectives">
        <div className="obj">
          <span className="obj-name">目标一 · 二阶差分绝对值之和</span>
          <span className="obj-value">{primary.objective2}</span>
        </div>
        <div className="obj">
          <span className="obj-name">目标二 · 相邻差绝对值之和</span>
          <span className="obj-value">{primary.objective1}</span>
        </div>
      </div>

      <MatrixView
        title="展开矩阵（真实相位 Φ）与逐格圈数"
        rows={rows}
        cols={cols}
        values={primary.unwrapped}
        badge={primary.cycles}
        probeMark={probeIndices}
        anchorIndex={anchorIndex}
        caption="格内大字为 Φ = 读数 + k × P，下方徽标为该格裁决圈数 k；紫框为建议补测单元。"
      />

      <ProbePlanPanel plan={props.probe} cols={cols} />

      {witness ? (
        <details className="witness" open>
          <summary>
            两项目标并列：存在字典序更大的同分圈数序列 —— 点击查看第二小字典序见证
          </summary>
          <div className="objectives small">
            <div className="obj">
              <span className="obj-name">二阶和（并列）</span>
              <span className="obj-value">{witness.objective2}</span>
            </div>
            <div className="obj">
              <span className="obj-name">相邻差和（并列）</span>
              <span className="obj-value">{witness.objective1}</span>
            </div>
          </div>
          <MatrixView
            title="第二小字典序见证"
            rows={rows}
            cols={cols}
            values={witness.unwrapped}
            badge={witness.cycles}
            anchorIndex={anchorIndex}
            caption="与主解同样满足全部硬约束且两项目标值相同，但行优先圈数序列字典序严格更大，故不取。"
          />
        </details>
      ) : (
        <p className="ok-note">两项目标最优值下圈数序列唯一，无并列见证。</p>
      )}
    </>
  );
}

/* ---------------- 工具 ---------------- */

function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

function fieldLabel(f: string): string {
  return (
    {
      period: '周期',
      cycleMin: '圈数下限',
      cycleMax: '圈数上限',
      jumpCap: '相邻跳变上限',
      anchorCycles: '锚点圈数',
    } as Record<string, string>
  )[f] ?? f;
}

function focusCell(row: number, col: number) {
  const el = document.querySelector<HTMLInputElement>(
    `input[aria-label="第 ${row + 1} 行第 ${col + 1} 列读数"]`,
  );
  el?.focus();
  el?.select();
}
