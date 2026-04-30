import { INDICATORS, defaultIndicatorConfig } from '../indicators/registry'
import type { IndicatorConfig, IndicatorType } from '../indicators/types'

type Props = {
  active: IndicatorConfig[]
  /** §5.2.1: フォーカス TF のインジケーターのみをパネルに表示し、トグル ON はその TF にスコープして追加 */
  focusedTf: string
  onChange: (next: IndicatorConfig[]) => void
}

const ORDER: IndicatorType[] = ['SMA', 'EMA20', 'EMA200', 'RSI']

export function IndicatorPanel({ active, focusedTf, onChange }: Props) {
  const isActive = (type: IndicatorType) =>
    active.some(a => a.type === type && a.timeframe === focusedTf)

  function toggle(type: IndicatorType) {
    if (isActive(type)) {
      onChange(active.filter(a => !(a.type === type && a.timeframe === focusedTf)))
    } else {
      onChange([...active, defaultIndicatorConfig(type, focusedTf)])
    }
  }

  return (
    <div className="indicator-panel">
      <div className="indicator-label">インジケーター [{focusedTf}]</div>
      <div className="indicator-chips">
        {ORDER.map(type => {
          const spec = INDICATORS[type]
          // HMR でレジストリと ORDER の整合が一時的に崩れる/古い state が残るケースに備えた安全ネット
          if (!spec) return null
          const on = isActive(type)
          return (
            <button
              key={type}
              type="button"
              className={`chip ${on ? 'active' : ''}`}
              onClick={() => toggle(type)}
              title={`${spec.label}(${spec.defaultParams.period}) - ${focusedTf}`}
            >
              {spec.label} {spec.defaultParams.period}
            </button>
          )
        })}
      </div>
    </div>
  )
}
