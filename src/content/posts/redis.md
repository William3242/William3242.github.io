---
title: Redis 入门到实战：数据结构、缓存模式、持久化与集群
description: 从"内存里的数据结构服务器"这个定位讲起，梳理 Redis 的核心数据类型、缓存与分布式锁等常见用法、RDB/AOF 持久化、主从/哨兵/集群三种部署方式，以及大 key、热 key 这些生产里最常踩的坑，最后给一个在 FastAPI 里用 Redis 的完整例子。
pubDate: 2026-11-15
tags: [Redis, 后端, 数据库]
---

几乎每个后端项目迟早都会引入 Redis。最开始往往只是"给慢查询加个缓存"，后来会话放进去了，限流放进去了，排行榜、任务队列、分布式锁也放进去了，最后它成了整个系统里调用最频繁的组件之一。

Redis 用起来门槛很低，`SET` 和 `GET` 两个命令就能上手，但真正用好它，需要搞清楚几件事：它为什么快，它的每种数据结构适合干什么，数据放在内存里怎么保证不丢，单机扛不住了怎么扩展，以及哪些用法会在生产环境里出事故。这篇按这个顺序讲一遍。

文中的命令和行为以 Redis 官方文档为准，引用都放在文末。

## Redis 是什么

Redis 的官方定位是一个**内存中的数据结构服务器**。和 MySQL、PostgreSQL 这类把数据存在磁盘、用 SQL 查询的关系数据库不同，Redis 的数据主要放在内存里，对外提供的也不是"表"，而是字符串、哈希、列表、集合、有序集合这样一组数据结构，每种结构配一套专门的命令<sup class="cite" id="cite-1"><a href="#ref-1" title="Redis data types">1</a></sup>。

这个定位决定了它的两个特点：

1. **快**。读写都在内存里完成，大多数命令的时间复杂度是 O(1) 或 O(log N)，单个实例每秒处理几万到十几万次请求是常态，延迟通常在亚毫秒级。
2. **贵且有限**。内存比磁盘贵得多，容量也小得多，所以 Redis 适合放"热"数据和"小"数据，不适合当成存放全部业务数据的主库。

### 为什么单线程还这么快

一个经常被问到的问题：Redis 执行命令是单线程的，为什么还能这么快？

官方文档的说法是，Redis 在执行命令这件事上基本是单线程的，靠一个事件循环处理所有客户端的请求<sup class="cite" id="cite-2"><a href="#ref-2" title="Diagnosing latency issues">2</a></sup>。单线程反而带来了几个好处：

- **没有锁的开销**。所有命令串行执行，不需要为共享数据加锁，也不会有线程切换的成本。
- **每条命令天然是原子的**。`INCR` 不会被另一个客户端的 `INCR` 打断，这是后面很多用法（计数器、锁、限流）能成立的前提。
- **瓶颈通常不在 CPU**。对内存操作来说，真正的瓶颈往往是网络读写和系统调用，而不是命令本身的计算。

所以 Redis 后来的多线程改造，主要是把"读写网络数据"这部分交给了 I/O 线程（Redis 6.0 引入的 `io-threads` 配置），命令执行本身仍然在主线程。另外像删除大 key、AOF 刷盘这类可能很慢的操作，也被挪到了后台线程。

单线程也意味着一个代价：**一条慢命令会卡住所有人**。比如对一个有几百万元素的集合执行 `SMEMBERS`，或者在生产环境里执行 `KEYS *`，这段时间里其他所有客户端都在排队。这一点后面讲"坑"的时候还会再提。

### 许可证的变化：Redis 与 Valkey

选型时还有一个绕不开的背景。Redis 长期以 BSD 协议开源，但在 2024 年 3 月，Redis 公司宣布从 7.4 版本起改为 RSALv2 和 SSPLv1 双许可证，这两种都不是 OSI 认可的开源协议<sup class="cite" id="cite-3"><a href="#ref-3" title="Redis Adopts Dual Source-Available Licensing">3</a></sup>。随后不久，Linux 基金会基于 Redis 7.2.4 分叉出了 Valkey，AWS、Google Cloud、Oracle 等公司都加入了这个项目<sup class="cite" id="cite-4"><a href="#ref-4" title="Linux Foundation Launches Open Source Valkey Community">4</a></sup>。

到了 2025 年 5 月，Redis 8 又增加了 AGPLv3 作为第三个许可证选项，重新回到了 OSI 认可的开源协议<sup class="cite" id="cite-5"><a href="#ref-5" title="Redis is now available under the AGPLv3 open source license">5</a></sup>。

对一般使用者来说，这件事的影响主要在选型上：自己部署时，Redis 8 和 Valkey 都可以用，两者在常用命令和协议上是兼容的；用云厂商的托管服务时，不少厂商已经提供了 Valkey 版本。下文讲的内容对两者基本都适用。

## 核心数据结构

Redis 的强大很大程度上来自它的数据结构。用对了结构，很多需求一两条命令就能实现；用错了，要么写一堆客户端逻辑，要么性能出问题。

下面是最常用的几种<sup class="cite"><a href="#ref-1" title="Redis data types">1</a></sup>：

- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <polyline points="4 7 4 4 20 4 20 7" /> <line x1="9" x2="15" y1="20" y2="20" /> <line x1="12" x2="12" y1="4" y2="20" /> </svg></span>**String（字符串）**：最基础的类型，值可以是文本、数字或二进制数据，最大 512 MB。除了 `SET`/`GET`，还支持 `INCR`/`DECR` 原子计数，以及 `SET key value EX 60 NX` 这种"不存在才写入，并设置过期时间"的组合，后者是分布式锁的基础。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" /> <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" /> </svg></span>**Hash（哈希）**：一个 key 下面存多个字段和值，像一个小字典。适合存对象，比如 `HSET user:42 name 小明 age 18`，可以只读或只改其中一个字段，不必把整个对象序列化再写回去。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M3 12h.01" /> <path d="M3 18h.01" /> <path d="M3 6h.01" /> <path d="M8 12h13" /> <path d="M8 18h13" /> <path d="M8 6h13" /> </svg></span>**List（列表）**：按插入顺序排列的字符串列表，两端插入和弹出都是 O(1)。可以当栈或队列用，`BRPOP` 这类阻塞命令能让消费者在队列为空时等待新元素。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M3 7V5c0-1.1.9-2 2-2h2" /> <path d="M17 3h2c1.1 0 2 .9 2 2v2" /> <path d="M21 17v2c0 1.1-.9 2-2 2h-2" /> <path d="M7 21H5c-1.1 0-2-.9-2-2v-2" /> <rect width="7" height="5" x="7" y="7" rx="1" /> <rect width="7" height="5" x="10" y="12" rx="1" /> </svg></span>**Set（集合）**：无序、不重复的字符串集合，支持交集、并集、差集。适合做标签、去重、"共同好友"这类需求。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M10 12h11" /> <path d="M10 18h11" /> <path d="M10 6h11" /> <path d="M4 10h2" /> <path d="M4 6h1v4" /> <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /> </svg></span>**Sorted Set（有序集合）**：每个元素带一个分数（score），按分数排序。按分数范围或排名取数据都是 O(log N)。排行榜、延迟队列、滑动窗口限流都靠它<sup class="cite" id="cite-6"><a href="#ref-6" title="Redis sorted sets">6</a></sup>。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> </svg></span>**Stream（流）**：一个只追加的日志结构，每条消息有自增 ID。支持消费者组、消息确认（`XACK`）和未确认消息列表（PEL），可以实现比 List 更可靠的消息队列<sup class="cite" id="cite-7"><a href="#ref-7" title="Redis Streams">7</a></sup>。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M3 9h18" /> <path d="M3 15h18" /> <path d="M9 3v18" /> <path d="M15 3v18" /> </svg></span>**Bitmap / Bitfield**：把字符串当成位数组来操作。一亿个用户的签到状态只需要大约 12 MB。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2" /> </svg></span>**HyperLogLog**：用固定的 12 KB 左右内存估算一个集合的基数（不重复元素个数），标准误差约 0.81%。适合统计 UV 这类"要个大概数就行"的场景。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" /> </svg></span>**Geo（地理位置）**：存经纬度，支持按半径或矩形范围查找附近的点。底层其实是一个有序集合。

Redis 8 还把原来需要单独安装模块（Redis Stack）的几种能力直接合进了核心发行版，包括 JSON 文档、查询引擎（全文检索和向量检索）、时间序列，以及布隆过滤器等概率型数据结构<sup class="cite"><a href="#ref-5" title="Redis is now available under the AGPLv3 open source license">5</a></sup>。同时还新增了一个由 Redis 作者 antirez 设计的 **Vector Set** 类型<sup class="cite"><a href="#ref-5" title="Redis is now available under the AGPLv3 open source license">5</a></sup>，专门用来存向量和做相似度搜索<sup class="cite" id="cite-8"><a href="#ref-8" title="Redis vector sets">8</a></sup>。

### key 的命名

Redis 没有"表"和"库"的概念（`SELECT` 切换的编号数据库在集群模式下也不能用），所有 key 都在一个平坦的命名空间里。所以约定一套命名规则很重要，常见写法是用冒号分层：

```
业务:对象类型:ID[:字段]
user:42:profile
order:20261115:0001
ratelimit:api:user:42
```

这样做的好处是一眼能看出 key 属于谁，用 `SCAN` 按前缀排查问题也方便。另外 key 本身也占内存，几亿个 key 的场景下，名字长短的差别是能看出来的。

## 常见用法

### 缓存：Cache-Aside 模式

缓存是 Redis 最常见的用途。业界最常用的是 **Cache-Aside（旁路缓存）** 模式：应用自己负责读写缓存，数据库是唯一的数据源。

