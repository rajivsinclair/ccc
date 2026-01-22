# Intent Tracking System

The JSX project includes an intelligent git commit intent tracking system that automatically generates meaningful commit messages based on your actual work patterns and context.

## Overview

The system monitors Claude Code sessions and analyzes:
- User prompts and requests
- Tool usage patterns (Edit, Write, Task, etc.)
- File changes detected by git
- Code patterns and conversation context

This analysis is used to generate contextually appropriate commit messages using Claude AI, with smart fallbacks for reliability.

## Features

### Core Capabilities
- **Context Extraction**: Analyzes 20-30+ items from Claude Code transcripts
- **AI-Generated Messages**: Uses Claude API to create meaningful commit messages
- **Smart Fallback**: Pattern-based message generation when AI is unavailable
- **Real-time Tracking**: Updates intent after each significant interaction
- **Status Line Integration**: Displays current intent with 🎯 emoji
- **Universal Compatibility**: Auto-detects Claude CLI across all installation methods

### Message Quality
- Follows conventional commit format (feat:, fix:, docs:, etc.)
- Under 72 characters for git compatibility
- Based on actual work done, not generic templates
- Contextually aware of project patterns

## Setup

### Prerequisites
- Claude Code CLI installed (script auto-detects location)
- Active Claude Code session in a git repository
- Hook system enabled in Claude Code settings

### Installation
The system is pre-configured for the JSX project with:

1. **Hook Configuration** (`~/.claude/settings.json`):
   ```json
   {
     "hooks": {
       "user-prompt-submit": [
         {
           "type": "command",
           "command": "/Users/j/.claude/hooks/track-intent.py"
         }
       ]
     }
   }
   ```

2. **Intent Tracking Script**: Located at `/Users/j/.claude/hooks/track-intent.py`
3. **Status Line Integration**: Via `~/.claude/smart-git-status.sh`

## How It Works

### Claude CLI Detection
The script automatically searches for Claude CLI in multiple locations:
1. **Native Claude Code**: `~/.claude/local/claude`, `~/.claude/bin/claude`
2. **NPM Global**: `~/.npm-global/bin/claude`, `~/.npm/bin/claude`
3. **Yarn/PNPM**: `~/.yarn/bin/claude`, `~/.local/share/pnpm/claude`
4. **System-wide**: `/usr/local/bin/claude`, `/usr/bin/claude`
5. **Homebrew**: `/opt/homebrew/bin/claude`, `/usr/local/Cellar/node/*/bin/claude`
6. **Windows/WSL**: `/mnt/c/Program Files/nodejs/claude`, `~/AppData/Roaming/npm/claude`
7. **Fallback**: System PATH if not found in known locations

### Data Flow
1. **Trigger**: Hook fires after each user prompt in Claude Code
2. **Context Extraction**: Analyzes recent transcript entries
3. **Git Analysis**: Detects staged/unstaged file changes
4. **Intent Generation**: 
   - Primary: Claude AI with 300-600s timeout
   - Fallback: Pattern-based smart generation
5. **Storage**: Saves intent to `.git/CLAUDE_INTENT`
6. **Display**: Status line shows current intent

### Context Analysis
The system extracts and prioritizes:
- **User Prompts** (highest priority): Direct requests and questions
- **Tool Usage**: File operations, searches, code generation
- **Code Patterns**: Function definitions, error handling, imports
- **Git Changes**: Added, modified, deleted files

### Boundary Detection
Uses multiple strategies to find relevant context (in priority order):
- Boundary markers (`===INTENT_BOUNDARY===`)
- Git commit boundaries (successful commits)
- Session boundaries (`/clear`, `/start`, `/reset`)
- Fallback: Last 150 entries

## Configuration Options

### Configuration Constants
- `HAIKU_MODEL`: Claude model for generation (default: claude-3-5-haiku-latest)
- `INTENT_CACHE_FILE`: Cache file name (default: .git/CLAUDE_INTENT_CACHE)
- `CACHE_DURATION_SECONDS`: Rate limiting (default: 30s)

### Customization
- **Timeout Settings**: Modify `timeout_seconds` in `call_claude_cli()`
- **Relevance Scoring**: Adjust `RELEVANCE_SCORES` dictionary
- **Fallback Patterns**: Edit `generate_smart_fallback()` function

## File Structure

```
.git/
├── CLAUDE_INTENT              # Current suggested commit message
├── CLAUDE_INTENT_CACHE        # Rate limiting and deduplication
└── intent_debug.log           # Debug information (always active)

~/.claude/
├── settings.json              # Hook configuration
├── smart-git-status.sh        # Status line integration
└── hooks/
    └── track-intent.py        # Main tracking script
```

## Example Output

### Generated Messages
```bash
feat: Add intent tracking system with Claude CLI support
docs: Update project documentation with setup guide
fix: Resolve subprocess timeout in intent generation
refactor: Improve error handling in authentication module
```

### Status Line Display
```bash
📁 main +2 ~1 🎯 feat: Add new user dashboard
```

## Troubleshooting

### Common Issues

**No intent generated**:
- Check that hooks are enabled in settings.json
- Verify Claude Code session is active
- Ensure git repository is initialized

**Generic messages only**:
- Context extraction may be limited
- Check transcript format compatibility
- Verify boundary detection is working

**Slow performance**:
- Claude API calls have 300-600s timeout
- Check network connectivity
- Consider reducing context window size

### Debug Information
Debug logs automatically appear in `.git/intent_debug.log` with detailed processing information including:
- Boundary detection strategy used (e.g., `fallback_last_150`, `session_start`)
- Context items extracted and git files detected
- Generated intent messages

## Performance

### Typical Metrics
- **Context Items**: 15-30 per analysis
- **Response Time**: 5-15 seconds for AI generation
- **Accuracy**: High contextual relevance for commit messages
- **Reliability**: Smart fallback ensures messages are always generated

### Resource Usage
- **Memory**: Minimal (transcript analysis only)
- **Network**: Claude API calls when available
- **Storage**: <1KB per session for cache and intent files

## Limitations

- Requires Claude Code CLI for AI generation
- Limited to git repositories
- Context window bounded by transcript size
- Rate limited to prevent excessive API usage

## Future Enhancements

- Support for custom commit message templates
- Integration with git hooks for automatic commits
- Branch-specific intent tracking
- Multi-project context awareness