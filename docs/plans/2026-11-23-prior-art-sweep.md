# Prior-art sweep for foreman (2026-11-23)

Copied by the coordinator from the sweep agent's report (one Opus agent, 397,210 tokens, 2026-11-23). The coordinator re-checked two decisive claims against source: awaywork b5317c3 (`docs/guide/workflows/posts.md:45` "counts as approved"; `src/quota/budget.ts` reserve and pacing cap, with the fixed-cap fallback when no long-window reading exists) and redline 8f1ae27 (`internal/decision/decision.go:604-620`, unknown on stale, out-of-date, future or missing-weekly readings).

## 1. Answer

No existing tool does what foreman does, and none is close enough to adopt. I checked about 160 candidates against the source code (out of roughly 560 hits) and none meets R1, R2 and R3 together.

- **Closest overall: AndreaProvenzale/awaywork.**
  - R2 meets: it reads both clients' real windows and keeps a 10% reserve.
  - R1 is partial: a Claude-implements, Codex-reviews loop can be configured, but the owner cannot filter findings before correction.
  - R3 is partial: review and fix rounds run on without stopping, and a report whose gates run clear "counts as approved".
  - It is built around a forge and pull requests, has no event log, and the agent commits.
- **Strongest approval gate and containment: RodrigoRLS2/supervised-agent-orchestrator.** It meets R3, R4, R5 and R6 in code and has the right roles. But it is Linux-only, answers through Telegram, has no licence, does no pacing, and does not let the owner filter findings.
- **Best pure pacing layer: croutoncreations/redline.** It meets R2 and fails closed on stale or missing readings. It has no review loop.
- **Best implement/review engines (R1 and R4): umputun/ralphex and wwind123/coding-review-agent-loop.** Both auto-continue, and ralphex launches Claude with `--dangerously-skip-permissions` by default.

Verdict: nothing fits whole. "An engine under a small layer" does not work either, because every R1 engine found auto-continues, uses bypass flags, or resumes sessions. The layer would have to undo those properties rather than add to them. What is worth borrowing is design and reading code: redline's and awaywork's pacing rules, and the Rodrigo orchestrator's state machine and launch flags.

## 2. Method used (all searches on 2026-11-23)

I wrote this method down before searching. Candidates were never installed, built or run. I shallow-cloned 175 repositories into `/private/tmp/claude-501/sweep-clones/`, read them with rg/sed/git log, and deleted the clones at the end. No tool call was denied. The foreman repo is unchanged; the modified `docs/plans/2026-11-19-assisted-cycle-plan.md` was already modified before I started.

**GitHub repository search** (`gh api search/repositories`, 15 per query), round 1:
- Role and loop terms: "claude codex orchestrator", "claude codex supervisor", "claude codex review loop", "claude code codex review", "codex claude implement review", "cross-model review claude codex", "multi-agent coding orchestrator claude", "agent loop claude code codex", "claude code supervisor", "codex cli orchestrator", "claude code approval gate", "claude code tranche", "claude code worktree orchestrator", "ralph loop claude codex".
- Limit terms: "claude code usage limit", "claude code rate limit resume", "claude code 5-hour window", "claude code weekly limit", "claude code quota scheduler", "claude code subscription usage pacing", "ccusage", "claude code auto resume".
- Names: "bosun agent", "boatswain claude", "foreman claude code", "firstmate agent", "quartermaster claude", "steward coding agent", "overseer claude code", "conductor claude code".

Round 2 used vocabulary learned in round 1: "codex exec claude -p loop", "claude implements codex reviews", "subscription quota scheduler coding agent", "usage window scheduler claude codex", "human approval coding agent orchestrator", "agent supervisor sqlite event log claude", "claude code headless task queue usage", "codex review gate claude", "quota-aware claude codex", "claude max plan scheduler", "pace claude subscription", "maker checker claude codex", "durable coding agent workflow claude", "claude code overnight queue", "codex rateLimits", plus "boatclaw", "firstmate claude codex", "bosun claude codex" and "bosun orchestrator".

**GitHub code search** for repositories that both read windows and launch clients:
- `"seven_day" "codex exec"`
- `"rateLimits/read" "claude -p"`
- `"five_hour" "codex exec" review`
- `"rate_limits" "codex exec" "--sandbox read-only"`
- `"resets_at" "codex exec" approval`
- `"used_percentage" "codex exec"`

**Package registries:**
- npm registry search API: 9 queries, including "bosun", "claude code quota", "claude code supervisor" and "codex claude implement review".
- crates.io API: "claude codex", "claude code orchestrator", "coding agent supervisor", "claude quota", "bosun".
- PyPI: only seen through web search (a claude-code-fallback package). I did not run a direct PyPI index search, which is a gap.

**Other sources:**
- Hacker News Algolia: 9 story queries since 2025-01-01.
- Product Hunt, via web search.
- skills.sh, tessl, smithery and skillsmp, via web search for "codex review loop" skills.
- Awesome lists, READMEs read in full and filtered: hesreallyhim/awesome-claude-code (its Agent Orchestration section), bradAGI/awesome-cli-coding-agents ("Orchestrators & autonomous loops" and the quota rows), serenakeyitan/awesome-agent-loops.
- Product websites: usebdfl.com, devloop.sh, conductor.build, and the CCCPlayer and codex-claude-loop pages on Product Hunt.

**Vendor docs:**
- Claude Code docs index (code.claude.com/docs/llms.txt), with pages read: routines, desktop-scheduled-tasks, workflows, agents, goal, scheduled-tasks, ship-command, pr-steward.
- OpenAI: Codex automations and pricing pages via search, and the openai/symphony repository.
- GitHub Agent HQ (Claude and Codex as Copilot coding agents) via changelog and docs search.

**Triage and scoring:**
- I ran a mechanical ripgrep scan over every clone, counting files that match: `claude -p`, `codex exec`/app-server, window fields, dollar caps, approval, bypass flags, auto-merge, sqlite and worktree.
- Seven read-only agents each scored a batch R1 to R7 against a written rubric. The rubric demanded path:line evidence, a commit hash, and "README-only" capped at PARTIAL.
- I re-checked the decisive claims myself against source: redline `internal/decision/decision.go:604-620, 768-787`; awaywork `src/quota/budget.ts:41-70, 120-130`, `src/config/schema.ts:61`, the provider argv, and `posts.md` ("counts as approved"); ralphex `pkg/config/defaults/config:23, 95, 156` and `external_review.go:132, 177`; supervised-agent-orchestrator `orchestrator.py:18-30`, `claude_cli.py:6-22, 137-139`, `codex_cli.py:331-332` and README lines 326 and 376; and virtengine/bosun and firstmate, which I scored myself.

## 3. Hit log

Status key:
- **SL** means shortlisted and scored in section 4.
- **L** means read and scored lightly; it misses R1, R2 and R3, so the reason is given.
- **X** means not shortlisted, with the reason.

How found: G1 and G2 are the GitHub search rounds, GC is GitHub code search, NPM, CR (crates.io), HN, PH (Product Hunt), AW (awesome list), BR (named in the brief), WEB.

### 3a. Starting points named in the brief

