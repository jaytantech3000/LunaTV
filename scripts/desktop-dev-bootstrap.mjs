#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')
const normalizedProjectRoot = normalizeValue(projectRoot)
const isDirectRun =
  typeof process.argv[1] === 'string' && resolve(process.argv[1]) === __filename

const FRONTEND_PORT = 3000
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`
const LOCAL_SERVICE_PORT = 8787
const FRONTEND_START_TIMEOUT_MS = 120000
const PROCESS_STOP_TIMEOUT_MS = 5000
const FRONTEND_POLL_INTERVAL_MS = 1000
const KEEPALIVE_POLL_INTERVAL_MS = 3000

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const useWindowsCommandShell = process.platform === 'win32'

let frontendChild = null
let shuttingDown = false
let missingFrontendChecks = 0

function log(message) {
  console.log(`[desktop-dev] ${message}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeValue(value) {
  return value.replace(/\\/g, '/').toLowerCase()
}

function pathBelongsToProject(value) {
  if (!value) {
    return false
  }

  const normalizedValue = normalizeValue(value)
  return (
    normalizedValue === normalizedProjectRoot ||
    normalizedValue.startsWith(`${normalizedProjectRoot}/`)
  )
}

function readCommandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (typeof error.stdout === 'string') {
      return error.stdout.trim()
    }

    return ''
  }
}

function runBlockingCommand(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: useWindowsCommandShell,
  })
}

function parsePidList(output) {
  return Array.from(
    new Set(
      output
        .split(/\r?\n/)
        .map(line => Number.parseInt(line.trim(), 10))
        .filter(Number.isInteger)
    )
  )
}

function getListeningPids(port) {
  if (process.platform === 'win32') {
    const output = readCommandOutput('netstat', ['-ano', '-p', 'TCP'])
    return Array.from(
      new Set(
        output
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.includes('LISTENING'))
          .map(line => line.split(/\s+/))
          .filter(columns => columns.length >= 5 && columns[1].endsWith(`:${port}`))
          .map(columns => Number.parseInt(columns[4], 10))
          .filter(Number.isInteger)
      )
    )
  }

  const output = readCommandOutput('lsof', [
    '-nP',
    `-iTCP:${port}`,
    '-sTCP:LISTEN',
    '-t',
  ])

  return parsePidList(output)
}

function getProcessCommand(pid) {
  if (process.platform === 'win32') {
    return readCommandOutput('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ])
  }

  return readCommandOutput('ps', ['-ww', '-p', String(pid), '-o', 'command='])
}

function getProcessCwd(pid) {
  if (process.platform === 'win32') {
    return ''
  }

  const output = readCommandOutput('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
  const cwdLine = output
    .split(/\r?\n/)
    .find(line => line.startsWith('n'))

  return cwdLine ? cwdLine.slice(1).trim() : ''
}

function getAllProcesses() {
  if (process.platform === 'win32') {
    const output = readCommandOutput('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
    ])

    if (!output) {
      return []
    }

    try {
      const parsed = JSON.parse(output)
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      return rows
        .map(row => ({
          pid: Number.parseInt(String(row.ProcessId), 10),
          command: String(row.CommandLine || '').trim(),
        }))
        .filter(row => Number.isInteger(row.pid) && row.command)
    } catch {
      return []
    }
  }

  const output = readCommandOutput('ps', ['-ax', '-ww', '-o', 'pid=,command='])
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\d+)\s+(.*)$/)
      if (!match) {
        return null
      }

      return {
        pid: Number.parseInt(match[1], 10),
        command: match[2].trim(),
      }
    })
    .filter(row => row && Number.isInteger(row.pid) && row.command)
}

function describeProcess(pid) {
  const command = getProcessCommand(pid)
  const cwd = getProcessCwd(pid)

  return {
    pid,
    command,
    cwd,
  }
}

