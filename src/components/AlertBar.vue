<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Alert } from '../lib/types'
import { ackAlert, dismissAlert, alertThresholds, loadThresholds, saveThreshold } from '../lib/ws'

const props = defineProps<{ alerts: Alert[] }>()
const showThresholds = ref(false)
const editId = ref('')
const editWarn = ref(0)
const editCrit = ref(0)

const sorted = computed(() =>
  [...props.alerts].sort((a, b) => {
    if (a.level === 'critical' && b.level !== 'critical') return -1
    if (b.level === 'critical' && a.level !== 'critical') return 1
    return b.ts - a.ts
  })
)

function startEdit(id: string, warn: number, crit: number) {
  editId.value = id
  editWarn.value = warn
  editCrit.value = crit
}

async function saveEdit() {
  if (!editId.value) return
  await saveThreshold(editId.value, editWarn.value, editCrit.value)
  editId.value = ''
}

function toggleThresholds() {
  showThresholds.value = !showThresholds.value
  if (showThresholds.value) loadThresholds()
}
</script>

<template>
  <div v-if="alerts.length || showThresholds">
    <!-- Active alerts -->
    <div v-if="alerts.length" class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-1.5 mb-2">
      <div class="flex items-center gap-2 text-xs mb-1">
        <span class="text-red-400">ALERTS</span>
        <span class="text-zinc-600">{{ alerts.length }}</span>
        <button @click="toggleThresholds" class="text-zinc-600 hover:text-zinc-400 ml-auto text-xs">thresholds</button>
      </div>
      <div class="space-y-0.5">
        <div v-for="a in sorted" :key="a.id"
          class="flex items-center gap-2 text-xs"
          :class="a.level === 'critical' ? 'text-red-400' : 'text-amber-400'">
          <span>{{ a.level === 'critical' ? '!!' : '!' }}</span>
          <span class="flex-1" :class="a.acknowledged ? 'opacity-50' : ''">{{ a.message }}</span>
          <button v-if="!a.acknowledged" @click="ackAlert(a.id)" class="text-zinc-600 hover:text-zinc-400" title="Acknowledge">ack</button>
          <button @click="dismissAlert(a.id)" class="text-zinc-600 hover:text-zinc-400" title="Dismiss">x</button>
        </div>
      </div>
    </div>

    <!-- Thresholds editor -->
    <div v-if="showThresholds" class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2 mb-2">
      <div class="flex items-center gap-2 text-xs mb-1.5">
        <span class="text-zinc-500">THRESHOLDS</span>
        <button @click="showThresholds = false" class="text-zinc-600 hover:text-zinc-400 ml-auto">close</button>
      </div>
      <div class="space-y-1">
        <div v-for="(t, id) in alertThresholds" :key="id" class="flex items-center gap-2 text-xs">
          <span class="text-zinc-400 w-16">{{ id }}</span>
          <template v-if="editId === id">
            <label class="text-zinc-600">warn:</label>
            <input v-model.number="editWarn" type="number" class="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-1 py-0 w-14" />
            <label class="text-zinc-600">crit:</label>
            <input v-model.number="editCrit" type="number" class="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-1 py-0 w-14" />
            <button @click="saveEdit" class="text-emerald-400 hover:text-emerald-300">save</button>
            <button @click="editId = ''" class="text-zinc-600 hover:text-zinc-400">cancel</button>
          </template>
          <template v-else>
            <span class="text-amber-400">warn:{{ t.warn }}</span>
            <span class="text-red-400">crit:{{ t.crit }}</span>
            <button @click="startEdit(String(id), t.warn, t.crit)" class="text-zinc-600 hover:text-zinc-400">edit</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
