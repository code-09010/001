# 修鞋取件系统（cobbler）

市场修鞋摊用的取件管理：客人放下鞋时登记**鞋子描述、毛病、预估取件日**，系统吐出一个**四位码**给客人；
店员凭码把工单进度推进为 **已收 → 修补中 → 可取 → 已取走**，状态为「可取」的工单整单高亮，避免拿错、交错鞋。

## 目录结构

```
.
├── docker-compose.yml   # 先起 Postgres（健康检查通过后）再起 slip-api
├── slip-api/            # 接口服务（Express + pg）
└── ticket-web/          # 店员页（Vite 原生页面，npm run dev 启动）
```

## 启动方式

### 1. 接口 + 数据库（Docker）

```bash
docker compose up -d --build
```

- Postgres：`localhost:5432`，库名/用户/密码均为 `cobbler`，数据存在 `pgdata` 卷里
- 接口：`http://localhost:3000`，首次启动自动建表

### 2. 店员页（另开一个终端）

```bash
cd ticket-web
npm install
npm run dev
```

打开 `http://localhost:5173` 即可。开发服务器会把 `/api` 请求代理到 `localhost:3000`
（接口在别的机器上时，可用 `VITE_API_TARGET=http://接口地址:3000 npm run dev`）。

## 日常使用

1. 客人放下鞋 → 左边填描述、毛病、预估取件日 → 「登记并出码」→ 把弹出的四位码写给/贴给客人。
2. 开始修：在工单上点「改为修补中」。
3. 修好：点「改为可取」，该单会**橙色高亮并排到列表最前**。
4. 客人凭码取鞋：顶部搜索框输码定位，核对无误后点「改为已取走」。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/tickets` | 新建工单，body：`{description, problem?, expectedPickup?}`（取件日不得早于今天），返回含 `code` |
| `GET` | `/api/tickets` | 分页列表（可取优先），参数：`status`、`q`（按四位码前缀搜）、`page`（从 1 起）、`pageSize`（默认 20，最大 100），返回 `{items, page, pageSize, total, totalPages}` |
| `GET` | `/api/tickets/:code` | 按四位码查单 |
| `PATCH` | `/api/tickets/:code/status` | 推进到**相邻的下一个**状态（已收→修补中→可取→已取走，不可跳步/倒退），body：`{status}` |

四位码在「未取走」的工单中唯一（数据库约束保证）；客人取走后该码可重新发给新客人。

## 不用 Docker 本机调试接口

```bash
cd slip-api
cp .env.example .env   # PGHOST 改成 localhost，并确保本机 Postgres 已建库
npm install
npm run dev
```
