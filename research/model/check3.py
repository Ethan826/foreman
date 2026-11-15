"""AMENDMENT 1 (after runs 1-3 of scope one; runs 1-3 each stopped early on
model or monitor errors fixed in place, see below, and run 3 timed out at
280 s with 400,000 states explored and the frontier at 207,094 and growing;
no property violation of the design was reported by then). Grammar
reductions, fixed before run 4, each justified as behavior-preserving:
  (a) The tampering exit kinds changedT, nochangeT, failedT and Crash(True)
      are dropped. UserProt is enabled in every state, including while an
      agent runs, and sets the same on-disk flag; with permission withheld,
      Exit(kT) reaches the same model and monitor state as UserProt followed
      by Exit(k), because the only effect of the T suffix was to set that
      flag before the exit compare. With permission granted the T suffix had
      no effect (after the model fix made with amendment 2, the exit
      compare records any on-disk change under permission as the new
      baseline, so UserProt; Exit(k) matches Exit(kT) there too). So the E1 scenario (a failed or nothing-to-commit step
      leaving an ignored protected file or .git/config changed) is
      UserProt; Exit(failed | nochange); counter "e1" counts it.
  (b) A newest reading that does not allow is stored without its post-hold
      flag: only (allow, post-hold) readings release a hold, so (no, post)
      and (no, pre) have the same future.

AMENDMENT 2 (after run 4, under amendment 1, timed out at 280 s with
400,000 states and the frontier at 207,422, still growing; no violation
reported). A sample of 120,000 states showed the space was still almost
all in the first implement step (rounds 0 in 99.9 percent), multiplied by
independent environment flags: 30 reading combinations, the on-disk
protected flag, the dirty flag, HEAD and revision, the lock and pending
reads. Bound change, fixed before run 5: three scopes of the same model
and monitor, each a sub-grammar, selected on the command line.
  recovery (default): one window per provider (claude a, codex a; Exit
      kinds rl_a, rl_u for mutating steps), every other event family,
      one real tranche. Fixes 1-7.
  quota: claude windows a and b, codex a, all reading ages and ResetPassed;
      without UserProt, ProtFix, ProtRelease and Survivor. One real
      tranche. Fix 8 (and C3, C7 with two windows).
  tranches: as recovery, but two real tranches (for rules that act only
      after an approval).
Also ReadA is offered only while A holds the lock (an instance folds the
log only while running; a read by an instance without the lock appended
nothing in any case). What no scope covers: two-window pacing together
with protected changes or surviving agents. Argument for the split: the
quota rules read and write only readings and quota holds, and the
protected and recovery rules never touch them; their interaction is only
through "a hold exists", which every scope exercises.

AMENDMENT 3 (after run 5, scope recovery under amendment 2, timed out at
280 s with 500,000 states and the frontier at 185,501, still growing; no
violation reported). Bound changes, fixed before run 6:
  recovery and quota: revisions 0..2 (was 0..3); the approval that starts
      the tranche never grants protected-path permission (Approve(.., a)
      offered with a=False only). Revision 3 was needed only by a second
      correction's commit; paths needing it end in BOUNDED states.
  tranches: revisions 0..3, permission offered both ways, but no Crash,
      Start or instance B (one instance that never crashes, keeping A's
      split read and append). Crash recovery is covered by the recovery
      scope; permission and approval rules (which act only from the
      approval on) by this one.
What no scope covers after amendment 3, in addition to amendment 2's
list: a crash or a second instance in the second tranche; a granted
permission together with a crash or a surviving agent.

AMENDMENT 4 (after run 6, scope recovery under amendment 3, timed out at
280 s with 500,000 states and the frontier at 85,928, growth slowing; no
violation reported; quota and tranches runs were stopped unrun to apply
this). Grammar change, fixed before run 7: in the recovery and quota
scopes instance A also reads and appends atomically (RunA), as B does.
The log-position check is exercised only in the tranches scope, which
keeps A's split ReadA / AppendA. The lock is still exercised by two
instances in recovery and quota.
Run 7 (recovery, amendment 4): timed out at 280 s, 500,000 states, frontier
48,185 and falling. The state key was then built from the dict values in
their fixed order instead of sorted items (speed only, no model change).
Run 8: recovery 732,240 states, no violations, liveness and strict
liveness 0, 215 s; quota 623,040 states, no violations, liveness and
strict liveness 0, 220 s; tranches timed out at 280 s with 900,000 states
and the frontier at 118,679, still growing, no violation reported.

AMENDMENT 5 (after run 8). Bound change for the tranches scope, fixed
before run 9: revisions 0..2 (was 0..3), as in the other scopes. Each
tranche still commits its implement step; paths needing a third commit
end in BOUNDED states.
Runs 9-12 (tranches): each timed out at 280 s with 900,000 states and the
frontier at 23,962 and falling; no violation reported. (Runs 10-12 were
meant to test changes whose edit scripts failed, so they repeat run 9.)

AMENDMENT 6 (after run 12). Grammar change for the tranches scope only,
fixed before run 13: no Observe with verdict "no" (Expire has the same
effect on readings; an "old" allowing reading still appends, so A's view
still goes stale), no pre-hold readings, no Waive and no nested-repository
restore outcome. R-S1, waivers and incomplete restores are checked in the
recovery scope (and R-S1 and waivers in quota); the tranches scope exists
for rules that act from an approval on (rounds reset, permission per
tranche, approval matching) and for the log-position check. Also, with no
model change, non-progress self-loop edges are no longer stored for the
liveness pass (they cannot create a path).
Run 13 (tranches): 822,912 states, no violations, liveness and strict
liveness 0, 158 s.

MONITOR FIX (after the first mutation pass, no grammar or bound change):
the monitor recorded a tranche end (abandon, passing review, notConverged)
without requiring the approval hold in the outputs; mutant M17 (abandon
moves to the next tranche with no approval hold) was missed in every
scope. The check "K tranche end missing" (present in M2) is restored.
All three scopes and the mutation test were rerun after it.

AMENDMENT 7 (after the first mutation pass, fixed before the rerun). Bound
change: states in the tranche after the last are no longer cut off
entirely; they are explored with launch-attempt events only (RunA, RunB,
ReadA, AppendA), so the first launch attempt of the next tranche is
checked. They still count as unexpanded (able to progress) for liveness.
Reason: mutant N17 (abandon records a reset but leaves HEAD) was
detectable only at the next tranche's first launch attempt, which no
scope reached.
Instrumentation added at the same time (model-state counters, never read
by the monitor, used only to check equivalence arguments for missed
mutants): fail_and_drift (expanded states holding both a failure and a
drift hold; N19 differs from the model only there) and
uncertain_and_quota (states holding a quota hold together with an
uncertain or approval hold, the only holds whose release changes the
step; with W this backs N15). The unused counter survivor_after is
removed.
AMENDMENT 8 (2026-11-15, revision 3.1: agents run in a supervisor-owned
linked worktree). What the ruling changes in the model: one rule, the
next tranche's base. Grammar change: Approve(t, r, a, b), where b is None
(the next tranche starts from r, as before) or a fresh revision rev+1
standing for a commit on the owner's branch (approve --base). An accepted
--base approval appends a request ("base", b, head), refused while another
request is pending; the lock holder performs it with the same Perform
(digest compare, HEAD guard, reset, crash possible before EffectDone),
and its completion records b as the expected revision and releases
nothing. Offered in the recovery and tranches scopes (BASE_OPT), not in
quota, whose rules never touch requests or revisions. Monitor: expects
the request on an accepted --base approval, no request otherwise, and the
new revision at completion. Counter "base" counts base completions.
What the ruling does not change in the model: HEAD, the tree and the
recorded revision were already abstract; they now denote the supervisor
worktree and branch. UserCommit and UserEdit now stand for anything other
than the shell changing that worktree or branch (an agent past
prevention, a survivor, someone working there, update-ref from
elsewhere). The owner's commits on their own branch change no modelled
variable and are not events, except as the fresh revision b.
Before (revision 3 runs above): recovery 733,728 states; quota 626,256;
tranches 824,592; no violations; liveness and strict liveness 0.
After (amendment 8, same bounds): recovery 738,912 states, launch
transitions 8,040, base 192, 169 s; quota 626,256 (unchanged), 167 s;
tranches 831,120, launch transitions 2,632, base 2,496, 171 s; no
violations; liveness and strict liveness 0 in all three. Launch
transitions are unchanged because a completed base request reaches the
same model state as UserCommit followed by a drift hold and Adopt.
Mutants R10a (completion keeps the old revision) and R10b (the CLI resets
directly, no request) were added to mutate3.py; both killed in recovery.
The 68 earlier mutants were not rerun; each one's pattern still matches
exactly once (checked).

Errors fixed during runs 1-3 (model and monitor bugs, not grammar):
  run 1: ResetPassed did not release a hold whose remaining windows already
  had post-hold allowing readings (both sides fixed); run 2: a launch
  attempt treated a crashed instance's orphaned operation as in flight and
  appended nothing, where the text says a hold refuses (model fixed); run 3:
  a second crash re-marked an already killed agent as alive (model fixed).

Bounded model check M3 of the supervisor design, revision 3.

Model check M3 for docs/plans/2026-11-14-agent-supervisor-design.md
(revision 3). check.py (M1), check2.py (M2) and the review directories are
kept unchanged. Run: python3 -I check3.py [--scope one|two] [--stop]

GRAMMAR AND BOUNDS (fixed before the first run)
-----------------------------------------------
Everything in M2's grammar (after its amendments 1-3) is kept, with these
changes for revision 3. Numbers in brackets are the re-review fixes.

Events (environment and user; the model may refuse user commands):
  ReadA / AppendA   instance A folds the log, then appends its launch
                    attempt; the append is dropped unless A holds the lock
                    and nothing was appended since its read.
  RunB              instance B reads and appends atomically (needs the lock).
  StartA, StartB    an instance takes the free lock and runs startup:
                    kill the recorded process group [4], compare the
                    protected digest [1], hold unsettled operations [2].
  Crash(t)          the lock holder dies. Its agent, if one is running,
                    SURVIVES (macOS: children outlive the parent's SIGKILL)
                    [4]; t=True also leaves a protected change on disk.
  Survivor          a surviving agent writes to the tree and to protected
                    files (worst case). Enabled while the model's agent
                    process is alive and orphaned.
  Exit(kind)        the running agent exits. Mutating steps: changed,
                    changedT, nochange, nochangeT, failed, failedT,
                    rl_a, rl_b, rl_u (rate limited on window a, b, or
                    unreported). A suffix T means the step also changed a
                    protected path on disk, including ignored files that
                    git status never lists (E1 style) [1]. Review steps:
                    success, changes, rl_a, failed. failed* and rl* leave
                    the tree dirty (worst case); nochangeT leaves it clean.
  ShellCommit       commit procedure after a successful mutating exit:
                    compare digest, then CAS HEAD from the step's base.
  CommitFail, CommitDone   as in M2.
  UserCommit, UserEdit     as in M2 (any time, including during a step).
  UserProt          the user (or anything outside the log) changes a
                    protected file on disk [1].
  ProtFix           the protected files are put back to the recorded digest.
  Observe(p, w, v, age)  a reading of window w of provider p with verdict
                    v in {allow, no}. age=old: older than the newest
                    reading already held for (p, w), so ignored (R-P4,
                    latest observedAt wins) [8]; age=pre: newest, but taken
                    before p's quota hold (only offered while one exists
                    and no post-hold reading of w is held); age=post:
                    newest and after the hold (or no hold exists).
  Expire(p, w)      the newest reading of (p, w) stops being usable.
  ResetPassed(p, w) the reset time a rate-limit event reported for (p, w)
                    passes (only offered while p's quota hold names w) [8].
  Tick, Waive(p)    as in M2.
  Approve(t, r, a, b)  as in M2; b is the --base revision or None
                    (amendment 8).
  Reconcile(o, res) res in {discard, accept, abandon}; o is an opId in
                    {0, 1} [2].
  Release           user `release` of a failure hold.
  Adopt             user `adopt` (CLI; compares the digest before git) [1].
  Restore           user `restore`: appends a request only [3].
  Perform(n)        the lock holder carries out the pending git-effect
                    request: digest compare, HEAD guard, git reset --hard
                    and clean; n=nested leaves the tree dirty (a nested
                    repository survives `git clean -fd`) [3][7].
  EffectDone        the lock holder appends the effect's completion [3].
  ProtRelease(acc)  user `release-protected`, acc=True is `--accept` [1].
Providers and windows: claude (impl, correct) with windows a and b; codex
(review) with window a. Pacing allows p iff every window of p has a usable
allowing reading.
Bounds: maxCorrectionRounds 2; revisions 0..3 (an event that would create
revision 4 is disabled and its state marked BOUNDED); opIds modelled
modulo 2 (an opId is told apart from the previous operation's only).
Scope one: a state is not expanded once tranche 2 starts (one real
tranche). Scope two: not expanded once tranche 3 starts (two tranches).

MONITOR RULE: check(m, ev, out) never sees model state. Its expected launch
attempt (mon_launch_attempt) is written from the design's numbered
"Launch attempt" procedure, not from decide_run.

Properties (per transition):
  C1  no launch while an obligation exists (approval, uncertain, failure,
      drift, quota for the provider, protected, a pending git request).
  C2  approval releases name the ended tranche and its revision.
  C3  Tick has no output; a quota obligation is released only when every
      window it names has a newest post-hold allowing reading, or its reset
      passed, or a waiver.
  C4  intent before launch; after a crash with an operation unsettled, no
      launch until that operation is reconciled; startup holds exactly the
      unsettled operation (a reconciled one is settled) [2].
  C5  at most one operation in flight.
  C6  corrections only after 1..maxCorrectionRounds change requests.
  C7  a launch whose provider pacing does not allow carries an armed waiver.
  D   no launch on a moved HEAD or dirty tree; base is the recorded revision.
  E   the launched step is the next step of the cycle.
  F4  no surviving agent acts after a startup [4].
  G   every git-effect (reset) is performed by the lock holder for a
      pending request, with HEAD at the request's HEAD or its target [3].
  H1  a launch attempt creates at most one hold, and only if it found none.
  K   completeness (fresh appends launch when allowed, matching user
      commands are not refused, releases and holds match justifications).
  P   no commit lands for an operation with an unpermitted protected change.
  P2  no shell git command runs while an unpermitted protected change is on
      disk [1].
  W   (counter, not a property) launch attempts made while the armed
      waiver names a provider other than the step's.
Liveness and strict liveness as in M2.
"""
from collections import deque
import sys, time

