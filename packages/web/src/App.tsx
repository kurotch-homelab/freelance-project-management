import { Button, Link } from "@kurotch-homelab/forma-react";
import { useEffect, useRef, useState } from "react";
import { createApiClient, type ApiClient } from "./api-client.ts";
import { currentMonth } from "./format.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { InvoiceGuidePage } from "./pages/InvoiceGuidePage.tsx";
import { ClientsPage } from "./pages/ClientsPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { ContractsPage } from "./pages/ContractsPage.tsx";

const defaultApi = createApiClient();
const pages = {
  dashboard: "ダッシュボード", "invoice-guide": "請求書ガイド", clients: "取引先", projects: "案件", contracts: "契約",
};
type Page = keyof typeof pages;
const readPage = (): Page => {
  const page = window.location.hash.slice(2);
  return Object.hasOwn(pages, page) ? page as Page : "dashboard";
};

export function App({ api = defaultApi }: { api?: ApiClient }) {
  const [page, setPage] = useState(readPage);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const navigationToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function navigate() {
      setPage(readPage());
      setNavigationOpen(false);
      main.current?.focus();
    }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    document.title = `${pages[page]} | フリーランス業務管理`;
  }, [page]);

  return <>
    <a href="#main-content" className="skip-link" onClick={(event) => {
      event.preventDefault();
      main.current?.focus();
    }}>本文へ移動</a>
    <header className="app-header">
      <div className="app-header-inner">
        <span className="app-name">フリーランス業務管理</span>
        <Button ref={navigationToggle} className="navigation-toggle" aria-controls="main-navigation" aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(!navigationOpen)}>{navigationOpen ? "メニューを閉じる" : "メニューを開く"}</Button>
        <nav id="main-navigation" className="app-navigation" aria-label="メインナビゲーション" data-open={navigationOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape" && navigationOpen) {
              setNavigationOpen(false);
              navigationToggle.current?.focus();
            }
          }}>
          {Object.entries(pages).map(([id, label]) => <Link key={id} href={`#/${id}`} aria-current={page === id ? "page" : undefined}
            onClick={() => { setNavigationOpen(false); main.current?.focus(); }}>{label}</Link>)}
          <form action="/auth/logout" method="post"><Button type="submit" variant="ghost">ログアウト</Button></form>
        </nav>
      </div>
    </header>
    <main id="main-content" ref={main} tabIndex={-1} className="app-main">
      {page === "dashboard" && <DashboardPage api={api} />}
      {page === "invoice-guide" && <InvoiceGuidePage api={api} defaultMonth={currentMonth()} />}
      {page === "clients" && <ClientsPage api={api} />}
      {page === "projects" && <ProjectsPage api={api} />}
      {page === "contracts" && <ContractsPage api={api} />}
    </main>
  </>;
}

export default App;
