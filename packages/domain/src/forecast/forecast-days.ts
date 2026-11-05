import { formatDate, parseDate, weekday } from "../date.ts";
import { weekdayAverages, type DailyWork } from "./weekday-average.ts";

export interface ForecastProject {
  readonly projectId: string;
  readonly clientId: string;
  readonly contract: {
    readonly start: string;
    readonly end: string | null;
  };
  readonly history: readonly DailyWork[];
}

export interface ForecastInput {
  readonly asOf: string;
  readonly until: string;
  readonly weeks: number;
  readonly projects: readonly ForecastProject[];
  readonly absenceSeconds: Readonly<Record<string, number>>;
}

export interface ForecastRow {
  readonly date: string;
  readonly projectId: string;
  readonly seconds: number;
  readonly source: "project" | "client" | "capacity";
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

/** 翌日から until まで、契約期間内の案件に実績・空き・不在を反映した予測を作る。 */
export function forecastDays(input: ForecastInput): readonly ForecastRow[] {
  const { asOf, until, weeks, projects, absenceSeconds } = input;
  const start = parseDate(asOf, "asOf");
  const end = parseDate(until, "until");
  if (end < start) {
    throw new RangeError("until must not be before asOf");
  }
  for (const [date, seconds] of Object.entries(absenceSeconds)) {
    parseDate(date, "absenceSeconds date");
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      throw new RangeError("absenceSeconds must be non-negative safe integers");
    }
  }

  const options = { asOf, weeks };
  const projectIds = new Set<string>();
  const allWork = new Map<string, number>();
  const clientWork = new Map<string, Map<string, number>>();
  const projectForecasts = projects.map((project) => {
    if (projectIds.has(project.projectId)) {
      throw new RangeError("projectId must be unique");
    }
    projectIds.add(project.projectId);
    const contractStart = parseDate(project.contract.start, "contract.start");
    const contractEnd = project.contract.end === null
      ? null
      : parseDate(project.contract.end, "contract.end");
    if (contractEnd !== null && contractEnd < contractStart) {
      throw new RangeError("contract.end must not be before contract.start");
    }

    const averages = weekdayAverages(project.history, options);
    const clientTotals = clientWork.get(project.clientId) ?? new Map<string, number>();
    clientWork.set(project.clientId, clientTotals);
    // 終了済みの案件も集計する。今日以降の記録は予測のもとにしない。
    for (const work of project.history) {
      if (work.date < asOf) {
        addWork(allWork, work);
        addWork(clientTotals, work);
      }
    }
    return { project, contractStart, contractEnd, averages };
  });
  const allAverages = weekdayAverages(dailyWork(allWork), options);
  const clientAverages = new Map(
    Array.from(clientWork, ([clientId, totals]) => [
      clientId,
      weekdayAverages(dailyWork(totals), options),
    ] as const),
  );
  const forecasts = projectForecasts.map((forecast) => ({
    ...forecast,
    averages: forecast.averages ?? clientAverages.get(forecast.project.clientId) ?? null,
    source: forecast.averages === null ? "client" as const : "project" as const,
  }));

  const rows: ForecastRow[] = [];
  for (let day = start + 1; day <= end; day += 1) {
    const date = formatDate(day);
    const index = weekday(day);
    const active = forecasts.filter(({ contractStart, contractEnd }) =>
      day >= contractStart && (contractEnd === null || day <= contractEnd),
    );
    const knownSeconds = active.reduce(
      (sum, { averages }) => sum + (averages?.[index] ?? 0),
      0,
    );
    const capacityCount = active.filter(({ averages }) => averages === null).length;
    const capacitySeconds = allAverages === null || capacityCount === 0
      ? null
      : Math.max(0, (allAverages[index] ?? 0) - knownSeconds) / capacityCount;
    const dailyRows = active.flatMap<ForecastRow>(({ project, averages, source }) => {
      const seconds = averages === null ? capacitySeconds : averages[index] ?? 0;
      if (seconds === null) {
        return [];
      }
      return [{
        date,
        projectId: project.projectId,
        seconds,
        source: averages === null ? "capacity" : source,
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
