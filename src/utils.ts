import { execFileSync } from 'child_process'
import os from 'os'

// --- Types ---

export type LatencyStats = {
	p50: number
	p95: number
	p99: number
	min: number
	max: number
	mean: number
}

export type BenchmarkResult = {
	scenario: string
	database: string
	opsPerSec: number
	totalOps: number
	durationMs: number
	latency: LatencyStats
	concurrency: number
}

// --- Latency calculation ---

export const computeLatencyStats = (latencies: number[]): LatencyStats => {
	const sorted = [...latencies].sort((a, b) => a - b)
	const len = sorted.length
	return {
		p50: sorted[Math.floor(len * 0.5)] ?? 0,
		p95: sorted[Math.floor(len * 0.95)] ?? 0,
		p99: sorted[Math.floor(len * 0.99)] ?? 0,
		min: sorted[0] ?? 0,
		max: sorted[len - 1] ?? 0,
		mean: sorted.reduce((sum, v) => sum + v, 0) / len,
	}
}

// --- Timing ---

export const nowMs = (): number => performance.now()

// --- Machine info ---

export const getMachineInfo = (): Record<string, string> => {
	const cpus = os.cpus()
	const cpuModel = cpus[0]?.model ?? 'unknown'
	const cpuCount = cpus.length
	const totalMemGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1)
	const platform = os.platform()
	const arch = os.arch()
	const osRelease = os.release()

	let bunVersion = 'unknown'
	try {
		bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf-8' }).trim()
	} catch {
		/* ignore */
	}

	let pgVersion = 'unknown'
	try {
		const raw = execFileSync('psql', ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
		const match = raw.match(/(\d+[\d.]*)/)
		pgVersion = match ? match[1]! : raw
	} catch {
		try {
			pgVersion = execFileSync('docker', ['exec', 'sqlite-vs-postgres-benchmark-postgres-1', 'psql', '-U', 'bench', '-t', '-c', 'SELECT version()'], {
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe'],
			}).trim()
		} catch {
			/* ignore */
		}
	}

	return {
		cpu: `${cpuModel} (${cpuCount} cores)`,
		memory: `${totalMemGB} GB`,
		os: `${platform} ${arch} ${osRelease}`,
		bun: bunVersion,
		postgres: pgVersion,
	}
}

// --- Result formatting ---

export const formatResultsTable = (results: BenchmarkResult[]): string => {
	const header = '| Scenario | Database | Concurrency | Ops/sec | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) |'
	const separator = '|----------|----------|-------------|---------|----------|----------|----------|-----------|'
	const rows = results.map(
		(r) =>
			`| ${r.scenario} | ${r.database} | ${r.concurrency} | ${r.opsPerSec.toLocaleString()} | ${r.latency.p50.toFixed(3)} | ${r.latency.p95.toFixed(3)} | ${r.latency.p99.toFixed(3)} | ${r.latency.mean.toFixed(3)} |`,
	)
	return [header, separator, ...rows].join('\n')
}

// --- Constants ---

export const WARMUP_OPS = 500
export const DEFAULT_OPS = 10_000
export const BATCH_SIZES = [1, 100, 1000] as const
export const CONCURRENCY_LEVELS = [1, 4, 8, 16, 32] as const

// --- Shared test data ---

export const ROW = {
	name: 'Jane Doe',
	email: 'jane@example.com',
	age: 30,
	bio: 'A short biography that represents a typical text field in a web application row.',
}

// --- ANSI terminal formatting ---

export const ansi = {
	bold: (s: string): string => `\x1b[1m${s}\x1b[0m`,
	dim: (s: string): string => `\x1b[2m${s}\x1b[0m`,
	yellow: (s: string): string => `\x1b[33m${s}\x1b[0m`,
}

export const formatInlineResult = (scenario: string, opsPerSec: number): string =>
	`    ${scenario.padEnd(30)}${opsPerSec.toLocaleString().padStart(10)} ops/sec`