| Name | How found | What it is | Status |
|---|---|---|---|
| virtengine/bosun (npm `bosun`) | BR, NPM, HN | Autonomous control plane; executors through SDKs and API keys; Telegram | SL. No on R3 (`infra/monitor.mjs:6850` runs `gh pr merge --auto`) and R6 (`shell/claude-shell.mjs:232` defaults to bypassPermissions) |
| oddship/bosun | BR | A Pi-agent environment in tmux | X. No Claude/Codex loop, gate or windows |
| AustinEral/bosun | BR | Rust agent runtime, at the planning stage ("Not yet implemented") | X. No code |
| willagio/ccx-loop | BR | Plugin: implement, then Codex review, then fix | SL |
| mikeyobrien/ralph-orchestrator | BR, AW | Ralph hat loop | Trial already recorded in `docs/plans/2026-11-14-ralph-trial-results.md` (not repeated). Its findings stand: resume gap, generic resume can release holds, bypass flags by default |
| lucasmeijer/AgentsInTheCloud | BR | Self-hosted Linux server platform | SL |
| kunchenguid/firstmate, plus distro forks (bastotec, brchue-ux, Coditan, daveonthegit, Jqda0, morecoffeyplease, TastyTom13, leihuang23, EvanBatten/firstmate-for-windows, FrostyFitz/quartermaster, amelie-pierce/agent-kit, jacksonlohxt/firstmate-duo, GunnerBot/firstmate) | BR, G1 | An "agent distro" run by an in-session LLM | SL (main repo). Forks are X as copies of it |
| BoatClaw (boatclaw/boatclaw) | BR, G2 | Board card to PR automation | X. No review loop, windows or approval gate |

### 3b. Shortlisted (scored in section 4)

| Name | How found |
|---|---|
| AndreaProvenzale/awaywork | G2 |
| croutoncreations/redline | G1 |
| RodrigoRLS2/supervised-agent-orchestrator | G2 |
| umputun/ralphex | WEB (CCCPlayer search) |
| wwind123/coding-review-agent-loop | G1 |
| HaiTrieu247/agentduo | NPM |
| Latand/delegatus | AW |
| razzant/claudexor | G1, HN, AW |
| Stepanokdev/bulava | G1 |
| lamtuanvu/pacer | G1 |
| frudotz/anafor-mcp | G2 |
| raysonmeng/agent-bridge | AW |
| Futuretunes/agentd | G2 |
| thisisnsh/bdfl | HN |
| the-open-engine/zeroshot | G1, AW |
| jedarden/subscription-quota-governor | G2 |
| orlenko/aiq | G2 |
| pasekahq/quota-balancer | G2 |
| nSimonFR/gleaner | G2 |
| RAAAAAGEEEEE/claude-lot | G2 |
| kimik-hyum/ai-schedule | G1 |
| surlymochan/swrm | G2 |
| pekinlcc/CCCPlayer | PH |
| satyaborg/devloop | HN |
| iammurtaza53/dev-agent-autopilot | AW |
| Vinix24/vnx-orchestration | G2 |
| mosonlab/anneal | G1 |
| crewplaneai/crewplane | AW |
| taovc/pr-cockpit | G2 |
| chernistry/bernstein | AW |
| navels/neal | HN |
| StefanosFafalios/claude-orchestrator | G2 |
| ElectricJack/agent-queue | G2 |
| kunchenguid/firstmate | BR |
| willagio/ccx-loop | BR |
| virtengine/bosun | BR |
| lucasmeijer/AgentsInTheCloud | BR |

### 3c. Read and scored lightly (L)

Each of these misses R1, R2 and R3. Evidence is held in the batch reports.

**Quota schedulers and pacing pieces that cover Claude only or warn only:**

| Name | How found | Reason |
|---|---|---|
| dujunyi416/claude-nightshift | G1 | Claude-only 5h ceiling; auto-resume |
| generativereality/ccremote | G1 | Types "continue" after reset |
| vasiliyk/claude-queue | G1 | Claude-only, cookie endpoint |
| EkinBarisC/claude-session-manager | G1 | Token budget |
| cmills-dev/steward | G1 | Claude-only weekly ceiling; bypass by default |
| robsyme/claude-gate | G1 | Request-pacing proxy |
| RajeshRk18/agentnice | G1 | In-session hook gate; fails open |
| brunomaida/claude-pace | G2 | Delays only |
| rezsekmv/ccq | G2 | Claude-only weekly pace |
| styamanda/claude-marathon | G2 | Bypass flags; `--continue` |
| DeepSpaceCartel/hortator | G1 | Display only |
| saaranshM/unsnooze | G1 | Warns, then auto-resumes |
| asiagenawi/claude-powernap | G2 | Advisory to the LLM |
| heyJordanParker/oneclaude | G1 | Multi-account router |
| synex1437/noctis | G2 | Claude wait-and-resume; autonomous queue |
| takurot/agent-scheduler | G1 | Reactive capacity; Docker |
| akiiwa-games/AgentCompass-Router | G1 | Fails open on stale data; bypass flags |
| CrazyToto/quota-boss | GC, G2 | In-session routing |
| yildizonur07/AI-Quota-Hub | G1 | Experimental; Windows |
| tbhb-dev/agent-capacity | GC | Metrics only |
| armantark/codex-workflows | G2 | SQLite checkpoints, but Claude jobs are read-only (`engine.py:673` "--permission-mode plan", Edit and Write disallowed), and no gate |

**Loops and orchestrators:**

| Name | How found | Reason |
|---|---|---|
| ozzaii/codex-claude-loop | G2, PH | Roles inverted; the LLM approves its own gates |
| hamelsmu/claude-review-loop | G1 | Stop hook; Codex bypass |
| sd0xdev/sd0x-harness | G1 | In-session |
| Tencent/LoopForge | G1 | Docker and MySQL team server; gates auto-approved |
| DaydayupV/claude-foreman | G1 | Roles inverted |
| openai/codex-plugin-cc | G1 | In-session review building block |
| OrchestratorInc/agent-orchestrator | G1, AW, PH | Fleet board; bypass |
| smithersai/smithers | NPM | Generic journaled flows; Linux-certified |
| loopx-project/loopx | G1 | In-session control plane |
| LineLuLan/line-harness | G1 | Windows personal config |
| keelstackhq/bosun | G1, NPM, CR | GitHub-state helper; auto-merge |
| Kanevry/session-orchestrator | NPM | In-session |
| jedarden/NEEDLE | AW | Linux; bypass |
| Ralph-Workflow/Ralph-Workflow | AW | Auto-integrates; bypass |
| surlymochan/swrm | G2 | Shortlisted above |
| frankbria/ralph-claude-code | AW | A 30-second prompt timeout means continue |
| openai/symphony | AW, WEB | Codex only; needs a tracker |
| Keesan12/martin-loop | AW | Dollar caps |
| vkuprin/ralph-harness | AW | Fresh `claude -p` per iteration in its own worktree, but bypass flags and auto-push |
| benord-labs/frink | G2, AW | Display-only windows; optional approval nodes |
| iha2/superlite | G1 | In-session; one-time plan approval |
| MarioMagdy/foreman | G1 | Prompt-only gates; Windows launcher |
| rusharlabs/house-party-protocol | G1, AW | No launcher |
| shinpr/galley | AW | Supervisor auto-accepts; bypass |
| guyshonshon/vibestrate | AW | No default gates |
| netbka/aiworks | AW | Windows-only; approvals off by default |
| lukas-grigis/ralphctl | G1 | Bypass; auto-commit |
| NicholasMTElliott/task-board | G2 | Cloud board; bypass |
| AdamFrisby/CodeyBox | G2 | VM audit panel; lands changes automatically; quota detected only after a failure (`ClaudeQuotaFailureDetector.cs`) |
| ryderderder/orchestrator | G2, GC | tmux team; routes to the account with most quota; no reserve gate |
| hieuphung97/dely | G1 | In-session skill needing the Orca terminal; design-contract approval only; no windows |
| theclaymethod/minions-pattern | G2 | Prose-only skill |

### 3d. Cloned and triaged by README and scan (X)

None of these has both a Claude-implements/Codex-reviews loop and either a window gate or an owner gate.

**Claude/Codex review plugins that run inside a live session (in-session, no pacing, no step gate):** adampaulwalker/codex-claude-skill, ajogalekar/claude-codex-loop, alecnielsen/adversarial-review, AlessioZazzarini/claude-codex-collab, alexzh3/codex-orchestrator, boyand/codex-review, chaseai-yt/claudex-loop, dheerg/codex-review-loop, mintmcp/dev-loop, leonlee/cc-pair (npm claude-codex-pair), promptadvisers/claudex, schuettc/codex-reviewer, Z-M-Huang/claude-codex (moved to vcp), tomascupr/sous-chef, rfxlamia/claude-foreman, olsenbrands/fable-foreman, hamza-ali-shahjahan/claudex, egsok/plan-tango (plans only), youagainchen/claude-codex-coop, kimyoungsik12/claude-codex-discussion.

