const integers = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const timestamps = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export const formatHours = (seconds: number): string => `${Math.floor(seconds / 36) / 100} 時間`;
export const formatYen = (amount: number): string => `¥${integers.format(amount)}`;
export const formatMonth = (month: string): string => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
export const formatTimestamp = (value: string): string => `${timestamps.format(new Date(value))} JST`;

export function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
