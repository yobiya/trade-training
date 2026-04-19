import { INDICATORS, defaultIndicatorConfig } from '../indicators/registry'
import type { IndicatorConfig, IndicatorType } from '../indicators/types'

type Props = {
  active: IndicatorConfig[]
  onChange: (next: IndicatorConfig[]) => void
}

const ORDER: IndicatorType[] = ['SMA', 'EMA', 'RSI']

export function IndicatorPanel({ active, onChange }: Props) {
  const isActive = (type: IndicatorType) => active.some(a => a.type === type)

  function toggle(type: IndicatorType) {
    if (isActive(type)) {
      onChange(active.filter(a => a.type !== type))
    } else {
      onChange([...active, defaultIndicatorConfig(type)])
    }
  }

  return (
    <div className="indicator-panel">
      <div className="indicator-label">インジケーター</div>
      <div className="indicator-chips">
        {ORDER.map(type => {
          const spec = INDICATORS[type]
          const on = isActive(type)
          return (
            <button
              key={type}
              type="button"
              className={`chip ${on ? 'active' : ''}`}
              onClick={() => toggle(type)}
              title={`${spec.label}(${spec.defaultParams.period})`}
            >
              {spec.label} {spec.defaultParams.period}
            </button>
          )
        })}
      </div>
    </div>
  )
}
