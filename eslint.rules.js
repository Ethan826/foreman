// House-rule lint configuration for foreman.
//
// Provenance: adapted from the owner's lsatchapelhill project
// (eslint-fp-rules.js and apps/api/eslint.config.js): the loop, throw, try,
// async, Promise, array[0], .push, .length, instanceof and JSON selectors, the
// eslint-plugin-functional rules (no-loop-statements, no-throw-statements,
// immutable-data), the typescript-eslint strictTypeChecked and
// stylisticTypeChecked presets, generic array types, and the layer-import
// rule (there import/no-restricted-paths, here the core no-restricted-imports,
// so no import plugin is installed). Left out: React, tenant, Stripe, jsdoc,
// tsdoc, import sorting, prettier, quote and semicolon style.
// Added from the effect-v4 and readable-functional-code skills: the Schema
// sync and decode bans, Effect.run*, Effect.promise, _tag reads, casts,
// non-null assertions, arrow-function style, no let.
//
// Added after an idiom audit (2026-11-14): in core layers (src/domain,
// src/features, src/format) native array, string and Object methods and
// null or undefined comparisons are banned, because the effect-v4 skill
// replaces them with the Array, String, Record and Option modules. The
// method ban uses core no-restricted-properties with `allowObjects`; it is
// name-based, not type-aware (neither typescript-eslint nor
// eslint-plugin-functional has a rule keyed on the receiver's type). Blind
// spots: a receiver whose name is an Effect module name (a local `Option`
// or `Arr` holding a plain array) escapes; an Effect module imported under
// an alias not listed in effectModules is flagged (a false positive, so
// add the alias here); a method reached without naming it (`Reflect.apply`,
// a helper outside core) escapes; methods not in the lists below escape.
// The comparison ban matches the literal `null`, the identifier
// `undefined` and `typeof x === "undefined"`; a comparison against a
// variable that holds undefined escapes.
//
// Exported as a factory so the gate-integrity fixtures (lint-fixtures/) run
// the same rules under their own tsconfig. No rule here may be switched off
// by a comment; AGENTS.md forbids lint-disable comments.
import js from "@eslint/js"
import functional from "eslint-plugin-functional"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

const message = (selector, text) => ({ selector, message: text })

const loops = [
  message("ForStatement", "Use Array.map / filter / Effect.forEach, not for."),
  message("ForInStatement", "Use Record.keys / Record.toEntries, not for...in."),
  message("ForOfStatement", "Use Array.map / Effect.forEach, not for...of."),
  message("WhileStatement", "Use a combinator or recursion, not while."),
  message("DoWhileStatement", "Use a combinator or recursion, not do...while."),
]

const collections = [
  message(
    "MemberExpression[computed=true][property.type='Literal'][property.value=0]",
    "Use Array.head (returns Option) instead of array[0].",
  ),
  message(
    "CallExpression[callee.property.name='push']",
    "Use Array.append / Array.appendAll instead of .push().",
  ),
  message(
    "MemberExpression[property.name='length']:not(CallExpression > .callee)",
    "Use Array.isReadonlyArrayEmpty / Array.isReadonlyArrayNonEmpty / Array.length.",
  ),
]

const failures = [
  message("TryStatement", "Use Effect.try / Effect.catchTag, not try/catch."),
  message("ThrowStatement", "Use Effect.fail with a tagged error, not throw."),
  message(
    "BinaryExpression[operator='instanceof']",
    "Use Match.tag or Schema.is, not instanceof.",
  ),
  message(
    "MemberExpression[property.name='_tag']",
    "Do not read _tag; use Match.tag or a guard such as Schema.is.",
  ),
  message(
    "BinaryExpression[operator='in'][left.value='_tag']",
    "Do not test for _tag; use Match.tag or a guard such as Schema.is.",
  ),
]

const asynchrony = [
  message("NewExpression[callee.name='Promise']", "No Promise in core code."),
  message("MemberExpression[object.name='Promise']", "No Promise in core code."),
  message("TSTypeReference[typeName.name='Promise']", "No Promise in core code."),
  message("AwaitExpression", "No await in core code."),
  message("FunctionDeclaration[async=true]", "No async function in core code."),
  message("FunctionExpression[async=true]", "No async function in core code."),
  message("ArrowFunctionExpression[async=true]", "No async function in core code."),
]

const throwingSchema =
  "decode|decodeSync|decodeUnknownSync|encodeSync|encodeUnknownSync|" +
  "decodePromise|decodeUnknownPromise|encodePromise|encodeUnknownPromise|asserts"

