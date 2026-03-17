import { writeFileSync, mkdirSync } from 'fs'
import { runSqliteBenchmarks } from './sqlite-bench.ts'
import { runPostgresBenchmarks, PG_CONFIGS } from './postgres-bench.ts'
import { formatResultsTable, getMachineInfo, ansi, type BenchmarkResult } from './utils.ts'

type PgResultSet = { label: string; results: BenchmarkResult[] }

// --- Formatted terminal comparison ---

const printComparison = (
	pgLabel: string,
	sqliteResults: BenchmarkResult[],
	pgResults: BenchmarkResult[],
): void => {
	const singleSqlite = sqliteResults.filter(r => r.concurrency === 1)

	// Head-to-head
	console.log('')
	console.log(`  ${ansi.bold(`Head-to-Head: SQLite vs ${pgLabel}`)}`)
	console.log(`  ${ansi.dim('Single connection · ops/sec · higher is better')}`)
	console.log('')
	console.log(`  ${''.padEnd(30)}${ansi.dim('SQLite'.padStart(12))}${ansi.dim('Postgres'.padStart(12))}${ansi.dim('Ratio'.padStart(10))}`)
	console.log(`  ${ansi.dim('─'.repeat(64))}`)

	for (const sr of singleSqlite) {
		const pg = pgResults.find(p => p.scenario === sr.scenario && p.concurrency === 1)
		if (!pg) continue
		const ratio = sr.opsPerSec / pg.opsPerSec
		console.log(
			`  ${sr.scenario.padEnd(30)}${sr.opsPerSec.toLocaleString().padStart(12)}${pg.opsPerSec.toLocaleString().padStart(12)}${(ratio.toFixed(1) + '×').padStart(10)}`,
		)
	}

	// Concurrent scaling
	const concurrent = pgResults.filter(r => r.scenario === 'Concurrent inserts')
	if (concurrent.length > 0) {
		const peak = concurrent.reduce((max, r) => (r.opsPerSec > max.opsPerSec ? r : max), concurrent[0]!)
		const sqliteSeq = sqliteResults.find(r => r.scenario === 'Sequential inserts')

		console.log('')
		console.log(`  ${ansi.bold('PostgreSQL Concurrent Scaling')}`)
		console.log(`  ${ansi.dim('ops/sec by number of concurrent writers')}`)
		console.log('')
		console.log(
			`  ${'Writers'.padEnd(12)}${concurrent.map(r => String(r.concurrency).padStart(9)).join('')}`,
		)
		console.log(
			`  ${'Ops/sec'.padEnd(12)}${concurrent
				.map(r => {
					const formatted = r.opsPerSec.toLocaleString().padStart(9)
					return r === peak ? ansi.bold(formatted) : formatted
				})
				.join('')}`,
		)

		if (sqliteSeq) {
			console.log('')
			console.log(`  ${ansi.dim(`SQLite single-writer: ${sqliteSeq.opsPerSec.toLocaleString()} ops/sec`)}`)
			const crossover = concurrent.find(r => r.opsPerSec > sqliteSeq.opsPerSec)
			if (crossover) {
				console.log(`  ${ansi.dim(`PostgreSQL overtakes at ${crossover.concurrency}+ concurrent connections`)}`)
			}
		}
	}

	// Latency
	console.log('')
	console.log(`  ${ansi.bold('Latency')} ${ansi.dim('p50 · lower is better')}`)
	console.log('')
	console.log(`  ${''.padEnd(30)}${ansi.dim('SQLite'.padStart(12))}${ansi.dim('Postgres'.padStart(12))}`)
	console.log(`  ${ansi.dim('─'.repeat(54))}`)

	for (const sr of singleSqlite) {
		const pg = pgResults.find(p => p.scenario === sr.scenario && p.concurrency === 1)
		if (!pg) continue
		console.log(
			`  ${sr.scenario.padEnd(30)}${(sr.latency.p50.toFixed(3) + 'ms').padStart(12)}${(pg.latency.p50.toFixed(3) + 'ms').padStart(12)}`,
		)
	}
}

const printDockerOverhead = (
	nativeResults: BenchmarkResult[],
	dockerResults: BenchmarkResult[],
): void => {
	console.log('')
	console.log(`  ${ansi.bold('Docker Overhead')} ${ansi.dim('native SSD vs Docker tmpfs')}`)
	console.log('')
	console.log(`  ${''.padEnd(30)}${ansi.dim('Native'.padStart(12))}${ansi.dim('Docker'.padStart(12))}${ansi.dim('Overhead'.padStart(14))}`)
	console.log(`  ${ansi.dim('─'.repeat(68))}`)

	for (const nr of nativeResults.filter(r => r.concurrency === 1)) {
		const dr = dockerResults.find(d => d.scenario === nr.scenario && d.concurrency === nr.concurrency)
		if (!dr) continue
		const overhead = ((nr.opsPerSec - dr.opsPerSec) / nr.opsPerSec) * 100
		console.log(
			`  ${nr.scenario.padEnd(30)}${nr.opsPerSec.toLocaleString().padStart(12)}${dr.opsPerSec.toLocaleString().padStart(12)}${ansi.yellow((overhead.toFixed(0) + '% slower').padStart(14))}`,
		)
	}
}

// --- Markdown report (saved to file) ---

