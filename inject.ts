const CARD_ID = "bb-plugin-grok-usage-inline";
const HINT = "Your provider subscription usage.";

const MARK_VIEW = "0.36 0.5 33.33 32";
const MARK_PATHS = [
  "M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436",
  "M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341",
];

type Usage = {
  status: "ok" | "error";
  plan: string | null;
  email: string | null;
  usedPercent: number | null;
  resetsAt: string | null;
  message: string | null;
};

export function startUsageLimitsInjection(
  pluginId: string,
  signal: AbortSignal,
): () => void {
  let timer: number | null = null;
  let busy = false;

  const tick = () => {
    if (!signal.aborted) void sync();
  };
  const observer = new MutationObserver(() => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(tick, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  tick();

  return () => {
    observer.disconnect();
    if (timer !== null) window.clearTimeout(timer);
    document.getElementById(CARD_ID)?.remove();
  };

  async function sync() {
    if (signal.aborted || busy) return;
    const parent = findParent();
    if (!parent) {
      document.getElementById(CARD_ID)?.remove();
      return;
    }
    if (document.getElementById(CARD_ID)) return;
    busy = true;
    try {
      const usage = await fetchUsage(pluginId);
      const next = findParent();
      if (signal.aborted || !next || document.getElementById(CARD_ID)) return;
      next.appendChild(renderCard(usage));
    } catch {
      const next = findParent();
      if (signal.aborted || !next || document.getElementById(CARD_ID)) return;
      next.appendChild(
        renderCard({
          status: "error",
          plan: null,
          email: null,
          usedPercent: null,
          resetsAt: null,
          message: "Couldn't load Grok usage right now.",
        }),
      );
    } finally {
      busy = false;
    }
  }
}

function findParent(): HTMLElement | null {
  const hint = document.evaluate(
    `//*[normalize-space()=${JSON.stringify(HINT)}]`,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue;
  if (!(hint instanceof HTMLElement)) return null;
  const page = hint.closest("section");
  if (!page) return null;
  // BB wraps Codex/Claude in the bordered card's divide-y list.
  return page.querySelector<HTMLElement>(":scope .divide-y");
}

async function fetchUsage(pluginId: string): Promise<Usage> {
  const response = await fetch(`/api/v1/plugins/${pluginId}/rpc/getUsage`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  const payload = (await response.json()) as
    | { ok: true; result: Usage }
    | { ok: false };
  if (!response.ok || !("ok" in payload) || !payload.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return payload.result;
}

function renderCard(usage: Usage): HTMLElement {
  const section = el("section", {
    id: CARD_ID,
    className: "space-y-3.5 py-3.5 first:pt-0 last:pb-0",
  });
  section.setAttribute("aria-labelledby", `${CARD_ID}-heading`);

  const header = el("div", {
    className: "flex items-start justify-between gap-2",
  });
  const left = el("div", {
    className: "flex min-w-0 flex-1 items-start gap-2.5",
  });
  const icon = el("span", { className: "mt-0.5 shrink-0" });
  icon.setAttribute("aria-hidden", "true");
  icon.append(mark());
  const identity = el("div", { className: "min-w-0 flex-1" });
  identity.append(
    el("h3", {
      id: `${CARD_ID}-heading`,
      className: "text-sm font-semibold text-foreground",
      text: "Grok Build",
    }),
  );
  if (usage.email) {
    identity.append(
      el("p", {
        className: "truncate text-xs text-muted-foreground",
        text: usage.email,
      }),
    );
  }
  left.append(icon, identity);
  header.append(left);
  if (usage.plan) {
    header.append(
      el("span", {
        className:
          "shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground",
        text: usage.plan,
      }),
    );
  }
  section.append(header);

  const body = el("div", { className: "pl-6" });
  if (usage.status === "ok" && usage.usedPercent !== null) {
    body.append(bar(usage.usedPercent, usage.resetsAt));
  } else {
    body.append(
      el("p", {
        className: "text-xs text-muted-foreground",
        text: usage.message ?? "No usage limits reported for this plan.",
      }),
    );
  }
  section.append(body);
  return section;
}

function bar(usedPercent: number, resetsAt: string | null): HTMLElement {
  const wrap = el("div", { className: "space-y-1" });
  const row = el("div", {
    className: "flex items-baseline justify-between gap-2",
  });
  row.append(
    el("span", { className: "text-xs text-foreground", text: "Weekly limit" }),
    el("span", {
      className: "text-xs tabular-nums text-muted-foreground",
      text: `${Math.round(usedPercent)}% used`,
    }),
  );
  const tone =
    usedPercent >= 95
      ? "bg-destructive"
      : usedPercent >= 80
        ? "bg-warning"
        : "bg-primary";
  const track = el("div", {
    className: "h-1.5 w-full overflow-hidden rounded-full bg-muted",
  });
  const fill = el("div", { className: `h-full rounded-full ${tone}` });
  fill.style.width = `${Math.max(usedPercent, 2)}%`;
  track.append(fill);
  wrap.append(row, track);
  const reset = resetLabel(resetsAt);
  if (reset) {
    wrap.append(el("p", { className: "text-xs text-muted-foreground", text: reset }));
  }
  return wrap;
}

function mark(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", MARK_VIEW);
  svg.setAttribute("fill", "none");
  svg.setAttribute("class", "size-4 text-foreground");
  for (const d of MARK_PATHS) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
  }
  return svg;
}

function resetLabel(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) return null;
  const delta = at - Date.now();
  if (delta <= 0) return "Resetting now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `Resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `Resets in ${hours} hr ${rest} min` : `Resets in ${hours} hr`;
  }
  return `Resets ${new Date(at).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function el(
  tag: string,
  opts: { id?: string; className?: string; text?: string },
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.id) node.id = opts.id;
  if (opts.className) node.className = opts.className;
  if (opts.text) node.textContent = opts.text;
  return node;
}
