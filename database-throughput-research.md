# Real-World Database Write Throughput: Verified Company Disclosures

Research compiled from primary engineering blog posts, conference talks, and official company communications. Every number below includes its direct source.

---

## SECTION 1: VERIFIED PUBLISHED NUMBERS

These numbers come directly from first-party engineering blog posts or official company communications where the exact figures are stated.

---

### Stack Overflow

**Database:** Microsoft SQL Server
**Scale (2016):** 209M HTTP requests/day, 66M page loads/day

| Metric | Number | Source |
|---|---|---|
| SQL queries/day | 504,816,843 (~5,842/sec avg) | [Nick Craver, "Stack Overflow: The Architecture - 2016 Edition"](https://nickcraver.com/blog/2016/02/17/stack-overflow-the-architecture-2016-edition/) |
| Read:Write ratio (disk I/O) | 40:60 (60% writes) | [Nick Craver, "What it takes to run Stack Overflow" (2013)](https://nickcraver.com/blog/2013/11/22/what-it-takes-to-run-stack-overflow/) |
| SQL Server CPU | 5-10% average | Same 2013 post |
| SQL Server RAM | 365 GB used | Same 2013 post |
| Redis hits/day | 5.8 billion | 2016 architecture post (above) |

**Key quote (2013):** "Stack Overflow actually has a 40:60 read-write ratio" -- this is unusual because heavy caching means most reads never hit the database, making the remaining database traffic disproportionately write-heavy.

**Caveat:** The 40:60 ratio is for disk-level I/O on the SQL Server, not application-level query counts. Application-level reads are mostly served by Redis (5.8B hits/day) and other caches.

---

### Shopify

**Database:** MySQL 8
**Scale (BFCM 2024):** $11.5B in sales, 76M+ buyers

| Metric | Number | Source |
|---|---|---|
| Peak DB queries/sec | 45 million | [Shopify Engineering on X (Dec 2024)](https://x.com/ShopifyEng/status/1863953414742257740); [HN discussion referencing Shopify data](https://news.ycombinator.com/item?id=42282884) |
| Peak DB writes/sec | 7.6 million | [HN post title sourced from Shopify/Tobi Lutke](https://news.ycombinator.com/item?id=42282884) |
| Peak row operations/sec | 1.4 billion | Shopify Engineering on X (same tweet above) |
| Total DB queries (BFCM weekend) | 10.5 trillion | [Shopify Engineering, "How we prepare Shopify for BFCM (2025)"](https://shopify.engineering/bfcm-readiness-2025) |
| Total DB writes (BFCM weekend) | 1.17 trillion | Same Shopify Engineering post |
| Peak edge requests/min | 284 million | Same Shopify Engineering post |
| Peak Kafka messages/sec | 66 million | Shopify Engineering on X (same tweet) |

**BFCM 2023 numbers (for comparison):**

| Metric | Number | Source |
|---|---|---|
| Peak DB queries/sec | 19 million (MySQL 5.7 + 8 mixed fleet) | [Shopify, "Performance up, complexity down" (2023)](https://www.shopify.com/news/performance%F0%9F%91%86-complexity%F0%9F%91%87-killer-updates-from-shopify-engineering) |
| Peak app server requests/sec | 967K | Same source |
| Peak Kafka messages/sec | 29 million | Same source |

**Note on source quality for 7.6M writes/sec:** The 45M QPS figure comes from the official @ShopifyEng X account. The 7.6M writes/sec figure is referenced in a Hacker News post title that links to a Shopify-affiliated X post. The Shopify Engineering blog post ("How we prepare Shopify for BFCM (2025)") confirms 1.17 trillion total writes but does not state the peak per-second rate. The tweet is the primary source for the 7.6M figure.

---

### Slack

**Database:** MySQL (via Vitess)
**Scale (2020):** Enterprise messaging platform

| Metric | Number | Source |
|---|---|---|
| Peak total QPS | 2.3 million | [Slack Engineering, "Scaling Datastores at Slack with Vitess" (Dec 2020)](https://slack.engineering/scaling-datastores-at-slack-with-vitess/) |
| Peak reads/sec | 2 million | Same post |
| Peak writes/sec | 300,000 | Same post |
| Read:Write ratio | ~87:13 | Derived from above (2M reads : 300K writes) |
| Median query latency | 2 ms | Same post |
| P99 query latency | 11 ms | Same post |

**Key quote:** "Today, we serve 2.3 million QPS at peak. 2M of those queries are reads and 300K are writes."

---

### GitHub

**Database:** MySQL
**Scale (2023):** 100M+ developers

| Metric | Number | Source |
|---|---|---|
| Total QPS (all clusters) | 5.5 million | [GitHub Blog, "Upgrading GitHub.com to MySQL 8.0" (May 2024)](https://github.blog/engineering/infrastructure/upgrading-github-com-to-mysql-8-0/) |
| MySQL hosts | 1,200+ | Same post |
| Database clusters | 50+ | Same post |
| Data stored | 300+ TB | Same post |
| Read:Write ratio (estimated) | ~97:3 | [John Nunemaker (GitHub engineer, 7 years), "Database Performance Simplified"](https://www.johnnunemaker.com/database-performance-simplified/) -- "GitHub.com is probably 97% reads" |

**Note:** The 97% reads figure comes from John Nunemaker, who worked at GitHub for 7 years focusing on performance. It is labeled as approximate ("probably") rather than exact instrumentation.

---

### Uber

**Database:** MySQL (Docstore/Schemaless, MyRocks engine)
**Scale (2024):** Ride-hailing, delivery, freight

| Metric | Number | Source |
|---|---|---|
| MySQL QPS | ~3 million | [Uber Blog, "Upgrading Uber's MySQL Fleet" (2024)](https://www.uber.com/blog/upgrading-ubers-mysql-fleet/) -- "Supporting multiple Petabytes of data and serving approximately 3 million queries per second" |
| MySQL clusters | 2,100+ | Same post |
| MySQL nodes | 16,000+ | Same post |
| Data stored | Multiple petabytes | Same post |
| CacheFront (Docstore cache) reads/sec | 40 million+ | [Uber Blog, "How Uber Serves Over 40 Million Reads Per Second"](https://www.uber.com/en-IN/blog/how-uber-serves-over-40-million-reads-per-second-using-an-integrated-cache/) |
| Cache hit rate (largest use case) | 99% at 6M RPS | Same CacheFront post |
| Cache consistency | 99.99% | Same CacheFront post |

**Uber Cassandra (separate system):**

| Metric | Number | Source |
|---|---|---|
| Writes/sec (largest cluster) | 1 million+ | [High Scalability, "How Uber Manages a Million Writes Per Second Using Mesos and Cassandra"](https://highscalability.com/how-uber-manages-a-million-writes-per-second-using-mesos-and/) |
| Mean write latency | 25 ms | Same source |
| Mean read latency | 13 ms | Same source |

---

### Stripe

**Database:** MongoDB (custom DocDB built on MongoDB Community)
**Scale (2023):** $1 trillion in payments processed

| Metric | Number | Source |
|---|---|---|
| DB queries/sec | 5 million | [Stripe Blog, "How Stripe's document databases supported 99.999% uptime" (Jun 2024)](https://stripe.com/blog/how-stripes-document-databases-supported-99.999-uptime-with-zero-downtime-data-migrations) |
| Database shards | 2,000+ | Same post |
| Collections | 5,000+ | Same post |
| Distinct query shapes | 10,000+ | Same post |
| Data migrated (2023) | 1.5 petabytes | Same post |
| Write throughput improvement | 10x (via sorted inserts) | Same post |
| Traffic switch duration | < 2 seconds | Same post |
| Uptime | 99.999% | Same post |

---

### Meta (Facebook) -- TAO

**Database:** MySQL (persistent storage) + cache layer
**Scale (2013):** 1 billion+ active users

| Metric | Number | Source |
|---|---|---|
| Read requests/sec | Over 1 billion | [Meta Engineering, "TAO: The power of the graph" (Jun 2013)](https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/) |
| Write requests/sec | Millions | Same post -- "handles over a billion read requests and millions of write requests per second" |
| Shards | Hundreds of thousands | Same post |
| Data types served | Thousands | Same post |

**From the USENIX paper (2013):** Peak throughput cited as 1.6 billion reads/sec and 3 million writes/sec. Source: [TAO: Facebook's Distributed Data Store for the Social Graph, USENIX ATC 2013](https://www.usenix.org/conference/atc13/technical-sessions/presentation/bronson)

---

### Discord

**Database:** ScyllaDB (migrated from Cassandra)
**Scale (2023):** Trillions of messages stored

| Metric | Number | Source |
|---|---|---|
| Cassandra nodes (before) | 177 | [Discord Blog, "How Discord Stores Trillions of Messages" (2023)](https://discord.com/blog/how-discord-stores-trillions-of-messages) |
| ScyllaDB nodes (after) | 72 | Same post |
| P99 read latency (ScyllaDB) | 15 ms (was 40-125 ms on Cassandra) | Same post |
| P99 write latency (ScyllaDB) | 5 ms (was 5-70 ms on Cassandra) | Same post |
| Migration throughput | Up to 3.2 million rows/sec | Same post |
| Storage per ScyllaDB node | 9 TB | Same post |

**Note:** Discord did not publish aggregate writes/sec for their production message traffic. The numbers above are latency and migration throughput, not sustained production write rates.

---

### Twitter / X

**Scale (2013):** 150M active users, 400M tweets/day

| Metric | Number | Source |
|---|---|---|
| Timeline read QPS | 300,000 | [High Scalability, "The Architecture Twitter Uses to Deal with 150M Active Users, 300K QPS" (2013)](https://highscalability.com/the-architecture-twitter-uses-to-deal-with-150m-active-users/) -- based on Raffi Krikorian's talk "Timelines at Scale" |
| Write QPS | 6,000 | Same source -- "only 6000 requests per second are spent on writes" |
| Read:Write ratio (timelines) | 50:1 | Derived from 300K reads : 6K writes |
| Tweet ingestion rate (avg) | 5,000/sec | Same source |
| Tweet ingestion rate (peak) | 7,000/sec (>12K during events) | Same source |
| Timeline deliveries/sec | 300,000 | Same source |
| Flock (social graph) per-server QPS | 30K-45K | [Twitter Engineering, "The Infrastructure Behind Twitter: Scale" (2017)](https://blog.x.com/engineering/en_us/topics/infrastructure/2017/the-infrastructure-behind-twitter-scale) |

---

### Wikipedia / Wikimedia

**Database:** MariaDB (formerly MySQL)
**Scale (2008 data):** One of the world's busiest websites

| Metric | Number | Source |
|---|---|---|
| HTTP requests/sec | 50,000 | [Data Center Knowledge, "A Look Inside Wikipedia's Infrastructure" (2008)](https://www.datacenterknowledge.com/archives/2008/06/24/a-look-inside-wikipedias-infrastructure/) |
| SQL queries/sec | 80,000 | Same source |
| Application servers | 200 | Same source |
| Database servers | 20 | Same source |
| Squid cache servers | 70 | Same source |
| MySQL instance size | 200-300 GB each | Same source |

**Note:** The MySQL case study page on mysql.com (now 404) previously stated "Wikipedia's MySQL databases handle over 25,000 SQL queries per second." The 80,000 figure from Data Center Knowledge is from a 2008 presentation by Domas Mituzas. Wikipedia is heavily cache-dependent; the vast majority of page views never touch the database.

---

### Dropbox -- Edgestore

**Database:** MySQL (underlying storage for Edgestore)

| Metric | Number | Source |
|---|---|---|
| Queries/sec | Millions | [Dropbox Engineering, "(Re)Introducing Edgestore"](https://dropbox.tech/infrastructure/reintroducing-edgestore) -- "storing several trillion entries and servicing millions of queries per second with 5-9s of availability" |
| Entries stored | Several trillion | Same post |
| Machines | Thousands | Same post |
| Availability | 5-9 nines | Same post |

---

### Netflix

**Database:** Cassandra (primary), MySQL (billing)

| Metric | Number | Source |
|---|---|---|
| Benchmark: writes/sec (288 nodes) | 1.1 million client writes/sec | [Netflix Tech Blog, "Benchmarking Cassandra Scalability on AWS" (Nov 2011)](https://medium.com/netflix-techblog/benchmarking-cassandra-scalability-on-aws-over-a-million-writes-per-second-39f45f066c9e) |
| Benchmark: total with replication (RF=3) | 3.3 million writes/sec | Same post |
| Graph: sustained reads/sec | ~2 million | [Netflix Tech Blog, "How and Why Netflix Built a Real-Time Distributed Graph: Part 2" (2025)](https://netflixtechblog.medium.com/how-and-why-netflix-built-a-real-time-distributed-graph-part-2-building-a-scalable-storage-layer-ff4a8dbd3d1f) |
| Graph: sustained writes/sec | ~6 million | Same post |
| Graph nodes | 8 billion+ | Same post |
| Graph edges | 150 billion+ | Same post |

**Important distinction:** The 2011 benchmark (1.1M writes/sec) is a synthetic benchmark, not production traffic. The graph numbers (~2M reads, ~6M writes) are production workload numbers from 2025 but specific to the graph service, not all of Netflix.

---

### OpenAI (ChatGPT)

**Database:** PostgreSQL
**Scale (2025):** 800 million ChatGPT users

| Metric | Number | Source |
|---|---|---|
| QPS | Millions (exact number not disclosed) | [OpenAI, "Scaling PostgreSQL to power 800 million ChatGPT users" (Jan 2025)](https://openai.com/index/scaling-postgresql/) |
| Read replicas | ~50 | Same post |
| P99 latency | Low double-digit milliseconds | Same post |
| Availability target | Five nines (99.999%) | Same post |

**Key architectural note:** OpenAI runs a single-primary PostgreSQL deployment. Write-heavy workloads are offloaded to sharded systems like Azure CosmosDB. The PostgreSQL instance is overwhelmingly read-heavy.

---

### Instagram

**Database:** PostgreSQL (sharded)
**Scale (2012):** Early growth phase

| Metric | Number | Source |
|---|---|---|
| Photos ingested/sec | 25+ | [Instagram Engineering, "Sharding & IDs at Instagram" (2012)](https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c) -- "With more than 25 photos and 90 likes every second" |
| Likes/sec | 90 (grew to 10,000+) | Same post; growth figure from [Instagram Engineering, "Instagration Pt. 2"](https://instagram-engineering.com/instagration-pt-2-scaling-our-infrastructure-to-multiple-data-centers-5745cbad7834) |
| Logical shards | Several thousand | Sharding & IDs post |

**Note:** These are 2012 numbers from a much earlier Instagram. Modern Instagram (2B+ users) does not publish current database throughput numbers publicly.

---

### Cloudflare

**Database:** ClickHouse (analytics), PostgreSQL (config)

| Metric | Number | Source |
|---|---|---|
| HTTP log ingestion rate | 6M logs/sec (avg), 8M peak | [Cloudflare Blog, "HTTP Analytics for 6M requests per second using ClickHouse"](https://blog.cloudflare.com/http-analytics-for-6m-requests-per-second-using-clickhouse/) |
| ClickHouse row insertion rate | 11M rows/sec (all pipelines) | Same post |
| Insertion bandwidth | 47 Gbps | Same post |
| ClickHouse cluster | 36 nodes, 3x replication | Same post |
| DNS queries analyzed/sec | 1M+ | [Cloudflare Blog, "How Cloudflare analyzes 1M DNS queries per second"](https://blog.cloudflare.com/how-cloudflare-analyzes-1m-dns-queries-per-second/) |

---

## SECTION 2: READ:WRITE RATIOS

Summary of verified read:write ratios from the companies above:

| Company | Read:Write Ratio | Notes | Source |
|---|---|---|---|
| Stack Overflow | 40:60 (disk I/O) | Unusual -- caching absorbs most reads, so DB traffic is write-heavy | [Nick Craver (2013)](https://nickcraver.com/blog/2013/11/22/what-it-takes-to-run-stack-overflow/) |
| Shopify | ~10:1 (reads:writes) | 10.5T reads vs 1.17T writes during BFCM 2024 | [Shopify Engineering (2025)](https://shopify.engineering/bfcm-readiness-2025) |
| Slack | ~87:13 | 2M reads : 300K writes at peak | [Slack Engineering (2020)](https://slack.engineering/scaling-datastores-at-slack-with-vitess/) |
| GitHub | ~97:3 | Estimated by John Nunemaker (7yr GitHub engineer) | [John Nunemaker](https://www.johnnunemaker.com/database-performance-simplified/) |
| Twitter | ~50:1 (timelines) | 300K read QPS : 6K write QPS | [High Scalability / Raffi Krikorian (2013)](https://highscalability.com/the-architecture-twitter-uses-to-deal-with-150m-active-users/) |
| Meta TAO | ~100:1 or higher | "over a billion reads... millions of writes per second" | [Meta Engineering (2013)](https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/) |
| Netflix (viewing history) | ~1:9 (write-heavy) | "viewing history data write to read ratio is about 9:1" | [Netflix Tech Blog, "Scaling Time Series Data Storage"](https://netflixtechblog.com/scaling-time-series-data-storage-part-i-ec2b6d44ba39) |

---

## SECTION 3: KEY CONTEXT FOR INTERPRETATION

### What "writes per second" means varies enormously

- **Shopify's 7.6M writes/sec** is across thousands of MySQL instances powering millions of stores during the year's peak shopping event. This is a fleet-wide aggregate.
- **Stack Overflow's ~5,800 SQL queries/sec** runs on 2 SQL Servers. It serves 200M+ requests/day for one of the world's top 50 websites.
- **Slack's 300K writes/sec** is the peak for an enterprise messaging platform with millions of daily users.

### Caching changes everything

Most web applications never expose their full read load to the database. Stack Overflow serves 5.8 billion Redis hits per day against 504 million SQL queries. Wikipedia serves billions of page views from Squid cache with only 80,000 SQL queries hitting the database. The database sees a distorted picture of the actual workload.

### "Queries per second" != "Writes per second"

Many companies report total QPS (reads + writes combined). To get write throughput, you need either an explicit write figure or a read:write ratio. Most web applications are 90-99% reads at the application layer.

### Peak vs. sustained

Shopify's 7.6M writes/sec is a peak during Black Friday. Their sustained average would be dramatically lower. Always distinguish peak from sustained numbers.

---

## SECTION 4: SOURCE QUALITY ASSESSMENT

| Company | Source Type | Quality |
|---|---|---|
| Stack Overflow | First-party engineering blog by named author (Nick Craver, SRE lead) | Excellent -- detailed, specific, reproducible |
| Shopify | Mix of official engineering blog + @ShopifyEng tweets | Good -- tweets are primary source for per-second peaks; blog has aggregates |
| Slack | First-party engineering blog | Excellent -- exact numbers with read/write breakdown |
| GitHub | First-party engineering blog | Good -- aggregate QPS stated; read:write ratio from ex-employee |
| Uber | First-party engineering blog | Good -- multiple posts with specific numbers |
| Stripe | First-party engineering blog | Excellent -- detailed post with exact numbers |
| Meta (TAO) | First-party engineering blog + USENIX paper | Excellent -- peer-reviewed academic paper |
| Discord | First-party engineering blog | Good -- latency numbers precise; no aggregate throughput stated |
| Twitter | Third-party (High Scalability) summarizing conference talk | Moderate -- numbers come from a talk transcript, not official docs |
| Wikipedia | Third-party (Data Center Knowledge) summarizing presentation | Moderate -- 2008 data; numbers from conference presentation |
| Netflix | First-party engineering blog | Good -- benchmark vs. production clearly distinguished |
| OpenAI | First-party blog | Moderate -- "millions" without exact number |
| Instagram | First-party engineering blog | Good for 2012 data; outdated for current scale |
| Cloudflare | First-party engineering blog | Excellent -- specific numbers with architecture details |
