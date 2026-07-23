import express from 'express';
const app = express();
app.use(express.json());
let mode = 'SUCCESS';
const received = new Map<string, unknown>();
app.post('/api/integracoes/alertas', (req, res) => {
  const key = req.header('idempotency-key');
  if (!key) return res.sendStatus(400);
  if (received.has(key)) return res.sendStatus(409);
  if (mode === 'ERROR_500') return res.sendStatus(500);
  if (mode === 'ERROR_429') return res.sendStatus(429);
  if (mode === 'UNAUTHORIZED') return res.sendStatus(401);
  if (mode === 'TIMEOUT') return setTimeout(() => res.sendStatus(201), 15000);
  received.set(key, req.body);
  return res.sendStatus(201);
});
app.get('/received', (_, res) => res.json([...received.values()]));
app.delete('/received', (_, res) => {
  received.clear();
  res.sendStatus(204);
});
app.patch('/mode', (req, res) => {
  mode = req.body.mode;
  res.json({ mode });
});
app.listen(4001);
