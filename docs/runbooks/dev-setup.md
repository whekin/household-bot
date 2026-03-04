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
bun run lint:fix
bun run format
bun run format:check
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

- Type checking uses `tsgo` (`@typescript/native-preview`).
- Linting uses `oxlint`.
- Formatting uses `oxfmt` with no-semicolon style.
- `WHE-19` will add CI checks for the same root commands.
