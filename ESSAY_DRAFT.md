# Which database should your product actually use?

"Just use Postgres" is one of the most common pieces of advice in software engineering. But I realized I'd never seen anyone actually decompose the question — break down what factors matter, how much they matter, and examine the data for each one. The advice is repeated because it sounds right, not because anyone does the analysis.

So I did the analysis. I decomposed the question "SQLite or PostgreSQL?" from first principles, ran benchmarks on real databases (not Docker — native installations on the same SSD), read the engineering disclosures from companies at scale, and did the arithmetic.

Some of what I found surprised me. In particular, the factor engineers argue about most — throughput — turned out to matter least.

## Throughput

This is the factor engineers instinctively focus on — "can my database handle the load?" Let's find out.

### How much write throughput does a product actually need?

**Average writes/sec = (DAU × writes per user per day) ÷ 86,400**

Peak is typically 3–5× the average (traffic concentrates in active hours).

A SaaS tool might generate 5–10 writes per user per day (form submissions, settings, activity logs). A social app might generate 20–50 (posts, comments, likes). The table uses representative values:

| DAU | Writes/user/day | Avg writes/sec | Peak (3×) |
|-----|----------------|----------------|-----------|
| 1,000 | 10 | 0.1 | 0.3 |
| 10,000 | 10 | 1.2 | 3.5 |
| 100,000 | 20 | 23 | 69 |
| 1,000,000 | 10 | 116 | 347 |
| 1,000,000 | 20 | 231 | 694 |
| 10,000,000 | 20 | 2,315 | 6,944 |
| 10,000,000 | 50 | 5,787 | 17,361 |

One million DAU — a scale most products never reach — needs ~100–700 writes/sec at peak.

### What real companies actually see

