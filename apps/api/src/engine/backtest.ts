import type { BacktestRecord, BacktestSummary } from "../types.js";

function round(value: number): number {
  return Number(value.toFixed(4));
}

function settle(record: BacktestRecord): number {
  return record.result === "win" ? record.stake * record.odds : 0;
}

export function summarizeBacktest(records: BacktestRecord[]): BacktestSummary {
  const totalBets = records.length;
  const wins = records.filter((r) => r.result === "win").length;
  const losses = totalBets - wins;
  const totalStake = records.reduce((sum, r) => sum + r.stake, 0);
  const totalReturn = records.reduce((sum, r) => sum + settle(r), 0);
  const profit = totalReturn - totalStake;

  const avgEdge =
    totalBets === 0
      ? 0
      : records.reduce((sum, r) => sum + (r.modelProbability - 1 / Math.max(r.odds, 1.0001)), 0) / totalBets;

  return {
    totalBets,
    wins,
    losses,
    hitRate: totalBets === 0 ? 0 : round(wins / totalBets),
    totalStake: round(totalStake),
    totalReturn: round(totalReturn),
    profit: round(profit),
    roi: totalStake === 0 ? 0 : round(profit / totalStake),
    avgEdge: round(avgEdge)
  };
}
