---
title: PostgreSQL 行级安全（RLS）：把租户隔离交给数据库
description: 多租户系统里最怕的一类事故，是某条查询忘了写 WHERE tenant_id = ?。PostgreSQL 的行级安全（Row-Level Security）可以把这条过滤条件放进数据库本身。这篇从基本用法讲到策略语义、会话变量、连接池、绕过 RLS 的各种路径和性能，所有示例都在 PostgreSQL 16 上实际跑过。
pubDate: 2026-11-15
tags: [PostgreSQL, 数据库, 安全, 多租户]
---

做过多租户 SaaS 的人，大概都有过这种担心：所有表都有一列 `tenant_id`，每条查询都得带上 `WHERE tenant_id = ?`。几百条查询里，只要有一条漏了，A 公司就能看到 B 公司的数据。

常见的做法是在应用层兜底：ORM 里加一个全局过滤器，或者每个 Repository 方法都强制传租户 ID。这些办法有效，但它们都依赖"所有访问数据库的代码都走这一层"。报表脚本、后台任务、某个同事临时写的原生 SQL、以后接进来的 Agent，都可能绕过去。

PostgreSQL 从 9.5（2016 年 1 月发布）开始提供**行级安全**（Row-Level Security，下文简称 RLS）<sup class="cite" id="cite-1"><a href="#ref-1" title="PostgreSQL 9.5 Release Notes">1</a></sup>。它的思路很直接：既然每条查询都要带同一个过滤条件，那就把这个条件写在表上，由数据库在每次查询时自动加进去。应用代码忘了写，数据库也不会忘。

这篇从最小的例子开始，再讲策略到底怎么生效、怎么告诉数据库"当前是哪个租户"、哪些情况会绕过 RLS，以及它对性能的影响。文中的 SQL 都在 PostgreSQL 16 上跑过，输出是实际结果。

## 一分钟上手

先建一张多租户的表。这里用两个角色：`app_owner` 是表的所有者，跑迁移用；`app_user` 是应用连接数据库时用的角色。这个区分后面会讲到为什么重要。

```sql
CREATE TABLE projects (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  name      text   NOT NULL
);
CREATE INDEX ON projects (tenant_id);

INSERT INTO projects (tenant_id, name)
VALUES (1, '官网'), (1, 'App'), (2, '内部系统');

GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_user;
```

然后打开 RLS：

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
```

这时候用 `app_user` 查询，会发现一行都看不到：

```text
app_user=> SELECT count(*) FROM projects;
 count
-------
     0
```

这是 RLS 的第一个规则：**表上开了 RLS 但没有任何策略时，默认拒绝**，所有行都不可见，也不能修改<sup class="cite" id="cite-2"><a href="#ref-2" title="PostgreSQL: Row Security Policies">2</a></sup>。所以打开 RLS 本身是安全的，最坏的情况是查不到数据，而不是查到别人的数据。

接着加一条策略，让每个连接只能看到"当前租户"的行：

```sql
CREATE POLICY tenant_isolation ON projects
  USING      (tenant_id = current_setting('app.tenant_id')::bigint)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::bigint);
```

`app.tenant_id` 是一个自定义的会话变量，应用在每个事务开始时设置它：

```text
app_user=> BEGIN;
app_user=> SELECT set_config('app.tenant_id', '1', true);
app_user=> SELECT * FROM projects;
 id | tenant_id | name
----+-----------+------
  1 |         1 | 官网
  2 |         1 | App

