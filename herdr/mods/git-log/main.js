// Git log for "this session": on a feature branch, the commits it has that the
// default branch (origin/HEAD, main, master) doesn't, plus uncommitted work; on the
// default branch itself, today's commits. Pick "All changes", "Uncommitted" or a
// commit to see its files, then a file to see its diff. Follows the focused pane's repo.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, settings } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git, so the folder watch doesn't wake itself.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_COMMITS = 300;

// One row per diff line. Handles a whole multi-file diff: each file's
// "diff --git" header becomes a file row, and its index/---/+++ lines are dropped.
function diffRows(lines) {
  let old = 0, next = 0, header = false;
  const rows = [];
  for (const line of lines) {
    const file = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (file) { header = true; rows.push({ kind: "f", text: file[2] }); continue; }
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { header = false; old = +match[1]; next = +match[2]; rows.push({ kind: "@", text: line }); continue; }
    if (header) { if (/^Binary files/.test(line)) rows.push({ kind: "", text: "Binary file changed" }); continue; }
    const kind = line[0];
    if (kind === "-") rows.push({ kind, number: old++, text: line.slice(1) || " " });
    else if (kind === "+") rows.push({ kind, number: next++, text: line.slice(1) || " " });
    else if (kind === " ") { old++; rows.push({ kind, number: next++, text: line.slice(1) || " " }); }
    else rows.push({ kind: "", text: line });
  }
  return rows;
}