**Loops and orchestrators without a gate or pacing:**

| Name | Reason |
|---|---|
| axeldelafosse/loop | Peer TUIs |
| battysh/batty | Auto-merges |
| baturyilmaz/spec2commit | Runs to commit |
| gavingolden/flow | End to end through merge |
| geastham/devpilot | Fleet cockpit |
| gmickel/flow-next | Plugin |
| guyskk/claude-code-supervisor | Provider switcher |
| homs-ai/steward | Cost tracking |
| ikamensh/kodo | Overnight autonomous |
| jscraik/ralph-gold | Ralph loop |
| kris-hansen/comanda | YAML workflows |
| mco-org/mco | Parallel compare |
| oxgeneral/ORCH | Task queue |
| orbi-build/orbi | Issue to merged PR, plus a cloud offering |
| rjcorwin/cook | Work then review |
| VisionForge-OU/foreman | Gated pipeline, Claude only, dollar caps |
| waltstephen/ArgusBot | 24/7 supervisor |
| tiammomo/RepoSteward | Context tool |
| srdrkr/agent-workbench | Hosted on Eve with Anthropic-hosted Claude Code |
| Tiavina-Andriamamivony/lou-agents-orchestrator | Governance prompts |
| ypsilonmeister/quota-fleet | Spec only |
| MoeAisaka/codex-delegation-gateway | OpenClaw plugin |
| hellotommmy/claude-serial-queue | Message queue |
| cascone26/claude-usage-tracker | Token pacing |
| dmlinn/desktop-runner | Linux host, Claude only |
| FlorianRiquelme/nachtschicht | Claude-only overnight |
| csabika98/claudequeue | Claude-only overnight |
| oluoyefeso/nightcrew | Claude-only overnight |
| yail259/overnight | Claude-only overnight |
| VadneyK/cloud-coder | Claude-only overnight |
| grundwerk/overnight-agents | Claude-only overnight |
| GodModeAI2025/NightShift | Claude-only overnight |
| dibyajyoti92/goodnight-alchemist | Claude-only overnight |
| rohanprichard/claude-overnight | Research questions |
| kvadney-insomniac/local-coder | Overnight runner |
| ZsoltSziklai/claude-code-agent-spawner | Bypass |
| KLIEBHAN/ralph-loop | Fresh context, no gates |
| olehsvyrydov/AI-development-team | Prompt gates in-session |
| vmehera123/leashd | Approval of tool calls, not steps |
| Q00/ouroboros | Agent OS; bypass |
| mohamedameen-io/AutoDev | Claude only |
| tatargabor/set-core | Claude fleet; merged features out |
| vercel-labs/durable-harness | Durable substrate; no gates or pacing |
| awslabs/cli-agent-orchestrator | tmux supervisor; bypass |
| chippingway/chipping-orchestrator | Issues to PRs |
| neels-ai-msp/foreman | Claude roles in-session |
| mgreau/zen | Worktree runner |
| wutlu/callmeclaude | Phone calls |
| ljheee/claude-supervisor | Claude only |
| carlchungus/durable-agent-handoff | Handoff format |
| jrad7/quartermaster | Jira-driven Claude |
| Nsilswal/bosun | Phone supervisor |
| PerishableDave/bosun | Personal email/calendar agent |
| wmeints/bosun | Pi ralph loop |
| yetidevworks/bosun | tmux session manager |
| thsrite/bosun | Web workbench |

### 3e. Search hits not cloned, by category (X)

The README description alone excludes these.

- **Usage monitors, statuslines and widgets** (they show windows but launch nothing): ccusage/ccusage, uppinote20/claude-dashboard, Javis603/token-monitor, vinzdg/codenotch, NoobyGains/usage-pulse, leeguooooo/claude-code-usage-bar, richhickson/claudecodeusage, ericjypark/codex-island, CodeZeno/Claude-Code-Usage-Monitor, eddmann/ClaudeMeter, frankchiu-dev/claude-codex-usage-dashboard, gxjansen/claude-code-meter, abhishekray07/claude-meter, bozdemir/claude-usage-widget, Nihondo/AgentLimits, kenn-io/vibepulse, dennykim123/claude-codex-battery, babakarto/CodexBar-Win, betoxf/Usagebar, mryll/claudebar, augiefra/claude-mods, anantraghunath/claude-code-usage-quota-mod, tylergraydev/claude-limitline, ohugonnot/claude-code-statusline, abdian/widget-usageClaude, leechild4/claude-session-widget, renatoaug/claude-usage-monitor, oauramos/claude-usage-stick, rootedlab-code/claude-code-usage-monitor, alpaslan-exe/claude-usage-kiosk, cbrisebois/usage-gauge, Cwooper/claude-usage-widget, coffeegrind123/claude-usage-win, poweruserz/OpenTokenUsage, MosrednA/UsageTray, kks0488/agent-quota, lambda5577/usage-pace, ralfzosel/agent-usage-pace, dkremsa/claude-pacer, McKean/aiquokka, alex107ivanov/claude-usage, vespexx/claude-code-statusline-pace, PaddleHQ/claude-statusline, thilinaa/notch-agent-hud, n2ns/antigravity-panel, Xalior/ClaudeOverseer, Socialpranker/agentburn, aceHubert/LocalQuotaBar, kinakomochi-0315/codex-rate-limits-api, legiosai/quartermaster, sivchari/ccowl, cobra91/better-ccusage, 851-labs/tokenmaxxing, atomchung/ccstory, sculptdotfun/viberank, SDpower/ccusage_go, recca0120/tmux-ccusage, ticpu/ccusage-statusline-rs, 6/ccusage-macos-menubar, Saqoosha/ccusage-menubar, JeongJaeSoon/ccusage-widget, Baek-Seunghyun/ai-coding-usage-card, anniebuildz/freshquota, Dubibubii/usage-limit-reducer, nicedreamzapp/claude-code-local, ooples/token-optimizer-mcp, nozikov/herdr-usage-limits, chiarorosa/claude-codex-taskbar, kcazin/SubPacer.
  - Plus crates.io: claude-quota-bar, agent-quota, lastcall, agentstat, quota-cli, vct.
  - Plus npm: quotamax, quotaburn, quota-axi, claude-code-quota, claude-token-lens, easy-claude, @smithers-orchestrator/usage.
  - Plus awesome-list entries: ClaudeBar, Codeburn, CCDash, ccvitals, claude-code-status-bar, Claumon (HN), Headroom (HN).
