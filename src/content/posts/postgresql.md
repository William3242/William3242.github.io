---
title: PostgreSQL 入门到实战：MVCC、索引、扩展与高可用
description: 从"一个连接一个进程"的架构讲起，梳理 PostgreSQL 丰富的数据类型、MVCC 与 VACUUM、六种索引怎么选、扩展生态（包括做向量检索的 pgvector）、复制与备份，以及连接数、长事务、DDL 锁这些生产里最常踩的坑，最后给一个在 FastAPI 里使用 PostgreSQL 的例子。文中的 SQL 都在本地实际跑过。
pubDate: 2026-11-16
tags: [PostgreSQL, 后端, 数据库]
---

如果要给一个新的后端项目挑数据库，这几年最常见的答案是 PostgreSQL。Stack Overflow 2025 年的开发者调查里，PostgreSQL 是使用最多的数据库，55.6% 的受访者在过去一年里大量使用过它，在职业开发者中这个比例是 58.2%；它同时也是"最受喜爱"的数据库，并且从 2023 年起连续三年在两项上都排第一<sup class="cite" id="cite-1"><a href="#ref-1" title="2025 Stack Overflow Developer Survey: Technology">1</a></sup>。

PostgreSQL 上手不难，会写 SQL 就能用。但要真正用好它，需要搞清楚几件事：它的进程模型为什么决定了连接数不能随便开，它的 MVCC 为什么需要 VACUUM，索引除了 B-tree 还有哪些、各适合什么，扩展机制能带来什么，以及哪些操作会在生产环境里把整张表锁住。这篇按这个顺序讲一遍。

这是后端基础设施系列的第二篇，另外两篇是 [FastAPI](/posts/fastapi/) 和 [Redis](/posts/redis/)。PostgreSQL 的行级安全（RLS）内容比较多，单独写成了[一篇文章](/posts/postgres-rls/)，这里只简单提一下。文中的 SQL 都在本地的 PostgreSQL 16 上跑过，贴的是实际输出。

## PostgreSQL 是什么

PostgreSQL 的历史比大多数人想的要长。它起源于加州大学伯克利分校由 Michael Stonebraker 教授领导的 POSTGRES 项目，1986 年开始实现。1994 年，两名研究生给它加上了 SQL 解释器，改名 Postgres95；1996 年又正式改名为 PostgreSQL，一直用到现在<sup class="cite" id="cite-2"><a href="#ref-2" title="A Brief History of PostgreSQL">2</a></sup>。

它的几个特点，基本决定了它今天的地位：

1. **许可证非常宽松**。PostgreSQL 使用自己的 PostgreSQL License，和 BSD、MIT 类似<sup class="cite" id="cite-3"><a href="#ref-3" title="PostgreSQL License">3</a></sup>。它也不属于任何一家公司，而是由社区维护。Redis 那篇提到的许可证风波，在 PostgreSQL 身上不会发生。
2. **功能全、标准兼容好**。事务、外键、窗口函数、CTE、JSON、全文检索、地理信息，开箱就有或者装个扩展就有。
3. **扩展能力强**。数据类型、索引方法、函数语言都可以通过扩展添加，这也是 PostGIS、pgvector、TimescaleDB 这些项目能长在它上面的原因。

### 版本

PostgreSQL 每年发布一个大版本，每个大版本支持 5 年。截至写这篇文章时，最新的正式版本是 2025 年 9 月发布的 PostgreSQL 18，19 还处于候选版本（RC）阶段；13 已经在 2025 年 11 月停止维护<sup class="cite" id="cite-4"><a href="#ref-4" title="PostgreSQL Versioning Policy">4</a></sup>。

PostgreSQL 18 有几个值得一提的新功能<sup class="cite" id="cite-5"><a href="#ref-5" title="PostgreSQL 18 Released!">5</a></sup>：

- **异步 I/O**：新的 AIO 子系统，官方测试在部分从存储读取数据的场景下有最高 3 倍的提升；
- **`uuidv7()` 函数**：生成按时间有序的 UUID，作为主键时比随机的 UUIDv4 对索引友好得多；
- **虚拟生成列**：在查询时计算，不占存储空间，并且成为生成列的默认行为；
- **B-tree 的 skip scan**：多列索引在查询没有用到第一列时，也有机会走索引；
- **OAuth 认证**，以及大版本升级时可以保留优化器统计信息。

新项目直接用 18 就好。下文的内容如果没有特别说明，对 13 以后的版本都适用。

## 架构：一个连接一个进程

PostgreSQL 采用的是"每个用户一个进程"的模型<sup class="cite" id="cite-6"><a href="#ref-6" title="How Connections Are Established">6</a></sup>：有一个主进程负责监听端口，每来一个客户端连接，就 fork 出一个独立的后端进程专门为它服务。所有后端进程通过共享内存交换数据，其中最重要的是缓存数据页的 shared buffers。

