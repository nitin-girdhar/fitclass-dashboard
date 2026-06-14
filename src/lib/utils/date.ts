/**
 * Returns an ISO datetime string for "tomorrow at 10:00 AM local time" —
 * the sensible default when scheduling a follow-up.
 * Used by follow-up scheduling modals; centralised here so the behaviour
 * is consistent across all entry points.
 */
export function defaultScheduledAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}
