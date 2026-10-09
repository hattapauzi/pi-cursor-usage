# pi-cursor-usage

See your **Cursor subscription usage** in Pi without opening Cursor Agent just to check it.

```text
test-model  256K  max  user main  ▓▓░░░░░░░░ 22%
cursor ⬥ usage ▓▓▓▓▓▓▓▓░░ 75%   api ▓▓▓▓▓▓▓▓░░ 80%     ↑15.2k ↓2.1k $0.042
```

The first line is **Pi**: model, context window, thinking level, user, Git branch, a green context meter, and extension statuses. The second line explicitly labels the **Cursor** subscription meters: yellow `usage` and red `api`. Token and cost totals on the right belong to the current Pi conversation branch, not your Cursor bill.

## Install

Requires Pi with the `@earendil-works` extension APIs, Node.js 22.19 or newer, and a Cursor Agent login. Tested with Pi 1.1.0 on Linux.

1. [Install Cursor Agent](https://cursor.com/docs/cli/installation) and sign in:

   ```sh
   cursor-agent login
   ```

2. Install the Pi package from GitHub:

   ```sh
   pi install git:github.com/hattapauzi/pi-cursor-usage@v0.1.0
   ```

3. Restart Pi, or run `/reload` in an existing session.

For unpinned updates, install without `@v0.1.0` and use `pi update git:github.com/hattapauzi/pi-cursor-usage`. A tagged install stays pinned; install a newer tag explicitly to upgrade.

This repository follows the [Pi package format](https://pi.dev/docs/latest/packages). It is distributed through GitHub for now, **not npm or the Pi package gallery**. The manifest includes `pi-package` for future npm discovery.

### Replacing the original standalone extension

If you already have `~/.pi/agent/extensions/cursor-usage-footer.ts`, move it outside the extensions directory before installing this package. Loading both copies causes duplicate polling and competing footer replacements. Keep your backup until the package is working.

## What the bars mean

| Meter | Source | Meaning |
| --- | --- | --- |
| Green context | Pi's `ctx.getContextUsage()` | Current context usage relative to the active model's window |
| Yellow `cursor ⬥ usage` | Cursor's `planUsage.autoPercentUsed` | Cursor's Auto-bucket subscription usage reading, as shown by its CLI |
| Red `api` | Cursor's `planUsage.apiPercentUsed` | Cursor's named-model/API subscription usage reading, as shown by its CLI |

These are separate percentages reported by Cursor; they are not added together or inferred from dollar spend. Values above 100% remain visible, while the drawn bar is capped at its full width. Unknown readings show `n/a`, never a fabricated `0%`.

Cursor is polled once on terminal session start and then at most once per minute during normal polling, including at turn end when the reading is due. Each request has a five-second timeout. No polling runs in print, JSON, or RPC modes. Restarting or replacing a session fetches a new reading immediately.

## Authentication and privacy

The extension reads the Cursor CLI's existing access token from:

```text
~/.config/cursor/auth.json
```

That location is verified on Linux. Other operating systems work only if their Cursor CLI stores credentials at that same path; alternate credential stores are not supported in this release.

It sends an authenticated, empty-body POST request to:

```text
https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage
```

Credentials are **read only**. The extension does not refresh tokens, modify Cursor configuration, invoke Cursor Agent, persist quota responses, or log credentials. It sends no prompts, source files, or Pi conversation content to Cursor. The bearer token is sent only to the Cursor endpoint above. There is no telemetry.

This is an independent integration, not an official Cursor product. The endpoint is undocumented and may change.

## Troubleshooting

- **`usage n/a` / `api n/a`:** Check your connection and that the credential file exists. Run `cursor-agent login` to reauthenticate if needed; the extension rereads the token on the next poll. A rejected login, malformed response, or unavailable endpoint also produces `n/a`.
- **`ctx n/a`:** Pi does not yet have a current context estimate, for example immediately after compaction. It will update when Pi has a reading.
- **The footer is missing or changed:** Pi has one custom-footer slot. Disable other extensions that call `ctx.ui.setFooter()`. Ordinary `setStatus()` entries are preserved, but may be truncated on narrow terminals.
- **Glyphs look wrong:** Use a terminal font supporting `▓`, `░`, and `⬥`.

## Remove

```sh
pi remove git:github.com/hattapauzi/pi-cursor-usage@v0.1.0
```

Then restart Pi or run `/reload` to restore the built-in footer. This does not remove your Cursor login.

## Development

```sh
git clone https://github.com/hattapauzi/pi-cursor-usage.git
cd pi-cursor-usage
npm ci
npm run check
npm test
npm pack --dry-run
```

Tests use synthetic credentials and mocked HTTP responses, never your real Cursor account. Pi loads the TypeScript extension directly with its loader; no build step or bundled Pi runtime is needed. Host-provided packages are peer dependencies, with development copies used only for tests and type checking.

To try the checkout for one session:

```sh
pi -e ./extensions/cursor-usage-footer.ts
```

Contributions should include a regression test for changed behavior. Do not include credentials, account-specific responses, or personal screenshots in commits.

## License

[MIT](LICENSE).
