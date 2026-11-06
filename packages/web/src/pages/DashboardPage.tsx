import { Alert, Badge, Button, EmptyState } from "@kurotch-homelab/forma-react";
import type { HoursRangeWarning } from "@fpm/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, SyncSource } from "../api-client.ts";
import { errorMessage, redirectIfUnauthorized } from "../errors.ts";
import { formatHours, formatMonth, formatTimestamp, formatYen } from "../format.ts";
import { useApiQuery } from "../use-api-query.ts";

const sources = ["solidtime", "calendar"] as const;
const sourceNames: Record<SyncSource, string> = { solidtime: "solidtime", calendar: "カレンダー" };

function warningText(warning: HoursRangeWarning): string {
  const hours = formatHours(warning.seconds);
  switch (warning.kind) {
    case "belowMinForecast": return `下限まで ${hours} 不足の見込み`;
    case "aboveMaxForecast": return `上限を ${hours} 超える見込み`;
    case "aboveMaxActual": return `上限を ${hours} 超過`;
  }
}

export function DashboardPage({ api }: { api: ApiClient }) {
  const query = useApiQuery(useCallback(() => api.dashboard(), [api]));
  const [syncing, setSyncing] = useState<SyncSource | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "danger"; text: string } | null>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function sync(source: SyncSource) {
    if (lock.current) return;
    lock.current = true;
    setSyncing(source);
    setNotice(null);
    try {
      const result = await api.sync(source);
      if (!active.current) return;
      setNotice(result.kind === "ok"
        ? { tone: "success", text: `${sourceNames[source]} を同期しました` }
        : result.kind === "busy"
          ? { tone: "info", text: "同期中です。しばらくしてからもう一度お試しください" }
          : { tone: "danger", text: result.error });
      await query.reload();
    } catch (error) {
      if (redirectIfUnauthorized(error) || !active.current) return;
      setNotice({ tone: "danger", text: errorMessage(error) });
      await query.reload();
    } finally {
      lock.current = false;
      if (active.current) setSyncing(null);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <h1>ダッシュボード</h1>
        <p className="muted">契約ごとの稼働時間と、月末の請求見込みを確認できます。</p>
        {query.data && <p className="as-of">集計基準日 <time dateTime={query.data.asOf}>{query.data.asOf}</time></p>}
      </div>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {query.error !== null && (
        <Alert tone="danger" title="見込みを読み込めませんでした">
          <p>{query.error}</p>
          {query.data && <p>前回取得した見込みを表示しています。</p>}
          <Button onClick={() => void query.reload()} loading={query.loading}>再読み込み</Button>
        </Alert>
      )}
      {query.loading && <p aria-live="polite">{query.data ? "見込みを更新中です…" : "見込みを読み込んでいます…"}</p>}

      {query.data && <>
        <section aria-labelledby="sync-heading" className="sync-panel">
          <div className="section-heading">
            <h2 id="sync-heading">データ同期</h2>
            <p className="muted">日時は日本時間（JST）です。</p>
          </div>
          <div className="sync-grid">
            {sources.map((source) => {
              const status = query.data!.sync[source];
              return (
                <div className="sync-source" key={source}>
                  <h3>{sourceNames[source]}</h3>
                  <dl className="sync-details">
                    <div><dt>最終成功日時</dt><dd>{status.lastSuccessAt
                      ? <time dateTime={status.lastSuccessAt}>{formatTimestamp(status.lastSuccessAt)}</time>
                      : "まだ同期されていません"}</dd></div>
                    <div><dt>最後の失敗</dt><dd>{status.lastFailure ? <>
                      <time dateTime={status.lastFailure.at}>{formatTimestamp(status.lastFailure.at)}</time>
                      <p className="sync-error">{status.lastFailure.error ?? "エラーの詳細はありません"}</p>
                    </> : "なし"}</dd></div>
                  </dl>
                  <Button onClick={() => void sync(source)} loading={syncing === source} aria-disabled={syncing !== null}>
                    {source === "solidtime"
                      ? (syncing === source ? "solidtime を同期中…" : "solidtime を同期")
                      : (syncing === source ? "カレンダーを同期中…" : "カレンダーを同期")}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>

        {query.data.months.length === 0 && <EmptyState title="表示する見込みはありません" description="同期して最新のデータを取得してください。" />}
        {query.data.months.map(({ month, contracts }) => (
          <section key={month} aria-label={formatMonth(month)} className="month-section">
            <div className="section-heading">
              <h2>{formatMonth(month)}</h2>
              <span className="muted">{contracts.length} 件の契約</span>
            </div>
            {contracts.length === 0 ? <EmptyState title="この月の契約はありません" /> : (
              <div className="f-data-table table-frame">
                <div className="f-table-scroll" tabIndex={0} role="group" aria-label={`${formatMonth(month)} の契約一覧（横スクロール）`}>
                  <table className="outlook-table">
                    <caption className="sr-only">{formatMonth(month)} の契約別見込み</caption>
                    <thead><tr>
                      <th scope="col">契約</th><th scope="col" className="numeric">実績</th>
                      <th scope="col" className="numeric">予測</th><th scope="col" className="numeric">着地見込み</th>
                      <th scope="col" className="numeric">請求見込み(税込)</th>
                    </tr></thead>
                    <tbody>{contracts.map((contract) => (
                      <tr key={contract.contractId}>
                        <th scope="row" className="contract-cell">
                          <span className="contract-name">{contract.contractName}</span>
                          <div className="badges">
                            {contract.assumesRenewal && <Badge tone="info">更新前提</Badge>}
                            {contract.warnings.map((warning) => <Badge key={warning.kind} tone={warning.kind === "aboveMaxActual" ? "danger" : "warning"}>{warningText(warning)}</Badge>)}
                          </div>
                        </th>
                        <td className="numeric">{formatHours(contract.actualSeconds)}</td>
                        <td className="numeric">{formatHours(contract.forecastSeconds)}</td>
                        <td className="numeric emphasis">{formatHours(contract.landingSeconds)}</td>
                        <td className="numeric emphasis">{formatYen(contract.estimate.total)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        ))}
      </>}
    </div>
  );
}
