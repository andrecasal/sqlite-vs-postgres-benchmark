import postgres from 'postgres'
import { computeLatencyStats, nowMs, DEFAULT_OPS, BATCH_SIZES, CONCURRENCY_LEVELS, ROW, formatResultLine, type BenchmarkResult } from './utils.ts'

// --- Setup ---

const PG_DOCKER_URL = 'postgres://bench:bench@localhost:5433/bench'
const PG_NATIVE_URL = 'postgres://bench:bench@localhost:5432/bench'

type PgConfig = {
	url: string
	label: string
}

const createSql = (url: string): ReturnType<typeof postgres> => {
	return postgres(url, { max: 50 })
}

const setupTable = async (sql: ReturnType<typeof postgres>): Promise<void> => {
	await sql`DROP TABLE IF EXISTS users`
	await sql`
		CREATE TABLE users (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT NOT NULL,
			age INTEGER NOT NULL,
			bio TEXT,
			created_at TIMESTAMPTZ DEFAULT now()
		)
	`
	await sql`CREATE INDEX idx_users_email ON users(email)`
}


// --- Scenario 1: Sequential single-row inserts ---

const benchSequentialInserts = async (sql: ReturnType<typeof postgres>, ops: number, label: string): Promise<BenchmarkResult> => {
	await setupTable(sql)

	const latencies: number[] = []
	const start = nowMs()
	for (let i = 0; i < ops; i++) {
		const opStart = nowMs()
		await sql`INSERT INTO users (name, email, age, bio) VALUES (${ROW.name}, ${`user${i}@example.com`}, ${ROW.age}, ${ROW.bio})`
		latencies.push(nowMs() - opStart)
	}
	const durationMs = nowMs() - start

	return {
		scenario: 'Sequential inserts',
		database: label,
		opsPerSec: Math.round((ops / durationMs) * 1000),
		totalOps: ops,
		durationMs: Math.round(durationMs),
		latency: computeLatencyStats(latencies),
		concurrency: 1,
	}
}

// --- Scenario 2: Batched inserts (N rows per transaction) ---

const benchBatchedInserts = async (sql: ReturnType<typeof postgres>, batchSize: number, totalOps: number, label: string): Promise<BenchmarkResult> => {
	await setupTable(sql)
	const batches = Math.ceil(totalOps / batchSize)

	const latencies: number[] = []
	let rowIdx = 0
	const start = nowMs()

	for (let b = 0; b < batches; b++) {
		const opStart = nowMs()
		const count = Math.min(batchSize, totalOps - b * batchSize)

		await sql.begin(async (tx) => {
			for (let i = 0; i < count; i++) {
				await tx`INSERT INTO users (name, email, age, bio) VALUES (${ROW.name}, ${`user${rowIdx++}@example.com`}, ${ROW.age}, ${ROW.bio})`
			}
		})

		latencies.push(nowMs() - opStart)
	}
	const durationMs = nowMs() - start

	return {
		scenario: `Batched inserts (${batchSize}/txn)`,
		database: label,
		opsPerSec: Math.round((totalOps / durationMs) * 1000),
		totalOps,
		durationMs: Math.round(durationMs),
		latency: computeLatencyStats(latencies),
		concurrency: 1,
	}
}

// --- Scenario 3: Concurrent writers ---

