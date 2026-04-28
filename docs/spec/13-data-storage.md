# §13. データ保存方針

← [仕様書インデックス](./README.md)

---

ver 1.45 で「ユーザー入力 = ファイル / 機械生成キャッシュ = SQLite」のハイブリッド構成に再編した。

## 13.1 全体像

| 区分 | 対象 | 保存先 | 同期(Dropbox 等) |
|---|---|---|---|
| **ユーザー入力** | セッション情報(セッション・候補・Trade・見送り・描画・保有中メモ) | `data/sessions/{dir}/` ファイル群 | **同期推奨** |
| ユーザー入力 | メモ見出しテンプレート | `data/memo-templates/*.md` | git 管理 |
| AI 分析結果 | レポート・送信メタ・画像 | `data/sessions/{dir}/ai_analysis/`(セッション配下、§11.7) | セッションと同時に同期 |
| 機械生成キャッシュ | M5 OHLC、経済指標 | `trading.db`(SQLite) | **同期対象外**(消耗品扱い) |
| アプリ設定 | Setting テーブル(symbols / spreads / 経済指標表示設定 / リスク設定 等) | `trading.db`(SQLite) | 同期対象外 |
| 認証セッション | Starlette SessionMiddleware | `trading.db` or Redis | 同期対象外 |

「**ユーザー入力はファイル**」という方針は ver 1.44 のメモテンプレート移行(`data/memo-templates/`)と同じ思想で、ver 1.45 でセッション情報全体に拡張した。

## 13.2 セッション情報のファイル構造

セッションは 1 ディレクトリ 1 セッションで保存する。ver 1.54 で session.json に統合(trade / final_decision / drawings / holding_memos を内包)。詳細は [§17](./17-data-model.md)。

```
data/sessions/
└── {dir_name}/                       # 例: 20260425-1530-USDJPY-doubletop
    ├── session.json                  # meta + trade + final_decision + drawings + holding_memos を統合
    ├── note.md                       # 横断メモ(§7.2.2)
    ├── candidates/
    │   ├── EURJPY.md                 # 銘柄別メモ(§7.2.1)
    │   └── USDJPY.md
    └── ai_analysis/                  # AI 分析結果(§11.7)
```

### ディレクトリ命名

`{YYYYMMDD-HHMM}-{symbol}-{name}`(JST 基準)

- 日時: `presented_at` を JST で整形、不変
- symbol: 作成直後 `pending`、エントリー時に銘柄、見送り確定時に `skipped`
- name: 未入力時 `untitled`、編集ごとに rename

ディレクトリ名は **可読ラベル**(エクスプローラ・Dropbox 上での識別用)。識別子は `session.json` の `id`(`YYYYMMDD-HHMM-xxxx` 形式の不変値)を使う。アプリは id でセッションを参照するため、ディレクトリリネームは API URL に影響しない。

### name サニタイズ

ディレクトリ名は OS で安全なように、name 文字列から以下を除外して生成する:

- 危険文字 (`/ \ : * ? " < > |` および制御文字) → `-` に置換
- 空文字 / 危険な相対パス(`.` `..`) → `untitled`
- 日本語(UTF-8)は許容

### 状態判定(進行中 / 決着済み)

`session.json` の `settled_at: ISO8601 | null` で表す([§4.2.1](./04-session-flow.md#421-セッション状態モデル進行中--決着済み))。`null` = 進行中、値あり = 決着済み。

### 削除

アプリ内に削除 UI は持たない。削除 = OS / Dropbox / エクスプローラでディレクトリを直接削除。アプリ側は:

- 一覧スキャンで存在するディレクトリのみ表示(リロードで再走査)
- 各 API でリクエスト先のセッションディレクトリ存在チェック → 無ければ 404

## 13.3 メモ見出しテンプレート(リポジトリ内 Markdown)

§7.2.3 の銘柄別メモ / 横断メモの初期テンプレートは **`data/memo-templates/{candidate,session-note}.md`** で管理する(ver 1.44)。

- DB に保存しない理由: テキストエディタで直接編集できる + git で履歴・差分を管理できる方が、設定 API + 設定画面 UI 経由よりシンプルかつ運用しやすい(個人運用前提)
- ファイル無し / 空ファイルの場合は「テンプレ無効」として扱う(新規メモ作成時に挿入しない)
- 起動時に 1 回読み込んでメモリ保持。編集反映にはバックエンド再起動が必要

## 13.4 同期競合と書き込みの整合性

Dropbox / OneDrive 等のフォルダ同期を前提とした運用方針。

### atomic write(書き込み中の同期事故防止)

ファイル書き込みは **tmp ファイル → rename** の atomic パターンで行う。同期中に部分書き込みされたファイルが他端末に伝播するリスクを最小化する。

```python
def atomic_write(path: Path, content: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)   # POSIX rename は atomic、Windows は os.replace で同等
```

### conflict ファイルの扱い

Dropbox 等が生成する競合ファイルは一覧スキャンで除外する:

- `*Conflicted copy*`(Dropbox)
- `*.conflict.md` / `*.conflict`
- 制御文字や非 ASCII 始まりのディレクトリ名

これらはアプリの読み書き対象外として静かにスキップする。ユーザーが OS / エクスプローラで競合ファイルを見比べてマージし、不要な方を削除する運用。

### id 重複の検出

セッションのコピーや同期事故で同一 `id` を持つディレクトリが複数現れた場合、アプリは:

- 起動時または一覧再走査時に重複検出
- **更新日時最新を採用**、それ以外は警告ログを出して無視

### 同時編集

VPS とローカル PC で同じセッションを同時編集することは想定外(個人運用 + 1 端末 1 編集前提)。ロックは導入せず、最終書き込み勝ち。ローカル PC は **コピーしての参照・分析が主用途** で、編集は VPS 側に集約する運用。

## 13.5 同期しないもの

`trading.db`(SQLite)は **Dropbox 同期対象外**。理由:

- WAL / shm ファイルを伴うため同期で部分破損するリスク
- 市場データキャッシュは消耗品(MT5 から再取得可能)
- アプリ設定は同期不要(端末ごとに別運用が妥当な項目もある)

ユーザーは `data/sessions/`、`data/memo-templates/`、`data/sessions/{dir}/ai_analysis/`(セッション配下)を同期対象に含め、`trading.db` および WAL/shm ファイルは同期から除外する設定にする。

## 13.6 バックアップ

| 対象 | 方法 |
|---|---|
| セッション・メモテンプレ | Dropbox 同期 + git(テンプレのみ) |
| `trading.db`(キャッシュ・設定) | 単純なファイルコピー(WAL モードでは `.backup` 推奨)、または VPS スナップショット |
| AI 分析結果 | セッションディレクトリと一緒にコピーされる(同経路) |

## 13.7 同期(クラウドサービス)

クラウド同期は**実装しない**(シンプル運用)。代わりに **Dropbox / OneDrive 等の汎用同期ツール** を `data/sessions/` 等のディレクトリに対して使う前提。
