import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts'
import type { OhlcBar } from '../api/client'

type Props = {
  bars: OhlcBar[]
}

function toCandle(bar: OhlcBar): CandlestickData {
  return { time: bar.t as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c }
}

export function Chart({ bars }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { timeVisible: true, secondsVisible: false },
    })
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current || bars.length === 0) return
    seriesRef.current.setData(bars.map(toCandle))
    chartRef.current?.timeScale().scrollToRealTime()
  }, [bars])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