<figure class="diagram">
<svg viewBox="0 0 640 320" role="img" aria-label="Cache-Aside 模式的读写时序：读时先查缓存，未命中回源数据库并写回缓存；写时先更新数据库再删除缓存">
<rect class="c-gray" x="50" y="12" width="120" height="34" rx="5"/><text class="t" x="110" y="34" text-anchor="middle">应用</text>
<rect class="c-red" x="270" y="12" width="120" height="34" rx="5"/><text class="t" x="330" y="34" text-anchor="middle">Redis</text>
<rect class="c-blue" x="490" y="12" width="120" height="34" rx="5"/><text class="t" x="550" y="34" text-anchor="middle">PostgreSQL</text>
<path class="ln dash" d="M110 46 V310 M330 46 V310 M550 46 V310"/>
<text class="ts" x="20" y="70">读</text>
<path class="ln" d="M110 82 H322"/><polygon class="ah" points="330,82 321,77.5 321,86.5"/><text class="ts" x="220" y="75" text-anchor="middle">① GET user:42</text>
<path class="ln dash" d="M330 112 H118"/><polygon class="ah" points="110,112 119,107.5 119,116.5"/><text class="ts" x="220" y="105" text-anchor="middle">② nil（未命中）</text>
<path class="ln" d="M110 142 H542"/><polygon class="ah" points="550,142 541,137.5 541,146.5"/><text class="ts" x="440" y="135" text-anchor="middle">③ SELECT … WHERE id = 42</text>
<path class="ln dash" d="M550 172 H118"/><polygon class="ah" points="110,172 119,167.5 119,176.5"/><text class="ts" x="440" y="165" text-anchor="middle">④ 返回行数据</text>
<path class="ln" d="M110 202 H322"/><polygon class="ah" points="330,202 321,197.5 321,206.5"/><text class="ts" x="220" y="195" text-anchor="middle">⑤ SET user:42 … EX 300</text>
<path class="frame" d="M20 226 H620"/>
<text class="ts" x="20" y="250">写</text>
<path class="ln" d="M110 262 H542"/><polygon class="ah" points="550,262 541,257.5 541,266.5"/><text class="ts" x="440" y="255" text-anchor="middle">⑥ UPDATE users …</text>
<path class="ln" d="M110 292 H322"/><polygon class="ah" points="330,292 321,287.5 321,296.5"/><text class="ts" x="220" y="285" text-anchor="middle">⑦ DEL user:42</text>
</svg>
<figcaption>图 1：Cache-Aside 的读写时序。读时先查缓存，未命中再查库并写回；写时先改库，再删缓存。</figcaption>
</figure>

读路径很直观。写路径有两个值得说明的选择：

**为什么是"删除缓存"而不是"更新缓存"？** 如果两个请求并发更新同一条数据，各自先写库再写缓存，写缓存的顺序可能和写库的顺序相反，缓存里就留下了旧值。删除则没有这个问题，下一次读会从数据库加载最新值。另外很多缓存值是由多张表计算出来的，更新它的成本可能比删除后按需重建高得多。

**为什么是"先改库再删缓存"？** 如果反过来先删缓存，在改库完成之前，另一个读请求可能把旧值又读进了缓存。先改库再删缓存也不是完全没有不一致的窗口，但窗口要小得多。Facebook 在 2013 年的 Memcache 论文里讨论过这类问题，他们用一种叫 lease（租约）的机制来防止过期数据被写回缓存，同时缓解热点 key 失效时的"惊群"<sup class="cite" id="cite-9"><a href="#ref-9" title="Scaling Memcache at Facebook">9</a></sup>。

还有一点：**一定要给缓存设置过期时间**。TTL 是最后一道保险，就算删除缓存这一步因为网络问题失败了，脏数据也只会存在一段有限的时间。

### 缓存的三个经典问题

做缓存绕不开这三个问题，国内的技术文章习惯叫它们穿透、击穿和雪崩：

| 问题 | 现象 | 常见对策 |
|---|---|---|
| 缓存穿透 | 查询的数据根本不存在，每次都打到数据库，常见于恶意请求 | 把"不存在"也缓存起来（短 TTL 的空值）；或者用布隆过滤器先挡一层 |
| 缓存击穿 | 一个热点 key 过期的瞬间，大量请求同时回源 | 回源时加互斥锁，只让一个请求去查库；或者热点数据不设物理过期，由后台异步刷新 |
| 缓存雪崩 | 大量 key 在同一时间过期，或者 Redis 整体宕机 | TTL 加随机抖动，避免同时过期；Redis 做高可用；数据库前加限流和降级 |

其中"TTL 加随机抖动"成本最低，建议默认就这么做，比如基础 TTL 300 秒，再加上 0 到 60 秒的随机值。

### 分布式锁

多个服务实例要互斥地做某件事（比如同一个订单只能被处理一次），最简单的方案是用 Redis 做锁。官方文档给出的单实例写法是<sup class="cite" id="cite-10"><a href="#ref-10" title="Distributed Locks with Redis">10</a></sup>：

```
SET resource_name my_random_value NX PX 30000
```

这条命令有三个要点：

- `NX`：只有 key 不存在时才设置成功，保证同一时间只有一个客户端拿到锁；
- `PX 30000`：30 秒后自动过期，防止持锁的进程崩溃后锁永远不释放；
- `my_random_value`：每个客户端用一个随机值，释放锁时要校验这个值，避免误删别人的锁。

释放锁时必须"先比较再删除"，而且这两步要是原子的，所以要用 Lua 脚本：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

（Redis 8.4 起也可以直接用 `DELEX key IFEQ my_random_value` 一条命令完成比较和删除<sup class="cite"><a href="#ref-10" title="Distributed Locks with Redis">10</a></sup>。）

如果不校验就直接 `DEL`，可能出现这样的情况：客户端 A 的锁因为执行太久过期了，客户端 B 拿到了锁，这时 A 执行完毕顺手一个 `DEL`，把 B 的锁删掉了。

**关于 Redlock 的争议。** 单实例锁在 Redis 主节点宕机、副本还没同步到这个 key 时会失效。为此 Redis 作者提出了 Redlock 算法，在多个独立的 Redis 实例上同时加锁，多数成功才算拿到锁。Martin Kleppmann（《数据密集型应用系统设计》的作者）写过一篇很有名的文章批评它<sup class="cite" id="cite-11"><a href="#ref-11" title="How to do distributed locking">11</a></sup>，核心论点是：锁依赖过期时间，而进程可能因为 GC 停顿、页面换出等原因"卡住"一段时间，醒来时锁已经过期，它却以为自己还持有锁。他建议用 **fencing token**（每次加锁返回一个单调递增的编号，存储系统拒绝编号更小的写入）来兜底。antirez 随后写了一篇回应<sup class="cite" id="cite-12"><a href="#ref-12" title="Is Redlock safe?">12</a></sup>。

