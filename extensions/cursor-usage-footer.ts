/**
 * Cursor-CLI-style footer for pi.
 *
 * Line 1: model  ctxWindow  thinking   user branch   [context bar] %   <extension statuses>
 * Line 2: cursor ⬥ usage [usage bar] %   api [usage bar] %   ↑in ↓out $cost
 *
 * Every meter uses the same severity colors: green below 50%, yellow below 80%, red from 80%.
 *
 * "usage"/"api" are the Cursor subscription quotas (same numbers the Cursor CLI
 * footer shows) from api2.cursor.sh DashboardService/GetCurrentPeriodUsage,
 * authenticated with the Cursor CLI token in ~/.config/cursor/auth.json.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const FETCH_MIN_AGE_MS = 60_000;
const AUTH_PATH = join(homedir(), ".config/cursor/auth.json");
const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

interface CursorUsage {
	auto: number;
	api: number;
}

function bar(pct: number, width = 10): string {
	const filled = Math.max(0, Math.min(width, Math.round((pct * width) / 100)));
	return "▓".repeat(filled) + "░".repeat(width - filled);
}

function usageColor(pct: number): "success" | "warning" | "error" {
	if (pct < 50) return "success";
	if (pct < 80) return "warning";
	return "error";
}

const fmtTokens = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

export default function (pi: ExtensionAPI) {
	let usage: CursorUsage | null = null;
	let lastFetch = 0;
	let interval: ReturnType<typeof setInterval> | undefined;
	let active = false;
	let requestRender: () => void = () => {};

	async function fetchUsage() {
		lastFetch = Date.now();
		try {
			// shortcut: no token refresh; reauthenticate in Cursor CLI when requests return 401.
			const token = JSON.parse(readFileSync(AUTH_PATH, "utf8")).accessToken;
			if (typeof token !== "string" || !token.trim()) throw new Error("Missing Cursor access token");
			const res = await fetch(USAGE_URL, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: "{}",
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) {
				usage = null;
			} else {
				const data = await res.json();
				const auto = data?.planUsage?.autoPercentUsed;
				const api = data?.planUsage?.apiPercentUsed;
				usage = typeof auto === "number" && Number.isFinite(auto) && auto >= 0
					&& typeof api === "number" && Number.isFinite(api) && api >= 0
					? { auto, api }
					: null;
			}
		} catch {
			usage = null;
		}
		requestRender();
	}

	function refreshIfStale() {
		if (active && Date.now() - lastFetch >= FETCH_MIN_AGE_MS) void fetchUsage();
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (interval) clearInterval(interval);
		interval = undefined;
		requestRender = () => {};
		active = ctx.mode === "tui";
		if (!active) return;

		void fetchUsage();
		interval = setInterval(refreshIfStale, FETCH_MIN_AGE_MS);
		interval.unref?.();

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubBranch,
				invalidate() {},
				render(width: number): string[] {
					// --- line 1: model + context bar ---
					const cu = ctx.getContextUsage();
					const model = ctx.model?.id ?? "no-model";
					const cw = cu?.contextWindow ?? ctx.model?.contextWindow;
					const thinking = ctx.thinkingLevel;
					const branch = footerData.getGitBranch();
					const pct = cu?.percent != null ? Math.round(cu.percent) : null;

					const leftParts = [theme.fg("accent", model)];
					if (cw) leftParts.push(theme.fg("dim", `${Math.round(cw / 1024)}K`));
					if (thinking) leftParts.push(theme.fg("dim", String(thinking)));
					leftParts.push(theme.fg("dim", `${userInfo().username}${branch ? ` ${branch}` : ""}`));
					leftParts.push(
						pct != null
							? theme.fg(usageColor(pct), bar(pct)) + theme.fg(usageColor(pct), ` ${pct}%`)
							: theme.fg("dim", "ctx n/a"),
					);
					for (const status of footerData.getExtensionStatuses().values()) {
						if (status) leftParts.push(status);
					}
					const line1 = truncateToWidth(leftParts.join("  "), width);

					// --- line 2: cursor subscription usage + session tokens ---
					const quota = usage
						? theme.fg("dim", "cursor ⬥ usage ") +
							theme.fg(usageColor(usage.auto), bar(usage.auto)) +
							theme.fg(usageColor(usage.auto), ` ${Math.round(usage.auto)}%`) +
							theme.fg("dim", "   api ") +
							theme.fg(usageColor(usage.api), bar(usage.api)) +
							theme.fg(usageColor(usage.api), ` ${Math.round(usage.api)}%`)
						: theme.fg("dim", "cursor ⬥ usage n/a   api n/a");

					let input = 0,
						output = 0,
						cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const u = e.message.usage;
							input += u.input;
							output += u.output;
							cost += u.cost.total;
						}
					}
					const stats = theme.fg("dim", `↑${fmtTokens(input)} ↓${fmtTokens(output)} $${cost.toFixed(3)}`);
					const pad = " ".repeat(Math.max(1, width - visibleWidth(quota) - visibleWidth(stats)));
					const line2 = truncateToWidth(quota + pad + stats, width);

					return [line1, line2];
				},
			};
		});
	});

	pi.on("turn_end", refreshIfStale);
	pi.on("model_select", () => requestRender());
	pi.on("session_shutdown", () => {
		active = false;
		if (interval) clearInterval(interval);
		interval = undefined;
		requestRender = () => {};
	});
}