app_user=> INSERT INTO projects (tenant_id, name) VALUES (2, '偷塞');
ERROR:  new row violates row-level security policy for table "projects"
```

查询里没写任何 `WHERE tenant_id`，结果却只有租户 1 的数据；想往租户 2 里插数据，直接报错。这就是 RLS 的全部核心用法，剩下的内容都是在讲它的细节和坑。

## 策略是怎么生效的

### USING 和 WITH CHECK

一条策略有两个表达式，分别管两件事：

- **`USING`** 管"已有的行能不能被看到"。它作用于 `SELECT`、`UPDATE`、`DELETE` 读到的行，不满足条件的行会被**静默过滤**，就像它们不存在一样，不会报错；
- **`WITH CHECK`** 管"新写入的行合不合法"。它作用于 `INSERT` 和 `UPDATE` 之后的新行，不满足条件会**直接报错**<sup class="cite" id="cite-3"><a href="#ref-3" title="PostgreSQL: CREATE POLICY">3</a></sup>。

如果只写了 `USING` 没写 `WITH CHECK`，PostgreSQL 会把 `USING` 也拿来当 `WITH CHECK` 用。不过我建议两个都显式写出来，读的人一眼就能看懂。

"静默过滤"这一点要特别留意。用租户 2 的身份去改租户 1 的数据：

```text
app_user=> SET LOCAL app.tenant_id = '2';
app_user=> UPDATE projects SET name = 'x' WHERE tenant_id = 1;
UPDATE 0
app_user=> UPDATE projects SET tenant_id = 1 WHERE name = '内部系统';
ERROR:  new row violates row-level security policy for table "projects"
```

第一条 `UPDATE` 没有报错，只是影响了 0 行，因为租户 1 的行对它来说根本不存在。第二条想把自己的行"挪"到租户 1，被 `WITH CHECK` 拦了下来。也就是说，**越权读和越权改不会有错误提示**，只有越权写入新值才会报错。如果你的业务代码依赖"更新了几行"来判断成功与否，要记得这一点。

### 数据库替你加了一个 WHERE

从执行计划可以看得更清楚。策略的条件被直接并进了查询的过滤条件，还用上了 `tenant_id` 上的索引：

```text
app_user=> EXPLAIN (COSTS OFF) SELECT * FROM projects WHERE name = '官网';
 Bitmap Heap Scan on projects
   Recheck Cond: (tenant_id = (current_setting('app.tenant_id'))::bigint)
   Filter: ((NOT archived) AND (name = '官网'::text))
   ->  Bitmap Index Scan on projects_tenant_id_idx
         Index Cond: (tenant_id = (current_setting('app.tenant_id'))::bigint)
```

<figure class="diagram">
<svg viewBox="0 0 640 230" role="img" aria-label="RLS 的工作方式：应用设置会话变量，数据库在规划查询时把策略条件并入 WHERE">
<defs><marker id="rl1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-amber" x="20" y="30" width="150" height="70" rx="6"/><text class="t" x="95" y="56" text-anchor="middle">应用（一次请求）</text><text class="ts" x="95" y="76" text-anchor="middle">SET LOCAL</text><text class="ts" x="95" y="92" text-anchor="middle">app.tenant_id = 1</text>
<path class="ln" d="M172 65 H226" marker-end="url(#rl1)"/>
<rect class="c-blue" x="230" y="30" width="190" height="70" rx="6"/><text class="t" x="325" y="56" text-anchor="middle">应用发出的 SQL</text><text class="ts" x="325" y="78" text-anchor="middle">SELECT * FROM projects</text><text class="ts" x="325" y="94" text-anchor="middle">WHERE name = '官网'</text>
<path class="ln" d="M422 65 H476" marker-end="url(#rl1)"/>
<rect class="c-purple" x="480" y="30" width="140" height="70" rx="6"/><text class="t" x="550" y="56" text-anchor="middle">规划器</text><text class="ts" x="550" y="76" text-anchor="middle">读取表上的策略</text><text class="ts" x="550" y="92" text-anchor="middle">pg_policies</text>
<path class="ln" d="M550 102 V140" marker-end="url(#rl1)"/>
<rect class="c-green" x="20" y="144" width="600" height="66" rx="6"/><text class="t" x="320" y="168" text-anchor="middle">实际执行的条件</text><text class="ts" x="320" y="190" text-anchor="middle">name = '官网'  AND  tenant_id = current_setting('app.tenant_id')  AND  NOT archived</text>
<text class="ts" x="20" y="128">多条策略：permissive 之间用 OR，restrictive 之间用 AND</text>
</svg>
<figcaption>图 1：RLS 不改变应用的 SQL，而是在规划阶段把表上的策略条件并进去。</figcaption>
</figure>

### 按命令区分，以及策略之间怎么组合

策略可以只针对某一类命令（`FOR SELECT / INSERT / UPDATE / DELETE`），不写就是 `FOR ALL`。一张表上可以有多条策略，组合规则是<sup class="cite"><a href="#ref-3" title="PostgreSQL: CREATE POLICY">3</a></sup>：

- **PERMISSIVE**（默认）：多条之间用 `OR` 组合，满足任意一条就放行。适合"本租户的行，或者公开的行"这类"多种途径都能看到"的规则；
- **RESTRICTIVE**：多条之间用 `AND` 组合，并且和 permissive 的结果再取 `AND`。适合"无论如何都必须满足"的硬性条件。

上面执行计划里的 `NOT archived`，就来自我加的一条 restrictive 策略，用来隐藏已归档的项目：

```sql
CREATE POLICY hide_archived ON projects
  AS RESTRICTIVE FOR SELECT
  USING (NOT archived);