我的理解是：如果锁只是为了**效率**（避免重复计算，偶尔重复一次也没关系），单实例 Redis 锁足够了；如果锁是为了**正确性**（重复执行会造成资金错误这类后果），不要只依赖 Redis 锁，要在数据库层面加唯一约束、乐观锁或者 fencing token 做最终保障。

### 限流

限流是 Redis 原子计数能力的典型应用。最简单的是**固定窗口**：

```
INCR ratelimit:user:42:202611151030
EXPIRE ratelimit:user:42:202611151030 60
```

每分钟一个 key，计数超过阈值就拒绝。缺点是窗口边界上可能放过两倍的流量（前一分钟最后一秒和后一分钟第一秒各放满）。

更平滑的是用有序集合做**滑动窗口**：每个请求以时间戳为分数写入，然后删掉窗口之外的旧记录，再数一下窗口内还有多少条。这几步必须原子执行，否则并发时计数会不准，所以同样要用 Lua 脚本包起来。后面 FastAPI 的例子里会给出完整代码。

### 消息队列：List 还是 Stream

用 Redis 做轻量级队列有两种选择：

- **List**：`LPUSH` 生产，`BRPOP` 消费，简单直接。问题是消息一旦被弹出就从列表里消失了，如果消费者处理到一半崩溃，这条消息就丢了。可以用 `LMOVE` 把消息原子地挪到一个"处理中"列表来缓解，但重试、超时这些逻辑都要自己写。
- **Stream**：Redis 5.0 引入，专门为消息队列设计。支持消费者组（同一组内的消费者分摊消息）、消息确认（`XACK`），没有确认的消息会留在 PEL 里，可以用 `XAUTOCLAIM` 把超时未确认的消息转交给其他消费者<sup class="cite"><a href="#ref-7" title="Redis Streams">7</a></sup>。

新项目建议直接用 Stream。不过要清楚 Redis 毕竟不是专业的消息中间件，如果对消息可靠性、堆积能力有很高的要求，Kafka、RabbitMQ 这类系统更合适。

### 其他常见用法

- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /> <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /> <path d="M4 22h16" /> <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /> <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /> <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /> </svg></span>**排行榜**：有序集合，`ZINCRBY` 加分，`ZREVRANGE` 取前 N 名，`ZREVRANK` 查某人的排名。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" /> </svg></span>**会话存储**：用 Hash 存会话数据，设置 TTL 实现自动过期，多个应用实例共享同一份会话。
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <line x1="10" x2="14" y1="2" y2="2" /> <line x1="12" x2="15" y1="14" y2="11" /> <circle cx="12" cy="14" r="8" /> </svg></span>**延迟队列**：有序集合，分数设为任务的执行时间，消费者定期用 `ZRANGEBYSCORE` 取出到期的任务。

## 原子性：Pipeline、事务和 Lua

单条命令是原子的，但业务逻辑往往需要多条命令。Redis 提供了三种把多条命令组合起来的方式，它们解决的问题不一样，很容易混淆：

| 方式 | 解决什么 | 原子性 |
|---|---|---|
| Pipeline | 减少网络往返：一次发送多条命令，一次读回所有结果<sup class="cite" id="cite-13"><a href="#ref-13" title="Redis pipelining">13</a></sup> | 不保证，其他客户端的命令可能插在中间 |
| `MULTI` / `EXEC` 事务 | 把多条命令打包，一起排队执行 | 执行期间不会被打断，但**不支持回滚**，某条命令出错后其余命令照常执行<sup class="cite" id="cite-14"><a href="#ref-14" title="Transactions">14</a></sup> |
| Lua 脚本 | 需要"读一个值，根据结果决定写什么"的逻辑 | 整个脚本原子执行<sup class="cite" id="cite-15"><a href="#ref-15" title="Scripting with Lua">15</a></sup> |

`MULTI`/`EXEC` 的局限是命令在 `EXEC` 之前只是排队，拿不到中间结果，所以没法写"如果余额够就扣款"这种条件逻辑。它配合 `WATCH` 可以实现乐观锁：被监视的 key 在 `EXEC` 之前被别人改过，整个事务就会放弃执行，由客户端重试。

实践中，需要条件判断的原子操作基本都用 Lua 脚本。要注意的是脚本执行期间整个 Redis 都被它占着，所以**脚本必须短小**，不要在里面写循环处理大量数据。

## 过期与内存淘汰

Redis 数据在内存里，内存总有用完的时候。这里有两个容易混淆的机制。

**过期删除**处理的是设置了 TTL 的 key。Redis 不会在 key 到期的那一刻精确地删除它，而是用两种方式配合<sup class="cite" id="cite-16"><a href="#ref-16" title="EXPIRE">16</a></sup>：

- **惰性删除**：访问一个 key 时检查它是否过期，过期了就删掉并返回空；
- **定期删除**：后台定期随机抽查一批设了过期时间的 key，删掉其中已过期的。

所以一个过期的 key 在被删除之前仍然会占用内存，这是正常现象。