# amendment 2: three scopes (see the header); default "recovery"
SCOPE = next((a for a in sys.argv[1:] if a in ("recovery", "quota", "tranches")), "recovery")
MAXR = 2
MAXREV = 2      # amendments 3 and 5
LAST_TRANCHE = 3 if SCOPE == "tranches" else 2
PROT = SCOPE != "quota"          # UserProt, ProtFix, ProtRelease, Survivor offered
CRASH = SCOPE != "tranches"      # amendment 3: Crash, Start and instance B offered
PERMITS = (False, True) if SCOPE == "tranches" else (False,)   # amendment 3
SPLIT_A = SCOPE == "tranches"    # amendment 4: elsewhere A runs atomically (RunA)
BASE_OPT = SCOPE != "quota"      # amendment 8: approve --base offered (recovery, tranches)
def BASES(s): return (None, s["rev"] + 1) if BASE_OPT and s["rev"] < MAXREV else (None,)
P_OF = {"impl": "claude", "correct": "claude", "review": "codex"}
PROVS = ("claude", "codex")
WINS = {"claude": ("a", "b") if SCOPE == "quota" else ("a",), "codex": ("a",)}
MUTATING = ("impl", "correct")
MUT_KINDS = ("changed", "nochange", "failed", "rl_a", "rl_b", "rl_u") if SCOPE == "quota" else ("changed", "nochange", "failed", "rl_a", "rl_u")
REV_KINDS = ("success", "changes", "rl_a", "failed")


