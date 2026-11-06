import { Button, EmptyState, Select, TextField } from "@kurotch-homelab/forma-react";
import { useCallback, useState } from "react";
import type { Client } from "../api-client.ts";
import { useApiQuery } from "../use-api-query.ts";
import {
  MasterForm, MasterTable, QueryFeedback, SaveFeedback, randomId, useMasterEditor,
  type EditorFormProps, type FieldErrors, type MasterPageProps,
} from "./master-page.tsx";

const days = [
  ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}日` })),
  { value: "end", label: "月末" },
];
const monthName = (offset: number) => ["当月", "翌月", "翌々月"][offset] ?? `${offset}か月後`;
const months = Array.from({ length: 13 }, (_, i) => ({ value: String(i), label: monthName(i) }));
const dayValue = (value: string) => value === "end" ? "end" : Number(value);

function paymentTermsText({ closingDay, paymentMonthOffset, paymentDay }: Client["paymentTerms"]) {
  const paymentMonth = paymentMonthOffset > 2 ? `${monthName(paymentMonthOffset)}の` : monthName(paymentMonthOffset);
  const paymentDate = paymentDay === "end" ? (paymentMonthOffset > 2 ? "月末" : "末") : `${paymentDay}日`;
  return `${closingDay === "end" ? "月末" : `${closingDay}日`}締め ${paymentMonth}${paymentDate}払い`;
}

function ClientForm({ initial, title, saving, onCancel, onSave }: EditorFormProps<Client>) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    const next: FieldErrors = {};
    if (!value.name.trim()) next.name = "名前を入力してください";
    if (!value.subjectTemplate.trim()) next.subjectTemplate = "件名のひな形を入力してください";
    const terms = value.paymentTerms;
    for (const field of ["closingDay", "paymentDay"] as const) {
      const day = terms[field];
      if (day !== "end" && (!Number.isInteger(day) || day < 1 || day > 28)) {
        next[field] = "1〜28日または月末を選択してください";
      }
    }
    if (!Number.isInteger(terms.paymentMonthOffset) || terms.paymentMonthOffset < 0 || terms.paymentMonthOffset > 12) {
      next.paymentMonthOffset = "当月〜12か月後を選択してください";
    }
    if (terms.paymentMonthOffset === 0 && (terms.paymentDay === "end" ? 31 : terms.paymentDay)
      < (terms.closingDay === "end" ? 31 : terms.closingDay)) {
      next.paymentDay = "当月払いの支払日は締め日以降を選択してください";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) onSave(value);
  }
  return <MasterForm {...{ title, saving, errors, onCancel }} onSubmit={submit}>
    <TextField label="名前" name="name" value={value.name} required error={errors.name}
      onValueChange={(name) => setValue({ ...value, name })} />
    <div className="form-grid">
      <Select label="締め日" name="closingDay" value={String(value.paymentTerms.closingDay)} options={days} required
        error={errors.closingDay} onValueChange={(day) => setValue({ ...value, paymentTerms: { ...value.paymentTerms, closingDay: dayValue(day) } })} />
      <Select label="支払月" name="paymentMonthOffset" value={String(value.paymentTerms.paymentMonthOffset)} options={months} required
        error={errors.paymentMonthOffset} onValueChange={(offset) => setValue({ ...value, paymentTerms: { ...value.paymentTerms, paymentMonthOffset: Number(offset) } })} />
      <Select label="支払日" name="paymentDay" value={String(value.paymentTerms.paymentDay)} options={days} required
        error={errors.paymentDay} onValueChange={(day) => setValue({ ...value, paymentTerms: { ...value.paymentTerms, paymentDay: dayValue(day) } })} />
    </div>
    <TextField label="件名のひな形" name="subjectTemplate" value={value.subjectTemplate} required error={errors.subjectTemplate}
      description="{YYYY} は年（2026）、{M} は月（1）、{MM} は2桁の月（01）に置き換わります。"
      onValueChange={(subjectTemplate) => setValue({ ...value, subjectTemplate })} />
    <Select label="明細のまとめ方" name="lineGrouping" value={value.lineGrouping} required
      options={[{ value: "project", label: "案件ごと" }, { value: "contract", label: "契約ごと" }]}
      onValueChange={(lineGrouping) => setValue({ ...value, lineGrouping: lineGrouping as Client["lineGrouping"] })} />
  </MasterForm>;
}

export function ClientsPage({ api, newId = randomId }: MasterPageProps) {
  const clients = useApiQuery(useCallback(() => api.listClients(), [api]));
  const editor = useMasterEditor<Client>(clients.reload);
  return <div className="page-stack">
    <div className="master-heading">
      <div className="page-heading"><h1>取引先</h1><p className="muted">取引先と請求書の支払条件を管理します。</p></div>
      <Button variant="primary" disabled={editor.editing !== null || editor.saving} onClick={() => editor.open({
        id: newId(), name: "", paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
        subjectTemplate: "{YYYY}年{M}月分 業務委託料", lineGrouping: "project", solidtimeClientId: null, driveFolderId: null,
      }, "取引先を追加")}>取引先を追加</Button>
    </div>
    <SaveFeedback notice={editor.notice} />
    {editor.editing && <ClientForm initial={editor.editing.value} title={editor.editing.title} saving={editor.saving}
      onCancel={editor.cancel} onSave={(client) => void editor.save(() => api.saveClient(client))} />}
    <QueryFeedback label="取引先" query={clients} />
    {clients.data && <MasterTable label="取引先">
      <thead><tr><th scope="col">名前</th><th scope="col">支払条件</th><th scope="col">明細のまとめ方</th><th scope="col">操作</th></tr></thead>
      <tbody>{clients.data.map((client) => <tr key={client.id}>
        <th scope="row">{client.name}</th><td>{paymentTermsText(client.paymentTerms)}</td>
        <td>{client.lineGrouping === "project" ? "案件ごと" : "契約ごと"}</td>
        <td><Button size="sm" aria-label={`${client.name} を編集`} disabled={editor.editing !== null || editor.saving}
          onClick={() => editor.open(client, `${client.name} を編集`)}>編集</Button></td>
      </tr>)}</tbody>
    </MasterTable>}
    {clients.data?.length === 0 && <EmptyState title="取引先が登録されていません" description="「取引先を追加」から登録してください。" />}
  </div>;
}
