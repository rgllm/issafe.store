export const UMAMI_WEBSITE_ID =
  import.meta.env.VITE_UMAMI_WEBSITE_ID ??
  "1f9a19af-b489-4adf-af45-23591f023582";

export const UMAMI_REPLAY_SAMPLE_RATE =
  import.meta.env.VITE_UMAMI_REPLAY_SAMPLE_RATE ?? "0";

export const shouldEnableUmamiReplay =
  Number(UMAMI_REPLAY_SAMPLE_RATE) > 0;

export function trackStoreEvent(
  name: string,
  data?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.umami?.track(name, data);
}
