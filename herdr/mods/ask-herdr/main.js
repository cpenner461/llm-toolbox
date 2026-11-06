// "Ask Herdr": a dialog where you describe a change to the app. Sending it starts
// Claude in a new tab, in the Herdr app's folder (~/.config/herdr-app, where
// AGENTS.md explains everything), with your request as its first message. The tab
// goes in the space already working in that folder, else a new "herdr-app" space.
// Cmd-Enter (or the Ask button) sends; Esc closes.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, appHome } from "herdr";

const EXAMPLES = ["make the sidebar narrower", "give cmd-k a command palette", "show a clock in the status bar"];

// The space whose terminals are in the app's folder, on this computer.
function homeSpace(folder) {
  const ps = panes();
  return spaces().find((s) => !s.machine && (s.tabs ?? []).some((tab) =>
    ps.some((p) => p.tab === tab.id && p.cwd && (p.cwd === folder || p.cwd.startsWith(folder + "/")))));
}

// A tab name from the request: its first few words.
function tabName(text) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 5).join(" ");
  return words.length > 32 ? words.slice(0, 31) + "…" : words;
}

export default class AskHerdr extends View {
  init(_props, cx) {
    this.text = "";
    this.input = TextareaState.new({ placeholder: "What should change? e.g. \"move the agents list to the right\"", rows: 4 });
    this.input.set_auto_grow(4, 10);
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    // The textarea keeps Enter (a new line) and reports Cmd-Enter as a "secondary" submit.
    this.input.on("submit", (e) => { if (e?.secondary) this.submit(); });
    // Fallback: Cmd-Enter as an action on the dialog, should the textarea pass the key on.
    cx.bind_keys([{ keystroke: "cmd-enter", action: "ask-herdr-send", context: "AskHerdr" }, { keystroke: "ctrl-enter", action: "ask-herdr-send", context: "AskHerdr" }]);
    this.focused = true;
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  submit() {
    const task = this.input.value().trim();
    if (!task || this.sent) return;
    this.sent = true;
    const folder = appHome();
    const space = homeSpace(folder);
    this.close();
    if (space) run("tab.new", { space: space.id, folder, name: tabName(task), argv: ["claude"], task });
    else run("space.new", { name: "herdr-app", folder, machine: "", argv: ["claude"], task });
  }

  key(e, cx) {
    if (e.key === "escape") { this.close(); cx.stop_propagation(); }
    else if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control)) { this.submit(); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const ready = Boolean(this.text.trim());
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? (enabled ? t.solid : t.border) : t.input).bg(primary ? (enabled ? t.solid : t.raised) : t.raised)
      .text_color(primary ? (enabled ? t.solid_foreground : t.dim) : t.foreground).text_size(12.5).font_medium()
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88))).on_click(() => enabled && action()).child(text);
    return v_flex().id("ask-herdr").key_context("AskHerdr").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_action("ask-herdr-send", (_e, cx) => { this.submit(); cx.stop_propagation(); })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(15).font_semibold().child("Ask Herdr"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).pb(12).text_size(12).text_color(t.muted)
        .child("Describe a change to the app. Claude opens in a new tab in ~/.config/herdr-app and makes it."))
      .child(div().rounded(9).border_1().border_color(this.focused ? t.accent : t.input).bg(t.background).px(10).py(8)
        .child(Textarea.new(this.input).w_full().text_size(13).text_color(t.foreground)))
      .child(h_flex().pt(8).gap(6).flex_wrap().children(EXAMPLES.map((ex, i) =>
        div().id(`ask-ex-${i}`).px(8).py(3).rounded(6).border_1().border_color(t.border).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.input.set_value(ex); this.text = ex; this.input.focus(); cx.notify(); })
          .child(ex))))
      .child(h_flex().pt(18).gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("⌘↩ to ask"))
        .child(button("ask-cancel", "Cancel", false, true, () => this.close()))
        .child(button("ask-send", "Ask", true, ready, () => this.submit())));
  }
}