- **Window warmers and pingers** (they start windows; no pacing reserve): vdsmon/claude-warmup, BelAnas/warmup-scheduler, d0whc3r/agent-warmup, duskel/session-warmer, fabiomanz/claude-pacemaker, Fantasymax/UsageRush, geril07/ai-window-warmup, hakupao/stoker, huynguyenvietwork/claude-code-scheduler, jodagreyhame/claude-code-scheduler, MaansenV/wamer, Micsushi/quota-wake, noriworks/tokenkick, Papazy/ai-five-hour-scheduler, razielzaarur1/claude-quota-opener, sbd1017/ai-nudge-cli, semiherdogan/agent-poke, thevibeworks/claude-quota-scheduler, TZONELXY/quota-time-pinger, xtianowner/claude-quota-warmer, ZAAI-com/C5h, mamuncseru/claude-keepwarm, codeotter0201/claude-daily-check-in, Nerver-zip/ai-window-manager.
- **Auto-resume after hitting a limit** (the opposite of R3): henryaj/autoclaude, softcane/cc-session-recover, mo-arvan/herdr-claude-auto-retry, karthiknitt/smart_resume, orbenozio/claude-code-nonstop, sofumel/claude-handoff-revive, sunososobro-hub/claude-octopus, Anonymousmirror/claude-auto-continue, carlaost/resume-after-limit, ChrAlpha/cc-limit-resume (npm cc-limit-resume), dennis-lynch/claude-code-auto-resume, tyrypyrking/claude-auto-resume, zhihuiyuze/vibe-coding-auto-resume, paterlinimatias/claude-cc, bakabaka91/claude-baton, Fredje777/claude-zenvibe, benbasha/Claude-Autopilot, juliensimon/canopy, wrg32786/aigent-os.
- **Account switchers, pools and proxies** (multi-account routing, not pacing one account with a reserve): realiti4/claude-swap, inulute/cux, stephengardner/claude-auto-switch, SnlperStripes/claude-account-switcher, marinsokol5/agent-manager, NatureBlueee/quotapool, OlivierDijkstra/cliproxyapi-quota-router, Yousha-dev/team-routing, prdhome/quota-pilot, reyhenrick/claude-codex, cheaper-inference/OmniRoute, vinaygiri/freeway, nubbymong/ai-code-conductor.
  - Plus crates swapdex and link-assistant-router, npm maxpool, sideby and 9router, PyPI claude-code-fallback, and AW entries cc-router and clausona.
  - hraness/xcb is retired as of 2026-11-02 (its README says so).
- **Parallel session managers, GUIs and remote clients** (no review loop, pacing or tranche gate): slopus/happy, happier-dev/happier, ParadevAI/Paradev, 21st-dev/1code, agent-of-empires, golutra, open-mercato/cezar, tempestai-dev/tempest, alamops/agetor, ClipboardHealth/groundcrew, clawnify/ateam, corveil/crow, hangar-ai/hangar, Iron-Ham/claudio, nwiizo/ccswarm, affaan-m/claude-swarm, yohey-w/multi-agent-shogun, jayminwest/overstory, Yeachan-Heo/oh-my-claudecode, builderz-labs/mission-control, im4codes/imcodes, jerry12122/Claude-Code-Mini-App, spencerkit/coder-studio, zhu1090093659/CodeConductor, troyshu/agent-overseer, techize/overseer, AIverflow/overseer, inquire/tmux-overseer, rohit3a/overseer, electric-dragon-80000v/pi-cowboy, lidge-ai/cli-jaw, hristo2612/jinn, MackDing/CodexClaw, Aihuu08/tarocub, kingbootoshi/codex-orchestrator, stellarlinkco/myclaude, KimYx0207/Claudecode-Codex-Gemini, hoangsonww/AI-Agents-Orchestrator, catlog22/Claude-Code-Workflow, GreenSheep01201/claw-empire, Enderfga/claw-orchestrator, run-llama/agentfs-claude, RYOITABASHI/Shelly, xvirobotics/metabot, Intrect-io/OpenSwarm, kivo360/OmoiOS, fubak/ultraswarm, aeonfun/aeon (GitHub Actions), iefnaf/sig (Cloudflare), XpressAI/xpressclaw, serifcolakel/agent-control, AstroKhattab/claude-codex-tunnel, jvogan/a-fable-of-codexes, am-will/swarms, IMNMV/ClaudeR, persiyanov/herdr-reviewr, Latand/live-log-viewer-next, Nick5893/overseer, badursun/SelfClaude, ski043/marshal-factory, gulugulu-cn/vibe-foreman, ilkemerol/foreman, ilkemerol/foreman-vision-pub, olsenbrands/opus-foreman, V-Songbird/foreman, Turki-Sh/Foreman, fatihguner/foreman, JrSantiaggo/graph-foreman, mountaser/agy-foreman, GunnerBot/firstmate, AlienClubrider/bosun, Clarity-89/bosun, pilothouse/bosun, sanjay-29218/bosun, TTalkPro/bosun, zeptop-dev/bosun, bosun-agent/bosun-agent, seoulorigin/bosun_agent, jkarancs/AgentBosun, algonormative/bosun.
  - Plus HN items: Mozzie, OpenClawdex, Tide Commander, Emdash, Orc, BDFL (scored), Crew, Batty (scored), Overboard, Flow (scored), spec2commit (scored).
  - Plus crates.io: caucus, forge-orchestrator, axiopera, indra, brgr, fleetmux, ferrus, orch-cli, agent-call, agent-abstraction, oneharness.
  - Plus npm: smithers-orchestrator (scored), session-orchestrator (scored), clodia, claude-code-remote-pilot, devlyn-cli, cc-sdd, agentduo (scored).
  - Plus conductor.build (closed Mac app for parallel Claude Code and Codex in worktrees, with no pacing or review loop documented) and the PH products Wonder, Medley, Hive, ampm and loopflow, which were seen only through a search summary and are not verified.
- **Skills, methodology and other topics** (no orchestration engine, or off topic): wanshuiyin/Auto-claude-code-research-in-sleep, cobusgreyling/loop-engineering, maxmilian/loop-engineering, hhamja/loop-engineering-architecture, wquguru/harness-books, michaelshimeles/rstack, michaelshimeles/ralphy, Th0rgal/open-ralph-wiggum, kylemclaren/ralph, syuya2036/ralph-loop, totocaster/ralph-template, edxeth/pi-ralph-loop, aezizhu/super-ralph, niittymaa/multi-agent-ralph-loop, syntax-syndicate/speckit-ralph, Endogen/ralph-loop, ofux/lauren, strangersinsist/SVGLoop, gemini-cli-extensions/conductor, superbasicstudio/claude-conductor, lackeyjb/claude-conductor, tenxengineer/conductor_cc, hlhr202/Conductor-for-all, ScottBull/claude-conductor, ryanmac/code-conductor, Ibrahim-3d/orchestrator-supaconductor, jjanczur/tyran, cathrynlavery/codex-skill, lploc94/cross-review, nimaloo/cross-model, craigkitterman/cross-model-code-review-skill, adamjgmiller/adamsreview, onsails/skills, letitbk/claude-academic-setup, pvjbuilds/delegate-router, procoders/superpowers-v, devallibus/shiplog, kyy-logs/code-review-gate-skill, laodao-ai/sdflow-skills, pavel-molyanov/molyanov-ai-dev, SimpleEve/eo-skills, bashebr/ai-native-sdlc, klein-business/portable-agent-workflows, shahadulhaider/claude-code-harness, BernhardJackiewicz/icca-harness, Agile-V/agile_v_skills, povvo/claudikins-kernel, levnikolaevich/claude-code-skills, sno-ai/sno-station-skills, Archive228/loopkit, FerroxLabs/agents-md, rore/agent-workflow, levi-qiao/longgraph-skill, AgriciDaniel/secretary, Tsangares/claude-overseer-skill, goodarzilab/glab-overseer, VictorGjn/overseer, abishop1990/claude-overseer, eliBenven/overseer, DYAI2025/claude-overseer, kironkeyz/overseer-coder, AdversaLLC/quartermaster, IZZY-Agency/quartermaster, johnuppard/quartermaster, narehart/quartermaster, barryroodt/quartermaster, PranavNagrecha/Quartermaster, BEKOhub/quartermaster, JellyPuddy/quartermaster, Rojoloco04/Quartermaster, srinivastuta/quartermaster, AquilaXk/steward, distincthead/steward, Torrant5/agent-steward, wromansky/stewards, yicone/agent-steward, scrunchds/Model-Steward, yusuke-114/Steward, komnieve/steward, 37/steward, mnemon-dev/mnemon, jumbocontext/cli, femto/git-as-memory, Base67-AI/temporal-plugin, diagridio/diagrid-ai, milad-ahmd/durable-agent-workflows, clawplays/ospec, alexrolls/startup-factory, karansinghrajpurohit and singamsettivenkatanagasai-boop agentic-sdlc-orchestrator, umeshsarathy/AgentOpsML, romkravets/llm-server-orchestrator (local models), Wojtek0110/n8n-ai-agent-orchestration, gowtham16-bhu/maker-checker-agent, aldegad/safedeps, Community-Access/accessibility-agents, cth9191/cloneify, huanchong-99/SoloDawn, AMAP-ML/LongHorizon-Harness, appautomaton/latex-arxiv-SKILL, agentlas-ai/Agentlas-OS, jnMetaCode/agency-orchestrator, calebl/basecamp-mate, Gentleman-Programming/gentleman-guardian-angel, arizen-dev/deepseek-mcp, tphakala/agy-mcp, Boulea7/agy-mcp, Vanyangyang/cursor-bridge, FutureisinPast/mcp-agent-switchboard, ching-kuo/claude-codex, tomc98/claude-code-codex-skill, PerryLink/dsh-claude-move, pedrohcgs/claude-code-my-workflow, francoisgn/belayline-agentic-harness, T-Moody/tm-agent-harness, mariagorskikh/outreach-conductor.
  - Also excluded as off topic: H-mmer/pentest-agents, samugit83/redamon, x-glacier/kali-pentest, vichhka-git/OpenTor, evolsb/claude-legal-skill, hanlulong/econ-paper-review-skill, amirkiarafiei/open-scholar-peer, rambaarde/thesis-maker, conversion-agency/agentic-seo-skills, s1d-labs/overseer, saeedkolivand/ai-job-hunter-app, ShipItAndPray/job-apply-ai, Leo-mariaconty/b2b-order-intake-agent, shinglokto/openclaw-claude-bridge, VsevolodUstinov/openclaw-worker-relay, firstmatecloud/demo-microservice-nodejs, bosun-ai (swiftide, kwaak), recombine-ai Bosun, Hanno-Labs bosun-xs, bosun-labs/bosun, rquezada-tech/bosun, nkoda/Bosun.
  - The skill-directory review loops are prompt-only skills: corygabrielsen loop-codex-review, nickcrew codex-code-review, adhi-jp codex-review-cycle, timbroddin codex-review-loop, bear2u codex-claude-loop, yuichkun and makerjackie review-loop skills, and anywhere-agents implement-review.
  - Also listed: the awesome lists themselves (bradAGI, hesreallyhim, serenakeyitan, michielhdoteth, snwfdhmp/awesome-ralph). foreman's own repository surfaced in G1 and was excluded.
