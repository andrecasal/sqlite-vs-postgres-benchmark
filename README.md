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

The benchmark runs PostgreSQL in two configurations to isolate Docker overhead from actual database performance:

- **SQLite**: File-based (not `:memory:`), WAL mode, `synchronous=NORMAL`, 64MB cache, 256MB mmap. Data on macOS APFS (SSD).
- **PostgreSQL (native)**: Homebrew installation, `shared_buffers=256MB`, `synchronous_commit=on`. Data on same SSD as SQLite.
- **PostgreSQL (Docker)**: Docker container (postgres:17), same PostgreSQL settings. Data on tmpfs (RAM disk).
- **Row schema**: Realistic web app table with `id`, `name`, `email` (indexed), `age`, `bio` (text), `created_at`.
- **Operations**: 10,000 per scenario.
- **Driver**: `bun:sqlite` (built-in) for SQLite, `postgres` (postgres.js) for PostgreSQL.

The native comparison is apples-to-apples (both on SSD). The Docker comparison reveals how much overhead Docker Desktop adds on macOS.

## Results (Apple M2 Pro, 16GB RAM)

### Head-to-head: SQLite vs PostgreSQL native (both on SSD)

| Scenario | SQLite (file, SSD) | Postgres (native, SSD) | Ratio |
|---|---|---|---|
| Sequential inserts | 23,403 ops/sec | 7,740 ops/sec | 3.0× |
| Mixed 80/20 read/write | 96,051 ops/sec | 11,824 ops/sec | 8.1× |

SQLite is faster per-query because it executes as function calls within the same process (~0.02ms), while PostgreSQL requires inter-process communication via Unix socket (~0.10ms).

### Postgres concurrent scaling (native)

| Connections | Ops/sec |
|---|---|
| 1 | 8,321 |
| 4 | 23,290 |
| 8 | 31,856 |
| 16 | 35,370 |
| 32 | 24,371 |

PostgreSQL peaks at ~35K ops/sec with 16 concurrent connections — exceeding SQLite's ~23K. When your application has many simultaneous writers, PostgreSQL's multi-process architecture delivers higher aggregate throughput.

### Docker overhead

| Scenario | Native (SSD) | Docker (tmpfs) | Overhead |
|---|---|---|---|
| Sequential inserts | 7,740 ops/sec | 4,490 ops/sec | 42% slower |
| Batched 100/txn | 19,098 ops/sec | 4,283 ops/sec | 78% slower |
| Mixed 80/20 | 11,824 ops/sec | 3,961 ops/sec | 67% slower |

Docker Desktop on macOS runs PostgreSQL inside a Linux VM, adding ~0.07ms per round-trip. If you've seen benchmarks showing PostgreSQL at ~5,000 ops/sec, Docker overhead is likely the reason. Always benchmark against native installations.

### Latency (p50)

| Scenario | SQLite | Postgres (native) |
|---|---|---|
| Sequential inserts | 0.023ms | 0.096ms |
| Mixed 80/20 | 0.003ms | 0.070ms |

## How to reproduce

**Prerequisites:** [Bun](https://bun.sh/)

```bash
bun install
```

### Option A: Native PostgreSQL + Docker PostgreSQL (recommended)

This runs both configurations and produces a Docker overhead comparison.

```bash
# Install PostgreSQL via Homebrew (if not already installed)
brew install postgresql@17
brew services start postgresql@17

# Create the benchmark user and database
createuser -s bench
createdb -O bench bench
psql -d bench -c "ALTER USER bench WITH PASSWORD 'bench';"

# Start Docker PostgreSQL
bun run pg:up

# Run all benchmarks (SQLite + native PostgreSQL + Docker PostgreSQL)
bun run bench:all

# Results are saved to results/latest.md and results/latest.json

# Cleanup
bun run pg:down
brew services stop postgresql@17  # optional
```

### Option B: Docker PostgreSQL only

If you don't want to install PostgreSQL natively, the benchmark will skip the native configuration automatically.

```bash
bun run pg:up
bun run bench:all
bun run pg:down
```

### Option C: SQLite only

```bash
bun run bench:sqlite
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
