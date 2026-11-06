# llm-toolbox

This repository contains personal LLM tools. It is a Claude Code plugin marketplace. Each machine can install only the plugins that it needs. Tools that are not Claude Code plugins also go here, for example Codex configuration, prompts, and setup scripts.

At this time, the repository has one plugin, `review`. This plugin has one skill: an adversarial code review with multiple reviewers.

## Install on a new machine

1. In Claude Code, add the marketplace:
   ```
   /plugin marketplace add cpenner461/llm-toolbox
   ```
2. Install the plugin:
   ```
   /plugin install review@llm-toolbox
   ```

From a shell, use `claude plugin marketplace add cpenner461/llm-toolbox` and `claude plugin install review@llm-toolbox`.

To get a new release:

1. Run `claude plugin marketplace update llm-toolbox`.
2. Run `claude plugin update review@llm-toolbox`.
3. In each open session, run `/reload-plugins`.

The Codex reviewer is optional. It runs only if the [Codex CLI](https://github.com/openai/codex) is installed and you are logged in (`codex login`). If not, the skill skips it, shows a one-line note, and uses the other two reviewers.

## The `review` plugin

Use this skill after a session completes a task. Ask for it explicitly, for example "run an adversarial review" or `/review:adversarial-review [base-ref | A..B] [spec]`. A request such as "review this" does not start the skill. This is intentional.

The skill does these steps:

1. It finds the changes to review. The default is all changes since the branch started from the default branch, including uncommitted and untracked files.
2. It finds the spec. The spec is a file or issue that you name, your original request, or a plan file in the repository.
3. It starts three reviewers in parallel: two Claude subagents on different models (correctness, and design and risk), and Codex in a read-only sandbox.
4. It merges the findings, removes duplicates, and examines each finding in the code.
5. It records a decision for each finding (accept, reject, or defer) and a reason.
6. It applies the accepted fixes. It does not commit them.
7. It starts one new reviewer to examine only the fix diff. It does not start more review rounds.
8. It shows a summary table, the fixes, and the open items.

The reviewers get only the spec and the diff. They do not get the explanation from the session that wrote the code. A reviewer that reads the reasoning of the author usually agrees with it. All reviewers return findings in one JSON format (`skills/adversarial-review/findings.schema.json`).

Each run writes its scope, spec, prompts, and reviewer output to `.adversarial-review/<timestamp>/` in the reviewed repository. Read `report.md` in that directory for the final report. The `*-findings.json` files contain the unchanged output of each reviewer. The skill adds this directory to `.git/info/exclude`, thus git does not show or commit it. You can delete it at any time.

### Modes

The skill has two options. You can use one, both, or neither.

- `deep`: The reviewers use stronger models for this run only. The defaults are fable for correctness and opus for design. Codex uses a higher reasoning effort.
- `report-only`: The skill finds and sorts the findings, then stops. It does not change the code and does not do the verification review.

Examples: `/review:adversarial-review deep`, or "run a deep adversarial review, report only".

To compare a standard review and a deep review on the same code:

1. Run `/review:adversarial-review report-only`.
2. Run `/review:adversarial-review deep report-only`.
3. Make sure that the two `report.md` files show the same scope.
4. Ask Claude to compare the two runs.

Each run has its own directory in `.adversarial-review/`. Reviewers do not read the directories of earlier runs.

### Configuration

The `model:` line in each agent file sets the Claude reviewer model:

- `plugins/review/agents/adversarial-reviewer-correctness.md` (opus)
- `plugins/review/agents/adversarial-reviewer-design.md` (sonnet)

The file `plugins/review/skills/adversarial-review/config.env` contains the models for deep mode and all Codex settings: on or off, model, `-c` overrides, session log, and timeout. By default, Codex saves a session log for each review in `~/.codex/sessions`, so usage tools can count its tokens. Set `CODEX_REVIEW_EPHEMERAL=1` to run without a log.

The Claude models are in the agent files because Claude Code reads the model of a subagent from there. A separate configuration file can become different from the agent files without an indication.

## Develop a plugin locally

To use a plugin without installing it, start Claude Code with the plugin directory:

```
claude --plugin-dir ./plugins/review
```

The plugin shows as `review@inline`. Changes apply in a new session, or after you run `/reload-plugins`.

To test the full marketplace as a new machine sees it:

1. Run `/plugin marketplace add ~/path/to/llm-toolbox`.
2. Run `/plugin install review@llm-toolbox`.

A marketplace from a local path loads plugins from your checkout. Changes apply after `/reload-plugins` or in a new session. You do not need to change the version. Before you add the GitHub marketplace, remove the local one with `claude plugin marketplace remove llm-toolbox`.

Before you commit, validate the manifests:

```
claude plugin validate .
claude plugin validate ./plugins/review
```

The validator also shows warnings for the public plugin directory, for example a missing icon. These warnings apply only if you submit a plugin to that directory.

### Evals

The directory `plugins/review/evals/` contains two eval cases:

- `catches-seeded-bugs` copies a small Python project from a git bundle. Its feature branch has five known bugs and one safe decoy. The case runs the skill and grades which bugs it found and fixed.
- `casual-review-does-not-trigger` makes sure that a casual request does not start the skill.

To run the evals:

```
claude plugin eval ./plugins/review --scaffold --allow-tools Bash,Write,Edit
```

Each eval is a real model run, and it costs money. When you change prompts, use `--case` and `--runs 1`.

## Versioning

The version of each plugin is only in its `.claude-plugin/plugin.json`. Do not put a version in `marketplace.json`. Thus, there is one version to change, and the two files cannot disagree.

A version locks the installed copies. Machines that install from GitHub get a change only after the version changes. Change the version for each change that other machines must get:

- Patch: changes to prompts or text.
- Minor: new skills, new agents, or new behavior.
- Major: changes that break how you use the plugin, for example a new skill name or a new configuration format.

Commit the version change together with the change. `--plugin-dir` and local-path marketplaces do not use the version.

## Repository structure

```
llm-toolbox/
├── .claude-plugin/marketplace.json   # one entry for each plugin in plugins/
├── plugins/
│   └── review/                       # one directory for each Claude Code plugin
│       ├── .claude-plugin/plugin.json
│       ├── agents/
│       ├── skills/<skill-name>/SKILL.md (+ supporting files)
│       └── evals/
├── LICENSE
└── README.md
```

To add a plugin:

1. Make the directory `plugins/<name>/`.
2. Add `.claude-plugin/plugin.json` with `"version": "0.1.0"`.
3. Add the component directories, for example `skills/` and `agents/`.
4. Add an entry to `marketplace.json` with `"source": "./plugins/<name>"`. Do not add a version.
5. Run `claude plugin validate .`.

Keep each plugin small, because you install plugins one at a time on each machine.

Put tools that are not Claude Code plugins in their own top-level directory, for example `codex/`, `prompts/`, or `scripts/`. Make a directory only when you have a file for it.

Put a tool with large dependencies or its own build (for example an MCP server) in a separate repository. The marketplace can refer to it with a `github` or `git-subdir` source.

## Design decisions

The correctness reviewer uses opus and the design reviewer uses sonnet. Different models make different mistakes. Codex adds a third model family.

The verification reviewer uses the correctness agent, but as a new instance. It does not know the first review round.

If the skill cannot find a spec, it asks you for one. It does not make a spec from the diff, because that spec tells reviewers that the code is correct.

The Codex output uses `--output-schema`. Thus, its findings have the same format as the Claude findings.