- **Vendor features (X):**
  - Claude Code routines and scheduled tasks: these run in the cloud. When a run hits the subscription usage limit, "additional runs are rejected until your usage window resets" (routines.md:476). There is no reserve and no Codex.
  - Claude Code `/goal`: it pauses on a usage limit (goal.md:147), but it is a single long session.
  - Dynamic workflows: in-session subagents, approved per launch.
  - `/ship` and PR Steward: GitHub pull-request agents for Team and Enterprise plans.
  - Codex app automations: background runs that report to an inbox; no approval gate per step.
  - OpenAI Symphony: scored above.
  - GitHub Agent HQ: runs Claude and Codex as cloud agents on Copilot premium requests, not the owner's Claude or Codex subscription windows.
  - None of these covers R1 or R2.

## 4. Shortlist scoring

Scores: M = MEETS, P = PARTIAL, N = NO, U = UNKNOWN. Paths are inside each repository at the commit given. Cells marked "verified" were re-checked by me against source.

**AndreaProvenzale/awaywork** (b5317c3, 2026-11-24, Apache-2.0)
- R1 P: `docs/guide/config/chains.md:85` "{ skill: review, provider: codex }" then `fix`. Every finding goes to `fix` with no owner filter.
- R2 M (verified): Codex reads `account/rateLimits/read` (`src/providers/codex.ts:87`); Claude reads `rate_limit_event` from a one-turn Haiku probe (`claude.ts:86, 199`). `schema.ts:61` sets "reserve: percent.prefault('10%')". `budget.ts:56-59` caps use at min(reserve, pacing, per_run). `budget.ts:126` launches only if "a.used < a.ceiling". The 5h window stops a run mid-way through `session_max`, 90% by default. Caveat: with no reading, `budget.ts:49-50` falls back to fixed caps instead of holding.
- R3 P (verified): plans hold "waiting for your approval" (`plans.md:86`) and nothing auto-merges. But review and fix loops continue, and `posts.md:45` says a report "goes ahead when they run clear ... counts as approved".
- R4 M: Claude runs as `-p ... --max-turns` (`claude.ts:100`); Codex runs as `exec --json --ephemeral --ignore-user-config --ignore-rules` (`codex.ts:28`); briefs come from `.away/context`.
- R5 P: run directory plus forge thread. No SQLite and no intent log.
- R6 P (verified): Claude runs with `--setting-sources project,local --settings <sandbox> --permission-mode dontAsk --allowedTools "Bash Read Edit Write Grep Glob Skill"`. Codex falls back to "danger-full-access" where its sandbox cannot start (`codex.ts:30`). Work happens in a supervisor-owned clone with no forge token, but the agent commits (`chains.md:57`).
- R7 P: local CLI with launchd, but it assumes a GitHub or Bitbucket forge.

**croutoncreations/redline** (8f1ae27, 2026-11-21, Apache-2.0)
- R1 N: one job per task.
- R2 M (verified): Claude through `api/oauth/usage`; Codex through `chatgpt.com/backend-api/wham/usage` (`internal/nativeusage/client.go:20-21`). `decision.go:604-620` returns unknown when the reading is stale, out of date at source, from the future, or missing the weekly figure. `decision.go:768, 784-786`: "current 5-hour reserve protected" sets Wait. The gate is callable as `redline decision --json` (exit 2 on unknown, per docs) and `POST /v1/providers/{account}/decision`.
- R3 P: automatic dispatch is off by default (`config.example.yaml:28-31`). Once on, it runs queued tasks unattended. Its RUN, WAIT and UNKNOWN holds stay distinct.
- R4 M: a fresh harness per task.
- R5 P: SQLite `dispatch_attempts` and `run_events`, plus interrupted-run recovery (`internal/store/runs.go:425`). Intent before effect not verified.
- R6 P (verified): Claude runs `--print ... --permission-mode auto` (`harness.go:365`) with no deny profile. Codex gets no sandbox flag. Worktree at `.redline/worktrees`.
- R7 M: local macOS app, loopback service and SQLite.

**RodrigoRLS2/supervised-agent-orchestrator** (9951643, 2026-11-16, no licence)
- R1 P: `states.py:3-4` "RUNNING → REVIEWING → WAITING_APPROVAL ... NEEDS_REVISION → RUNNING". Claude executes and Codex reviews. Revision notes go to the executor automatically with no owner filter, and README:321 says it currently runs "One attempt per task".
- R2 N: a rate limit or exhausted quota sends the task to FAILED (`orchestrator.py:27-29`). It reads no windows.
- R3 M (verified): `orchestrator.py:30` "para em WAITING_APPROVAL; nunca aprova nem rejeita" (it stops there and never approves or rejects). An unknown outcome goes to SUSPENDED, which only an authorized human `resume_suspended` releases (`:21-23`). `approvals.py:478` checks the state, and approvals are bound to the principal and a token.
- R4 M (verified): `claude_cli.py:137` "--restricted --safe-mode --strict-mcp-config --no-session-persistence"; `codex_cli.py:331` "--ephemeral".
- R5 M: `task_events` has an AUTOINCREMENT seq. `orchestrator.py:461` records the invocation marker before calling the agent.
- R6 M (verified): `claude_cli.py:139` "--permission-mode acceptEdits", no Bash, and `:22` never uses bypass flags. Codex runs with read-only profile and approval "never". Per-task worktree, and a tree fingerprint proves the reviewer changed nothing. Caveat: README:324 says the executor is not OS-sandboxed.
- R7 N (verified): README:326 "Linux only"; the interface is a Telegram bot.

