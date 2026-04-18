import type { StatsSummary } from '../api/client'

type Props = { stats: StatsSummary | null }

export function StatsBar({ stats }: Props) {
  if (!stats) return null

  const winRatePct = (stats.win_rate * 100).toFixed(1)
  const totalPipsClass = stats.total_pips >= 0 ? 'profit' : 'loss'

  return (
    <div className="stats-bar">
      <span className="stat">
        <span className="stat-label">トレード数</span>
        <span className="stat-value">{stats.total_trades}</span>
      </span>
      <span className="stat">
        <span className="stat-label">勝率</span>
        <span className="stat-value">{winRatePct}%</span>
      </span>
      <span className="stat">
        <span className="stat-label">合計 pips</span>
        <span className={`stat-value ${totalPipsClass}`}>
          {stats.total_pips > 0 ? '+' : ''}{stats.total_pips}
        </span>
      </span>
      <span className="stat">
        <span className="stat-label">平均 pips</span>
        <span className={`stat-value ${stats.avg_pips_per_trade >= 0 ? 'profit' : 'loss'}`}>
          {stats.avg_pips_per_trade > 0 ? '+' : ''}{stats.avg_pips_per_trade}
        </span>
      </span>
      <span className="stat">
        <span className="stat-label">PF</span>
        <span className="stat-value">{stats.profit_factor}</span>
      </span>
    </div>
  )
}
