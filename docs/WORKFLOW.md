# 作業手順(必須)

← [仕様書](./spec/README.md) | [設計ドキュメント](./ARCHITECTURE.md)

---

このプロジェクトでは **コードを書く前に必ず仕様書 / 設計ドキュメントを先に整える** ことをルールとする。場当たり的なパッチでバグが連鎖した過去の経緯から、本ルールを strict に守る。

## 0. 三層の責務

| 層 | 場所 | 内容 | いつ更新 |
|---|---|---|---|
| **仕様書** | `docs/spec/` | ユーザー要件 / 機能 / UI / API 形状 / データモデル(**現状の姿のみ**、時系列は書かない) | 仕様変更があったとき |
| **変更履歴** | `docs/CHANGELOG.md` | 仕様変更の ver 番号と要約(時系列、append-only) | 仕様変更コミットと同じ単位で追記 |
| **設計** | `docs/ARCHITECTURE.md` + `docs/architecture/*.md` | モジュール構成・責務分担・状態の所有・ライフサイクル・データフロー・横断不変条件(層別に分割: backend / frontend-overview / frontend-chart / drawing-tools / invariants) | 設計に影響する変更があるとき(新規・変更・抽象化見直し) |
| **コード** | `apps/`, `packages/` | 仕様 + 設計を実装したもの | 上記が整ってから |

「コードだけ修正して仕様 / 設計と乖離する」状態を許容しない。乖離しているとバグの温床になる。

---

## A. 仕様変更を伴うタスク

> 例: 機能追加・UI 改修・データモデル変更・API 形状変更

**必ず以下の順で実施する。スキップしない。**

### A-1. 仕様書を先に更新する

1. `docs/spec/` の該当章 (`§N.M`) を編集する
   - 仕様書本文には **現状のあるべき姿のみ** を記述する。版番号(ver 1.X)や時系列の差分(「これまでは X、今回 Y に変更した」)は書かない。同じ仕様書から白紙でコードを再生成しても、ほぼ同じ機能が出来上がる状態を保つ
   - 設計判断の根拠(複数案を比較した結果なぜ Z を採ったか等)は時系列と切り離して **本文中に**残す
2. 変更履歴は [`docs/CHANGELOG.md`](./CHANGELOG.md) に追記する(セッション全体で複数の仕様変更がある場合は、最後にまとめてもよい)。ここに ver 1.X とその要約を残す
3. 変更が他章にまたがる場合、`docs/spec/README.md` の「トピック索引」を見て関連章も同じセッション内で更新する

### A-2. 設計ドキュメントを更新する(必要時のみ)

設計に影響する変更とは以下のいずれか:

- 新しいモジュール / コンポーネント / hook を追加する
- 既存モジュール間の責務境界が変わる
- 状態の所有者が移動する(例: A コンポーネントから B コンポーネントへ state を移譲)
- データの流れが変わる(例: 双方向 → 単方向)
- 外部依存(ライブラリ・プロバイダ)の使い方が変わる
- **既存のモジュールスコープ state / ref / memory と新機能が状態を共有する**(例: 既存の `xMemory.ts` と新規 cache が同じ TF キーを使う)
- **既存のライフサイクル管理に新しい入力源を追加する**(`<X key={...}>` の remount 戦略・useEffect 依存配列・順序保証など)
- **キャッシュ層の追加・削除**(state の所有が新たに発生するため必ず該当する)

該当する場合は `docs/ARCHITECTURE.md`(トップレベル: 全体図 / 役割境界 / 索引)または該当する層別ファイルを更新する:

- backend / market-data の構造・API・ファイル構造変更 → `docs/architecture/backend.md`
- frontend 全体構造・hooks・SessionPage 状態 → `docs/architecture/frontend-overview.md`
- Chart / 座標変換 / overlay / lightweight-charts 境界 → `docs/architecture/frontend-chart.md`
- 描画モード状態機械 → `docs/architecture/drawing-tools.md`
- 横断不変条件(全層共通) → `docs/architecture/invariants.md`