**umputun/ralphex** (abaf2af, 2026-11-22, MIT)
- R1 P: Claude implements, Codex reviews read-only, and Claude fixes (`external_review.go:132` loop). Claude itself discards findings it judges invalid (`prompts/codex.txt:31`).
- R2 P: matches limit text and waits (`config:286, 294`). No readings.
- R3 N (verified): `external_review.go:177` "max %s iterations reached, continuing to next phase". Designed as "start ralphex, and walk away".
- R4 M: one section per fresh process, no `--resume`.
- R5 N: a progress text file.
- R6 P (verified): `config:23` "claude_args = --dangerously-skip-permissions ..." (can be overridden). `config:95` "codex_sandbox = read-only". `config:156` worktree off by default. The agent commits.
- R7 M: local binary.

**wwind123/coding-review-agent-loop** (9ebcfdb, 2026-11-23, MIT)
- R1 P: README:43 "Claude is the coder, Codex is the reviewer". Findings go back automatically as a work ledger.
- R2 N: matches limit text (`transient.py:66`), then waits.
- R3 P: auto-merge off by default (`cli.py:422`). Plan approval comes from reviewer agents, and the loop runs to unanimous approval.
- R4 P: the coder's session is resumed (`pr_loop.py:9295`, `claude.py:264`).
- R5 P: durable metadata lives in GitHub comments.
- R6 P: sandboxed mode runs Claude `acceptEdits` with path-scoped tools, and the Codex reviewer `--sandbox read-only` (`agent_permissions.py:1487-1502`). The coder commits and pushes.
- R7 P: needs `gh` and GitHub.

**HaiTrieu247/agentduo** (6e71761, 2026-11-19, MIT)
- R1 P: `config.ts:89` sets the implementer to Claude and the code reviewer to Codex. Fixes are automatic.
- R2 P: reads both clients (`usage.ts:155, 271`) for a display panel only. Its budget is tokens and dollars.
- R3 P: exits with code 2 on listed decision reasons. `pause_before_implement: false` by default. Never commits.
- R4 P: role sessions are resumed (`claude.ts:235`, `codex.ts:212`).
- R5 P: `events.jsonl`.
- R6 N: inherits each CLI's user config and works in the owner's folder.
- R7 M.

**Latand/delegatus** (e32ea24, 2026-11-24, MIT)
- R1 P: a role registry makes Claude builder and Codex reviewer possible. A failed review goes back to the builder automatically.
- R2 P: Claude windows from OAuth five_hour/seven_day (`src/lib/limits.ts:588`); Codex from the app-server. The 80% reserve covers only "proactive" agent-invented work (`proactiveReserve.ts:23`). Ordinary stages wait only at 100%.
- R3 P: stages auto-advance, and `advance` is the default when review rounds run out. Auto-merge off by default.
- R4 P: a fresh read-only reviewer each round.
- R5 P: SQLite WAL state; launches counted before the call (`docs/pipelines.md:140`).
- R6 N: `src/lib/agent/cli.ts:470-473` uses bypassPermissions for writers; the Codex writer gets `--dangerously-bypass-approvals-and-sandbox`; agents commit.
- R7 M: loopback daemon and Mac app.

**razzant/claudexor** (49399ff, 2026-11-23, MIT)
- R1 P: an `--until-clean` repair loop with a configurable reviewer panel. No owner filter.
- R2 P: Codex `account/rateLimits/read` (`codex-quota-source.ts:223`); Claude oauth/usage. The reserve is off by default (`orchestrator-credentials.ts:243` "headroom_threshold: 1"), and stale data fails open (`credential-profile-rotation.ts:139`).
- R3 P: protected paths pause apply; the repair loop auto-continues.
- R4 U.
- R5 P: event-log package and quota journal.
- R6 P: access profiles from acceptEdits up to bypassPermissions; Codex read-only up to danger-full-access.
- R7 M. Very large: about 813k lines.

**Stepanokdev/bulava** (a278e32, 2026-11-24, FSL-1.1)
- R1 P: Claude writes and Codex reviews through a Stop hook; findings go back automatically.
- R2 P: reads both (`claude-usage.sh:50` oauth/usage; `codex-usage.sh:66` app-server). The reserve defaults to 100, "burn them to the end" (`supervisor/config.sh:49`).
- R3 N: `permission-gate.sh:67` auto-allows; questions are auto-answered by a model; Enter is pressed on the limit dialog.
- R4 N: one long tmux session, resumed.
- R5 U.
- R6 P: Claude interactive `--permission-mode auto` in the project directory; Codex read-only.
- R7 M (macOS app).

**lamtuanvu/pacer** (40ec2c2, 2026-11-24, Apache-2.0)
- R1 P: planner and executor roles are configurable; the planner LLM reviews.
- R2 P: Claude `rate_limit_event` probe; Codex app-server. The planner reserve is 15, but executors are blocked only when exhausted (97%).
- R3 P: `pacer review --accept` is done by the planner LLM; fallback re-routes automatically.
- R4 P.
- R5 U.
- R6 N: `src/exec/launch.ts:125, 142` bypass both clients.
- R7 M.

**frudotz/anafor-mcp** (b27aa20, 2026-11-22, AGPL-3.0)
- R1 P: by default Codex implements and Claude reviews.
- R2 P: Claude statusline and Codex app-server readings. The reserve (10% of the 5h window, 15% of the weekly) only reorders workers. The hard skip is at 95%, and it auto-resumes after a reset if enabled.
- R3 N: the manager LLM calls `task_accept`, and acceptance merges into the task branch.
- R4 N: `--resume`.
- R5 P: SQLite events.
- R6 P: acceptEdits and Codex `-s`, in worktrees.
- R7 M.

**raysonmeng/agent-bridge** (0244dfa, 2026-09-13, MIT)
- R1 P: roles reversed, and the LLMs drive the loop.
- R2 P: reads 5h and weekly windows with a reserve and a `budget_paused` gate, but the readings come from an external probe (`~/.budget-guard`), it targets 98% use, and the gate covers only the Claude-to-Codex direction.
- R3 N: injects work automatically after a reset.
- R4 N.
- R5 U.
- R6 N: `max-permissions.ts:29, 37` bypass by default.
- R7 M.

**surlymochan/swrm** (7f5c126, 2026-11-23, Apache-2.0)
- R1 P: roles reversed.
- R2 P: Codex hard gate at 95% (`policy.json:50`). Claude readings only change the review mode.
- R3 N: the LLM merges with `--no-ff`.
- R4 P.
- R5 U.
- R6 P: Codex workspace-write in a worktree; the supervisor commits.
- R7 M.

**Futuretunes/agentd** (3471954, 2026-10-04, MIT)
- R1 N: no reviewer.
- R2 P: Codex app-server readings for display; none for Claude.
- R3 M per run: `runner.ts:2802-2822` queues only on approve; a fingerprint mismatch voids the approval; separate approvals for run, check and commit.
- R4 P.
- R5 P: SQLite events; interrupted runs are marked, not resumed.
- R6 P: Claude `-p --permission-mode dontAsk --tools ...`; Codex `--sandbox`; detached worktree.
- R7 N: Linux deployment target.

**thisisnsh/bdfl** (2eb2a68, 2026-07-30, MIT)
- R1 P: a verifier role and repair workers, with providers set per role.
- R2 N.
- R3 P, strong: `scheduler.js:171` "Execution requires approval of every plan section"; chunks need owner acceptance; integration is an owner action.
- R4 N: resumes worker conversations.
- R5 P: `workspace.json`.
- R6 P: Codex `--sandbox read-only` by default; workers acceptEdits in worktrees; workers commit.
- R7 M.

