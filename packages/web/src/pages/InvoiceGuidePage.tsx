import { Alert, Button, EmptyState, Select, TextField } from "@kurotch-homelab/forma-react";
import type { InvoiceGuide } from "@fpm/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api-client.ts";
import { errorMessage } from "../errors.ts";
import { formatHours, formatRate, formatYen } from "../format.ts";
import { useApiQuery } from "../use-api-query.ts";

const monthPattern = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

function GuideContent({ guide }: { guide: InvoiceGuide }) {
  const [notice, setNotice] = useState<{ error: boolean; text: string; id: number } | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const active = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function copy(label: string, value: string) {
    if (copying !== null) return;
    const id = ++sequence.current;
    setCopying(label);
    setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("このブラウザではクリップボードを利用できません");
      await navigator.clipboard.writeText(value);
      if (active.current) setNotice({ error: false, text: "コピーしました", id });
    } catch (error) {
      if (active.current) setNotice({ error: true, text: `コピーできませんでした。${errorMessage(error)}。表示された値を選択してコピーしてください。`, id });
    } finally {
      if (active.current) setCopying(null);
    }
  }

  function copyButton(label: string, value: string) {
    return <Button size="sm" variant="ghost" aria-label={`${label}をコピー`} loading={copying === label}
      aria-disabled={copying !== null} onClick={() => void copy(label, value)}>コピー</Button>;
  }

  return (
    <section className="guide-content page-stack" aria-label={`${guide.clientName} の請求書ガイド`}>
      <div className="section-heading"><h2>{guide.clientName} の請求内容</h2></div>
      {notice && <Alert key={notice.id} tone={notice.error ? "danger" : "success"}>{notice.text}</Alert>}
      {guide.warnings.map((warning) => <Alert key={`${warning.kind}:${warning.projectId}`} tone="warning">
        {warning.kind === "missingRate"
          ? `${warning.projectName} の稼働のうち、単価が未設定の ${formatHours(warning.seconds)} を請求に入れていません`
          : `${warning.projectName}: 契約に入っていない稼働 ${formatHours(warning.seconds)}`}
      </Alert>)}
      {guide.lines.length === 0 && <EmptyState title="請求に含められる明細はありません" />}
      <dl className="guide-fields">
        {[
          { label: "件名", value: guide.subject },
          { label: "請求日", value: guide.invoiceDate },
          { label: "支払期日", value: guide.dueDate },
        ].map(({ label, value }) => (
          <div key={label}><dt>{label}</dt><dd><span>{value}</span>{copyButton(label, value)}</dd></div>
        ))}
      </dl>

      <div className="f-data-table table-frame">
        <div className="f-table-scroll" role="group" tabIndex={0} aria-label="明細（横スクロール）">
          <table className="invoice-table" aria-label="明細">
            <caption>明細</caption>
            <thead><tr>
              <th scope="col">品目</th><th scope="col" className="numeric">数量</th><th scope="col">単位</th>
              <th scope="col" className="numeric">単価</th><th scope="col" className="numeric">金額</th>
            </tr></thead>
            <tbody>{guide.lines.map((line, index) => (
              <tr key={`${index}-${line.item}`}>
                <th scope="row"><div className="copy-value"><span>{line.item}</span>{copyButton(`${line.item} の品目`, line.item)}</div></th>
                <td className="numeric"><div className="copy-value"><span>{line.quantity}</span>{copyButton(`${line.item} の数量`, String(line.quantity))}</div></td>
                <td><div className="copy-value"><span>{line.unit}</span>{copyButton(`${line.item} の単位`, line.unit)}</div></td>
                <td className="numeric"><div className="copy-value"><span>{formatRate(line.unitPrice)}</span>{copyButton(`${line.item} の単価`, String(line.unitPrice))}</div></td>
                <td className="numeric"><div className="copy-value"><span>{formatYen(line.amount)}</span>{copyButton(`${line.item} の金額`, String(line.amount))}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <dl className="invoice-totals">
        {[
          { label: "税抜", value: guide.subtotal },
          { label: "消費税", value: guide.tax },
          { label: "税込", value: guide.total },
        ].map(({ label, value }) => <div key={label} className={label === "税込" ? "total-row" : undefined}>
          <dt>{label}</dt><dd className="numeric"><span>{formatYen(value)}</span>{copyButton(label, String(value))}</dd>
        </div>)}
      </dl>
      <dl className="guide-fields guide-note"><div><dt>備考</dt><dd>
        <span>{guide.note ?? "なし"}</span>
        {guide.note !== null && copyButton("備考", guide.note)}
      </dd></div></dl>
    </section>
  );
}

export function InvoiceGuidePage({ api, defaultMonth }: { api: ApiClient; defaultMonth: string }) {
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState(defaultMonth);
  const [monthTouched, setMonthTouched] = useState(false);
  const validMonth = monthPattern.test(month);
  const clients = useApiQuery(useCallback(() => api.listClients(), [api]));
  const guide = useApiQuery(useCallback(() => clientId && validMonth
    ? api.invoiceGuide({ clientId, month })
    : Promise.resolve(undefined), [api, clientId, month, validMonth]));

  return (
    <div className="page-stack">
      <div className="page-heading">
        <h1>請求書ガイド</h1>
        <p className="muted">取引先と対象月を選び、freee に入力する内容を項目ごとにコピーできます。</p>
      </div>
      <div className="guide-filters">
        <Select label="取引先" name="clientId" value={clientId} onValueChange={setClientId}
          placeholder="取引先を選択" disabled={clients.loading || clients.data === undefined || clients.data.length === 0}
          options={(clients.data ?? []).map((client) => ({ value: client.id, label: client.name }))} />
        <TextField label="対象月" name="month" value={month} onValueChange={setMonth} type="text"
          description="YYYY-MM 形式（例: 2026-11）" pattern="[0-9]{4}-(0[1-9]|1[0-2])" autoComplete="off" required
          onBlur={() => setMonthTouched(true)} error={monthTouched && !validMonth ? "対象月を YYYY-MM 形式で入力してください" : undefined} />
      </div>

      {clients.loading && <p aria-live="polite">取引先を読み込んでいます…</p>}
      {clients.error !== null && <Alert tone="danger" title="取引先を読み込めませんでした">
        <p>{clients.error}</p><Button loading={clients.loading} onClick={() => void clients.reload()}>取引先を再読み込み</Button>
      </Alert>}
      {!clients.loading && clients.data?.length === 0 && <EmptyState title="取引先が登録されていません" />}
      {!clientId && (clients.data?.length ?? 0) > 0 && <p className="muted">取引先と対象月を選択してください。</p>}
      {clientId && validMonth && <>
        {guide.loading && <p aria-live="polite">請求書ガイドを読み込んでいます…</p>}
        {guide.error !== null && <Alert tone="danger" title="請求書ガイドを読み込めませんでした">
          <p>{guide.error}</p><Button loading={guide.loading} onClick={() => void guide.reload()}>再読み込み</Button>
        </Alert>}
        {!guide.loading && guide.error === null && guide.data === null && <EmptyState title="この月の請求はありません" />}
        {guide.data && <GuideContent key={`${clientId}/${month}`} guide={guide.data} />}
      </>}
    </div>
  );
}
