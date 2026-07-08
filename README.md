# ✦ MIZI — AI Coding Assistant CLI

Terminal-first AI coding assistant with streaming chat, tool use, and multi-provider support. Works with OpenAI-compatible APIs out of the box.

## Install

```
npm install -g silisleek/mizi
```

## Usage

```
mizi                          # Interactive REPL
mizi serve                    # Launch the web app
mizi "explain this code"      # Single-shot prompt
```

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model <id>` | Set the AI model |
| `/models` | List models from your provider |
| `/provider add` | Add a custom OpenAI-compatible provider |
| `/provider set <id>` | Switch provider |
| `/effort <level>` | Set effort: `instant` `fast` `normal` `compact` `power` |
| `/reasoning <level>` | Set reasoning: `low` `medium` `high` `max` |
| `/permission <mode>` | Set permission: `bypass` `accept-edits` `ask` `plan` |
| `/config` | View current configuration |
| `/clear` | Clear conversation history |
| `/serve` | Launch the web app |

## CLI Flags

```
mizi --model gpt-4o --effort power --permission bypass
mizi --provider opencode --reasoning high
```

## Permission Modes

- **bypass** — Auto-approve everything
- **accept-edits** — Auto-approve file edits, ask for shell commands
- **ask** — Ask before every action
- **plan** — Suggest only, never execute

## Config

Settings are stored at `~/.mizi/config.json`.

## License

ISC