**the-open-engine/zeroshot** (ac400e7, 2026-11-23, MIT)
- R1 P: node graph with a configurable agent per node.
- R2 P: parses Claude `rate_limit_event` for diagnostics; stops on exhaustion. No reserve.
- R3 P: ask-a-person nodes, with timeout routed to failure; no built-in approval template; merge delivery available.
- R4 P.
- R5 M: SQLite run ledger (`v2_run_ledger.rs`).
- R6 N: adds bypass flags when no permission policy is set (`permissions.rs:36-39`, Codex `:61-62`).
- R7 M.

**jedarden/subscription-quota-governor** (1a8fd51, 2026-11-12, MIT)
- R1 N.
- R2 P: Codex app-server (`source.rs:1091`) and Claude oauth/usage; `reserve_fraction`; holds on stale data. Its output is a worker count for a fleet, not a yes/no per launch. The default credential path is Linux-style.
- R3 N. R4 N.
- R5 P.
- R6 N.
- R7 P: Linux and systemd.

**orlenko/aiq** (e8a7186, 2026-11-19, MIT)
- R1 N.
- R2 P: official surfaces and a weekly worker reserve; refuses with exit 75. Unknown or stale readings fail open (`selector.go:219, 328`); no 5h reserve.
- R3 N: redeems reset credits automatically by default.
- R4 N.
- R5 P: SQLite.
- R6 P: passes the caller's flags through.
- R7 M.

**pasekahq/quota-balancer** (9c29b59, 2026-11-23, AGPL-3.0)
- R1 N.
- R2 P: the cleanest pick, lease and report gate with per-role reserves (`qb-core/src/lib.rs:90`). A never-seen window counts as used=0 and stale data is used anyway (`docs/design.md:123-124`).
- R3 N. R4 N.
- R5 P: replayed journal.
- R6 N.
- R7 P: Linux and systemd.

**nSimonFR/gleaner** (1b10f06, 2026-05-14, no licence file)
- R1 N.
- R2 M as a mechanism: Claude oauth/usage and Codex rollout `token_count` `rate_limits`. The launch predicate is written by the user (`trigger.go:109`), and a failed reading becomes +Inf so the predicate refuses. No default reserve; Codex readings go stale between sessions.
- R3 N.
- R4 M.
- R5 N.
- R6 U.
- R7 P: built for cron or systemd.

**RAAAAAGEEEEE/claude-lot** (9abc157, 2026-11-23, MIT)
- R2 P: Claude only. The strongest Claude-side gate found: a `rate_limit_event` probe, caps at 85% (5h) and 90% (weekly), refusal with exit 75 (`claude_lot.py:67-69, 514`), and refusal when no reading is possible can be configured.
- R1 N. R3 N.
- R4 M.
- R5 P.
- R6 U.
- R7 P.

**kimik-hyum/ai-schedule** (e8fdb6c, 2026-07-08, MIT)
- R2 P: Claude only. OAuth usage read through the macOS keychain; each chunk is gated on at least 30% of the 5h window and 40% of the weekly window remaining (`jobrunner.py:41-42`, `planner.py:90`).
- R3 P: a job waits in `awaiting_approval`, then runs all its chunks.
- R1 N.
- R4 P. R5 P. R6 P (acceptEdits).
- R7 M.

**pekinlcc/CCCPlayer** (38228df, 2026-05-28, MIT)
- R1 P: right roles (`orchestrator.rs:451, 466`), no owner filter.
- R2 P: waits for reset, then resumes.
- R3 N: "walks away until the work is done".
- R4 M.
- R5 P: fsynced JSONL.
- R6 N: bypass detected and applied (`preflight.rs:203, 212`).
- R7 M.

**satyaborg/devloop** (9eaca63, 2026-08-17, MIT)
- R1 P: roles configurable.
- R2 N. R3 N: commits every pass and opens PRs. R4 N: `--resume`. R5 N.
- R6 N: `devloop:4432, 4408` bypass flags. A worktree is the default, and the supervisor commits.
- R7 M.

**iammurtaza53/dev-agent-autopilot** (2f995b9, 2026-10-11, MIT)
- R1 P: right roles, but inside one Claude session.
- R2 P: reactive.
- R3 N: runs to a PR; merging is denied to the agent.
- R4 N: `--bg` session, resumed.
- R5 N.
- R6 P: allow and deny settings; the agent commits and pushes.
- R7 P.

**Vinix24/vnx-orchestration** (1a6ce76, 2026-11-23, MIT)
- R1 P: Claude builds, with Codex and DeepSeek reviewing.
- R2 P: Codex readings for display; a block only after a quota receipt.
- R3 P: its own audit says promotion has "no approval id" in code.
- R4 P.
- R5 P: append-only NDJSON receipts.
- R6 P: Claude acceptEdits; Codex worker bypassed.
- R7 M.

**mosonlab/anneal** (bfa821b, 2026-09-25, MIT)
- R1 P: Codex implements, cross-provider blind reviews, Claude fixes.
- R2 N: regex backoff and a dollar cap.
- R3 P: gates exist but are off by default (`schema.prisma:548, 256`); merges unattended.
- R4 P.
- R5 P: Postgres.
- R6 N: hard-coded bypass flags.
- R7 P: Postgres through Docker.

**crewplaneai/crewplane** (acc0ced, 2026-11-23, Apache-2.0)
- R1 P: configurable executor and reviewer stages.
- R2 P: matches a string and sleeps.
- R3 N: no approval node.
- R4 M: one invocation per stage.
- R5 P: checkpoints.
- R6 P: provider defaults.
- R7 M.

**taovc/pr-cockpit** (7d2f5fc, 2026-10-27, MIT)
- R1 P: humans tick findings, the closest analogue to a findings file, but auto-fix uses all High and Medium findings.
- R2 N.
- R3 P: automation off by default.
- R4 N.
- R5 P: SQLite events.
- R6 N: worktree runs use bypassPermissions.
- R7 M. Aimed at reviewing other people's PRs.

**chernistry/bernstein** (0be8882, 2026-11-23, Apache-2.0)
- R1 P: the reviewer is an OpenRouter call, and an adapter failure counts as approve.
- R2 N.
- R3 P: `auto_merge` defaults to True (`config_schema.py:993`).
- R4 M.
- R5 M: hash-chained JSONL WAL written "before the action executes".
- R6 N: bypassPermissions.
- R7 P.

**navels/neal** (a162cde, 2026-11-23, MIT)
- R1 P. R2 N: reacts after the limit, then auto-resumes.
- R3 P: advances on reviewer acceptance; manual gates only where the plan declares them.
- R4 P: fresh coder per scope.
- R5 P.
- R6 N: SDK bypassPermissions.
- R7 M.

**StefanosFafalios/claude-orchestrator** (925e105, 2026-11-22, MIT)
- R1 P: a Codex read-only reviewer agent, driven by the LLM.
- R2 P: both readings, used for fallback rather than refusal.
- R3 N. R4 P. R5 N.
- R6 P: acceptEdits; Codex read-only.
- R7 M.

**ElectricJack/agent-queue** (442b186, 2026-11-04, MIT)
- R1 N: no reviewer by default.
- R2 P: readings only lower routing weight.
- R3 P: spec gate only.
- R4 M.
- R5 P: Postgres.
- R6 N: skips permissions in worktrees.
- R7 P: needs Postgres.

**kunchenguid/firstmate** (427056c, 2026-11-12, MIT)
- R1 N: review is delegated to the separate no-mistakes tool.
- R2 P (verified): `docs/usage-warner.md` "does not stop or pace anything"; `fm-quota-choose.sh` only excludes runways that are exhausted.
- R3 P: "Never merge ... without the captain's explicit word", but a per-project yolo mode exists. The rules are LLM-enforced prose.
- R4 P.
- R5 P.
- R6 N (verified): `bin/fm-spawn.sh:479-480, 854` defaults to `--dangerously-skip-permissions`; the only alternative is auto.
- R7 M.

