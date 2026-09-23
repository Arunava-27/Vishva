/**
 * Provider registry: shells out to each vendor's own officially supported CLI.
 *
 * Only "claude" and "copilot" have been hand-verified against the installed
 * binaries. "codex" and "antigravity" are best-effort flags from public docs,
 * not tested on this machine because the binaries aren't installed - fix the
 * args in place once you install the real CLI and see how it actually
 * behaves; nothing else here needs to change.
 */
import { execFile as execFileCb, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { McpServerConfig } from './mcpServers.ts'
// child_process.spawn cannot execute .cmd/.bat files on Windows at all with
// shell:false - not even given the fully resolved path (confirmed: EINVAL).
// cross-spawn is the standard, widely-used fix (npm itself depends on it)
// and keeps safe array-based argument passing instead of shell:true, which
// Node's own docs warn does not escape arguments.
import spawn from 'cross-spawn'

const execFile = promisify(execFileCb)

export type RunStatus =
  | 'SUCCESS'
  | 'RATE_LIMIT'
  | 'AUTH_FAILURE'
  | 'TIMEOUT'
  | 'TEMPORARY_SERVER_ERROR'
  | 'UNKNOWN_ERROR'
  | 'NOT_INSTALLED'

export interface RunResult {
  status: RunStatus
  output: string
  sessionId: string | null
  rawStderr: string
}

const FAILURE_PATTERNS: [RegExp, RunStatus][] = [
  [/rate.?limit|usage limit|quota|too many requests/i, 'RATE_LIMIT'],
  [/unauthoriz|not logged in|authentication fail|please log ?in|invalid api key/i, 'AUTH_FAILURE'],
  [/\btimed? ?out\b/i, 'TIMEOUT'],
  [/\b(502|503)\b|bad gateway|service unavailable|internal server error/i, 'TEMPORARY_SERVER_ERROR'],
]

export function classifyFailure(returncode: number | null, output: string): RunStatus {
  if (returncode === 0) return 'SUCCESS'
  for (const [pattern, label] of FAILURE_PATTERNS) {
    if (pattern.test(output)) return label
  }
  return 'UNKNOWN_ERROR'
}

function formatTemplate(template: string[], prompt: string, sessionId: string): string[] {
  return template.map((a) => a.replace('{prompt}', prompt).replace('{session_id}', sessionId))
}

export function buildArgs(
  template: string[],
  prompt: string,
  sessionId: string,
  attachments: string[] = [],
  attachmentFlag: string | null = null,
  addDirFlag: string | null = null,
): string[] {
  const args = formatTemplate(template, prompt, sessionId)
  for (const filePath of attachments) {
    if (attachmentFlag) args.push(attachmentFlag, filePath)
    if (addDirFlag) args.push(addDirFlag, path.dirname(path.resolve(filePath)))
  }
  return args
}

/** Resolves a bare command name to the exact file Windows would actually run
 * for it (with its real extension), the same way `where`/a shell's own PATH
 * lookup does - e.g. "npm" -> "...\npm.cmd", "codex" -> "...\codex.cmd" once
 * installed via npm. This matters because Node's spawn() with shell:false
 * cannot execute a .cmd/.bat file passed without its extension at all (a
 * documented Node limitation, not a bug) - so resolving to the real path
 * first is what lets spawn keep using shell:false (and therefore safe,
 * unescaped argument arrays) everywhere, rather than falling back to
 * shell:true, which Node itself warns does NOT properly escape arguments.
 * Returns null if nothing on PATH resolves. */
export async function resolveExecutablePath(binary: string): Promise<string | null> {
  // an absolute path (real provider CLIs are looked up by bare name, but
  // tests point fake providers straight at process.execPath) - where/which
  // search PATH by filename and don't reliably confirm a literal path exists.
  if (path.isAbsolute(binary)) {
    return existsSync(binary) ? binary : null
  }
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFile('which', [binary])
      return stdout.trim() || null
    } catch {
      return null
    }
  }

  try {
    const { stdout } = await execFile('where', [binary])
    const matches = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (matches.length === 0) return null
    // `where` can return an extensionless file (e.g. a POSIX shell shim
    // alongside npm.cmd) ahead of the one Windows can actually execute
    // directly - rank by PATHEXT, the same priority cmd.exe itself uses when
    // you type a bare command name, instead of trusting `where`'s own order.
    const pathext = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
    const ranked = matches
      .map((m) => ({ path: m, rank: pathext.indexOf(path.extname(m).toLowerCase()) }))
      .sort((a, b) => (a.rank === -1 ? Infinity : a.rank) - (b.rank === -1 ? Infinity : b.rank))
    return ranked[0].path
  } catch {
    return null
  }
}