```

要注意，**只有 restrictive 策略、没有 permissive 策略时，所有行都不可见**。restrictive 只能在 permissive 放行的范围里再收紧，不能单独放行。

### UPDATE 需要 SELECT 策略

这是一个很容易踩的坑。下面这张表只有一条 `FOR UPDATE` 策略：

```sql
CREATE POLICY upd ON notes FOR UPDATE USING (owner = current_user);
```

用户去改自己的笔记：

```text
app_user=> UPDATE notes SET body = 'A' WHERE id = 1;
UPDATE 0
app_user=> UPDATE notes SET body = 'B';
UPDATE 1
```

带 `WHERE` 的反而改不了，不带 `WHERE` 的却改成功了。原因是带 `WHERE`（或 `RETURNING`）的 `UPDATE` 需要先"读"已有的行，所以 SELECT 策略也会生效，而这张表没有 SELECT 策略，默认拒绝<sup class="cite"><a href="#ref-3" title="PostgreSQL: CREATE POLICY">3</a></sup>。补上一条 `FOR SELECT` 策略后，第一条语句就正常了。实际业务里几乎所有 `UPDATE` 和 `DELETE` 都带 `WHERE`，所以按命令拆策略时，**别忘了 SELECT**。多租户隔离这种场景，直接用 `FOR ALL` 的一条策略最省心。

## 怎么告诉数据库"我是谁"

策略里总要引用"当前是谁"。有两种主流做法。

### 做法一：每个用户一个数据库角色

策略写成 `owner = current_user`，每个终端用户对应一个 PostgreSQL 角色。这种方式最"正统"，身份由数据库自己认证，应用没办法伪造。AWS 那篇关于 RLS 多租户的文章，主例子用的就是这种方式<sup class="cite" id="cite-4"><a href="#ref-4" title="Multi-tenant data isolation with PostgreSQL Row Level Security">4</a></sup>。

缺点也很明显：角色要随着租户或用户一起创建和删除，连接池按角色分开，几万个用户就是几万个角色。它比较适合租户数量少、每个租户有独立连接的场景。

### 做法二：会话变量

更常见的是上面例子里的做法：应用用同一个角色连接，在事务开始时把当前租户写进一个自定义变量，策略用 `current_setting()` 读取。Supabase 的 `auth.uid()` 本质上也是这个思路，只不过变量里放的是从 JWT 解出来的用户信息<sup class="cite" id="cite-5"><a href="#ref-5" title="Supabase: Row Level Security">5</a></sup>。

这种做法的前提是：**设置变量的那段代码必须可信**。数据库只认变量，不认是谁设置的。如果攻击者能执行任意 SQL，自己 `SET app.tenant_id = '2'` 就能切换租户。所以会话变量方案防的是"应用代码写漏了"，不是"攻击者拿到了数据库连接"。

设置变量时，有三个细节值得注意。

**第一，一定要用事务级别的设置。** `set_config(name, value, true)` 的第三个参数 `is_local` 为 `true` 时，设置只在当前事务内有效；等价的写法是 `SET LOCAL`<sup class="cite" id="cite-6"><a href="#ref-6" title="PostgreSQL: System Administration Functions">6</a></sup>。如果用了会话级的 `SET`，再遇上连接池，后果是这样的：

```text
-- 请求 A：用会话级 SET
app_user=> SET app.tenant_id = '1';
app_user=> SELECT count(*) FROM projects;
     1
