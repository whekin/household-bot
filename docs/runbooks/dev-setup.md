# Development Setup

## Requirements
- Bun 1.3+
- Node.js 22+

## First-time setup
```bash
bun install
```

## Workspace commands
```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## App commands
```bash
bun run dev:bot
bun run dev:miniapp
```

## Notes
- `WHE-16` will replace temporary lint placeholders with Oxlint rules.
- `WHE-19` will add CI checks for the same root commands.
