import express, { type Request, type Response, type NextFunction } from 'express';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from './infra/database/prisma.js';
import { compareSnapshots, snapshotHash } from './core/services/snapshot-comparator.service.js';
import { matches, render } from './core/services/rule-engine.service.js';
const admin = (req: Request, res: Response, next: NextFunction) =>
  req.header('x-admin-key') === process.env.ADMIN_API_KEY
    ? next()
    : res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Chave administrativa inválida.', correlationId: req.id },
      });
const page = (req: Request) => ({
  skip: (Math.max(1, Number(req.query.page) || 1) - 1) * Math.min(100, Number(req.query.pageSize) || 20),
  take: Math.min(100, Number(req.query.pageSize) || 20),
});
const audit = (action: string, entityType: string, entityId: string | undefined, correlationId: string) =>
  prisma.auditLog.create({ data: { actorType: 'API', action, entityType, entityId, correlationId } });
const eventSchema = z.object({
  schemaVersion: z.literal('1.0'),
  source: z.string(),
  eventType: z.string(),
  occurredAt: z.string().datetime(),
  externalEntityId: z.string(),
  entityType: z.string(),
  data: z.record(z.string(), z.unknown()),
  recipients: z
    .array(z.object({ userId: z.string().optional(), departmentId: z.string().optional() }))
    .default([]),
});
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    req.id = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.id);
    next();
  });
  app.use(
    pinoHttp({
      redact: ['req.headers.authorization', 'req.headers.x-system-key', 'req.headers.x-admin-key'],
    }),
  );
  app.get('/health', (_, res) => res.json({ status: 'ok' }));
  app.get('/health/database', async (_, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'down' });
    }
  });
  app.get('/health/integrations', (_, res) =>
    res.json({ etce: process.env.ETCE_ENABLED === 'true' ? 'configured' : 'not_configured' }),
  );
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Sistema Central de Alertas', version: '1.0' },
    paths: {
      '/api/v1/events': {
        post: {
          summary: 'Recebe evento canônico',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
        },
      },
    },
  };
  app.get('/openapi.json', (_, res) => res.json(spec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.post('/api/v1/events', async (req, res, next) => {
    try {
      const key = req.header('idempotency-key');
      if (!key)
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Idempotency-Key obrigatório.',
            correlationId: req.id,
          },
        });
      const body = eventSchema.parse(req.body);
      const source = await prisma.sourceSystem.findUnique({ where: { code: body.source } });
      if (!source?.active)
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Sistema de origem inválido.',
            correlationId: req.id,
          },
        });
      let event = await prisma.canonicalEvent.findUnique({ where: { idempotencyKey: key } });
      if (event) return res.status(200).json(event);
      event = await prisma.canonicalEvent.create({
        data: {
          schemaVersion: body.schemaVersion,
          sourceSystemId: source.id,
          eventType: body.eventType,
          externalEntityId: body.externalEntityId,
          entityType: body.entityType,
          idempotencyKey: key,
          payload: { data: body.data, recipients: body.recipients },
          occurredAt: new Date(body.occurredAt),
          correlationId: req.id,
        },
      });
      const rules = await prisma.alertRule.findMany({
        where: {
          active: true,
          eventType: body.eventType,
          OR: [{ sourceSystemId: null }, { sourceSystemId: source.id }],
        },
      });
      for (const rule of rules)
        if (matches(rule.conditions, { data: body.data })) {
          for (const recipient of body.recipients.length ? body.recipients : [{}]) {
            const n = await prisma.notification.create({
              data: {
                eventId: event.id,
                title: render(rule.titleTemplate, { data: body.data }),
                message: render(rule.messageTemplate, { data: body.data }),
                severity: rule.severity,
                sourceCode: source.code,
                eventType: event.eventType,
                recipientUserId: recipient.userId,
                recipientDepartmentId: recipient.departmentId,
                reference: { entityType: body.entityType, entityId: body.externalEntityId, ...body.data },
              },
            });
            for (const id of rule.consumerSystemIds as string[])
              await prisma.delivery.create({
                data: { notificationId: n.id, consumerSystemId: id, correlationId: req.id },
              });
          }
        }
      await audit('EVENT_CREATED', 'CanonicalEvent', event.id, req.id);
      res.status(201).json(event);
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/v1/events', admin, async (req, res) => {
    const { skip, take } = page(req);
    const where = {
      eventType: req.query.eventType as string | undefined,
      externalEntityId: req.query.externalEntityId as string | undefined,
    };
    const [data, total] = await Promise.all([
      prisma.canonicalEvent.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.canonicalEvent.count({ where }),
    ]);
    res.json({
      data,
      pagination: {
        page: Number(req.query.page) || 1,
        pageSize: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  });
  app.get('/api/v1/events/:id', admin, async (req, res) =>
    res.json(await prisma.canonicalEvent.findUniqueOrThrow({ where: { id: req.params.id } })),
  );
  for (const [path, model] of [
    ['sources', 'sourceSystem'],
    ['consumers', 'consumerSystem'],
    ['rules', 'alertRule'],
    ['monitored-entities', 'monitoredEntity'],
  ] as const) {
    app.post(`/api/v1/integrations/${path}`, admin, async (req, res) =>
      res.status(201).json(await (prisma as never)[model].create({ data: req.body })),
    );
    if (path === 'rules' || path === 'monitored-entities')
      app.post(`/api/v1/${path}`, admin, async (req, res) =>
        res.status(201).json(await (prisma as never)[model].create({ data: req.body })),
      );
    const base =
      path === 'sources' || path === 'consumers' ? `/api/v1/integrations/${path}` : `/api/v1/${path}`;
    app.get(base, admin, async (_, res) => res.json({ data: await (prisma as never)[model].findMany() }));
    app.get(`${base}/:id`, admin, async (req, res) =>
      res.json(await (prisma as never)[model].findUniqueOrThrow({ where: { id: req.params.id } })),
    );
    app.patch(`${base}/:id`, admin, async (req, res) =>
      res.json(await (prisma as never)[model].update({ where: { id: req.params.id }, data: req.body })),
    );
  }
  app.get('/api/v1/notifications', admin, async (req, res) => {
    const { skip, take } = page(req);
    const where = {
      recipientUserId: req.query.userId as string | undefined,
      recipientDepartmentId: req.query.departmentId as string | undefined,
      sourceCode: req.query.source as string | undefined,
      eventType: req.query.eventType as string | undefined,
      severity: req.query.severity as string | undefined,
    };
    const [data, total] = await Promise.all([
      prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.notification.count({ where }),
    ]);
    res.json({
      data,
      pagination: {
        page: Number(req.query.page) || 1,
        pageSize: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  });
  app.get('/api/v1/notifications/unread-count', admin, async (req, res) =>
    res.json({
      count: await prisma.notification.count({
        where: {
          recipientUserId: req.query.userId as string,
          reads: { none: { userId: req.query.userId as string } },
        },
      }),
    }),
  );
  app.get('/api/v1/notifications/:id', admin, async (req, res) =>
    res.json(await prisma.notification.findUniqueOrThrow({ where: { id: req.params.id } })),
  );
  app.patch('/api/v1/notifications/:id/read', admin, async (req, res) =>
    res.json(
      await prisma.notificationRead.upsert({
        where: {
          notificationId_userId: { notificationId: req.params.id, userId: z.string().parse(req.body.userId) },
        },
        create: { notificationId: req.params.id, userId: req.body.userId },
        update: {},
      }),
    ),
  );
  app.get('/api/v1/deliveries', admin, async (_, res) =>
    res.json({
      data: await prisma.delivery.findMany({ include: { consumerSystem: true, notification: true } }),
    }),
  );
  app.get('/api/v1/deliveries/:id', admin, async (req, res) =>
    res.json(await prisma.delivery.findUniqueOrThrow({ where: { id: req.params.id } })),
  );
  app.post('/api/v1/deliveries/:id/retry', admin, async (req, res) =>
    res.json(
      await prisma.delivery.update({
        where: { id: req.params.id },
        data: { status: 'PENDING', nextAttemptAt: new Date() },
      }),
    ),
  );
  app.get('/api/v1/audit-logs', admin, async (_, res) =>
    res.json({ data: await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } }) }),
  );
  app.patch('/api/v1/dev/mock-source/entities/:externalId', admin, async (req, res) => {
    if (process.env.NODE_ENV === 'production') return res.sendStatus(404);
    res.json(
      await prisma.mockEntity.update({
        where: { externalId: req.params.externalId },
        data: { data: req.body.data },
      }),
    );
  });
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message =
      err instanceof z.ZodError ? 'Payload inválido.' : err instanceof Error ? err.message : 'Erro interno.';
    res.status(err instanceof z.ZodError ? 400 : 500).json({
      error: {
        code: err instanceof z.ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
        message,
        correlationId: req.id,
      },
    });
  });
  return app;
}