-- 请求 B 复用了同一个连接，但忘了设置租户
app_user=> SELECT count(*) FROM projects;
     1
```

请求 B 什么都没设，却继承了上一个请求的租户身份。用 `SET LOCAL` 的话，事务一结束设置就消失了，请求 B 只会看到 0 行。PgBouncer 的事务池模式本身也不支持会话级的 `SET`，文档里写得很明确<sup class="cite" id="cite-7"><a href="#ref-7" title="PgBouncer features">7</a></sup>，AWS 那篇文章也专门提醒了会话变量和服务端连接池的兼容问题<sup class="cite"><a href="#ref-4" title="Multi-tenant data isolation with PostgreSQL Row Level Security">4</a></sup>。事务级的设置跟着事务走，在事务池模式下也是安全的。

**第二，处理"没设置"的情况。** `current_setting('app.tenant_id')` 在变量从未设置过时会直接报错；第二个参数传 `true`（`missing_ok`）则返回 `NULL`<sup class="cite"><a href="#ref-6" title="PostgreSQL: System Administration Functions">6</a></sup>。但这里还有一个我实测才发现的坑：**同一个连接上一旦设置过这个变量，事务结束后它不会变回"不存在"，而是变成空字符串**。

```text
app_user=> BEGIN; SELECT set_config('app.tenant_id', '1', true); ROLLBACK;
app_user=> SELECT current_setting('app.tenant_id', true) = '' AS is_empty;
 is_empty
----------
 t