const effectBans = [
  message(
    `MemberExpression[object.name=/^(Schema|S)$/][property.name=/^(${throwingSchema})$/]`,
    "Schema.decode and the Sync, Promise and asserts forms throw or reject or are v3 names; use decodeUnknownEffect / decodeUnknownResult / decodeUnknownOption.",
  ),
  message(
    "MemberExpression[object.name='Effect'][property.name=/^(runSync|runPromise|runFork|runSyncExit|runPromiseExit|promise)$/]",
    "Core code builds Effects; running them belongs to Program or the entrypoint. Use Effect.tryPromise, not Effect.promise.",
  ),
  message(
    "MemberExpression[object.name=/^(Option|Result)$/][property.name=/^getOrThrow/]",
    "getOrThrow throws; use match or getOrElse.",
  ),
]

const parsing = [
  message("MemberExpression[object.name='JSON']", "JSON.parse and JSON.stringify throw; use Schema.fromJsonString."),
]

const nullish = [
  message(
    "BinaryExpression[operator=/^[!=]==?$/]:matches([left.type='Identifier'][left.name='undefined'], [right.type='Identifier'][right.name='undefined'])",
    "Comparing with undefined: use Option.fromNullishOr where the value enters core, then Option.match.",
  ),
  message(
    "BinaryExpression[operator=/^[!=]==?$/]:matches([left.type='Literal'][left.raw='null'], [right.type='Literal'][right.raw='null'])",
    "Comparing with null: use Option.fromNullishOr where the value enters core, then Option.match.",
  ),
  message(
    "BinaryExpression[operator=/^[!=]==?$/] > UnaryExpression[operator='typeof']",
    "typeof comparisons: use Option.fromNullishOr or a Predicate guard such as Predicate.isString.",
  ),
  message(
    "LogicalExpression[operator='??']",
    "?? on a nullable value: use Option.getOrElse, or Combiner/Reducer for a merge.",
  ),
  message(
    "ChainExpression",
    "Optional chaining on a nullable value: use Option.map / Option.flatMap.",
  ),
]

const nativeCollections = [
  message(
    "NewExpression[callee.name=/^(Set|Map|WeakSet|WeakMap)$/]",
    "Native Set and Map are mutable; use HashSet / HashMap, or Array.dedupe.",
  ),
]

const noRestrictedSyntax = (...groups) => ["error", ...groups.flat()]

// Every namespace the effect package exports, plus the aliases this code
// base imports them under. Members of these are Effect functions, not
// native methods.
const effectModules = [
  "Arbitrary", "Array", "BigDecimal", "BigInt", "Boolean", "Brand", "Bytes",
  "ByteSize", "Cache", "Cause", "Channel", "ChannelSchema", "Chunk", "Clock",
  "Combiner", "Config", "ConfigProvider", "Console", "Context", "Cron", "Data",
  "DateTime", "Deferred", "Differ", "Duration", "Effect", "Effectable",
  "Equal", "Equivalence", "ErrorReporter", "ExecutionPlan", "Exit", "Fiber",
  "FiberHandle", "FiberMap", "FiberSet", "FileSystem", "Filter", "Formatter",
  "Function", "Glob", "Graph", "Hash", "HashMap", "HashRing", "HashSet", "HKT",
  "Inspectable", "Iterable", "JsonPatch", "JsonPointer", "JsonSchema", "Latch",
  "Layer", "LayerMap", "LayerRef", "Logger", "LogLevel", "ManagedRuntime",
  "Match", "Metric", "MutableHashMap", "MutableHashSet", "MutableList",
  "MutableRef", "Newtype", "NonEmptyIterable", "Number", "Optic", "Option",
  "Order", "Ordering", "PartitionedSemaphore", "Path", "Pipeable",
  "PlatformError", "Pool", "Predicate", "PrimaryKey", "PubSub", "Pull", "Queue",
  "Random", "Rational", "RcMap", "RcRef", "Record", "Redactable", "Redacted",
  "Reducer", "Ref", "References", "RegExp", "Request", "RequestResolver",
  "Resource", "Result", "Runtime", "Schedule", "Scheduler", "Schema",
  "SchemaAST", "SchemaGetter", "SchemaIssue", "SchemaParser",
  "SchemaRepresentation", "SchemaTransformation", "Scope", "ScopedCache",
  "ScopedRef", "Semaphore", "SemVer", "SemVerRange", "Sink", "StandardSchema",
  "Stdio", "Stream", "String", "Struct", "SubscriptionRef", "Symbol",
  "SynchronizedRef", "Take", "Terminal", "TextDiff", "Tracer", "Trie", "Tuple",
  "TxChunk", "TxDeferred", "TxHashMap", "TxHashSet", "TxPriorityQueue",
  "TxPubSub", "TxQueue", "TxReentrantLock", "TxRef", "TxSemaphore",
  "TxSubscriptionRef", "Types", "UndefinedOr", "Unify", "Utils", "Version",
  // aliases
  "Arr", "S",
]

