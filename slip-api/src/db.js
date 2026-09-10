import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'cobbler',
  user: process.env.PGUSER || 'cobbler',
  password: process.env.PGPASSWORD || 'cobbler',
  max: 10,
});

export const STATUSES = ['received', 'repairing', 'ready', 'picked_up'];

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id               BIGSERIAL    PRIMARY KEY,
      code             CHAR(4)      NOT NULL,
      description      TEXT         NOT NULL,
      problem          TEXT         NOT NULL DEFAULT '',
      expected_pickup  DATE,
      status           TEXT         NOT NULL DEFAULT 'received',
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT tickets_status_check
        CHECK (status IN ('received', 'repairing', 'ready', 'picked_up'))
    );
  `);

  // 四位码只在"未取走"的单子里唯一；取走后号码可以再发给新客人
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS tickets_active_code_uniq
      ON tickets (code)
      WHERE status <> 'picked_up';
  `);
}

/** 等待 Postgres 就绪（compose 里虽有健康检查，这里再兜一层） */
export async function waitForDatabase(retries = 30, delayMs = 1000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`等待 Postgres 就绪（第 ${i}/${retries} 次）…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
