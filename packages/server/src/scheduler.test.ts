import { afterEach, expect, it, vi } from "vitest";
import { startScheduler } from "./scheduler.ts";

afterEach(() => vi.useRealTimers());

it("reports synchronous failures, even if the error reporter also fails", async () => {
  vi.useFakeTimers();
  const failure = new Error("sync failed");
  const run = vi.fn().mockImplementationOnce(() => { throw failure; }).mockResolvedValue(undefined);
  const onError = vi.fn(async () => { throw new Error("reporter failed"); });
  const stop = startScheduler({ intervalMinutes: 1, run, onError });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  expect(run).toHaveBeenCalledTimes(2);
  await stop();
});

it("handles failures without an onError callback", async () => {
  vi.useFakeTimers();
  const run = vi.fn().mockRejectedValue(new Error("failed"));
  const stop = startScheduler({ intervalMinutes: 1, run });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(run).toHaveBeenCalledTimes(3);
  await stop();
});

it("stop waits for the current execution and prevents future runs", async () => {
  vi.useFakeTimers();
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const run = vi.fn(() => pending);
  const stop = startScheduler({ intervalMinutes: 1, run });
  await vi.advanceTimersByTimeAsync(0);
  let drained = false;
  const stopping = stop().then(() => { drained = true; });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(run).toHaveBeenCalledOnce();
  expect(drained).toBe(false);
  release();
  await stopping;
  await stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledOnce();
});

it.each([0, -1, NaN, Infinity, 35_792])("rejects an unsupported timer interval: %s", (intervalMinutes) => {
  expect(() => startScheduler({ intervalMinutes, run: async () => {} })).toThrow(RangeError);
});
