<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const props = defineProps<{ namespace: string; pod: string; container: string }>()
const termEl = ref<HTMLElement | null>(null)
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null

function connect() {
  cleanup()

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${location.host}/ws/exec?namespace=${encodeURIComponent(props.namespace)}&pod=${encodeURIComponent(props.pod)}&container=${encodeURIComponent(props.container)}`

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    theme: {
      background: '#09090b', // zinc-950
      foreground: '#d4d4d8', // zinc-300
      cursor: '#10b981', // emerald-500
      selectionBackground: '#10b98133',
      black: '#18181b',
      red: '#f87171',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d4d4d8',
      brightBlack: '#52525b',
      brightRed: '#fca5a5',
      brightGreen: '#6ee7b7',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#fafafa',
    },
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  nextTick(() => {
    if (!termEl.value || !terminal) return

    terminal.open(termEl.value)
    fitAddon!.fit()

    // Watch for container resize
    resizeObserver = new ResizeObserver(() => {
      try { fitAddon?.fit() } catch {}
    })
    resizeObserver.observe(termEl.value)

    // Send resize on fit
    terminal.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    // Connect WebSocket
    ws = new WebSocket(url)
    ws.onopen = () => {
      // Send initial size
      if (terminal) {
        ws!.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      }
    }
    ws.onmessage = (e) => {
      terminal?.write(e.data)
    }
    ws.onclose = () => {
      terminal?.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n')
    }
    ws.onerror = () => {
      terminal?.write('\r\n\x1b[31m[connection error]\x1b[0m\r\n')
    }

    // Send keystrokes to server
    terminal.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    terminal.focus()
  })
}

function cleanup() {
  resizeObserver?.disconnect()
  resizeObserver = null
  ws?.close()
  ws = null
  terminal?.dispose()
  terminal = null
  fitAddon = null
}

watch(() => `${props.namespace}/${props.pod}/${props.container}`, connect, { immediate: true })
onUnmounted(cleanup)
</script>

<template>
  <div class="h-full overflow-hidden">
    <div ref="termEl" class="h-full overflow-hidden" />
  </div>
</template>
