import express from 'express';
import cors from 'cors';
import { initSchema, waitForDatabase, STATUSES } from './db.js';
import { ticketsRouter } from './tickets.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/statuses', (_req, res) =>
  res.json(
    STATUSES.map((value) => ({
      value,
      label: { received: '已收', repairing: '修补中', ready: '可取', picked_up: '已取走' }[value],
    })),
  ),
);
app.use('/api/tickets', ticketsRouter);

// 兜底错误处理
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器开小差了，请稍后再试' });
});

const port = Number(process.env.PORT || 3000);

await waitForDatabase();
await initSchema();
app.listen(port, () => {
  console.log(`slip-api 已启动：http://localhost:${port}`);
});