I collected database throughput disclosures from first-party engineering blogs. The full research with all citations is [published alongside this essay](https://github.com/andrecasal/sqlite-vs-postgres-benchmark/blob/main/database-throughput-research.md).

**Slack** (2020): [300,000 writes/sec at peak](https://slack.engineering/scaling-datastores-at-slack-with-vitess/) — across their entire Vitess/MySQL fleet.

**Shopify** (BFCM 2024): [7.6 million writes/sec at peak](https://news.ycombinator.com/item?id=42282884) — across thousands of MySQL instances during the year's peak shopping event.

**GitHub** (2024): [5.5 million QPS across 1,200+ MySQL hosts](https://github.blog/engineering/infrastructure/upgrading-github-com-to-mysql-8-0/), [~97% reads](https://www.johnnunemaker.com/database-performance-simplified/) — roughly 140 writes/sec per host.

The pattern: even at massive scale, write throughput per individual database host is measured in hundreds to low thousands per second. The fleet-wide aggregates are large, but distributed across hundreds or thousands of instances.

Most web applications are overwhelmingly read-heavy:

| Company | Read:Write | Source |
|---|---|---|
| GitHub | ~97:3 | [Nunemaker](https://www.johnnunemaker.com/database-performance-simplified/) |
| Slack | ~87:13 | [Slack Eng](https://slack.engineering/scaling-datastores-at-slack-with-vitess/) |
| Meta TAO | ~100:1+ | [Meta Eng](https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/) |

### Our benchmark: both databases have massive headroom

I built a reproducible benchmark measuring SQLite and PostgreSQL on the same machine, same SSD, same schema. Full code: [sqlite-vs-postgres-benchmark](https://github.com/andrecasal/sqlite-vs-postgres-benchmark).

**Setup:**
- SQLite: WAL mode, `synchronous=NORMAL`, 64MB cache, 256MB mmap. File on SSD.
- PostgreSQL 17: Native Homebrew installation (not Docker), `shared_buffers=256MB`, `synchronous_commit=on`. Data on same SSD.
- Machine: Apple M2 Pro (12 cores), 16GB RAM, Bun 1.2.18.

**Single-connection results (the fair comparison — both on SSD):**

| Scenario | SQLite | PostgreSQL (native) | SQLite faster by |
|---|---|---|---|
| Sequential inserts | 23,403 ops/sec | 7,740 ops/sec | 3.0× |
| Mixed 80/20 read/write | 96,051 ops/sec | 11,824 ops/sec | 8.1× |

SQLite is faster per-query because it executes queries as function calls within the same process (~0.02ms), while PostgreSQL requires inter-process communication via Unix socket (~0.10ms).

**PostgreSQL concurrent scaling:**

| Connections | Ops/sec |
|---|---|
| 1 | 8,321 |
| 4 | 23,290 |
| 8 | 31,856 |
| 16 | 35,370 |
| 32 | 24,371 |

**PostgreSQL peaks at 35,370 ops/sec with 16 connections — exceeding SQLite's 23,403.** The crossover happens at ~4 concurrent connections.

The question isn't "do I have concurrent users" — every web app does. It's **"do I have more writes per second than one process can handle?"** SQLite handles ~23K writes/sec through a single writer. A 1M DAU SaaS needs ~700 writes/sec at peak. You'd need to be well past 10M DAU with write-heavy patterns before a single writer becomes the bottleneck.

For most products, the answer is no — and won't be for years.

### Failure modes

**SQLite** — When writes queue behind the single writer, `SQLITE_BUSY` triggers automatic retry (with `busy_timeout`). Tail latency climbs gradually. At 1,000 writes/sec, queue depth is effectively zero. Mitigations: batching, Turso's `BEGIN CONCURRENT` (~4× throughput), or migrate to PostgreSQL.

**PostgreSQL** — Connection exhaustion. Each connection is an OS process (~10MB). At `max_connections=200`, you hit process limits. Mitigations: PgBouncer, Supavisor — but these add operational complexity (another component, another failure mode).

Both databases handle far more than most products need. With throughput eliminated as a differentiator, the next question is binary: does your product require a capability that only one database can provide?

## Capabilities

This is the only binary factor. If your product requires a capability that only one database provides, the decision is made. Everything else is irrelevant.

### What's genuinely PostgreSQL-only?

The list is shorter than commonly assumed. I researched each claimed PostgreSQL advantage to check whether the SQLite ecosystem has a viable alternative.

**LISTEN/NOTIFY** — Genuinely Postgres-only. SQLite has no server process to mediate between clients, so database-level pub/sub is [architecturally impossible](https://sqlite.org/forum/info/d2586c18e7197c39c9a9ce7c6c411507c3d1e786a2c4889f996605b236fec1b7). SQLite applications use application-level event systems instead (WebSockets, Redis pub/sub). *Who needs this: real-time dashboards, chat systems, collaborative editors.*

**Row-level security** — Genuinely Postgres-only as a database feature. SQLite has no user or role concept. The SQLite approach to tenant isolation is architecturally different: separate database files per tenant, which provides isolation by construction rather than by policy. Even in the PostgreSQL ecosystem, [modern consensus](https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives/) is to use RLS as defense-in-depth alongside application-layer authorization. *Who needs this: multi-tenant SaaS with shared database.*

**Raster geospatial, routing, 3D** — PostGIS has no SQLite equivalent for raster data processing, pgRouting, or SFCGAL 3D operations. However, [SpatiaLite](https://www.gaia-gis.it/fossil/libspatialite/index) covers [~80–90%](https://db-engines.com/en/system/PostGIS;SpatiaLite) of what most applications need for vector geometry: distance calculations, polygon containment, spatial indexing, CRS transformations. SQLite also ships with built-in [R\*Tree](https://www.sqlite.org/rtree.html) and [Geopoly](https://www.sqlite.org/geopoly.html) modules. *If your app needs "find restaurants within 5km", SpatiaLite handles it. If it needs satellite imagery processing or turn-by-turn routing, you need PostGIS.*

**Large-scale ANN vector search** — pgvector provides HNSW and IVFFlat indexes across millions of vectors. SQLite has [sqlite-vec](https://github.com/asg017/sqlite-vec) (~7K stars, Mozilla-sponsored, brute-force KNN, good under ~500K vectors), [vectorlite](https://github.com/1yefuwang1/vectorlite) (HNSW via hnswlib, [10–40× faster](https://dev.to/yefuwang/introducing-vectorlite-a-fast-and-tunable-vector-search-extension-for-sqlite-4dcl) than sqlite-vss), and [Turso/libSQL](https://turso.tech/vector) (native DiskANN). *For <500K vectors (most product use cases), SQLite options work. For millions of vectors with concurrent access, pgvector is stronger.*

### Capability summary

| Capability | PostgreSQL | SQLite ecosystem | Postgres-only? |
|---|---|---|---|
| LISTEN/NOTIFY | Built-in | None | **Yes** |
| Row-level security | Built-in | Per-tenant DB files | **Yes** (as feature) |
| Raster geo, routing, 3D | PostGIS | None | **Yes** |
| Vector geometry (proximity, containment) | PostGIS | SpatiaLite, R\*Tree, Geopoly | No |
| ANN vector search (>500K vectors) | pgvector | sqlite-vec, vectorlite, Turso | Partial |
| Multi-server strong consistency | Native replication | rqlite (Raft), cr-sqlite (CRDT) | Partial |
| Edge deployment (sub-ms reads) | Requires read replicas | Native (collocated file) | **No — SQLite advantage** |

**If you need LISTEN/NOTIFY, RLS, raster/routing/3D, or large-scale ANN vector search — use PostgreSQL.** These are genuine capabilities that SQLite cannot provide.

If you don't need them, both databases can do what your product requires. The remaining factors help you choose between two viable options.

## User-facing latency

For the individual user waiting for a page to load, **latency** is what they experience. And the dominant source of latency isn't the database engine. It's the network between the user and the database.

### The arithmetic of a page load

A typical page load involves 3–8 sequential database queries. Let's use 5 and compute total time.

**Measured per-query processing times** (from our benchmark — details in the Appendix):
- SQLite: 0.023ms (p50)
- PostgreSQL (native): 0.096ms (p50)

**Measured network round-trip times** (from [Fly.io's global RTT tool](https://rtt.fly.dev/)):
- Same process (SQLite collocated): 0ms
- Same region (PostgreSQL local): ~1ms
- New Jersey → London: ~85ms
- New Jersey → Tokyo: ~231ms
- New Jersey → São Paulo: ~154ms
- New Jersey → Sydney: ~237ms

**Total time for 5 sequential queries:**

| Architecture | Network RTT | DB time | Total | Network % |
|---|---|---|---|---|
| SQLite collocated | 0ms | 0.023ms | **0.12ms** | 0% |
| PostgreSQL same server | ~0.07ms | 0.096ms | **0.83ms** | 42% |
| PostgreSQL same region | ~1ms | 0.096ms | **5.48ms** | 91% |
| PostgreSQL → London | ~85ms | 0.096ms | **425ms** | 99.9% |
| PostgreSQL → Tokyo | ~231ms | 0.096ms | **1,155ms** | 99.96% |
| SQLite edge replica (Tokyo) | 0ms | 0.023ms | **0.12ms** | 0% |

### How much does latency dominate over throughput?

This is now quantified:

- **Same region**: Network is 91% of the equation. If PostgreSQL were 10× faster at query processing, total time drops from 5.48ms to 5.05ms — imperceptible.
- **Cross-region (London)**: Network is 99.9%. If PostgreSQL had *zero* processing time, the user still waits 425ms.
- **Cross-continent (Tokyo)**: Network is 99.96%. Database speed is a rounding error.

**Throughput still matters, but for a different thing.** Latency determines each user's experience. Throughput determines how many users the system handles before saturating. For a product with 700 writes/sec (1M DAU), both databases are at <10% capacity — throughput is not the bottleneck.

The practical implication: **the choice of which database engine you use affects the 0.1–9% of time spent on query processing. The choice of where your database sits relative to your users affects the 91–99.96%.** Deployment architecture dominates database engine selection for user-facing performance.

### Two deployment patterns

#### Pattern A: SQLite at the edge

Application and database run together on edge nodes close to users. Reads are local function calls — sub-millisecond regardless of where the user is. One node is the primary for writes; writes from non-primary nodes travel to the primary through the provider's internal network.

**Measured performance (Turso embedded replicas):**
- Read latency: **0.28ms** in a real Remix app ([Turso blog, Nov 2023](https://turso.tech/blog/speeding-up-a-remix-website-with-tursos-embedded-replicas-hosted-on-akamais-linode-e5e5a738))
- Write latency from non-primary: **~832ms** including remote round-trip + local sync (same source)
- Write latency from primary: ~0.02ms (local)

**Best for:** Read-heavy applications (87–97% reads per real-world data), global audiences, UX-sensitive products (e-commerce, dashboards, content sites).

**Trade-off:** Writes from non-primary regions pay the network round-trip. The user sees their own write immediately (read-your-writes guarantee), but propagation to other regions depends on the sync interval.

**Replication ecosystem:**
- **[Turso/libSQL](https://turso.tech/)** — Primary + embedded read replicas. `BEGIN CONCURRENT` for ~4× write throughput. Most mature option.
- **[Litestream](https://litestream.io/)** (v0.5.2) — Continuous backup to S3. Not replication, but essential for DR.
- **[rqlite](https://rqlite.io/)** (v9.0) — Raft-consensus distributed SQLite. Strong consistency.
- **[cr-sqlite](https://github.com/vlcn-io/cr-sqlite)** (v0.16.3) — CRDT-based multi-master. True offline-first.
- **LiteFS** — **Deprecated.** [Fly.io deprioritized it](https://community.fly.io/t/what-is-the-status-of-litefs/23883): *"We are not able to provide support or guidance for this product."* LiteFS Cloud was [sunset Oct 2024](https://community.fly.io/t/sunsetting-litefs-cloud/20829). Do not build new systems on LiteFS.

#### Pattern B: Centralized PostgreSQL

Database runs in one region. All queries go to that region.

- Same-region: **~1.1ms** per query
- Cross-region (London): **~85ms** per query
- Cross-region (Tokyo): **~231ms** per query

Read replicas via streaming replication can bring reads closer to users:
- **Async replication**: <1s lag, [<285ms average](https://aws.amazon.com/rds/aurora/global-database/) with Aurora Global Database.
- **Sync replication**: Zero data loss, but writes pay network RTT. At 50ms RTT: [88 TPS with 5 clients](https://www.postgresql.fastware.com/pzone/2024-09-fep-ha-network-latency-tests). At 100ms: 47 TPS.

**Best for:** Single-region user base, complex query requirements, concurrent write scaling, multi-tenant SaaS with RLS.

**Trade-off:** Users far from the database region pay latency that no amount of tuning can fix.

### Which pattern for which product?

| Product type | Likely best fit | Why |
|---|---|---|
| E-commerce storefront | SQLite at edge | Every ms costs conversions; reads dominate |
| Content/blog platform | SQLite at edge | Almost entirely reads; global audience |
| SaaS dashboard | Either | Read-heavy; users often in one region |
| Mobile app (offline-first) | SQLite + cr-sqlite | CRDT sync handles offline/online |
| Global messaging/social | PostgreSQL + replicas | Write-heavy, concurrent writers, LISTEN/NOTIFY |
| Real-time collaborative editor | PostgreSQL | Concurrent writes, change notifications |
| IoT data ingestion | PostgreSQL | High write throughput from many concurrent sources |

If your users are global and read latency directly affects your product's success, SQLite at the edge delivers sub-millisecond reads worldwide — an advantage no centralized database can match. For single-region products, or products where latency is adequate with either database, one factor remains.

## Development velocity

Every component in your stack has a cost. Not just the sticker price — the cognitive cost, the debugging cost, the onboarding cost, the "it's 3am and something broke" cost. From first principles: **the simplest system that meets your requirements is the one with the fewest ways to fail.**

### Counting preconditions

A useful way to quantify complexity: count the preconditions — things that must all be true for a database query to succeed.

**SQLite preconditions:**
1. File exists and is readable/writable
2. Schema is correct

**PostgreSQL preconditions:**
1. Server process is running
2. Server is accepting connections (not at `max_connections`)
3. Network path between app and server works
4. Authentication credentials are correct
5. User has appropriate permissions
6. Connection hasn't timed out
7. Connection pool has available slots
8. Schema is correct

That's 2 vs 8. Each precondition is an independent failure mode — a thing that can go wrong and that you must verify when debugging. The possible invalid states grow combinatorially with the number of independent components.

### What this looks like in practice

**New developer onboarding:**

SQLite:
```
git clone repo && bun install && bun run dev
```

PostgreSQL:
```
git clone repo && bun install && docker compose up -d && # wait for PG ready
bun run migrate && # configure .env with DATABASE_URL && bun run dev
```

Plus: Docker Desktop installed, port 5432 not conflicting with another project, credentials matching between .env and Docker config.

**CI pipeline:**

SQLite: nothing extra. The database is a file that appears when the app starts.

PostgreSQL: a service container, health checks, credential injection, migration step.

**Debugging at 3am:**

SQLite: "Is it the application code or the query?" Two suspects.

PostgreSQL: "Is it the application code, the query, the connection, the network, the pooler, the server load, the vacuum state, the disk, Docker?" Nine suspects.

**Backups:**

SQLite: `cp database.db database.backup` — or Litestream for continuous streaming to S3.

PostgreSQL: `pg_dump`, WAL archiving, or managed backup service. Point-in-time recovery is powerful but operationally complex.

### The compound effect

This isn't about any single incident. It's about the compound effect over the lifetime of a product. If reduced infrastructure complexity saves 5% of development time — less debugging, faster onboarding, simpler CI, fewer "works on my machine" issues — and you ship 50 features a year, that's 2.5 features worth of time recovered annually. Over three years, it's 7.5 features. That's not a rounding error.

And the cost of complexity isn't just time — it's cognitive load. Every hour spent configuring connection poolers or troubleshooting Docker networking is an hour not spent on the product. For a small team where every engineer-hour matters, this is the highest-leverage factor in the database decision.

### The counter-argument

PostgreSQL's complexity is well-understood. Millions of developers know it. Hosting platforms (Railway, Render, Supabase, Neon) abstract away much of the operational burden. If your team is already fluent in PostgreSQL, the marginal cost of using it is lower than for someone starting fresh.

This is a legitimate consideration. "My team already knows this tool" has real value. But it's a different argument from "this tool is technically superior." And it should be weighed against the structural simplicity advantage, not treated as a trump card.

## How to decide

This essay isn't an argument for SQLite over PostgreSQL. It's an argument for decomposing the decision and examining each factor with data instead of relying on convention.

The funnel:

1. **Throughput** — Both databases handle far more than most products need. Not a differentiator.

2. **Capabilities** — Do you need LISTEN/NOTIFY, RLS, raster geospatial, or large-scale ANN vector search? If yes → PostgreSQL.

3. **Latency** — Are your users global? Is read latency tied to conversions or UX? If yes → SQLite at the edge.

4. **Velocity** — For everyone else — and this is most products — SQLite's operational simplicity is the stronger default. Fewer moving parts, faster onboarding, simpler debugging, less infrastructure.

**The cost of choosing wrong is lower than it appears.** With a modern ORM (Prisma, Drizzle, Kysely), migrating from SQLite to PostgreSQL is a configuration change plus a test pass. The fear of "what if I need to switch later" should not drive the initial decision — that's paying complexity cost now for a problem you may never have.

Run the numbers for your specific workload. The formula is above, and the benchmark code is in the repository. Check your assumptions against data.

---

*Benchmark repository: [sqlite-vs-postgres-benchmark](https://github.com/andrecasal/sqlite-vs-postgres-benchmark)*

*Full company throughput research with citations: [database-throughput-research.md](https://github.com/andrecasal/sqlite-vs-postgres-benchmark/blob/main/database-throughput-research.md)*

*Fly.io global latency measurements: [rtt.fly.dev](https://rtt.fly.dev/)*
