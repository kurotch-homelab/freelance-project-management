import { Button, Checkbox, DatePicker, EmptyState, NumberField, Select, TextField } from "@kurotch-homelab/forma-react";
import { useCallback, useId, useState } from "react";
import type { Client, Contract, Project, SaveContractResult } from "../api-client.ts";
import { formatYen } from "../format.ts";
import { useApiQuery } from "../use-api-query.ts";
import {
  MasterForm, MasterTable, QueryFeedback, SaveFeedback, randomId, useMasterEditor,
  type EditorFormProps, type FieldErrors, type MasterPageProps, type SaveNotice,
} from "./master-page.tsx";

const renewals: Record<Contract["renewalOutlook"], string> = { likely: "見込みあり", undecided: "未定", ending: "終了" };
const renewalOptions = Object.entries(renewals).map(([value, label]) => ({ value, label }));
const validRate = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 1;
const validHours = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0);
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function ratePushNotice({ pushRates }: SaveContractResult, projects: readonly Project[]): SaveNotice {
  if (!pushRates.ok) return {
    error: true,
    text: `契約は保存しました。solidtime への単価の反映に失敗しました: ${pushRates.error}`,
  };
  return {
    error: false,
    text: pushRates.skipped.length > 0 && pushRates.pushed.length === 0
      ? "保存しました" : "保存しました。solidtime に単価を反映しました",
    details: pushRates.skipped.map((item) => item.reason === "noSolidtimeProject"
      ? `${projects.find((project) => project.id === item.projectId)?.name ?? item.projectId} は solidtime のプロジェクトに結びついていないため、単価を反映していません`
      : "この契約は本日の適用対象ではないため、solidtime に単価を反映していません"),
  };
}

