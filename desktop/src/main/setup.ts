/**
 * Runs a provider's own install/login command and streams its output live,
 * as it's produced - unlike runProvider() in providers.ts, which buffers
 * everything and resolves once at the end. That buffering is fine for a chat
 * turn, but wrong here: a login flow can print an OAuth URL or device code
 * the user needs to see and act on *before* the process exits (it often
 * waits on the browser flow completing), and an install can run for a while.
 *
 * Never touches a credential directly - each CLI handles its own OAuth/
 * device-code flow (opening a browser itself, or printing a code to visit).
 * This just spawns it and relays stdout/stderr.
 *
 * Install commands are `npm`, which on Windows is npm.cmd - node:child_process's
 * spawn() cannot execute .cmd/.bat files at all with shell:false, even given
 * the fully resolved path (confirmed: EINVAL, not just a bare-name ENOENT).
 * shell:true "fixes" that but Node's own docs warn it does not escape
 * arguments, only concatenates them - confirmed too, it mangled a
 * multi-statement -e script in testing. cross-spawn is the standard, widely
 * used fix (npm itself depends on it) that handles the .cmd/.bat wrapping
 * correctly while keeping safe array-based arguments.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import spawn from 'cross-spawn'
import { type Command, resolveExecutablePath } from './providers.ts'

export interface StreamingRunHandle {
  onProcess?: (proc: ChildProcessWithoutNullStreams) => void
  onOutput: (chunk: string) => void
}

export async function runStreamingCommand(
  command: Command,
  handle: StreamingRunHandle,
): Promise<{ code: number | null }> {
  const resolved = await resolveExecutablePath(command.cmd)
  if (!resolved) {
    handle.onOutput(`Command not found: ${command.cmd}\n`)
    return { code: null }
  }

  return new Promise((resolve) => {
    let proc: ChildProcessWithoutNullStreams
    try {
      // stdin ignored - none of our install/login commands read from it (npm
      // install doesn't prompt, and the login flows we use are all
      // browser/device-code based, not the stdin-token variants).
      proc = spawn(resolved, command.args, { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    } catch {
      handle.onOutput(`Failed to start: ${command.cmd}\n`)
      resolve({ code: null })
      return
    }
    handle.onProcess?.(proc)
    proc.stdout.on('data', (d) => handle.onOutput(d.toString()))
    proc.stderr.on('data', (d) => handle.onOutput(d.toString()))
    proc.on('close', (code) => resolve({ code }))
    proc.on('error', (err) => {
      handle.onOutput(`${err.message}\n`)
      resolve({ code: null })
    })
  })
}
