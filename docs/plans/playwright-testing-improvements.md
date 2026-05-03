# Playwright UI 検証の効率化プラン

## 背景

ver 1.80(SL/TP drag 移動)の Playwright MCP による動作確認に時間を要した。原因と詰まり所:

1. **SL 線の y 座標を見つけるのに 5-6 往復**: スクリーンショット目視 → 推定 → 試行 → 失敗 → priceToY 直接読み出し → 真の y 判明
2. **チャート座標系の理解(viewport vs pane vs canvas の食い違い)**: 視覚位置と API 値の不一致
3. **debug ログ挿入 → HMR 待ち → 削除のサイクル**: 一時 console 出力のため state.ts を 2 回編集
4. **mouseenter / focus / cursor の前提条件確認**: 状態が想定通りか毎回確かめた

UI ドラッグ系テスト固有の難しさで、毎回手探りでやると都度コストがかかる構造。

---

## 改善案 4 つ(全て実装する)

### 案 A: Playwright 専用 subagent

`.claude/agents/playwright-tester.md` に専用 agent を作る。

**性質**:
- 専用 context で動作 → 親会話に Playwright 試行錯誤が埋まらない
- MCP ツールを agent に閉じる → 親はサブエージェントの「結果サマリだけ」受け取る
- テストヘルパー知識を agent 指示書に蓄積

**agent 指示書に書くべき既知のコツ**(今回の経験から):
- `window.__chartTest.get(tf).priceToY(price)` で y を取得(後述の案 B で公開済み前提)
- フォーカス TF が必須(クリックで focus を確定してから操作する)
- drag は最低 5 px 刻みで段階的に(`page.mouse.move` を細かく)
- mouseenter は `page.mouse.move` で発火する(別途呼ばなくていい)
- カーソル変化(`ns-resize` 等)で hit-test 成功を検知できる
- `getBoundingClientRect()` の `.tv-lightweight-charts` 内座標は**実 canvas 座標と一致しない**(スケール / DPR の影響)
- backend 状態は `curl` で別途確認(UI と API の両方を検証する)
- 試行錯誤前に「単体テストで済むか」「curl で済むか」を一度問う

**入出力**:
- 入力: 自然言語の検証指示(例「SL を drag して 198.5 に変更できることを確認」)
- 出力: 結果(ok / fail + 観察した値、API レスポンス、エラー内容)

**作成手順**:
1. `.claude/agents/playwright-tester.md` を作成
2. 上記コツを「Known gotchas」セクションに列挙
3. 期待する出力フォーマット(検証結果 + 観察値)を例示
4. MCP Playwright ツール群を許可ツールに含める

---

### 案 B: dev only `window.__chartTest` 座標 API 露出

`Chart.tsx` に dev 限定で座標変換 API を `window` に公開する。

**実装イメージ**:
```ts
// Chart.tsx の useEffect 内など、chart instance 作成完了後
if (import.meta.env.DEV) {
  const w = window as unknown as {
    __chartTest?: Map<string, { priceToY: (p: number) => number | null; ... }>
  }
  w.__chartTest ??= new Map()
  w.__chartTest.set(timeframe, {
    priceToY: (p: number) => priceScale.priceToCoordinate(p),
    yToPrice: (y: number) => priceScale.coordinateToPrice(y),
    timeToX: (t: number) => timeScale.timeToCoordinate(t as Time),
    xToTime: (x: number) => timeScale.coordinateToTime(x),
  })
  // unmount 時に delete
  return () => { w.__chartTest?.delete(timeframe) }
}
```

**ガード**:
- `import.meta.env.DEV` で production に紛れ込まない
- CI で grep ベースの検査を 1 行追加(`grep "__chartTest" dist/` で検出時 fail)してもよい

**効果**: Playwright 側で 1 行で取得可能になる:
```js
const y = await page.evaluate(() => window.__chartTest.get('M5').priceToY(198.2598))
```

今回の「SL の y を求めるのに 5 往復」が 1 行で済む。

**作成手順**:
1. `Chart.tsx` の chart instance 構築完了後に `__chartTest` 登録 + cleanup を 10-20 行追加
2. 型定義は内部のみで問題なし(test 側で `any` キャストで使う)
3. CI で `npm run build` 後に `dist` から `__chartTest` 文字列が消えているかを確認するスクリプト追加(任意)

---

### 案 C: e2e テスト常設化(`tests/e2e/*.spec.ts`)

Playwright スクリプトを `apps/trade-trainer/frontend/tests/e2e/` 配下に配置してリグレッションテスト化。