<figure class="diagram">
<svg viewBox="0 0 640 304" role="img" aria-label="PostgreSQL 架构：每个连接一个后端进程，共享内存，WAL 与数据文件，以及备库">
<defs><marker id="pg1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-amber" x="20" y="30" width="110" height="34" rx="5"/><text class="ts" x="75" y="52" text-anchor="middle">客户端 1</text>
<rect class="c-amber" x="20" y="80" width="110" height="34" rx="5"/><text class="ts" x="75" y="102" text-anchor="middle">客户端 2</text>
<rect class="c-amber" x="20" y="130" width="110" height="34" rx="5"/><text class="ts" x="75" y="152" text-anchor="middle">客户端 N</text>
<rect class="c-gray" x="175" y="0" width="130" height="24" rx="4"/><text class="ts" x="240" y="17" text-anchor="middle">主进程 postmaster</text>
<rect class="c-blue" x="175" y="30" width="130" height="34" rx="5"/><text class="ts" x="240" y="52" text-anchor="middle">后端进程 1</text>
<rect class="c-blue" x="175" y="80" width="130" height="34" rx="5"/><text class="ts" x="240" y="102" text-anchor="middle">后端进程 2</text>
<rect class="c-blue" x="175" y="130" width="130" height="34" rx="5"/><text class="ts" x="240" y="152" text-anchor="middle">后端进程 N</text>
<path class="ln" d="M132 47 H171" marker-end="url(#pg1)"/><path class="ln" d="M132 97 H171" marker-end="url(#pg1)"/><path class="ln" d="M132 147 H171" marker-end="url(#pg1)"/>
<rect class="c-purple" x="350" y="30" width="150" height="134" rx="8"/><text class="t" x="425" y="58" text-anchor="middle">共享内存</text><text class="ts" x="425" y="84" text-anchor="middle">shared buffers</text><text class="ts" x="425" y="104" text-anchor="middle">WAL buffers</text><text class="ts" x="425" y="124" text-anchor="middle">锁表</text>
<path class="ln" d="M307 47 H346" marker-end="url(#pg1)"/><path class="ln" d="M307 97 H346" marker-end="url(#pg1)"/><path class="ln" d="M307 147 H346" marker-end="url(#pg1)"/>
<rect class="c-green" x="350" y="210" width="70" height="56" rx="6"/><text class="t" x="385" y="234" text-anchor="middle">WAL</text><text class="ts" x="385" y="253" text-anchor="middle">先写日志</text>
<rect class="c-green" x="430" y="210" width="70" height="56" rx="6"/><text class="t" x="465" y="234" text-anchor="middle">数据文件</text><text class="ts" x="465" y="253" text-anchor="middle">检查点刷盘</text>
<path class="ln" d="M395 166 V206" marker-end="url(#pg1)"/><path class="ln" d="M465 166 V206" marker-end="url(#pg1)"/>
<rect class="c-gray dash" x="540" y="210" width="85" height="56" rx="6"/><text class="t" x="582" y="234" text-anchor="middle">备库</text><text class="ts" x="582" y="253" text-anchor="middle">回放 WAL</text>
<path class="ln" d="M385 268 C385 296, 582 296, 582 272" marker-end="url(#pg1)"/>
<text class="ts" x="20" y="200">每个连接都是一个独立进程，</text><text class="ts" x="20" y="218">内存开销以 MB 计，</text><text class="ts" x="20" y="236">所以连接数要省着用，</text><text class="ts" x="20" y="254">前面通常要加连接池。</text>
</svg>
<figcaption>图 1：PostgreSQL 的进程模型。所有修改先写 WAL，再由检查点把数据页刷到磁盘；备库通过回放同一份 WAL 保持同步。</figcaption>
</figure>

这个模型有两个直接的后果。

**第一，连接很"贵"**。每个连接是一个操作系统进程，建立连接要 fork，每个进程还有自己的内存开销。`max_connections` 的默认值通常只有 100<sup class="cite" id="cite-7"><a href="#ref-7" title="Connections and Authentication">7</a></sup>。它可以调大，但几千个直连的效果通常很差。所以生产环境里，应用和数据库之间几乎总会有一层连接池，要么是应用内的连接池（比如 SQLAlchemy 自带的），要么是 PgBouncer 这样的独立连接池，或者两者都有。

**第二，所有修改都先写 WAL**（Write-Ahead Log，预写日志）。事务提交时，只要 WAL 落盘就算成功，数据页可以之后再慢慢刷。数据库崩溃后，靠回放 WAL 恢复到一致的状态。后面讲的流复制、时间点恢复，也都建立在 WAL 之上。

## 数据类型：比你想的多

很多人用 PostgreSQL 的方式和用 MySQL 差不多，只用整数、字符串和时间。其实 PostgreSQL 的数据类型非常丰富<sup class="cite" id="cite-8"><a href="#ref-8" title="Data Types">8</a></sup>，用对了能省掉不少应用层的代码：

- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" /> <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" /> </svg></span>**`jsonb`**：二进制存储的 JSON，支持索引和丰富的查询运算符，比如 `meta @> '{"coupon": true}'` 判断包含关系。适合存结构不固定的属性，但不要把所有东西都塞进去，经常查询和关联的字段还是应该拆成普通列。（另有一个 `json` 类型按原文存储，一般用 `jsonb` 就对了。）
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M16 3h3v18h-3" /> <path d="M8 21H5V3h3" /> </svg></span>**数组**：任何类型都可以有数组，比如 `text[]`。存标签这类"一对少量"的数据很方便，配合 GIN 索引还能高效地查"包含某个标签"。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="12" cy="12" r="10" /> <polyline points="12 6 12 12 16.5 12" /> </svg></span>**`timestamptz`**：带时区的时间戳。它在内部统一存成 UTC，读取时按会话的时区显示。存时间点的列，几乎都应该用 `timestamptz` 而不是 `timestamp`，否则跨时区时很容易出错。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M16 2v4" /> <path d="M3 10h18" /> <path d="M8 2v4" /> <path d="M17 14h-6" /> <path d="M13 18H7" /> <path d="M7 14h.01" /> <path d="M17 18h.01" /> </svg></span>**范围类型**：`tstzrange`、`int4range`、`daterange` 等，表示一个区间。配合排除约束（`EXCLUDE`），可以在数据库层面保证"同一个会议室的预订时间不重叠"，不用在应用里加锁检查。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /> <path d="M14 13.12c0 2.38 0 6.38-1 8.88" /> <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /> <path d="M2 12a10 10 0 0 1 18-6" /> <path d="M2 16h.01" /> <path d="M21.8 16c.2-2 .131-5.354 0-6" /> <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /> <path d="M8.65 22c.21-.66.45-1.32.57-2" /> <path d="M9 6.8a6 6 0 0 1 9 5.2v2" /> </svg></span>**`uuid`**：16 字节存储，比存成字符串小一半多。做主键时优先考虑 18 里的 `uuidv7()`，它按时间递增，插入时不会让 B-tree 索引到处分裂。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="16" height="20" x="4" y="2" rx="2" /> <line x1="8" x2="16" y1="6" y2="6" /> <line x1="16" x2="16" y1="14" y2="18" /> <path d="M16 10h.01" /> <path d="M12 10h.01" /> <path d="M8 10h.01" /> <path d="M12 14h.01" /> <path d="M8 14h.01" /> <path d="M12 18h.01" /> <path d="M8 18h.01" /> </svg></span>**`numeric`**：任意精度的十进制数，金额一定要用它，不要用浮点数。
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19" /> <path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z" /> <circle cx="6.5" cy="9.5" r=".5" fill="currentColor" /> </svg></span>**枚举、域、复合类型**：可以自定义类型，比如 `CREATE TYPE order_status AS ENUM (...)`，或者用 `CREATE DOMAIN` 给一个基础类型加上约束。

另外，主键推荐用 `GENERATED ALWAYS AS IDENTITY` 而不是老式的 `serial`，前者是 SQL 标准写法，权限和所有权的行为也更清晰。

## MVCC：每次 UPDATE 都会留下一个旧版本

PostgreSQL 用多版本并发控制（MVCC）来处理并发读写：读不阻塞写，写也不阻塞读<sup class="cite" id="cite-9"><a href="#ref-9" title="Concurrency Control: Introduction">9</a></sup>。它的实现方式很直接：**UPDATE 不是原地修改，而是写一个新版本的行，把旧版本标记为过期**。

每一行都有几个隐藏的系统列，可以直接查出来看：

```text
demo=# SELECT xmin, xmax, ctid, * FROM accounts;
 xmin | xmax | ctid  | id | balance
------+------+-------+----+---------
  857 |    0 | (0,1) |  1 |     100

demo=# UPDATE accounts SET balance = 90 WHERE id = 1;
demo=# SELECT xmin, xmax, ctid, * FROM accounts;
 xmin | xmax | ctid  | id | balance
------+------+-------+----+---------
  858 |    0 | (0,2) |  1 |      90
```

`xmin` 是创建这个版本的事务 ID，`ctid` 是它在数据文件里的物理位置。UPDATE 之后，同一个 `id = 1` 的行，物理位置从 `(0,1)` 变成了 `(0,2)`，创建它的事务也变了。原来 `(0,1)` 的那个旧版本还在磁盘上，只是对新的事务不可见了。

每个事务根据自己的快照，判断哪些版本对自己可见。这样读的人看到的是一致的快照，写的人写新版本，互不干扰。

### VACUUM：清理旧版本

代价是旧版本会越积越多。这些不再对任何事务可见的旧版本叫**死元组**（dead tuple），需要 VACUUM 来清理<sup class="cite" id="cite-10"><a href="#ref-10" title="Routine Vacuuming">10</a></sup>。我在一张 200 万行的表上关掉自动清理，更新其中 100 万行，看看会发生什么：

```text
-- 更新前
 table_size: 208 MB

demo=# UPDATE orders SET status = status WHERE id <= 1000000;
 n_live_tup | n_dead_tup
------------+------------
    2000000 |    1000000
 table_size: 313 MB

demo=# VACUUM orders;
 n_live_tup | n_dead_tup
------------+------------
    2000000 |          0
 table_size: 313 MB
```

