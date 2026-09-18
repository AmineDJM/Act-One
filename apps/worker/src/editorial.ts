import { DEFAULT_EDITORIAL_SCHEDULE, EditorialSchedule } from '@act-one/core';
import type { Store } from '@act-one/db';

/**
 * The journal's settings, where the console writes them.
 *
 * Kept beside the product's phase in the platform's one settings row, so the
 * worker reads exactly what an operator saved rather than a copy that can
 * drift.
 */
export async function readEditorialSchedule(store: Store): Promise<EditorialSchedule> {
  try {
    const settings = await store.platform.getSettings();
    const parsed = EditorialSchedule.safeParse((settings.product as { editorial?: unknown } | null)?.editorial ?? {});
    return parsed.success ? parsed.data : DEFAULT_EDITORIAL_SCHEDULE;
  } catch {
    return DEFAULT_EDITORIAL_SCHEDULE;
  }
}

export async function writeEditorialSchedule(store: Store, schedule: EditorialSchedule): Promise<void> {
  const settings = await store.platform.getSettings();
  const product = { ...(settings.product as Record<string, unknown>), editorial: schedule };
  await store.platform.updateSettings({ product }, 'worker');
}