function ago(seconds) {
  const s = Math.max(0, Date.now() / 1000 - seconds);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function numstat(text) {
  const files = [];
  for (const entry of text.split("\0")) {
    const [a, d, ...parts] = entry.replace(/^\n+/, "").split("\t");
    if (!parts.length) continue;
    files.push({ path: parts.join("\t"), add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" });
  }
  return files;
}

export default class GitLog extends View {
  init(_props, cx) {
    // The commits section's height as last dragged; the diff takes the rest.
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("commitsHeight") ?? "null"); } catch {}
    this.commitsHeight = typeof saved === "number" ? saved : 320;
    this.drag = null;  // { y, start } while the divider is held
    this.expanded = false; // whether the selected entry shows its message and files (folded at first)
    this.total = 0;    // both sections' combined height, from on_size_change
    this.reset();
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    // Follow focus even when no redraw comes (hidden, or a load was under way):
    // cheap, since git only runs when the focused folder actually changed.
    cx.timer.every(1000, (cx) => { if (key() !== this.context) this.refresh(cx); });
  }

  reset() {
    this.root = null; this.commits = []; this.wip = []; this.all = []; this.files = [];
    this.pick = "all"; this.open = null; this.rows = []; this.diffWidth = 0;
    this.error = null; this.mode = null; this.watched = null; this.session_ = null;
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  // What the session is measured against: [label, base commit, log range args].
  async session(git) {
    const branch = (await git(["branch", "--show-current"])).stdout.trim();
    const names = [];
    const sym = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (sym.code === 0 && sym.stdout.trim()) names.push(sym.stdout.trim());
    names.push("origin/main", "origin/master", "main", "master");
    let main = null;
    for (const name of names) {
      if ((await git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`])).code === 0) { main = name; break; }
    }
    const short = main?.replace(/^origin\//, "");
    if (main && branch !== short) {
      const mb = await git(["merge-base", "HEAD", main]);
      if (mb.code === 0) return { branch: branch || "detached", label: `vs ${main}`, base: mb.stdout.trim(), range: [`${mb.stdout.trim()}..HEAD`] };
    }
    // On the default branch (or no default branch): today's commits.
    const today = await git(["rev-list", "--since=midnight", "HEAD"]);
    const oldest = today.stdout.trim().split("\n").filter(Boolean).pop();
    let base = (await git(["rev-parse", "HEAD"])).stdout.trim() || EMPTY_TREE;
    if (oldest) {
      const parent = await git(["rev-parse", "--verify", "--quiet", `${oldest}^`]);
      base = parent.code === 0 ? parent.stdout.trim() : EMPTY_TREE;
    }
    return { branch: branch || "detached", label: "today", base, range: ["--since=midnight", "HEAD"] };
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) { this.context = context; this.reset(); }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.reset(); this.context = context; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const hasHead = (await git(["rev-parse", "--verify", "--quiet", "HEAD"])).code === 0;
        const s = hasHead ? await this.session(git) : { branch: "no commits", label: "", base: EMPTY_TREE, range: null };
        let commits = [];
        if (s.range) {
          const log = await git(["log", `-${MAX_COMMITS}`, "--no-color", "--shortstat", "--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1f%b%x1d", ...s.range]);
          if (log.code !== 0) throw new Error(log.stderr);
          commits = log.stdout.split("\x1e").filter((x) => x.trim()).map((chunk) => {
            const [head, stat = ""] = chunk.split("\x1d");
            const [sha, short, subject, author, time, body = ""] = head.replace(/^\n+/, "").split("\x1f");
            return { sha, short, subject, author, body: body.trim(), time: Number(time),
              add: Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0), del: Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0) };
          });
        }
        const wip = hasHead ? await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"]) : { code: 0, stdout: "" };
        const all = await git(["diff", s.base, "--numstat", "-z", "--no-renames"]);
        if (key() !== context) return;
        this.root = root; this.on = on; this.session_ = s; this.commits = commits; this.error = null;
        this.wip = numstat(wip.stdout); this.all = numstat(all.stdout);
        if (this.pick !== "all" && this.pick !== "wip" && !commits.some((c) => c.sha === this.pick)) { this.pick = "all"; this.open = null; }
        this.watch(root, cx);
        await this.loadFiles(context);
        await this.loadDiff(context);
      } catch (e) { if (key() === context) this.error = String(e); }
      finally {
        this.loading = false;
        // Focus moved while this load ran: load the new place now.
        if (key() !== this.context) this.refresh(cx);
        cx.notify();
      }
    });
  }

  // The selection's diff arguments: everything after them is `-- path` or `--numstat`.
  diffArgs() {
    const base = this.session_?.base ?? EMPTY_TREE;
    if (this.pick === "all") return ["diff", base];
    if (this.pick === "wip") return ["diff", "HEAD"];
    return ["show", "--format=", "--diff-merges=first-parent", this.pick];
  }

  async loadFiles(context) {
    if (this.pick === "all") this.files = this.all;
    else if (this.pick === "wip") this.files = this.wip;
    else {
      const r = await exec("git", [...READ, ...this.diffArgs(), "--numstat", "-z", "--no-renames"], { cwd: this.root, on: this.on });
      if (key() !== context) return;
      this.files = r.code === 0 ? numstat(r.stdout) : [];
    }
    if (this.open && !this.files.some((f) => f.path === this.open)) this.open = null;
  }

  // The open file's diff, or with none open the selection's whole diff.
  async loadDiff(context) {
    const path = this.open, pick = this.pick;
    const r = await exec("git", [...READ, ...this.diffArgs(), "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", ...(path ? ["--", path] : [])], { cwd: this.root, on: this.on });
    if (key() !== context || this.open !== path || this.pick !== pick) return;
    const all = r.stdout.replace(/\n$/, "").split("\n");
    const has = all.some((l) => l.startsWith("@@") || l.startsWith("Binary files"));
    const file = path && this.files.find((f) => f.path === path);
    const LIMIT = path ? 3000 : 8000;
    const lines = r.code !== 0 ? ["Cannot preview this diff"] : !has ? [file?.binary ? "Binary file changed" : "No changes"] : all.slice(0, LIMIT);
    if (has && all.length > LIMIT) lines.push(`… ${all.length - LIMIT} more lines: pick a file to see it whole`);
    this.setLines(lines.map((l) => (l.length > 4000 ? l.slice(0, 4000) + "… (line truncated)" : l)));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map((line) => line.length * 7 + 50));
  }

  // A click on an entry: a new one is selected and opened; the selected one opens or folds.
  choose(pick, cx) {
    if (this.pick === pick) { this.expanded = !this.expanded; cx.notify(); return; }
    this.pick = pick; this.expanded = true; this.open = null; this.files = []; this.setLines([]);
    const context = this.context;
    cx.spawn(async (cx) => {
      try { await this.loadFiles(context); cx.notify(); await this.loadDiff(context); } catch {}
      cx.notify();
    });
    cx.notify();
  }

  // A file click shows just that file; clicking it again goes back to the whole diff.
  openFile(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]);
    const context = this.context;
    cx.spawn(async (cx) => { try { await this.loadDiff(context); } catch {} cx.notify(); });
    cx.notify();
  }

  // The commits section's height: as dragged, but leaving the diff at least 80px.
  height() {
    const max = this.total > 0 ? this.total - 80 - 6 : Infinity;
    return Math.max(56, Math.min(max, this.commitsHeight));
  }

  divider(t) {
    return div().id("log-divider").h(6).flex_none().cursor_row_resize().bg(this.drag ? t.accent : t.border)
      .hover((s) => s.bg(t.accent))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.drag = { y: e.position.y, start: this.height() };
        cx.notify();
      });
  }

  dragTo(y, cx) {
    if (!this.drag) return;
    this.commitsHeight = Math.round(this.drag.start + y - this.drag.y);
    this.commitsHeight = this.height();
    cx.notify();
  }

  endDrag(cx) {
    if (!this.drag) return;
    this.drag = null;
    try { localStorage.setItem("commitsHeight", JSON.stringify(this.commitsHeight)); } catch {}
    cx.notify();
  }

  // A labelled section: a small header, then its body filling the rest.
  section(title, detail, t, body) {
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(24).flex_none().px(14).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(10.5).text_color(t.muted)
        .child(div().flex_none().font_semibold().child(title.toUpperCase()))
        .child(div().min_w(0).truncate().text_color(t.dim).child(detail)))
      .child(div().flex_1().min_h(0).child(body));
  }

  stat(add, del, t) {
    return h_flex().flex_none().gap(6).text_size(11)
      .when(add > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (e) => e.child(div().text_color(t.ansi1).child(`−${del}`)));
  }

  // A commit's whole message, under its row: subject, body, who and the full hash.
  message(c, t, mono) {
    // Paragraphs rejoined (git wraps at ~72 columns); list items and indented lines keep their breaks.
    const lines = [];
    for (const raw of (c.body || "").split("\n")) {
      const line = raw.trimEnd(), prev = lines.length - 1;
      if (!line.trim()) lines.push("");
      else if (prev >= 0 && lines[prev] && !/^\s*([-*•]|\d+[.)])\s|^\s{2,}/.test(line)) lines[prev] += " " + line.trim();
      else lines.push(line);
    }
    return v_flex().id(`log-msg-${c.sha}`).flex_none().ml(68).mr(8).mb(4).mt(2).pl(10).py(4).gap(2)
      .border_l(2).border_color(t.border).text_size(12).text_color(t.muted)
      .child(div().text_color(t.foreground).font_semibold().child(c.subject))
      .children(lines.map((line, i) => line.trim() ? div().child(line) : div().h(6).flex_none()))
      .child(div().pt(4).text_size(10.5).text_color(t.dim).font_family(mono).child(`${c.author} · ${c.sha}`));
  }

  // The selected entry's files, under its message: click one to see only its diff.
  fileList(t) {
    return v_flex().id("log-entry-files").flex_none().ml(68).mr(8).mb(8).pl(10).border_l(2).border_color(t.border)
      .children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`log-file-${f.path}`).h(24).flex_none().px(6).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
          .when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.openFile(f.path, cx))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .child(this.stat(f.add, f.del, t));
      }))
      .when(!this.files.length, (e) => e.child(div().px(6).py(4).text_size(12).text_color(t.dim).child(this.loading ? "Loading…" : "No file changes")));
  }

  entry(id, pick, left, title, right, t) {
    const on = this.pick === pick;
    return h_flex().id(id).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
      .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.choose(pick, cx))
      .child(left).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title)).child(right);
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "f") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.chrome).border_t(1).border_color(t.border).font_semibold().text_color(t.foreground).child(text);
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), s = this.session_;
    const sum = (files) => files.reduce((n, f) => [n[0] + f.add, n[1] + f.del], [0, 0]);
    const [allAdd, allDel] = sum(this.all), [wipAdd, wipDel] = sum(this.wip);
    const mono = settings().font_family ?? "JetBrains Mono";
    const tag = (text, color) => div().w(52).flex_none().font_family(mono).text_size(11).text_color(color).child(text);

    const list = [];
    if (this.root) {
      const open = (pick) => this.expanded && this.pick === pick;
      list.push(this.entry("log-all", "all", tag("all", t.accent), `All changes ${s?.label ? `(${s.label})` : ""}`,
        h_flex().gap(6).items_center().child(div().text_size(11).text_color(t.dim).child(`${this.all.length} files`)).child(this.stat(allAdd, allDel, t)), t));
      if (open("all")) list.push(this.fileList(t));
      if (this.wip.length) {
        list.push(this.entry("log-wip", "wip", tag("wip", t.blocked), "Uncommitted",
          h_flex().gap(6).items_center().child(div().text_size(11).text_color(t.dim).child(`${this.wip.length} files`)).child(this.stat(wipAdd, wipDel, t)), t));
        if (open("wip")) list.push(this.fileList(t));
      }
      for (const c of this.commits) {
        list.push(this.entry(`log-${c.sha}`, c.sha, tag(c.short, t.dim), c.subject,
          h_flex().gap(6).items_center().child(this.stat(c.add, c.del, t)).child(div().w(26).text_right().text_size(11).text_color(t.dim).child(ago(c.time))), t));
        if (open(c.sha)) list.push(this.message(c, t, mono), this.fileList(t));
      }
    }
    const empty = this.error || (this.loading ? "Loading…" : !this.root ? "No folder" : null);

    return v_flex().id("git-log").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Git Log"))
        .when(Boolean(s), (e) => e.child(div().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(s.branch))
          .when(Boolean(s.label), (e) => e.child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(s.label))))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(this.root ? `${this.commits.length}${this.commits.length >= MAX_COMMITS ? "+" : ""} commits` : "")))
      .child(v_flex().id("log-sections").flex_1().min_h(0)
        .on_size_change((size, cx) => { this.total = size.height; cx.notify(); })
        .on_mouse_move((e, cx) => this.dragTo(e.position.y, cx))
        .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
        .child(div().flex_none().h(this.height()).child(this.section("Commits", this.root ? String(this.commits.length) : "", t,
          v_flex().id("log-commits").size_full().overflow_y_scrollbar().p(6)
            .children(list).when(Boolean(empty), (e) => e.child(div().p(8).text_color(t.dim).child(empty))))))
        .child(this.divider(t))
        .child(div().flex_1().min_h(0).child(this.section("Diff", this.open ?? (this.root ? `all ${this.files.length} files` : ""), t,
          div().size_full().relative().font_family(mono).text_size(11)
            .child(div().id("log-diff-x").size_full().overflow_x_scrollbar()
              .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("log-diff", this.rows.length, 20, (i) => String(i),
                (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
            .child(Scrollbar.vertical("log-diff").viewport_from_layout().absolute().inset_0())))));
  }
}
