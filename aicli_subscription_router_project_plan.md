# Subscription-Aware AI Coding Router --- Project Plan

## 1. Project Goal

Build a terminal-based tool that allows a developer to use multiple
existing AI subscriptions through one unified coding workflow.

The target subscriptions are:

-   ChatGPT subscription
-   Claude subscription
-   GitHub Copilot subscription
-   Google Antigravity subscription

The primary goal is **uninterrupted development**:

1.  Start a coding task through one terminal interface.
2.  Use the preferred AI provider first.
3.  Detect when that provider reaches a rate limit, usage/quota limit,
    authentication failure, or temporary service failure.
4.  Automatically switch to another available provider.
5.  Preserve the development context when switching providers.
6.  Continue working on the same repository without requiring the user
    to manually restart the task.
7.  Keep the canonical task/session state under the user's control
    rather than relying on any provider's private conversation state.

------------------------------------------------------------------------

# 2. What We Are Actually Building

The project should not be thought of as merely an "LLM router."

The better abstraction is:

> **A coding agent whose underlying AI provider is replaceable.**

This distinction is critical because provider conversations are not
inherently portable.

A Claude conversation ID cannot simply be handed to ChatGPT, and ChatGPT
cannot access Claude's private server-side context.

Instead, the application itself owns the canonical context.

``` text
                    CODING AGENT
                         |
              +----------+----------+
              |                     |
       Canonical Context          Tools
              |                     |
              +----------+----------+
                         |
                       Router
                         |
        +----------------+----------------+
        |                |                |
      Claude          ChatGPT          Copilot
        |                |                |
        +----------------+----------------+
                         |
                    Antigravity
```

The provider becomes an interchangeable inference backend.

------------------------------------------------------------------------

# 3. Target User Experience

The ideal experience should look approximately like:

``` text
$ aicli

+------------------------------------------------+
|                    AICLI                       |
|       Multi-Subscription Coding Agent         |
+------------------------------------------------+

Providers

 ✓ Claude       AVAILABLE
 ✓ ChatGPT      AVAILABLE
 ✓ Copilot      AVAILABLE
 ✓ Antigravity  AVAILABLE

Active provider: Claude
```

The developer can then say:

``` text
> Implement JWT authentication for the FastAPI backend.
```

The agent performs normal coding-agent operations:

``` text
Claude:
  Inspecting repository...

  read backend/main.py
  read backend/models/user.py
  read backend/routes/auth.py

  Creating authentication module...

  write backend/auth.py
  edit backend/routes/auth.py

  Running tests...
```

If the provider reaches a usage limit:

``` text
Claude quota exhausted.

Saving session checkpoint...

Provider status:

Claude       EXHAUSTED
ChatGPT      AVAILABLE
Copilot      AVAILABLE
Antigravity  AVAILABLE

Switching to ChatGPT...
```

The new provider receives a generated continuation context and continues
the task.

------------------------------------------------------------------------

# 4. Core Requirement: Context Continuity

This is the hardest and most important part.

## 4.1 What must NOT be assumed

The application cannot assume that:

``` text
Claude conversation ID
```

can be transferred to:

``` text
ChatGPT conversation ID
```

or that a provider's hidden server-side memory is portable.

## 4.2 Canonical context must belong to the application

The application should maintain:

-   User request
-   Task description
-   Previous model responses
-   Tool calls
-   Tool results
-   Files inspected
-   Files modified
-   Commands executed
-   Test results
-   Current task status
-   Important decisions
-   Current git state
-   Provider history
-   Generated summaries

The provider should be treated as a worker operating on this state.

------------------------------------------------------------------------

# 5. Repository State Is Part of the Context

For software development, the Git repository is an extremely valuable
source of continuity.

Before switching providers, the system can inspect:

``` bash
git status
git diff
git diff --cached
```

It can record:

-   Changed files
-   Untracked files
-   Staged changes
-   Recent commits
-   Branch
-   Tests already executed
-   Current working tree state

Therefore a provider switch can look like:

``` text
Claude
  |
  | modifies 5 files
  | runs tests
  | quota exhausted
  |
  v
Checkpoint
  |
  +-- git diff
  +-- modified files
  +-- task state
  +-- tool history
  +-- context summary
  |
  v
ChatGPT
  |
  v
Continue task
```

