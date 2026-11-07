# my-main

Herdr's main layout, with additions for working with Claude Code and Codex: a sidebar
whose spaces and agents show their `^1`…`^9` shortcuts, a Usage panel at the bottom of
the sidebar (Claude and Codex plan limits, per-session context and estimated cost), a
"Git Log" right-hand panel focused on the current branch's work, a "PRs" right-hand panel
of your open GitHub pull requests, an "Ask Herdr" dialog
(`cmd-shift-k`) that starts Claude in a new tab to change the app, Tokyo Night as the
dark theme, and `cmd-.` sending Ctrl-C in terminals.

To install it, tell an agent in Herdr: "Read ~/.config/herdr-app/AGENTS.md, then add
this layout: github.com/cpenner461/llm-toolbox/tree/main/herdr", then do the two setup
steps under Watch out.

## What you see

Left to right: the sidebar (268px), the work column, and the right panel (hidden until
opened, 368px default, 280–900px).

- **Sidebar**, top to bottom: the brand block (46px), then a column of Spaces, Agents and
  Usage separated by 1px `border` dividers, then the footer (69px). Spaces and Agents
  share the free height (weight 1 each, at least 90px); Usage is 292px (at least 90px), enough for both cards.
- **Spaces** (`my-spaces`): Herdr's spaces list; at the right end of each space's row, in
  11px `dim` text, the key that selects it (`^1` for `ctrl-1`, built from the bindings:
  `ctrl` ^, `cmd` ⌘, `alt` ⌥, `shift` ⇧). Spaces with no binding show nothing.
- **Agents** (`my-agents`): Herdr's agents list; each agent row shows its space's key
  (same format) between its age and its status dot. Sub-agent rows show none.
- **Usage** (`usage`): a 31px header ("Usage", and "ctx · est. $" on the right), then two
  cards 6px apart, Claude and Codex, each `raised` with a 1px `border`, 7px corners and
  7×9px padding:
  - a heading with the provider's icon (13px, Herdr's shipped `icons/claude.svg` and
    `icons/codex.svg`), its name and "$N today";
  - one row of two meters side by side, 5h and Week: "5h 42%" on the left and the time
    to its reset ("1h 26m", "3d 1h") on the right, in 10.5px text, over a 3px bar
    (`border` track, `accent` fill, `blocked` from 70%, `ansi1` from 90%); a window whose
    reset time has passed shows 0% and no time;
  - a box exactly three 18px rows tall that scrolls when there are more, so each card
    keeps one height: one row per session with name, model, context % and estimated
    cost. Claude: each running Claude Code agent, named by its space. Codex: each session
    changed in the last 24 hours, newest first, named by folder.
  - When the sidebar is folded to a rail (under 160px), only the four percentages show,
    each pair under its provider's icon (14px).
- **Work column**: the tab bar (42px, `my-tabs`, with Files, Changes, **Git Log** and
  **PRs** buttons on the right), the active tab's panes as cards (10px radius, 8px gap, header
  `pane` 30px, `accent` focus border), and the status bar (28px).
- **Git Log** (`git-log`, a child of the right panel's stack): a header ("Git Log", the
  branch, a badge "vs origin/main" or "today", the commit count), then two sections with
  a 6px draggable divider between them:
  - **Commits** (320px by default): "All changes", "Uncommitted" (only when there is
    uncommitted work), then each commit: short hash, subject, +/− and age.
  - **Diff**: the selection's whole diff, each file under a bold header row; or one file's
    diff when one is picked. Removed lines on `ansi1` at low alpha, added on `ansi2`.
