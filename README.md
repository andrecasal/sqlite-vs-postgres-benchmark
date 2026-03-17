# SQLite vs PostgreSQL: Benchmark

Reproducible benchmarks comparing SQLite (WAL mode) and PostgreSQL write throughput on the same machine, same SSD, same schema.

## Why this exists

The claim "just use Postgres" is common advice. This repo measures whether that advice is supported by data for typical web application workloads.

## What it measures

Four scenarios, designed to represent common web application database usage:

1. **Sequential single-row inserts** — One INSERT per call, no batching. This is what a typical ORM does for each `create()` call.
2. **Batched inserts (100 and 1000 rows per transaction)** — Multiple INSERTs wrapped in a transaction. Common for bulk operations.
3. **Concurrent writers (Postgres only)** — Multiple connections inserting simultaneously. Tests Postgres's ability to parallelize writes. SQLite is single-writer by design, so there's no equivalent test.
4. **Mixed 80/20 read/write** — 80% SELECT by primary key, 20% INSERT. Represents a typical web app's read-heavy workload.

## Methodology

Both databases run on the same machine, same SSD — apples to apples.

- **SQLite**: File-based (not `:memory:`), WAL mode, `synchronous=NORMAL`, 64MB cache, 256MB mmap. Data on macOS APFS (SSD).
- **PostgreSQL**: Native Homebrew installation (not Docker), `shared_buffers=256MB`, `synchronous_commit=on`. Data on same SSD.
- **Row schema**: Realistic web app table with `id`, `name`, `email` (indexed), `age`, `bio` (text), `created_at`.
- **Operations**: 10,000 per scenario.
- **Driver**: `bun:sqlite` (built-in) for SQLite, `postgres` (postgres.js) for PostgreSQL.

## Results (Apple M2 Pro, 16GB RAM)

### Head-to-head (single connection)

| Scenario | SQLite (file, SSD) | Postgres (native, SSD) | Ratio |
|---|---|---|---|
| Sequential inserts | 23,403 ops/sec | 7,740 ops/sec | 3.0× |
| Mixed 80/20 read/write | 96,051 ops/sec | 11,824 ops/sec | 8.1× |

SQLite is faster per-query because it executes as function calls within the same process (~0.02ms), while PostgreSQL requires inter-process communication via Unix socket (~0.10ms).

### Postgres concurrent scaling

| Connections | Ops/sec |
|---|---|
| 1 | 8,321 |
| 4 | 23,290 |
| 8 | 31,856 |
| 16 | 35,370 |
| 32 | 24,371 |

PostgreSQL peaks at ~35K ops/sec with 16 concurrent connections — exceeding SQLite's ~23K. When your application has many simultaneous writers, PostgreSQL's multi-process architecture delivers higher aggregate throughput.

### Latency (p50)

| Scenario | SQLite | Postgres (native) |
|---|---|---|
| Sequential inserts | 0.023ms | 0.096ms |
| Mixed 80/20 | 0.003ms | 0.070ms |

## How to reproduce

**Prerequisites:** [Bun](https://bun.sh/), PostgreSQL (native installation)

```bash
# Install dependencies
bun install

# Install PostgreSQL via Homebrew (if not already installed)
brew install postgresql@17
brew services start postgresql@17

# Create the benchmark user and database
createuser -s bench
createdb -O bench bench
psql -d bench -c "ALTER USER bench WITH PASSWORD 'bench';"

# Run all benchmarks
bun run bench:all

# Results are saved to results/latest.md and results/latest.json

# Individual benchmarks
bun run bench:sqlite
bun run bench:postgres
```

## What this does NOT measure

- Network latency to a remote Postgres instance (would further favor SQLite)
- Postgres-specific features (pgvector, PostGIS, LISTEN/NOTIFY, row-level security)
- Multi-server write concurrency (SQLite is single-machine; Postgres can accept writes from multiple app servers)
- Very large datasets (billions of rows)
- Complex queries (JOINs, aggregations, full-text search)

These are all legitimate reasons to choose Postgres. They're about capabilities, not throughput.

## License

MIT
