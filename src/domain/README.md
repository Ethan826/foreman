# Domain

Built. Plain data and validators. They cover what the other layers pass around: identifiers, clients, roles, steps, outcomes, usage observations, windows, pacing policy. Back to [how it works](../../docs/how-it-works.md).

May import: nothing.

Domain sits at the center of the layer table in `eslint.rules.js`, so every other layer can depend on it and it depends on none of them. Outside `effect`, it imports nothing, which keeps it free of process, file and clock code and easy to test.

Conventions: each closed vocabulary (clients, roles, windows, observation sources, commit refusals) is a named `as const` object, and its schema derives from that object. Schemas and their types share a name. Times are epoch milliseconds on the supervisor's local clock. [`holds.ts`](holds.ts) is an empty placeholder (planned): hold types wait for the approved design.

The diagrams show type names and the main relations. They do not show every field or its constraints; read the source for those.

## Identifiers, vocabularies and steps

```mermaid
classDiagram
    class TrancheId {
        <<branded string>>
        slug, 1 to 64 characters
    }
    class OpId {
        <<branded string>>
        slug, 1 to 64 characters
    }
    class WaiverId {
        <<branded string>>
        slug, 1 to 64 characters
    }
    class Revision {
        <<branded string>>
        40 or 64 hex digits
    }
    class Clients {
        <<constants>>
        Claude = claude
        Codex = codex
    }
    class Client {
        <<schema, literals>>
    }
    class Roles {
        <<constants>>
        Implementer = implementer
        Reviewer = reviewer
        Corrector = corrector
    }
    class Role {
        <<schema, literals>>
    }
    class RoleClients {
        <<schema, record>>
        one Client per Role
    }
    class defaultRoleClients {
        <<value>>
    }
    class Step {
        <<schema, struct>>
        role
        round
    }
    class Windows {
        <<constants>>
        FiveHour = fiveHour
        Weekly = weekly
    }
    class Window {
        <<schema, literals>>
    }

    Client ..> Clients : values
    Role ..> Roles : values
    Window ..> Windows : values
    RoleClients --> Role : keys
    RoleClients --> Client : values
    defaultRoleClients ..> RoleClients : instance of
    Step --> Role
```

## Outcomes

A step ends in a `StepOutcome`. A commit ends in a `CommitOutcome`. A tranche ends in a `TrancheEnd`. Each member is a tagged class, and each union is a schema.

```mermaid
classDiagram
    class StepOutcome {
        <<union>>
    }
    class Success
    class ChangesRequested
    class RateLimited {
        windows
    }
    class AuthFailed
    class PermissionDenied
    class MaxTurns
    class Crashed {
        signal
    }
    class Unclassified

    StepOutcome <|-- Success
    StepOutcome <|-- ChangesRequested
    StepOutcome <|-- RateLimited
    StepOutcome <|-- AuthFailed
    StepOutcome <|-- PermissionDenied
    StepOutcome <|-- MaxTurns
    StepOutcome <|-- Crashed
    StepOutcome <|-- Unclassified

    class CommitOutcome {
        <<union>>
    }
    class Committed {
        revision
        changedPaths
    }
    class NothingToCommit
    class CommitRefused {
        reason
    }
    class CommitFailed {
        error
    }
    class CommitRefusals {
        <<constants>>
        ProtectedPath = protectedPath
        HeadMoved = headMoved
    }
    class CommitRefusal {
        <<schema, literals>>
    }

    CommitOutcome <|-- Committed
    CommitOutcome <|-- NothingToCommit
    CommitOutcome <|-- CommitRefused
    CommitOutcome <|-- CommitFailed
    CommitRefusal ..> CommitRefusals : values
    CommitRefused --> CommitRefusal
    Committed --> Revision
    RateLimited --> Window

    class TrancheEnd {
        <<union>>
    }
    class Passed
    class Abandoned
    class NotConverged

    TrancheEnd <|-- Passed
    TrancheEnd <|-- Abandoned
    TrancheEnd <|-- NotConverged
```

## Observations and policy

An `Observation` is one usage reading. A `Policy` says which windows are checked for each provider and how much to hold back. `defaultPolicy` lists the Claude windows and none for Codex, pending live test L2.

```mermaid
classDiagram
    class ObservationSources {
        <<constants>>
        ClaudeRateLimitEvent
        ClaudeStatusline
        ClaudeUsagePrompt
        CodexAppServer
    }
    class ObservationSource {
        <<schema, literals>>
    }
    class Observation {
        <<schema, struct>>
        provider
        window
        usedPercent
        resetsAt, optional
        observedAt
        source
    }
    class WindowPolicy {
        <<schema, struct>>
        window
        reservePercent
    }
    class ProviderPolicy {
        <<schema, struct>>
        windows, each listed once
    }
    class Policy {
        <<schema, struct>>
        providers
        freshnessMillis
        initialEstimate
    }
    class defaultPolicy {
        <<value>>
    }

    ObservationSource ..> ObservationSources : values
    Observation --> Client : provider
    Observation --> Window
    Observation --> ObservationSource
    WindowPolicy --> Window
    ProviderPolicy "1" o-- "*" WindowPolicy
    Policy "1" o-- "*" ProviderPolicy : one per Client
    defaultPolicy ..> Policy : instance of
```

Read next: [Format](../format/README.md) and [Features](../features/README.md), which import these types.
