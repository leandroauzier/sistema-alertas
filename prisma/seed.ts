import { AuthenticationType } from '@prisma/client';
import { prisma as db } from '../src/infra/database/prisma.js';
async function main() {
  const source = await db.sourceSystem.upsert({
    where: {
      code: 'MOCK',
    },
    update: {},
    create: {
      code: 'MOCK',
      name: 'Mock Source',
      connectorType: 'MOCK',
    },
  });
  const consumer = await db.consumerSystem.upsert({
    where: {
      code: 'MOCK_CONSUMER',
    },
    update: {},
    create: {
      code: 'MOCK_CONSUMER',
      name: 'Mock Webhook Consumer',
      deliveryType: 'GENERIC_WEBHOOK',
      webhookUrl: 'http://mock-consumer:4001/api/integracoes/alertas',
      authenticationType: AuthenticationType.NONE,
    },
  });
  await db.mockEntity.upsert({
    where: { externalId: '1316192' },
    update: {},
    create: {
      externalId: '1316192',
      entityType: 'PROCESS',
      reference: 'TC/009666/2017',
      data: {
        processNumber: 'TC/009666/2017',
        status: 'Em análise',
        area: 'Gabinete X',
        judgment: false,
        documents: [
          {
            fileCode: 'DOC-001',
            name: 'Documento inicial',
          },
        ],
      },
    },
  });
  await db.monitoredEntity.upsert({
    where: { id: 'mock-process-1316192' },
    update: {},
    create: {
      id: 'mock-process-1316192',
      sourceSystemId: source.id,
      externalId: '1316192',
      entityType: 'PROCESS',
      reference: 'TC/009666/2017',
    },
  });
  for (const [name, eventType, template] of [
    [
      'Status',
      'PROCESS_STATUS_CHANGED',
      'O processo {{data.processNumber}} passou para {{data.currentValue}}.',
    ],
    ['Área', 'PROCESS_AREA_CHANGED', 'O processo {{data.processNumber}} mudou de área.'],
    ['Documento', 'NEW_DOCUMENT_ADDED', 'Novo documento no processo {{data.processNumber}}.'],
    ['Julgamento', 'PROCESS_JUDGMENT_CHANGED', 'Indicação de julgamento alterada.'],
  ] as const)
    await db.alertRule.upsert({
      where: { id: `mock-rule-${eventType}` },
      update: {},
      create: {
        id: `mock-rule-${eventType}`,
        name,
        eventType,
        conditions: {},
        severity: 'MEDIUM',
        titleTemplate: 'Alerta de processo',
        messageTemplate: template,
        recipientStrategy: 'FROM_EVENT',
        consumerSystemIds: [consumer.id],
      },
    });
}
main().finally(() => db.$disconnect());
