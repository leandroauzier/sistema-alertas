const value = (o: Record<string, unknown>, p: string) =>
  p.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], o);
export const render = (template: string, data: Record<string, unknown>) =>
  template.replace(/{{\s*([^}]+)\s*}}/g, (_, p) => String(value(data, p.trim()) ?? ''));
export function matches(conditions: unknown, payload: Record<string, unknown>) {
  for (const [path, check] of Object.entries((conditions ?? {}) as Record<string, { equals?: unknown }>))
    if ('equals' in check && value(payload, path) !== check.equals) return false;
  return true;
}
