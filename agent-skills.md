---
name: token-guard
description: >
  Token usage and rate limit management skill. Measures real consumption
  from JSONL logs, diagnoses the current session, applies targeted reduction
  rules, and compresses agent output. Triggers on: "hitting my limit",
  "save tokens", "token usage", "running out", "rate limit", "am I wasting
  tokens", "check my usage". Never dumps all rules at once — acts only on
  confirmed diagnosis.
triggers:
  - token
  - usage
  - rate limit
  - running out
  - save tokens
  - hitting my limit
  - am I wasting
  - burning through
  - compact
  - token cost
---

# TOKEN-GUARD SKILL

## CORE PHILOSOPHY
Measure first. Diagnose second. Apply 2-4 targeted fixes only. Confirm before acting.
Output in compressed caveman format — drop filler, keep facts.

---

## PHASE 1 — MEASURE (Always run this first)

Run the usage report against real JSONL logs:

```bash
python3 ~/.claude/skills/usage-limit-reducer/scripts/usage-report.py --days 7
```

If script missing, read logs directly:
```bash
ls ~/.claude/projects/*/*.jsonl 2>/dev/null | head -5
```

Extract and display only:
- Total input tokens (last 7 days)
- Total output tokens (last 7 days)  
- Cache hit % (if available)
- Cost estimate by model
- Which project is burning most tokens

Output format (compressed):
USAGE 7d:
input:  X,XXX,XXX tokens  ($X.XX)
output: XXX,XXX tokens    ($X.XX)
cache:  XX% hit rate
top project: [name] — XX% of spend
model: [current model]

If logs unreadable → skip to PHASE 2 with session-only data.

---

## PHASE 2 — DIAGNOSE (Current session)

Check these four signals. Report only what's true:

| Signal | Check | Flag if |
|--------|-------|---------|
| Conversation length | Count turns in context | > 20 turns |
| CLAUDE.md | `ls CLAUDE.md 2>/dev/null` | Missing |
| Model tier | Current model name | Not haiku for simple tasks |
| Output verbosity | Avg response length | Agent writing essays |

Report as single block:
SESSION DIAGNOSIS:
[✓/✗] Conversation long (XX turns) — re-reading cost: ~XX% of tokens
[✓/✗] CLAUDE.md missing — no memory compression
[✓/✗] Model: [name] — [appropriate/overkill] for current task
[✓/✗] Output verbose — XX avg tokens/response

---

## PHASE 3 — APPLY (2-4 rules max, ranked by impact)

Pick ONLY the rules matching flagged signals above.
Never list all rules. Never explain rules not being applied.

### RULE LIBRARY

**R1 — Compact conversation** (apply if: > 20 turns)
Suggested action: /compact
Effect: compresses context, cuts re-read cost ~60-80%

**R2 — Create CLAUDE.md** (apply if: file missing)
Suggested action: create CLAUDE.md with project facts
Effect: agent loads facts once, not re-derives per turn

**R3 — Switch model** (apply if: haiku viable for task)
Suggested action: /model claude-haiku-4-5
Effect: 10-20x cheaper per token, same quality for simple tasks

**R4 — Enable caveman output mode** (apply if: output verbose)
Suggested action: activate compressed response style
Effect: ~65-75% fewer output tokens, full technical accuracy preserved
Rules: drop articles, use fragments, symbols over words, pipe tables
for repeating data, no throat-clearing, no summaries at end
code blocks and commits bypass compression — written normally
technical terms kept exact — "polymorphism" stays "polymorphism"

**R5 — Clear and restart** (apply if: context bloated beyond repair)
Suggested action: /clear
Effect: full context reset, start fresh

**R6 — Reduce tool verbosity** (apply if: many tool calls logged)
Suggested action: batch tool calls, avoid redundant reads
Effect: cuts input tokens from tool results

**R7 — Use cache-friendly patterns** (apply if: cache hit % < 30%)
Suggested action: keep system prompt stable, reuse conversation openers
Effect: improves cache hit rate, reduces effective cost

---

## PHASE 4 — CONFIRM BEFORE ACTING

Present selected rules as a numbered list.
Ask: "Apply which? (1,2 / all / none)"

Wait for response. Do not act until confirmed.

On confirmation:
- Execute suggested commands directly if possible (/compact, /clear, model switch)
- For CLAUDE.md: draft the file and ask to review before writing
- For caveman mode: activate immediately and confirm with "[CAVEMAN MODE ON]"
- For model switch: run the command, confirm new model active

---

## CAVEMAN OUTPUT RULES (when R4 active)

Apply these to all responses while mode is on:
DROP:   articles (a, an, the), filler phrases, summaries, preambles
USE:    fragments, symbols (→ ✓ ✗ ≈), pipe tables for lists
KEEP:   code blocks normal, git commits normal, technical terms exact
NEVER:  "Great question!", "Certainly!", "As I mentioned", "In conclusion"
FORMAT: diagnoses as fragments — "re-render: new obj ref each cycle"
fixes as imperatives — "wrap in useMemo"
errors as location+problem — "L42: null guard missing"

Intensity levels (user can request):
- `caveman lite` — drop filler, keep grammar
- `caveman full` — fragments, symbols, tables (default)
- `caveman ultra` — telegraphic, abbreviate everything

Deactivate: "stop caveman" or "normal mode"

---

## WHAT NOT TO DO

- Do not list all 11 rules unprompted
- Do not explain rules that don't apply to this session
- Do not run /compact or /clear without confirmation
- Do not switch models without confirmation
- Do not output verbose diagnosis — the diagnosis itself must be compressed
- Do not re-run measurement on every turn — once per invocation only

---

## QUICK REFERENCE (on /token-guard help)
COMMANDS:
/token-guard          → full measure + diagnose + recommend
/token-guard stats    → usage report only, no diagnosis
/token-guard caveman  → activate compressed output mode immediately
/token-guard reset    → deactivate caveman, restore normal output
/token-guard help     → this card
TRIGGER PHRASES (auto-activate):
"hitting my limit" / "save tokens" / "running out"
"check my usage" / "am I wasting tokens" / "rate limit"