**内存淘汰**处理的是内存达到上限（`maxmemory`）时怎么办，由 `maxmemory-policy` 决定<sup class="cite" id="cite-17"><a href="#ref-17" title="Key eviction">17</a></sup>。常用的几种：

- `noeviction`：不淘汰，写入命令直接报错。这是 `redis.conf` 里的默认值；
- `allkeys-lru` / `allkeys-lfu`：在所有 key 中淘汰最近最少使用 / 使用频率最低的；
- `volatile-lru` / `volatile-lfu`：只在设了过期时间的 key 中淘汰；
- `allkeys-random` / `volatile-random`：随机淘汰；
- `volatile-ttl`：优先淘汰剩余寿命最短的。

较新的版本还增加了 `allkeys-lrm` / `volatile-lrm` 两个策略，细节可以看官方文档。

Redis 的 LRU 不是精确的，而是每次随机抽样几个 key（由 `maxmemory-samples` 控制），淘汰其中最久没被访问的那个，这样不需要为所有 key 维护一条链表，节省内存。

怎么选？**纯缓存场景用 `allkeys-lru` 或 `allkeys-lfu`**，Redis 满了就自动丢掉冷数据。**如果 Redis 里同时存着不能丢的数据**（比如会话、锁、队列），默认的 `noeviction` 更安全，但必须监控内存，并且最好把缓存和这类数据分到不同的实例上。

## 持久化：RDB 和 AOF

数据在内存里，进程重启就没了。Redis 提供两种持久化方式<sup class="cite" id="cite-18"><a href="#ref-18" title="Redis persistence">18</a></sup>：

**RDB（快照）**：在某个时间点把整个数据集写成一个紧凑的二进制文件。Redis 会 `fork` 出一个子进程来写，借助操作系统的写时复制（Copy-on-Write），主进程可以继续处理请求。优点是文件小、恢复快，适合做备份；缺点是两次快照之间的数据会丢。另外数据量很大时，`fork` 本身可能造成明显的停顿，写入频繁时写时复制还会让内存占用接近翻倍。

**AOF（追加日志）**：把每条写命令追加到日志文件里，重启时重放一遍。刷盘策略由 `appendfsync` 控制：

| `appendfsync` | 行为 | 最多丢多少 |
|---|---|---|
| `always` | 每条写命令都刷盘 | 几乎不丢，但性能最差 |
| `everysec` | 每秒刷盘一次（默认） | 约 1 秒 |
| `no` | 交给操作系统决定 | 取决于操作系统，通常几十秒 |

AOF 文件会越来越大，所以 Redis 会定期**重写**（rewrite），把当前数据集用最少的命令重新表示出来。Redis 7.0 起 AOF 改成了由一个基础文件加若干增量文件组成的多文件结构，重写过程更简单可靠。默认开启的 `aof-use-rdb-preamble` 会让基础文件直接用 RDB 格式，兼顾了 RDB 的加载速度和 AOF 的数据完整性。

**怎么选？** 官方的建议是：如果想要接近 PostgreSQL 这种级别的数据安全，两种都开<sup class="cite"><a href="#ref-18" title="Redis persistence">18</a></sup>。如果 Redis 只做缓存，丢了可以从数据库重建，完全可以只开 RDB 甚至都不开，换取更好的性能。

不管选哪种，有一点要记住：**Redis 的持久化是为了重启后能恢复，不是为了替代数据库**。把唯一一份重要数据只放在 Redis 里，是风险很高的做法。

## 高可用与扩展

单个 Redis 实例会遇到两个问题：宕机了怎么办（可用性），以及数据或流量超出一台机器的能力怎么办（扩展性）。对应有三种部署方式。

### 主从复制

一个主节点（master）负责写，若干个副本（replica）从主节点同步数据，可以分担读请求。复制默认是**异步**的：主节点写完就返回给客户端，不等副本确认<sup class="cite" id="cite-19"><a href="#ref-19" title="Redis replication">19</a></sup>。这意味着主节点宕机时，最后一部分还没同步过去的写入会丢失。

`WAIT` 命令可以让客户端等待指定数量的副本确认收到写入，降低丢数据的概率，但官方文档也明确说了，它并不能把 Redis 变成强一致的系统。

主从复制本身不会自动切换，主节点挂了需要人工把某个副本提升为主节点。

### 哨兵（Sentinel）

Sentinel 是在主从复制之上加的一层自动故障转移。一组 Sentinel 进程持续监控主节点，当足够多的 Sentinel（达到配置的 quorum）都认为主节点不可用时，它们会选出一个副本提升为新的主节点，并通知客户端新的地址<sup class="cite" id="cite-20"><a href="#ref-20" title="High availability with Redis Sentinel">20</a></sup>。

Sentinel 解决的是**可用性**问题，但所有数据仍然在一个主节点上，写入能力和内存容量都没有扩展。生产环境至少部署三个 Sentinel，分布在不同的机器上，避免它们自己成为单点。

### 集群（Cluster）

当数据量超过单机内存，或者写入量超过单机能力时，就需要 Redis Cluster 把数据分片到多个主节点上。

