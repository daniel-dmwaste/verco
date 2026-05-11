/**
 * Tiny argv parser for --flag=value and --flag styles.
 * Avoids adding a dependency for what's a handful of flags per script.
 */
export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq === -1) {
      out[arg.slice(2)] = true
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1)
    }
  }
  return out
}

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}
