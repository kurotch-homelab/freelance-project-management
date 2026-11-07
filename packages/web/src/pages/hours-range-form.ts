import type { HoursRange } from "@fpm/domain";
import type { FieldErrors } from "./master-page.tsx";

export function rangeFromInputs(minHours: number | null, maxHours: number | null): HoursRange {
  return { ...(minHours === null ? {} : { minHours }), ...(maxHours === null ? {} : { maxHours }) };
}

export function rangeErrors(form: HTMLFormElement, range: HoursRange, minName: string, maxName: string): FieldErrors {
  const errors: FieldErrors = {};
  for (const [name, value] of [[minName, range.minHours], [maxName, range.maxHours]] as const) {
    const input = form.elements.namedItem(name);
    if ((input instanceof HTMLInputElement && input.validity.badInput) ||
      (value !== undefined && (!Number.isFinite(value) || value < 0))) {
      errors[name] = "0 以上の時間を入力してください";
    }
  }
  if (range.minHours !== undefined && range.maxHours !== undefined && range.minHours > range.maxHours) {
    errors[minName] = "下限は上限以下にしてください";
  }
  return errors;
}
