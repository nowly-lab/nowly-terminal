# Third-party notices

This package is inspired by Orca (https://github.com/stablyai/orca), examined in the local sibling repository at commit `f06f24505e`.

Copied files, with local import extensions and formatting adapted:
- `src/vendor/orca/terminal-partial-escape-tail.ts` ← `src/shared/terminal-partial-escape-tail.ts`
- `src/vendor/orca/terminal-escape-introducer.ts` ← `src/shared/terminal-escape-introducer.ts`

Orca copyright (c) 2026 Lovecast Inc. MIT license. The full upstream license is included in LICENSE and applies to these files. Other toolkit code in this repository is distributed under the same MIT terms.

The host/session, transport, DOM mount and React UI are new implementations of the boundaries documented in the design; Orca source directories are not runtime dependencies. This does not claim parity with Orca's native daemons, patched terminal capabilities or all platform recovery paths.

Dependency licenses remain with their respective packages (xterm.js and addons, node-pty, ws, React). Distribution installs these dependencies through the package manager rather than vendoring their source.

Also copied `src/vendor/orca/terminal-serialize-absolute-cursor.ts` from the matching upstream shared path. It restores cursor position, scroll-region/origin state and the saved cursor position after xterm serialization. Full saved SGR/charset fidelity is not claimed; the upstream helper intentionally preserves position only. Active character-set designations are tracked by this package's `CharsetState`.
