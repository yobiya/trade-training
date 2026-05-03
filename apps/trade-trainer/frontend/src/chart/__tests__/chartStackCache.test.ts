import { describe, it, expect, vi, beforeAll } from 'vitest'
import { getCachedStack, setCachedStack, type CachedStack } from '../chartStackCache'

const EMPTY: CachedStack = { stacks: [] }

// 各テストが固有キーを使うようにカウンタで一意なシンボル名を生成
let n = 0
const sym = () => `sym_${n++}`

// ---------------------------------------------------------------------------
// null currentPos
// ---------------------------------------------------------------------------

describe('currentPos が null のとき', () => {
  it('getCachedStack → null', () => {
    setCachedStack('S', 'pos', 'tf', EMPTY)
    expect(getCachedStack('S', null, 'tf')).toBeNull()
  })

  it('setCachedStack → 何もしない(後続 get も null)', () => {
    setCachedStack('S2', null, 'tf', EMPTY)
    expect(getCachedStack('S2', 'pos', 'tf')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 基本 set / get
// ---------------------------------------------------------------------------

describe('set / get', () => {
  it('set 前は miss', () => {
    expect(getCachedStack(sym(), 'pos', 'tf')).toBeNull()
  })

  it('set 後は hit', () => {
    const s = sym()
    setCachedStack(s, 'pos', 'tf', EMPTY)
    expect(getCachedStack(s, 'pos', 'tf')).toBe(EMPTY)
  })

  it('同じキーへの set は値を上書き', () => {
    const s = sym()
    const v1: CachedStack = { stacks: [{ timeframe: 'M5', bars: [] }] }
    const v2: CachedStack = { stacks: [{ timeframe: 'H1', bars: [] }] }
    setCachedStack(s, 'pos', 'tf', v1)
    setCachedStack(s, 'pos', 'tf', v2)
    expect(getCachedStack(s, 'pos', 'tf')).toBe(v2)
  })

  it('異なる currentPos はキャッシュミス', () => {
    const s = sym()
    setCachedStack(s, 'pos1', 'tf', EMPTY)
    expect(getCachedStack(s, 'pos2', 'tf')).toBeNull()
  })

  it('異なる tfsKey はキャッシュミス', () => {
    const s = sym()
    setCachedStack(s, 'pos', 'tf1', EMPTY)
    expect(getCachedStack(s, 'pos', 'tf2')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LRU 昇格 + eviction
// ---------------------------------------------------------------------------

describe('LRU eviction (isolated module)', () => {
  // vi.resetModules() + 動的 import で空の cache を持つ新しいモジュールインスタンスを取得
  let freshGet: typeof getCachedStack
  let freshSet: typeof setCachedStack

  beforeAll(async () => {
    vi.resetModules()
    const mod = await import('../chartStackCache')
    freshGet = mod.getCachedStack
    freshSet = mod.setCachedStack
  })

  it('MAX_ENTRIES(50) に達したとき最古エントリが退避される', () => {
    // 50 エントリ追加(sym_e_0 が最古)
    for (let i = 0; i < 50; i++) {
      freshSet(`sym_e_${i}`, 'pos', 'tf', EMPTY)
    }
    // 51 番目を追加 → sym_e_0 が退避される
    freshSet('sym_e_50', 'pos', 'tf', EMPTY)

    expect(freshGet('sym_e_0', 'pos', 'tf')).toBeNull()      // 退避済み
    expect(freshGet('sym_e_1', 'pos', 'tf')).not.toBeNull()  // 残存
    expect(freshGet('sym_e_50', 'pos', 'tf')).not.toBeNull() // 新規
  })

  it('ヒット時に LRU 昇格 → 昇格済みエントリは次の退避対象にならない', () => {
    // 前テスト後: cache は sym_e_1 .. sym_e_50 の 50 エントリ
    // sym_e_1 にアクセスして最近使用済みに昇格
    freshGet('sym_e_1', 'pos', 'tf')
    // sym_e_51 を追加 → 最古の sym_e_2 が退避される
    freshSet('sym_e_51', 'pos', 'tf', EMPTY)

    expect(freshGet('sym_e_2', 'pos', 'tf')).toBeNull()     // 退避済み
    expect(freshGet('sym_e_1', 'pos', 'tf')).not.toBeNull() // 昇格済み → 残存
    expect(freshGet('sym_e_51', 'pos', 'tf')).not.toBeNull()
  })

  it('既存キーへの上書きは退避を発生させない', () => {
    // 前テスト後: cache 50 エントリ。sym_e_3 を上書き
    const v: CachedStack = { stacks: [{ timeframe: 'M15', bars: [] }] }
    freshSet('sym_e_3', 'pos', 'tf', v)
    // 上書きなので退避なし。すべてのエントリが残存
    expect(freshGet('sym_e_3', 'pos', 'tf')).toBe(v)
    // sym_e_51 も残存
    expect(freshGet('sym_e_51', 'pos', 'tf')).not.toBeNull()
  })
})
