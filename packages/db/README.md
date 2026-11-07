# @fpm/db

Node 24 用の永続化パッケージ。`createDatabase` は `Kysely<Schema>` を返す。
起動時に `migrateToLatest`、終了時に `db.destroy()` を呼ぶ。
DB の選択は呼び出し元からオプションで渡す。

```ts
import { createDatabase, createRepository, migrateToLatest } from "@fpm/db";

const db = createDatabase({ kind: "sqlite", filename: "data.sqlite" });
// テスト: createDatabase({ kind: "pglite" })
// 本番 PostgreSQL: createDatabase({ kind: "postgres", connectionString })
try {
  await migrateToLatest(db);
  const repository = createRepository(db);
  const clients = await repository.listClients();
} finally {
  await db.destroy();
}
```

## 接続と依存

- `kysely` 0.29.8: 全 DB 共通の型付きクエリと TypeScript マイグレーション。
  Migrator の Provider はコード内のマイグレーションを返し、ファイルを探索しない。
  1 件ずつスキーマ変更と適用履歴を同じトランザクションで確定する。
  失敗した 1 件は全体をロールバックし、それ以前に成功した分は維持する。
- SQLite: Node 標準の `node:sqlite.DatabaseSync` を小さなアダプターで
  `SqliteDialect` に接続する。外部キーを有効にし、追加のネイティブモジュールは使わない。
  Kysely 標準の SQLite アダプターと異なり、DDL のトランザクションを有効にする。
- `@electric-sql/pglite` 0.5.15: テスト用の PostgreSQL。
  [Kysely 組み込みの PGliteDialect](https://kysely-org.github.io/kysely-apidoc/classes/PGliteDialect.html)
  を使うため、外部 Dialect パッケージも自作 Dialect も不要。
- `pg` / `@types/pg` 8.23.1: 本番 PostgreSQL 用の接続プールと型定義。

依存はすべてこのパッケージの `dependencies` に置く。
インストールはルートで `npm install -w packages/db --ignore-scripts` を実行できる。

## 保存形式と判断

- 秒数は `bigint` 列。読み書きと集計時に JavaScript の安全な整数範囲を検証する。
  案件と打刻の単価は円単位の `double precision`(未設定は `null`)。solidtime の 1/100 円単位も保持する。
  PostgreSQL の `bigint` / `SUM` が文字列で返る場合も、リポジトリの戻り値は `number` に統一する。
- 目安時間はドメインの丸め方に合わせて `Math.round(hours * 3600)` で秒に変換し、
  読み出しで 3600 で割る。未指定と空の範囲、0 の指定を区別する。
- 日付、対象月、日時はそれぞれ `YYYY-MM-DD`、`YYYY-MM`、ISO 8601 の `text` 列。
  同期の最新日時はタイムゾーンのオフセットも考慮して比較する。
- 真偽値は SQLite でもそのままバインドできる整数 0 / 1 にする。
- 契約は `contracts` と `contract_projects` に分ける。対象案件の配列順序を保持する。
  取引先行をロックしてから、保存済み契約と合わせて `validateContracts` を呼び、
  契約・対象案件・目安時間を同じトランザクションで更新する。
  契約から外した案件の月別上書きは削除し、残した案件の上書きは維持する。
  月別上書きの保存も同じ取引先ロックを使う。案件の取引先変更は solidtime の同期に従う。
- 月別上書きの主キーは `[contractId, projectId, month]` の JSON 文字列。
  `NULL` を含む UNIQUE 制約の違いに依存せず、契約全体の上書きも 1 件にする。
  記録日時は `recorded_at` に保存する。
- 期間の両端は含む。打刻・不在の入れ替えは期間と整数値を検証してから、
  削除と挿入を同じトランザクションで実行する。空の入力は期間内の削除を意味する。
- 一覧は JavaScript のコード単位順で比較し、DB ごとの文字列の並び順(collation)に左右されないようにする。
  取引先・案件は名前→id、契約は開始日→id、日次稼働は案件 id→日付→単価（`null` を先頭）、
  月別上書きは対象月→契約 id→案件 id（`null` を先頭）で並べる。
- 稼働は案件・日・単価ごとに集計し、billable な打刻だけを含める。未連携の打刻も保存し、未連携一覧で別に集計する。
  案件 ID は solidtime project ID そのもの。プロジェクトなし・未取り込みの project の打刻が未連携となる。
- `syncSolidtimeCatalog({ clients, projects })` は名前・取引先・アーカイブ・単価を更新し、請求設定と Drive フォルダ ID を保持する。
  応答に含まれない取引先・案件は削除せずアーカイブする。`listProjects` は既定でアーカイブを除き、`includeArchived: true` で全件を返す。
- `replaceSolidtimeData` はカタログ・打刻・案件の今の単価を同じトランザクションで更新し、打刻の保存失敗でもカタログを戻す。
  案件の今の単価には、同期期間外も含め、開始時刻が最新の billable な打刻の単価を使う。未設定なら `null` のままにする。
  開始時刻が同じ打刻は ID の昇順で選ぶ。打刻がなければ、取り込んだ案件の単価を使う。
- `002_solidtime_source` は本番投入前のリセット用マイグレーション。旧 ID を持つ取引先・案件・契約・月別上書き・打刻のテーブルを再作成する。
  不在と同期記録は保持する。旧データの移行・復元は行わない。

- `003_time_entry_rates` は打刻に単価の列を足す。既存データは残し、単価は再同期まで `null` にする。

## 要件 2 章とテスト API の表現差

テストの不在 API は日付ごとの秒数だけを受け取るため、この API では Calendar の
イベント ID や開始・終了日時を復元・保存できない。不在はテストどおり日次集計を保存する。
打刻の開始・終了日時もテストでは渡されないため、任意項目として受け取り保存する。
月別上書きの記録日時は内部で保存し、既存テストの戻り値には追加しない。
請求見込み・請求書ガイド・予測の計算は `@fpm/domain` 側の責務とし、
今回のリポジトリ API には計算結果の保存操作を追加していない。
