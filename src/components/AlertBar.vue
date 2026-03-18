<script setup lang="ts">
import { ref } from 'vue'
import type { Alert } from '../lib/types'
import { ackAlert, dismissAlert, alertThresholds, loadThresholds, saveThreshold } from '../lib/ws'

defineProps<{ alerts: Alert[] }>()
const showThresholds = ref(false)
const editId = ref('')
const editWarn = ref(0)
const editCrit = ref(0)

async function ack(id: string) {
  await ackAlert(id)
}

function startEdit(id: string) {
  const t = alertThresholds.value[id]
  if (!t) return
  editId.value = id
  editWarn.value = t.warn
  editCrit.value = t.crit
}

async function saveEdit() {
  if (!editId.value) return
  await saveThreshold(editId.value, editWarn.value, editCrit.value)
  editId.value = ''
}

function openThresholds() {
  loadThresholds()
  showThresholds.value = true
}
</script>

<template>
  <div v-if="alerts.length" class="bg-red-950/50 border border-red-900/50 rounded px-3 py-1.5">
    <div class="flex items-center gap-2 flex-wrap text-xs">
      <span class="text-red-400 font-bold shrink-0">ALERTS</span>
      <span v-for="a in alerts" :key="a.id" class="inline-flex items-center gap-1"
        :class="a.acknowledged ? 'opacity-50' : (a.level === 'critical' ? 'text-red-400' : 'text-amber-400')">
        {{ a.level === 'critical' ? '\uD83D\uDD34' : '\u26A0\uFE0F' }} {{ a.message }}
        <button v-if="!a.acknowledged" @click="ack(a.id)" class="text-zinc-500 hover:text-zinc-300 ml-0.5" title="Acknowledge">\u2713</button>
        <button @click="dismissAlert(a.id)" class="text-zinc-600 hover:text-red-400 ml-0.5" title="Dismiss">\u2715</button>
      </span>
      <button @click="openThresholds" class="text-zinc-600 hover:text-zinc-400 ml-auto shrink-0" title="Edit thresholds">\u2699</button>
    </div>
  </div>

  <!-- Threshold editor overlay -->
  <div v-if="showThresholds" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50" @click.self="showThresholds = false">
    <div class="bg-zinc-900 border border-zinc-700 rounded-lg p-4 max-w-sm w-full mx-4">
      <div class="flex items-center justify-between mb-3">
        <span class="text-emerald-400 font-bold text-sm">Alert Thresholds</span>
        <button @click="showThresholds = false" class="text-zinc-500 hover:text-zinc-300">\u2715</button>
      </div>
      <div class="space-y-2 text-xs">
        <div v-for="(t, id) in alertThresholds" :key="id" class="flex items-center gap-2">
          <span class="text-zinc-400 w-16">{{ id }}</span>
          <template v-if="editId === id">
            <input v-model.number="editWarn" class="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 w-14 text-amber-400 text-right" />
            <input v-model.number="editCrit" class="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 w-14 text-red-400 text-right" />
            <button @click="saveEdit" class="text-emerald-400 hover:text-emerald-300">\u2713</button>
            <button @click="editId = ''" class="text-zinc-500 hover:text-zinc-300">\u2715</button>
          </template>
          <template v-else>
            <span class="text-amber-400 w-14 text-right">{{ t.warn }}</span>
            <span class="text-red-400 w-14 text-right">{{ t.crit }}</span>
            <button @click="startEdit(String(id))" class="text-zinc-600 hover:text-zinc-400">\u270E</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
