// Pull Requests: my open PRs on GitHub with their review, CI, size, branch and
// label metadata. Each card's Description and Comments (comments and reviews)
// expand separately; both load on first expand. Clicking the PR number opens it in the browser.
// Everything comes from `gh api graphql`, using gh's own login.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { exec, theme } from "herdr";

const REFRESH_MS = 5 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const LIST_QUERY = `query {
  search(query: "is:pr is:open author:@me archived:false", type: ISSUE, first: 100) {
    nodes { ... on PullRequest {
      number title url createdAt updatedAt isDraft
      repository { nameWithOwner name }
      headRefName baseRefName additions deletions changedFiles
      reviewDecision mergeable
      labels(first: 10) { nodes { name color } }
      reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      comments { totalCount } reviews { totalCount }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;

const DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    body
    comments(last: 50) { nodes { author { login } createdAt body url } }
    reviews(last: 50) { nodes { author { login } createdAt body state url } }
  } }
}`;

function date(iso) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? "" : ` '${String(d.getFullYear()).slice(2)}`}`;
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return date(iso);
}

async function graphql(query, vars = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  const r = await exec("gh", args);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || `gh exited ${r.code}`);
  const json = JSON.parse(r.stdout);
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

export default class PrPanel extends View {
  init(_props, cx) {
    this.prs = null; this.error = null; this.loading = false;
    // Which PRs (by url) have their description / comments section expanded.
    this.open = { desc: new Set(), talk: new Set() }; this.details = {};
    this.load(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.load(cx));
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const data = await graphql(LIST_QUERY);
        this.prs = data.search.nodes.filter((n) => n?.number)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        this.error = null;
        // Refresh the conversation of any expanded PR that changed since it loaded.
        for (const pr of this.prs) {
          const d = this.details[pr.url];
          if (d && d.updatedAt !== pr.updatedAt) { delete this.details[pr.url]; if (this.open.desc.has(pr.url) || this.open.talk.has(pr.url)) this.loadDetail(pr, cx); }
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  loadDetail(pr, cx) {
    if (this.details[pr.url]) return;
    this.details[pr.url] = { loading: true, updatedAt: pr.updatedAt };
    cx.spawn(async (cx) => {
      const [owner, name] = pr.repository.nameWithOwner.split("/");
      try {
        const p = (await graphql(DETAIL_QUERY, { owner, name, number: pr.number })).repository.pullRequest;
        const events = [
          ...p.comments.nodes.map((c) => ({ ...c, kind: "comment" })),
          // Reviews with no text and no verdict are just containers for inline comments.
          ...p.reviews.nodes.filter((r) => r.body?.trim() || r.state !== "COMMENTED").map((r) => ({ ...r, kind: "review" })),
        ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        this.details[pr.url] = { body: p.body ?? "", events, updatedAt: pr.updatedAt };
      } catch (e) {
        this.details[pr.url] = { error: String(e?.message ?? e), updatedAt: pr.updatedAt };
      }
      cx.notify();
    });
  }

  toggle(section, pr, cx) {
    const set = this.open[section];
    if (set.has(pr.url)) set.delete(pr.url);
    else { set.add(pr.url); this.loadDetail(pr, cx); }
    cx.notify();
  }

  // Small rounded tag.
  chip(text, fg, bg) {
    return div().flex_none().px(6).h(18).flex().items_center().rounded(9).text_size(10.5)
      .text_color(fg).bg(bg).child(text);
  }

  meta(pr) {
    const t = theme();
    const chips = [];
    if (pr.isDraft) chips.push(this.chip("Draft", t.muted, t.raised));
    const review = {
      APPROVED: ["Approved", t.done],
      CHANGES_REQUESTED: ["Changes requested", t.blocked],
      REVIEW_REQUIRED: ["Review required", t.working],
    }[pr.reviewDecision];
    if (review) chips.push(this.chip(review[0], review[1], t.raised));
    const ci = pr.commits.nodes[0]?.commit?.statusCheckRollup?.state;
    const ciLook = {
      SUCCESS: ["✓ Checks", t.done], FAILURE: ["✕ Checks", t.blocked], ERROR: ["✕ Checks", t.blocked],
      PENDING: ["● Checks", t.working], EXPECTED: ["● Checks", t.working],
    }[ci];
    if (ciLook) chips.push(this.chip(ciLook[0], ciLook[1], t.raised));
    if (pr.mergeable === "CONFLICTING") chips.push(this.chip("Conflicts", t.blocked, t.raised));
    for (const l of pr.labels.nodes) chips.push(this.chip(l.name, t.foreground, `#${l.color}33`));
    return chips;
  }

  stats(pr) {
    const t = theme();
    const requested = pr.reviewRequests.nodes.map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.name).filter(Boolean);
    return v_flex().gap(3).text_size(11).text_color(t.dim)
      .child(h_flex().gap(10).items_center().flex_wrap()
        .child(h_flex().gap(4).child(div().text_color(t.done).child(`+${pr.additions}`)).child(div().text_color(t.blocked).child(`−${pr.deletions}`)))
        .child(div().child(`${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"}`))
        .child(div().child(`updated ${ago(pr.updatedAt)}`)))
      .child(div().truncate().child(`${pr.headRefName} → ${pr.baseRefName}`))
      .when(requested.length > 0, (el) => el.child(div().truncate().child(`waiting on ${requested.join(", ")}`)));
  }

  md(id, text) {
    const t = theme();
    return TextView.markdown(id, text).selectable(true).text_size(12).text_color(t.foreground);
  }

  // The loading / error placeholder while a PR's details aren't ready, else null.
  pending(pr) {
    const t = theme();
    const d = this.details[pr.url];
    if (!d || d.loading) return div().text_size(11).text_color(t.dim).child("Loading…");
    if (d.error) return div().text_size(11).text_color(t.blocked).child(d.error);
    return null;
  }

  description(pr) {
    const t = theme();
    const wait = this.pending(pr);
    if (wait) return wait;
    const body = this.details[pr.url].body;
    return body.trim() ? this.md(`body-${pr.url}`, body) : div().text_size(11.5).text_color(t.dim).child("No description.");
  }

  conversation(pr) {
    const t = theme();
    const wait = this.pending(pr);
    if (wait) return wait;
    const d = this.details[pr.url];
    const verdict = { APPROVED: ["approved", t.done], CHANGES_REQUESTED: ["requested changes", t.blocked], DISMISSED: ["review dismissed", t.dim] };
    return v_flex().gap(6)
        .when(d.events.length === 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("No comments yet.")))
        .children(d.events.map((e, i) => {
          const v = e.kind === "review" ? verdict[e.state] : null;
          return v_flex().id(`ev-${pr.url}-${i}`).gap(3).p(8).rounded(7).bg(t.background).border_1().border_color(t.border)
            .child(h_flex().gap(6).items_center().text_size(11)
              .child(div().font_semibold().text_color(t.foreground).child(e.author?.login ?? "ghost"))
              .when(!!v, (el) => el.child(div().text_color(v[1]).child(v[0])))
              .child(div().flex_1())
              .child(div().text_color(t.dim).child(ago(e.createdAt))))
            .when(!!e.body?.trim(), (el) => el.child(this.md(`evb-${pr.url}-${i}`, e.body)));
        }));
  }

  // A collapsible section of a card: a clickable bar, then its content when open.
  section(section, pr, label, content) {
    const t = theme();
    const open = this.open[section].has(pr.url);
    return v_flex().border_t(1).border_color(t.border)
      .child(h_flex().id(`${section}-${pr.url}`).px(10).h(28).gap(6).items_center().text_size(11)
        .text_color(open ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.toggle(section, pr, cx))
        .child(div().w(10).text_color(t.dim).child(open ? "▾" : "▸"))
        .child(label))
      .when(open, (el) => el.child(div().px(10).pb(10).pt(2).child(content())));
  }

  card(pr, cx) {
    const t = theme();
    const open = this.open.desc.has(pr.url) || this.open.talk.has(pr.url);
    const meta = this.meta(pr);
    const talk = this.details[pr.url]?.events?.length ?? pr.comments.totalCount + pr.reviews.totalCount;
    return v_flex().id(`card-${pr.url}`).flex_none().rounded(8).border_1().overflow_hidden()
      .border_color(open ? t.input : t.border).bg(open ? t.raised : t.surface)
      .child(v_flex().gap(5).p(10)
        .child(h_flex().gap(6).items_center().text_size(11)
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(pr.repository.nameWithOwner))
          .child(div().id(`num-${pr.url}`).flex_none().px(3).rounded(4).text_color(t.accent)
            .hover((s) => s.bg(t.hover).underline())
            .on_click(() => { exec("open", [pr.url]); })
            .child(`#${pr.number}`))
          .child(div().flex_none().text_color(t.dim).child(date(pr.createdAt))))
        .child(div().text_size(13).font_medium().text_color(t.foreground).child(pr.title))
        .when(meta.length > 0, (el) => el.child(h_flex().gap(4).flex_wrap().children(meta)))
        .child(this.stats(pr)))
      .child(this.section("desc", pr, "Description", () => this.description(pr)))
      .child(this.section("talk", pr, `Comments · ${talk}`, () => this.conversation(pr)));
  }

  render(cx) {
    const t = theme();
    const count = this.prs?.length;
    let body;
    if (this.error && !this.prs) body = [div().text_size(11.5).text_color(t.blocked).child(this.error)];
    else if (!this.prs) body = [div().text_size(11.5).text_color(t.dim).child("Loading…")];
    else if (!count) body = [div().text_size(11.5).text_color(t.dim).child("No open PRs")];
    else body = this.prs.map((pr) => this.card(pr, cx));

    return v_flex().size_full().bg(t.chrome)
      .child(h_flex().px(14).h(38).flex_none().gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(13).font_medium().text_color(t.foreground).child("Pull Requests"))
        .child(div().text_size(11).text_color(t.dim).child(count == null ? "" : `${count} open`))
        .child(div().flex_1())
        .when(!!this.error && !!this.prs, (el) => el.child(div().text_size(11).text_color(t.blocked).child("refresh failed")))
        .child(div().id("pr-refresh").px(6).h(22).flex().items_center().rounded(5).text_size(11)
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.load(cx))
          .child(this.loading ? "Refreshing…" : "Refresh")))
      .child(v_flex().id("pr-list").flex_1().min_h(0).p(10).gap(8).overflow_y_scrollbar().children(body));
  }
}