两个现象值得注意：

1. **哪怕值没变，UPDATE 也会产生死元组**。`SET status = status` 什么都没改，表却从 208 MB 涨到了 313 MB；
2. **普通的 VACUUM 不会把空间还给操作系统**。它只是把死元组占的空间标记为可复用，之后的插入和更新会用掉这些空间，所以表的大小还是 313 MB。真要缩小文件，需要 `VACUUM FULL`，但它会锁住整张表重写，生产环境里要慎用。

VACUUM 还有一个更重要的任务：防止**事务 ID 回卷**。PostgreSQL 的事务 ID 是 32 位的，大约 20 亿个事务之后就会"绕回来"，旧的行会突然看起来像是"未来"的数据。所以每张表至少每 20 亿个事务就要被 VACUUM 一次<sup class="cite"><a href="#ref-10" title="Routine Vacuuming">10</a></sup>。

好在这些事默认由 **autovacuum** 自动完成。大多数时候不用管它，需要注意的是两件事：不要关掉它；以及不要让**长事务**一直开着，因为只要有一个老快照还在，它可能看得到的旧版本就都不能被清理。这一点在后面"常见的坑"里还会讲到。

### 事务隔离级别

PostgreSQL 的默认隔离级别是**读已提交**（Read Committed）：每条语句开始时取一个新快照，能看到其他事务已经提交的修改<sup class="cite" id="cite-11"><a href="#ref-11" title="Transaction Isolation">11</a></sup>。另外两个常用的级别是：

- **可重复读**（Repeatable Read）：整个事务使用同一个快照，事务内多次读同一行，结果不变；
- **可串行化**（Serializable）：用一种叫可串行化快照隔离（SSI）的技术实现，效果等同于所有事务一个接一个地执行。发现冲突时，会让其中一个事务失败，应用需要捕获错误并重试。

SQL 标准里的"读未提交"在 PostgreSQL 里的行为和读已提交一样，它不会读到别人没提交的数据。

一般业务用默认的读已提交就够了。需要严格保证"先读后写"不出错的场景，比如扣库存、转账，可以用 `SELECT ... FOR UPDATE` 显式加行锁，或者直接用 Serializable 加重试。

## 索引：B-tree 之外还有五种

PostgreSQL 内置了六种索引：B-tree、Hash、GiST、SP-GiST、GIN 和 BRIN<sup class="cite" id="cite-12"><a href="#ref-12" title="Index Types">12</a></sup>。先看最常见的 B-tree 有多大作用，同样是那张 200 万行的订单表：

```text
-- 没有索引：并行全表扫描
demo=# EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 4242;
 Gather
   ->  Parallel Seq Scan on orders
         Filter: (user_id = 4242)
         Rows Removed by Filter: 666660
 Execution Time: 92.578 ms

-- CREATE INDEX ON orders (user_id) 之后
 Bitmap Heap Scan on orders
   ->  Bitmap Index Scan on orders_user_id_idx
         Index Cond: (user_id = 4242)
 Execution Time: 0.977 ms
```

从 92 ms 降到 1 ms 左右，差了将近 100 倍。下面是各种索引的适用场景：

| 索引 | 适合 | 典型用法 |
| --- | --- | --- |
| B-tree | 等值、范围、排序 | 默认选择，绝大多数场景 |
| Hash | 只有等值查询 | 很少需要，B-tree 通常就够了 |
| GIN | 一个值里包含多个元素 | `jsonb`、数组、全文检索 |
| GiST | 几何、范围、"最近邻" | PostGIS、范围类型的排除约束 |
| SP-GiST | 非平衡的空间划分 | IP 地址、电话号码前缀 |
| BRIN | 和物理顺序高度相关的大表 | 按时间追加的日志、事件表 |

除了选对类型，还有几个技巧很实用。

**部分索引**：只给满足条件的行建索引。订单表里"待支付"的订单只占 10%，但后台任务需要频繁扫描它们：

```sql
CREATE INDEX orders_pending_idx ON orders (created_at) WHERE status = 'pending';
```

在 `created_at` 上建一个完整的 B-tree 是 43 MB，这个部分索引只有 4.4 MB，查询 `WHERE status = 'pending' AND created_at > now() - interval '1 hour'` 时可以直接用它，耗时约 0.5 ms。

**BRIN 索引**：它不记录每一行，只记录每一段数据块里的最小值和最大值，所以非常小。同样是 `created_at` 列，B-tree 43 MB，BRIN 只有 24 kB。代价是它只在数据的物理顺序和这一列高度相关时才有效，比如按时间追加写入的日志表。

**GIN 索引和 jsonb**：`jsonb` 的包含查询可以用 GIN 索引加速。如果只用 `@>` 运算符，`jsonb_path_ops` 这个操作符类会更小、更快：

```sql
CREATE INDEX orders_meta_gin ON orders USING gin (meta jsonb_path_ops);
```