<figure class="diagram">
<svg viewBox="0 0 640 260" role="img" aria-label="Redis Cluster 把 key 通过 CRC16 取模映射到 16384 个槽位，槽位分布在三个主节点上，每个主节点有副本">
<rect class="c-gray" x="20" y="30" width="190" height="36" rx="5"/><text class="t" x="115" y="53" text-anchor="middle">key：user:{42}:profile</text>
<path class="ln" d="M115 66 V96"/><polygon class="ah" points="115,104 110.5,95 119.5,95"/>
<rect class="c-purple" x="20" y="104" width="190" height="54" rx="5"/><text class="t" x="115" y="127" text-anchor="middle">CRC16("42") mod 16384</text><text class="ts" x="115" y="147" text-anchor="middle">只对 {} 里的部分求哈希</text>
<path class="ln" d="M210 131 H226 V53 H238"/><polygon class="ah" points="246,53 237,48.5 237,57.5"/>
<text class="ts" x="250" y="22">16384 个槽位</text>
<rect class="c-blue" x="250" y="34" width="120" height="38"/><text class="t" x="310" y="58" text-anchor="middle">0 – 5460</text>
<rect class="c-green" x="370" y="34" width="120" height="38"/><text class="t" x="430" y="58" text-anchor="middle">5461 – 10922</text>
<rect class="c-amber" x="490" y="34" width="120" height="38"/><text class="t" x="550" y="58" text-anchor="middle">10923 – 16383</text>
<path class="ln" d="M310 72 V110 M430 72 V110 M550 72 V110"/>
<rect class="c-blue" x="260" y="110" width="100" height="36" rx="5"/><text class="t" x="310" y="133" text-anchor="middle">主节点 A</text>
<rect class="c-green" x="380" y="110" width="100" height="36" rx="5"/><text class="t" x="430" y="133" text-anchor="middle">主节点 B</text>
<rect class="c-amber" x="500" y="110" width="100" height="36" rx="5"/><text class="t" x="550" y="133" text-anchor="middle">主节点 C</text>
<path class="ln dash" d="M310 146 V186 M430 146 V186 M550 146 V186"/>
<text class="ts" x="316" y="171">复制</text><text class="ts" x="436" y="171">复制</text><text class="ts" x="556" y="171">复制</text>
<rect class="c-blue dash" x="260" y="186" width="100" height="36" rx="5"/><text class="t" x="310" y="209" text-anchor="middle">副本 A1</text>
<rect class="c-green dash" x="380" y="186" width="100" height="36" rx="5"/><text class="t" x="430" y="209" text-anchor="middle">副本 B1</text>
<rect class="c-amber dash" x="500" y="186" width="100" height="36" rx="5"/><text class="t" x="550" y="209" text-anchor="middle">副本 C1</text>
<text class="ts" x="20" y="200">客户端缓存"槽位 → 节点"映射，</text>
<text class="ts" x="20" y="220">发错节点时收到 MOVED 重定向</text>
</svg>
<figcaption>图 2：Redis Cluster 的数据分布。每个 key 落到一个固定的槽位，槽位再分配给主节点；每个主节点配副本做故障转移。</figcaption>
</figure>

Redis Cluster 的设计要点<sup class="cite" id="cite-21"><a href="#ref-21" title="Redis cluster specification">21</a></sup>：

- **16384 个哈希槽**。每个 key 通过 `CRC16(key) mod 16384` 算出它属于哪个槽，每个主节点负责一部分槽。扩容时只需要把一部分槽连同里面的数据迁移到新节点。
- **客户端直连**。没有中心代理，客户端缓存槽位到节点的映射，直接把请求发给正确的节点。发错了，节点会返回 `MOVED` 重定向，客户端据此更新映射。
- **自带故障转移**。每个主节点可以有副本，主节点宕机后副本自动接替，不需要额外部署 Sentinel。

集群模式下最需要适应的限制是：**涉及多个 key 的命令，这些 key 必须在同一个槽里**，否则会报 `CROSSSLOT` 错误。`MGET`、事务、Lua 脚本都受这个限制。解决办法是 **hash tag**：如果 key 里有 `{...}`，就只对花括号里的部分求哈希。比如 `user:{42}:profile` 和 `user:{42}:orders` 一定在同一个槽里，可以放在同一个事务里操作。

用 hash tag 也要克制，如果大量 key 用了同一个 tag，它们会全部挤在一个节点上，分片也就失去了意义。

**怎么选？** 数据能放进一台机器的内存，就用主从加 Sentinel，运维简单，也没有多 key 操作的限制；放不下或者写入扛不住，再上 Cluster。用云厂商的托管 Redis 时，这些细节大多由厂商处理，但上面的限制（尤其是 `CROSSSLOT`）依然存在。

## 生产环境里最常见的坑

### 大 key

"大 key"指单个 key 的值特别大，比如一个几十 MB 的字符串，或者一个有几百万元素的哈希、集合。它的问题在于：

- 读写它的命令耗时长，因为单线程，会阻塞其他所有请求；
- 删除它也慢，`DEL` 一个几百万元素的集合可能卡住好几秒；
- 集群模式下会导致数据和流量在节点间分布不均；
- 主从同步、网络传输都会变慢。

排查可以用 `redis-cli --bigkeys` 或 `--memkeys` 扫描。删除大 key 要用 `UNLINK` 代替 `DEL`，前者会把真正的内存释放放到后台线程。根本的解决办法是在设计时就拆分，比如把一个巨大的哈希按 ID 取模拆成多个小哈希。

### 热 key

"热 key"指某一个 key 的访问量远高于其他 key，比如秒杀商品的库存、热搜第一的内容。在集群模式下，一个 key 只会落在一个节点上，加再多节点也分摊不了它的压力。