export async function isInstalled(binary: string): Promise<boolean> {
  return (await resolveExecutablePath(binary)) !== null
}

export interface Command {
  cmd: string
  args: string[]
}

export interface Provider {
  name: string
  binary: string
  installHint: string
  printArgs: string[]
  resumeArgs?: string[]
  attachmentFlag?: string
  addDirFlag?: string
  verified: boolean
  /** Runnable from the app's "Install" button. Omitted (antigravity) when
   * there's no package-manager install - installUrl is shown instead. */
  installCommand?: Command
  installUrl?: string
  /** Runnable from "Login" - each CLI handles its own OAuth/device-code flow
   * and opens a browser or prints a code itself; we only stream its output,
   * never touch a credential directly. */
  loginCommand?: Command
  /** A quick, side-effect-free check whose stdout is JSON with a `loggedIn`
   * boolean - only claude has one of these. Providers without it (copilot has
   * no status/whoami subcommand at all) fall back to authState.ts, which
   * tracks what the app itself has observed instead. */
  statusCommand?: Command
  /** codex has no clean single-JSON-object output mode like the others -
   * plain output is a noisy human-readable transcript (banner, "user"/"codex"
   * labels, token counts). Its --output-last-message <file> flag writes just
   * the clean reply to a file instead, which is what this is for: when set,
   * run() appends [outputFileFlag, <temp path>] to the args, reads that file
   * as the reply after the process exits, and deletes it. */
  outputFileFlag?: string
  /** claude/copilot: a flag that takes a path to a JSON file listing MCP
   * servers, safe to point at a temp file we own (no risk of touching the
   * user's own real config). */
  mcpConfigFlag?: string
  /** codex: no file-based flag exists - MCP servers are passed as repeatable
   * dotted `-c mcp_servers.<name>.*=...` config overrides directly on the
   * invocation instead, so it needs its own arg-builder. */
  mcpServerArgsFn?: (servers: McpServerConfig[]) => string[]
}

/** Builds whatever extra CLI args a provider needs to see the given MCP
 * servers this turn, plus a cleanup function for any temp file created.
 * Antigravity has neither mcpConfigFlag nor mcpServerArgsFn - its only real
 * mechanism (`agy mcp add`) persistently mutates the user's shared global
 * config with no scoped override, so MCP is a silent no-op for it for now. */
export function buildMcpInvocationArgs(
  provider: Provider,
  servers: McpServerConfig[],
): { args: string[]; cleanup: () => void } {
  const noop = { args: [], cleanup: () => {} }
  if (servers.length === 0) return noop

  if (provider.mcpServerArgsFn) {
    return { args: provider.mcpServerArgsFn(servers), cleanup: () => {} }
  }

  if (provider.mcpConfigFlag) {
    const tmp = path.join(os.tmpdir(), `aicli-mcp-${randomUUID()}.json`)
    const mcpServers: Record<string, unknown> = {}
    for (const s of servers) {
      mcpServers[s.name] =
        s.transport === 'http' ? { type: 'http', url: s.url } : { command: s.command, args: s.args, env: s.env }
    }
    writeFileSync(tmp, JSON.stringify({ mcpServers }))
    return {
      args: [provider.mcpConfigFlag, tmp],
      cleanup: () => {
        try {
          unlinkSync(tmp)
        } catch {
          // already gone
        }
      },
    }
  }

  return noop
}

/** codex has no config-file override flag - only repeatable `-c` dotted
 * overrides applied directly to the `codex exec` invocation. Stdio only:
 * codex's http-transport TOML key wasn't confirmed live, so http servers are
 * skipped here rather than guessed at. */
export function codexMcpArgs(servers: McpServerConfig[]): string[] {
  const args: string[] = []
  for (const s of servers) {
    if (s.transport === 'http') continue
    args.push('-c', `mcp_servers.${s.name}.command=${JSON.stringify(s.command)}`)
    if (s.args.length) args.push('-c', `mcp_servers.${s.name}.args=${JSON.stringify(s.args)}`)
    for (const [k, v] of Object.entries(s.env)) args.push('-c', `mcp_servers.${s.name}.env.${k}=${JSON.stringify(v)}`)
  }
  return args
}

/** Runs a provider's statusCommand and reads its `loggedIn` field. Returns
 * null (unknown, not unauthenticated) when the provider has no such command -
 * distinct from false, since "unknown" and "confirmed logged out" need
 * different UI treatment. */
