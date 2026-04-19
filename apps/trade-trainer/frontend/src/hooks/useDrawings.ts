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

export function useDrawings(sessionId: string): DrawingsApi {
  const [drawings, setDrawings] = useState<Drawing[]>([])

  const reload = useCallback(async () => {
    const list = await api.drawings.list(sessionId)
    setDrawings(list)
  }, [sessionId])

  useEffect(() => { void reload() }, [reload])

  const add = useCallback(async (body: CreateDrawingRequest) => {
    const d = await api.drawings.create(sessionId, body)
    setDrawings(prev => [...prev, d])
    return d
  }, [sessionId])

  const update = useCallback(async (
    id: number,
    patch: { data?: Record<string, unknown>; label?: string | null; visible_on_timeframes?: string[] | null },
  ) => {
    // 楽観更新でチャートのスナップバックを防ぐ
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, ...patch, data: patch.data ? { ...d.data, ...patch.data } : d.data } : d))
    const updated = await api.drawings.update(id, patch)
    setDrawings(prev => prev.map(d => d.id === id ? updated : d))
  }, [])

  const remove = useCallback(async (id: number) => {
    await api.drawings.delete(id)
    setDrawings(prev => prev.filter(d => d.id !== id))
  }, [])

  return { drawings, reload, add, update, remove }
}