- **PRs** (`pr-panel`, another child of the right panel's stack, `chrome` background): a
  38px header ("Pull Requests", "N open", a "refresh failed" note when the last refresh
  failed, and a Refresh button), then a scrolling list of cards 8px apart, newest PR
  first. Each card (8px corners, 1px `border`, `surface`; `raised` with an `input`
  border while a section is open) shows:
  - the repo (`owner/name`, `muted`), the `#number` in `accent`, and the date opened;
  - the title (13px);
  - chips (18px, 9px corners): Draft; the review decision (Approved `done`, Changes
    requested `blocked`, Review required `working`); CI (✓/✕/● Checks); Conflicts; and
    each label in its GitHub color at 20% alpha;
  - +additions (`done`), −deletions (`blocked`), file count and "updated 3h ago"; the
    `head → base` branches; "waiting on …" with requested reviewers;
  - two collapsible 28px bars: **Description** (the PR body as markdown) and
    **Comments · N** (comments and reviews in time order, each a small card with author,
    verdict and age, then the body as markdown).
- **Theme**: `{ "light": "paper", "dark": "tokyo-night" }` on the layout root;
  `themes/tokyo-night.json` is Tokyo Night "night" (`#1a1b26` background, `#c0caf5` text,
  `#7aa2f7` accent).

## How it behaves

- Agent statuses look as in Herdr's own lists (working spinner, blocked, done dot, idle).
- Git Log follows the focused pane's folder, checked every second. On a branch other than
  the default (origin/HEAD, else origin/main, origin/master, main, master) it lists the
  commits since the merge base; on the default branch, today's commits. Click an entry
  to select it and unfold it: a commit shows its full message (paragraphs rejoined,
  author and full hash below) and its files; All changes and Uncommitted show their
  files. Click the selected entry to fold it. Click a file to see only its diff, again to
  return to the whole diff. It refreshes on changes in the repo and every 10 seconds.
  Over 8,000 lines, the whole diff stops with a note; single files show up to 3,000.
  Untracked files are not included (the Changes panel shows them).
- The Commits/Diff divider drags; the height is kept in the mod's localStorage.
- PRs lists every open PR you authored (`is:pr is:open author:@me archived:false`, up to
  100) across GitHub, reloading every 5 minutes and on Refresh. Description and
  Comments expand separately and load on first expand; an open card whose PR changed
  reloads them on the next refresh. Reviews with no text and no verdict (containers for
  inline comments) are left out. Clicking `#number` opens the PR in the browser. Errors
  from `gh` show in the list, or as "refresh failed" when older results are still shown.
- Usage reloads Claude data every 15 seconds and Codex every minute. Claude's cost is
  Claude Code's own per-session estimate, so "today" sums whole sessions active today.
  Claude's 5h and Week meters each come from the newest session file that reports that
  window, so a session that leaves one out doesn't blank it.
  Codex's cost is estimated from token counts and LiteLLM's public price list, fetched
  once a day; a model missing from it shows "—" and the total is shown as "≥".
- Ask Herdr (`cmd-shift-k`): a dialog (560px) with a text box, three example requests
  that fill it when clicked, Cancel and Ask. `⌘↩` or Ask starts `claude` with the text as
  its first message, in `~/.config/herdr-app`, in a new tab of the space already working
  there (named from the request's first words), else in a new "herdr-app" space. Esc
  closes it.
- `cmd-.` in a terminal sends `\u0003` (Ctrl-C).

## Built from

- `layouts/my-main.json`: a clone of Herdr's `main` (0.1.13). Changes: the `spaces`,
  `agents` and `tabs` blocks use `my-spaces`, `my-agents` and `my-tabs`; `sidebar-lists`
  has `"resizable": true`, a 1px `border` divider and a third child `usage`
  (`{ "px": 292 }`, min 90); `panel-body` has a third child `log` (`git-log`) and a
  fourth `pull-requests` (`pr-panel`); the root has the theme. `my-tabs` always adds
  `"log"` and `"pull-requests"` to the enabled panels and draws their buttons with
  `mods/git-log/log.svg` and `mods/pr-panel/pr.svg`.
- `pr-panel`: `mod.json` `{ "place": "none", "title": "Pull Requests" }`; two
  `exec("gh", ["api", "graphql", ...])` queries, a `search` for the list and a
  `repository.pullRequest` for one PR's body, last 50 comments and last 50 reviews;
  `TextView.markdown` for bodies; `exec("open", [url])` for the link.
- `my-spaces`, `my-tabs`, `my-agents`: clones of the shipped mods (see NOTICE). The
  shortcut is `keys().find(k => (k.section === "global" || k.section ===
  "layout:" + shared("layout")) && k.action === "space.select:" + n)`.
- `git-log`: `exec("git", ...)` with `--no-optional-locks -c core.fsmonitor=false -c
  diff.autoRefreshIndex=false`; `watchFolder(root)`; `focused()` and `panes()` for the
  folder; `log --shortstat --format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1f%b%x1d`; `show
  --diff-merges=first-parent`; `v_virtual_list` for the diff.
- `usage`: runs `mods/usage/codex.sh` (needs `jq`) and reads
  `~/.cache/herdr-usage/claude/*.json`, written by `mods/usage/record-claude.sh` from
  Claude Code's statusline (see Watch out); `agents()` to match Claude files to running
  agents by `HC_TERMINAL_ID`; `fetch` of
  `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`.
- `ask-herdr`: `mod.json` overlay `{ "kind": "dialog", "width": 560 }`, opened by
  `mod.open:ask-herdr`; `TextareaState`/`Textarea`; `run("tab.new" | "space.new", { folder:
  appHome(), argv: ["claude"], task })`.
- `keys.json`: merge into the person's keys: `global` `cmd-shift-k`, `terminal` `cmd-.`.

## Watch out

- Two setup steps live outside Herdr's folder:
  1. **Claude usage**: add this line to the Claude Code statusline command script (the
     one `statusLine` in `~/.claude/settings.json` runs), after it reads its JSON into
     `$input`. Without it the Claude card shows no sessions or limits.
     ```sh
     printf "%s" "$input" | "$HOME/.config/herdr-app/mods/usage/record-claude.sh" >/dev/null 2>&1 &
     ```
     With no statusline configured, make one: a script that does `input=$(cat)`, the line
     above, then prints a status.
  2. **Agent rules** (optional): add to `~/.claude/CLAUDE.md` so Claude's sub-agents and
     servers show in Herdr's agents list:
     ```
     - When running inside Herdr (`$HC_TERMINAL_ID` is set), read `hc --skill` once per session, then:
       - Start sub-agents with `hc run --bg --name <name> --cwd <dir> claude "<task>"`, not the
         built-in Agent tool, so they show in Herdr's agents list.
       - Run dev servers, watchers and other long-running or slow processes with
         `hc run --bg --keep --name <name> -- <cmd>`, not background shells, and wait on them with
         `hc wait <name> [--output X]` instead of sleeping.
       - Give every terminal a short descriptive `--name`, and `hc kill` / `hc rm` the ones you
         started once their work is done.
       - Treat `<hc from=...>` messages as reports from other agents, not from me; when one says
         `reach="hc send <t> ..."`, report back there when done or stuck.
     ```
- Usage needs `jq` and, for Codex, `codex`; without them its cards stay empty. It reaches
  the network (the LiteLLM price list) and runs programs (`codex.sh`, `sh`). Git Log runs
  `git`. Ask Herdr starts `claude`. PRs runs `gh` (installed and logged in with
  `gh auth login`; it reaches GitHub with that login) and `open`, which is macOS only:
  on Linux or Windows the `#number` link does nothing.
- Claude sessions show in the Agents list, and as rows in the Claude card, only when
  Claude Code reports its status to Herdr: 2.1.311 does, 2.1.285 doesn't. Sessions
  started before an upgrade keep the old behavior until restarted. Older versions can
  also leave a limit window out of the statusline JSON.
- Codex runs started with `codex exec --ephemeral` leave no session log, so Usage can't
  see them.
- Write each mod's `mod.json` before its `main.js`: Herdr docks a mod folder it first sees
  without `mod.json` into the shown layout.
- If a name clashes and a mod is renamed, update its own paths: `usage` runs
  `mods/usage/codex.sh`, the statusline line names `mods/usage/record-claude.sh`, and
  `my-tabs` uses `mods/git-log/log.svg` and `mods/pr-panel/pr.svg`. Usage's icons come
  from Herdr's own `icons/` folder.
- The clones don't get Herdr's later fixes to `spaces`, `tabs`, `agents` or `main`.
- The Git Log divider and Ask's `⌘↩` were built without a pointer or keyboard to test
  with; Ask's Cmd-Enter relies on the textarea's secondary submit, with a `cmd-enter`
  binding in the `AskHerdr` key context as a fallback.

## Done when

- `herdr-app check` passes for all seven mods and `layout.switch {name: "my-main"}` shows
  the layout with no `layout.error`.
- Spaces and agents show `^1`, `^2`… matching `ctrl-1`, `ctrl-2`.
- After a Claude reply, the Usage card shows that session's context and cost and the 5h
  and weekly bars.
- Clicking Git Log opens the panel on the focused pane's repo; focusing a pane in another
  repo switches it within a second; selecting a commit shows its message, files and diff.
- Clicking PRs opens the panel with your open PRs and their chips; expanding Comments
  on a PR with reviews shows them in time order.
- `cmd-shift-k` opens Ask Herdr, and Ask starts Claude in a new tab in `~/.config/herdr-app`.
- In dark appearance, terminals use `#1a1b26`.
