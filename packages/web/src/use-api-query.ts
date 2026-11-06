import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, redirectIfUnauthorized } from "./errors.ts";

interface QueryState<T> {
  request: () => Promise<T>;
  data: T | undefined;
  loading: boolean;
  error: string | null;
}

/** 呼び出し側は useCallback で request を固定する。古いリクエストの応答は表示しない。 */
export function useApiQuery<T>(request: () => Promise<T>) {
  const generation = useRef(0);
  const [state, setState] = useState<QueryState<T>>({ request, data: undefined, loading: true, error: null });
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setState((previous) => ({
      request,
      data: previous.request === request ? previous.data : undefined,
      loading: true,
      error: null,
    }));
    try {
      const data = await request();
      if (current === generation.current) setState({ request, data, loading: false, error: null });
    } catch (error) {
      if (current !== generation.current || redirectIfUnauthorized(error)) return;
      setState((previous) => ({ ...previous, loading: false, error: errorMessage(error) }));
    }
  }, [request]);

  useEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);

  // 選択が変わった直後も、別の取引先・月のデータを表示しない。
  const visible = state.request === request ? state : { data: undefined, loading: true, error: null };
  return { data: visible.data, loading: visible.loading, error: visible.error, reload };
}
