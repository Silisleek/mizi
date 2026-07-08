# ✦ mizi — AI Coding Assistant CLI

Terminal-first AI coding assistant with streaming chat, tool use, and multi-provider support.

## Install

```
npm install -g @silisleek/mizi
```

## Quick Start

```
mizi                           # Start interactive chat
mizi "explain this code"       # Single-shot prompt
mizi serve                     # Launch the web app
```

## Provider Setup

```
mizi provider list             # See all providers
mizi provider add              # Add a new provider (guided wizard)
mizi provider set <id>         # Switch active provider
mizi provider test <id>        # Test connection + discover models
mizi provider edit <id>        # Edit a provider
mizi provider delete <id>      # Remove a provider
```

Supported provider types:
- **OpenAI-compatible** — any `/v1` endpoint (OpenRouter, Together, etc.)
- **Anthropic** — Claude API
- **Local** — Ollama, LM Studio, etc.

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model <id>` | Set the AI model |
| `/models` | List models from active provider |
| `/provider` | Provider manager |
| `/effort <level>` | Set effort: `instant` `fast` `normal` `compact` `power` |
| `/reasoning <level>` | Set reasoning: `low` `medium` `high` `max` |
| `/permission <mode>` | Set permission: `bypass` `accept-edits` `ask` `plan` |
| `/config` | View configuration |
| `/clear` | Clear conversation |
| `/sessions` | Browse and load past sessions |
| `/serve` | Launch web app |

## CLI Flags

```
mizi --model gpt-4o --effort power --permission bypass
mizi --provider opencode --reasoning high
```

## Permission Modes

- **bypass** — Auto-approve everything
- **accept-edits** — Auto-approve file edits, ask for shell
- **ask** — Ask before every action (default)
- **plan** — Suggest only, never execute

## Configuration

Settings are stored at `~/.mizi/config.json`.

## License

ISC
