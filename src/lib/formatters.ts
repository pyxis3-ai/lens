export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d`
  if (h > 0) return `${h}h`
  return `${m}m`
}

export function formatRate(bps: number): string {
  if (bps < 1024) return `${bps}B/s`
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)}K/s`
  return `${(bps / 1048576).toFixed(1)}M/s`
}

export function podSymbol(status: string, ready: boolean): string {
  if (status === 'Running' && ready) return '\u25CF'
  if (status === 'Running') return '\u25D0'
  if (status === 'Succeeded') return '\u2713'
  if (status === 'Pending') return '\u25CC'
  return '\u2715'
}

export function podColor(status: string, ready: boolean): string {
  if (status === 'Running' && ready) return 'text-emerald-400'
  if (status === 'Running') return 'text-amber-400'
  if (status === 'Succeeded') return 'text-zinc-500'
  return 'text-red-400'
}

export function httpStatusColor(status: number): string {
  if (status === 403 || status === 444) return 'text-red-400'
  if (status === 404) return 'text-amber-400'
  if (status === 429) return 'text-orange-400'
  if (status >= 500) return 'text-red-500'
  return 'text-zinc-500'
}

export function httpStatusCategoryColor(status: string): string {
  if (status.startsWith('2')) return 'text-emerald-400'
  if (status.startsWith('3')) return 'text-blue-400'
  if (status.startsWith('4')) return 'text-amber-400'
  return 'text-red-400'
}

export function barColor(pct: number, warn = 70, crit = 85): string {
  if (pct >= crit) return 'bg-red-500'
  if (pct >= warn) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function metricColor(pct: number, warn = 70, crit = 85): string {
  if (pct > crit) return 'text-red-400'
  if (pct > warn) return 'text-amber-400'
  return 'text-emerald-400'
}

export function logLineColor(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('fatal') || l.includes('panic')) return 'text-red-400'
  if (l.includes('warn')) return 'text-amber-400'
  if (l.includes('info')) return 'text-zinc-400'
  if (l.includes('debug')) return 'text-zinc-600'
  return 'text-zinc-400'
}

export function daysUntil(date: string): number {
  return Math.floor((new Date(date).getTime() - Date.now()) / 86400_000)
}
