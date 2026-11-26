# Format

Decoders for the output of the two agent clients: Claude's `--output-format json` result and stream-json events, and Codex's `codex exec --json` events and app-server rate-limit response. The later sections cover the other decoders and the briefs Format writes for the clients. Back to [how it works](../../docs/how-it-works.md).

May import: `domain`.

Format is a pure core layer. It may import Domain and nothing else of ours, and not Features: that is stricter than the shared skill reference, as `AGENTS.md` records. The lint table also bars Node and Bun imports here, so a decoder takes parsed data and returns a `Result`. Reading a process stream belongs to Runtime.

Almost every field is optional. Live test L1 (2026-11-16) settled the shape of Claude's `rate_limit_info`: `unifiedWindows` maps a window name to a fraction used and a reset time in Unix seconds. Live test L2 confirmed the Codex rate-limit response. Unknown extra fields are ignored, and an event type that is not listed fails to decode; the shell decides what an undecodable line means. Wire tags live in `ClaudeEventTypes`, `ClaudeSystemSubtypes` and `CodexEventTypes`. For classification, [`stream-line.ts`](stream-line.ts) reads one stream line at a time. An event of a type that bears no outcome, such as Claude's `assistant` message or a Codex `item.started`, is passed over. An outcome-bearing event (Claude's `result`; Codex's `turn.completed`, `turn.failed` and `error`) must decode, and a line that is not JSON or not an object with a string `type` is malformed. `claudeStreamLine` and `codexStreamLine` apply it to each client. `reportsCompletedTurn` and `reportsFailure` answer for a Codex event, so the Codex wire tags stay in Format.

The diagram shows the event and response types. The decoder functions are `decodeClaudeResult`, `decodeClaudeRateLimitEvent`, `decodeClaudeApiRetry`, `decodeClaudeEvent`, `decodeCodexEvent` and `decodeCodexRateLimitsResponse`. It does not show field names or optionality.

```mermaid
classDiagram
    class ClaudeEventTypes {
        <<constants>>
    }
    class ClaudeSystemSubtypes {
        <<constants>>
    }
    class ClaudeEvent {
        <<union>>
    }
    class ClaudeResult
    class ClaudeRateLimitEvent
    class ClaudeApiRetry
    ClaudeEvent <|-- ClaudeResult
    ClaudeEvent <|-- ClaudeRateLimitEvent
    ClaudeEvent <|-- ClaudeApiRetry
    ClaudeResult ..> ClaudeEventTypes : type tag
    ClaudeRateLimitEvent ..> ClaudeEventTypes : type tag
    ClaudeApiRetry ..> ClaudeEventTypes : type tag
    ClaudeApiRetry ..> ClaudeSystemSubtypes : subtype tag

    class CodexEventTypes {
        <<constants>>
    }
    class CodexEvent {
        <<union>>
    }
    class CodexThreadStarted
    class CodexTurnStarted
    class CodexTurnCompleted
    class CodexTurnFailed
    class CodexError
    CodexEvent <|-- CodexThreadStarted
    CodexEvent <|-- CodexTurnStarted
    CodexEvent <|-- CodexTurnCompleted
    CodexEvent <|-- CodexTurnFailed
    CodexEvent <|-- CodexError
    CodexThreadStarted ..> CodexEventTypes : type tag
    CodexTurnStarted ..> CodexEventTypes : type tag
    CodexTurnCompleted ..> CodexEventTypes : type tag
    CodexTurnFailed ..> CodexEventTypes : type tag
    CodexError ..> CodexEventTypes : type tag

    class CodexRateLimitsResponse
    class CodexRateLimitWindow
    CodexRateLimitsResponse "1" o-- "0..2" CodexRateLimitWindow : primary, secondary
```

`claudeWindowReadings` turns a decoded `rate_limit_event` into one reading per tracked window (five-hour and weekly), in percent and epoch milliseconds. A window without a utilization gives no reading. The shell adds the observation stamps and the ledger `seq` to make an `Observation`. Codex readings wait for the owner's decision on how Codex reset times open periods (O14).

## Worktree listing

[`worktree-list.ts`](worktree-list.ts) decodes `git worktree list --porcelain -z` into Domain's `WorktreeEntry` values with `decodeWorktreeList`. Attributes end in NUL and a record ends at an empty field, so a path holding a newline stays whole. Without `-z`, git prints paths raw and a newline splits the record. A `locked` attribute with no reason decodes as a lock without one. Attributes it does not use, such as `prunable`, are ignored.

[`tree-listing.ts`](tree-listing.ts) decodes one `git ls-tree -z` run with `decodeTreeRun` (plan B11c). Exit 0 decodes each NUL-terminated `<mode> <type> <object>\t<path>` record into Domain's `TreeEntry`, with the path verbatim and git's type word (`blob`, `tree`, `commit`) mapped to Domain's `TreeEntryTypes` value; those words are known only to this decoder. Any other exit is `TreeNotListed`. Output that is not NUL-terminated, or any record of another shape, is `TreeUndecodable`, which the attribute check refuses, so a bad listing never passes as an empty one.