This is substantially more reliable than attempting to migrate
proprietary provider-side conversation state.

------------------------------------------------------------------------

# 6. Continuation Context Example

Suppose Claude was working on:

``` text
Implement JWT authentication.
```

It inspected:

``` text
backend/main.py
backend/models/user.py
backend/routes/auth.py
```

and created:

``` text
backend/auth.py
```

If Claude becomes unavailable, the context manager can generate:

``` text
You are continuing an existing coding task.

Task:
Implement JWT authentication.

Previous agent:
Claude

Completed:
- Created backend/auth.py
- Added JWT token generation
- Added password hashing
- Updated the authentication route

Pending:
- Add authentication middleware
- Complete login endpoint
- Run test suite

Files examined:
backend/main.py
backend/models/user.py
backend/routes/auth.py

Files modified:
backend/auth.py
backend/routes/auth.py

Repository state:
There are uncommitted changes related to the authentication task.

Continue from the current repository state.
Do not undo completed work unless required.
```

This is the mechanism that provides provider-independent continuity.

------------------------------------------------------------------------

# 7. High-Level Architecture

``` text
                         USER
                          |
                          v
                 +----------------+
                 |     AICLI      |
                 |  Terminal UI   |
                 +-------+--------+
                         |
                         v
                 +----------------+
                 | Coding Agent   |
                 +-------+--------+
                         |
             +-----------+-----------+
             |                       |
             v                       v
     +---------------+       +---------------+
     | Context       |       | Tool System   |
     | Manager       |       |               |
     +-------+-------+       | read/write    |
             |               | shell/git     |
             |               | test/search   |
             |               +---------------+
             |
             v
       +-------------+
       |   Router    |
       +------+------+ 
              |
       +------+------+------+------+ 
       |      |      |      |
       v      v      v      v
    Claude  OpenAI Copilot Antigravity
```

------------------------------------------------------------------------

# 8. Provider Adapter Architecture

Every provider should implement a common interface.

Conceptually:

``` python
class Provider(ABC):

    @abstractmethod
    async def authenticate(self):
        ...

    @abstractmethod
    async def send(self, request):
        ...

    @abstractmethod
    async def stream(self, request):
        ...

    @abstractmethod
    async def get_usage(self):
        ...

    @abstractmethod
    async def is_available(self):
        ...
```

Possible structure:

``` text
providers/
├── base.py
├── claude.py
├── openai.py
├── copilot.py
└── antigravity.py
```

The router should not need to know the implementation details of each
provider.

It should simply ask:

``` python
provider = router.select()
response = await provider.stream(request)
```

------------------------------------------------------------------------

# 9. Authentication Model

Authentication is the technically sensitive part of the project.

The intended approach is:

``` text
OAuth / device authorization
        |
        v
Provider-issued credential
        |
        v
Local secure credential storage
```

The CLI could provide commands such as:

``` bash
aicli login claude
aicli login chatgpt
aicli login copilot
aicli login antigravity
```

The exact authentication mechanism must be implemented according to the
provider's currently supported interfaces and terms.

The tool should NOT:

-   Steal browser cookies
-   Extract private session tokens
-   Circumvent provider quotas
-   Bypass anti-abuse systems
-   Impersonate clients in prohibited ways
-   Reverse-engineer authentication mechanisms when doing so violates
    provider rules

The project should prefer official OAuth/device authorization or
officially supported integrations wherever available.

------------------------------------------------------------------------

# 10. Important Subscription vs API Distinction

A major architectural constraint is that an AI subscription is not
necessarily equivalent to an API account.

For example:

``` text
Claude subscription
```

and:

``` text
Anthropic API key
```

are different access mechanisms.

Likewise, GitHub Copilot subscription access is not automatically
equivalent to purchasing provider API credits.

Therefore the project should not simply assume:

``` text
Subscription
    =
API key
```

The purpose of this project is specifically to make use of the user's
authorized subscription access where technically and contractually
supported.

------------------------------------------------------------------------

# 11. Router Responsibilities

The router should handle:

-   Provider selection
-   Provider priority
-   Provider availability
-   Rate-limit detection
-   Quota exhaustion detection
-   Temporary server failures
-   Timeouts
-   Retry policy
-   Fallback
-   Model capability matching
-   Cooldown periods
-   Provider recovery
-   Provider health
-   Session continuity

Example configuration:

