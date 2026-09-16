export type Presentation = { actionDelayMs: number; finalHoldMs: number };
export function presentationOptions(
  headed: boolean,
  actionDelay?: string,
  finalHold?: string,
): Presentation {
  const parse = (value: string | undefined, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) > max)
      throw new Error(
        "Presentation timing must be a bounded nonnegative integer.",
      );
    return Number(value);
  };
  return {
    actionDelayMs: parse(actionDelay, headed ? 2000 : 0, 10000),
    finalHoldMs: parse(finalHold, headed ? 5000 : 0, 30000),
  };
}
export const pause = (ms: number) =>
  ms > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
