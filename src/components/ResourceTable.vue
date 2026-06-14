<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { ResourceCol } from '../lib/types'

const props = defineProps<{ rows: any[]; cols: ResourceCol[]; kind?: string }>()

const dKey = ref('')
const dData = ref<any>(null)
const dLoading = ref(false)
const key = (r: any) => `${r.namespace}/${r.name}`
const cellCls = (c: ResourceCol, r: any) => typeof c.cls === 'function' ? c.cls(r) : (c.cls || 'text-zinc-400')

async function describe(r: any) {
  if (!props.kind) return
  const k = key(r)
  if (dKey.value === k) return close()
  dKey.value = k
  dLoading.value = true
  try {
    const res = await fetch(`/api/describe?kind=${props.kind}&namespace=${encodeURIComponent(r.namespace)}&name=${encodeURIComponent(r.name)}`)
    dData.value = await res.json()
  } catch { dData.value = { error: 'failed to fetch' } }
  dLoading.value = false
}
function close() { dData.value = null; dKey.value = '' }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && dData.value) { close(); e.stopPropagation() } }
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-xs">
      <thead><tr class="text-zinc-600 border-b border-zinc-800">
        <th v-for="c in cols" :key="c.h" class="px-2 py-1" :class="c.r ? 'text-right' : 'text-left'">{{ c.h }}</th>
        <th v-if="$slots.actions" class="text-right px-2 py-1">ACT</th>
      </tr></thead>
      <tbody>
        <template v-for="r in rows" :key="key(r)">
          <tr class="border-b border-zinc-800/30" :class="[kind && 'cursor-pointer', dKey === key(r) ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover']" @click="describe(r)">
            <td v-for="c in cols" :key="c.h" class="px-2 py-0.5" :class="[c.r && 'text-right', cellCls(c, r)]">{{ c.val(r) }}</td>
            <td v-if="$slots.actions" class="px-2 py-0.5 text-right" @click.stop><slot name="actions" :row="r" /></td>
          </tr>
          <tr v-if="dKey === key(r) && dData" class="bg-emerald-900/10">
            <td :colspan="cols.length + ($slots.actions ? 1 : 0)" class="p-0">
              <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                <span class="text-emerald-400">describe</span>
                <span class="text-zinc-600">esc <button @click.stop="close" class="text-zinc-500 hover:text-zinc-300 ml-1">✕</button></span>
              </div>
              <div class="overflow-auto max-h-96 p-2">
                <pre v-if="dLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(dData, null, 2) }}</pre>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