frontend / backend の役割境界(どこに置くか)を判定するときは [`ARCHITECTURE.md §3`](./ARCHITECTURE.md#3-frontend--backend-役割境界) のチェックリストに従う。

設計ドキュメントには最低以下を含める:
- **責務**: このモジュール / 構造が何を担うか
- **状態の所有**: どこに state があり、誰が変更するか
- **インターフェース**: 公開 API / props / 関数シグネチャ
- **データフロー図 or 流れの記述**: 主要操作の発火 → 反映までの経路
- **不変条件**: 守るべき前提(例: 「タイムスタンプは常に UTC-aware」)

#### A-2.1 設計レビューのチェックリスト(state / lifecycle に絡む変更で必須)

新機能が以下のどれかに当てはまる場合は、コードを書き始める前にこのチェックを通すこと:

- [ ] 新機能が触る state(React state / module-level state / ref / closure)を全部書き出した
- [ ] 既存 state との干渉を確認した(同じキー / 同じ寿命 / 同じトリガーで上書きが起きないか)
- [ ] 既存の lifecycle(`<X key={...}>` 等の remount 戦略・cleanup 順序・useEffect 発火順)に与える影響を該当する設計ファイル(`ARCHITECTURE.md` または `architecture/*.md`)に書いた
- [ ] 想定される副作用の伝播経路を 1 本のフロー図 / 文章で追えるか確認した(「state A が変わると B が変わって C が再描画される」を口頭で説明できる状態)
- [ ] ライブラリ(lightweight-charts 等)の **暗黙の副作用**(setData が visible range emit を起こす等)が新機能と干渉しないか検討した

「機能としては小さい」と感じても、上記いずれかに当たれば A-2 を必ず実施する。「小さい機能だから設計スキップでヨシ」と判断したくなる時こそ罠。

### A-3. コードを書く

仕様書と設計が **整合した状態で** コードに着手する。

- 仕様書 / 設計から逸脱する形で書きそうになったら、コードを止めて 1 つ上の層に戻る
- 実装中に新しい論点が出たら、まずその論点を仕様書 / 設計に反映してから続ける

### A-4. 検証

検証は **3 階層** に分けて、対象ロジックの性質に合った最低コストの手段を選ぶ([§C 検証粒度の使い分け](#c-検証粒度の使い分け))。階層を飛ばすと(例: Tier 1 で済むことを Tier 3 で確認しようとする)時間が多大にかかる。

- **静的チェック(全変更)**: `npx tsc --noEmit`(frontend) / `uv run python -c "import trade_trainer_backend.main"`(backend)
- **Tier 1 純関数**: 該当する純関数を変更したら **vitest / pytest で単体テスト**(将来整備、現状は手動 REPL 検証可)
- **Tier 2 backend エンドポイント**: 変更した API は `curl` で endpoint を叩いて応答確認
- **Tier 3 UI 統合**: 主要フローの最後の通し確認だけ Playwright / ブラウザ手動(`Ctrl+Shift+R` で強制リロード)
- **observability**: ログ・assert 違反が新たに出ていないか観測([invariants I-10 observability](./architecture/invariants.md#i-10-observability-の最低ライン) 参照)

---

## B. バグ修正タスク

> 例: 表示されない・想定と挙動が違う・エラーが出る

**仕様変更を伴わない修正でも、設計を必ず見直すフェーズを挟む。**

### B-1. 再現と原因特定

- 起きている事象を 1 行で言語化する
- backend ログ / ブラウザ Console / API レスポンスを確認して根本原因を特定する
- ログだけで原因が分からない場合は **観測性を先に追加する**(`log.info` / `console.warn` / assert)。バグを直す前にログを足すこと自体は許容
- **局所修正(clamp / フォールバック / フラグ追加 等)を 2 回試して直らないバグは、コードではなく設計レベルの問題と仮定して B-2 に戻る**。3 回目を局所修正で重ねない。symptom が変化するだけで根治しないパターンは、ほぼ確実に状態管理 / lifecycle / 責務境界の構造的問題

### B-2. 設計の見直し(必要時のみ)

そのバグが以下のいずれかに該当するなら、コード修正前に **設計** を見直す:

- 「同じ概念が 2 箇所で持たれていた」(状態の二重所有)
- 「沈黙する失敗が原因だった」(エラーがどこにも出ていなかった)
- 「責務がはみ出ている関数 / コンポーネントが原因だった」
- 「データフロー上の前提が破れていた」(例: 「UTC で来るはず」が naive で来ていた)

該当した場合:
1. 該当する設計ファイル(`docs/ARCHITECTURE.md` トップレベル、または `docs/architecture/{backend,frontend-overview,frontend-chart,drawing-tools,invariants}.md`)を更新する
2. 不変条件 / 責務境界を明文化してから修正に入る

該当しなければ(局所的な typo / 値の打ち間違い / ライブラリの引数違い等)、設計見直しはスキップしてよい。

### B-3. コード修正

設計が整ってから修正する。修正は **その設計に沿った最小変更** に留める。同じセッション内で関係ないリファクタを混ぜない。

### B-4. 検証

- 修正前に再現していた事象が解消したことを確認
- [§C 検証粒度の使い分け](#c-検証粒度の使い分け) に従い、変更箇所に応じた階層で検証する
- 関連箇所(同じデータフロー上の他の TF / 他のフェーズ等)で副作用が出ていないか確認

---

## C. 検証粒度の使い分け

UI 統合検証(Playwright / ブラウザ手動)を最終段に絞り、**変更ロジックの性質ごとに最も安いツール**で検証する。Tier を飛ばすと時間が多大にかかる(過去の Playwright 調査で SL 線の y 座標を求めるのに 5 往復した経験あり)。

### C-1. 検証着手前の判断フロー

```
変更したのは:
  ├─ 純関数(I/O 無し、引数 → 戻り値が deterministic)
  │   └→ Tier 1: vitest / pytest で単体検証(なければ手動 REPL)
  │
  ├─ backend エンドポイント / DB / market-data
  │   └→ Tier 2: curl で API スモーク(レスポンス値 / ステータスコード確認)
  │
  ├─ React state / hook の I/O 配線
  │   └→ Tier 2: curl で backend 確認 + 必要なら React Testing Library
  │
  └─ canvas / SVG / マウス入力 / 全体フロー(エントリー → 保有 → 振り返り)
      └→ Tier 3: Playwright(MCP)/ ブラウザ手動。最低限の統合確認だけ
```

**詰まり始めたら 1 段下に戻る**。Tier 3 で原因が特定できないバグは、ほぼ必ず Tier 1 のロジック問題か Tier 2 の I/O 問題に分解できる。

### C-2. Tier 1: 純関数(vitest / pytest)

**対象**: 引数 → 戻り値が deterministic で、I/O も外部状態も持たない関数。frontend 側では:

- `drawing/state.ts` の `dispatchEvent` + 各 reducer + selector 群(599 行・最も ROI が高い)
- `drawing/tools/*.tsx` の `hitTest` / `getXxxData` 関数
- `drawing/visibility.ts` の `isDrawingVisibleOnTf`
- `indicators/calculations.ts`(SMA / EMA / RSI)
- `chart/chartStackCache.ts` の LRU 動作
- `utils/datetime.ts`

**ROI が高い理由**: ロジックの複雑さがリッチ(SL/TP drag の hit-test 競合、波動 auto-advance、weekend skip、cache LRU eviction 等)で、**バグの大半はここで再現可能**。Playwright での座標計算 / drag シミュレーションを通すよりも 1 桁速く検証できる。

backend 側の純関数(`_bar_start_for_tf`、`_calculate_pips`、`resample_ohlc` の規約等)も同様に pytest で検証する。

### C-3. Tier 2: backend / hook の I/O(curl + React Testing Library)

**対象**: HTTP 境界 / DB / market-data / hook の state 反映。

**curl で backend を叩く例**:
```bash
# advance の境界アライメント検証(ver 1.79)
curl -X POST "http://127.0.0.1:8001/api/sessions/{id}/advance?bars=1&focused_tf=H1&symbol=GBPJPY"

# SL/TP 部分更新検証(ver 1.80)
curl -X PATCH "http://127.0.0.1:8001/api/sessions/{id}/trade" -H "Content-Type: application/json" -d '{"sl": 198.5}'

# レスポンス値を見て期待値と一致するかを確認
```

**hook test の判断**: hook test(React Testing Library)は保守コストが高いので、まず **curl で backend を確認 → frontend 側のバグなら Tier 1 に切り出して単体検証** の戦略を優先する。`useCharts` の cache + abort 整合性のような副作用ロジックだけ例外的に hook test を検討する。

### C-4. Tier 3: UI 統合(Playwright / ブラウザ手動)

**対象**: canvas 描画 / SVG 配置 / マウス入力 / 全体フロー(エントリー → 保有 → drag SL → advance → 決済)。

**Tier 3 を選ぶときの判断**:
- canvas / SVG の座標が正しいかを実際の描画で確認したい
- ライブラリ(lightweight-charts)の暗黙副作用と統合した結果を見たい
- ユーザー視点の主要フローが通しで動くかの最終確認

**避けるべき使い方**:
- 純関数のロジック検証(Tier 1 で済む)
- backend の API レスポンス値検証(curl で済む)
- 「とりあえず実物で見てみる」の場当たり利用(座標を求めるだけで何往復もする原因)

**Playwright を使う場合のコツ**(過去の経験から):
- `priceToY` 等の座標 API を直接叩いて y を取得する(視認による推定は誤差が出る)
- focus TF を明示的にクリックで確定してから操作する
- drag は `page.mouse.move` を 5 px 刻みで段階発火させる
- カーソル変化(`ns-resize` 等)で hit-test 成功を検知する
- backend 状態は curl で別途確認(UI と API の両方を検証)

### C-5. 過去事例の階層分類

| 機能 | Tier 1 で検証可能 | Tier 2 で検証可能 | Tier 3 が必要 |
|---|---|---|---|
| ver 1.78 chart-stack の最新 N バー保証 | — | ✓(curl で各 TF の bars 数確認) | (任意) |
| ver 1.79 advance 境界アライメント | _bar_start_for_tf の単体 | ✓(curl で current_position の遷移確認) | (任意) |
| ver 1.80 SL/TP drag | state.ts の `findTradeLineHit` / `reduceMovingTradeLine` | ✓(curl で PATCH /trade 確認) | drag 操作の通し検証 |
| ver 1.77 波動 auto-advance | `nextWave` / `reduceDrawingWaveLabel` | — | キーホットキー統合 |
| ver 1.76 LowerTfRangeOverlay | `logicalToTime` / `timeToLogical`(純関数) | — | px 計算と SVG 配置 |

ver 1.80 のとき、SL/TP drag のロジック自体は Tier 1(`findTradeLineHit` の単体検証)で済む。Tier 3 で確認が必要なのは「drag 操作 → mouseup → PATCH 発火 → priceLine 再描画」の通しのみ。今後はこの分割を着手前に決める。

---

## D. 共通の守るべき手順

### D-1. 着手時

- このドキュメントと、該当する仕様書 / 設計ドキュメントを先に開く
- セッションの最初に「このタスクは A か B か」を明示する
- A の場合は仕様書のどの章を、B の場合は設計のどの観点を見るか宣言してから進む
- **エラー処理 / 失敗時挙動を伴う変更**(catch 追加・データ取得・ユーザー操作の結果反映等)では [`invariants.md I-11`](./architecture/invariants.md#i-11-エラー処理--失敗の可視化) の 6 項目を確認してから着手する

### D-2. 完了の定義

完了 = 以下のすべて:

1. 仕様書(A の場合)/ 設計ドキュメント(必要なら)が更新されている
2. 静的チェック(tsc / python import)が通る
3. 該当機能のスモーク(API / ブラウザ)が通る
4. 新たに観測されたエラーログ / warning が **設計上の不変条件違反でない** ことを確認した
5. ユーザー入力起因の失敗パスが UI に通知されている([I-11.4](./architecture/invariants.md#i-114-ユーザー入力起因の失敗は-ui-に通知))。「空表示 + 通知無し」を残さない

3 が手動でしか確認できない場合(UI 視覚確認等)は、ユーザーに具体的な確認手順を提示する。

### D-3. やってはいけないこと

- ✗ コードだけ直して仕様書 / 設計を後回しにする
- ✗ 「とりあえず動いたから OK」で終わらせる(設計上の不変条件違反を放置しない)
- ✗ プラン無しで複数ファイルにまたがる修正を始める
- ✗ 静的チェックを飛ばしてユーザーに「確認してください」と言う
- ✗ 仕様書本文や設計書本文に `ver 1.X で〜に変更` のような時系列マーカーを書く(変更履歴は `docs/CHANGELOG.md` に集約する)
- ✗ **既存のモジュール状態 / lifecycle が絡む新機能を、設計ファイル(`ARCHITECTURE.md` または `architecture/*.md`)の該当節を更新せずに実装する**(§A-2.1 チェックリスト未通過のままコードに進まない)
- ✗ **バグ修正で局所対処を 3 回以上重ねる**(2 回ダメなら設計見直しに戻る、§B-1 参照)

---

## 参考

- 仕様書: [`docs/spec/`](./spec/)
- 変更履歴: [`docs/CHANGELOG.md`](./CHANGELOG.md)
- 設計ドキュメント:
  - [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — トップレベル(全体図 / 役割境界 / 索引)
  - [`docs/architecture/invariants.md`](./architecture/invariants.md) — 横断不変条件 I-1〜I-12
  - [`docs/architecture/backend.md`](./architecture/backend.md) — backend + market-data
  - [`docs/architecture/frontend-overview.md`](./architecture/frontend-overview.md) — frontend 全体構造
  - [`docs/architecture/frontend-chart.md`](./architecture/frontend-chart.md) — Chart 関連(座標 / LWC 境界 / overlay)
  - [`docs/architecture/drawing-tools.md`](./architecture/drawing-tools.md) — 描画モード状態機械
- セットアップ: [`Setup.md`](./Setup.md)