function isRepoFrontendProcess(processInfo) {
  const command = normalizeValue(processInfo.command || '')
  const cwd = processInfo.cwd || ''
  const inProject = pathBelongsToProject(cwd) || pathBelongsToProject(processInfo.command || '')

  return (
    inProject &&
    (command.includes('next') ||
      command.includes('desktop:dev:frontend') ||
      command.includes('pnpm dev'))
  )
}

function isRepoLocalServiceProcess(processInfo) {
  const command = normalizeValue(processInfo.command || '')
  const inProject =
    pathBelongsToProject(processInfo.cwd || '') || pathBelongsToProject(processInfo.command || '')

  return inProject && command.includes('moontv-local-service')
}

function isDesktopShellCommand(command) {
  const normalizedCommand = normalizeValue(command || '')
  return (
    normalizedCommand.includes('lunatv-desktop-shell') ||
    normalizedCommand.includes('cargo run -p lunatv-desktop-shell')
  )
}

function hasActiveDesktopShell() {
  return getAllProcesses().some(processInfo => {
    if (!isDesktopShellCommand(processInfo.command || '')) {
      return false
    }

    return (
      pathBelongsToProject(processInfo.command || '') ||
      pathBelongsToProject(getProcessCwd(processInfo.pid))
    )
  })
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true
    }

    await sleep(150)
  }

  return !isPidAlive(pid)
}

async function terminatePid(pid, label) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T'], {
        cwd: projectRoot,
        stdio: 'ignore',
      })
    } catch {
      // keep falling through to force kill
    }

    if (await waitForPidExit(pid, PROCESS_STOP_TIMEOUT_MS)) {
      log(`Stopped ${label} PID ${pid}`)
      return
    }

    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      cwd: projectRoot,
      stdio: 'ignore',
    })

    await waitForPidExit(pid, PROCESS_STOP_TIMEOUT_MS)
    log(`Force stopped ${label} PID ${pid}`)
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error.code === 'ESRCH') {
      return
    }

    throw error
  }

  if (await waitForPidExit(pid, PROCESS_STOP_TIMEOUT_MS)) {
    log(`Stopped ${label} PID ${pid}`)
    return
  }

  process.kill(pid, 'SIGKILL')
  await waitForPidExit(pid, PROCESS_STOP_TIMEOUT_MS)
  log(`Force stopped ${label} PID ${pid}`)
}

async function cleanupLocalServicePort() {
  const pids = getListeningPids(LOCAL_SERVICE_PORT)
  if (pids.length === 0) {
    return
  }

  const listeners = pids.map(describeProcess)
  const repoLocalServiceListeners = listeners.filter(isRepoLocalServiceProcess)

  if (repoLocalServiceListeners.length === 0) {
    const detail = listeners
      .map(processInfo => `${processInfo.pid}: ${processInfo.command || '(unknown command)'}`)
      .join('; ')
    throw new Error(
      `Port ${LOCAL_SERVICE_PORT} is occupied by a non-LunaTV process. ${detail}`
    )
  }

  if (hasActiveDesktopShell()) {
    const detail = repoLocalServiceListeners
      .map(processInfo => `${processInfo.pid}: ${processInfo.command}`)
      .join('; ')
    throw new Error(
      `Port ${LOCAL_SERVICE_PORT} is already in use by another LunaTV desktop instance. ${detail}`
    )
  }

  for (const processInfo of repoLocalServiceListeners) {
    log(
      `Found stale local service on ${LOCAL_SERVICE_PORT}, cleaning PID ${processInfo.pid}`
    )
    await terminatePid(processInfo.pid, 'stale local service')
  }
}

async function fetchFrontend() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(FRONTEND_URL, {
      redirect: 'manual',
      signal: controller.signal,
    })
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForFrontendReady() {
  const deadline = Date.now() + FRONTEND_START_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (await fetchFrontend()) {
      return
    }

    if (frontendChild && frontendChild.exitCode !== null) {
      throw new Error(
        `Desktop frontend exited before becoming ready (code ${frontendChild.exitCode})`
      )
    }

    await sleep(FRONTEND_POLL_INTERVAL_MS)
  }

  throw new Error(`Timed out waiting for desktop frontend at ${FRONTEND_URL}`)
}