def initial():
    return dict(tranche=0, step="done", rounds=0,
                holds=frozenset({("approval", 0, 0)}),
                inflight=None,     # (step, stage, base, r, opid)
                orphan=False, alive=False,
                lastop=None,       # (opid, mutating, facts) facts subset of F,S,C,R
                q=tuple(sorted(((p, w), ("no", False)) for p in PROVS for w in WINS[p])),
                waiver=None, head=0, expected=0, dirty=False, rev=0,
                allowp=False, pt=False, req=None,
                lock="A", pend=(("A", None), ("B", None)))


def getd(s, key, k): return dict(s[key])[k]
def setd(s, key, k, v):
    d = dict(s[key]); d[k] = v; s[key] = tuple(sorted(d.items()))


def qhold(s, p):
    for h in s["holds"]:
        if h[0] == "quota" and h[1] == p: return h
    return None


def end_tranche(s, out, why):
    s["step"] = "done"
    h = ("approval", s["tranche"], s["expected"])
    s["holds"] |= {h}; out.append(("hold", h, why))


def add_hold(s, out, h, why):
    if h not in s["holds"]:
        s["holds"] |= {h}; out.append(("hold", h, why))


def settle(s, fact):
    o, mut, facts = s["lastop"]; s["lastop"] = (o, mut, facts | {fact})


def unsettled(lastop):
    if lastop is None: return False
    o, mut, facts = lastop
    if "R" in facts: return False
    if "F" not in facts: return True
    return "S" in facts and mut and "C" not in facts


def new_quota(s, out, p, need, why):
    for w in WINS[p]:
        v, _ = getd(s, "q", (p, w)); setd(s, "q", (p, w), (v, False))   # readings now predate heldAt
    add_hold(s, out, ("quota", p, frozenset(need)), why)


def try_release_quota(s, out, p):
    h = qhold(s, p)
    if h and all(getd(s, "q", (p, w)) == ("allow", True) for w in h[2]):
        s["holds"] -= {h}; out.append(("release", ("quota", p)))
        for w in WINS[p]:
            v, _ = getd(s, "q", (p, w)); setd(s, "q", (p, w), (v, False))


# ---------------- model: decide() and the shell ----------------
def decide_run(s):
    if (s["inflight"] and not s["orphan"]) or s["req"]:
        return ("noop",)
    if s["holds"]:
        return ("refuse",)
    if s["pt"]:
        return ("hold", ("protected",))
    if s["head"] != s["expected"] or s["dirty"]:
        return ("hold", ("drift",))
    p = P_OF[s["step"]]
    if s["waiver"] == p:
        return ("launch", s["step"], s["expected"], True)
    blocking = [w for w in WINS[p] if getd(s, "q", (p, w))[0] != "allow"]
    if not blocking:
        return ("launch", s["step"], s["expected"], False)
    return ("quota", p, tuple(blocking))


def apply_run(s, d, out):
    if d[0] == "noop":
        return
    s["waiver"] = None                       # any launch attempt uses or expires it
    if d[0] == "refuse":
        out.append(("refused",)); return
    if d[0] == "hold":
        if d[1] == ("drift",): out.append(("git", "status"))
        out.append(("refused",)); add_hold(s, out, d[1], "run"); return
    if d[0] == "quota":
        out.append(("git", "status")); out.append(("refused",))
        new_quota(s, out, d[1], d[2], "run"); return
    _, step, base, waived = d
    o = 1 - s["lastop"][0] if s["lastop"] else 0
    s["inflight"] = (step, "running", base, None, o); s["orphan"] = False
    s["lastop"] = (o, step in MUTATING, frozenset())
    out.append(("git", "status"))
    out.append(("intent", o, step, base, waived)); out.append(("launch", step, base, waived))


