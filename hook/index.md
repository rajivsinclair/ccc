# Claude Code Commit Intelligence System

A comprehensive suite of tools for intelligent commit message generation and session tracking in Claude Code.

## Overview

This system provides multiple variants of commit intelligence tools, each optimized for different workflows and requirements. All variants integrate seamlessly with Claude Code's hook system and can be mixed and matched based on your needs.

## Quick Start

```bash
# Install the complete system
./install.sh

# Or install a specific variant
./install.sh --variant adaptive

# Configure in ~/.claude/settings.json
# See config.json for all options
```

## Core Features

- 🎯 **Intelligent Commit Messages**: AI-generated or pattern-based messages
- 📊 **Performance Optimization**: Adaptive caching based on repository size
- 🚨 **Bloat Prevention**: Automatic warnings for oversized commits
- 📝 **Session Logging**: Comprehensive tracking of all work
- 🎨 **Multiple Formats**: Conventional, Linear, Emoji, and custom formats
- ⚡ **Smart Caching**: Reduces API calls and improves performance
- 🔄 **Parallel Support**: Handle multiple Claude Code sessions

## Variants

### 1. Original (track-intent.py)
The foundational implementation with core features.
- **Use Case**: Standard workflow with Claude AI integration
- **Features**: Context extraction, AI generation, smart fallback
- **Performance**: Moderate (API calls when needed)
- **Dependencies**: Claude CLI

### 2. Minimal (variant-minimal.py)
Pure git statistics without any LLM calls.
- **Use Case**: Maximum performance, no external dependencies
- **Features**: Git stats only, pattern-based messages
- **Performance**: Fastest (<50ms)
- **Dependencies**: None

### 3. Adaptive (variant-adaptive.py)
Performance-optimized with intelligent caching.
- **Use Case**: Large repositories, varying performance needs
- **Features**: Adaptive cache TTL, performance monitoring
- **Performance**: Optimized (adjusts to repo size)
- **Dependencies**: Claude CLI (optional)

### 4. Bloat Detector (variant-bloat-detector.py)
Prevents commit bloat with active warnings.
- **Use Case**: Teams needing commit size enforcement
- **Features**: Configurable thresholds, visual warnings
- **Performance**: Fast with minimal overhead
- **Dependencies**: None

### 5. Session Logger (variant-session-logger.py)
Comprehensive session tracking and documentation.
- **Use Case**: Detailed work documentation, audit trails
- **Features**: Markdown logs, metrics tracking, history
- **Performance**: Moderate (additional file I/O)
- **Dependencies**: Claude CLI (optional)

### 6. Multi-Format (variant-multi-format.py)
Supports multiple commit message formats.
- **Use Case**: Teams with different conventions
- **Features**: Auto-detects format, configurable styles
- **Performance**: Moderate
- **Dependencies**: Claude CLI

## Configuration

### Global Configuration (config.json)

```json
{
  "model": "claude-3-5-haiku-latest",
  "cache_duration": 30,
  "max_lookback": 500,
  "target_tokens": 2000,
  "commit_formats": {
    "conventional": true,
    "linear": true,
    "emoji": false
  },
  "bloat_thresholds": {
    "files": 10,
    "additions": 300,
    "deletions": 200
  }
}
```

### Variant Selection

Edit `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "~/.claude/hooks/variant-adaptive.py"
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline-variants/adaptive.py"
  }
}
```

## Status Line Variants

Located in `statusline-variants/`:

| Variant | Description | Performance | Features |
|---------|-------------|-------------|----------|
| minimal.sh | Basic git stats | Fastest | No dependencies |
| intent.sh | Shows current intent | Fast | Intent display |
| adaptive.py | Performance-aware | Adaptive | Smart caching |
| bloat.sh | Bloat warnings | Fast | Visual alerts |
| comprehensive.py | Full features | Slower | All metrics |

## Slash Commands

Located in `commands/`:

