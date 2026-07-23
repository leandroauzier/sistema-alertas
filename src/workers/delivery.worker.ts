import { DeliveryStatus } from '@prisma/client';
import { prisma } from '../infra/database/prisma.js';
import { responseKind, retryDelayMs } from '../core/services/retry.service.js';
export async function processDeliveries() {
  const rows = await prisma.delivery.findMany({
    where: {
      status: { in: [DeliveryStatus.PENDING, DeliveryStatus.RETRYING] },
      nextAttemptAt: { lte: new Date() },
    },
    include: { consumerSystem: true, notification: true },
    take: 20,
  });
  for (const d of rows) {
    const lock = await prisma.delivery.updateMany({
      where: { id: d.id, status: { in: [DeliveryStatus.PENDING, DeliveryStatus.RETRYING] } },
      data: { status: DeliveryStatus.PROCESSING },
    });
    if (!lock.count) continue;
    try {
      const r = await fetch(d.consumerSystem.webhookUrl!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': d.notificationId,
          'x-correlation-id': d.correlationId,
          'x-schema-version': '1.0',
        },
        body: JSON.stringify(d.notification),
      });
      const kind = responseKind(r.status);
      await prisma.delivery.update({
        where: { id: d.id },
        data:
          kind === 'success'
            ? {
                status: DeliveryStatus.DELIVERED,
                attempts: { increment: 1 },
                lastHttpStatus: r.status,
                deliveredAt: new Date(),
              }
            : {
                status:
                  kind === 'permanent'
                    ? DeliveryStatus.FAILED
                    : d.attempts + 1 >= d.maxAttempts
                      ? DeliveryStatus.DEAD_LETTER
                      : DeliveryStatus.RETRYING,
                attempts: { increment: 1 },
                lastHttpStatus: r.status,
                nextAttemptAt: new Date(Date.now() + retryDelayMs(d.attempts + 1)),
              },
      });
    } catch (e) {
      await prisma.delivery.update({
        where: { id: d.id },
        data: {
          status: d.attempts + 1 >= d.maxAttempts ? DeliveryStatus.DEAD_LETTER : DeliveryStatus.RETRYING,
          attempts: { increment: 1 },
          lastError: e instanceof Error ? e.message : 'network error',
          nextAttemptAt: new Date(Date.now() + retryDelayMs(d.attempts + 1)),
        },
      });
    }
  }
}
if (import.meta.url === `file://${process.argv[1]}`)
  setInterval(processDeliveries, Number(process.env.DELIVERY_WORKER_INTERVAL_MS || 5000));