**表达式索引和覆盖索引**：`CREATE INDEX ON users (lower(email))` 让 `WHERE lower(email) = ...` 也能走索引；`CREATE INDEX ... INCLUDE (col)` 把额外的列放进索引，查询只需要这些列时可以只扫描索引，不用回表。

**多列索引注意顺序**：`(tenant_id, created_at)` 这样的索引，可以服务 `WHERE tenant_id = ?` 和 `WHERE tenant_id = ? ORDER BY created_at`，但通常帮不了只按 `created_at` 查询的语句（18 的 skip scan 在部分情况下能改善这一点）。一般把等值条件的列放前面，范围或排序的列放后面。

还有一点：**外键不会自动建索引**。PostgreSQL 会自动给主键和唯一约束建索引，但外键那一列不会。删除父表的行时，数据库要去子表里检查有没有引用，没有索引就是一次全表扫描。

看查询有没有用上索引，用 `EXPLAIN ANALYZE`。线上要找"最慢的查询"，可以打开 `pg_stat_statements` 扩展<sup class="cite" id="cite-13"><a href="#ref-13" title="pg_stat_statements">13</a></sup>，它会按语句模板统计调用次数和总耗时，是做性能优化最好的起点。

## 几个值得常用的 SQL 功能

PostgreSQL 的 SQL 能力很强，下面几个在日常开发里用得最多。

**UPSERT**：用 `INSERT ... ON CONFLICT` 实现"不存在就插入，存在就更新"<sup class="cite" id="cite-14"><a href="#ref-14" title="INSERT">14</a></sup>，而且是原子的，不需要先查再写：

```text
demo=# INSERT INTO page_views VALUES ('/posts/postgres', 1)
       ON CONFLICT (page) DO UPDATE SET views = page_views.views + 1
       RETURNING *;
      page       | views
-----------------+-------
 /posts/postgres |     2
```

**RETURNING**：`INSERT`、`UPDATE`、`DELETE` 都可以带上 `RETURNING`，直接拿回写入后的行，比如数据库生成的 ID 和默认值，省掉一次查询。

**CTE 和窗口函数**：`WITH` 子句让复杂查询可以分步写，读起来更清楚；窗口函数（`rank() OVER (...)`、`sum() OVER (...)`）可以在不分组的情况下做排名、累计和、同比环比。很多原本要在应用里循环处理的报表逻辑，一条 SQL 就能写完。

**`SELECT ... FOR UPDATE SKIP LOCKED`**：每个工作进程取一批任务、跳过别人已经锁住的行，这是用 PostgreSQL 直接实现任务队列的经典写法。对任务量不大的系统，这比再引入一个消息队列简单得多。

## 扩展生态：PostgreSQL 的真正优势

PostgreSQL 最独特的地方是它的扩展机制。执行一条 `CREATE EXTENSION`，就能给数据库加上新的数据类型、函数、索引方法甚至后台进程。一些常见的扩展：

- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="m19 9-5 5-4-4-3 3" /> </svg></span>**pg_stat_statements**：统计每类 SQL 的调用次数和耗时，前面已经提过，几乎每个生产库都应该打开；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" /> </svg></span>**PostGIS**：地理信息系统，支持几何类型、空间索引和几百个空间函数，是开源 GIS 的事实标准；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /> <path d="M20 3v4" /> <path d="M22 5h-4" /> <path d="M4 17v2" /> <path d="M5 18H3" /> </svg></span>**pgvector**：向量相似度检索，下面单独说；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M5 22h14" /> <path d="M5 2h14" /> <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /> <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" /> </svg></span>**TimescaleDB**：时序数据，自动按时间分区、压缩历史数据；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect x="16" y="16" width="6" height="6" rx="1" /> <rect x="2" y="16" width="6" height="6" rx="1" /> <rect x="9" y="2" width="6" height="6" rx="1" /> <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /> <path d="M12 12V8" /> </svg></span>**Citus**：把表分片到多台机器上，做水平扩展。

### pgvector：在 PostgreSQL 里做向量检索

做 RAG 或语义搜索时，需要存储文本的向量（embedding）并找出最相似的几条。很多人的第一反应是引入一个专门的向量数据库，但如果数据量在千万级以内，pgvector 往往就够了。

pgvector 提供了 `vector` 类型和几种距离运算符：`<->` 是 L2 距离，`<=>` 是余弦距离，`<#>` 是负内积。索引支持 HNSW 和 IVFFlat 两种，`vector` 类型最多可以给 2000 维的向量建索引<sup class="cite" id="cite-15"><a href="#ref-15" title="pgvector">15</a></sup>：

```sql
CREATE EXTENSION vector;

CREATE TABLE chunks (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id    bigint NOT NULL,
  content   text   NOT NULL,
  embedding vector(1024)
);
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- 找出和问题最相似的 5 段文本
SELECT id, content
FROM chunks
WHERE doc_id = ANY($2)
ORDER BY embedding <=> $1
LIMIT 5;
```

