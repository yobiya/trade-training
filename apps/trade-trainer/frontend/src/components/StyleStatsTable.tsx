import type { StyleStatsRow } from '../api/client'

type Props = {
  rows: StyleStatsRow[]
}

/** スタイル別成績テーブル(仕様書 §10.3)。 */
export function StyleStatsTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="style-stats-empty">
        スタイル別成績はまだありません。エントリー時にスタイルを選択すると集計されます。
      </div>
    )
  }

  return (
    <table className="style-stats-table">
      <thead>
        <tr>
          <th>スタイル</th>
          <th className="num">件数</th>
          <th className="num">勝率</th>
          <th className="num">合計 pips</th>
          <th className="num">平均 pips</th>
          <th className="num">PF</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const winPct = (r.win_rate * 100).toFixed(1)
          const pipsClass = r.total_pips >= 0 ? 'profit' : 'loss'
          const avgClass = r.avg_pips_per_trade >= 0 ? 'profit' : 'loss'
          return (
            <tr key={r.style_id ?? 'none'}>
              <td>
                <span className="style-stats-name">{r.style_name}</span>
                {r.primary_timeframe && <span className="style-stats-tf">({r.primary_timeframe})</span>}
              </td>
              <td className="num">{r.total_trades}</td>
              <td className="num">{winPct}%</td>
              <td className={`num ${pipsClass}`}>{r.total_pips > 0 ? '+' : ''}{r.total_pips}</td>
              <td className={`num ${avgClass}`}>{r.avg_pips_per_trade > 0 ? '+' : ''}{r.avg_pips_per_trade}</td>
              <td className="num">{r.profit_factor}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