app_user=> SELECT ''::bigint;
ERROR:  invalid input syntax for type bigint: ""
```

所以只加 `missing_ok` 还不够，复用的连接上会出现 `''::bigint` 的类型转换错误。更稳妥的写法是用 `nullif` 把空字符串也变成 `NULL`：

```sql
CREATE POLICY tenant_isolation ON projects
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint);
```

`tenant_id = NULL` 的结果是 `NULL`，不算满足条件，没设置租户时就是一行都看不到，正好是我们想要的"默认拒绝"。

**第三，把这段逻辑包成一个函数。** 每条策略都写一遍 `nullif(current_setting(...))` 很啰嗦，也容易写错。可以定义一个 `STABLE` 的 SQL 函数：

```sql
CREATE FUNCTION app_tenant_id() RETURNS bigint
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::bigint $$;
```

策略就可以写成 `USING (tenant_id = app_tenant_id())`。性能一节还会回到这个函数。

## 谁会绕过 RLS

RLS 最容易给人一种虚假的安全感：策略写好了，以为万事大吉，结果查询走的是一条根本不经过策略的路。下面这些路径，每一条都值得检查一遍。

- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /> <path d="M5 21h14" /> </svg></span>**超级用户**：永远绕过 RLS<sup class="cite"><a href="#ref-2" title="PostgreSQL: Row Security Policies">2</a></sup>。应用绝不能用 `postgres` 这样的超级用户连接数据库。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" /> </svg></span>**带 `BYPASSRLS` 属性的角色**：同样绕过所有策略。这个属性适合给备份或运维角色，不能给应用角色。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="18" cy="15" r="3" /> <circle cx="9" cy="7" r="4" /> <path d="M10 15H6a4 4 0 0 0-4 4v2" /> <path d="m21.7 16.4-.9-.3" /> <path d="m15.2 13.9-.9-.3" /> <path d="m16.6 18.7.3-.9" /> <path d="m19.1 12.2.3-.9" /> <path d="m19.6 18.7-.4-1" /> <path d="m16.8 12.3-.4-1" /> <path d="m14.3 16.6 1-.4" /> <path d="m20.7 13.8 1-.4" /> </svg></span>**表的所有者**：默认也绕过 RLS。这是最常见的坑，很多项目的应用角色恰好就是建表的那个角色。在我的例子里，`app_owner` 查询能看到全部 3 行。解决办法有两个：让应用用一个不拥有表的角色连接（推荐），或者对表执行 `ALTER TABLE ... FORCE ROW LEVEL SECURITY`，让所有者也受策略约束<sup class="cite"><a href="#ref-2" title="PostgreSQL: Row Security Policies">2</a></sup>。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /> <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /> <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /> <path d="m2 2 20 20" /> </svg></span>**视图**：视图默认用**视图所有者**的权限去访问底层的表。如果视图是表的所有者建的，通过视图查询就会绕过 RLS。实测中，同一个租户直接查表看到 2 行，通过普通视图查却看到了 3 行。PostgreSQL 15 开始可以给视图加上 `security_invoker = true`，让它用调用者的身份检查权限和策略<sup class="cite" id="cite-8"><a href="#ref-8" title="PostgreSQL: CREATE VIEW">8</a></sup><sup class="cite" id="cite-9"><a href="#ref-9" title="PostgreSQL 15 Release Notes">9</a></sup>，加上之后通过视图也只能看到 2 行。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" /> <path d="M9 11.2h5.7" /> </svg></span>**`SECURITY DEFINER` 函数**：这类函数以函数所有者的身份执行，如果所有者是表的所有者，函数内的查询同样不受 RLS 约束。有时候这是故意的（比如在策略里查一张受保护的成员表），但要清楚自己在做什么，并且给这类函数固定 `search_path`<sup class="cite" id="cite-10"><a href="#ref-10" title="PostgreSQL: CREATE FUNCTION">10</a></sup>。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /> </svg></span>**唯一约束、主键和外键检查**：引用完整性检查总是绕过 RLS<sup class="cite"><a href="#ref-2" title="PostgreSQL: Row Security Policies">2</a></sup>。比如 `name` 上有一个全局唯一约束，租户 2 插入一个名为"官网"的项目，会收到 `duplicate key value violates unique constraint` 的错误，由此就能推断出别的租户有一个叫"官网"的项目。官方文档把这称为"隐蔽信道"（covert channel）。对多租户表来说，唯一约束一般都应该带上 `tenant_id`，比如 `UNIQUE (tenant_id, name)`。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 2v8" /> <path d="m16 6-4 4-4-4" /> <rect width="20" height="8" x="2" y="14" rx="2" /> <path d="M6 18h.01" /> <path d="M10 18h.01" /> </svg></span>**`row_security` 参数和备份**：普通角色把 `row_security` 设为 `off` 并不能绕过策略，而是会在查询受策略影响时直接报错 `query would be affected by row-level security policy`。`pg_dump` 默认就是这样设置的，这样可以避免备份"悄悄地"只导出了一部分数据<sup class="cite" id="cite-11"><a href="#ref-11" title="PostgreSQL: Client Connection Defaults">11</a></sup>。所以负责备份的角色需要 `BYPASSRLS` 或者是超级用户。

把这些合起来，一个比较稳妥的角色划分是：

| 角色 | 用途 | 拥有表 | BYPASSRLS |
| --- | --- | --- | --- |
| `app_owner` | 跑迁移、建表、建策略 | 是 | 否 |
| `app_user` | 应用日常连接 | 否 | 否 |
| `app_admin` | 运营后台、跨租户报表 | 否 | 视情况，最好用单独的策略 |
| `backup` | 备份 | 否 | 是 |

上线前可以用一条查询，列出 `public` 下所有带 `tenant_id` 列、却没有打开 RLS 的表：

```sql
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
```

这条查询很适合放进 CI，新加一张表忘了开 RLS 时能第一时间发现。

## 性能：大部分时候没问题，但要注意两件事

从前面的执行计划可以看出，RLS 的开销本质上就是"多了一个 WHERE 条件"。只要这个条件能走索引，开销基本可以忽略。需要注意的是下面两件事。

**一是给策略里用到的列建索引。** 这一点很朴素，但最常被忽略。`tenant_id` 没有索引时，每条查询都会变成全表扫描。Supabase 的文档把它列为 RLS 性能优化的第一条<sup class="cite"><a href="#ref-5" title="Supabase: Row Level Security">5</a></sup>。多租户表的复合索引通常也应该把 `tenant_id` 放在第一列。

**二是避免函数被逐行调用。** 如果策略里调用的函数没办法被规划器内联（比如用 PL/pgSQL 写的），而这一列又没有索引可用，函数就会对每一行都执行一次。一个常用的技巧是把函数调用包进一个子查询：`(SELECT app_tenant_id())`。这样规划器会把它当作 InitPlan，整条语句只算一次<sup class="cite"><a href="#ref-5" title="Supabase: Row Level Security">5</a></sup>。

我在一张 100 万行的表上测了一下，策略条件是 `owner_id = 函数()`，函数用 PL/pgSQL 写成：

| 写法 | 执行计划 | 耗时 |
| --- | --- | --- |
| `owner_id = f()`，无索引 | Seq Scan，每行调用一次 `f()` | 约 340 ms |
| `owner_id = (SELECT f())`，无索引 | Seq Scan，`f()` 只算一次 | 约 50 ms |
| `owner_id = (SELECT f())`，有索引 | Index Only Scan | 0.14 ms |

包一层子查询带来了大约 7 倍的提升，而加上索引又快了两个数量级。所以真正的优先级是：**先保证有索引，再考虑函数调用的写法**。另外要注意，这个技巧只适用于结果不随行变化的函数，像"当前用户 ID"这种整条语句内不变的值才可以这么写。

还有一个比较隐蔽的点是 **LEAKPROOF**。为了防止通过函数的报错信息或副作用泄露被策略过滤掉的行，规划器默认不会把用户查询里的条件提前到策略条件之前执行，除非条件里用的函数和运算符被标记为 `LEAKPROOF`<sup class="cite"><a href="#ref-10" title="PostgreSQL: CREATE FUNCTION">10</a></sup>。内置的大部分比较运算符都是 leakproof 的，一般不会遇到问题；但如果你在查询里用了自定义函数，发现开了 RLS 之后某个索引用不上了，可以往这个方向排查。

## 在应用里接上

以 Python 的 FastAPI 加 SQLAlchemy 为例，关键是让"设置租户"和"执行业务查询"处在同一个事务里。思路是写一个依赖项，在每个请求开始时开启事务并设置变量：

```python
from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

