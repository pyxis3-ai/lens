export function memo<T>(ttl: number, fn: () => Promise<T>) {
  let at = 0
  let value: T
  let pending: Promise<T> | null = null
  return (force = false): Promise<T> => {
    if (pending) return pending
    if (!force && at && Date.now() - at < ttl) return Promise.resolve(value)
    pending = fn()
      .then(v => { value = v; at = Date.now(); return v })
      .finally(() => { pending = null })
    return pending
  }
}
