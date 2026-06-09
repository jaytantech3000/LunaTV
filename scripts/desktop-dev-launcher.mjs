#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  disposeDesktopDev,
  prepareDesktopDev,
} from './desktop-dev-bootstrap.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

let tauriChild = null
let shuttingDown = false

function log(message) {
  console.log(`[desktop-dev] ${message}`)
}

async function stopTauriDev() {
  if (!tauriChild?.pid) {
    return
  }

  const pid = tauriChild.pid

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        cwd: projectRoot,
        stdio: 'ignore',
      })
    } catch {
      return
    }

    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  await stopTauriDev()
  await disposeDesktopDev()
  process.exit(exitCode)
}

process.on('SIGINT', () => {
  shutdown(0)
})

process.on('SIGTERM', () => {
  shutdown(0)
})

function runTauriDev() {
  return new Promise((resolve, reject) => {
    tauriChild = spawn(pnpmCommand, ['exec', 'tauri', 'dev'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        LUNATV_DESKTOP_SKIP_BOOTSTRAP: '1',
      },
      stdio: 'inherit',
    })

    tauriChild.on('error', reject)
    tauriChild.on('exit', (code, signal) => {
      tauriChild = null
      if (signal) {
        resolve(1)
        return
      }

      resolve(code ?? 0)
    })
  })
}

async function main() {
  await prepareDesktopDev()
  log('Launching Tauri dev shell')
  const exitCode = await runTauriDev()
  await disposeDesktopDev()
  process.exit(exitCode)
}

main().catch(async error => {
  console.error(`[desktop-dev] ${error.message}`)
  await shutdown(1)
})