const nativeArrayMethods = [
  "map", "filter", "some", "every", "find", "findIndex", "findLast",
  "findLastIndex", "reduce", "reduceRight", "flatMap", "flat", "forEach",
  "includes", "indexOf", "lastIndexOf", "slice", "concat", "join", "sort",
  "toSorted", "reverse", "toReversed", "at", "fill", "splice", "toSpliced",
]
const nativeStringMethods = [
  "split", "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase",
  "startsWith", "endsWith", "replace", "replaceAll", "padStart", "padEnd",
  "substring", "charAt", "repeat", "localeCompare", "normalize",
]

const nativeMethods = [
  ...nativeArrayMethods.map((property) => ({
    property,
    allowObjects: effectModules,
    message: `Native array method; use Array.${property === "at" ? "get" : property} or the nearest Array module function.`,
  })),
  ...nativeStringMethods.map((property) => ({
    property,
    allowObjects: effectModules,
    message: "Native string method; use the String module (String.split, String.trim, ...).",
  })),
  {
    object: "Object",
    message: "Native Object functions; use the Record and Struct modules.",
  },
]

const coreGroups = [loops, collections, failures, asynchrony, effectBans, parsing]
const testGroups = [failures, asynchrony, effectBans]

const throwingImports = {
  name: "effect/Schema",
  importNames: throwingSchema.split("|"),
  message: "Throwing or v3 Schema functions are banned; see the Schema.decode rule.",
}

// Layer edges (decision-core-architecture): who may import whom.
const layers = ["domain", "features", "format", "runtime", "program", "facade"]
const mayImport = {
  domain: [],
  features: ["domain"],
  format: ["domain"],
  runtime: ["domain"],
  program: ["domain", "features", "format", "runtime"],
  facade: ["domain", "features", "format", "program"],
}
const importRule = (layer) => [
  "error",
  {
    paths: [throwingImports],
    patterns: [
      {
        group: layers
          .filter((other) => other !== layer && !mayImport[layer].includes(other))
          .flatMap((other) => [`**/${other}`, `**/${other}/**`]),
        message: `${layer} may import only ${mayImport[layer].join(", ") || "nothing"} from the other layers.`,
      },
      ...(["domain", "features", "format"].includes(layer)
        ? [{ group: ["node:*", "bun", "bun:*"], message: "Core layers import effect and nothing else." }]
        : []),
    ],
  },
]

const immutableData = ["error", { ignoreClasses: true }]

export const buildConfig = ({ tsconfigRootDir, ignores = [] }) => defineConfig([
  { ignores: ["node_modules/**", "dist/**", ...ignores] },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: { project: ["./tsconfig.json"], tsconfigRootDir },
    },
    plugins: { functional },
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/array-type": ["error", { default: "generic", readonly: "generic" }],
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "no-restricted-syntax": noRestrictedSyntax(...coreGroups),
      "functional/no-loop-statements": "error",
      "functional/no-throw-statements": "error",
      "functional/no-let": "error",
      "functional/immutable-data": immutableData,
    },
  },
  ...layers.map((layer) => ({
    files: [`src/${layer}/**/*.ts`],
    rules: { "no-restricted-imports": importRule(layer) },
  })),
  {
    // Core layers also ban native collection and string methods and
    // null or undefined checks (effect-v4, "Reach for the combinator").
    files: ["src/domain/**/*.ts", "src/features/**/*.ts", "src/format/**/*.ts"],
    rules: {
      "no-restricted-syntax": noRestrictedSyntax(...coreGroups, nullish, nativeCollections),
      "no-restricted-properties": ["error", ...nativeMethods],
    },
  },
  {
    // Tests relax the loop, mutation and parsing rules, and the core-only
    // native-method and null-check bans, and nothing else.
    files: ["test/**/*.ts"],
    rules: {
      "no-restricted-syntax": noRestrictedSyntax(...testGroups),
      "no-restricted-imports": ["error", { paths: [throwingImports] }],
      "functional/no-loop-statements": "off",
      "functional/no-let": "off",
      "functional/immutable-data": "off",
    },
  },
])
