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

type ComparePair = { left: string | null; right: string | null }

/**
 * §11 AI 分析パネル(MVP)。
 * - 履歴一覧から過去レポートを開く
 * - 「実行」で API 呼び出し(キャッシュヒットすれば既存を返す)
 * - 「比較」モードで履歴から 2 エントリを左右枠に割り当てて並列表示(§11.4)
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

  // §11.4 差分比較
  const [compareMode, setCompareMode] = useState(false)
  const [comparePair, setComparePair] = useState<ComparePair>({ left: null, right: null })
  const [reportLeft, setReportLeft] = useState<string>('')
  const [reportRight, setReportRight] = useState<string>('')

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

  /**
   * 比較モード時: 行クリックで「左→右→未割当」のサイクルでアサインする。
   * 既に左/右に同 id があれば外す。
   */
  async function assignToCompare(entryId: string) {
    let next: ComparePair
    if (comparePair.left === entryId) {
      next = { left: null, right: comparePair.right }
    } else if (comparePair.right === entryId) {
      next = { left: comparePair.left, right: null }
    } else if (comparePair.left === null) {
      next = { left: entryId, right: comparePair.right }
    } else if (comparePair.right === null) {
      next = { left: comparePair.left, right: entryId }
    } else {
      // 両方埋まっている → 右をシフトして新エントリを右に
      next = { left: comparePair.right, right: entryId }
    }
    setComparePair(next)

    try {
      const [leftMd, rightMd] = await Promise.all([
        next.left ? api.ai.report(sessionId, next.left) : Promise.resolve(''),
        next.right ? api.ai.report(sessionId, next.right) : Promise.resolve(''),
      ])
      setReportLeft(leftMd)
      setReportRight(rightMd)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'レポート取得に失敗しました')
    }
  }

  function toggleCompareMode() {
    if (compareMode) {
      // 比較モード終了 → クリア
      setCompareMode(false)
      setComparePair({ left: null, right: null })
      setReportLeft('')
      setReportRight('')
    } else {
      setCompareMode(true)
    }
  }

  function compareLabel(entryId: string): string | null {
    if (comparePair.left === entryId) return 'L'
    if (comparePair.right === entryId) return 'R'
    return null
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

  function entryMeta(id: string | null): AIHistoryEntry | null {
    if (id === null) return null
    return history.find(h => h.id === id) ?? null
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
              disabled={running || compareMode}
              onClick={() => void handleRun()}
            >
              {running ? '実行中...' : '実行'}
            </button>
            <button
              type="button"
              className={`ai-compare-btn ${compareMode ? 'active' : ''}`}
              onClick={toggleCompareMode}
              disabled={history.length < 2}
              title={history.length < 2 ? '履歴が 2 件以上で利用可能' : '比較モード切替'}
            >
              {compareMode ? '比較を終了' : '比較'}
            </button>
            {lastRunCached !== null && !compareMode && (
              <span className="ai-cache-hint">
                {lastRunCached ? '(同一 payload のキャッシュを表示)' : '(新規実行で保存しました)'}
              </span>
            )}
            {compareMode && (
              <span className="ai-cache-hint">
                履歴をクリックして L / R に割当(L: {comparePair.left ? '済' : '未'} / R: {comparePair.right ? '済' : '未'})
              </span>
            )}
          </div>

          {error && <div className="ai-error">{error}</div>}

          {history.length > 0 && (
            <div className="ai-history">
              <div className="ai-history-label">履歴</div>
              <ul>
                {history.map(h => {
                  const isActive = !compareMode && h.id === activeEntryId
                  const cmpLabel = compareMode ? compareLabel(h.id) : null
                  return (
                    <li
                      key={h.id}
                      className={`${isActive ? 'active' : ''} ${cmpLabel ? `compare-${cmpLabel.toLowerCase()}` : ''}`}
                      onClick={() => {
                        if (compareMode) void assignToCompare(h.id)
                        else void selectEntry(h.id)
                      }}
                    >
                      {cmpLabel && <span className="ai-history-cmp">{cmpLabel}</span>}
                      <span className="ai-history-time">{new Date(h.created_at).toLocaleString('ja-JP')}</span>
                      <span className="ai-history-model">{h.model}</span>
                      {h.input_tokens != null && (
                        <span className="ai-history-tokens">{h.input_tokens}/{h.output_tokens}t</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="ai-report">
            {loading && <p className="hint">読み込み中...</p>}
            {!loading && history.length === 0 && (
              <p className="hint">まだ AI 分析を実行していません。「実行」を押してください。</p>
            )}
            {!compareMode && report && <pre className="ai-report-body">{report}</pre>}
            {compareMode && (
              <div className="ai-compare-grid">
                <div className="ai-compare-col">
                  <div className="ai-compare-head">
                    L: {entryMeta(comparePair.left)
                      ? new Date(entryMeta(comparePair.left)!.created_at).toLocaleString('ja-JP')
                      : '未割当'}
                  </div>
                  {reportLeft
                    ? <pre className="ai-report-body">{reportLeft}</pre>
                    : <p className="hint">履歴をクリックして左に割当</p>}
                </div>
                <div className="ai-compare-col">
                  <div className="ai-compare-head">
                    R: {entryMeta(comparePair.right)
                      ? new Date(entryMeta(comparePair.right)!.created_at).toLocaleString('ja-JP')
                      : '未割当'}
                  </div>
                  {reportRight
                    ? <pre className="ai-report-body">{reportRight}</pre>
                    : <p className="hint">履歴をクリックして右に割当</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
