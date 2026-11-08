# Changelog

## 0.1.1

- Color every meter by fill severity: green below 50%, yellow below 80%, red from 80%, using the displayed rounded percentage.
- Draw Cursor-CLI solid `█` meters with a dim remainder, and pad each footer line to the pane width. Dithered `▓` bars wrapped or smeared in Kitty/tmux during a Cursor SDK turn until resize.
- Label the context meter `ctx`, matching the `usage` and `api` meters.

## 0.1.0

- Package the Cursor subscription footer as a Git-installable Pi extension.
- Show explicitly labeled yellow Cursor usage and red API usage meters alongside Pi's green context meter.
- Preserve Git branch, model, thinking level, extension statuses, and current-branch token/cost totals.
- Poll Cursor's existing login in terminal UI sessions only, with one-minute refreshes and a five-second request timeout.
- Show `n/a` for missing credentials, rejected logins, unavailable networks, and malformed quota readings.
- Clean up polling timers on session replacement and shutdown.
- Add type checking and regression tests.
