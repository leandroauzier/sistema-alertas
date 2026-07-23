import { prisma } from '../infra/database/prisma.js';
import { compareSnapshots, snapshotHash } from '../core/services/snapshot-comparator.service.js';
export async function syncEntity(id: string) {
  const entity = await prisma.monitoredEntity.findUniqueOrThrow({
    where: { id },
    include: { sourceSystem: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 } },
  });
  if (entity.sourceSystem.connectorType !== 'MOCK') throw new Error('Conector não disponível');
  const mock = await prisma.mockEntity.findUniqueOrThrow({ where: { externalId: entity.externalId } });
  const current = mock.data as Record<string, unknown>;
  const previous = entity.snapshots[0]?.data as Record<string, unknown> | undefined;
  await prisma.entitySnapshot.create({
    data: { monitoredEntityId: id, hash: snapshotHash(current), data: current },
  });
  const changes = compareSnapshots(previous ?? null, current, {
    fields: [
      { path: 'status', eventType: 'PROCESS_STATUS_CHANGED' },
      { path: 'area', eventType: 'PROCESS_AREA_CHANGED' },
      { path: 'judgment', eventType: 'PROCESS_JUDGMENT_CHANGED' },
    ],
    collections: [{ path: 'documents', identityField: 'fileCode', eventType: 'NEW_DOCUMENT_ADDED' }],
  });
  for (const c of changes) {
    const key = `${entity.sourceSystem.code}:${c.eventType}:${entity.externalId}:${snapshotHash(c.data)}`;
    await prisma.canonicalEvent.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: {
        schemaVersion: '1.0',
        sourceSystemId: entity.sourceSystemId,
        eventType: c.eventType,
        externalEntityId: entity.externalId,
        entityType: entity.entityType,
        idempotencyKey: key,
        payload: { data: c.data, recipients: [] },
        occurredAt: new Date(),
        correlationId: 'sync',
      },
    });
  }
  await prisma.monitoredEntity.update({
    where: { id },
    data: { lastSyncAt: new Date(), nextSyncAt: new Date(Date.now() + entity.syncFrequencySeconds * 1000) },
  });
  return changes;
}
if (import.meta.url === `file://${process.argv[1]}`)
  setInterval(
    async () => {
      for (const e of await prisma.monitoredEntity.findMany({
        where: { active: true, nextSyncAt: { lte: new Date() } },
      }))
        await syncEntity(e.id);
    },
    Number(process.env.SYNC_WORKER_INTERVAL_MS || 60000),
  );