常见对策有两种：一是在应用进程内再加一层本地缓存（Redis 6.0 起还支持客户端缓存协议，服务端在数据变化时通知客户端失效）；二是把热 key 复制成多份（`hot:item:1#0` 到 `hot:item:1#9`），读的时候随机选一份。

### 阻塞命令

几条在生产环境里要特别小心的命令：

- `KEYS pattern`：遍历所有 key，数据量大时会长时间阻塞。官方文档明确不建议在生产环境使用，应该用 `SCAN` 代替<sup class="cite" id="cite-22"><a href="#ref-22" title="KEYS">22</a></sup>。`SCAN` 基于游标，每次只返回一小批，可以分多次迭代完成；
- `HGETALL`、`SMEMBERS`、`LRANGE 0 -1` 这类一次返回整个集合的命令，对大集合同样危险，可以用 `HSCAN`、`SSCAN` 分批读取；
- `FLUSHALL` / `FLUSHDB`：建议加上 `ASYNC` 参数，并且通过 `rename-command` 或 ACL 禁止普通账号使用。

`SLOWLOG GET` 可以查看最近执行慢的命令，是排查延迟问题的第一步。

### 把 Redis 当数据库

前面说过，Redis 的复制是异步的，持久化也有丢失窗口。把订单、账户余额这类不能丢的数据只放在 Redis 里，迟早会出问题。比较稳妥的做法是：**数据库是唯一的数据源，Redis 只放可以重建的数据**，或者明确接受"丢一点也没关系"的数据（比如在线人数、浏览计数）。

## 在 FastAPI 里使用 Redis

最后给一个完整的例子，演示怎么在 FastAPI 里接入 Redis，实现缓存和滑动窗口限流。Python 里最常用的客户端是官方的 `redis-py`，从 4.2 版本起它自带了异步接口 `redis.asyncio`<sup class="cite" id="cite-23"><a href="#ref-23" title="Asyncio Examples (redis-py)">23</a></sup>，不需要再装额外的库。

```python
import json
import random
import time
import uuid
from contextlib import asynccontextmanager

import redis.asyncio as redis
from fastapi import Depends, FastAPI, HTTPException, Request

# 滑动窗口限流：删掉窗口外的记录，数一下窗口内的请求数，没超就记一笔
SLIDING_WINDOW_LUA = """
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
if redis.call('ZCARD', key) >= limit then
    return 0
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return 1
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 整个应用共用一个客户端，它内部维护连接池
    app.state.redis = redis.from_url("redis://localhost:6379/0", decode_responses=True)
    app.state.rate_limit = app.state.redis.register_script(SLIDING_WINDOW_LUA)
    yield
    await app.state.redis.aclose()


app = FastAPI(lifespan=lifespan)


def get_redis(request: Request) -> redis.Redis:
    return request.app.state.redis


async def rate_limit(request: Request, limit: int = 20, window_ms: int = 60_000):
    client_ip = request.client.host if request.client else "unknown"
    allowed = await request.app.state.rate_limit(
        keys=[f"ratelimit:ip:{client_ip}"],
        args=[int(time.time() * 1000), window_ms, limit, uuid.uuid4().hex],
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="请求太频繁，请稍后再试")


async def load_user_from_db(user_id: int) -> dict | None:
    ...  # 这里查 PostgreSQL


@app.get("/users/{user_id}", dependencies=[Depends(rate_limit)])
async def get_user(user_id: int, r: redis.Redis = Depends(get_redis)):
    key = f"user:{user_id}:profile"

    if (cached := await r.get(key)) is not None:
        if cached == "":  # 缓存的"空值"，防穿透
            raise HTTPException(status_code=404)
        return json.loads(cached)

    user = await load_user_from_db(user_id)
    if user is None:
        await r.set(key, "", ex=60)  # 不存在的数据也缓存一小会儿
        raise HTTPException(status_code=404)

    # TTL 加随机抖动，防雪崩
    await r.set(key, json.dumps(user), ex=300 + random.randint(0, 60))
    return user


@app.put("/users/{user_id}")
async def update_user(user_id: int, body: dict, r: redis.Redis = Depends(get_redis)):
    ...  # 先更新数据库
    await r.delete(f"user:{user_id}:profile")  # 再删缓存
    return {"ok": True}
```

几点说明：

- **客户端只创建一次**。`redis.from_url` 返回的客户端内部有连接池，应该在应用启动时创建、关闭时释放，而不是每个请求新建一个连接；
- **Lua 脚本用 `register_script` 注册**。redis-py 会用 `EVALSHA` 按脚本的哈希调用，只有服务端没缓存这个脚本时才发送完整内容；
- **限流用依赖注入挂在路由上**，可以按接口设置不同的阈值；
- 如果需要分布式锁，redis-py 自带的 `r.lock(name, timeout=...)` 已经实现了随机值校验和 Lua 释放，直接用就行。

## Redis 与 AI 应用

最近两年，Redis 在大模型应用里也用得越来越多，常见的几种用法：

- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /> </svg></span>**语义缓存**：把用户问题转成向量，如果和之前某个问题足够相似，就直接返回缓存的回答，省掉一次模型调用。这需要用到向量检索能力；
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /> <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /> <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" /> </svg></span>**会话历史和短期记忆**：用 List 或 Stream 存最近若干轮对话，设置 TTL 自动清理。更完整的记忆设计可以看 [Agent 记忆](/posts/agent-memory/) 那篇；
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m12 14 4-4" /> <path d="M3.34 19a10 10 0 1 1 17.32 0" /> </svg></span>**模型调用的限流和配额**：按用户或租户统计每分钟的请求数和 token 消耗，思路和前面的滑动窗口限流一样；
- <span class="term-ic"><svg aria-hidden="true"  xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /> <circle cx="18.5" cy="5.5" r=".5" fill="currentColor" /> <circle cx="11.5" cy="11.5" r=".5" fill="currentColor" /> <circle cx="7.5" cy="16.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="14.5" r=".5" fill="currentColor" /> <path d="M3 3v16a2 2 0 0 0 2 2h16" /> </svg></span>**向量检索**：Redis 8 内置的查询引擎和 Vector Set 都能做相似度搜索<sup class="cite"><a href="#ref-8" title="Redis vector sets">8</a></sup>，数据量不大、又已经在用 Redis 时，可以省掉一个单独的向量数据库。

## 小结

把这篇的要点浓缩一下：

1. **Redis 是内存里的数据结构服务器**，命令执行单线程，所以每条命令都是原子的，但一条慢命令会阻塞所有人；
2. **先选对数据结构**，计数用 String，对象用 Hash，排行和时间窗口用 Sorted Set，可靠队列用 Stream；
3. **缓存用 Cache-Aside**，先改库再删缓存，TTL 一定要设，并且加随机抖动；
4. **分布式锁要带随机值和过期时间**，用 Lua 释放；涉及正确性时，在数据库层面再加一道保障；
5. **需要条件判断的原子操作用 Lua**，Pipeline 只省网络往返，`MULTI` 不支持回滚；
6. **纯缓存用 `allkeys-lru`/`allkeys-lfu`**，混放重要数据时用 `noeviction` 并盯紧内存；
7. **持久化按需开启**，但别把 Redis 当成唯一的数据源；
8. **单机放得下用主从加 Sentinel，放不下再上 Cluster**，并注意多 key 操作的 `CROSSSLOT` 限制；
9. **警惕大 key、热 key 和 `KEYS` 这类阻塞命令**。

Redis 的命令不多，概念也不复杂，难的是在每个具体场景下做出合适的取舍。希望这篇能帮你在下次引入 Redis 时，少踩几个坑。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Redis <a href="https://redis.io/docs/latest/develop/data-types/">Redis data types</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Redis <a href="https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/">Diagnosing latency issues</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Trollope R. <a href="https://redis.io/blog/redis-adopts-dual-source-available-licensing/">Redis Adopts Dual Source-Available Licensing</a>. <i>Redis Blog</i>, 2024. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Linux Foundation <a href="https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community">Linux Foundation Launches Open Source Valkey Community</a>. <i>Linux Foundation</i>, 2024. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Trollope R. <a href="https://redis.io/blog/agplv3/">Redis is now available under the AGPLv3 open source license</a>. <i>Redis Blog</i>, 2025. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Redis <a href="https://redis.io/docs/latest/develop/data-types/sorted-sets/">Redis sorted sets</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Redis <a href="https://redis.io/docs/latest/develop/data-types/streams/">Redis Streams</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Redis <a href="https://redis.io/docs/latest/develop/data-types/vector-sets/">Redis vector sets</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Nishtala R. et al. <a href="https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala">Scaling Memcache at Facebook</a>. <i>NSDI</i>, 2013. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Redis <a href="https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/">Distributed Locks with Redis</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Kleppmann M. <a href="https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html">How to do distributed locking</a>. <i>martin.kleppmann.com</i>, 2016. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>Sanfilippo S. <a href="http://antirez.com/news/101">Is Redlock safe?</a>. <i>antirez.com</i>, 2016. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>Redis <a href="https://redis.io/docs/latest/develop/using-commands/pipelining/">Redis pipelining</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>Redis <a href="https://redis.io/docs/latest/develop/using-commands/transactions/">Transactions</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>Redis <a href="https://redis.io/docs/latest/develop/programmability/eval-intro/">Scripting with Lua</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>Redis <a href="https://redis.io/docs/latest/commands/expire/">EXPIRE</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>Redis <a href="https://redis.io/docs/latest/develop/reference/eviction/">Key eviction</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
<li id="ref-18"><span class="ref-n">[18]</span><span>Redis <a href="https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/">Redis persistence</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-18" aria-label="回到正文">↩</a></span></li>
<li id="ref-19"><span class="ref-n">[19]</span><span>Redis <a href="https://redis.io/docs/latest/operate/oss_and_stack/management/replication/">Redis replication</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-19" aria-label="回到正文">↩</a></span></li>
<li id="ref-20"><span class="ref-n">[20]</span><span>Redis <a href="https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/">High availability with Redis Sentinel</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-20" aria-label="回到正文">↩</a></span></li>
<li id="ref-21"><span class="ref-n">[21]</span><span>Redis <a href="https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/">Redis cluster specification</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-21" aria-label="回到正文">↩</a></span></li>
<li id="ref-22"><span class="ref-n">[22]</span><span>Redis <a href="https://redis.io/docs/latest/commands/keys/">KEYS</a>. <i>Redis Docs</i>. <a class="ref-back" href="#cite-22" aria-label="回到正文">↩</a></span></li>
<li id="ref-23"><span class="ref-n">[23]</span><span>Redis <a href="https://redis.readthedocs.io/en/stable/examples/asyncio_examples.html">Asyncio Examples (redis-py)</a>. <i>redis-py documentation</i>. <a class="ref-back" href="#cite-23" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
