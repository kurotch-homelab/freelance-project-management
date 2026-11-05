import { parseDate } from "./date.ts";

export interface HoursRange {
  readonly minHours?: number;
  readonly maxHours?: number;
}

export interface HoursRangeOverride {
  readonly month: string;
  readonly range: HoursRange;
  readonly note: string;
}

export interface HoursRangeWarning {
  readonly kind: "belowMinForecast" | "aboveMaxForecast" | "aboveMaxActual";
  readonly seconds: number;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

export function assertHoursRange({ minHours, maxHours }: HoursRange): void {
  if (minHours !== undefined) {
    assertNonNegativeFinite(minHours, "minHours");
  }
  if (maxHours !== undefined) {
    assertNonNegativeFinite(maxHours, "maxHours");
  }
  if (minHours !== undefined && maxHours !== undefined && minHours > maxHours) {
    throw new RangeError("minHours must not exceed maxHours");
  }
}

/** 月ごとの上書きがあれば、その範囲全体を契約の目安時間より優先する。 */
export function effectiveHoursRange(
  contractRange: HoursRange,
  overrides: readonly HoursRangeOverride[],
  month: string,
): HoursRange {
  parseDate(`${month}-01`, "month");
  assertHoursRange(contractRange);

  const months = new Set<string>();
  let range = contractRange;
  for (const override of overrides) {
    parseDate(`${override.month}-01`, "override.month");
    assertHoursRange(override.range);
    if (months.has(override.month)) {
      throw new RangeError(`duplicate hours range override for month: ${override.month}`);
    }
    months.add(override.month);
    if (override.month === month) {
      range = override.range;
    }
  }

  return range;
}

/** 実績の上限超過を優先し、それ以外は着地見込みと目安時間の差を秒で返す。 */
export function hoursRangeWarnings({
  actualSeconds,
  forecastSeconds,
  range,
}: {
  readonly actualSeconds: number;
  readonly forecastSeconds: number;
  readonly range: HoursRange;
}): readonly HoursRangeWarning[] {
  assertNonNegativeFinite(actualSeconds, "actualSeconds");
  assertNonNegativeFinite(forecastSeconds, "forecastSeconds");
  assertHoursRange(range);

  const minSeconds = range.minHours === undefined ? undefined : Math.round(range.minHours * 3_600);
  const maxSeconds = range.maxHours === undefined ? undefined : Math.round(range.maxHours * 3_600);
  if (maxSeconds !== undefined && actualSeconds > maxSeconds) {
    return [{ kind: "aboveMaxActual", seconds: actualSeconds - maxSeconds }];
  }

  const projectedSeconds = actualSeconds + forecastSeconds;
  if (maxSeconds !== undefined && projectedSeconds > maxSeconds) {
    return [{ kind: "aboveMaxForecast", seconds: projectedSeconds - maxSeconds }];
  }
  if (minSeconds !== undefined && projectedSeconds < minSeconds) {
    return [{ kind: "belowMinForecast", seconds: minSeconds - projectedSeconds }];
  }

  return [];
}
