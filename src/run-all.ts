import { writeFileSync, mkdirSync } from 'fs'
import { runSqliteBenchmarks } from './sqlite-bench.ts'
import { runPostgresBenchmarks, PG_CONFIGS } from './postgres-bench.ts'
import { formatResultsTable, getMachineInfo, type BenchmarkResult } from './utils.ts'

const main = async (): Promise<void> => {
	console.log('SQLite vs PostgreSQL Benchmark')
	console.log('==============================\n')

	const machineInfo = getMachineInfo()
	console.log('Machine:')
	for (const [key, value] of Object.entries(machineInfo)) {
		console.log(`  ${key}: ${value}`)
	}

	// Run SQLite benchmarks
	const sqliteResults = runSqliteBenchmarks()

	// Run Postgres benchmarks for each configuration
	const pgResultSets: { label: string; results: BenchmarkResult[] }[] = []
	for (const config of PG_CONFIGS) {
		try {
			const results = await runPostgresBenchmarks(config)
			pgResultSets.push({ label: config.label, results })
		} catch (err) {
			console.log(`\nSkipping ${config.label}: ${err instanceof Error ? err.message : 'connection failed'}`)
		}
	}

	// Combine and format
	const allPgResults = pgResultSets.flatMap((s) => s.results)
	const allResults = [...sqliteResults, ...allPgResults]

	console.log('\n\n=== Combined Results ===\n')
	console.log(formatResultsTable(allResults))

	// Save results
	mkdirSync('results', { recursive: true })
	const isoTimestamp = new Date().toISOString()
	const timestamp = isoTimestamp.replace(/[:.]/g, '-')
	const output = {
		timestamp: isoTimestamp,
		machine: machineInfo,
		results: allResults,
	}

	writeFileSync(`results/benchmark-${timestamp}.json`, JSON.stringify(output, null, 2))

	// Generate markdown report
	const report = generateMarkdownReport(machineInfo, sqliteResults, pgResultSets)
	writeFileSync(`results/benchmark-${timestamp}.md`, report)
	writeFileSync('results/latest.md', report)
	writeFileSync('results/latest.json', JSON.stringify(output, null, 2))

	console.log(`\nResults saved to results/benchmark-${timestamp}.json`)
	console.log('Latest results also saved to results/latest.md')
}

const generateMarkdownReport = (
	machine: Record<string, string>,
	sqliteResults: BenchmarkResult[],
	pgResultSets: { label: string; results: BenchmarkResult[] }[],
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
	if (pgResultSets.length === 2) {
		const native = pgResultSets[0]!
		const docker = pgResultSets[1]!
		lines.push('## Docker Overhead')
		lines.push('')
		lines.push(`| Scenario | ${native.label} ops/sec | ${docker.label} ops/sec | Docker overhead |`)
		lines.push('|----------|----------------|------------------|--------------------|')

		for (const nr of native.results) {
			const dr = docker.results.find((d) => d.scenario === nr.scenario && d.concurrency === nr.concurrency)
			if (dr) {
				const overhead = ((nr.opsPerSec - dr.opsPerSec) / nr.opsPerSec * 100).toFixed(1)
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

main()
