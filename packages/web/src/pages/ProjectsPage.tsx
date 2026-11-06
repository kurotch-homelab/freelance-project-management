import { Checkbox, EmptyState } from "@kurotch-homelab/forma-react";
import { useCallback, useState } from "react";
import { formatYen } from "../format.ts";
import { useApiQuery } from "../use-api-query.ts";
import { MasterTable, QueryFeedback, type MasterPageProps } from "./master-page.tsx";

export function ProjectsPage({ api }: MasterPageProps) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const query = useApiQuery(useCallback(async () => {
    const [projects, clients] = await Promise.all([api.listProjects({ includeArchived }), api.listClients()]);
    return { projects, clients };
  }, [api, includeArchived]));
  return <div className="page-stack">
    <div className="page-heading"><h1>案件</h1><p className="muted">案件の追加・名前・単価・アーカイブは solidtime で変えます</p></div>
    <Checkbox label="アーカイブした案件も表示" checked={includeArchived} onCheckedChange={setIncludeArchived} />
    <QueryFeedback label="案件と取引先" query={query} />
    {query.data && <MasterTable label="案件">
      <thead><tr><th scope="col">名前</th><th scope="col">取引先</th><th scope="col">時間単価</th><th scope="col">アーカイブ</th></tr></thead>
      <tbody>{query.data.projects.map((project) => <tr key={project.id}>
        <th scope="row">{project.name}</th>
        <td>{query.data!.clients.find((client) => client.id === project.clientId)?.name ?? project.clientId ?? "未設定"}</td>
        <td className="numeric">{project.hourlyRate === null ? "未設定" : `${formatYen(project.hourlyRate)}/時間`}</td>
        <td>{project.archived ? "アーカイブ" : "進行中"}</td>
      </tr>)}</tbody>
    </MasterTable>}
    {query.data?.projects.length === 0 && <EmptyState title="表示する案件がありません" description="solidtime で追加して同期してください。" />}
  </div>;
}