``` toml
[router]
strategy = "smart-fallback"

providers = [
    "claude",
    "chatgpt",
    "antigravity",
    "copilot"
]

[router.fallback]
on_rate_limit = true
on_quota_exhausted = true
on_server_error = true
on_timeout = true
```

------------------------------------------------------------------------

# 12. Provider Selection Strategy

The initial strategy can be simple:

``` text
1. Preferred provider
2. Next available provider
3. Next available provider
4. Continue until a provider succeeds
```

Later, it can become smarter.

Possible selection factors:

-   User-defined priority
-   Provider availability
-   Remaining quota
-   Current cooldown
-   Model capability
-   Task type
-   Context window requirements
-   Cost, if applicable
-   Latency
-   Historical reliability

Example:

``` text
PROVIDER       STATUS       USAGE       PRIORITY
-------------------------------------------------
Claude         READY        72%         1
ChatGPT        READY        61%         2
Antigravity    READY        44%         3
Copilot        READY        89%         4
```

------------------------------------------------------------------------

# 13. Failure and Fallback Flow

Example:

``` text
Request
   |
   v
Claude
   |
   +---- success ------> Continue
   |
   +---- rate limit
   |
   +---- quota exhausted
   |
   +---- temporary error
   |
   v
Create checkpoint
   |
   v
Select next provider
   |
   v
ChatGPT
   |
   +---- success ------> Continue
   |
   +---- failure
   |
   v
Select next provider
   |
   v
Antigravity
```

The system should not switch providers for every ordinary model error.

Failures should be classified.

Possible classes:

``` text
RATE_LIMIT
QUOTA_EXHAUSTED
AUTH_FAILURE
TEMPORARY_SERVER_ERROR
TIMEOUT
NETWORK_ERROR
INVALID_REQUEST
MODEL_UNAVAILABLE
PERMANENT_PROVIDER_ERROR
```

Only appropriate errors should trigger automatic fallback.

------------------------------------------------------------------------

# 14. Session Manager

The session manager should own the canonical task.

Example:

``` text
~/.aicli/
├── config.toml
├── credentials/
│   ├── claude.json
│   ├── openai.json
│   ├── copilot.json
│   └── antigravity.json
│
├── sessions/
│   └── project-abc/
│       ├── session.json
│       ├── messages.jsonl
│       ├── context.json
│       └── summary.md
│
└── cache/
```

The exact credential storage mechanism should eventually use the OS
credential store rather than storing sensitive credentials as plain
text.

------------------------------------------------------------------------

# 15. Suggested Data Model

Start with SQLite.

No PostgreSQL server is necessary for the CLI MVP.

Potential tables:

``` text
providers
sessions
messages
tool_calls
usage
events
credential_metadata
```

Example conceptual session:

``` json
{
  "id": "session-001",
  "project": "aether",
  "task": "Implement JWT authentication",
  "active_provider": "claude",
  "providers_used": [
    "claude",
    "chatgpt"
  ],
  "status": "active"
}
```

------------------------------------------------------------------------

# 16. Event Log

A JSONL event log is useful for debugging and recovery.

Example:

``` json
{"event":"session_started","provider":"claude"}
{"event":"tool_call","tool":"read_file","path":"backend/main.py"}
{"event":"tool_call","tool":"write_file","path":"backend/auth.py"}
{"event":"test_started","command":"pytest"}
{"event":"provider_error","type":"QUOTA_EXHAUSTED"}
{"event":"checkpoint_created"}
{"event":"provider_switched","from":"claude","to":"chatgpt"}
{"event":"session_resumed","provider":"chatgpt"}
```

This makes provider switching observable and debuggable.

------------------------------------------------------------------------

# 17. Terminal UI

Use the Python `Rich` library.

The interface can show:

``` text
+-------------------------------------------+
| AICLI                                     |
|                                           |
| Project: Aether                           |
| Session: auth-001                         |
|                                           |
| Active Provider                           |
|   Claude                                  |
|                                           |
| Providers                                 |
|   Claude       READY                      |
|   ChatGPT      READY                      |
|   Copilot      READY                      |
|   Antigravity  RATE LIMITED               |
|                                           |
| Task                                      |
|   Implement JWT authentication             |
+-------------------------------------------+
```

The terminal should also show provider switches clearly:

