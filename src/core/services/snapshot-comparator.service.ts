import { createHash } from 'node:crypto';
export type Watch = { path: string; eventType: string };
export type CollectionWatch = Watch & { identityField: string };
const get = (o: Record<string, unknown>, p: string) =>
  p.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], o);
export const snapshotHash = (data: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(data, Object.keys(data as object).sort()))
    .digest('hex');
export function compareSnapshots(
  previous: Record<string, unknown> | null,
  current: Record<string, unknown>,
  config: { fields?: Watch[]; collections?: CollectionWatch[] },
) {
  if (!previous) return [] as { eventType: string; data: Record<string, unknown> }[];
  const result: { eventType: string; data: Record<string, unknown> }[] = [];
  for (const f of config.fields ?? [])
    if (JSON.stringify(get(previous, f.path)) !== JSON.stringify(get(current, f.path)))
      result.push({
        eventType: f.eventType,
        data: { previousValue: get(previous, f.path), currentValue: get(current, f.path), ...current },
      });
  for (const c of config.collections ?? []) {
    const oldItems = (get(previous, c.path) as Record<string, unknown>[]) ?? [];
    const ids = new Set(oldItems.map((x) => String(x[c.identityField])));
    for (const item of (get(current, c.path) as Record<string, unknown>[]) ?? [])
      if (!ids.has(String(item[c.identityField])))
        result.push({ eventType: c.eventType, data: { document: item, ...current } });
  }
  return result;
}
