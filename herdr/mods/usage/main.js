// Usage: Claude and Codex plan limits (5-hour and weekly), each live session's
// context, and an estimated cost.
//
// Claude: Claude Code hands its statusline the session's context, plan limits and
// its own cost estimate; record-claude.sh (called from ~/.claude/statusline-command.sh)
// keeps one file per session in ~/.cache/herdr-usage/claude, tagged with the Herdr
// terminal it runs in. Codex: codex.sh reads ~/.codex/sessions; its cost is estimated
// from token counts and LiteLLM's public price list (fetched once a day).

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, exec, theme, layout, appHome } from "herdr";

const PRICES_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DAY = 86400;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
const now = () => Date.now() / 1000;
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };

function until(epoch) {
  const s = Math.max(0, epoch - now());
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < DAY) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / DAY)}d ${Math.floor((s % DAY) / 3600)}h`;
}
const money = (n) => (n == null ? "—" : n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);
const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop() || "~";

// A limit window as {pct, resets}; one whose reset has passed is back at 0.
function windowOf(pct, resets) {
  if (pct == null) return null;
  if (resets && resets < now()) return { pct: 0, resets: null };
  return { pct: Math.round(pct), resets };
}

export default class Usage extends View {
  init(_props, cx) {
    this.claude = []; this.codex = { limits: null, sessions: [] }; this.prices = null;
    try { this.prices = JSON.parse(localStorage.getItem("prices") ?? "null"); } catch {}
    this.loadClaude(cx); this.loadCodex(cx); this.loadPrices(cx);
    cx.timer.every(15000, (cx) => this.loadClaude(cx));
    cx.timer.every(60000, (cx) => { this.loadCodex(cx); this.loadPrices(cx); });
  }

  loadClaude(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", 'for f in "$HOME"/.cache/herdr-usage/claude/*.json; do [ -f "$f" ] && { cat "$f"; echo; }; done']);
        this.claude = r.stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch {}
      cx.notify();
    });
  }

  loadCodex(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${appHome()}/mods/usage/codex.sh`, []);
        if (r.code === 0) this.codex = JSON.parse(r.stdout);
      } catch {}
      cx.notify();
    });
  }

  // LiteLLM's price list, kept a day: only the per-token prices of the models we look up.
  loadPrices(cx) {
    if (this.prices && now() - this.prices.at < DAY) return;
    cx.spawn(async (cx) => {
      try {
        const r = await fetch(PRICES_URL);
        const all = await r.json();
        const table = {};
        for (const [k, v] of Object.entries(all)) {
          if (v && typeof v === "object" && v.input_cost_per_token != null) table[k] = [v.input_cost_per_token, v.output_cost_per_token ?? 0, v.cache_read_input_token_cost ?? v.input_cost_per_token];
        }
        this.prices = { at: now(), table };
        try { localStorage.setItem("prices", JSON.stringify(this.prices)); } catch {}
      } catch {}
      cx.notify();
    });
  }

  // [input, output, cached input] per token: the exact name, else a provider-prefixed one.
  price(model) {
    const table = this.prices?.table;
    if (!table || !model) return null;
    if (table[model]) return table[model];
    const keys = Object.keys(table).filter((k) => k.endsWith(`/${model}`)).sort((a, b) => a.length - b.length);
    return keys.length ? table[keys[0]] : null;
  }

  codexCost(s) {
    const p = this.price(s.model), u = s.usage;
    if (!p || !u) return null;
    const cached = u.cached_input_tokens ?? 0;
    return Math.max(0, (u.input_tokens ?? 0) - cached) * p[0] + cached * p[2] + (u.output_tokens ?? 0) * p[1];
  }

  // One limit as a compact meter: "5h 42%" and the time to its reset on one line, a thin bar under it.
  meter(label, w, t) {
    const pct = w?.pct ?? 0;
    const color = pct >= 90 ? t.ansi1 : pct >= 70 ? t.blocked : t.accent;
    return v_flex().flex_1().min_w(0).gap(3)
      .child(h_flex().items_center().gap(4).text_size(10.5)
        .child(div().flex_none().text_color(t.dim).child(label))
        .child(div().flex_none().font_medium().text_color(w ? t.foreground : t.dim).child(w ? `${pct}%` : "—"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).child(w?.resets ? until(w.resets) : "")))
      .child(div().h(3).rounded(2).bg(t.border).child(div().h_full().rounded(2).bg(color).w(`${Math.min(100, pct)}%`)));
  }

  meters(five, week, t) {
    return h_flex().gap(12).flex_none().child(this.meter("5h", five, t)).child(this.meter("Week", week, t));
  }

  session(id, name, sub, ctx, cost, t) {
    return h_flex().id(id).h(18).flex_none().gap(6).items_center().text_size(11)
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(name))
      .child(div().flex_none().text_color(t.dim).child(sub))
      .child(div().w(28).flex_none().text_right().text_color(ctx == null ? t.dim : ctx >= 80 ? t.blocked : t.muted).child(ctx == null ? "—" : `${Math.round(ctx)}%`))
      .child(div().w(40).flex_none().text_right().text_color(t.muted).child(money(cost)));
  }

  // One provider's card: a tinted, rounded block so Claude and Codex read as separate sections.
  card(id, children, t) {
    return v_flex().id(id).flex_none().gap(6).px(9).py(7).rounded(7).bg(t.raised).border_1().border_color(t.border).children(children);
  }

  // Sessions in a fixed three-row box that scrolls for more, so each card keeps one height.
  list(id, rows, empty, t) {
    return v_flex().id(id).h(3 * 18).flex_none().overflow_y_scrollbar()
      .children(rows.length ? rows : [div().h(18).flex_none().text_size(10.5).text_color(t.dim).child(empty)]);
  }

  heading(icon, title, right, t) {
    return h_flex().items_center().gap(6)
      .child(image(icon).size(13).flex_none())
      .child(div().flex_1().text_size(11).font_semibold().text_color(t.foreground).child(title))
      .child(div().text_size(10.5).text_color(t.dim).child(right));
  }

  render() {
    const t = theme();
    const live = agents();
    const today = midnight();

    // Claude: the newest file has the current plan limits.
    const claude = [...this.claude].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const newest = claude.find((c) => c.rate_limits);
    const c5 = windowOf(newest?.rate_limits?.five_hour?.used_percentage, newest?.rate_limits?.five_hour?.resets_at);
    const c7 = windowOf(newest?.rate_limits?.seven_day?.used_percentage, newest?.rate_limits?.seven_day?.resets_at);
    const claudeLive = live.filter((a) => a.app === "claude-code").map((a) => ({ a, c: claude.find((c) => c.terminal === a.address) }));
    const claudeToday = claude.filter((c) => (c.at ?? 0) >= today).reduce((n, c) => n + (c.cost?.total_cost_usd ?? 0), 0);

    // Codex.
    const lim = this.codex.limits;
    const x5 = windowOf(lim?.primary?.used_percent, lim?.primary?.resets_at);
    const x7 = windowOf(lim?.secondary?.used_percent, lim?.secondary?.resets_at);
    const codexSessions = [...(this.codex.sessions ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const codexToday = codexSessions.filter((s) => Date.parse(s.at) / 1000 >= today).reduce((n, s) => n + (this.codexCost(s) ?? 0), 0);
    const codexPriced = codexSessions.every((s) => this.price(s.model));

    if (narrow()) {
      const pill = (label, w) => div().text_size(10).text_color(t.dim).child(`${label} ${w ? w.pct + "%" : "—"}`);
      return v_flex().size_full().bg(t.chrome).items_center().pt(10).gap(4)
        .child(image("icons/claude.svg").size(14)).child(pill("5h", c5)).child(pill("7d", c7))
        .child(div().pt(6).child(image("icons/codex.svg").size(14))).child(pill("5h", x5)).child(pill("7d", x7));
    }

    return v_flex().id("usage").size_full().min_h(0).bg(t.chrome)
      .child(h_flex().px(16).h(31).flex_none().items_center().justify_between()
        .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Usage"))
        .child(div().text_size(10.5).text_color(t.dim).child("ctx · est. $")))
      .child(v_flex().id("usage-body").flex_1().min_h(0).px(8).pb(8).gap(6).overflow_y_scrollbar()
        .child(this.card("usage-claude", [
          this.heading("icons/claude.svg", "Claude", claudeToday ? `${money(claudeToday)} today` : "", t),
          this.meters(c5, c7, t),
          this.list("usage-claude-sessions", claudeLive.map(({ a, c }) => this.session(`cl-${a.address}`,
            a.space_name, c?.model?.display_name ?? "", c?.context_window?.used_percentage ?? null, c?.cost?.total_cost_usd ?? null, t)),
            "No Claude sessions running", t),
        ], t))
        .child(this.card("usage-codex", [
          this.heading("icons/codex.svg", "Codex", codexToday ? `${codexPriced ? "" : "≥"}${money(codexToday)} today` : "", t),
          this.meters(x5, x7, t),
          this.list("usage-codex-sessions", codexSessions.map((s) => {
            const ctx = s.window && s.last?.total_tokens != null ? (100 * s.last.total_tokens) / s.window : null;
            return this.session(`cx-${s.id}`, base(s.cwd), s.model ?? "", ctx, this.codexCost(s), t);
          }), "No Codex sessions in the last 24h", t),
        ], t)));
  }
}