``` text
[Claude] quota exhausted
[Router] checkpoint created
[Router] selecting ChatGPT
[ChatGPT] continuing task
```

------------------------------------------------------------------------

# 18. Proposed Technology Stack

## Language

Python

## CLI

Typer

## Terminal UI

Rich

## HTTP

httpx

## Async execution

asyncio

## Data validation

Pydantic

## Local database

SQLite

## Event history

JSONL

## Repository awareness

Git CLI / GitPython as appropriate

## Configuration

TOML

## Testing

pytest

## Packaging

Start with a normal Python package.

Potential later distribution:

``` bash
pipx install aicli
```

or:

``` bash
pip install aicli
```

------------------------------------------------------------------------

# 19. Why Not Build the Entire System Around LiteLLM?

LiteLLM is excellent as a general LLM gateway, but it is not the natural
center of this particular project.

The intended use case is:

``` text
Multiple existing subscriptions
        |
        v
Automatic subscription-aware fallback
        |
        v
Coding agent
```

rather than:

``` text
Multiple API keys
        |
        v
Generic API gateway
        |
        v
Model routing
```

LiteLLM becomes much more relevant if the project later introduces
API-based providers and conventional model routing.

For the initial subscription-focused architecture, a dedicated
provider/session layer is more appropriate.

------------------------------------------------------------------------

# 20. Candidate Existing Projects Considered

## OmniRoute

Repository:

https://github.com/diegosouzapw/OmniRoute

Strengths:

-   Large provider ecosystem
-   Routing
-   Fallback
-   Many integrations
-   Broad feature set

Weakness:

-   Broad feature surface can make the system more complicated than
    necessary for a developer who primarily wants subscription
    switching.

It is powerful, but the project goal here is narrower:

> Reliable coding continuity across personal AI subscriptions.

------------------------------------------------------------------------

## LiteLLM

Repository:

https://github.com/BerriAI/litellm

Strengths:

-   Mature LLM gateway
-   Broad provider support
-   OpenAI-compatible interface
-   Self-hosting
-   Routing
-   Fallback
-   Observability
-   Docker support

Weakness for this project:

-   Primarily oriented toward API/provider credentials.
-   Subscription OAuth workflows are a different problem.

Conclusion:

> Excellent general LLM infrastructure, but not the ideal core for this
> subscription-aware coding-agent project.

------------------------------------------------------------------------

## Bifrost

Repository:

https://github.com/maximhq/bifrost

Strengths:

-   Modern AI gateway
-   Go implementation
-   Simple deployment
-   OpenAI-compatible API
-   Provider routing/fallback
-   Good fit for a lightweight gateway

Weakness:

-   Provider coverage and subscription integration may not match the
    exact target requirement.

Conclusion:

> Interesting alternative for generic gateway use, but not the primary
> direction for this project.

------------------------------------------------------------------------

## OpenRouter

Website:

https://openrouter.ai/

Strengths:

-   Very easy to use
-   Large model/provider ecosystem
-   Provider routing
-   Fallback
-   Single API

Weakness:

-   Cloud service
-   Not the same as routing personal subscription entitlements.

Conclusion:

> Excellent if cloud/API usage is acceptable, but not the intended
> solution for using the user's existing subscriptions.

------------------------------------------------------------------------

## CLIProxyAPI

Potentially relevant because it focuses on CLI-oriented AI providers and
OAuth-based workflows.

It is particularly interesting for:

-   Claude Code
-   Codex/OpenAI workflows
-   Gemini/Antigravity-related workflows
-   Multiple accounts
-   Load balancing
-   Local proxying

Conclusion:

> Worth studying for provider adapter and OAuth implementation ideas,
> but the custom project should maintain a clean architecture rather
> than becoming tightly coupled to one third-party implementation.

------------------------------------------------------------------------

## Subrouter

Subrouter is particularly close to the conceptual requirement because it
is designed around cycling between personal AI subscriptions when one
becomes unavailable or exhausted.

Conclusion:

> Strong reference implementation/concept to study, especially for
> subscription-oriented routing.

------------------------------------------------------------------------

# 21. The Core Architectural Principle

The most important architectural decision is:

``` text
DO NOT make provider conversation state the source of truth.
```

Instead:

``` text
                    AICLI
                      |
              +-------+-------+
              |               |
        Session State      Repository
              |               |
              +-------+-------+
                      |
                    Router
                      |
        +-------------+-------------+
        |             |             |
      Claude       ChatGPT       Copilot
```

