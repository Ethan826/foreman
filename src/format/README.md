# Format

Decoders for the output of the two agent clients: Claude's `--output-format json` result and stream-json events, and Codex's `codex exec --json` events and app-server rate-limit response. Back to [how it works](../../docs/how-it-works.md).

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