**willagio/ccx-loop** (3c47fdf, 2026-07-08, MIT)
- R1 P: Claude in-session, Codex reviewing through the plugin; alternating roles in duet and conductor modes.
- R2 N: confirmed from source, `--max-budget-usd` does not reach the `claudeArgs` in `claude-companion.mjs:131-148`.
- R3 N: `loop.md:51` "Do NOT pause between phases"; the supervisor squash-merges.
- R4 P: conductor mode only.
- R5 N.
- R6 N: supervisor workers run with bypassPermissions (`supervisor.md:397`).
- R7 M.

**virtengine/bosun** (7f5a3a6, 2026-10-08, Apache-2.0)
- R1 P. R2 N: an empty `rateLimits: {}` placeholder.
- R3 N (verified): auto-merge.
- R4 U. R5 U.
- R6 N (verified): bypassPermissions; Codex `approvalPolicy: "never"`.
- R7 P: npm or Docker, with a UI server.

**lucasmeijer/AgentsInTheCloud** (1ae0d29, 2026-11-18, MIT)
- R1 N.
- R2 P: both readings for display only.
- R3 U. R4 U. R5 U.
- R6 N: bypass for both clients.
- R7 N: a dedicated Linux server.

## 5. Composition

The question is whether an existing engine can cover R1, R4 and R6, leaving foreman as a pacing-and-approval layer around it. The engine would need all three of:

- a fixed Claude-implements, Codex-reviews loop;
- a fresh process per step;
- a non-bypass permission profile in a supervisor worktree.

It would also need a hook before each launch that can refuse.

**Candidate engines:**
- **ralphex:** best on R1 and R4. It is not suitable because:
  - a claude_args override can fix its bypass default, but its phases auto-continue by design;
  - there is no supported stop-before-each-step hook, so the layer would have to drive it one section per invocation and stop it between runs;
  - Claude, not the owner, filters findings;
  - its worktree is off and the agent commits.

  A layer would have to reimplement the step boundary, the findings filter and the snapshot, which is most of the cycle.
- **wwind123/coding-review-agent-loop:** correct roles and a sandboxed mode, but it is bound to GitHub PRs and resumes the coder's session.
- **crewplane:** a cleaner generic stage runner with one process per stage. It has no hold primitive.
- **RodrigoRLS2/supervised-agent-orchestrator:** structurally closest. It is not adoptable: Linux namespaces and systemd, Telegram, and "all rights reserved".

So the original fallback, a small Effect supervisor wrapping bounded engine runs, has no engine to wrap without either undoing the engine's autonomy or rebuilding its loop. This matches what the Ralph trial found. The plan of direct Claude and Codex adapters stays justified.

**Pacing reuse:**
- redline is a credible external pacing gate. It is Apache-2.0, local on macOS, reads both providers, keeps a 5h reserve, and fails closed to UNKNOWN on stale or missing data. foreman could call `redline decision --json` (or its loopback HTTP endpoint) before each launch instead of computing admission itself.
- Costs: a Go daemon dependency on its release cycle; it reads Codex through the private `wham/usage` endpoint rather than the documented app-server method; and its policy model (weekly overflow, triggers, firesale, opt-in credit redemption) is richer than, and different from, foreman's approved admission contract.
- Lighter alternative: borrow the rules. Fail closed on stale, future or missing-weekly readings (redline `decision.go:604-620`), and cap at min(1 - reserve, linear pace to reset, per-run) (awaywork `budget.ts:56-59`). For the Claude probe pattern see claude-lot; for Codex app-server reading see subgov, aiq or awaywork.

**What the layer would be,** if the owner ever chose an engine anyway:
- a pre-launch admission check (redline or foreman's own pure function);
- a findings-file filter between review and correction;
- tranche holds that only the owner releases;
- a SQLite intent log;
- worktree and snapshot ownership;
- a fixed permission argv.

That is essentially foreman's current design. The engine would contribute only the two client invocations.

## 6. Not established, and what a trial would need to settle

- Nothing was run. All behaviour comes from reading source at the stated commits. Defaults can change.
- Gaps in the sweep itself:
  - No direct PyPI index search was done.
  - Product Hunt products Wonder, Medley, Hive, ampm and loopflow, and the closed-source tools conductor.build, Wayari and CodeAgentSwarm, were not inspected beyond search summaries.
  - GitHub search caps results at 15 per query, so low-star repositories phrased differently may be missed.
  - Repositories created after this sweep are not covered; the field is adding several per day.
- Per-candidate unknowns:
  - redline: whether WAIT (not just UNKNOWN) gets a distinct exit code from `decision --json`; whether the agent can commit in its worktree; whether its `wham/usage` Codex reading matches the app-server reading foreman's L2 test used.
  - awaywork: whether its fixed-cap fallback can be configured to hold instead.
  - RodrigoRLS2: whether its gate logic could run on macOS without the Linux containment.
- Trials worth considering:
  - A redline-as-gate trial, which needs separate approval. Install a pinned redline in a scratch home, point it at the owner's real logins in observe-only mode (dispatch disabled), and compare its `decision --json` and reserve verdicts with foreman's own L1 and L2 readings over a few days.
  - Settle the questions above: exit codes for WAIT versus UNKNOWN, behaviour on a stale Codex reading, and whether `wham/usage` and app-server `account/rateLimits/read` agree.
  - No engine trial is recommended; the source already shows the blocking defaults.

## 7. Rulings (judgments the brief left open)

1. **Shortlist threshold.** I shortlisted anything with real code toward R1, R2 or R3, and scored the rest lightly with evidence. Why: about 160 candidates could not all get full scoring. Cost if wrong: a light-scored tool might deserve a full row. The evidence for each was a decisive NO, such as bypass flags plus auto-continue.
2. **Delegated scoring.** Seven read-only agents scored the batches, and I re-checked only the decisive cells (marked verified). Why: volume. Cost if wrong: an unverified cell may misquote a line. The overall verdict rests only on verified cells.
3. **"Configurable roles" counted as R1 PARTIAL, never MEETS, without an owner findings filter.** Why: R1 explicitly requires the owner's findings file. Cost if wrong: R1 scores would be one notch harsher than another reader's.
4. **"Wait for reset, then auto-resume" scored at most PARTIAL for R2, and treated as a negative for R3.** Why: the brief says reserve pacing is required. Cost if wrong: none for the verdict.
5. **A missing reading falling back to fixed caps (awaywork) still scored R2 MEETS.** Why: it reads both windows, keeps a reserve and gates launches, and the fallback is a policy choice. Cost if wrong: awaywork's R2 overstated; foreman would treat it as failing open.
6. **redline's Codex reading through `wham/usage` was accepted for R2.** Why: it is the clients' own account usage reading, though not the app-server method. Cost if wrong: it may diverge from foreman's L2-tested surface.
7. **In-session plugins scored R3, R4 and R5 as NO or PARTIAL.** Why: when the LLM orchestrates, gates are prose and the context is one long conversation. Cost if wrong: a well-hooked plugin might deserve PARTIAL rather than NO.
8. **Licence-blocked or platform-blocked tools (no licence, Linux-only, FSL, AGPL) were excluded from "adoptable" but still scored.** Why: R7, and reuse risk. Cost if wrong: an owner willing to run Linux or AGPL code would see more options.
9. **Monitors, warmers, account switchers and auto-resumers were logged by name in groups rather than one row each.** Why: they do not orchestrate or gate launches. Cost if wrong: if one of them hides a launch gate, it is missed. The ones with launch code were cloned and scored.
10. **foreman's own repository surfaced in search and was excluded without naming its owner.** Why: privacy, and it is the subject of the sweep. Cost if wrong: none.
11. **All clones and scan files were deleted.** I kept only the method notes and rubric in the session scratchpad (`/private/tmp/claude-501/-Users-ethan-Desktop-foreman/fac40c6b-d2bc-47d0-b6a2-e6e22dced596/scratchpad/`). Why: the brief required deleting clones. Cost if wrong: re-checking a cell means re-cloning at the listed commit.