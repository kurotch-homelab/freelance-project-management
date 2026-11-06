import { parseDate } from "./date.ts";
import { assertHoursRange, type HoursRange } from "./hours-range.ts";

export interface Contract {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly start: string;
  readonly end: string | null;
  readonly projectIds: readonly string[];
  readonly hoursRange?: HoursRange;
  readonly projectHoursRanges?: Readonly<Record<string, HoursRange>>;
  readonly renewalOutlook: "likely" | "undecided" | "ending";
}

export interface ContractCoverage {
  readonly contract: Contract;
  readonly assumesRenewal: boolean;
}

/** 案件の当日の契約を返す。更新前提で延長するのは、その案件の最後の契約だけ。 */
export function contractCoverage(
  contracts: readonly Contract[],
  projectId: string,
  date: string,
): ContractCoverage | null {
  parseDate(date, "date");
  let latest: Contract | null = null;
  for (const contract of contracts) {
    if (!contract.projectIds.includes(projectId)) {
      continue;
    }
    if (date >= contract.start && (contract.end === null || date <= contract.end)) {
      return { contract, assumesRenewal: false };
    }
    if (latest === null || contract.start > latest.start) {
      latest = contract;
    }
  }
  if (
    latest !== null && latest.end !== null && date > latest.end &&
    latest.renewalOutlook === "likely"
  ) {
    return { contract: latest, assumesRenewal: true };
  }
  return null;
}

/** 契約の期間・対象案件・目安時間を検証し、同じ案件の契約期間の重複を拒否する。 */
export function validateContracts(contracts: readonly Contract[]): void {
  const ids = new Set<string>();
  const byProject = new Map<string, Contract[]>();
  for (const contract of contracts) {
    if (ids.has(contract.id)) {
      throw new RangeError("contract.id must be unique");
    }
    ids.add(contract.id);
    const start = parseDate(contract.start, "contract.start");
    const end = contract.end === null ? null : parseDate(contract.end, "contract.end");
    if (end !== null && end < start) {
      throw new RangeError("contract.end must not be before contract.start");
    }
    if (contract.projectIds.length === 0) {
      throw new RangeError("contract.projectIds must not be empty");
    }
    if (new Set(contract.projectIds).size !== contract.projectIds.length) {
      throw new RangeError("contract.projectIds must be unique");
    }
    if (contract.hoursRange !== undefined) {
      assertHoursRange(contract.hoursRange);
    }
    for (const [projectId, range] of Object.entries(contract.projectHoursRanges ?? {})) {
      if (!contract.projectIds.includes(projectId)) {
        throw new RangeError("projectHoursRanges must only contain contract projects");
      }
      assertHoursRange(range);
    }
    for (const projectId of contract.projectIds) {
      const projectContracts = byProject.get(projectId) ?? [];
      projectContracts.push(contract);
      byProject.set(projectId, projectContracts);
    }
  }

  for (const projectContracts of byProject.values()) {
    projectContracts.sort((a, b) => a.start.localeCompare(b.start));
    let previous: Contract | null = null;
    for (const contract of projectContracts) {
      if (previous !== null && (previous.end === null || previous.end >= contract.start)) {
        throw new RangeError("contract periods must not overlap for the same project");
      }
      previous = contract;
    }
  }
}