把向量和业务数据放在同一个库里，最大的好处是**可以和普通条件、权限一起查**：上面的 `doc_id = ANY($2)` 只是一个普通的 WHERE 条件，再加上 RLS 就能保证每个租户只检索到自己的文档。如果用独立的向量数据库，这些过滤和权限都要在两边各做一遍，还要处理两边数据同步的问题。

## 安全：角色、权限和行级安全

PostgreSQL 的权限模型基于**角色**。用户和组都是角色，权限通过 `GRANT` 授给角色。实践中，至少应该区分两类角色：一个拥有表、负责跑迁移的角色，和一个应用日常连接用的角色，后者只授予它需要的 `SELECT`、`INSERT`、`UPDATE`、`DELETE` 权限。应用绝不应该用超级用户连接数据库。

在此之上，PostgreSQL 还支持**行级安全**（RLS）：在表上定义策略，数据库会在每条查询里自动加上过滤条件，比如"只能看到本租户的行"。对多租户系统来说，这能保证即使某处代码忘了写 `WHERE tenant_id = ?`，也不会把别人的数据查出来。RLS 的细节和坑比较多，比如表的所有者默认会绕过策略、视图默认用所有者的权限执行、连接池下会话变量会"串号"等等，我单独写了一篇：[PostgreSQL 行级安全（RLS）：把租户隔离交给数据库](/posts/postgres-rls/)。

## 高可用与扩展

### 备份

备份有两种基本方式：

- **逻辑备份**：用 `pg_dump` 导出成 SQL 或自定义格式，适合小库、跨版本迁移和单表恢复；
- **物理备份加 WAL 归档**：用 `pg_basebackup` 做一份数据目录的全量拷贝，再持续归档 WAL。恢复时先还原全量备份，再回放 WAL 到任意一个时间点，这就是**时间点恢复**（PITR）<sup class="cite" id="cite-16"><a href="#ref-16" title="Continuous Archiving and Point-in-Time Recovery">16</a></sup>。比如有人误删了一张表，可以恢复到删除前一秒的状态。

生产环境一般都用第二种，开源工具 pgBackRest、Barman 把这套流程包装得很完善。云上的托管数据库通常也默认提供 PITR。

### 复制

PostgreSQL 内置两种复制方式：

- **流复制**（物理复制）：主库把 WAL 实时发送给备库，备库逐字节回放，得到一个完全一样的副本<sup class="cite" id="cite-17"><a href="#ref-17" title="Log-Shipping Standby Servers">17</a></sup>。备库可以承担只读查询（热备），主库故障时提升为新主库。可以配置成同步复制，保证提交的事务至少在一个备库上落盘；
- **逻辑复制**：按"发布 / 订阅"的方式，复制指定表的行级变更<sup class="cite" id="cite-18"><a href="#ref-18" title="Logical Replication">18</a></sup>。它可以跨大版本，常用于不停机升级、把部分表同步到另一个库，或者接入变更数据捕获（CDC）。

PostgreSQL 本身不带自动故障切换。自建时一般用 Patroni 这类工具来管理主备切换；用云上的托管服务，这部分由云厂商负责。

### 扩展

单机 PostgreSQL 能撑的量比很多人想的大，先把索引、查询和连接数管好，通常能走很远。读多写少时，加只读备库分担读流量。单表很大时（比如几亿行的日志表），可以用**声明式分区**<sup class="cite" id="cite-19"><a href="#ref-19" title="Table Partitioning">19</a></sup>按时间切分，删除旧数据时直接 `DROP` 掉一个分区，比 `DELETE` 快得多，也不会产生大量死元组。真到了单机写不动的程度，再考虑 Citus 这样的分片方案。

## 生产环境里最常见的坑

### 连接数打满

这是最常见的问题。算一笔账：应用起 4 个 worker 进程，每个进程的连接池上限是 15，部署 3 个实例，就是 180 个连接，已经超过了默认的 `max_connections = 100`。扩容时多加几台机器，数据库就开始报 `too many connections`。

解决办法是在数据库前面加 PgBouncer。用它的事务池模式，几千个客户端连接可以共享几十个真正的数据库连接。但事务池模式下，会话级的功能不能用，比如会话级的 `SET`<sup class="cite" id="cite-20"><a href="#ref-20" title="PgBouncer features">20</a></sup>，需要的话要改用事务级的 `SET LOCAL`。

### 长事务和 idle in transaction

一个事务开了很久不提交，比如代码里开了事务之后去调一个很慢的外部接口，或者有人在客户端里执行了 `BEGIN` 然后去吃饭了。它的危害有两个：一是它持有的锁一直不释放；二是前面讲的，**只要它的快照还在，VACUUM 就不能清理它之后产生的死元组**，表会一直膨胀。

可以用下面的查询找出它们，并设置 `idle_in_transaction_session_timeout` 自动断开空闲太久的事务：

```sql
SELECT pid, state, now() - xact_start AS duration, left(query, 60)
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 10;
```

### DDL 的锁队列

