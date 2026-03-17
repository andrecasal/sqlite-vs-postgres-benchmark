import { writeFileSync, mkdirSync } from 'fs'
import { runSqliteBenchmarks } from './sqlite-bench.ts'
import { runPostgresBenchmarks, PG_CONFIG } from './postgres-bench.ts'
import { formatResultsTable, getMachineInfo, ansi, type BenchmarkResult } from './utils.ts'

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

// --- Markdown report (saved to file) ---

const generateMarkdownReport = (
	machine: Record<string, string>,
	sqliteResults: BenchmarkResult[],
	pgResults: BenchmarkResult[],
	pgLabel: string,
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

	lines.push(`## ${pgLabel} Results`)
	lines.push('')
	lines.push(formatResultsTable(pgResults))
	lines.push('')

	// Head-to-head comparison
	lines.push(`## Head-to-Head: SQLite vs ${pgLabel}`)
	lines.push('')
	lines.push('| Scenario | Concurrency | SQLite ops/sec | Postgres ops/sec | Ratio (SQLite/PG) |')
	lines.push('|----------|-------------|----------------|------------------|--------------------|')

	for (const sr of sqliteResults) {
		const pg = pgResults.find((p) => p.scenario === sr.scenario && p.concurrency === sr.concurrency)
		if (pg) {
			const ratio = sr.opsPerSec / pg.opsPerSec
			lines.push(`| ${sr.scenario} | ${sr.concurrency} | ${sr.opsPerSec.toLocaleString()} | ${pg.opsPerSec.toLocaleString()} | ${ratio.toFixed(2)}x |`)
		}
	}
	lines.push('')

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
	lines.push('### PostgreSQL')
	lines.push('- Homebrew PostgreSQL 17, data on macOS APFS (SSD)')
	lines.push('- `shared_buffers = 256MB`')
	lines.push('- `synchronous_commit = on`')
	lines.push('- `max_connections = 200`')
	lines.push('- `work_mem = 16MB`')
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

	let pgResults: BenchmarkResult[] = []
	try {
		pgResults = await runPostgresBenchmarks(PG_CONFIG)
	} catch {
		// PostgreSQL not available
	}

	// Formatted comparison
	if (pgResults.length > 0) {
		printComparison(PG_CONFIG.label, sqliteResults, pgResults)
	}

	// Save results
	mkdirSync('results', { recursive: true })
	const isoTimestamp = new Date().toISOString()
	const timestamp = isoTimestamp.replace(/[:.]/g, '-')
	const allResults = [...sqliteResults, ...pgResults]
	const output = {
		timestamp: isoTimestamp,
		machine: machineInfo,
		results: allResults,
	}

	writeFileSync(`results/benchmark-${timestamp}.json`, JSON.stringify(output, null, 2))

	const report = generateMarkdownReport(machineInfo, sqliteResults, pgResults, PG_CONFIG.label)
	writeFileSync(`results/benchmark-${timestamp}.md`, report)
	writeFileSync('results/latest.md', report)
	writeFileSync('results/latest.json', JSON.stringify(output, null, 2))

	console.log('')
	console.log(`  ${ansi.dim(`Saved → results/benchmark-${timestamp}.md`)}`)
	console.log('')
}

main()