async def get_tenant_session(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    tenant_id = request.state.tenant_id  # 由认证中间件从 JWT 中解出
    async with session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tid, true)"),
            {"tid": str(tenant_id)},
        )
        yield session
```

有几点需要注意：

- 用 `set_config(..., true)` 而不是拼接 `SET LOCAL app.tenant_id = ...`，因为 `SET` 语句不支持参数绑定，拼接字符串有注入风险；
- 租户 ID 必须来自已经验证过的身份（比如签名过的 JWT），不能直接读请求参数；
- 后台任务、定时脚本也要走同样的路径设置租户，不要为了方便给它们一个 `BYPASSRLS` 的角色。

## 怎么测试 RLS

RLS 的测试有一个原则：**一定要用应用角色去测**。用超级用户或表的所有者跑测试，所有策略都会被绕过，测试永远是绿的。

我一般会写三类用例：

1. **隔离**：以租户 A 的身份插入数据，再以租户 B 的身份查询，断言结果为空；
2. **写入拦截**：以租户 A 的身份插入一条 `tenant_id = B` 的数据，断言报错；
3. **未设置**：不设置 `app.tenant_id` 直接查询，断言返回 0 行而不是报错或返回全部。

加上前面那条"带 `tenant_id` 却没开 RLS 的表"的检查，基本就能覆盖最常见的回归问题了。

## 什么时候不适合用 RLS

RLS 不是万能的，下面几种情况我会慎重考虑：

- **租户之间需要物理隔离**：比如合规要求每个客户的数据存在独立的库里，那就该用独立的数据库或 schema，RLS 解决不了这个问题；
- **权限逻辑非常复杂**：比如依赖多层组织结构、动态共享、字段级权限。这些逻辑都塞进 SQL 策略里，会变得很难读、很难测，也很难排查性能问题。一种折中是用 RLS 只做租户这一层硬隔离，更细的权限留在应用层；
- **大量跨租户的分析查询**：这类查询更适合放到数仓或只读副本上，用专门的角色来跑。

## 小结

1. **RLS 把过滤条件放进了数据库**：开启后默认拒绝，策略条件在规划阶段被并进每一条查询；
2. **`USING` 管读，`WITH CHECK` 管写**：越权读和越权改是静默的 0 行，只有越权写入新值才会报错；
3. **permissive 用 OR，restrictive 用 AND**，只有 restrictive 时什么都看不到；带 `WHERE` 的 `UPDATE` 还需要 SELECT 策略；
4. **会话变量用事务级设置**：`set_config(..., true)` 或 `SET LOCAL`，并用 `nullif(current_setting(..., true), '')` 处理"没设置"和"空字符串"两种情况；
5. **检查所有绕过路径**：超级用户、`BYPASSRLS`、表所有者、视图、`SECURITY DEFINER` 函数和唯一约束，应用角色不应该拥有表；
6. **性能的关键是索引**，其次是用 `(SELECT f())` 避免函数被逐行调用；
7. **用应用角色测试**，并在 CI 里检查有没有忘了开 RLS 的表。

RLS 不能替代应用层的权限设计，但它能提供一个很重要的保证：就算某一处代码写漏了，数据库这一层也不会把别人的数据交出去。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>PostgreSQL Global Development Group. <a href="https://www.postgresql.org/docs/9.5/release-9-5.html">Release 9.5</a>. 2016-01-07. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/ddl-rowsecurity.html">5.9. Row Security Policies</a>. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/sql-createpolicy.html">CREATE POLICY</a>. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Beardsley M. <a href="https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/">Multi-tenant data isolation with PostgreSQL Row Level Security</a>. <i>AWS Database Blog</i>, 2020. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Supabase Docs. <a href="https://supabase.com/docs/guides/database/postgres/row-level-security">Row Level Security</a>. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/functions-admin.html">9.28. System Administration Functions</a>（set_config / current_setting）. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>PgBouncer. <a href="https://www.pgbouncer.org/features.html">Features</a>（SQL feature map for pooling modes）. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/sql-createview.html">CREATE VIEW</a>（security_invoker）. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>PostgreSQL Global Development Group. <a href="https://www.postgresql.org/docs/15/release-15.html">Release 15</a>. 2022-10-13. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/sql-createfunction.html">CREATE FUNCTION</a>（SECURITY DEFINER / LEAKPROOF）. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/runtime-config-client.html">20.11. Client Connection Defaults</a>（row_security）. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