def decide(s, ev):
    s = dict(s); out = []
    k = ev[0]
    if k == "ReadA":
        setd(s, "pend", "A", (False, None))
    elif k in ("RunA", "RunB"):
        if s["lock"] == k[-1]:
            apply_run(s, decide_run(s), out)
    elif k == "AppendA":
        pd = getd(s, "pend", "A"); setd(s, "pend", "A", None)
        if s["lock"] == "A" and not pd[0]:
            apply_run(s, decide_run(s), out)
    elif k in ("StartA", "StartB"):
        i = k[-1]
        if s["lock"] is None:
            s["lock"] = i; out.append(("started", i))
            if s["lastop"] and "F" not in s["lastop"][2]:
                s["alive"] = False; out.append(("killpg", s["lastop"][0]))
            if s["pt"]: add_hold(s, out, ("protected",), "startup")
            if unsettled(s["lastop"]):
                add_hold(s, out, ("uncertain", s["lastop"][0]), "startup")
    elif k == "Crash":
        if s["lock"]:
            setd(s, "pend", s["lock"], None); s["lock"] = None
            if s["inflight"]:
                if s["inflight"][1] == "running" and not s["orphan"]: s["alive"] = True
                s["orphan"] = True
            if ev[1]: s["pt"] = True
    elif k == "Survivor":
        s["dirty"] = True
        if not s["allowp"]: s["pt"] = True
    elif k == "Exit":
        step, stage, base, _, o = s["inflight"]; kind = ev[1]; p = P_OF[step]
        out.append(("finished", o, kind))
        if s["allowp"] and s["pt"]:      # step 4: a permitted change becomes the baseline
            s["pt"] = False; out.append(("baseline", o))
        if step in MUTATING:
            settle(s, "F")
            if kind in ("changed", "changedT"):
                s["dirty"] = True; settle(s, "S")
                if s["pt"]:
                    s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "protectedPath"))
                else:
                    s["inflight"] = (step, "exited", base, None, o)
            elif kind in ("nochange", "nochangeT"):
                settle(s, "S"); s["inflight"] = None
                if s["pt"]:
                    settle(s, "C"); out.append(("commitRefused", o, "protectedPath"))
                else:
                    settle(s, "C"); s["step"] = "review"; out.append(("nothing", o))
            elif kind.startswith("rl"):
                s["dirty"] = True; s["inflight"] = None
                need = WINS[p] if kind == "rl_u" else (kind[-1],)
                new_quota(s, out, p, need, "rateLimited")
            else:
                s["dirty"] = True; s["inflight"] = None
                add_hold(s, out, ("failure",), "failed")
            if s["pt"]: add_hold(s, out, ("protected",), "exit")
        else:
            settle(s, "F"); s["inflight"] = None
            if kind == "success":
                settle(s, "S"); end_tranche(s, out, "passed")
            elif kind == "changes":
                settle(s, "S")
                s["rounds"] = min(s["rounds"] + 1, MAXR + 1)
                if s["rounds"] > MAXR: end_tranche(s, out, "notConverged")
                else: s["step"] = "correct"
            elif kind.startswith("rl"):
                new_quota(s, out, p, (kind[-1],), "rateLimited")
            else:
                add_hold(s, out, ("failure",), "failed")
            if s["pt"]: add_hold(s, out, ("protected",), "exit")
    elif k == "ShellCommit":
        step, stage, base, _, o = s["inflight"]
        if s["pt"]:
            s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "protectedPath"))
            add_hold(s, out, ("protected",), "commit")
        elif s["head"] != base:
            s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "headMoved"))
            add_hold(s, out, ("failure",), "headMoved")
        else:
            s["rev"] += 1; r = s["rev"]; s["head"] = r; s["dirty"] = False
            s["inflight"] = (step, "gitcommitted", base, r, o); out.append(("git", "commit")); out.append(("gitcommit", r))
    elif k == "CommitFail":
        o = s["inflight"][4]
        s["inflight"] = None; settle(s, "C"); out.append(("commitFailed", o))
        add_hold(s, out, ("failure",), "commitFailed")
    elif k == "CommitDone":
        step, stage, base, r, o = s["inflight"]
        s["inflight"] = None; settle(s, "C"); s["expected"] = r; s["step"] = "review"
        out.append(("committed", o, r))
    elif k == "UserCommit":
        s["head"] = ev[1]; s["rev"] = ev[1]; s["dirty"] = False
    elif k == "UserEdit":
        s["dirty"] = True
    elif k == "UserProt":
        s["pt"] = True
    elif k == "ProtFix":
        s["pt"] = False
    elif k == "Observe":
        p, w, v, age = ev[1:]
        out.append(("observed", p, w, v, age))
        if age != "old":
            post = age == "post" and qhold(s, p) is not None
            setd(s, "q", (p, w), (v, post and v == "allow"))   # amendment 1: (no, post) == (no, pre)
            try_release_quota(s, out, p)
    elif k == "Expire":
        p, w = ev[1:]; v, post = getd(s, "q", (p, w)); setd(s, "q", (p, w), ("no", post))
    elif k == "ResetPassed":
        p, w = ev[1:]; h = qhold(s, p)
        if h and w in h[2]:
            v, post = getd(s, "q", (p, w)); setd(s, "q", (p, w), ("no", post))
            out.append(("resetPassed", p, w))
            s["holds"] -= {h}; rest = h[2] - {w}
            if rest:
                s["holds"] |= {("quota", p, rest)}; try_release_quota(s, out, p)
            else:
                out.append(("release", ("quota", p)))
                for x in WINS[p]:
                    vv, _ = getd(s, "q", (p, x)); setd(s, "q", (p, x), (vv, False))
    elif k == "Tick":
        pass
    elif k == "Waive":
        p = ev[1]; h = qhold(s, p)
        if h:
            s["holds"] -= {h}; s["waiver"] = p
            for w in WINS[p]:
                v, _ = getd(s, "q", (p, w)); setd(s, "q", (p, w), (v, False))
            out.append(("release", ("quota", p))); out.append(("waived", p))
    elif k == "Approve":
        t, r, a = ev[1], ev[2], ev[3]
        if ev[4] is not None and s["req"] is not None: t = None   # amendment 8: --base refused while a request is pending
        h = ("approval", t, r)
        if h in s["holds"]:
            s["holds"] -= {h}; s["tranche"] = t + 1
            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = a
            out.append(("approved", t, r, a))
            if ev[4] is not None:   # amendment 8: approve --base <commit>, a request like restore
                s["rev"] = ev[4]; s["req"] = ("base", ev[4], s["head"], False)
                out.append(("requested", "base", None, ev[4], s["head"]))
    elif k == "Reconcile":
        o, res = ev[1], ev[2]
        if ("uncertain", o) in s["holds"] and s["req"] is None and s["inflight"]:
            step, stage, base, _, _ = s["inflight"]
            if res == "accept" and step in MUTATING:
                s["holds"] -= {("uncertain", o)}; s["inflight"] = None; settle(s, "R")
                s["expected"] = s["head"]; s["step"] = "review"
                out.append(("reconciled", o, res)); out.append(("accepted", s["head"]))
            elif res in ("discard", "abandon"):
                s["req"] = (res, base, s["head"], False)
                out.append(("requested", res, o, base, s["head"]))
    elif k == "Release":
        if ("failure",) in s["holds"]:
            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))
    elif k == "Adopt":
        if ("drift",) in s["holds"] and s["req"] is None and not s["pt"]:
            out.append(("git", "status"))
            if not s["dirty"]:
                s["holds"] -= {("drift",)}; s["expected"] = s["head"]
                out.append(("release", ("drift",))); out.append(("adopted", s["head"]))
    elif k == "Restore":
        if ("drift",) in s["holds"] and s["req"] is None:
            s["req"] = ("restore", s["expected"], s["head"], False)
            out.append(("requested", "restore", None, s["expected"], s["head"]))
    elif k == "Perform":
        kind, target, at, applied = s["req"]
        if s["pt"]:
            add_hold(s, out, ("protected",), "perform")
        elif s["head"] not in (at, target):
            s["req"] = None; out.append(("effectStale", kind))
        else:
            s["head"] = target; s["dirty"] = ev[1] == "nested"
            s["req"] = (kind, target, at, True); out.append(("git", "reset")); out.append(("reset", target))
    elif k == "EffectDone":
        kind, target, at, applied = s["req"]; s["req"] = None
        if kind == "restore":
            if s["dirty"]:
                out.append(("restoreIncomplete",))
            else:
                s["holds"] -= {("drift",)}; out.append(("release", ("drift",))); out.append(("restored", target))
        elif kind == "base":   # amendment 8
            s["expected"] = target; out.append(("rebased", target))
        else:
            o = s["lastop"][0]
            s["holds"] -= {("uncertain", o)}; s["inflight"] = None; settle(s, "R"); s["expected"] = target
            out.append(("reconciled", o, kind))
            if kind == "abandon": end_tranche(s, out, "abandoned")
    elif k == "ProtRelease":
        if ("protected",) in s["holds"] and (ev[1] or not s["pt"]):
            s["pt"] = False; s["holds"] -= {("protected",)}
            out.append(("release", ("protected",)))
    if k not in NONAPPEND and out:
        for i in ("A", "B"):
            pd = getd(s, "pend", i)
            if pd is not None and not (k == "ReadA" and i == "A"):
                setd(s, "pend", i, (True, pd[1]))
    return s, out


