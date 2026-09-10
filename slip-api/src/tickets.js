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

/** 服务器本地日期 YYYY-MM-DD（店铺按本地时间营业） */
function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
    if (expectedPickup) {
      if (!isValidDate(expectedPickup)) {
        return res.status(400).json({ error: '预估取件日格式应为 YYYY-MM-DD' });
      }
      if (expectedPickup < localDateString(new Date())) {
        return res.status(400).json({ error: '预估取件日不能早于今天' });
      }
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

// 工单列表：后端按状态/四位码过滤并分页；可取的排最前，其余按收鞋时间倒序
// 查询参数：status、q（按码模糊搜）、page（从 1 起）、pageSize（1-100）
ticketsRouter.get('/', async (req, res, next) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const q = String(req.query.q ?? '').trim();
    if (q && !/^\d{1,4}$/.test(q)) {
      return res.status(400).json({ error: '取件码只能是数字' });
    }

    let page = Number.parseInt(req.query.page, 10);
    let pageSize = Number.parseInt(req.query.pageSize, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;

    const conditions = ['($1::text IS NULL OR status = $1)', '($2::text IS NULL OR code LIKE $2)'];
    const params = [status, q ? `${q}%` : null];

    const countSql = `SELECT count(*)::int AS total FROM tickets WHERE ${conditions.join(' AND ')}`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = countRows[0].total;

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * pageSize;

    const { rows } = await pool.query(
      `SELECT * FROM tickets
       WHERE ${conditions.join(' AND ')}
       ORDER BY (status = 'ready') DESC, created_at DESC
       LIMIT $3 OFFSET $4`,
      [...params, pageSize, offset],
    );

    res.json({
      items: rows.map(toTicket),
      page,
      pageSize,
      total,
      totalPages,
    });
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
      // 只允许改成紧挨着的下一个状态，不允许跳步或倒退
      if (toIdx !== fromIdx + 1) {
        await client.query('ROLLBACK');
        const expected = STATUS_LABELS[STATUSES[fromIdx + 1]];
        return res.status(409).json({
          error: expected
            ? `当前为「${STATUS_LABELS[current.status]}」，只能先改成「${expected}」`
            : '该单已取走，不能再改状态',
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