export async function checkLiveAuthStatus(provider: Provider): Promise<boolean | null> {
  if (!provider.statusCommand) return null
  const resolved = await resolveExecutablePath(provider.statusCommand.cmd)
  if (!resolved) return false
  try {
    const { stdout } = await execFile(resolved, provider.statusCommand.args)
    const parsed = JSON.parse(stdout)
    return parsed?.loggedIn === true
  } catch {
    return false
  }
}

export interface RunOptions {
  useResume?: boolean
  timeoutMs?: number
  attachments?: string[]
  mcpServers?: McpServerConfig[]
  onProcess?: (proc: ChildProcessWithoutNullStreams) => void
}

/**
 * sessionId is always the caller's canonical Session.id - it's also used as
 * the *provider's own* native session id (both claude and copilot accept
 * --session-id to set one on a fresh call), which is what makes continuing
 * the same provider with useResume=true free: the provider already has full
 * context, no prompt reconstruction needed.
 */
export async function runProvider(
  provider: Provider,
  prompt: string,
  sessionId: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const resolved = await resolveExecutablePath(provider.binary)
  if (!resolved) {
    return { status: 'NOT_INSTALLED', output: '', sessionId: null, rawStderr: '' }
  }

  const template = opts.useResume && provider.resumeArgs ? provider.resumeArgs : provider.printArgs
  const args = buildArgs(
    template, prompt, sessionId,
    opts.attachments ?? [], provider.attachmentFlag ?? null, provider.addDirFlag ?? null,
  )

  const outputFile = provider.outputFileFlag ? path.join(os.tmpdir(), `aicli-output-${randomUUID()}.txt`) : null
  if (outputFile) args.push(provider.outputFileFlag!, outputFile)

  const mcp = buildMcpInvocationArgs(provider, opts.mcpServers ?? [])
  args.push(...mcp.args)

  return new Promise((resolve) => {
    let proc: ChildProcessWithoutNullStreams
    try {
      // stdin explicitly ignored: codex tried reading from it when left open
      // (a real hang risk - confirmed live), and none of our -p/exec-style
      // invocations ever need input from us. Default stdio is pipes for
      // stdout/stderr, so this is really a ChildProcessWithoutNullStreams -
      // cross-spawn's types just say the more general ChildProcess.
      proc = spawn(resolved, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    } catch {
      resolve({ status: 'NOT_INSTALLED', output: '', sessionId, rawStderr: '' })
      return
    }
    opts.onProcess?.(proc)

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))

    const finish = (status: RunStatus) => {
      let output = stdout
      if (outputFile) {
        try {
          output = readFileSync(outputFile, 'utf-8')
        } catch {
          // fine - e.g. the process failed before ever writing it; fall back to stdout
        } finally {
          try {
            unlinkSync(outputFile)
          } catch {
            // already gone or never created
          }
        }
      }
      mcp.cleanup()
      resolve({ status, output, sessionId, rawStderr: stderr })
    }

    const timeout = setTimeout(() => {
      proc.kill()
      finish('TIMEOUT')
    }, opts.timeoutMs ?? 30 * 60_000)
    timeout.unref()

    proc.on('close', (code) => {
      clearTimeout(timeout)
      finish(classifyFailure(code, stdout + '\n' + stderr))
    })
    proc.on('error', () => {
      clearTimeout(timeout)
      finish('NOT_INSTALLED')
    })
  })
}