The application's state is canonical.

Providers are replaceable workers.

------------------------------------------------------------------------

# 22. MVP Scope

The first version should NOT attempt to support every provider or every
advanced coding-agent feature.

## MVP v1

### CLI

``` bash
aicli
aicli login <provider>
aicli providers
aicli status
aicli sessions
aicli resume <session>
```

### Providers

Start with the providers for which a compliant and technically supported
authentication/interface can be established.

Potential initial targets:

``` text
Claude
OpenAI/ChatGPT
```

Then add:

``` text
GitHub Copilot
Antigravity
```

after their current supported integration mechanisms are verified.

### Core functionality

-   Authentication
-   Provider health
-   Provider selection
-   Streaming responses
-   Tool calls
-   Repository inspection
-   File editing
-   Shell execution
-   Git awareness
-   Session persistence
-   Context summarization
-   Automatic fallback
-   Resume after provider failure

------------------------------------------------------------------------

# 23. MVP Development Phases

## Phase 0 --- Provider feasibility research

Before implementing adapters, verify for each target provider:

-   Supported authentication mechanism
-   Subscription entitlement access
-   Supported API/CLI interface
-   Usage/quota visibility
-   Rate-limit behavior
-   Whether automated use is permitted
-   Whether provider-specific terms impose restrictions
-   Whether context/model APIs are compatible

This phase prevents building around an unsupported authentication
mechanism.

------------------------------------------------------------------------

## Phase 1 --- CLI Skeleton

Build:

``` text
aicli
├── login
├── logout
├── providers
├── status
├── sessions
└── code
```

Implement:

-   Configuration
-   SQLite
-   Rich UI
-   Logging
-   Session IDs

------------------------------------------------------------------------

## Phase 2 --- Provider Interface

Implement:

``` python
Provider
```

and a provider registry:

``` python
providers = {
    "claude": ClaudeProvider(),
    "openai": OpenAIProvider(),
    "copilot": CopilotProvider(),
    "antigravity": AntigravityProvider()
}
```

------------------------------------------------------------------------

## Phase 3 --- Coding Agent

Implement core tools:

``` text
read_file
write_file
edit_file
glob
grep
shell
git
test
```

Add:

-   Tool permission prompts
-   Tool result recording
-   Streaming
-   Cancellation

------------------------------------------------------------------------

## Phase 4 --- Context Manager

Record:

-   Messages
-   Tool calls
-   Tool results
-   Files
-   Git state
-   Test results
-   Task summary

Implement automatic compaction/summarization.

------------------------------------------------------------------------

## Phase 5 --- Router

Implement:

``` text
Provider selection
      |
      +-- available?
      +-- authenticated?
      +-- quota available?
      +-- cooldown?
      +-- model supported?
```

Then fallback.

------------------------------------------------------------------------

## Phase 6 --- Automatic Provider Switching

Example:

``` text
Claude
  |
  X QUOTA_EXHAUSTED
  |
  v
Checkpoint
  |
  v
ChatGPT
  |
  v
Continue
```

Test failure modes extensively.

------------------------------------------------------------------------

## Phase 7 --- Additional Providers

Add:

-   GitHub Copilot
-   Antigravity
-   Additional supported providers

Only after each provider's supported authentication/integration path is
verified.

------------------------------------------------------------------------

# 24. Context Compaction

Long coding sessions can become too large for any single model context
window.

The context manager should therefore periodically create summaries.

Example:

``` text
FULL HISTORY
     |
     v
Important decisions
     |
     +-- repository changes
     +-- architecture decisions
     +-- unresolved issues
     +-- test failures
     +-- current task
     |
     v
COMPACT CONTEXT
```

A continuation request can then contain:

``` text
Task
Current state
Important decisions
Recent tool calls
Relevant files
Git diff
Outstanding work
```

instead of the entire raw conversation.

------------------------------------------------------------------------

# 25. Context Layers

A robust implementation should have several layers.

## Layer 1 --- Repository

``` text
source code
git state
configuration
tests
```

## Layer 2 --- Task

``` text
user objective
acceptance criteria
current progress
remaining work
```

## Layer 3 --- Working memory

``` text
recent model messages
recent tool calls
current reasoning context
```

