# CCC - Claude Code Commit Intelligence

Smart session pruning with intelligent boundary detection for Claude Code.

## Architecture Overview

CCC consists of two integrated components:

1. **Hook System**: Injects boundary markers during Claude Code sessions
2. **CLI Tool**: Reads boundary markers for intelligent session pruning

## Features

- 🎯 **Boundary Detection**: Intelligent pruning based on git commits and intent markers
- 🎛️ **Legacy Mode**: Keep messages since the last N assistant responses (use `-k` flag)
- 🛡️ **Safe by Default**: Always preserves session summaries and metadata
- 💾 **Auto Backup**: Creates timestamped backups before modifying files

## Installation

### Run directly (recommended)

```bash
# Default: boundary-based pruning
npx ccc <sessionId>

# Legacy: keep N messages
npx ccc <sessionId> -k 50
```

### Install globally

```bash
# Using npm
npm install -g ccc

# Using bun
bun install -g ccc
```

## Usage

### Default Mode (Boundary Detection)
```bash
ccc <sessionId> [--dry-run]
```

### Legacy Mode (Message Count)
```bash
ccc <sessionId> -k <number> [--dry-run]
```

### Arguments

- `sessionId`: UUID of the Claude Code session (without .jsonl extension)

### Options

- `-k, --keep <number>`: Number of assistant messages to keep (legacy mode)
- `--dry-run`: Preview changes without modifying files
- `-h, --help`: Show help information
- `-V, --version`: Show version number

### Examples

```bash
# Default: Interactive boundary selection
ccc abc123-def456-789

# Preview boundary options without modifying files
ccc abc123-def456-789 --dry-run

# Legacy: Keep the last 10 assistant messages
ccc abc123-def456-789 -k 10

# Legacy: Preview what would be pruned
ccc abc123-def456-789 -k 5 --dry-run
```

## How It Works

### Boundary Detection Mode (Default)
1. **Hook Integration**: CCC hooks inject boundary markers during Claude Code sessions
2. **Boundary Analysis**: Detects git commits and intent markers in session files
3. **Interactive Selection**: Presents boundaries with retention percentages
4. **Smart Pruning**: Prunes to selected boundary while preserving context

### Legacy Mode (`-k` flag)
1. **Message Counting**: Finds the Nth-to-last assistant message
2. **Smart Pruning**: Keeps everything from that point forward
3. **Context Preservation**: Maintains all non-message lines

### Common Features
1. **Locates Session File**: Finds `~/.claude/projects/{project-path}/{sessionId}.jsonl`
2. **Preserves Critical Data**: Always keeps the first line (session summary/metadata)
3. **Safe Backup**: Creates timestamped backups before modifying
4. **Interactive Confirmation**: Asks for confirmation unless using `--dry-run`

## Hook System Setup

To enable boundary detection, install the hook system:

```bash
# Clone the repository
git clone https://github.com/dannyaziz/ccc.git
cd ccc

# Install hooks (interactive)
./hook/install.sh

# Or install specific variant
./hook/install.sh --variant original
```

The hook system will:
- Copy hook files to `~/.claude/hooks/`
- Update Claude Code settings to use the hooks
- Inject boundary markers during sessions for later pruning

## File Structure

Claude Code stores sessions in:

```
~/.claude/projects/{project-path-with-hyphens}/{sessionId}.jsonl
```

For example, a project at `/Users/alice/my-app` becomes:

```
~/.claude/projects/-Users-alice-my-app/{sessionId}.jsonl
```

## Development

```bash
# Clone and install
git clone https://github.com/dannyaziz/cc-prune.git
cd cc-prune
bun install

# Run tests
bun test

# Build
bun run build

# Test locally
./dist/index.js --help
```

## License

MIT © Danny Aziz
