# Claude Code Hook Integration

## Overview

This directory contains hooks for integrating `ccc` (Claude Code Commit Intelligence) with Claude Code's workflow to automatically prune sessions at natural boundaries.

## Setup

### 1. Install ccc globally

```bash
cd /path/to/ccc
npm link
```

Verify installation:
```bash
ccc --help
```

### 2. Configure Claude Code hooks

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "tool-result-success": {
      "bash": {
        "pattern": "git commit.*files changed",
        "command": "~/GitHub/ccc/hook/auto-prune.sh post-commit"
      }
    },
    "tool-result-success-pr": {
      "bash": {
        "pattern": "gh pr create.*github.com",
        "command": "~/GitHub/ccc/hook/auto-prune.sh post-pr"
      }
    }
  }
}
```

### 3. Manual Usage

You can also run the pruning manually:

```bash
# Interactive boundary selection (recommended)
ccc

# Prune to last N assistant messages
ccc -k 10

# Restore from backup if something goes wrong
ccc restore
```

## How It Works

### Automatic Triggers

The hook automatically prunes your Claude Code session when:

1. **After Git Commits**: When you commit code, the session is pruned at that boundary
2. **After PR Creation**: When you create a pull request
3. **Context Usage High**: When context usage exceeds 70% (configurable)

### Boundary Detection

The tool intelligently detects natural boundaries in your conversation:

- Git commits
- Intent markers (manually inserted with `===INTENT_BOUNDARY===`)
- Major task completions

### Safety Features

- **Automatic Backups**: Before any pruning, a backup is created in `~/.claude/projects/{project}/prune-backup/`
- **Restore Command**: `ccc restore` to recover from the latest backup
- **Dry Run**: Use `--dry-run` to preview changes without modifying files

## Configuration

Edit `claude-code-hooks.json` to customize behavior:

```json
{
  "hooks": {
    "post-commit": {
      "enabled": true,
      "command": "~/GitHub/ccc/hook/auto-prune.sh post-commit"
    }
  },
  "settings": {
    "auto_boundary_markers": true,
    "interactive_mode": false,
    "default_retention": 10,
    "backup_before_prune": true
  }
}
```

## Troubleshooting

### "unexpected tool_use_id found" Error

This error was fixed in version 2.0.0. The tool now properly maintains the pairing between `tool_use` and `tool_result` blocks.

### Session Not Found

If ccc can't find your session:
1. Make sure you're in the correct project directory
2. Check that session files exist in `~/.claude/projects/{project-path}/`
3. Use `ccc` without arguments to auto-detect the most recent session

### Restore Failed

If restoration fails:
1. Check backups exist in `~/.claude/projects/{project}/prune-backup/`
2. Manually copy backup file if needed: `cp {backup-file} {session-file}`

## Manual Boundary Markers

You can insert manual boundaries in your conversation:

```
===INTENT_BOUNDARY=== 2024-01-15T10:30:00 | feat: Starting new feature implementation
```

These markers help ccc identify logical breakpoints in your work.

## Best Practices

1. **Commit Regularly**: This creates natural boundaries and triggers automatic pruning
2. **Use Descriptive Commits**: Commit messages are used in boundary descriptions
3. **Monitor Context Usage**: Keep an eye on the context percentage in Claude Code UI
4. **Test with Dry Run**: Always use `--dry-run` first when trying new configurations

## Advanced Usage

### Programmatic Pruning

```bash
# Prune to specific boundary
ccc --boundary "Git commit: Fix authentication"

# Keep last N messages (legacy mode)
ccc -k 5

# Non-interactive mode for scripts
echo "1" | ccc  # Selects first boundary option
```

### Integration with CI/CD

Add to your git hooks (`.git/hooks/post-commit`):

```bash
#!/bin/bash
~/GitHub/ccc/hook/auto-prune.sh post-commit
```

## Contributing

Feel free to submit issues or PRs to improve the hook integration!