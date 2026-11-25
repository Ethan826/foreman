# Waxwing-1: make the Scope A integration build

## Task

Branch `integrate/scope-a` merges Waxwing's `main` and
`research/effect-kinds` into `scope-a-impl` (the Scope A
implementation, verified at 62ec785d). `main` brought FX033's repair,
Int arithmetic Tasks 1 and 2 and the charter. The merge had text
conflicts only in three docs, which are resolved. It does not build:
`main` replaced the `Add` constructor in every tree with `Arith`,
holding a `Domain.Arithmetic.Arithmetic` value (`Binary Plus left
right`), and four sites in modules that Scope A added still match
`Add`:

- `src/Features/Check/Generate/Expr.purs:73`:
  `Add span left right → arithmetic recur context path span { rule: 7,
  label: "Add", base: TInt, made: Checked.Add, marked: IntBase } left
  right`
- `src/Features/Check/Generate/Static/Walk.purs:41`:
  `Add _ left right → pair "Add" left right`
- `src/Features/Check/Generate/Static/Rules.purs:72`:
  `Add _ _ _ → pure []` (the compiler has not reached it yet, because
  it depends on `Static/Walk`)
- `src/Features/Check/Strategy/ReadBack/Walk.purs:84`:
  `Checked.Add left right → pair "Add" left right`

Six JavaScript test helpers mirror these constructors by name, and the
compiler cannot catch them:

- `test/r0-translator-exprs.mjs:141` (`[R.Add, binary('E7', Int)]`,
  dispatched with `instanceof` at :172; with `R.Add` undefined every
  later entry throws) and :29 (E7 named `'Add'`);
- `test/r0-census-walk.mjs:35` (`[R.Add, …]`);
- `test/r0-holes-gen.mjs:82` (`new O.Add(e(), e())`);
- `test/r0-generate-paths.mjs:16` (`fieldsOf.Add`) and its `walk` (:50,
  which needs `nameOf(node) === step`) and `nodesOf`;
- `test/r0-elab-walk.mjs:115` (`case 'Add'`);
- `test/r0-generate-pattern.test.mjs:91` (RT5's list of constructor
  names, compared with the constructors `Style.Arms` reads from
  source).

This task brings all of these onto `Arith`, with Scope A's observable
behaviour unchanged.

### Owner rulings for this task (do not reopen)

1. Behaviour does not change. `+` is the only arithmetic operator
   today (Task 3 adds `Minus`, Task 4 `Times`), so `Arith span (Binary
   Plus left right)` is handled exactly as `Add span left right` was.
2. Paths and labels do not change. The walkers keep the step name
   `"Add"` and the child names `left` and `right`, and the generator
   keeps rule 7 and the label `"Add"`. Pinned paths, fixtures and
   records depend on these strings, and
   `test/r0-generate-expr.test.mjs:127-130` (E14, E15) pins
   `['body', 'Add', 'left']`. Renaming them is Task 3's and Task 4's
   business.
3. Adding `Minus` must break these sites at compile time. Match
   `Binary Plus left right` explicitly. In `Generate/Expr.purs`,
   `Static/Walk.purs` and `Static/Rules.purs` the case lists every
   constructor, so an inline match does it. In `ReadBack/Walk.purs` the
   case functions end in `_ →` (lines 89, 107, 119), so an inline match
   would let `Minus` fall through silently: route
   `Checked.Arith arith → arithChildren arith` to a total helper,
   `arithChildren (Binary Plus left right) = pair "Add" left right`.
