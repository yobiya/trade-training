import { INDICATORS, defaultIndicatorConfig } from '../indicators/registry'
import type { IndicatorConfig, IndicatorType } from '../indicators/types'

type Props = {
  active: IndicatorConfig[]
  onChange: (next: IndicatorConfig[]) => void
}

const ORDER: IndicatorType[] = ['SMA', 'EMA20', 'EMA200', 'RSI']

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
          // HMR でレジストリと ORDER の整合が一時的に崩れる/古い state が残るケースに備えた安全ネット
          if (!spec) return null
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
