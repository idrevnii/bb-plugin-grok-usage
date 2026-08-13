import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

const BILLING = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const USER = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
const TOKEN = "https://auth.x.ai/oauth2/token";

/** Consumer SuperGrok family. Grok Build starts at SuperGrok. */
const PLANS: Record<string, string> = {
  Free: "Free",
  SuperGrokLite: "SuperGrok Lite",
  GrokLite: "SuperGrok Lite",
  GrokPro: "SuperGrok",
  SuperGrok: "SuperGrok",
  SuperGrokPlus: "SuperGrok Plus",
  GrokPlus: "SuperGrok Plus",
  GrokHeavy: "SuperGrok Heavy",
  SuperGrokHeavy: "SuperGrok Heavy",
};

const usageSchema = z.object({
  status: z.enum(["ok", "error"]),
  plan: z.string().nullable(),
  email: z.string().nullable(),
  usedPercent: z.number().nullable(),
  resetsAt: z.string().nullable(),
  message: z.string().nullable(),
});

type Usage = z.infer<typeof usageSchema>;

export const rpcContract = defineRpcContract({
  getUsage: { input: z.null(), output: usageSchema },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    getUsage: () => loadUsage(bb),
  });

  bb.cli.register({
    name: "grok-usage",
    summary: "Show Grok Build subscription usage",
    commands: [
      {
        name: "show",
        summary: "Print weekly Grok Build usage",
        usage: "bb grok-usage show [--json]",
      },
    ],
    async run(argv) {
      const usage = await loadUsage(bb);
      const json = argv.includes("--json");
      if (json) {
        return {
          exitCode: usage.status === "ok" ? 0 : 1,
          stdout: `${JSON.stringify(usage, null, 2)}\n`,
        };
      }
      return {
        exitCode: usage.status === "ok" ? 0 : 1,
        stdout: `${formatUsage(usage)}\n`,
      };
    },
  });
}

async function loadUsage(bb: BbPluginApi): Promise<Usage> {
  try {
    const token = await readAccessToken(bb);
    if (!token) {
      return fail("Run `grok login`, then retry.");
    }
    const [billingRes, userRes] = await Promise.all([
      grokGet(BILLING, token.access),
      grokGet(USER, token.access),
    ]);
    let billing = billingRes;
    let user = userRes;
    if ((billing.status === 401 || user.status === 401) && token.refresh) {
      const next = await refreshAccessToken(token);
      if (!next) return fail("Your Grok session expired. Run `grok login`.");
      billing = await grokGet(BILLING, next);
      user = await grokGet(USER, next);
    }
    if (billing.status === 401 || user.status === 401) {
      return fail("Your Grok session expired. Run `grok login`.");
    }
    if (!billing.ok || !billing.body) {
      return fail(`Grok billing returned HTTP ${billing.status}.`);
    }
    const cfg = (billing.body as { config?: Record<string, unknown> }).config;
    const period =
      cfg?.currentPeriod && typeof cfg.currentPeriod === "object"
        ? (cfg.currentPeriod as Record<string, unknown>)
        : {};
    const products = Array.isArray(cfg?.productUsage) ? cfg.productUsage : [];
    const grokBuild = products.find(
      (row) =>
        row &&
        typeof row === "object" &&
        (row as { product?: string }).product === "GrokBuild",
    ) as { usagePercent?: number } | undefined;
    const used =
      grokBuild?.usagePercent ??
      (typeof cfg?.creditUsagePercent === "number"
        ? cfg.creditUsagePercent
        : null);
    const userBody = user.ok ? (user.body as Record<string, unknown>) : {};
    const tier =
      typeof userBody.subscriptionTier === "string"
        ? userBody.subscriptionTier
        : null;
    return {
      status: "ok",
      plan: tier ? (PLANS[tier] ?? tier) : null,
      email: typeof userBody.email === "string" ? userBody.email : token.email,
      usedPercent:
        typeof used === "number" && Number.isFinite(used)
          ? Math.max(0, Math.min(100, used))
          : null,
      resetsAt: typeof period.end === "string" ? period.end : null,
      message: null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

type Session = {
  access: string;
  refresh: string | null;
  clientId: string | null;
  email: string | null;
};

async function readAccessToken(bb: BbPluginApi): Promise<Session | null> {
  const hostId = (await bb.sdk.system.config()).primaryHostId;
  if (!hostId) throw new Error("No connected machine.");
  const home = (await bb.sdk.hosts.directory({ hostId })).directory;
  const path = `${home.replace(/[/\\]$/, "")}/.grok/auth.json`;
  let file;
  try {
    file = await bb.sdk.files.read({ hostId, path });
  } catch {
    return null;
  }
  const text =
    file.contentEncoding === "base64"
      ? Buffer.from(file.content, "base64").toString("utf8")
      : file.content;
  const raw = JSON.parse(text) as Record<string, unknown>;
  const entry = pickAuthEntry(raw);
  if (!entry) return null;
  return entry;
}

function pickAuthEntry(raw: Record<string, unknown>): Session | null {
  const values = Object.values(raw);
  const candidates = [
    raw,
    ...values.filter((v): v is Record<string, unknown> => !!v && typeof v === "object"),
  ];
  for (const entry of candidates) {
    const access = str(entry.key);
    if (!access) continue;
    return {
      access,
      refresh: str(entry.refresh_token),
      clientId: str(entry.oidc_client_id),
      email: str(entry.email),
    };
  }
  return null;
}

async function refreshAccessToken(session: Session): Promise<string | null> {
  if (!session.refresh || !session.clientId) return null;
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refresh,
      client_id: session.clientId,
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function grokGet(url: string, access: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${access}`,
      Accept: "application/json",
    },
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function formatUsage(usage: Usage): string {
  if (usage.status !== "ok") return usage.message ?? "Couldn't load Grok usage.";
  const lines = ["Grok Build"];
  if (usage.plan) lines.push(`  Plan: ${usage.plan}`);
  if (usage.email) lines.push(`  Account: ${usage.email}`);
  if (usage.usedPercent === null) {
    lines.push("  No usage limits reported for this plan.");
    return lines.join("\n");
  }
  const reset = resetLabel(usage.resetsAt);
  lines.push(
    `  Weekly limit: ${Math.round(usage.usedPercent)}% used${reset ? ` · ${reset}` : ""}`,
  );
  return lines.join("\n");
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
    weekday: delta < 10_080 * 60_000 ? "short" : undefined,
    month: delta < 10_080 * 60_000 ? undefined : "short",
    day: delta < 10_080 * 60_000 ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function fail(message: string): Usage {
  return {
    status: "error",
    plan: null,
    email: null,
    usedPercent: null,
    resetsAt: null,
    message,
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