[`rev-parse.ts`](rev-parse.ts) decodes single-value `git rev-parse` output with `decodeRevParseLine`, `decodeRevParsePath` and `decodeRevParseRevision` (the owner's `rev-parse HEAD`). Each removes exactly one trailing newline, so a newline inside a path survives; the path decoder also requires an absolute path. `decodeIdentityRun` decodes one identity read of the startup check: a run that exited 0 into the path it printed, a non-zero exit whose last stderr line begins with git's `fatal: not a git repository` into `IdentityNoRepository`, whatever lines come before it (such as Apple Git's temporary-directory warnings) and keeping all of stderr, and any other non-zero exit into `IdentityUnread`, which Program reports as a git failure rather than a reading. git runs with no locale variables, so its messages are untranslated.

[`name-status.ts`](name-status.ts) decodes `git diff-tree -r --name-status -z <base> <tree>`, the changed paths a review brief lists, with `decodeNameStatus`. Each record holds a status and one path, or for a rename or copy a status with its score and two paths. Each `ChangedPath` keeps the status as git printed it, since the brief shows it to the reviewer as it is, and git's status letters are known only here. Empty output is no changes. Output that does not end in a NUL, an unknown status, an empty path or a record cut short is `NameStatusUndecodable`, never a shorter list.

## Snapshot blob ids

[`blob-id.ts`](blob-id.ts) holds `blobId`, git's id of a blob: the SHA-1 of the header `blob <size>`, a NUL and the raw bytes, as 40 lowercase hexadecimal digits. A symbolic link's blob is its link text. No conversion is applied, so the id is that of the bytes as they are on disk, which is what the snapshot's raw checks compare with the tree. The digest is injected; Runtime passes the platform's SHA-1, and `test/format/blob-id.test.ts` checks the result against `git hash-object`. `isSha1ObjectFormat` accepts a `rev-parse --show-object-format` run only when it exited 0 and printed exactly `sha1`, so a SHA-256 repository is refused.

[`path-list.ts`](path-list.ts) holds `decodePathList`, the strict decoder for a NUL-terminated path list as `git ls-files -z` prints it, which the snapshot's preflight reads (review finding B08). Each path is kept verbatim, a directory with its trailing slash. Output that does not end in a NUL, or holds an empty path, is `PathListUndecodable`, never a shorter list.

## Process listing

[`ps.ts`](ps.ts) decodes `ps -A -o pid,pgid,lstart,command` as BSD ps and procps print it under `LC_ALL=C` with `decodePs`. The start time keeps the fixed `lstart` layout as text, and the command is the rest of the line. A process group of 0 decodes, since procps on Linux lists kernel threads such as `kthreadd` there; a pid of 0 does not. Decoding is strict: a missing final newline, another header or any row that does not decode fails the whole listing with `ProcessListingUndecodable`, because a skipped row would hide a process from the evidence. `startTimeOf` reads one pid's start time, or none, which is how the leader's start is read right after spawn.

## Findings and briefs

[`findings.ts`](findings.ts) decodes a reviewer's findings with `decodeFindingsBlock`: the last fenced block of the final message whose info string is exactly `json`, read as a list of findings. Fences follow CommonMark 0.31.2, section 4.5. Earlier blocks are not read, so a malformed draft followed by a valid block decodes. No block is `NoFindingsBlock`, and a block that is not a list of findings is `MalformedFindings`. So is a list in which two findings share an id, with the reason `finding id <id> appears more than once` (v0.2.0): later commands name a finding by its id, so the review is then `Unclassified` and records no findings in the log. The review brief ([`brief.ts`](brief.ts)) asks for distinct ids. `renderFindingsDraft` renders the owner's draft `findings.md` from the list; an empty list renders as "No findings."

[`brief.ts`](brief.ts) writes each client's brief from contents Program passes in, with no I/O. `implementBrief` gives the task. `reviewBrief` gives the snapshot tree, the base revision, the coverage statement (`snapshotCoverage`) and the task. It lists the changed paths, each quoted as a JSON string so a newline cannot pass for a new entry, adds the last handoff, and ends by asking for the findings block. `correctBrief` gives the task, the owner's findings file, the prior handoff and the tree. Every brief tells the agent it works in a fresh session. `implementBrief` and `correctBrief` also take the configured check commands. When there are any, "What to do" ends with one line that names them in order and says they run in the Bash sandbox. With none, the brief is unchanged. The review brief never names them.

Every brief also takes the session's owner rulings (Domain's `Ruling`, v0.2.0) and lists them in an "Owner rulings" section right after the task, in session order, one entry per ruling separated by a blank line: `R1: <text>`, with `(supersedes R1)` and then `(superseded by R3)` after the id when they apply, or `None.` when there is none. In the review brief the section ends with the sentence that a ruling settles its point, so a finding that contradicts one must cite its id and say why it does not cover the case. Since the rulings are in the brief, the brief's recorded hash covers them.

## Configuration

[`tarlatan-config.ts`](tarlatan-config.ts) decodes the configuration file with `decodeTarlatanConfig`: one JSON object with the project's id, the state directory, the owner's checkout, the supervisor worktree's path and branch name, the ledger's directory, the root `.gitattributes` allowance (decision M09) and the client version pins. The allowance may name no line or Waxwing's one line, and nothing else (batch review B06); the target binding keeps it to the state directory it was first used with. The ledger directory may be left out; `ledgerDirOf` then gives the design's default, `<HOME>/.tarlatan`, from tarlatan's own `HOME`, and refuses when that is unset. The file cannot name a Claude settings file, since tarlatan writes the editing profile itself (batch review B03). It cannot set a grant estimate either: every role reserves the policy's `initialEstimate` of 15 points (decision P5, batch review B10). Every path must be absolute and normalized, with no `.` or `..` component and no doubled or trailing slash, because the layout check compares paths after resolving links (batch review B05). Decoding is strict: an unknown or missing key, a relative path, an empty pin or a value out of range refuses the whole file with `ConfigUndecodable`, because a key the decoder ignored could be a setting the owner believes is in force.

The file may list `checkCommands`, the commands the editing profile lets Claude run (dogfood-3b). Each entry is one command as the agent types it. [`check-command.ts`](check-command.ts) holds the rule: an entry must be non-empty and at most 200 characters, use only letters, digits, space and `._/:=@+-`, and have no leading, trailing or doubled space. `git` and `curl`, bare or with arguments, are refused, and so is an entry listed twice. These checks read the text only. They do not tell how the shell will run it: `PORT=1 git log` passes. A refused entry fails the whole file with a reason that names it. An entry that is not a string is named by its index and its kind, such as a number or a list. A missing key means no check commands. They are not part of the target binding, so changing them is not a `TargetMismatch`.

[`claude-settings.ts`](claude-settings.ts) renders the settings file of Claude's editing profile with `claudeEditingSettings(identity, checkCommands)`, for the session's recorded git identity: the worktree's path, its own git directory and the repository's common git directory. The template follows the design's "Permissions" section and is the template the L3 subset renders. The Read and Edit tool rules allow reads and edits only under the worktree. The Edit tool rules also deny edits to its `.git` and to the protected names at any depth. Commands run with the Bash tool can read outside the worktree. The commands allowed are `git status` and `git diff`, with or without arguments, and the configured check commands. `git commit`, `git push`, `git config`, `curl` and the web tools are denied. The Bash sandbox stays on: it must start, unsandboxed commands are refused, the protected names at the top level are not writable, and no domain is reachable. Below the top level, only the Edit tool rules protect those names. The sandbox also denies writes to the common git directory and the worktree's own git directory, each as a whole (owner ruling of 2026-11-23). The L3 run's case C4 showed that code run in the sandbox could commit and move the supervisor branch in the common git directory; with both denied it cannot write an object, a ref, a hook or the index. `git status` and `git diff` then cannot refresh the index, which git skips without an error, and their output stays correct. Each configured check command is allowed by one exact `Bash(<command>)` rule, in order, after the `git diff` rules. There is no `<command> *` form. With no check commands the file is byte for byte what it was before. An exact rule limits only the command line the agent types. A command such as `bun run verify` runs scripts, lint rules and tests that the agent can edit. So a configured check can run any code inside the Bash sandbox. The sandbox is the guard: the git directories and the top-level protected names are not writable. It has no network, and it refuses unsandboxed commands. Refusing `git` and `curl` only catches a typo. The template refuses a check command the decoder would refuse with `CheckCommandRefused`, as a second guard; an unsafe path is reported first. It sets `disableClaudeAiConnectors` as a second guard against claude.ai connectors; the first is the argv's `--strict-mcp-config`. The argv's `--setting-sources project,local` keeps out user settings and hooks (owner ruling of 2026-11-20, L03). Any of the three paths that is not absolute, has a doubled or trailing slash, or holds a character other than letters, digits, `.`, `_`, `+`, `-` and `/` fails with `ProfilePathUnsafe`, since a rule could read such a character as syntax.

[`target-binding.ts`](target-binding.ts) writes and reads the target binding file (batch review B04): one JSON object with a final newline. Decoding is strict, so a file with an unknown or missing key is unreadable rather than half understood. So is a file whose ledger path is not absolute, with a reason that says so: tarlatan only records absolute paths, and a relative one would open the ledger relative to the working directory (owner finding F11).

[`byte-order-mark.ts`](byte-order-mark.ts) holds `withoutByteOrderMark`, which both of those decoders apply first. Some editors begin a UTF-8 file with a byte order mark, and the strict decoder keeps it as U+FEFF, which JSON refuses. The function drops exactly one mark at the very start, as 9fee8a5 did (focused re-review finding 2). A second mark, a mark after whitespace and a mark inside a value stay as text. Bytes that are not UTF-8 are refused before this point, and git's output keeps its mark.
