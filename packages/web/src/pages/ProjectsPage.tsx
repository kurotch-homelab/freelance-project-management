import { Button, EmptyState, Select, TextField } from "@kurotch-homelab/forma-react";
import { useCallback, useState } from "react";
import type { Client, Project } from "../api-client.ts";
import { useApiQuery } from "../use-api-query.ts";
import {
  MasterForm, MasterTable, QueryFeedback, SaveFeedback, randomId, useMasterEditor,
  type EditorFormProps, type FieldErrors, type MasterPageProps,
} from "./master-page.tsx";

const statuses: Record<Project["status"], string> = { proposed: "提案中", won: "受注", active: "稼働中", completed: "完了", lost: "失注" };
const statusOptions = Object.entries(statuses).map(([value, label]) => ({ value, label }));

function ProjectForm({ initial, clients, title, saving, onCancel, onSave }: EditorFormProps<Project> & { clients: readonly Client[] }) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    const next: FieldErrors = {};
    if (!value.name.trim()) next.name = "名前を入力してください";
    if (!clients.some((client) => client.id === value.clientId)) next.clientId = "取引先を選択してください";
    setErrors(next);
    if (Object.keys(next).length === 0) onSave({ ...value, solidtimeProjectId: value.solidtimeProjectId?.trim() || null });
  }
  return <MasterForm {...{ title, saving, errors, onCancel }} onSubmit={submit}>
    <Select label="取引先" name="clientId" value={value.clientId} required placeholder="取引先を選択" error={errors.clientId}
      options={clients.map((client) => ({ value: client.id, label: client.name }))}
      onValueChange={(clientId) => setValue({ ...value, clientId })} />
    <TextField label="名前" name="name" value={value.name} required error={errors.name}
      onValueChange={(name) => setValue({ ...value, name })} />
    <Select label="ステータス" name="status" value={value.status} options={statusOptions} required
      onValueChange={(status) => setValue({ ...value, status: status as Project["status"] })} />
    <TextField label="solidtime のプロジェクト ID" name="solidtimeProjectId" value={value.solidtimeProjectId ?? ""}
      description="任意。solidtime のプロジェクトと結びつける場合に入力してください。"
      onValueChange={(solidtimeProjectId) => setValue({ ...value, solidtimeProjectId })} />
  </MasterForm>;
}

export function ProjectsPage({ api, newId = randomId }: MasterPageProps) {
  const query = useApiQuery(useCallback(async () => {
    const [projects, clients] = await Promise.all([api.listProjects(), api.listClients()]);
    return { projects, clients };
  }, [api]));
  const editor = useMasterEditor<Project>(query.reload);
  return <div className="page-stack">
    <div className="master-heading">
      <div className="page-heading"><h1>案件</h1><p className="muted">取引先ごとの案件と進行状況を管理します。</p></div>
      <Button variant="primary" disabled={!query.data || editor.editing !== null || editor.saving} onClick={() => editor.open({
        id: newId(), clientId: "", name: "", status: "proposed", solidtimeProjectId: null, driveFolderId: null,
      }, "案件を追加")}>案件を追加</Button>
    </div>
    <SaveFeedback notice={editor.notice} />
    {editor.editing && query.data && <ProjectForm initial={editor.editing.value} clients={query.data.clients}
      title={editor.editing.title} saving={editor.saving} onCancel={editor.cancel}
      onSave={(project) => void editor.save(() => api.saveProject(project))} />}
    <QueryFeedback label="案件と取引先" query={query} />
    {query.data?.clients.length === 0 && <p className="muted">案件を登録するには、先に取引先を登録してください。</p>}
    {query.data && <MasterTable label="案件">
      <thead><tr><th scope="col">名前</th><th scope="col">取引先</th><th scope="col">ステータス</th><th scope="col">solidtime のプロジェクト ID</th><th scope="col">操作</th></tr></thead>
      <tbody>{query.data.projects.map((project) => <tr key={project.id}>
        <th scope="row">{project.name}</th><td>{query.data!.clients.find((client) => client.id === project.clientId)?.name ?? project.clientId}</td>
        <td>{statuses[project.status]}</td><td>{project.solidtimeProjectId ?? "未連携"}</td>
        <td><Button size="sm" aria-label={`${project.name} を編集`} disabled={editor.editing !== null || editor.saving}
          onClick={() => editor.open(project, `${project.name} を編集`)}>編集</Button></td>
      </tr>)}</tbody>
    </MasterTable>}
    {query.data?.projects.length === 0 && <EmptyState title="案件が登録されていません" description="「案件を追加」から登録してください。" />}
  </div>;
}