**最初に固定化したいフロー**(壊れたら気づきにくい順):
1. **SL/TP の drag 移動**(ver 1.80): 保有中で drag → Trade 更新 / 振り返りで凍結
2. **advance のフォーカス TF 境界アライメント**(ver 1.79): 10:15 H1+1 → 11:00
3. **chart-stack の最新 N バー保証**(ver 1.78): 週末 current_pos でも全 TF に bars が返る
4. **波動ラベル auto-advance + ホットキー**(ver 1.77): 1→2→3→...→Idle
5. **LowerTfRangeOverlay 経路**(ver 1.76): H4+ で帯が pane 全幅にならない

**作成手順**:
1. `apps/trade-trainer/frontend/tests/e2e/` ディレクトリ作成
2. `playwright.config.ts` を frontend 直下に追加(Vite 5173 + backend 8001 を起動済み前提 or webServer に統合)
3. ヘルパー `tests/e2e/helpers/chart.ts` に「SL の y を `__chartTest` で取得」「ペインに drag」等を集約
4. spec を 1 機能 1 ファイルで列挙
5. `package.json` に `"test:e2e": "playwright test"` を追加
6. 実行は手動(CI 未統合) — 個人運用なので必要時のみ

---

### 案 D: 検証粒度の使い分け(運用ルール)

UI フローを 3 段に分けて、Playwright を最後の統合検証だけに絞る。

| 検証対象 | ツール | 目安 |
|---|---|---|
| 状態機械ロジック / 純関数 | vitest | drawing/state.ts の reducer 単体 |
| backend エンドポイント | `curl` + Python REPL | PATCH /trade のステータスコード / レスポンス |
| 統合(UI が API を呼ぶ) | Playwright | drag → PATCH 発火を一気通貫で検証 |

**運用ガイド**:
- **検証着手前に**「これは単体で済むか?curl で済むか?Playwright が本当に必要か?」を一度問う
- 統合検証で詰まり始めたら、即座に「単体 + curl」に切り戻して原因を狭める
- Playwright で見つかったバグは、可能な限り単体テスト or curl 検証で再現できる形に落とし込む(リグレッション網)

**作成物**:
- `docs/WORKFLOW.md` に「検証粒度の使い分け」節を追加(または `architecture/frontend-overview.md` に既存の検証ガイドがあればそこへ追記)

---

## 進捗

- ✅ **案 D 実装済み**(2026/05/03): `docs/WORKFLOW.md §C 検証粒度の使い分け` + `architecture/frontend-overview.md §I テスト戦略と検証粒度` でルール明文化。詳細は `docs/CHANGELOG.md` の「設計書: 検証粒度の 3 階層化」エントリ
- ✅ **vitest 環境整備**(2026/05/03): `vitest.config.ts` 作成。`drawing/state.ts` の単体テスト 77 件 pass(`src/drawing/__tests__/state.test.ts`)
- ✅ **frontend 単体テスト追加**(2026/05/03): visibility / wave_label / tools_hit_test / calculations / chartStackCache / datetime の計 200 件 pass
- ✅ **backend pytest 追加**(2026/05/03): `bar_start` + `resample_ohlc`(market-data) + `_bar_start_for_tf` + `_calculate_pips`(backend) の計 53 件 pass
- ⏳ 案 A / B / C は未着手

## 推奨実装順

1. **案 B**(dev only `window.__chartTest`)を最初に実装 — 案 A / 案 C の前提として最も効くから
   - 工数: 10-20 分
   - 効果: 即座に Playwright での座標取得が 1 行化
2. **案 A**(playwright-tester subagent)— 案 B を前提に knowledge を集約
   - 工数: 20-30 分
   - 効果: 親 context を圧迫せず並行作業可能
3. **案 D**(検証粒度ルール)を WORKFLOW に明文化
   - 工数: 5-10 分
   - 効果: 次回の検証で「Playwright は最後だけ」を自動的に思い出せる
4. **案 C**(e2e テスト常設)を SL/TP drag からスタート
   - 工数: 1-2 時間(初期投資)
   - 効果: リグレッション網が育つ。修正のたびに不安なくテストできる

各案は独立して機能するため、上記順序を厳密に守らなくてもよい。1 番目の案 B だけでも体感が大きく変わる。

---

## 補足: 今回の経験から得たその他の改善ポイント

- **debug ログを state.ts に挿入する代わりに**、`window.__chartTest` の中に `lastDispatchEvent` のような観測フックを置けば編集サイクル不要
- **Vite HMR の待ち時間**は `await page.waitForFunction(() => /* HMR done marker */)` で短縮可能(現状は固定 sleep)
- **Playwright の `page.mouse.move` で連続 drag** は手動で 5 px 刻み実装している。共通ヘルパーで `dragVertical(x, fromY, toY, step=5)` を作っておくとよい(案 C のヘルパーに含める)

---

## ファイルの位置づけ

このプランは作業着手時にチェックリストとして使う。実装完了後はチェックリスト欄を更新するか、ファイル自体を `docs/plans/done/` 配下へ移動して履歴を残す。
