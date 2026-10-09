# Changelog

## 0.1.0

- Package the Cursor subscription footer as a Git-installable Pi extension.
- Show explicitly labeled yellow Cursor usage and red API usage meters alongside Pi's green context meter.
- Preserve Git branch, model, thinking level, extension statuses, and current-branch token/cost totals.
- Poll Cursor's existing login in terminal UI sessions only, with one-minute refreshes and a five-second request timeout.
- Show `n/a` for missing credentials, rejected logins, unavailable networks, and malformed quota readings.
- Clean up polling timers on session replacement and shutdown.
- Add type checking and regression tests.