这个坑隐蔽而且危险。很多形式的 `ALTER TABLE` 需要 ACCESS EXCLUSIVE 锁，这是唯一会阻塞普通 `SELECT` 的锁<sup class="cite" id="cite-21"><a href="#ref-21" title="Explicit Locking">21</a></sup>。加列本身可能只要几毫秒，问题出在**等锁**的时候。我在本地复现了一下：

```text
 pid | wait_event_type | state  | query
-----+-----------------+--------+-----------------------------------------
 396 | Timeout         | active | BEGIN; SELECT count(*) FROM accounts; ...
 404 | Lock            | active | ALTER TABLE accounts ADD COLUMN note text;
 409 | Lock            | active | SELECT * FROM accounts;
```

第一个会话开了一个事务，读了 `accounts` 表，还没有提交。第二个会话的 `ALTER TABLE` 要等它结束才能拿到锁。关键在第三个会话：一个普通的 `SELECT` 也被卡住了，因为它排在了 `ALTER TABLE` 后面。也就是说，**一个慢事务加上一个 DDL，就能让整张表的所有读写排起长队**，看起来就像数据库挂了一样。

解决办法是给 DDL 设一个锁等待超时，拿不到锁就快速失败，过一会儿再重试，而不是一直排队堵住后面的请求<sup class="cite" id="cite-22"><a href="#ref-22" title="Client Connection Defaults">22</a></sup>：

```text
demo=# SET lock_timeout = '2s';
demo=# ALTER TABLE accounts ADD COLUMN note2 text;
ERROR:  canceling statement due to lock timeout
```

同样，给大表建索引要用 `CREATE INDEX CONCURRENTLY`。普通的 `CREATE INDEX` 在建索引期间会阻塞所有写入，加上 `CONCURRENTLY` 就不会阻塞插入、更新和删除<sup class="cite" id="cite-23"><a href="#ref-23" title="CREATE INDEX">23</a></sup>，代价是建得更慢一些，而且不能放在事务块里执行。

### 其他几个

- **深分页用 OFFSET**：`OFFSET 100000 LIMIT 20` 要先扫过前 10 万行再丢掉。翻页深的场景改用游标分页（keyset pagination）：`WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 20`；
- **`count(*)` 很慢**：MVCC 下，数据库不能直接知道总行数，要逐行检查可见性。只需要大概的数量时，可以读 `pg_class.reltuples` 里的估算值；
- **大批量 UPDATE / DELETE**：一次改几千万行会产生同样多的死元组和大量 WAL，还会长时间持有行锁。最好分批执行，每批几千到几万行；
- **只看平均耗时**：慢查询经常藏在长尾里。用 `pg_stat_statements` 按总耗时排序，比盯着平均值有用得多。

## 在 FastAPI 里使用 PostgreSQL

接着 FastAPI 那篇，看看怎么在 FastAPI 里接 PostgreSQL。这里用 SQLAlchemy 2.0 的异步接口，驱动用 asyncpg：

```python
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import BigInteger, Text, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

engine = create_async_engine(
    "postgresql+asyncpg://app_user:***@db:5432/app",
    pool_size=10,        # 每个 worker 常驻的连接数
    max_overflow=5,      # 高峰时最多再多开 5 个
    pool_pre_ping=True,  # 取连接前先检查是否还活着
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class PageView(Base):
    __tablename__ = "page_views"
    page: Mapped[str] = mapped_column(Text, primary_key=True)
    views: Mapped[int] = mapped_column(BigInteger)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()  # 关闭时释放连接池


app = FastAPI(lifespan=lifespan)


async def get_session():
    async with SessionLocal() as session:
        yield session


@app.post("/views/{page:path}")
async def hit(page: str, session: AsyncSession = Depends(get_session)):
    stmt = (
        insert(PageView)
        .values(page=page, views=1)
        .on_conflict_do_update(
            index_elements=[PageView.page],
            set_={"views": PageView.views + 1},
        )
        .returning(PageView.views)
    )
    views = (await session.execute(stmt)).scalar_one()
    await session.commit()
    return {"page": page, "views": views}
```

几点说明：

- **连接池按 worker 计算**。上面的配置下，每个 worker 最多 15 个连接，乘以 worker 数和实例数，要小于数据库的 `max_connections`，前面"连接数打满"那一节算过这笔账；
- **一个请求一个会话**，用依赖注入管理会话的生命周期，请求结束时自动归还连接。不要在请求之间共享同一个会话；
- **计数用 UPSERT**，一条语句原子完成，不会出现两个请求同时读到 1、都写回 2 的问题；
- 如果用了 PgBouncer 的事务池模式，asyncpg 的预编译语句缓存可能会出问题，需要按驱动和 PgBouncer 版本的文档调整相关配置；
- 表结构的变更用 Alembic 管理迁移，并且用拥有表的那个角色来跑，应用本身用权限更小的角色连接。

至于缓存，热点数据可以放进 Redis，具体的写法见 [Redis 那篇](/posts/redis/)。

## 什么时候不选 PostgreSQL