function ContractForm({ initial, clients, projects, title, saving, onCancel, onSave }: EditorFormProps<Contract> & {
  clients: readonly Client[];
  projects: readonly Project[];
}) {
  const [value, setValue] = useState(initial);
  const [hourlyRate, setHourlyRate] = useState<number | null>(initial.hourlyRate || null);
  const [projectRates, setProjectRates] = useState<Record<string, number | null>>({ ...initial.projectRates });
  const [minHours, setMinHours] = useState<number | null>(initial.hoursRange?.minHours ?? null);
  const [maxHours, setMaxHours] = useState<number | null>(initial.hoursRange?.maxHours ?? null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const projectsErrorId = useId();
  const availableProjects = projects.filter((project) => project.clientId === value.clientId);

  function submit(form: HTMLFormElement) {
    const next: FieldErrors = {};
    // number/date の不完全な入力は DOM 上で空文字になるため、任意欄でも空欄と区別する。
    function badInput(name: string) {
      const input = form.elements.namedItem(name);
      return input instanceof HTMLInputElement && input.validity.badInput;
    }
    if (!clients.some((client) => client.id === value.clientId)) next.clientId = "取引先を選択してください";
    if (!value.name.trim()) next.name = "名前を入力してください";
    if (!validDate(value.start)) next.start = "開始日を YYYY-MM-DD 形式の有効な日付で入力してください";
    if (badInput("end") || (value.end !== null && !validDate(value.end))) next.end = "終了日を YYYY-MM-DD 形式の有効な日付で入力してください";
    else if (value.end !== null && validDate(value.start) && value.end < value.start) next.end = "終了日は開始日以降にしてください";
    if (badInput("hourlyRate") || !validRate(hourlyRate)) next.hourlyRate = "時間単価は 1 円以上の整数で入力してください";
    if (value.projectIds.length === 0) next.projectIds = "案件を1つ以上選択してください";
    else if (value.projectIds.some((id) => !availableProjects.some((project) => project.id === id))) {
      next.projectIds = "選んだ取引先の案件を選択してください";
    }
    // 入力対象外の目安時間を消さず、API が拒否する関連付けの解除を防ぐ。
    if (Object.keys(initial.projectHoursRanges ?? {}).some((id) => !value.projectIds.includes(id))) {
      next.projectIds = "案件ごとの目安時間が登録されている案件は、この画面では外せません。元の取引先と案件を選択してください";
    }
    for (const projectId of value.projectIds) {
      const rate = projectRates[projectId];
      if (badInput(`projectRate:${projectId}`) || (rate != null && !validRate(rate))) next[`rate:${projectId}`] = "単価は 1 円以上の整数で入力してください";
    }
    if (badInput("minHours") || !validHours(minHours)) next.minHours = "月の下限は 0 以上の時間を入力してください";
    if (badInput("maxHours") || !validHours(maxHours)) next.maxHours = "月の上限は 0 以上の時間を入力してください";
    if (minHours !== null && maxHours !== null && minHours > maxHours) next.maxHours = "月の上限は下限以上にしてください";
    setErrors(next);
    if (Object.keys(next).length > 0 || !validRate(hourlyRate)) return;

    const { hoursRange: previousHoursRange, ...preserved } = value;
    onSave({
      ...preserved,
      hourlyRate,
      projectRates: Object.fromEntries(value.projectIds.flatMap((id) => {
        const rate = projectRates[id];
        return rate == null ? [] : [[id, rate]];
      })),
      ...(minHours === null && maxHours === null ? {} : { hoursRange: {
        ...(minHours === null ? {} : { minHours }),
        ...(maxHours === null ? {} : { maxHours }),
      } }),
    });
  }

  return <MasterForm {...{ title, saving, errors, onCancel }} onSubmit={submit}>
    <Select label="取引先" name="clientId" value={value.clientId} placeholder="取引先を選択" required error={errors.clientId}
      options={clients.map((client) => ({ value: client.id, label: client.name }))}
      onValueChange={(clientId) => {
        setValue({ ...value, clientId, projectIds: [] });
        setProjectRates({});
      }} />
    <TextField label="名前" name="name" value={value.name} required error={errors.name}
      onValueChange={(name) => setValue({ ...value, name })} />
    <div className="form-grid">
      <DatePicker label="開始日" name="start" value={value.start} required error={errors.start}
        onValueChange={(start) => setValue({ ...value, start })} />
      <DatePicker label="終了日" name="end" value={value.end ?? ""} description="任意。終了日が未定なら空欄にしてください。"
        error={errors.end} onValueChange={(end) => setValue({ ...value, end: end || null })} />
    </div>
    <NumberField label="時間単価" name="hourlyRate" value={hourlyRate} onValueChange={setHourlyRate} min={1} step={1}
      description="1 円以上の整数（円/時間）" required error={errors.hourlyRate} />
    <fieldset className="project-choices" tabIndex={-1} aria-invalid={!!errors.projectIds} aria-describedby={projectsErrorId}>
      <legend>案件</legend>
      <p id={projectsErrorId} className={errors.projectIds ? "f-error" : "muted"} role={errors.projectIds ? "alert" : undefined}>
        {errors.projectIds ?? (value.clientId ? "契約の対象となる案件を1つ以上選択してください。" : "取引先を選ぶと案件を選択できます。")}
      </p>
      {value.clientId && availableProjects.length === 0 && <p className="muted">この取引先の案件はありません。先に案件を登録してください。</p>}
      {value.clientId && availableProjects.map((project) => <div className="project-choice" key={project.id}>
        <Checkbox label={project.name} name="projectIds" value={project.id} checked={value.projectIds.includes(project.id)}
          aria-invalid={!!errors.projectIds} aria-describedby={projectsErrorId}
          onCheckedChange={(checked) => setValue({ ...value, projectIds: checked
            ? [...value.projectIds, project.id] : value.projectIds.filter((id) => id !== project.id) })} />
        {value.projectIds.includes(project.id) && <NumberField label={`${project.name} の単価`} name={`projectRate:${project.id}`}
          value={projectRates[project.id] ?? null} min={1} step={1} description="任意。空欄の場合は契約の時間単価を使います（円/時間）。"
          error={errors[`rate:${project.id}`]} onValueChange={(rate) => setProjectRates({ ...projectRates, [project.id]: rate })} />}
      </div>)}
    </fieldset>
    <div className="form-grid">
      <NumberField label="月の下限(時間)" name="minHours" value={minHours} onValueChange={setMinHours} min={0} step="any"
        description="任意。0 以上の時間（小数可）。" error={errors.minHours} />
      <NumberField label="月の上限(時間)" name="maxHours" value={maxHours} onValueChange={setMaxHours} min={0} step="any"
        description="任意。0 以上で、下限以上の時間（小数可）。" error={errors.maxHours} />
    </div>
    <Select label="更新の見込み" name="renewalOutlook" value={value.renewalOutlook} options={renewalOptions} required
      onValueChange={(renewalOutlook) => setValue({ ...value, renewalOutlook: renewalOutlook as Contract["renewalOutlook"] })} />
  </MasterForm>;
}

export function ContractsPage({ api, newId = randomId }: MasterPageProps) {
  const query = useApiQuery(useCallback(async () => {
    const [contracts, clients, projects] = await Promise.all([api.listContracts(), api.listClients(), api.listProjects()]);
    return { contracts, clients, projects };
  }, [api]));
  const editor = useMasterEditor<Contract>(query.reload);
  return <div className="page-stack">
    <div className="master-heading">
      <div className="page-heading"><h1>契約</h1><p className="muted">契約期間、時間単価と月の目安時間を管理します。</p></div>
      <Button variant="primary" disabled={!query.data || editor.editing !== null || editor.saving} onClick={() => editor.open({
        id: newId(), clientId: "", name: "", start: "", end: null, hourlyRate: 0,
        projectIds: [], projectRates: {}, renewalOutlook: "undecided",
      }, "契約を追加")}>契約を追加</Button>
    </div>
    <SaveFeedback notice={editor.notice} />
    {editor.editing && query.data && <ContractForm initial={editor.editing.value} clients={query.data.clients} projects={query.data.projects}
      title={editor.editing.title} saving={editor.saving} onCancel={editor.cancel}
      onSave={(contract) => void editor.save(async () => ratePushNotice(await api.saveContract(contract), query.data!.projects))} />}
    <QueryFeedback label="契約・取引先・案件" query={query} />
    {query.data?.clients.length === 0 && <p className="muted">契約を登録するには、先に取引先と案件を登録してください。</p>}
    {query.data && <MasterTable label="契約">
      <thead><tr><th scope="col">名前</th><th scope="col">取引先</th><th scope="col">期間</th><th scope="col" className="numeric">時間単価</th><th scope="col">更新の見込み</th><th scope="col">操作</th></tr></thead>
      <tbody>{query.data.contracts.map((contract) => <tr key={contract.id}>
        <th scope="row">{contract.name}</th><td>{query.data!.clients.find((client) => client.id === contract.clientId)?.name ?? contract.clientId}</td>
        <td>{contract.start} 〜{contract.end ? ` ${contract.end}` : ""}</td>
        <td className="numeric">{formatYen(contract.hourlyRate)}/時間</td><td>{renewals[contract.renewalOutlook]}</td>
        <td><Button size="sm" aria-label={`${contract.name} を編集`} disabled={editor.editing !== null || editor.saving}
          onClick={() => editor.open(contract, `${contract.name} を編集`)}>編集</Button></td>
      </tr>)}</tbody>
    </MasterTable>}
    {query.data?.contracts.length === 0 && <EmptyState title="契約が登録されていません" description="「契約を追加」から登録してください。" />}
  </div>;
}
