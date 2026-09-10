import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { pool, STATUSES } from './db.js';

export const ticketsRouter = Router();

const STATUS_LABELS = {
  received: '已收',
  repairing: '修补中',
  ready: '可取',
  picked_up: '已取走',
};

function padCode(n) {
  return String(n).padStart(4, '0');
}

function toTicket(row) {
  return {
    code: row.code.trim(),
    description: row.description,
    problem: row.problem,
    expectedPickup: row.expected_pickup ?? null,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 生成一个在"未取走"单子中不冲突的四位码（0000-9999） */
function randomCode() {
  return padCode(randomInt(0, 10000));
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// 新建工单：放下鞋时填描述、毛病、预估取件日，吐出四位码
ticketsRouter.post('/', async (req, res, next) => {
  try {
    const description = String(req.body?.description ?? '').trim();
    const problem = String(req.body?.problem ?? '').trim();
    const expectedPickup = req.body?.expectedPickup
      ? String(req.body.expectedPickup).trim()
      : null;

    if (!description) {
      return res.status(400).json({ error: '鞋子描述不能为空' });
    }
    if (description.length > 200 || problem.length > 500) {
      return res.status(400).json({ error: '填写内容过长' });
    }
    if (expectedPickup && !isValidDate(expectedPickup)) {
      return res.status(400).json({ error: '预估取件日格式应为 YYYY-MM-DD' });
    }

    // 边发码边插入：若撞上并发登记（唯一索引 23505），换码重试
    let rows;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        ({ rows } = await pool.query(
          `INSERT INTO tickets (code, description, problem, expected_pickup)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [randomCode(), description, problem, expectedPickup],
        ));
        break;
      } catch (err) {
        if (err.code !== '23505' || attempt === 9) throw err;
      }
    }
    res.status(201).json(toTicket(rows[0]));
  } catch (err) {
    next(err);
  }
});

// 工单列表，可取的排最前，其余按收鞋时间倒序；可用 ?status= 过滤
ticketsRouter.get('/', async (req, res, next) => {
  try {
    const filter = STATUSES.includes(req.query.status) ? req.query.status : null;
    const { rows } = await pool.query(
      `SELECT * FROM tickets
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY (status = 'ready') DESC, created_at DESC`,
      [filter],
    );
    res.json(rows.map(toTicket));
  } catch (err) {
    next(err);
  }
});

// 按四位码查单
ticketsRouter.get('/:code', async (req, res, next) => {
  try {
    const code = padCode(Number(req.params.code));
    if (!/^\d{4}$/.test(code)) {
      return res.status(400).json({ error: '请输入四位数字码' });
    }
    const { rows } = await pool.query(
      `SELECT * FROM tickets WHERE code = $1 ORDER BY created_at DESC LIMIT 1`,
      [code],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '查无此单' });
    }
    res.json(toTicket(rows[0]));
  } catch (err) {
    next(err);
  }
});

// 按码推进进度：已收 → 修补中 → 可取 → 已取走（只能往前走）
ticketsRouter.patch('/:code/status', async (req, res, next) => {
  try {
    const codeParam = String(req.params.code ?? '').trim();
    if (!/^\d{4}$/.test(codeParam)) {
      return res.status(400).json({ error: '请输入四位数字码' });
    }
    const nextStatus = String(req.body?.status ?? '');
    if (!STATUSES.includes(nextStatus)) {
      return res.status(400).json({ error: '状态不合法' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM tickets
         WHERE code = $1 AND status <> 'picked_up'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [codeParam],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '查无此单或已取走' });
      }

      const current = rows[0];
      const fromIdx = STATUSES.indexOf(current.status);
      const toIdx = STATUSES.indexOf(nextStatus);
      if (toIdx <= fromIdx) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `当前为「${STATUS_LABELS[current.status]}」，只能改成后面的状态`,
        });
      }

      const { rows: updated } = await client.query(
        `UPDATE tickets SET status = $1, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [nextStatus, current.id],
      );
      await client.query('COMMIT');
      res.json(toTicket(updated[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});