4. The generator's `made` field builds `Checked.Arith (Binary Plus left
   right)` through a named helper in a `where` clause, not a lambda
   (Waxwing's AGENTS.md). Export no new names (`trusted-surface.json`
   pins the export lists).
5. Some `verify` failures are expected, because `src` changed and the
   records measured on the old tree are stale. Do not edit, re-pin or
   loosen any of them; the coordinator re-runs and re-pins them after
   this cycle:
   - `test/r0-t2-activation-gate.test.mjs`, "criteria 5 and 6 see a
     record stale against src" and "the spec's report block is the
     script's headings". Both already fail at the branch's HEAD, since
     the gate reads `git rev-parse HEAD:src`.
   - `test/r0-t2-trace-inert.serial.test.mjs`, "recheck less its trace
     is the baseline's": its digest names each constructor, so every
     corpus program with `+` now hashes `Arith` instead of `Add`.
   Leave `test/fixtures/r0/t2-activation-gate.json`, the gate spec
   `docs/plans/2026-11-03-a2-activation-gate.md`, the trace-inert pins
   and everything under `research/r0-scope-a/` alone.
6. Change the four src sites and the six test helpers listed above,
   and nothing else in `src/`, `test/` or `scripts/` unless the
   compiler requires it. Each helper reads `Arith` and `Binary`/`Plus`
   from the compiled output and keeps the path label `"Add"` (ruling
   2); in `r0-generate-paths.mjs`, `Arith`'s operands are its
   `value1.value1` and `value1.value2`, under the step `Add`. RT5's
   list names the constructor `Arith`. Change no assertion's expected
   value except that list entry. Run `grep -rn "\bAdd\b" test` and
   report any hit you left as it is and why (Waxwing programs that
   declare `effect Add` are not constructors). List every change beyond
   these in the handoff with the error that forced it.

### Steps

1. Read `AGENTS.md` and follow it: the PureScript style (`where`, no
   anonymous lambdas, named helpers, 80 columns, the 250-line cap), the
   layer and IR-boundary rules, and the `maybe`/`either` rules. Do not
   edit `AGENTS.md`, `CLAUDE.md` or anything under `.claude/`: the
   profile denies them.
2. Read the pattern in the files `main` already changed:
   `src/Domain/Arithmetic.purs`, `src/Features/Check/Walk.purs` (lines
   29 and 88), `src/Features/Check/Infer.purs` (143 to 151),
   `src/Format/Go/Expression.purs:51` and
   `src/Format/Parse/Expression.purs:119`. For a JavaScript mirror,
   `scripts/differential-project.mjs:121-130` shows how `main` reads
   `Arith` as the old `Add`.
3. Change the four sites. Run `node scripts/build.mjs` until it exits
   0. It compiles with `--strict`, so an unused import or a shadowed
   `left`/`right` fails it. Then change the six helpers. Run
   `purs-tidy check src tools/style/src` and `node scripts/width.mjs`.
4. Record the change in `docs/progress.md` (a short dated section at
   the top) and update the integration paragraph in
   `docs/next-session.md`: the build fix is done; the activation-gate
   records and the trace-inert pins are stale. Keep the 80-column limit
   and add no fenced `waxwing` or `wxw` block: `docs/` is part of the
   test corpus.

You may run these check commands with the Bash tool, each exactly as
written: `node scripts/build.mjs`, `node scripts/width.mjs`,
`purs-tidy check src tools/style/src`. They run in the Bash sandbox,
with no network and the git directories read-only. The full test suite
(`verify`, longer than one Bash call allows) runs outside, by the
owner, after your step.

### Rules

- Do not delete, skip, rename or loosen any test or assertion beyond
  ruling 6.
- No changes to `package.json`, `package-lock.json`, `spago.yaml`,
  `spago.lock`, `scripts/`, the check gates or CI.
- Do not commit, and run no `git` commands other than `git status`
  and `git diff`.

### Done when

- `node scripts/build.mjs`, `purs-tidy check src tools/style/src` and
  `node scripts/width.mjs` exit 0;
- the owner's `verify` passes except the three tests named in ruling 5.
  A failure in a corpus pin (losses, shadow, compat, verdicts) may come
  from FX033's repair, which refuses more programs, rather than from
  this change. The reviewer and the owner judge which.

End with a handoff that lists every file you changed, each change
beyond those listed and the compiler error that forced it, how each
site keeps rulings 2 and 3, every `Add` left in `test/` and why, and
anything you were unsure about.
