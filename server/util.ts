export function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] || 0) + by
}

export function topN(map: Record<string, number>, n: number): [string, number][] {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
}