NONAPPEND = {"Tick", "Expire", "UserCommit", "UserEdit", "UserProt", "ProtFix", "Survivor", "ReadA"}


def events(s):
    out = []; bounded = False
    if not SPLIT_A: out.append(("RunA",))
    elif getd(s, "pend", "A") is not None: out.append(("AppendA",))
    elif not s["inflight"] and s["lock"] == "A": out.append(("ReadA",))   # amendment 2
    if CRASH: out += [("RunB",), ("StartA",), ("StartB",), ("Crash", False)]   # amendment 1 dropped Crash(True)
    inf = s["inflight"]
    if PROT and s["alive"] and s["orphan"]: out.append(("Survivor",))
    if inf and not s["orphan"]:
        if inf[1] == "running":
            out += [("Exit", kd) for kd in (MUT_KINDS if inf[0] in MUTATING else REV_KINDS)]
        elif inf[1] == "exited":
            if s["rev"] < MAXREV or s["head"] != inf[2] or s["pt"]: out.append(("ShellCommit",))
            else: bounded = True
            out.append(("CommitFail",))
        elif inf[1] == "gitcommitted":
            out.append(("CommitDone",))
    if s["rev"] < MAXREV: out.append(("UserCommit", s["rev"] + 1))
    else: bounded = True
    out += [("UserEdit",), ("Tick",), ("Release",), ("Adopt",), ("Restore",)]
    if PROT: out += [("UserProt",), ("ProtFix",)] + [("ProtRelease", a) for a in (False, True)]
    if s["req"] and s["lock"]:
        out.append(("Perform", "clean"))
        if s["dirty"] and SCOPE != "tranches": out.append(("Perform", "nested"))   # amendment 6
        if s["req"][3]: out.append(("EffectDone",))
    out += [("Reconcile", o, r) for o in (0, 1) for r in ("discard", "accept", "abandon")]
    for p in PROVS:
        h = qhold(s, p)
        if SCOPE != "tranches": out.append(("Waive", p))   # amendment 6
        for w in WINS[p]:
            out.append(("Expire", p, w))
            if h and w in h[2]: out.append(("ResetPassed", p, w))
            for v in (("allow",) if SCOPE == "tranches" else ("allow", "no")):   # amendment 6
                out.append(("Observe", p, w, v, "old"))
                out.append(("Observe", p, w, v, "post"))
                if h and not getd(s, "q", (p, w))[1] and SCOPE != "tranches": out.append(("Observe", p, w, v, "pre"))
    for t in (s["tranche"], s["tranche"] + 1):
        for r in sorted({s["expected"], s["head"], s["rev"] + 1}):
            for a in PERMITS:
                for b in BASES(s):   # amendment 8
                    out.append(("Approve", t, r, a, b))
    return out, bounded


# ---------------- monitor: events and outputs only ----------------
def mon_init():
    return dict(tr=0, step="done", rounds=0, approval=(0, 0), allowp=False,
                rd=tuple(sorted(((p, w), ("no", False)) for p in PROVS for w in WINS[p])),
                quota=(), waiver=None, op=None, phase=None,
                uncertain=None, failure=False, drift=False, protected=False,
                ondisk=False, survivor=False, request=None,
                head=0, exp=0, dirty=False, lock="A", view=(("A", None), ("B", None)))


def md(m, key, k): return dict(m[key])[k]
def mput(m, key, k, v):
    d = dict(m[key]); d[k] = v; m[key] = tuple(sorted(d.items()))


def mon_quota(m, p):
    return dict(m["quota"]).get(p)


def mon_set_quota(m, p, need):
    d = dict(m["quota"])
    if need is None: d.pop(p, None)
    else: d[p] = frozenset(need)
    m["quota"] = tuple(sorted(d.items()))
    for w in WINS[p]:
        mput(m, "rd", (p, w), (md(m, "rd", (p, w))[0], False))


def mon_settled_by_text(m):
    """Design text, Startup recovery: an operation is unsettled iff it has
    Intended and no Reconciled, and either no Finished, or a successful
    mutating Finished without a commit outcome."""
    if m["op"] is None: return True
    o, step, phase = m["op"]
    if phase == "reconciled": return True
    if phase == "intended": return False
    if phase == "succeeded" and step in MUTATING: return False
    return True


def mon_launch_attempt(m):
    """Design text, 'Launch attempt', steps 1-6, applied to the monitor's
    obligations. Returns the set of acceptable output lists' shapes."""
    clauses = [
        ("pending request: perform it first", lambda: m["request"] is not None or m["op_running"], "nothing"),
        ("a hold exists: refuse", lambda: bool(m["approval"]) or m["uncertain"] is not None
            or m["failure"] or m["drift"] or bool(m["quota"]) or m["protected"], "refuse"),
        ("protected digest differs", lambda: m["ondisk"], "protected"),
        ("HEAD moved or tree dirty", lambda: m["head"] != m["exp"] or m["dirty"], "drift"),
        ("waiver armed for this provider", lambda: m["waiver"] == P_OF[m["step"]], "launchWaived"),
    ]
    for _, cond, res in clauses:
        if cond(): return res
    p = P_OF[m["step"]]
    no = [w for w in WINS[p] if md(m, "rd", (p, w))[0] != "allow"]
    return "launch" if not no else ("quota", p, frozenset(no))