PostgreSQL 适合绝大多数业务系统，但也有它不擅长的地方：

- **大规模分析查询**：几十亿行的聚合分析，ClickHouse、DuckDB 这类列式数据库会快一到两个数量级；
- **超高并发的简单读写**：每秒几十万次的键值读写，或者需要亚毫秒延迟的场景，前面应该挡一层 Redis；
- **需要多地多活写入**：PostgreSQL 的标准架构是单主写入。真需要跨地域多点写入，要考虑 CockroachDB、YugabyteDB 这类分布式数据库，或者在应用层做拆分；
- **嵌入式和移动端**：这类场景用 SQLite 更合适。

## 小结

1. **PostgreSQL 是一个功能全面、许可证宽松、由社区维护的关系数据库**，也是目前开发者用得最多的数据库，新项目直接用 18；
2. **一个连接一个进程**，连接很贵，生产环境要用连接池，必要时加 PgBouncer；
3. **善用数据类型**：`jsonb`、数组、`timestamptz`、范围类型、`numeric`，主键用 identity 或 UUIDv7；
4. **MVCC 让读写互不阻塞**，代价是旧版本需要 VACUUM 清理，别关 autovacuum，别留长事务；
5. **索引先选对类型**：默认 B-tree，`jsonb` 和数组用 GIN，按时间追加的大表考虑 BRIN，再配合部分索引、表达式索引、覆盖索引，别忘了给外键建索引；
6. **扩展生态是最大的优势**，pgvector 让很多 RAG 场景不需要单独的向量数据库；
7. **备份用物理备份加 WAL 归档**，高可用用流复制，大表用分区；
8. **生产环境最要提防的是连接数、长事务和 DDL 锁队列**，DDL 前设 `lock_timeout`，建索引用 `CONCURRENTLY`。

"先用 PostgreSQL，等真遇到瓶颈再说"，这句话这几年越来越成为共识。原因不只是它够快，更在于它够全：关系数据、JSON、全文检索、地理信息、向量检索都能放在一个库里，用同一套事务和权限来管理。对大多数团队来说，少维护一个系统，往往比某个指标快一点更有价值。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Stack Overflow. <a href="https://survey.stackoverflow.co/2025/technology">2025 Developer Survey: Technology</a>. 2025. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/history.html">A Brief History of PostgreSQL</a>. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>PostgreSQL Global Development Group. <a href="https://www.postgresql.org/about/licence/">PostgreSQL License</a>. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>PostgreSQL Global Development Group. <a href="https://www.postgresql.org/support/versioning/">Versioning Policy</a>. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>PostgreSQL Global Development Group. <a href="https://www.postgresql.org/about/news/postgresql-18-released-3142/">PostgreSQL 18 Released!</a>. 2025-09-25. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/connect-estab.html">How Connections Are Established</a>. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/runtime-config-connection.html">Connections and Authentication</a>（max_connections）. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/datatype.html">Data Types</a>. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/mvcc-intro.html">Concurrency Control: Introduction</a>. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/routine-vacuuming.html">Routine Vacuuming</a>. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/transaction-iso.html">Transaction Isolation</a>. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/indexes-types.html">Index Types</a>. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/pgstatstatements.html">pg_stat_statements</a>. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/sql-insert.html">INSERT</a>（ON CONFLICT）. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>pgvector. <a href="https://github.com/pgvector/pgvector">Open-source vector similarity search for Postgres</a>. GitHub. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/continuous-archiving.html">Continuous Archiving and Point-in-Time Recovery (PITR)</a>. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/warm-standby.html">Log-Shipping Standby Servers</a>（Streaming Replication）. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
<li id="ref-18"><span class="ref-n">[18]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/logical-replication.html">Logical Replication</a>. <a class="ref-back" href="#cite-18" aria-label="回到正文">↩</a></span></li>
<li id="ref-19"><span class="ref-n">[19]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/ddl-partitioning.html">Table Partitioning</a>. <a class="ref-back" href="#cite-19" aria-label="回到正文">↩</a></span></li>
<li id="ref-20"><span class="ref-n">[20]</span><span>PgBouncer. <a href="https://www.pgbouncer.org/features.html">Features</a>（SQL feature map for pooling modes）. <a class="ref-back" href="#cite-20" aria-label="回到正文">↩</a></span></li>
<li id="ref-21"><span class="ref-n">[21]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/explicit-locking.html">Explicit Locking</a>. <a class="ref-back" href="#cite-21" aria-label="回到正文">↩</a></span></li>
<li id="ref-22"><span class="ref-n">[22]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/runtime-config-client.html">Client Connection Defaults</a>（lock_timeout）. <a class="ref-back" href="#cite-22" aria-label="回到正文">↩</a></span></li>
<li id="ref-23"><span class="ref-n">[23]</span><span>PostgreSQL Documentation. <a href="https://www.postgresql.org/docs/current/sql-createindex.html">CREATE INDEX</a>（CONCURRENTLY）. <a class="ref-back" href="#cite-23" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
