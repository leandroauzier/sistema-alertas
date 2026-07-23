# Sistema Central de Alertas

API em Node.js, Express, TypeScript, PostgreSQL e Prisma 7 para centralizar eventos de sistemas externos, aplicar regras e disponibilizar notificações. O projeto está configurado como ESM e usa `@prisma/adapter-pg` com `pg` para conectar ao PostgreSQL.

## Principais conceitos

```text
Sistema de origem
       │
       ▼
POST /api/v1/events ──► CanonicalEvent ──► AlertRule ──► Notification ──► Delivery
                                                                    │
                                                                    ▼
                                                            Webhook consumidor
```

- **SourceSystem**: sistema que envia ou fornece eventos, por exemplo `MOCK`.
- **CanonicalEvent**: evento normalizado, protegido por `Idempotency-Key`.
- **AlertRule**: regra que decide se um evento gera notificações.
- **Notification**: alerta para um usuário ou setor.
- **Delivery**: tentativa de entrega da notificação a um consumidor configurado.
- **MockEntity**: estado de demonstração usado para testes locais.

## Configuração e execução

Crie `.env` a partir de `.env.example` e informe sua conexão PostgreSQL:

```env
DATABASE_URL="postgresql://postgres:SUA_SENHA@localhost:5432/alertas?schema=public"
ADMIN_API_KEY="uma-chave-segura"
PORT=3000
```

Em seguida:

```powershell
npm run prisma:generate
npx prisma db push
npm run prisma:seed
npm run dev
```

A API fica disponível em `http://localhost:3000`. A documentação OpenAPI fica em `http://localhost:3000/docs`.

## Autenticação

As rotas administrativas exigem o header abaixo. O endpoint de entrada de eventos usa `Idempotency-Key` obrigatório, mas ainda não exige chave de sistema nesta versão.

```http
X-Admin-Key: valor-de-ADMIN_API_KEY
```

## Rotas disponíveis

### Saúde e documentação

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health` | Verifica se a API está ativa. |
| GET | `/health/database` | Verifica a conexão com o PostgreSQL. |
| GET | `/health/integrations` | Informa a configuração da integração e-TCE. |
| GET | `/openapi.json` | Especificação OpenAPI em JSON. |
| GET | `/docs` | Interface Swagger. |

### Eventos

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/v1/events` | Persiste um evento canônico e aplica as regras cadastradas. Requer `Idempotency-Key`. |
| GET | `/api/v1/events` | Lista eventos. Requer chave administrativa. |
| GET | `/api/v1/events/:id` | Consulta um evento por ID. Requer chave administrativa. |

Exemplo de criação:

```powershell
curl.exe -X POST http://localhost:3000/api/v1/events `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: MOCK:PROCESS_STATUS_CHANGED:1316192:ARQUIVAMENTO" `
  -d '{"schemaVersion":"1.0","source":"MOCK","eventType":"PROCESS_STATUS_CHANGED","occurredAt":"2026-07-15T12:00:00.000Z","externalEntityId":"1316192","entityType":"PROCESS","data":{"processNumber":"TC/009666/2017","currentStatus":"Em arquivamento"},"recipients":[{"userId":"1234","departmentId":"VICE_PRESIDENCIA"}]}'
```

Enviar novamente a mesma `Idempotency-Key` retorna o evento existente, sem duplicá-lo.

### Integrações

Todas requerem `X-Admin-Key`.

| Método | Rota | Descrição |
| --- | --- | --- |
| POST / GET | `/api/v1/integrations/sources` | Cria ou lista sistemas de origem. |
| GET / PATCH | `/api/v1/integrations/sources/:id` | Consulta ou altera uma origem. |
| POST / GET | `/api/v1/integrations/consumers` | Cria ou lista consumidores. |
| GET / PATCH | `/api/v1/integrations/consumers/:id` | Consulta ou altera um consumidor. |

O seed cria `MOCK` como origem e `MOCK_CONSUMER` como consumidor webhook.

### Regras e entidades monitoradas

Todas requerem `X-Admin-Key`.

| Método | Rota |
| --- | --- |
| POST / GET | `/api/v1/rules` |
| GET / PATCH | `/api/v1/rules/:id` |
| POST / GET | `/api/v1/monitored-entities` |
| GET / PATCH | `/api/v1/monitored-entities/:id` |

As regras aceitam condições simples de igualdade e templates como `{{data.processNumber}}`.

### Notificações

Todas requerem `X-Admin-Key`.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/v1/notifications` | Lista notificações; aceita `page`, `pageSize`, `userId`, `departmentId`, `source`, `eventType` e `severity`. |
| GET | `/api/v1/notifications/unread-count?userId=1234` | Retorna o total não lido do usuário. |
| GET | `/api/v1/notifications/:id` | Consulta uma notificação. |
| PATCH | `/api/v1/notifications/:id/read` | Marca como lida. Payload: `{ "userId": "1234" }`. |

### Entregas e auditoria

Todas requerem `X-Admin-Key`.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/v1/deliveries` | Lista entregas. |
| GET | `/api/v1/deliveries/:id` | Consulta uma entrega. |
| POST | `/api/v1/deliveries/:id/retry` | Recoloca uma entrega em estado `PENDING`. |
| GET | `/api/v1/audit-logs` | Lista registros de auditoria. |

### Desenvolvimento: fonte mock

Disponível somente fora de produção e requer `X-Admin-Key`.

| Método | Rota | Descrição |
| --- | --- | --- |
| PATCH | `/api/v1/dev/mock-source/entities/:externalId` | Atualiza o JSON armazenado para uma entidade mock. |

Exemplo:

```powershell
curl.exe -X PATCH http://localhost:3000/api/v1/dev/mock-source/entities/1316192 `
  -H "X-Admin-Key: sua-chave" `
  -H "Content-Type: application/json" `
  -d '{"data":{"processNumber":"TC/009666/2017","status":"Em arquivamento","area":"Gabinete X","judgment":false,"documents":[]}}'
```

## Limitações atuais

O projeto ainda está em evolução. Há base para eventos, regras, entregas e dados mock, mas a autenticação de sistemas por `X-System-Key`, a sincronização acionada por rota, o retry automático completo e a documentação OpenAPI detalhada ainda precisam ser completados antes de uso institucional.