export const PROVIDERS: Record<string, Provider> = {
  claude: {
    name: 'claude',
    binary: 'claude',
    installHint: 'winget install Anthropic.ClaudeCode  (or: npm install -g @anthropic-ai/claude-code)',
    printArgs: ['-p', '{prompt}', '--session-id', '{session_id}', '--output-format', 'json'],
    resumeArgs: ['-p', '{prompt}', '--resume', '{session_id}', '--output-format', 'json'],
    // no local-file-attachment flag; grant folder access and let its own
    // Read tool (which handles images too) open the path referenced in the prompt.
    addDirFlag: '--add-dir',
    verified: true,
    installCommand: { cmd: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code'] },
    loginCommand: { cmd: 'claude', args: ['auth', 'login'] },
    statusCommand: { cmd: 'claude', args: ['auth', 'status'] },
    // confirmed live via `claude --help`: repeatable, points at any JSON file - safe to use a temp file we own.
    mcpConfigFlag: '--mcp-config',
  },
  codex: {
    name: 'codex',
    binary: 'codex',
    installHint: 'npm install -g @openai/codex  (see https://github.com/openai/codex)',
    // live-verified against the installed, authenticated binary: plain
    // `codex exec` output is a noisy human-readable transcript (banner,
    // "user"/"codex" labels, token counts) - not clean JSON like
    // claude/copilot/agy. --output-last-message writes just the clean reply
    // to a file instead (outputFileFlag handles this in run()).
    // --dangerously-bypass-approvals-and-sandbox and --skip-git-repo-check
    // are both required for a clean non-interactive run.
    //
    // No resumeArgs: codex assigns its own session id (shown in its banner),
    // it doesn't accept one from us the way claude/copilot do. Its only
    // resume-by-name shortcut, --last, resumes whatever it last worked on
    // globally in this directory - not scoped to *our* conversation, so
    // wiring that up naively risks silently resuming the wrong chat. Handled
    // the same honest way as antigravity: full reconstructed context each
    // turn instead of a broken/risky "free" resume.
    printArgs: [
      'exec', '{prompt}',
      '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check',
    ],
    outputFileFlag: '--output-last-message',
    addDirFlag: '--add-dir',
    verified: true,
    installCommand: { cmd: 'npm', args: ['install', '-g', '@openai/codex'] },
    loginCommand: { cmd: 'codex', args: ['login'] },
    // confirmed live via `codex --help`: no file-flag, only repeatable `-c mcp_servers.<name>.*=` overrides.
    mcpServerArgsFn: codexMcpArgs,
  },
  copilot: {
    name: 'copilot',
    binary: 'copilot',
    installHint: 'winget install GitHub.Copilot  (or: npm install -g @github/copilot)',
    // --allow-all-tools is required by the CLI itself for non-interactive mode
    // (it will not run -p without it - there's no human to answer permission prompts).
    printArgs: ['-p', '{prompt}', '--session-id', '{session_id}', '--allow-all-tools'],
    resumeArgs: ['-p', '{prompt}', '--resume', '{session_id}', '--allow-all-tools'],
    attachmentFlag: '--attachment',
    addDirFlag: '--add-dir',
    verified: true,
    installCommand: { cmd: 'npm', args: ['install', '-g', '@github/copilot'] },
    loginCommand: { cmd: 'copilot', args: ['login'] },
    // confirmed live via `copilot --help`: session-only, augments (doesn't persist into) ~/.copilot/mcp-config.json.
    mcpConfigFlag: '--additional-mcp-config',
  },
  antigravity: {
    name: 'antigravity',
    // the actual binary is "agy", not "antigravity" - a real .exe, no
    // cross-spawn quirks. Flags below are live-verified against an installed,
    // authenticated binary (not just docs): confirmed real JSON reply shape
    // ({"conversation_id","status","response",...} - note "response", not
    // "result" like claude/copilot - displayOutput() checks both) and exit
    // code 0 on success.
    binary: 'agy',
    installHint:
      'macOS/Linux: curl -fsSL https://antigravity.google/cli/install.sh | bash' +
      '  |  Windows: irm https://antigravity.google/cli/install.ps1 | iex',
    // -p/--print for non-interactive mode, --output-format json to get a
    // parseable reply, --dangerously-skip-permissions because (like copilot's
    // --allow-all-tools) headless mode has no human to answer tool-permission
    // prompts. No --session-id-up-front equivalent exists: agy assigns its
    // own conversation_id, returned in the JSON response, and resumes via
    // --conversation <that id> - a genuinely different pattern from
    // claude/copilot's "we pick the id" model, and not wired up yet (no
    // resumeArgs below), so every agy turn currently gets the full
    // handoff/reconstruction prompt rather than free native resume.
    printArgs: ['-p', '{prompt}', '--output-format', 'json', '--dangerously-skip-permissions'],
    verified: true,
    // no scriptable login/status command exists at all (confirmed from the
    // CLI reference docs - only a `/logout` *slash command* inside the
    // interactive TUI). First-time auth happens via running `agy`
    // interactively once yourself; there's nothing here to automate.
    installUrl: 'https://antigravity.google/docs/getting-started?tab=cli',
  },
}

// Providers using --output-format json don't agree on the field name for the
// actual reply: claude/copilot use "result", agy uses "response" (confirmed
// live against the real binaries) - checked in that order.
const REPLY_FIELDS = ['result', 'response']

export function displayOutput(output: string): string {
  try {
    const parsed = JSON.parse(output)
    if (parsed && typeof parsed === 'object') {
      for (const field of REPLY_FIELDS) {
        if (field in parsed) return String(parsed[field])
      }
    }
    return output
  } catch {
    return output
  }
}