const benchConcurrentInserts = async (sql: ReturnType<typeof postgres>, concurrency: number, totalOps: number, label: string): Promise<BenchmarkResult> => {
	await setupTable(sql)
	const opsPerWorker = Math.ceil(totalOps / concurrency)

	const allLatencies: number[][] = Array.from({ length: concurrency }, () => [])

	const start = nowMs()

	const workers = Array.from({ length: concurrency }, (_, workerId) =>
		(async () => {
			for (let i = 0; i < opsPerWorker; i++) {
				const globalIdx = workerId * opsPerWorker + i
				if (globalIdx >= totalOps) break
				const opStart = nowMs()
				await sql`INSERT INTO users (name, email, age, bio) VALUES (${ROW.name}, ${`user${globalIdx}@example.com`}, ${ROW.age}, ${ROW.bio})`
				allLatencies[workerId]!.push(nowMs() - opStart)
			}
		})(),
	)

	await Promise.all(workers)
	const durationMs = nowMs() - start

	const flatLatencies = allLatencies.flat()

	return {
		scenario: 'Concurrent inserts',
		database: label,
		opsPerSec: Math.round((totalOps / durationMs) * 1000),
		totalOps,
		durationMs: Math.round(durationMs),
		latency: computeLatencyStats(flatLatencies),
		concurrency,
	}
}

// --- Scenario 4: Mixed read/write (80% reads, 20% writes) ---

const benchMixedReadWrite = async (sql: ReturnType<typeof postgres>, totalOps: number, label: string): Promise<BenchmarkResult> => {
	await setupTable(sql)

	// Seed data in a single transaction
	await sql.begin(async (tx) => {
		for (let i = 0; i < 10_000; i++) {
			await tx`INSERT INTO users (name, email, age, bio) VALUES (${ROW.name}, ${`seed${i}@example.com`}, ${ROW.age}, ${ROW.bio})`
		}
	})

	const latencies: number[] = []
	let writeIdx = 10_000
	const start = nowMs()

	for (let i = 0; i < totalOps; i++) {
		const isWrite = i % 5 === 0
		const opStart = nowMs()
		if (isWrite) {
			await sql`INSERT INTO users (name, email, age, bio) VALUES (${ROW.name}, ${`user${writeIdx++}@example.com`}, ${ROW.age}, ${ROW.bio})`
		} else {
			const id = Math.floor(Math.random() * writeIdx) + 1
			await sql`SELECT * FROM users WHERE id = ${id}`
		}
		latencies.push(nowMs() - opStart)
	}

	const durationMs = nowMs() - start

	return {
		scenario: 'Mixed 80/20 read/write',
		database: label,
		opsPerSec: Math.round((totalOps / durationMs) * 1000),
		totalOps,
		durationMs: Math.round(durationMs),
		latency: computeLatencyStats(latencies),
		concurrency: 1,
	}
}

// --- Run all ---

export const PG_CONFIGS: PgConfig[] = [
	{ url: PG_NATIVE_URL, label: 'PostgreSQL (native, SSD)' },
	{ url: PG_DOCKER_URL, label: 'PostgreSQL (Docker, tmpfs)' },
]

export const runPostgresBenchmarks = async (config: PgConfig): Promise<BenchmarkResult[]> => {
	console.log(`\n=== ${config.label} Benchmarks ===\n`)
	const sql = createSql(config.url)
	const results: BenchmarkResult[] = []

	console.log('Running: Sequential inserts...')
	results.push(await benchSequentialInserts(sql, DEFAULT_OPS, config.label))

	for (const batchSize of BATCH_SIZES) {
		if (batchSize === 1) continue
		console.log(`Running: Batched inserts (${batchSize}/txn)...`)
		results.push(await benchBatchedInserts(sql, batchSize, DEFAULT_OPS, config.label))
	}

	for (const c of CONCURRENCY_LEVELS) {
		console.log(`Running: Concurrent inserts (${c} writers)...`)
		results.push(await benchConcurrentInserts(sql, c, DEFAULT_OPS, config.label))
	}

	console.log('Running: Mixed 80/20 read/write...')
	results.push(await benchMixedReadWrite(sql, DEFAULT_OPS, config.label))

	await sql.end()
	return results
}

// Allow standalone execution
if (import.meta.main) {
	const config = process.argv.includes('--docker')
		? PG_CONFIGS[1]!
		: PG_CONFIGS[0]!
	const results = await runPostgresBenchmarks(config)
	for (const r of results) {
		console.log(formatResultLine(r))
	}
}