## Layer 4 --- Long-term session memory

``` text
important decisions
architecture choices
known bugs
environment information
```

## Layer 5 --- Provider-specific state

``` text
provider session ID
provider metadata
usage state
```

Layer 5 should be disposable.

Layers 1--4 are canonical.

------------------------------------------------------------------------

# 26. Security Model

The tool will potentially have access to:

-   Source code
-   Shell
-   Git credentials
-   AI subscription credentials
-   Environment variables
-   Local files

Therefore security needs to be designed from the beginning.

Important controls:

### Credentials

Use OS credential storage where possible.

Do not store long-lived secrets in plaintext configuration.

### Shell

Require confirmation for dangerous commands.

Potential categories:

``` text
SAFE
  pytest
  git status
  ls

REVIEW
  npm install
  docker compose up
  git commit

DANGEROUS
  rm -rf
  git reset --hard
  disk operations
  credential manipulation
```

### File operations

Restrict the agent to the project workspace unless explicitly allowed.

### Logging

Never log:

-   OAuth secrets
-   Access tokens
-   API keys
-   Cookies
-   Passwords

------------------------------------------------------------------------

# 27. Recovery

A provider switch should be recoverable.

Suppose:

``` text
Claude modifies 10 files
```

then crashes.

The system should preserve:

``` text
session
events
tool results
git diff
provider state
```

On restart:

``` bash
aicli resume session-001
```

should restore the task.

------------------------------------------------------------------------

# 28. Manual Provider Controls

The user should always be able to override automatic routing.

Examples:

``` bash
aicli code --provider claude
```

or inside a session:

``` text
/provider claude
/provider chatgpt
/provider auto
```

Also:

``` text
/status
/providers
/context
/diff
/compact
/checkpoint
```

------------------------------------------------------------------------

# 29. Desired Command Set

Initial CLI:

``` bash
aicli login claude
aicli login chatgpt
aicli login copilot
aicli login antigravity

aicli logout claude

aicli providers
aicli status

aicli code

aicli sessions
aicli resume <session-id>
```

Potential future commands:

``` bash
aicli config
aicli usage
aicli logs
aicli doctor
aicli export-session
```

------------------------------------------------------------------------

# 30. Example End-to-End Workflow

``` text
Developer
   |
   | aicli code
   v
Session Manager
   |
   v
Router
   |
   v
Claude
   |
   +-- inspect files
   +-- modify files
   +-- run tests
   |
   X quota exhausted
   |
   v
Checkpoint
   |
   +-- session state
   +-- git diff
   +-- task summary
   +-- tool history
   |
   v
Router
   |
   v
ChatGPT
   |
   +-- receives continuation context
   +-- inspects current repository
   +-- continues implementation
   |
   X temporary failure
   |
   v
Router
   |
   v
Antigravity
   |
   +-- continues
   |
   v
Task completed
```

------------------------------------------------------------------------

# 31. Long-Term Architecture

After the MVP works, the system could evolve into:

``` text
                         AICLI
                           |
            +--------------+--------------+
            |              |              |
         Agent          Context         Router
            |              |              |
            +--------------+--------------+
                           |
                    Provider Registry
                           |
       +---------+---------+---------+---------+
       |         |         |         |         |
     Claude   OpenAI    Copilot  Antigravity  ...
```

Additional features could include:

-   Multiple accounts per provider
-   Provider health scoring
-   Adaptive routing
-   Model capability detection
-   Parallel model consultation
-   Automatic task decomposition
-   Cost tracking for API providers
-   Local Ollama models
-   Offline fallback
-   Local embeddings
-   Semantic repository search
-   MCP support
-   Plugin architecture
-   Team/shared configuration
-   Remote execution
-   Web dashboard

------------------------------------------------------------------------

# 32. Integration With Local Models

Because the project is intended to work locally, Ollama can eventually
be another provider:

``` text
Claude
ChatGPT
Copilot
Antigravity
Ollama
   |
   v
AICLI Router
```

This provides a useful fallback when all subscription providers are
unavailable.

For example:

``` text
Cloud providers exhausted
        |
        v
Ollama local model
        |
        v
Continue development
```

Local models may not provide equivalent quality, but they can still be
useful for:

-   Simple refactoring
-   Code formatting
-   Documentation
-   Test generation
-   Repository search
-   Small fixes