const generateMarkdownReport = (
	machine: Record<string, string>,
	sqliteResults: BenchmarkResult[],
	pgResultSets: PgResultSet[],
): string => {
	const lines: string[] = []

	lines.push('# SQLite vs PostgreSQL Benchmark Results')
	lines.push('')
	lines.push('## Machine')
	lines.push('')
	for (const [key, value] of Object.entries(machine)) {
		lines.push(`- **${key}**: ${value}`)
	}
	lines.push('')

	lines.push('## SQLite Results (WAL mode, file on SSD)')
	lines.push('')
	lines.push(formatResultsTable(sqliteResults))
	lines.push('')

	for (const pgSet of pgResultSets) {
		lines.push(`## ${pgSet.label} Results`)
		lines.push('')
		lines.push(formatResultsTable(pgSet.results))
		lines.push('')
	}

	// Head-to-head comparison for each PG config
	for (const pgSet of pgResultSets) {
		lines.push(`## Head-to-Head: SQLite vs ${pgSet.label}`)
		lines.push('')
		lines.push('| Scenario | Concurrency | SQLite ops/sec | Postgres ops/sec | Ratio (SQLite/PG) |')
		lines.push('|----------|-------------|----------------|------------------|--------------------|')

		for (const sr of sqliteResults) {
			const pg = pgSet.results.find((p) => p.scenario === sr.scenario && p.concurrency === sr.concurrency)
			if (pg) {
				const ratio = sr.opsPerSec / pg.opsPerSec
				lines.push(`| ${sr.scenario} | ${sr.concurrency} | ${sr.opsPerSec.toLocaleString()} | ${pg.opsPerSec.toLocaleString()} | ${ratio.toFixed(2)}x |`)
			}
		}
		lines.push('')
	}

	// Docker overhead comparison if both PG configs present
	const native = pgResultSets.find(s => s.label.includes('native'))
	const docker = pgResultSets.find(s => s.label.includes('Docker'))
	if (native && docker) {
		lines.push('## Docker Overhead')
		lines.push('')
		lines.push(`| Scenario | ${native.label} ops/sec | ${docker.label} ops/sec | Docker overhead |`)
		lines.push('|----------|----------------|------------------|--------------------|')

		for (const nr of native.results) {
			const dr = docker.results.find((d) => d.scenario === nr.scenario && d.concurrency === nr.concurrency)
			if (dr) {
				const overhead = (((nr.opsPerSec - dr.opsPerSec) / nr.opsPerSec) * 100).toFixed(1)
				lines.push(`| ${nr.scenario} (c=${nr.concurrency}) | ${nr.opsPerSec.toLocaleString()} | ${dr.opsPerSec.toLocaleString()} | ${overhead}% slower |`)
			}
		}
		lines.push('')
	}

	lines.push('## Configuration')
	lines.push('')
	lines.push('### SQLite')
	lines.push('- File on macOS APFS (SSD)')
	lines.push('- `PRAGMA journal_mode = WAL`')
	lines.push('- `PRAGMA synchronous = NORMAL`')
	lines.push('- `PRAGMA cache_size = -64000` (64MB)')
	lines.push('- `PRAGMA mmap_size = 268435456` (256MB)')
	lines.push('- `PRAGMA busy_timeout = 5000`')
	lines.push('')
	lines.push('### PostgreSQL (native)')
	lines.push('- Homebrew PostgreSQL 17, data on macOS APFS (SSD)')
	lines.push('- `shared_buffers = 256MB`')
	lines.push('- `synchronous_commit = on`')
	lines.push('- `max_connections = 200`')
	lines.push('- `work_mem = 16MB`')
	lines.push('')
	lines.push('### PostgreSQL (Docker)')
	lines.push('- Docker container (postgres:17)')
	lines.push('- Same PostgreSQL settings as native')
	lines.push('- Data on tmpfs (RAM disk)')
	lines.push('')

	return lines.join('\n')
}

// --- Main ---

const main = async (): Promise<void> => {
	const machineInfo = getMachineInfo()
	console.log('')
	console.log(`  ${ansi.bold('SQLite vs PostgreSQL Benchmark')}`)
	console.log(`  ${ansi.dim(`${machineInfo.cpu} · ${machineInfo.memory} · Bun ${machineInfo.bun}`)}`)

	// Run benchmarks
	const sqliteResults = runSqliteBenchmarks()

	const pgResultSets: PgResultSet[] = []
	for (const config of PG_CONFIGS) {
		try {
			const results = await runPostgresBenchmarks(config)
			pgResultSets.push({ label: config.label, results })
		} catch {
			// Silently skip unavailable configs
		}
	}

	// Formatted comparison
	if (pgResultSets.length > 0) {
		const primaryPg = pgResultSets[0]!
		printComparison(primaryPg.label, sqliteResults, primaryPg.results)

		const native = pgResultSets.find(s => s.label.includes('native'))
		const docker = pgResultSets.find(s => s.label.includes('Docker'))
		if (native && docker) {
			printDockerOverhead(native.results, docker.results)
		}
	}

	// Save results
	mkdirSync('results', { recursive: true })
	const isoTimestamp = new Date().toISOString()
	const timestamp = isoTimestamp.replace(/[:.]/g, '-')
	const allPgResults = pgResultSets.flatMap(s => s.results)
	const allResults = [...sqliteResults, ...allPgResults]
	const output = {
		timestamp: isoTimestamp,
		machine: machineInfo,
		results: allResults,
	}

	writeFileSync(`results/benchmark-${timestamp}.json`, JSON.stringify(output, null, 2))

	const report = generateMarkdownReport(machineInfo, sqliteResults, pgResultSets)
	writeFileSync(`results/benchmark-${timestamp}.md`, report)
	writeFileSync('results/latest.md', report)
	writeFileSync('results/latest.json', JSON.stringify(output, null, 2))

	console.log('')
	console.log(`  ${ansi.dim(`Saved → results/benchmark-${timestamp}.md`)}`)
	console.log('')
}

main()