function startFrontendDevServer() {
  log('Starting desktop frontend dev server on port 3000')

  frontendChild = spawn(pnpmCommand, ['desktop:dev:frontend'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    shell: useWindowsCommandShell,
  })

  frontendChild.on('error', error => {
    if (!shuttingDown) {
      console.error(`[desktop-dev] Failed to start desktop frontend: ${error.message}`)
      process.exit(1)
    }
  })

  frontendChild.on('exit', (code, signal) => {
    frontendChild = null

    if (!shuttingDown) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
      console.error(`[desktop-dev] Desktop frontend exited unexpectedly (${reason})`)
      process.exit(code ?? 1)
    }
  })
}

async function ensureFrontendReady() {
  const pids = getListeningPids(FRONTEND_PORT)

  if (pids.length === 0) {
    startFrontendDevServer()
    await waitForFrontendReady()
    return
  }

  const listeners = pids.map(describeProcess)
  const repoFrontendListeners = listeners.filter(isRepoFrontendProcess)

  if (repoFrontendListeners.length === 0) {
    const detail = listeners
      .map(processInfo => `${processInfo.pid}: ${processInfo.command || '(unknown command)'}`)
      .join('; ')
    throw new Error(`Port ${FRONTEND_PORT} is occupied by another app. ${detail}`)
  }

  if (await fetchFrontend()) {
    log('Reusing existing desktop frontend dev server on port 3000')
    return
  }

  for (const processInfo of repoFrontendListeners) {
    log(
      `Existing desktop frontend on ${FRONTEND_PORT} is unhealthy, restarting PID ${processInfo.pid}`
    )
    await terminatePid(processInfo.pid, 'stale desktop frontend')
  }

  startFrontendDevServer()
  await waitForFrontendReady()
}

async function stopFrontendDevServer() {
  if (!frontendChild) {
    return
  }

  const pid = frontendChild.pid
  if (!pid) {
    return
  }

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
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return
    }
  }
}

async function holdBootstrapProcess() {
  while (!shuttingDown) {
    if (!frontendChild) {
      const pids = getListeningPids(FRONTEND_PORT)
      const listeners = pids.map(describeProcess)
      const repoFrontendListeners = listeners.filter(isRepoFrontendProcess)

      if (repoFrontendListeners.length === 0) {
        missingFrontendChecks += 1
        if (missingFrontendChecks >= 3) {
          throw new Error('Desktop frontend on port 3000 became unavailable')
        }
      } else {
        missingFrontendChecks = 0
      }
    } else {
      missingFrontendChecks = 0
    }

    await sleep(KEEPALIVE_POLL_INTERVAL_MS)
  }
}

export async function prepareDesktopDev() {
  shuttingDown = false
  missingFrontendChecks = 0
  runBlockingCommand(pnpmCommand, ['desktop:prepare:sidecar'])
  await cleanupLocalServicePort()
  await ensureFrontendReady()
  log('Desktop dev prerequisites are ready')
}

export async function disposeDesktopDev() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  missingFrontendChecks = 0
  await stopFrontendDevServer()
}

async function shutdown(exitCode = 0) {
  await disposeDesktopDev()
  process.exit(exitCode)
}

function installSignalHandlers() {
  process.on('SIGINT', () => {
    shutdown(0)
  })

  process.on('SIGTERM', () => {
    shutdown(0)
  })
}

async function main() {
  if (process.env.LUNATV_DESKTOP_SKIP_BOOTSTRAP === '1') {
    log('Skipping bootstrap because the desktop launcher already prepared prerequisites')
    return
  }

  installSignalHandlers()
  await prepareDesktopDev()
  await holdBootstrapProcess()
}

if (isDirectRun) {
  main().catch(async error => {
    console.error(`[desktop-dev] ${error.message}`)
    await shutdown(1)
  })
}