def check(m, ev, out):
    m = dict(m); v = []
    k = ev[0]; kinds = [o[0] for o in out]; was_approval = m["approval"]
    def bad(x): v.append(x)
    holds_new = [o[1] for o in out if o[0] == "hold"]
    releases = [o[1] for o in out if o[0] == "release"]
    launch = [o for o in out if o[0] == "launch"]
    if any(o[0] == "git" for o in out) and m["ondisk"]: bad("P2 git ran with an unpermitted protected change on disk")
    if any(o[0] == "reset" for o in out):
        rq = m["request"]
        if not (k == "Perform" and m["lock"] and rq and m["head"] in (rq[2], rq[1])):
            bad("G reset without a pending request, lock or HEAD guard")
    if launch:
        _, step, base, waived = launch[0]; p = P_OF.get(step)
        if k not in ("AppendA", "RunA", "RunB"): bad("C1 launch outside an append")
        if "intent" not in kinds or kinds.index("intent") > kinds.index("launch"): bad("C4 intent order")
        if m["op_running"]: bad("C5 two in flight")
        if m["approval"]: bad("C1 approval pending")
        if m["uncertain"] is not None or not mon_settled_by_text(m): bad("C4 unsettled operation")
        if m["failure"]: bad("C1 failure pending")
        if m["drift"]: bad("C1 drift pending")
        if m["protected"] or m["ondisk"]: bad("C1 protected change pending")
        if m["request"]: bad("C1 git request pending")
        if mon_quota(m, p) is not None: bad("C1 quota pending")
        allows = all(md(m, "rd", (p, w))[0] == "allow" for w in WINS[p])
        if not allows and m["waiver"] != p: bad("C7 launch without allow or waiver")
        if waived and m["waiver"] != p: bad("C7 waiver recorded but not armed")
        if m["head"] != m["exp"] or m["dirty"]: bad("D launch on drifted or dirty tree")
        if base != m["exp"]: bad("D launch base differs from recorded revision")
        if step != m["step"]: bad("E wrong step %s expected %s" % (step, m["step"]))
        if step == "correct" and not (1 <= m["rounds"] <= MAXR): bad("C6 corrections")
    if k in ("AppendA", "RunA", "RunB"):
        i = k[-1]
        fresh = m["lock"] == i and (k != "AppendA" or md(m, "view", i) == "fresh")
        mput(m, "view", i, None)
        exp = mon_launch_attempt(m) if fresh else "nothing"
        if exp != "nothing":
            m["waiver"] = None
            if len(holds_new) > 1: bad("H1 a launch attempt created %d holds" % len(holds_new))
        if exp == "nothing":
            if out: bad("K append when none allowed: %s" % (out,))
        elif exp == "refuse":
            if out != [("refused",)]: bad("K refusal expected, got %s" % (out,))
        elif exp in ("protected", "drift"):
            if holds_new != [(exp,)] or launch: bad("K %s hold expected, got %s" % (exp, out))
            if exp == "protected": m["protected"] = True
            else: m["drift"] = True
        elif isinstance(exp, tuple):
            want = ("quota", exp[1], exp[2])
            if holds_new != [want] or launch: bad("K quota hold %s expected, got %s" % (want, out))
            mon_set_quota(m, exp[1], exp[2])
        else:
            if not launch: bad("K launch expected (%s), got %s" % (exp, out))
            else:
                intent = [o for o in out if o[0] == "intent"][0]
                m["op"] = (intent[1], m["step"], "intended"); m["op_running"] = True
                m["opbase"] = m["exp"]
    elif k == "ReadA":
        if out: bad("K read appended")
        mput(m, "view", "A", "fresh")
    elif k in ("StartA", "StartB"):
        if m["lock"] is None:
            m["lock"] = k[-1]
            if "started" not in kinds: bad("K start refused")
            if m["survivor"]:
                if ("killpg", m["op"][0]) not in out: bad("F4 startup did not kill the recorded process group")
                m["survivor"] = False
            if m["ondisk"] and not m["protected"]:
                m["protected"] = True
                if ("hold", ("protected",), "startup") not in out: bad("K startup missed a protected change")
            got = {o[1] for o in out if o[0] == "hold" and o[1][0] == "uncertain"}
            u = None if mon_settled_by_text(m) else m["op"][0]
            if u is None and got: bad("C4 startup held a settled operation %s" % (got,))
            if u is not None and got - {("uncertain", u)}: bad("C4 startup held the wrong operation %s" % (got,))
            if u is not None and m["uncertain"] is None:
                if ("uncertain", u) not in got: bad("C4 startup did not hold the unsettled operation")
                m["uncertain"] = u
        elif out: bad("K second instance started while lock held")
    elif k == "Crash":
        if m["lock"]:
            mput(m, "view", m["lock"], None); m["lock"] = None
            if m["op_running"] and m["op"][2] == "intended": m["survivor"] = True
            m["op_running"] = False
            if ev[1] and not m["allowp"]: m["ondisk"] = True
    elif k == "Survivor":
        if not m["survivor"]: bad("F4 an agent acted after startup killed its group")
        m["dirty"] = True
        if not m["allowp"]: m["ondisk"] = True
    elif k == "Exit":
        if not m["op_running"] or m["op"][2] != "intended":
            bad("C5 exit of an operation the monitor did not see running")
        else:
            o, step, _ = m["op"]; kind = ev[1]; p = P_OF[step]
            if m["allowp"] and m["ondisk"]:
                m["ondisk"] = False
                if ("baseline", o) not in out: bad("K permitted change not recorded as the baseline")
            m["op_running"] = False
            if step in MUTATING:
                if kind in ("changed", "changedT"):
                    m["dirty"] = True
                    if m["ondisk"]: m["op"] = (o, step, "refused")
                    else: m["op"] = (o, step, "succeeded"); m["op_running"] = "exited"
                elif kind in ("nochange", "nochangeT"):
                    m["op"] = (o, step, "settled")
                    if not m["ondisk"]: m["step"] = "review"
                elif kind.startswith("rl"):
                    m["dirty"] = True; m["op"] = (o, step, "settled")
                    mon_set_quota(m, p, WINS[p] if kind == "rl_u" else (kind[-1],))
                else:
                    m["dirty"] = True; m["op"] = (o, step, "settled"); m["failure"] = True
            else:
                m["op"] = (o, step, "settled")
                if kind == "success":
                    m["approval"] = (m["tr"], m["exp"]); m["step"] = "done"
                elif kind == "changes":
                    m["rounds"] = min(m["rounds"] + 1, MAXR + 1)
                    if m["rounds"] > MAXR: m["approval"] = (m["tr"], m["exp"]); m["step"] = "done"
                    else: m["step"] = "correct"
                elif kind.startswith("rl"): mon_set_quota(m, p, (kind[-1],))
                else: m["failure"] = True
            if m["ondisk"]:
                if not m["protected"] and ("protected",) not in holds_new: bad("K exit did not detect a protected change")
                m["protected"] = True
            elif ("protected",) in holds_new: bad("K protected hold without a protected change")
    elif k == "ShellCommit":
        gc = [o[1] for o in out if o[0] == "gitcommit"]
        if m["op_running"] != "exited":
            if gc: bad("P commit for an operation without a permitted successful exit")
        else:
            o, step, _ = m["op"]
            if m["ondisk"]:
                if gc: bad("P commit landed with a protected change")
                m["protected"] = True; m["op"] = (o, step, "refused"); m["op_running"] = False
            elif m["head"] != m["opbase"]:
                if gc: bad("D commit on a moved HEAD")
                m["op"] = (o, step, "refused"); m["op_running"] = False; m["failure"] = True
            elif not gc: bad("K commit refused on unchanged HEAD")
            else:
                m["head"] = gc[0]; m["dirty"] = False; m["op_running"] = ("gitcommitted", gc[0])
    elif k == "CommitFail":
        if m["op_running"] == "exited":
            m["op"] = (m["op"][0], m["op"][1], "refused"); m["op_running"] = False; m["failure"] = True
    elif k == "CommitDone":
        if not (isinstance(m["op_running"], tuple) and m["op_running"][0] == "gitcommitted"):
            bad("K Committed recorded without a landed commit")
        else:
            r = m["op_running"][1]
            if ("committed", m["op"][0], r) not in out: bad("K Committed revision differs")
            m["exp"] = r; m["op"] = (m["op"][0], m["op"][1], "settled"); m["op_running"] = False; m["step"] = "review"
    elif k == "UserCommit":
        m["head"] = ev[1]; m["dirty"] = False
    elif k == "UserEdit":
        m["dirty"] = True
    elif k == "UserProt":
        m["ondisk"] = True
    elif k == "ProtFix":
        m["ondisk"] = False
    elif k == "Observe":
        p, w, val, age = ev[1:]
        need = mon_quota(m, p)
        if age != "old":
            mput(m, "rd", (p, w), (val, age == "post" and need is not None))
        if need is not None and all(md(m, "rd", (p, x)) == ("allow", True) for x in need):
            mon_set_quota(m, p, None)
            if ("quota", p) not in releases: bad("K post-hold allowing readings did not release")
        elif releases: bad("C3 observation released a quota hold (%s %s %s %s)" % (p, w, val, age))
    elif k == "Expire":
        p, w = ev[1:]; mput(m, "rd", (p, w), ("no", md(m, "rd", (p, w))[1]))
    elif k == "ResetPassed":
        p, w = ev[1:]; need = mon_quota(m, p)
        if need is not None and w in need:
            mput(m, "rd", (p, w), ("no", md(m, "rd", (p, w))[1]))
            rest = need - {w}
            if rest and not all(md(m, "rd", (p, x)) == ("allow", True) for x in rest):
                d = dict(m["quota"]); d[p] = rest; m["quota"] = tuple(sorted(d.items()))
                if releases: bad("C3 reset released a hold whose other windows lack a post-hold allow")
            else:
                mon_set_quota(m, p, None)
                if ("quota", p) not in releases: bad("K reset time did not release")
        elif releases: bad("C3 unjustified reset release")
    elif k == "Tick":
        if out: bad("C3 tick produced output")
    elif k == "Waive":
        p = ev[1]
        if mon_quota(m, p) is not None:
            mon_set_quota(m, p, None); m["waiver"] = p
            if ("waived", p) not in out: bad("K waiver refused")
        elif out: bad("C7 waiver without quota hold")
    elif k == "Approve":
        t, r, a, b = ev[1:]
        ok = m["approval"] == (t, r) and t == m["tr"] and (b is None or m["request"] is None)
        if "approved" in kinds and not ok: bad("C2 approval mismatch")
        if ok and "approved" not in kinds: bad("K matching approval refused")
        if ok:
            m["tr"] = t + 1; m["step"] = "impl"; m["rounds"] = 0; m["approval"] = (); m["allowp"] = a
            if b is not None:   # amendment 8: the base reset is a request, performed by the lock holder
                m["request"] = ("base", b, m["head"])
                if ("requested", "base", None, b, m["head"]) not in out: bad("K approve --base did not request the reset")
        if "requested" in kinds and not (ok and b is not None): bad("G approval requested a reset without --base")
    elif k == "Reconcile":
        o, res = ev[1:]
        held = m["uncertain"] == o and m["request"] is None
        ok = held and (res != "accept" or m["op"][1] in MUTATING)
        if ("reconciled" in kinds or "requested" in kinds) and not ok: bad("C4 unjustified reconcile")
        if ok and not ("reconciled" in kinds or "requested" in kinds): bad("K reconcile refused")
        if ok:
            if res == "accept":
                m["uncertain"] = None; m["op"] = (o, m["op"][1], "reconciled")
                m["exp"] = m["head"]; m["step"] = "review"
            else:
                m["request"] = (res, m["opbase"], m["head"])
    elif k == "Release":
        if m["failure"]:
            m["failure"] = False
            if ("failure",) not in releases: bad("K release refused")
        elif releases: bad("K unjustified release")
        if any(r != ("failure",) for r in releases): bad("K release removed another hold")
    elif k == "Adopt":
        if m["drift"] and m["request"] is None and not m["ondisk"] and not m["dirty"]:
            m["drift"] = False; m["exp"] = m["head"]
            if ("adopted", m["head"]) not in out: bad("K adopt refused or wrong revision")
        elif "adopted" in kinds: bad("D unjustified adopt")
    elif k == "Restore":
        if m["drift"] and m["request"] is None:
            m["request"] = ("restore", m["exp"], m["head"])
            if "requested" not in kinds: bad("K restore request refused")
        elif out: bad("D unjustified restore request")
        if "reset" in kinds: bad("G restore ran git before its request was performed")
    elif k == "Perform":
        rq = m["request"]
        if rq is None or not m["lock"]: pass
        elif m["ondisk"]:
            if "reset" in kinds: bad("P2 reset with a protected change")
            m["protected"] = True
        elif m["head"] not in (rq[2], rq[1]):
            m["request"] = None
            if "effectStale" not in kinds: bad("K stale request not dropped")
        else:
            if ("reset", rq[1]) not in out: bad("K reset to wrong target or refused")
            m["head"] = rq[1]; m["dirty"] = ev[1] == "nested"; m["request"] = rq[:3] + ("applied",)
    elif k == "EffectDone":
        rq = m["request"]
        if rq is None or len(rq) < 4: bad("G completion recorded without a performed effect")
        else:
            m["request"] = None
            if rq[0] == "restore":
                if m["dirty"]:
                    if releases: bad("D restore released drift on a dirty tree")
                else:
                    m["drift"] = False
                    if ("drift",) not in releases: bad("K restore did not release")
            elif rq[0] == "base":   # amendment 8
                m["exp"] = rq[1]
                if ("rebased", rq[1]) not in out: bad("K base reset not recorded as the new revision")
                if releases: bad("K base completion released a hold")
            else:
                m["uncertain"] = None; m["exp"] = rq[1]
                m["op"] = (m["op"][0], m["op"][1], "reconciled")
                if rq[0] == "abandon": m["approval"] = (m["tr"], rq[1]); m["step"] = "done"
    elif k == "ProtRelease":
        if m["protected"] and (ev[1] or not m["ondisk"]):
            m["protected"] = False; m["ondisk"] = False
            if ("protected",) not in releases: bad("K protected release refused")
        elif releases: bad("C1 unjustified protected release")
    # approval holds must match the monitor's tranche ends
    ends = [h for h in holds_new if h[0] == "approval"]
    if ends and not (m["approval"] and ends == [("approval",) + m["approval"]]):
        bad("C6/C2 tranche ended when the monitor did not end it")
    if m["approval"] and m["approval"] != was_approval and not ends:   # monitor fix after run 13
        bad("K tranche end missing")
    if k not in NONAPPEND and out:
        for i in ("A", "B"):
            if md(m, "view", i) == "fresh" and not (k == "ReadA" and i == "A"):
                mput(m, "view", i, "stale")
    return m, v