------------------------------------------------------------------------

# 33. Relationship to the Existing Aether Project

The same architecture can eventually integrate with the user's broader
Aether platform.

Potentially:

``` text
Aether
 |
 +-- AI Gateway
 |
 +-- Local Ollama
 |
 +-- Qdrant
 |
 +-- RAG
 |
 +-- AICLI
```

The CLI could remain independent while using shared infrastructure
later.

------------------------------------------------------------------------

# 34. Important Reality Check

The routing/session architecture is straightforward to build.

The difficult parts are:

1.  Provider authentication
2.  Subscription entitlement access
3.  Quota detection
4.  Provider-specific APIs/CLI protocols
5.  Maintaining compatibility as providers change
6.  Staying within each provider's supported usage and terms

Therefore, the implementation should separate:

``` text
CORE ENGINE
```

from:

``` text
PROVIDER ADAPTERS
```

This way, if one provider changes its authentication mechanism, only
that adapter needs to be updated.

------------------------------------------------------------------------

# 35. Recommended Project Structure

A possible starting structure:

``` text
aicli/
├── pyproject.toml
├── README.md
├── LICENSE
│
├── src/
│   └── aicli/
│       ├── __init__.py
│       ├── cli.py
│       │
│       ├── agent/
│       │   ├── agent.py
│       │   ├── tools.py
│       │   ├── permissions.py
│       │   └── streaming.py
│       │
│       ├── router/
│       │   ├── router.py
│       │   ├── policies.py
│       │   ├── health.py
│       │   └── fallback.py
│       │
│       ├── providers/
│       │   ├── base.py
│       │   ├── registry.py
│       │   ├── claude.py
│       │   ├── openai.py
│       │   ├── copilot.py
│       │   └── antigravity.py
│       │
│       ├── context/
│       │   ├── manager.py
│       │   ├── summarizer.py
│       │   ├── checkpoint.py
│       │   └── compaction.py
│       │
│       ├── repository/
│       │   ├── git.py
│       │   ├── files.py
│       │   └── workspace.py
│       │
│       ├── storage/
│       │   ├── database.py
│       │   ├── models.py
│       │   └── events.py
│       │
│       ├── auth/
│       │   ├── manager.py
│       │   └── credentials.py
│       │
│       └── ui/
│           ├── console.py
│           ├── panels.py
│           └── status.py
│
└── tests/
    ├── test_router.py
    ├── test_context.py
    ├── test_session.py
    └── providers/
```

------------------------------------------------------------------------

# 36. Recommended Development Order

Do not start by implementing all four providers.

Build in this order:

``` text
1. CLI skeleton
        ↓
2. Session storage
        ↓
3. Coding-agent tools
        ↓
4. Context manager
        ↓
5. One provider adapter
        ↓
6. Router
        ↓
7. Automatic fallback
        ↓
8. Second provider
        ↓
9. Third provider
        ↓
10. Fourth provider
```

This allows the architecture to be tested before provider complexity is
introduced.

------------------------------------------------------------------------

# 37. Final Design Principle

The central idea of the project is:

``` text
                  YOUR STATE
                      |
          +-----------+-----------+
          |                       |
       PROJECT                  SESSION
          |                       |
          +-----------+-----------+
                      |
                   AICLI
                      |
                    ROUTER
                      |
       +--------------+--------------+
       |              |              |
    Claude         ChatGPT        Copilot
       |              |              |
       +--------------+--------------+
                      |
                 Antigravity
```

The provider is temporary.

The project state is permanent.

The session belongs to the user.

The router decides which authorized provider should perform the next
piece of work.

That architecture gives the system the best chance of providing the
desired **uninterrupted development workflow across multiple AI
subscriptions without attempting to transfer proprietary provider-side
conversation state.**

------------------------------------------------------------------------

# 38. Immediate Next Step

Before writing the full implementation, the next technical step should
be a **September 2026 provider feasibility audit** covering:

-   ChatGPT subscription authentication
-   Claude subscription authentication
-   GitHub Copilot subscription authentication
-   Antigravity authentication
-   Current supported CLI/API interfaces
-   Quota/usage detection
-   Automatic fallback feasibility
-   Provider terms and supported automation
-   Windows + WSL2 compatibility

Only after that audit should the actual provider adapters be
implemented.

The core AICLI engine can be developed independently of those findings.
