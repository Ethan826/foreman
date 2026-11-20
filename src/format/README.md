# Format

Decoders for the output of the two agent clients: Claude's `--output-format json` result and stream-json events, and Codex's `codex exec --json` events and app-server rate-limit response. The later sections cover the other decoders and the briefs Format writes for the clients. Back to [how it works](../../docs/how-it-works.md).

May import: `domain`.

Format is a pure core layer. It may import Domain and nothing else of ours, and not Features: that is stricter than the shared skill reference, as `AGENTS.md` records. The lint table also bars Node and Bun imports here, so a decoder takes parsed data and returns a `Result`. Reading a process stream belongs to Runtime.

Almost every field is optional. Live test L1 (2026-11-16) settled the shape of Claude's `rate_limit_info`: `unifiedWindows` maps a window name to a fraction used and a reset time in Unix seconds. Live test L2 confirmed the Codex rate-limit response. Unknown extra fields are ignored, and an event type that is not listed fails to decode; the shell decides what an undecodable line means. Wire tags live in `ClaudeEventTypes`, `ClaudeSystemSubtypes` and `CodexEventTypes`.

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

[`rev-parse.ts`](rev-parse.ts) decodes single-value `git rev-parse` output with `decodeRevParseLine`, `decodeRevParsePath` and `decodeRevParseRevision` (the owner's `rev-parse HEAD`). Each removes exactly one trailing newline, so a newline inside a path survives; the path decoder also requires an absolute path.

[`name-status.ts`](name-status.ts) decodes `git diff-tree -r --name-status -z <base> <tree>`, the changed paths a review brief lists, with `decodeNameStatus`. Each record holds a status and one path, or for a rename or copy a status with its score and two paths. Each `ChangedPath` keeps the status as git printed it, since the brief shows it to the reviewer as it is, and git's status letters are known only here. Empty output is no changes. Output that does not end in a NUL, an unknown status, an empty path or a record cut short is `NameStatusUndecodable`, never a shorter list.

## Snapshot blob ids

[`blob-id.ts`](blob-id.ts) holds `blobId`, git's id of a blob: the SHA-1 of the header `blob <size>`, a NUL and the raw bytes, as 40 lowercase hexadecimal digits. A symbolic link's blob is its link text. No conversion is applied, so the id is that of the bytes as they are on disk, which is what the snapshot's raw checks compare with the tree. The digest is injected; Runtime passes the platform's SHA-1, and `test/format/blob-id.test.ts` checks the result against `git hash-object`. `isSha1ObjectFormat` accepts a `rev-parse --show-object-format` run only when it exited 0 and printed exactly `sha1`, so a SHA-256 repository is refused.

## Process listing

[`ps.ts`](ps.ts) decodes `ps -A -o pid,pgid,lstart,command` as BSD ps and procps print it under `LC_ALL=C` with `decodePs`. The start time keeps the fixed `lstart` layout as text, and the command is the rest of the line. Decoding is strict: a missing final newline, another header or any row that does not decode fails the whole listing with `ProcessListingUndecodable`, because a skipped row would hide a process from the evidence. `startTimeOf` reads one pid's start time, or none, which is how the leader's start is read right after spawn.

## Findings and briefs

[`findings.ts`](findings.ts) decodes a reviewer's findings with `decodeFindingsBlock`: the last fenced block of the final message whose info string is exactly `json`, read as a list of findings. Fences follow CommonMark 0.31.2, section 4.5. Earlier blocks are not read, so a malformed draft followed by a valid block decodes. No block is `NoFindingsBlock`, and a block that is not a list of findings is `MalformedFindings`. `renderFindingsDraft` renders the owner's draft `findings.md` from the list; an empty list renders as "No findings."

[`brief.ts`](brief.ts) writes each client's brief from contents Program passes in, with no I/O. `implementBrief` gives the task. `reviewBrief` gives the snapshot tree, the base revision, the coverage statement (`snapshotCoverage`) and the task. It lists the changed paths, each quoted as a JSON string so a newline cannot pass for a new entry, adds the last handoff, and ends by asking for the findings block. `correctBrief` gives the task, the owner's findings file, the prior handoff and the tree. Every brief tells the agent it works in a fresh session.

## Configuration

[`foreman-config.ts`](foreman-config.ts) decodes the configuration file with `decodeForemanConfig`: one JSON object with the project's id, the state directory, the owner's checkout, the supervisor worktree's path and branch name, the root `.gitattributes` allowance (decision M09), the client version pins, the Claude settings file and, optionally, each role's grant estimate. A file without estimates gets the policy's `initialEstimate` for every role. Decoding is strict: an unknown or missing key, a relative path, an empty pin or a value out of range refuses the whole file with `ConfigUndecodable`, because a key the decoder ignored could be a setting the owner believes is in force.
