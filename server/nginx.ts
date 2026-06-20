import { k8s } from './k8s'
import { config } from './config'
import { memo } from './cache'
import { bump, topN } from './util'
import type { NginxStats, NginxAttack } from '../src/lib/types'

const fetchLog = memo(config.nginxCacheTTL, async () => {
  const pods = await k8s.podsByLabel(config.nginxNamespace, config.nginxLabel)
  if (!pods.length) return { records: [] as any[], wafBlocks: 0 }
  const raw = await k8s.podLogs(config.nginxNamespace, pods[0], undefined, config.nginxLogLines)
  const records: any[] = []
  for (const line of raw) {
    if (!line.includes('"status":')) continue
    try {
      const j = JSON.parse(line)
      if (typeof j.status === 'number') records.push(j)
    } catch {}
  }
  const wafBlocks = raw.filter(l => l.includes('ModSecurity') && l.includes('Access denied')).length
  return { records, wafBlocks }
})

function aggregate(records: any[], wafBlocks: number): NginxStats {
  const byStatus: Record<string, number> = {}
  const byHost: Record<string, number> = {}
  const ipMap: Record<string, number> = {}
  const pathMap: Record<string, number> = {}
  const uaMap: Record<string, number> = {}
  const tlsVersions: Record<string, number> = {}
  let totalBytes = 0, totalRT = 0, rtCount = 0, totalUpstreamRT = 0, upstreamCount = 0

  for (const j of records) {
    bump(byStatus, String(j.status))
    if (j.host) bump(byHost, j.host)
    if (j.remote) bump(ipMap, j.remote)
    if (j.uri) bump(pathMap, j.uri)
    if (j.ua && j.ua !== '-') bump(uaMap, j.ua)
    if (j.ssl && j.ssl !== '-') bump(tlsVersions, j.ssl)
    if (j.bytes) totalBytes += parseInt(j.bytes) || 0
    const rt = parseFloat(j.rt)
    if (!isNaN(rt)) { totalRT += rt; rtCount++ }
    if (j.upstream_rt && j.upstream_rt !== '-') {
      const urt = parseFloat(j.upstream_rt)
      if (!isNaN(urt)) { totalUpstreamRT += urt; upstreamCount++ }
    }
  }

  return {
    requestsTotal: records.length,
    totalBytes,
    byStatus,
    byHost,
    topIPs: topN(ipMap, 20).map(([ip, count]) => ({ ip, count })),
    topPaths: topN(pathMap, 15).map(([uri, count]) => ({ uri, count })),
    topUAs: topN(uaMap, 10).map(([ua, count]) => ({ ua, count })),
    avgResponseTime: rtCount ? Math.round((totalRT / rtCount) * 1000) : 0,
    avgUpstreamTime: upstreamCount ? Math.round((totalUpstreamRT / upstreamCount) * 1000) : 0,
    wafBlocks,
    tlsVersions,
  }
}

export const nginx = {
  async analyze(): Promise<NginxStats> {
    const { records, wafBlocks } = await fetchLog()
    return aggregate(records, wafBlocks)
  },

  async attacks(limit = 100): Promise<{ attacks: NginxAttack[]; attackCount: number }> {
    const { records } = await fetchLog()
    const attacks = records
      .filter(j => j.status >= 400)
      .map(j => ({ time: j.time, ip: j.remote, method: j.method, uri: j.uri, status: j.status, host: j.host, ua: j.ua }))
      .slice(-limit)
    return { attacks, attackCount: attacks.length }
  },
}
