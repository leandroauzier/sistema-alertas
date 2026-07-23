export const retryDelayMs = (attempt: number) => [30, 60, 300, 900, 1800][Math.max(0, attempt - 1)]! * 1000;
export const responseKind = (status: number) =>
  status === 409 || [200, 201, 202].includes(status)
    ? 'success'
    : status === 400 || [401, 403, 404].includes(status)
      ? 'permanent'
      : 'temporary';
