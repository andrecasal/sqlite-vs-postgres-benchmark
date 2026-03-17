import { Database } from 'bun:sqlite'
import { mkdirSync, unlinkSync } from 'fs'
import { computeLatencyStats, nowMs, WARMUP_OPS, DEFAULT_OPS, BATCH_SIZES, ROW, ansi, formatInlineResult, type BenchmarkResult } from './utils.ts'

// --- Setup ---

const createDb = (path: string): Database => {
	const db = new Database(path)
	db.run('PRAGMA journal_mode = WAL')
	db.run('PRAGMA synchronous = NORMAL')
	db.run('PRAGMA cache_size = -64000') // 64MB
	db.run('PRAGMA mmap_size = 268435456') // 256MB
	db.run('PRAGMA busy_timeout = 5000')
	db.run('PRAGMA wal_autocheckpoint = 1000')
	createUsersTable(db)
	return db
}

const createUsersTable = (db: Database): void => {
	db.run(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT NOT NULL,
			age INTEGER NOT NULL,
			bio TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		)
	`)
	db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)')
}

const resetTable = (db: Database): void => {
	db.run('DROP TABLE IF EXISTS users')
	createUsersTable(db)
}

const DB_DIR = '/tmp/sqlite-bench'
const cleanupDb = (prefix: string): void => {
	for (const suffix of ['', '-wal', '-shm']) {
		try {
			unlinkSync(`${DB_DIR}/${prefix}.db${suffix}`)
		} catch {
			/* ignore */
		}
	}
}

const mkDbDir = (): void => {
	try {
		mkdirSync(DB_DIR, { recursive: true })
	} catch {
		/* ignore */
	}
}

// --- Scenario 1: Sequential single-row inserts ---

const benchSequentialInserts = (ops: number): BenchmarkResult => {
	mkDbDir()
	cleanupDb('sequential')
	const db = createDb(`${DB_DIR}/sequential.db`)
	const stmt = db.prepare('INSERT INTO users (name, email, age, bio) VALUES ($name, $email, $age, $bio)')

	// Warmup
	for (let i = 0; i < WARMUP_OPS; i++) stmt.run({ $name: ROW.name, $email: `warmup${i}@example.com`, $age: ROW.age, $bio: ROW.bio })
	resetTable(db)
	const freshStmt = db.prepare('INSERT INTO users (name, email, age, bio) VALUES ($name, $email, $age, $bio)')

	const latencies: number[] = []
	const start = nowMs()
	for (let i = 0; i < ops; i++) {
		const opStart = nowMs()
		freshStmt.run({ $name: ROW.name, $email: `user${i}@example.com`, $age: ROW.age, $bio: ROW.bio })
		latencies.push(nowMs() - opStart)
	}
	const durationMs = nowMs() - start

	db.close()
	cleanupDb('sequential')
	return {
		scenario: 'Sequential inserts',
		database: 'SQLite (WAL, file)',
		opsPerSec: Math.round((ops / durationMs) * 1000),
		totalOps: ops,
		durationMs: Math.round(durationMs),
		latency: computeLatencyStats(latencies),
		concurrency: 1,
	}
}

// --- Scenario 2: Batched inserts (N rows per transaction) ---

const benchBatchedInserts = (batchSize: number, totalOps: number): BenchmarkResult => {
	const prefix = `batched-${batchSize}`
	cleanupDb(prefix)
	const db = createDb(`${DB_DIR}/${prefix}.db`)
	const stmt = db.prepare('INSERT INTO users (name, email, age, bio) VALUES ($name, $email, $age, $bio)')
	const batches = Math.ceil(totalOps / batchSize)

	const latencies: number[] = []
	const start = nowMs()
	let rowIdx = 0
	for (let b = 0; b < batches; b++) {
		const opStart = nowMs()
		db.run('BEGIN IMMEDIATE')
		const count = Math.min(batchSize, totalOps - b * batchSize)
		for (let i = 0; i < count; i++) {
			stmt.run({ $name: ROW.name, $email: `user${rowIdx++}@example.com`, $age: ROW.age, $bio: ROW.bio })
		}
		db.run('COMMIT')
		latencies.push(nowMs() - opStart)
	}
	const durationMs = nowMs() - start

	db.close()
	cleanupDb(prefix)
	return {
		scenario: `Batched inserts (${batchSize}/txn)`,
		database: 'SQLite (WAL, file)',
		opsPerSec: Math.round((totalOps / durationMs) * 1000),
		totalOps,
		durationMs: Math.round(durationMs),
		latency: computeLatencyStats(latencies),
		concurrency: 1,
	}
}

// --- Scenario 3: Mixed read/write (80% reads, 20% writes) ---

const benchMixedReadWrite = (totalOps: number): BenchmarkResult => {
	cleanupDb('mixed')
	const db = createDb(`${DB_DIR}/mixed.db`)
	const insertStmt = db.prepare('INSERT INTO users (name, email, age, bio) VALUES ($name, $email, $age, $bio)')
	const selectStmt = db.prepare('SELECT * FROM users WHERE id = $id')

	// Seed some data
	db.run('BEGIN')
	for (let i = 0; i < 10_000; i++) {
		insertStmt.run({ $name: ROW.name, $email: `seed${i}@example.com`, $age: ROW.age, $bio: ROW.bio })
	}
	db.run('COMMIT')

	const latencies: number[] = []
	let writeIdx = 10_000
	const start = nowMs()

	for (let i = 0; i < totalOps; i++) {
		const isWrite = i % 5 === 0 // 20% writes
		const opStart = nowMs()
		if (isWrite) {
			insertStmt.run({ $name: ROW.name, $email: `user${writeIdx++}@example.com`, $age: ROW.age, $bio: ROW.bio })
		} else {
			const id = Math.floor(Math.random() * writeIdx) + 1
			selectStmt.get({ $id: id })
		}
		latencies.push(nowMs() - opStart)
	}

	const durationMs = nowMs() - start
	db.close()
	cleanupDb('mixed')

	return {
		scenario: 'Mixed 80/20 read/write',
		database: 'SQLite (WAL, file)',
		opsPerSec: Math.round((totalOps / durationMs) * 1000),
		totalOps,
		durationMs: Math.round(durationMs),
		latency: computeLatencyStats(latencies),
		concurrency: 1,
	}
}

// --- Run all ---

export const runSqliteBenchmarks = (): BenchmarkResult[] => {
	console.log(`\n  ${ansi.bold('SQLite')} ${ansi.dim('(WAL, file on SSD)')}`)
	const results: BenchmarkResult[] = []

	const seqResult = benchSequentialInserts(DEFAULT_OPS)
	console.log(formatInlineResult(seqResult.scenario, seqResult.opsPerSec))
	results.push(seqResult)

	for (const batchSize of BATCH_SIZES) {
		if (batchSize === 1) continue
		const batchResult = benchBatchedInserts(batchSize, DEFAULT_OPS)
		console.log(formatInlineResult(batchResult.scenario, batchResult.opsPerSec))
		results.push(batchResult)
	}

	const mixedResult = benchMixedReadWrite(DEFAULT_OPS)
	console.log(formatInlineResult(mixedResult.scenario, mixedResult.opsPerSec))
	results.push(mixedResult)

	return results
}

// Allow standalone execution
if (import.meta.main) {
	runSqliteBenchmarks()
}
