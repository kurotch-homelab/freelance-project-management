import { Button, EmptyState, NumberField, Select, TextArea, TextField } from "@kurotch-homelab/forma-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ApiClient, Contract, HoursRangeOverrideKey, HoursRangeOverrideRecord, Project } from "../api-client.ts";
import { errorMessage, redirectIfUnauthorized } from "../errors.ts";
import { rangeErrors, rangeFromInputs } from "./hours-range-form.ts";
import { MasterTable, QueryFeedback, SaveFeedback, type FieldErrors, type SaveNotice } from "./master-page.tsx";

export function HoursRangeOverrides({ id, api, contract, projects, onClose }: {
  id: string;
  api: ApiClient;
  contract: Contract;
  projects: readonly Project[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<readonly HoursRangeOverrideRecord[]>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<SaveNotice | null>(null);
  const [month, setMonth] = useState("");
  const [projectId, setProjectId] = useState("");
  const [minHours, setMinHours] = useState<number | null>(null);
  const [maxHours, setMaxHours] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const monthInput = useRef<HTMLInputElement>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  const formHeadingId = useId();
  const title = `${contract.name} の月ごとの目安時間`;
  const targetName = (id: string | null) => id === null ? "契約全体" : projects.find((project) => project.id === id)?.name ?? id;

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await api.listHoursRangeOverrides({ contractId: contract.id });
      if (!active.current || generation.current !== current) return false;
      setRows(next);
      return true;
    } catch (error) {
      if (active.current && generation.current === current && !redirectIfUnauthorized(error)) setLoadError(errorMessage(error));
      return false;
    } finally {
      if (active.current && generation.current === current) setLoading(false);
    }
  }, [api, contract.id]);

  useEffect(() => {
    active.current = true;
    heading.current?.focus();
    void reload();
    return () => { active.current = false; generation.current += 1; };
  }, [reload]);
  useEffect(() => {
    if (Object.keys(errors).length > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  useEffect(() => {
    if (!saving && deleteTrigger.current) {
      // 削除したボタンにいた場合だけ、次の入力先へ移す。外に移したフォーカスは奪わない。
      if (!deleteTrigger.current.isConnected && document.activeElement === document.body) monthInput.current?.focus();
      deleteTrigger.current = null;
    }
  }, [rows, saving]);

  async function mutate(operation: () => Promise<void>, deleting = false) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setNotice(null);
    setLoadError(null);
    try {
      await operation();
      if (!active.current) return;
      if (await reload()) {
        setNotice({ error: false, text: deleting ? "消しました" : "保存しました" });
        if (!deleting) {
          setMonth(""); setProjectId(""); setMinHours(null); setMaxHours(null); setNote(""); setErrors({});
        }
      }
    } catch (error) {
      if (active.current && !redirectIfUnauthorized(error)) {
        setNotice({ error: true, text: `${deleting ? "消せませんでした" : "保存できませんでした"}: ${errorMessage(error)}` });
      }
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  }

  function submit(element: HTMLFormElement) {
    const range = rangeFromInputs(minHours, maxHours);
    const next = rangeErrors(element, range, "minHours", "maxHours");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) next.month = "対象月は YYYY-MM 形式で入力してください";
    if (minHours === null && maxHours === null && !next.minHours) next.minHours = "下限か上限を入力してください";
    if (projectId !== "" && !contract.projectIds.includes(projectId)) next.projectId = "契約の案件を選択してください";
    setNotice(null);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    void mutate(() => api.saveHoursRangeOverride({ contractId: contract.id, projectId: projectId || null, month, range, note }));
  }

  return <section id={id} className="page-stack" aria-label={title}>
    <div className="master-heading">
      <h2 ref={heading} tabIndex={-1}>{title}</h2>
      <Button disabled={saving} onClick={onClose}>閉じる</Button>
    </div>
    <SaveFeedback notice={notice} />
    <QueryFeedback label="月ごとの目安時間" query={{ loading, error: loadError, reload: async () => { await reload(); } }} />
    {rows && <MasterTable label="月ごとの目安時間">
      <thead><tr><th scope="col">対象月</th><th scope="col">対象</th><th scope="col" className="numeric">下限</th>
        <th scope="col" className="numeric">上限</th><th scope="col">メモ</th><th scope="col">操作</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={JSON.stringify([row.month, row.projectId])}>
        <th scope="row">{row.month}</th><td>{targetName(row.projectId)}</td>
        <td className="numeric">{row.range.minHours === undefined ? "—" : `${row.range.minHours} 時間`}</td>
        <td className="numeric">{row.range.maxHours === undefined ? "—" : `${row.range.maxHours} 時間`}</td>
        <td className="override-note">{row.note || "—"}</td>
        <td><Button size="sm" variant="danger" loading={saving} disabled={loading && !saving}
          aria-label={`${row.month} ${targetName(row.projectId)} の上書きを消す`} onClick={(event) => {
            deleteTrigger.current = event.currentTarget;
            const key: HoursRangeOverrideKey = { contractId: contract.id, projectId: row.projectId, month: row.month };
            void mutate(() => api.deleteHoursRangeOverride(key), true);
          }}>消す</Button></td>
      </tr>)}</tbody>
    </MasterTable>}
    {rows?.length === 0 && <EmptyState title="月ごとの上書きはありません" description="その月だけ目安時間を変えるときは、下のフォームから追加してください。" />}
    <form ref={form} className="master-form" aria-labelledby={formHeadingId} noValidate aria-busy={saving}
      onSubmit={(event) => { event.preventDefault(); if (!busy.current) submit(event.currentTarget); }}>
      <h3 id={formHeadingId}>上書きを追加</h3>
      <p className="muted">下限か上限を入力してください。同じ対象月・対象の登録は置き換えます。</p>
      <fieldset className="master-fields" disabled={saving}>
        <div className="form-grid">
          <TextField ref={monthInput} label="対象月" name="month" value={month} required description="YYYY-MM（例: 2027-02）"
            error={errors.month} onValueChange={setMonth} />
          <Select label="対象" name="projectId" value={projectId} error={errors.projectId} onValueChange={setProjectId}
            options={[{ value: "", label: "契約全体" }, ...contract.projectIds.map((value) => ({ value, label: targetName(value) }))]} />
          <NumberField label="下限(時間)" name="minHours" value={minHours} min={0} step="any" description="0 以上の時間（小数可）。"
            error={errors.minHours} onValueChange={setMinHours} />
          <NumberField label="上限(時間)" name="maxHours" value={maxHours} min={0} step="any" description="0 以上で、下限以上の時間（小数可）。"
            error={errors.maxHours} onValueChange={setMaxHours} />
        </div>
        <TextArea label="メモ" name="note" value={note} description="任意。合意した内容を記録してください。" onValueChange={setNote} />
      </fieldset>
      <div className="form-actions"><Button type="submit" variant="primary" loading={saving}>上書きを追加</Button></div>
    </form>
  </section>;
}
