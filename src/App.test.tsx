// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import App, { ProbePlanPanel } from './App';
import type { ProbePlan } from './solver/probe';
import type { RawInputs } from './solver/solver';

const make = (over: Partial<RawInputs> = {}): RawInputs => ({
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

const cellInput = (r: number, c: number) =>
  screen.getByLabelText(`第 ${r} 行第 ${c} 列读数`) as HTMLInputElement;

describe('App 主界面', () => {
  it('合法输入立即展示两项目标值、展开矩阵与逐格圈数', () => {
    render(<App initial={make()} />);
    expect(screen.getByText('目标一 · 二阶差分绝对值之和')).toBeTruthy();
    expect(screen.getByText('目标二 · 相邻差绝对值之和')).toBeTruthy();
    // 读数 [0,1,2,3], P=4, 圈数全 0 → 真值即读数
    expect(screen.getByText('展开矩阵（真实相位 Φ）与逐格圈数')).toBeTruthy();
    expect(screen.getAllByText('k = 0').length).toBe(4);
  });

  it('两项目标并列时展示第二小字典序见证', () => {
    // 搜索得到的 2x2 并列实例：o2=0, o1=8，[0,0,0,0] 与 [0,0,1,0] 同分
    render(
      <App
        initial={make({
          cells: ['3', '2', '1', '4'],
          period: '5',
          cycleMin: '0',
          cycleMax: '1',
          jumpCap: '1',
        })}
      />,
    );
    expect(screen.getByText('第二小字典序见证')).toBeTruthy();
    const values = screen.getAllByText('8');
    expect(values.length).toBeGreaterThan(0);
  });

  it('非零二阶差分项的并列实例同样展示见证', () => {
    // 3x2, P=6：o2=2, o1=14
    render(
      <App
        initial={make({
          rows: 3,
          cols: 2,
          cells: ['8', '4', '8', '0', '8', '4'],
          period: '6',
          cycleMin: '0',
          cycleMax: '1',
          jumpCap: '1',
        })}
      />,
    );
    expect(screen.getByText('第二小字典序见证')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('唯一最优时不展示见证', () => {
    render(<App initial={make()} />);
    expect(screen.queryByText('第二小字典序见证')).toBeNull();
    expect(screen.getByText(/两项目标最优值下圈数序列唯一/)).toBeTruthy();
  });

  it('唯一最优时补测规划明确无需补测', () => {
    render(<App initial={make()} />);
    expect(screen.getByText('补测规划')).toBeTruthy();
    expect(screen.getByText(/不存在同分替代圈数矩阵，结论已唯一，无需安排补测/)).toBeTruthy();
    expect(screen.queryByText('补测规划（下一轮人工测量）')).toBeNull();
  });

  it('并列时给出补测计划：测点、预期圈数与移除后重现的见证', () => {
    render(
      <App
        initial={make({
          cells: ['3', '2', '1', '4'],
          period: '5',
          cycleMin: '0',
          cycleMax: '1',
          jumpCap: '1',
        })}
      />,
    );
    expect(screen.getByText('补测规划（下一轮人工测量）')).toBeTruthy();
    // 计划为测点（1,2）冗余点 +（2,1）核心点
    const points = screen.getAllByText(/^测点/);
    expect(points.length).toBe(2);
    expect(screen.getByText('测点 （1, 2）')).toBeTruthy();
    expect(screen.getByText('测点 （2, 1）')).toBeTruthy();
    expect(screen.getAllByText('预期圈数 k = 0').length).toBe(2);
    expect(screen.getByText(/冗余点：移除后其余测点仍能区分全部替代见证/)).toBeTruthy();
    // 移除核心点（2,1）后唯一替代见证 [0,0,1,0] 重现，差异单元（2,1）
    expect(screen.getAllByText(/移除后重现替代见证/).length).toBe(1);
    expect(screen.getByText(/差异单元 （2, 1）/)).toBeTruthy();
    // 主矩阵上两个测点被标记（紫框）
    expect(document.querySelectorAll('.mv-probe').length).toBe(2);
  });

  it('输入变化立即撤下旧补测计划', () => {
    render(
      <App
        initial={make({
          cells: ['3', '2', '1', '4'],
          period: '5',
          cycleMin: '0',
          cycleMax: '1',
          jumpCap: '1',
        })}
      />,
    );
    expect(screen.getByText('补测规划（下一轮人工测量）')).toBeTruthy();
    fireEvent.change(cellInput(1, 1), { target: { value: '' } });
    expect(screen.queryByText('补测规划（下一轮人工测量）')).toBeNull();
    expect(screen.queryByText('补测规划')).toBeNull();
  });

  it('非法参数与非法单元给出定位反馈', () => {
    render(
      <App
        initial={make({
          period: 'x',
          cells: ['0', 'bad', '2', '-'],
        })}
      />,
    );
    expect(screen.getByText('输入非法，已停止求解')).toBeTruthy();
    expect(screen.getByText(/参数「周期」：周期须为整数/)).toBeTruthy();
    expect(screen.getByText(/单元（1, 2）/)).toBeTruthy();
    expect(screen.getByText(/单元（2, 2）/)).toBeTruthy();
    // 不出结果
    expect(screen.queryByText('目标一 · 二阶差分绝对值之和')).toBeNull();
  });

  it('锚点圈数越出区间给出字段错误', () => {
    render(<App initial={make({ anchorCycles: '9' })} />);
    expect(screen.getByText(/锚点圈数须落在区间/)).toBeTruthy();
  });

  it('无解时定位冲突相邻边', () => {
    render(
      <App
        initial={make({
          cells: ['0', '9', '0', '0'],
          period: '10',
          cycleMin: '0',
          cycleMax: '0',
          jumpCap: '0',
          anchorCycles: '0',
        })}
      />,
    );
    expect(screen.getByText('无解')).toBeTruthy();
    expect(screen.getByText(/（1, 1）—（1, 2）/)).toBeTruthy();
  });

  it('组合无解时定位首个失败格', () => {
    render(
      <App
        initial={make({
          rows: 2,
          cols: 3,
          cells: ['0', '-15', '-30', '0', '-15', '-30'],
          period: '10',
          cycleMin: '0',
          cycleMax: '1',
          jumpCap: '1',
        })}
      />,
    );
    expect(screen.getByText('无解')).toBeTruthy();
    expect(screen.getByText(/首个无法与已有格同时相容的位置/)).toBeTruthy();
  });

  it('输入变化立即撤下旧结果：见证 → 非法后不再残留', () => {
    render(
      <App
        initial={make({
          cells: ['3', '2', '1', '4'],
          period: '5',
          cycleMin: '0',
          cycleMax: '1',
          jumpCap: '1',
        })}
      />,
    );
    expect(screen.getByText('第二小字典序见证')).toBeTruthy();

    fireEvent.change(cellInput(1, 1), { target: { value: '' } });
    expect(screen.getByText('输入非法，已停止求解')).toBeTruthy();
    expect(screen.queryByText('第二小字典序见证')).toBeNull();
  });

  it('行列数可选范围为 2..24 行、2..4 列', () => {
    render(<App initial={make()} />);
    const combos = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const rowSelect = combos[0];
    const colSelect = combos[1];
    expect(within(rowSelect).getByRole('option', { name: '24' })).toBeTruthy();
    expect(within(rowSelect).queryByRole('option', { name: '25' })).toBeNull();
    expect(within(colSelect).getByRole('option', { name: '4' })).toBeTruthy();
    expect(within(colSelect).queryByRole('option', { name: '5' })).toBeNull();
  });

  it('导入文本重建矩阵并定位非法单元', () => {
    render(<App initial={make()} />);
    const area = screen.getByPlaceholderText(/例如：/) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '7, 8\n9, 10' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并重建矩阵' }));
    expect(cellInput(1, 1).value).toBe('7');
    expect(cellInput(2, 2).value).toBe('10');

    fireEvent.change(area, { target: { value: '1, x\n3, 4' } });
    fireEvent.click(screen.getByRole('button', { name: '导入并重建矩阵' }));
    expect(screen.getByText(/第 1 行第 2 列/)).toBeTruthy();
  });

  it('点击非法定位链接可聚焦对应单元', () => {
    render(<App initial={make({ cells: ['0', 'x', '0', '0'] })} />);
    const link = screen.getByRole('button', { name: /单元（1, 2）/ });
    fireEvent.click(link);
    const input = cellInput(1, 2);
    expect(document.activeElement).toBe(input);
  });

  it('切换锚点后裁决随之改变', () => {
    render(
      <App
        initial={make({
          cells: ['0', '0', '0', '0'],
          period: '10',
          cycleMin: '-1',
          cycleMax: '1',
          jumpCap: '1',
        })}
      />,
    );
    // 锚点默认在左上 (1,1)；右下 (2,2) 是非锚点格中的第 3 个“设锚”
    fireEvent.click(screen.getAllByRole('button', { name: '设锚' })[2]);
    const fields = screen.getAllByText('锚点真实圈数');
    expect(fields.length).toBeGreaterThan(0);
    const kInput = (fields[0].closest('label') as HTMLLabelElement)
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(kInput, { target: { value: '1' } });
    // 锚点格真值 = 0 + 1*10 = 10，矩阵中应出现 10
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
  });
});

describe('ProbePlanPanel 补测面板', () => {
  it('unique：文案明确无需补测', () => {
    render(<ProbePlanPanel plan={{ status: 'unique' }} cols={2} />);
    expect(screen.getByText(/不存在同分替代圈数矩阵，结论已唯一/)).toBeTruthy();
  });

  it('too-many：说明枚举未穷尽且不给计划', () => {
    const plan: ProbePlan = {
      status: 'too-many',
      alternativeCount: 200,
      budget: 200,
    };
    const { container } = render(<ProbePlanPanel plan={plan} cols={4} />);
    expect(container.textContent).toContain('同分替代圈数矩阵已枚举到 200 个仍未穷尽');
    expect(screen.queryAllByText(/^测点/).length).toBe(0);
  });

  it('impossible：展示努力计划与首个未分辨矩阵及差异单元', () => {
    const plan: ProbePlan = {
      status: 'impossible',
      alternativeCount: 11,
      points: [
        {
          index: 0,
          row: 0,
          col: 0,
          expectedCycles: 0,
          redundant: false,
          reappear: {
            cycles: [1, 0, 0, 0],
            diffCells: [{ index: 0, row: 0, col: 0 }],
          },
        },
      ],
      firstUndistinguished: {
        cycles: [0, 1, 0, 0],
        diffCells: [{ index: 1, row: 0, col: 1 }],
      },
    };
    render(<ProbePlanPanel plan={plan} cols={2} />);
    expect(screen.getByText(/仍不能区分全部替代矩阵/)).toBeTruthy();
    expect(screen.getByText(/首个未被区分的圈数矩阵为/)).toBeTruthy();
    expect(screen.getByText(/与主见证的差异单元：/)).toBeTruthy();
    expect(screen.getByText('测点 （1, 1）')).toBeTruthy();
  });
});
