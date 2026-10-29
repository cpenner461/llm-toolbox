#!/usr/bin/env bash
# Scope and packaging helpers for the adversarial-review skill.
#
#   scope.sh range [BASE_REF | A..B | A...B]
#       Create a work dir and write the diff under review. With no argument the base is the
#       merge-base of the default branch and HEAD, and uncommitted + untracked changes are
#       included. With BASE_REF the base is merge-base(BASE_REF, HEAD), uncommitted included.
#       With an explicit range only those commits are reviewed. Prints key=value lines.
#   scope.sh packet WORKDIR
#       Assemble WORKDIR/packet.md (reviewer brief + spec + diff). Needs WORKDIR/spec.md.
#   scope.sh snapshot
#       Print a tree id for the current working tree (tracked + untracked, .gitignore honored)
#       without touching the real index.
#   scope.sh fixdiff TREE WORKDIR
#       Write WORKDIR/fix.patch (TREE -> current working tree) and WORKDIR/verify-packet.md.
#       Needs WORKDIR/spec.md and WORKDIR/accepted.md.
set -euo pipefail

skill_dir=$(cd "$(dirname "$0")/.." && pwd)
top=$(git rev-parse --show-toplevel)
cd "$top"

die() { echo "error: $*" >&2; exit 1; }

snapshot() {
  local idx
  idx=$(mktemp "${TMPDIR:-/tmp}/adv-review-index.XXXXXX")
  rm -f "$idx"
  if git rev-parse --verify --quiet HEAD >/dev/null; then
    GIT_INDEX_FILE="$idx" git read-tree HEAD
  fi
  GIT_INDEX_FILE="$idx" git add -A
  GIT_INDEX_FILE="$idx" git write-tree
  rm -f "$idx"
}

default_branch() {
  local b c current
  current=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  # Ignore origin/HEAD when it names the branch we are on; the base would then be HEAD itself.
  if b=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) && [[ "${b#origin/}" != "$current" ]]; then
    echo "$b"; return
  fi
  for c in main master trunk develop; do
    [[ "$c" == "$current" ]] && continue
    if git rev-parse --verify --quiet "refs/heads/$c" >/dev/null; then echo "$c"; return; fi
    if git rev-parse --verify --quiet "refs/remotes/origin/$c" >/dev/null; then echo "origin/$c"; return; fi
  done
  return 1
}

new_workdir() {
  local dir=".adversarial-review/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dir"
  local exclude
  exclude=$(git rev-parse --git-path info/exclude)
  mkdir -p "$(dirname "$exclude")"
  grep -qxF '.adversarial-review/' "$exclude" 2>/dev/null || echo '.adversarial-review/' >> "$exclude"
  echo "$top/$dir"
}

cmd_range() {
  local arg=${1:-} base base_ref head_tree uncommitted
  if [[ "$arg" == *...* ]]; then
    base_ref=${arg%%...*}
    base=$(git merge-base "$base_ref" "${arg#*...}") || die "cannot resolve $arg"
    head_tree=$(git rev-parse "${arg#*...}^{tree}")
    uncommitted=no
  elif [[ "$arg" == *..* ]]; then
    base_ref=${arg%%..*}
    base=$(git rev-parse --verify "$base_ref^{commit}") || die "cannot resolve $base_ref"
    head_tree=$(git rev-parse "${arg#*..}^{tree}")
    uncommitted=no
  else
    base_ref=${arg:-$(default_branch)} || die "no default branch found; pass a base ref"
    base=$(git merge-base "$base_ref" HEAD) || die "no merge-base between $base_ref and HEAD"
    head_tree=$(snapshot)
    uncommitted=yes
  fi

  local wd
  wd=$(new_workdir)
  git diff --find-renames "$base" "$head_tree" > "$wd/diff.patch"
  git diff --find-renames --name-status "$base" "$head_tree" > "$wd/files.txt"
  git diff --find-renames --stat "$base" "$head_tree" > "$wd/stat.txt"
  git log --oneline "$base..HEAD" > "$wd/commits.txt" 2>/dev/null || true

  if [[ ! -s "$wd/diff.patch" ]]; then
    echo "error: empty diff for base $base_ref ($base); nothing to review" >&2
    rm -rf "$wd"
    exit 4
  fi

  cat <<EOF | tee "$wd/scope.txt"
workdir=$wd
repo=$top
base_ref=$base_ref
base_sha=$base
head_sha=$(git rev-parse HEAD)
head_tree=$head_tree
includes_uncommitted=$uncommitted
files_changed=$(wc -l < "$wd/files.txt" | tr -d ' ')
diff_lines=$(wc -l < "$wd/diff.patch" | tr -d ' ')
EOF
}

cmd_packet() {
  local wd=${1:?usage: scope.sh packet WORKDIR}
  [[ -s "$wd/spec.md" ]] || die "$wd/spec.md is missing or empty"
  {
    cat "$skill_dir/reviewer-brief.md"
    printf '\n## Specification\n\n'
    cat "$wd/spec.md"
    printf '\n## Changed files\n\n```\n'
    cat "$wd/files.txt"
    printf '```\n\n## Diff under review\n\n```diff\n'
    cat "$wd/diff.patch"
    printf '```\n'
  } > "$wd/packet.md"
  echo "$wd/packet.md"
}

cmd_fixdiff() {
  local tree=${1:?usage: scope.sh fixdiff TREE WORKDIR} wd=${2:?usage: scope.sh fixdiff TREE WORKDIR}
  [[ -s "$wd/accepted.md" ]] || die "$wd/accepted.md is missing or empty"
  git diff --find-renames "$tree" "$(snapshot)" > "$wd/fix.patch"
  [[ -s "$wd/fix.patch" ]] || die "fix diff is empty; no changes since $tree"
  {
    cat "$skill_dir/verification-brief.md"
    printf '\n## Specification\n\n'
    cat "$wd/spec.md"
    printf '\n## Accepted findings and intended fixes\n\n'
    cat "$wd/accepted.md"
    printf '\n## Fix diff\n\n```diff\n'
    cat "$wd/fix.patch"
    printf '```\n'
  } > "$wd/verify-packet.md"
  echo "$wd/verify-packet.md"
}

case "${1:-}" in
  range) shift; cmd_range "$@" ;;
  packet) shift; cmd_packet "$@" ;;
  snapshot) snapshot ;;
  fixdiff) shift; cmd_fixdiff "$@" ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