### /commit
Create a well-structured commit with AI assistance.

### /qc (Quick Commit)
Use the generated intent for a quick commit.

### /git-status
Show detailed git status with intent and suggestions.

### /session-log
View the current session log with metrics.

### /bloat-check
Check current changes for potential bloat.

## Performance Comparison

| Variant | Startup Time | API Calls | Cache Hit Rate | Memory Usage |
|---------|-------------|-----------|----------------|--------------|
| Minimal | <50ms | 0 | N/A | <10MB |
| Original | 100-300ms | 1 per change | 60% | ~20MB |
| Adaptive | 50-200ms | Adaptive | 85% | ~15MB |
| Bloat Detector | <100ms | 0 | N/A | <10MB |
| Session Logger | 150-400ms | 1 per change | 70% | ~30MB |
| Multi-Format | 100-300ms | 1 per change | 65% | ~20MB |

## Installation

### Automated Installation

```bash
# Full installation with all variants
./install.sh --all

# Specific variant
./install.sh --variant adaptive

# With custom config
./install.sh --config ./my-config.json
```

### Manual Installation

1. Copy desired variant to `~/.claude/hooks/`
2. Copy status line to `~/.claude/statusline-variants/`
3. Copy commands to `~/.claude/commands/`
4. Update `~/.claude/settings.json`
5. Copy `config.json` to `~/.claude/intent-config.json`

## Troubleshooting

### Common Issues

**No intent generated**:
- Check hook configuration in settings.json
- Verify Claude CLI is accessible
- Check debug log: `.git/intent_debug.log`

**Performance issues**:
- Use adaptive variant for large repos
- Adjust cache_duration in config
- Consider minimal variant for speed

**Bloat warnings not appearing**:
- Verify bloat detector is active
- Check threshold configuration
- Ensure PostToolUse hook is configured

### Debug Mode

Enable debug logging:
```bash
export CLAUDE_DEBUG=true
claude
# Check ~/.claude/debug.log
```

### Logs and Cache

```
.git/
├── CLAUDE_INTENT              # Current intent
├── CLAUDE_INTENT_CACHE        # Cache data
├── CLAUDE_INTENT_HISTORY      # Intent history
├── CLAUDE_INTENT_CONFIDENCE   # Confidence score
├── CLAUDE_SESSION_LOG.md      # Session log
└── intent_debug.log           # Debug info

~/.claude/
├── cache/                     # Global cache
│   ├── git_cache.json
│   └── statusline_cache.json
├── debug.log                  # Debug log
└── hook-errors.log           # Error log
```

## Best Practices

### For Small Repositories (<1K files)
- Use minimal or original variant
- Short cache duration (10-30s)
- No performance optimization needed

### For Large Repositories (>10K files)
- Use adaptive variant
- Longer cache duration (30-60s)
- Enable git operation caching

### For Team Environments
- Use bloat detector
- Configure shared thresholds
- Enable session logging
- Standardize commit format

### For CI/CD Integration
- Use minimal variant
- Disable interactive features
- Log to centralized location

## Advanced Features

### Parallel Session Support
Each session gets a unique ID to prevent conflicts:
```python
session_id = hashlib.md5(transcript_path.encode()).hexdigest()[:8]
```

### Confidence Scoring
Messages include confidence based on:
- Context availability (30%)
- File scope (25%)
- Directory focus (20%)
- Change cohesion (25%)

### Boundary Detection Strategies
1. Boundary markers (injected)
2. Git commits (successful)
3. Session commands (/clear)
4. Time-based (5 minutes)
5. Fallback (last N entries)

## Contributing

To add a new variant:
1. Create `variant-[name].py` following the template
2. Add status line in `statusline-variants/`
3. Update this index.md
4. Add to install.sh
5. Test with different repo sizes

## License

MIT - Free for Claude Code community use

## Credits

Created by the Claude Code community for intelligent commit management.

---

Version: 2.0.0 | Last Updated: 2024