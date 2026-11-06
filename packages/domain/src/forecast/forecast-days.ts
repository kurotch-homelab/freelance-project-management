import { contractCoverage, validateContracts, type Contract } from "../contracts.ts";
import { formatDate, parseDate, weekday } from "../date.ts";
import { weekdayAverages, type DailyWork } from "./weekday-average.ts";

export interface ForecastProject {
  readonly projectId: string;
  readonly clientId: string | null;
  readonly archived?: boolean;
  readonly history: readonly DailyWork[];
}

export interface ForecastInput {
  readonly asOf: string;
  readonly until: string;
  readonly weeks: number;
  readonly projects: readonly ForecastProject[];
  readonly contracts: readonly Contract[];
  readonly absenceSeconds: Readonly<Record<string, number>>;
}

export interface ForecastRow {
  readonly date: string;
  readonly projectId: string;
  readonly seconds: number;
  readonly source: "project" | "client" | "capacity";
  readonly assumesRenewal: boolean;
}

function addWork(totals: Map<string, number>, work: DailyWork): void {
  const seconds = (totals.get(work.date) ?? 0) + work.seconds;
  if (!Number.isSafeInteger(seconds)) {
    throw new RangeError("daily total must be a safe integer");
  }
  totals.set(work.date, seconds);
}

function dailyWork(totals: ReadonlyMap<string, number>): DailyWork[] {
  return Array.from(totals, ([date, seconds]) => ({ date, seconds }));
}

/** 翌日から until まで、契約と更新見込み・実績・空き・不在を反映した予測を作る。 */
export function forecastDays(input: ForecastInput): readonly ForecastRow[] {
  const { asOf, until, weeks, projects, contracts, absenceSeconds } = input;
  const start = parseDate(asOf, "asOf");
  const end = parseDate(until, "until");
  if (end < start) {
    throw new RangeError("until must not be before asOf");
  }
  validateContracts(contracts);
  for (const [date, seconds] of Object.entries(absenceSeconds)) {
    parseDate(date, "absenceSeconds date");
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      throw new RangeError("absenceSeconds must be non-negative safe integers");
    }
  }

  const options = { asOf, weeks };
  const projectIds = new Set<string>();
  const allWork = new Map<string, number>();
  const clientWork = new Map<string | null, Map<string, number>>();
  const projectForecasts = projects.map((project) => {
    if (projectIds.has(project.projectId)) {
      throw new RangeError("projectId must be unique");
    }
    projectIds.add(project.projectId);
    if (contracts.some((contract) =>
      contract.projectIds.includes(project.projectId) && contract.clientId !== project.clientId,
    )) {
      throw new RangeError("project.clientId must match its contracts' clientId");
    }
    const averages = weekdayAverages(project.history, options);
    const clientTotals = clientWork.get(project.clientId) ?? new Map<string, number>();
    clientWork.set(project.clientId, clientTotals);
    // 終了済みの案件も集計する。今日以降の記録は予測のもとにしない。
    for (const work of project.history) {
      if (work.seconds > 0 && work.date < asOf) {
        addWork(allWork, work);
        addWork(clientTotals, work);
      }
    }
    return { project, averages };
  });
  const allAverages = weekdayAverages(dailyWork(allWork), options);
  const clientAverages = new Map(
    Array.from(clientWork, ([clientId, totals]) => [
      clientId,
      weekdayAverages(dailyWork(totals), options),
    ] as const),
  );
  const forecasts = projectForecasts.map((forecast) => {
    const averages = forecast.averages ?? clientAverages.get(forecast.project.clientId) ?? null;
    const source = forecast.averages !== null
      ? "project" as const
      : averages !== null ? "client" as const : "capacity" as const;
    return { ...forecast, averages, source };
  });

  const rows: ForecastRow[] = [];
  for (let day = start + 1; day <= end; day += 1) {
    const date = formatDate(day);
    const index = weekday(day);
    const active = forecasts.flatMap((forecast) => {
      if (forecast.project.archived) return [];
      const coverage = contractCoverage(contracts, forecast.project.projectId, date);
      return coverage === null ? [] : [{ ...forecast, assumesRenewal: coverage.assumesRenewal }];
    });

    const projectSecondsByClient = new Map<string | null, number>();
    const clientCounts = new Map<string | null, number>();
    for (const { project, averages, source } of active) {
      if (source === "project") {
        projectSecondsByClient.set(
          project.clientId,
          (projectSecondsByClient.get(project.clientId) ?? 0) + (averages?.[index] ?? 0),
        );
      } else if (source === "client") {
        clientCounts.set(project.clientId, (clientCounts.get(project.clientId) ?? 0) + 1);
      }
    }
    // 取引先の実績から案件自身の予測を引き、残りをその取引先の新規案件で等分する。
    const allocated = active.map((forecast) => {
      const { project, averages, source } = forecast;
      const seconds = source === "capacity"
        ? null
        : source === "project" ? averages?.[index] ?? 0
        : Math.max(0, (averages?.[index] ?? 0) - (projectSecondsByClient.get(project.clientId) ?? 0)) /
          (clientCounts.get(project.clientId) ?? 1);
      return { ...forecast, seconds };
    });
    const knownSeconds = allocated.reduce((sum, { seconds }) => sum + (seconds ?? 0), 0);
    const capacityCount = allocated.filter(({ source }) => source === "capacity").length;
    const capacitySeconds = allAverages === null || capacityCount === 0
      ? null
      : Math.max(0, (allAverages[index] ?? 0) - knownSeconds) / capacityCount;
    const dailyRows = allocated.flatMap<ForecastRow>((forecast) => {
      const { project, source, assumesRenewal } = forecast;
      const seconds = forecast.seconds ?? capacitySeconds;
      if (seconds === null) {
        return [];
      }
      return [{
        date,
        projectId: project.projectId,
        seconds,
        source,
        assumesRenewal,
      }];
    });

    // 空きを配分してから、その日の全案件の予測比率で不在を差し引く。
    const total = dailyRows.reduce((sum, row) => sum + row.seconds, 0);
    const remainingRatio = total === 0
      ? 0
      : Math.max(0, total - (absenceSeconds[date] ?? 0)) / total;
    rows.push(...dailyRows.map((row) => ({ ...row, seconds: row.seconds * remainingRatio })));
  }
  return rows;
}
