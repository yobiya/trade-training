import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CreateDrawingRequest, Drawing } from '../api/client'

export type DrawingsApi = {
  drawings: Drawing[]
  reload: () => Promise<void>
  add: (body: CreateDrawingRequest) => Promise<Drawing>
  update: (id: number, patch: { data?: Record<string, unknown>; label?: string | null; visible_on_timeframes?: string[] | null }) => Promise<void>
  remove: (id: number) => Promise<void>
}

/**
 * 統合フロー(§6.1): symbol が指定されたらその銘柄の描画のみを扱う。
 * 銘柄切替で描画セットが切り替わり、create 時には自動で symbol が付与される。
 */
export function useDrawings(sessionId: string, symbol?: string | null): DrawingsApi {
  const [drawings, setDrawings] = useState<Drawing[]>([])

  const reload = useCallback(async () => {
    if (!symbol) {
      setDrawings([])
      return
    }
    const list = await api.drawings.list(sessionId, symbol)
    setDrawings(list)
  }, [sessionId, symbol])

  useEffect(() => { void reload() }, [reload])

  const add = useCallback(async (body: CreateDrawingRequest) => {
    const payload: CreateDrawingRequest = symbol ? { ...body, symbol } : body
    const d = await api.drawings.create(sessionId, payload)
    setDrawings(prev => [...prev, d])
    return d
  }, [sessionId, symbol])

  const update = useCallback(async (
    id: number,
    patch: { data?: Record<string, unknown>; label?: string | null; visible_on_timeframes?: string[] | null },
  ) => {
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, ...patch, data: patch.data ? { ...d.data, ...patch.data } : d.data } : d))
    const updated = await api.drawings.update(sessionId, id, patch)
    setDrawings(prev => prev.map(d => d.id === id ? updated : d))
  }, [sessionId])

  const remove = useCallback(async (id: number) => {
    await api.drawings.delete(sessionId, id)
    setDrawings(prev => prev.filter(d => d.id !== id))
  }, [sessionId])

  return { drawings, reload, add, update, remove }
}
