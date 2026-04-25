import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AIHistoryEntry, AIRunResponse } from '../api/types'
import type { ChartHandle } from './Chart'

type Props = {
  sessionId: string
  /** 'review' / 'decision'。未指定なら backend が Trade 状態から自動判定 */
  mode?: 'decision' | 'review'
  /**
   * §11.3.1 各 TF のチャートハンドル。実行時にスクリーンショットを取って送信する。
   * 表示中の TF のみを Map で渡す想定。null なら画像なしで実行。
   */
  chartHandles?: Map<string, ChartHandle | null> | null
}

/**
 * §11 AI 分析パネル(MVP)。
 * - 履歴一覧から過去レポートを開く
 * - 「実行」で API 呼び出し(キャッシュヒットすれば既存を返す)
 * - レポートはプレーンテキストの Markdown を等幅表示で出す(リッチレンダリングは後続)
 */
export function AiAnalysisPanel({ sessionId, mode, chartHandles }: Props) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<AIHistoryEntry[]>([])
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [report, setReport] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRunCached, setLastRunCached] = useState<boolean | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.ai.history(sessionId)
      setHistory(list)
      if (list.length > 0 && activeEntryId === null) {
        setActiveEntryId(list[0].id)
        const md = await api.ai.report(sessionId, list[0].id)
        setReport(md)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '履歴取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [sessionId, activeEntryId])

  useEffect(() => {
    if (open) void loadHistory()
  }, [open, loadHistory])

  async function selectEntry(entryId: string) {
    setActiveEntryId(entryId)
    try {
      const md = await api.ai.report(sessionId, entryId)
      setReport(md)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'レポート取得に失敗しました')
    }
  }

  function collectImages(): { timeframe: string; data_url: string }[] {
    if (!chartHandles) return []
    const images: { timeframe: string; data_url: string }[] = []
    chartHandles.forEach((handle, tf) => {
      if (!handle) return
      const dataUrl = handle.takeScreenshot()
      if (dataUrl) images.push({ timeframe: tf, data_url: dataUrl })
    })
    return images
  }

  async function handleRun() {
    setRunning(true)
    setError(null)
    setLastRunCached(null)
    try {
      const images = collectImages()
      const res: AIRunResponse = await api.ai.run(sessionId, mode, images)
      setActiveEntryId(res.entry.id)
      setReport(res.report_md)
      setLastRunCached(res.cached)
      const list = await api.ai.history(sessionId)
      setHistory(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '実行に失敗しました')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="ai-panel">
      <button className="ai-toggle" type="button" onClick={() => setOpen(v => !v)}>
        AI 分析(§11) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="ai-body">
          <div className="ai-actions">
            <button
              type="button"
              className="ai-run-btn"
              disabled={running}
              onClick={() => void handleRun()}
            >
              {running ? '実行中...' : '実行'}
            </button>
            {lastRunCached !== null && (
              <span className="ai-cache-hint">
                {lastRunCached ? '(同一 payload のキャッシュを表示)' : '(新規実行で保存しました)'}
              </span>
            )}
          </div>

          {error && <div className="ai-error">{error}</div>}

          {history.length > 0 && (
            <div className="ai-history">
              <div className="ai-history-label">履歴</div>
              <ul>
                {history.map(h => (
                  <li
                    key={h.id}
                    className={h.id === activeEntryId ? 'active' : ''}
                    onClick={() => void selectEntry(h.id)}
                  >
                    <span className="ai-history-time">{new Date(h.created_at).toLocaleString('ja-JP')}</span>
                    <span className="ai-history-model">{h.model}</span>
                    {h.input_tokens != null && (
                      <span className="ai-history-tokens">{h.input_tokens}/{h.output_tokens}t</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="ai-report">
            {loading && <p className="hint">読み込み中...</p>}
            {!loading && history.length === 0 && (
              <p className="hint">まだ AI 分析を実行していません。「実行」を押してください。</p>
            )}
            {report && <pre className="ai-report-body">{report}</pre>}
          </div>
        </div>
      )}
    </div>
  )
}
