import { Alert, Button } from "@kurotch-homelab/forma-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ApiClient } from "../api-client.ts";
import { errorMessage, redirectIfUnauthorized } from "../errors.ts";

export interface MasterPageProps {
  api: ApiClient;
  newId?: () => string;
}

export const randomId = () => crypto.randomUUID();
export type FieldErrors = Record<string, string>;
export interface SaveNotice { error: boolean; text: string; details?: readonly string[] }

/** 保存失敗時は編集中の値を残し、成功時だけ閉じて一覧を読み直す。 */
export function useMasterEditor<T>(reload: () => Promise<void>) {
  const [editing, setEditing] = useState<{ value: T; title: string } | null>(null);
  const [notice, setNotice] = useState<SaveNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (editing === null && !saving && opener.current) {
      if (document.activeElement === document.body) opener.current.focus();
      opener.current = null;
    }
  }, [editing, saving]);

  function close() {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body && !focused.closest(".master-form")) {
      opener.current = null;
    }
    setEditing(null);
  }

  return {
    editing, notice, saving,
    open(value: T, title: string) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setNotice(null);
      setEditing({ value, title });
    },
    cancel() { if (!busy.current) { setNotice(null); close(); } },
    async save(operation: () => Promise<SaveNotice | void>) {
      if (busy.current) return;
      busy.current = true;
      setSaving(true);
      setNotice(null);
      try {
        const result = await operation();
        if (!active.current) return;
        await reload();
        if (!active.current) return;
        setNotice(result ?? { error: false, text: "保存しました" });
        close();
      } catch (error) {
        if (active.current && !redirectIfUnauthorized(error)) {
          setNotice({ error: true, text: `保存できませんでした: ${errorMessage(error)}` });
        }
      } finally {
        busy.current = false;
        if (active.current) setSaving(false);
      }
    },
  };
}

export function SaveFeedback({ notice }: { notice: SaveNotice | null }) {
  return notice && <Alert tone={notice.error ? "danger" : "success"}>
    <p>{notice.text}</p>
    {notice.details?.map((detail) => <p key={detail}>{detail}</p>)}
  </Alert>;
}

export function QueryFeedback({ label, query }: {
  label: string;
  query: { loading: boolean; error: string | null; reload: () => Promise<void> };
}) {
  return <>
    {query.loading && <p aria-live="polite">{label}を読み込んでいます…</p>}
    {query.error !== null && <Alert tone="danger" title={`${label}を読み込めませんでした`}>
      <p>{query.error}</p><Button loading={query.loading} onClick={() => void query.reload()}>再読み込み</Button>
    </Alert>}
  </>;
}

export function MasterTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="f-data-table table-frame">
    <div className="f-table-scroll" tabIndex={0} role="group" aria-label={`${label}一覧（横スクロール）`}>
      <table className="master-table" aria-label={label}>
        <caption className="sr-only">{label}</caption>{children}
      </table>
    </div>
  </div>;
}

export interface EditorFormProps<T> {
  initial: T;
  title: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: T) => void;
}

export function MasterForm({ title, saving, errors, onSubmit, onCancel, children }: {
  title: string;
  saving: boolean;
  errors: FieldErrors;
  onSubmit: (form: HTMLFormElement) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector<HTMLElement>("input, select")?.focus(); }, []);
  useEffect(() => {
    if (Object.keys(errors).length > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  return <form ref={form} className="master-form" aria-labelledby={headingId} noValidate aria-busy={saving}
    onSubmit={(event) => { event.preventDefault(); if (!saving) onSubmit(event.currentTarget); }}>
    <h2 id={headingId}>{title}</h2>
    <p className="muted">任意と記載された項目以外は入力してください。</p>
    <fieldset className="master-fields" disabled={saving}>{children}</fieldset>
    <div className="form-actions">
      <Button type="submit" variant="primary" loading={saving}>{saving ? "保存中…" : "保存"}</Button>
      <Button onClick={onCancel} disabled={saving}>キャンセル</Button>
    </div>
  </form>;
}