def mon_init_full():
    m = mon_init(); m.update(op_running=False, opbase=0)
    return m


def freeze(d):
    # key order is fixed: every state dict is a copy of initial() / mon_init_full()
    return tuple(d.values())


def main():
    s0, m0 = initial(), mon_init_full()
    k0 = (freeze(s0), freeze(m0))
    ids = {k0: 0}; par = [None]; sts = [s0]
    dq = deque([(s0, m0)]); n = 0; launches = 0
    violations = {}; edges = []; expanded = set(); bounded = set()
    cnt = dict(maxholds=0, waivmis=0, t1=0, t2=0, e1=0, nested=0, fail_and_drift=0, uncertain_and_quota=0, base=0)
    t0 = time.time()

    def tr(i):
        o = []
        while par[i] is not None: i, e = par[i]; o.append(e)
        return tuple(reversed(o))
    while dq:
        s, m = dq.popleft(); n += 1
        kid = ids[(freeze(s), freeze(m))]
        if n % 100000 == 0:
            print(f"progress {n} states, frontier {len(dq)}, {time.time()-t0:.0f}s", flush=True)
        evs, bnd = events(s)
        if s["tranche"] >= LAST_TRANCHE:   # amendment 7: launch attempts only, not counted as expanded
            evs = [e for e in evs if e[0] in ("RunA", "RunB", "ReadA", "AppendA")]
        else:
            expanded.add(kid)
            cnt["maxholds"] = max(cnt["maxholds"], len(s["holds"]))
            if ("failure",) in s["holds"] and ("drift",) in s["holds"]: cnt["fail_and_drift"] += 1
            if qhold(s, "claude") or qhold(s, "codex"):
                if any(h[0] in ("uncertain", "approval") for h in s["holds"]): cnt["uncertain_and_quota"] += 1
            if bnd: bounded.add(kid)
        for ev in evs:
            s2, out = decide(s, ev)
            if ev[0] in ("AppendA", "RunA", "RunB") and out and s["waiver"] and s["step"] in P_OF and P_OF[s["step"]] != s["waiver"]:
                cnt["waivmis"] += 1
            if any(o[0] == "launch" for o in out): launches += 1
            if ev[0] in ("StartA", "StartB") and out and s["waiver"]: cnt["t1"] += 1
            if ev[0] in ("StartA", "StartB") and out and s["lastop"] and "R" in s["lastop"][2] and s["inflight"] is None:
                cnt["t2"] += 1
            if ev[0] == "Exit" and ev[1] in ("nochange", "failed") and s["pt"] and not s["allowp"] and P_OF[s["inflight"][0]] == "claude": cnt["e1"] += 1
            if ev == ("Perform", "nested"): cnt["nested"] += 1
            if ev[0] == "EffectDone" and s["req"] and s["req"][0] == "base": cnt["base"] += 1   # amendment 8
            m2, v = check(m, ev, out)
            key = (freeze(s2), freeze(m2))
            if key not in ids:
                ids[key] = len(par); par.append((kid, ev)); sts.append(s2)
                if not v: dq.append((s2, m2))
            prog = any(o[0] in ("launch", "approved") for o in out)
            if prog or ids[key] != kid: edges.append((kid, ids[key], prog))   # self-loops cannot help liveness
            for x in v:
                if x.split()[0] not in violations:
                    violations[x.split()[0]] = (x, kid, ev)
                    print("FOUND", x, flush=True)
                    if "--stop" in sys.argv:
                        print(f"stopped at first violation after {n} states")
                        for e in tr(kid) + (ev,): print("   ", e)
                        return
    print(f"scope {SCOPE}: states explored: {n}; launch transitions: {launches}; bounded states: {len(bounded)}; {time.time()-t0:.0f}s")
    print("counters:", cnt)
    for name, (x, kid, ev) in violations.items():
        print(f"VIOLATION {x}:")
        for e in tr(kid) + (ev,): print("   ", e)
    preds = {}; good = set(bounded)
    for i in range(len(par)):
        if i not in expanded: good.add(i)
    for (a, b, prog) in edges:
        preds.setdefault(b, []).append(a)
        if prog: good.add(a)
    work = list(good)
    while work:
        x = work.pop()
        for y in preds.get(x, []):
            if y not in good: good.add(y); work.append(y)
    dead = [i for i in expanded if i not in good]
    print(f"liveness: states with no path to a launch or approval release: {len(dead)}")
    shown = set()
    for i in sorted(dead):
        s = sts[i]
        sig = (tuple(sorted(s["holds"])), s["step"], s["inflight"] and s["inflight"][1], s["req"])
        if sig in shown: continue
        shown.add(sig)
        print("DEADLOCK", {k: s[k] for k in ("holds", "step", "inflight", "head", "expected", "dirty", "lock", "req", "pt")})
        print("   trace:", tr(i))
        if len(shown) >= 6: break
    sgood = {i for i in range(len(par)) if i not in expanded}
    for (a_, b_, prog) in edges:
        if prog: sgood.add(a_)
    work = list(sgood)
    while work:
        x = work.pop()
        for y in preds.get(x, []):
            if y not in sgood: sgood.add(y); work.append(y)
    sdead = [i for i in expanded if i not in sgood]
    print(f"strict liveness (no credit for BOUNDED): {len(sdead)} states")
    shown = set()
    for i in sorted(sdead):
        s = sts[i]
        sig = (tuple(sorted(s["holds"])), s["step"], s["inflight"] and s["inflight"][1], s["head"] == s["expected"], s["dirty"], s["req"])
        if sig in shown: continue
        shown.add(sig)
        print("STRICT", {k: s[k] for k in ("holds", "step", "inflight", "head", "expected", "dirty", "rev", "req")})
        print("   trace:", tr(i))
        if len(shown) >= 5: break
    if not violations and not dead: print("no violations")


if __name__ == "__main__":
    main()
