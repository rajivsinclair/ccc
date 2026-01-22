# Dynamic Commit Intelligence for Claude Code
*A comprehensive guide for intelligent commit message generation and tracking*

## Table of Contents
1. [Overview](#overview)
2. [Features](#features)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Variants](#variants)
6. [Performance Optimizations](#performance-optimizations)
7. [Customization](#customization)
8. [Troubleshooting](#troubleshooting)

## Overview

This system enhances your Claude Code workflow with context-aware commit message generation that learns from your work patterns. It tracks your development session, analyzes your changes, and helps maintain a clean, meaningful git history.

### Key Benefits
- **Intelligent Commit Messages**: Automatically generated based on actual work done
- **Bloat Prevention**: Warns when commits are getting too large
- **Session Tracking**: Comprehensive logging of all work
- **Performance Optimized**: Adaptive caching and efficient git operations
- **Customizable**: Adapt to your team's conventions

## Features

### Core Capabilities
- 🎯 **Multi-format support**: Conventional, Linear-style, emoji-based commits
- 📊 **Confidence scoring**: Indicates accuracy of generated messages
- 🔄 **Parallel session support**: Handle multiple Claude Code instances
- ⚡ **Adaptive caching**: Performance-based cache invalidation
- 📝 **Session logging**: Detailed work tracking in markdown
- 🚨 **Bloat detection**: Automatic warnings for oversized commits
- 🤖 **Optional auto-commit**: Autonomous mode available (use with caution)

### Performance Optimizations
- Adaptive cache TTL based on repository performance
- Git operation caching with intelligent invalidation
- Batch boundary marker injections
- Efficient `--name-status` usage for faster processing

## Installation

### Prerequisites
```bash
# Check requirements
command -v claude >/dev/null 2>&1 || echo "❌ Claude CLI not found"
command -v git >/dev/null 2>&1 || echo "❌ Git not found"  
command -v python3 >/dev/null 2>&1 || echo "❌ Python 3 not found"
command -v jq >/dev/null 2>&1 || echo "❌ jq not found"

# Install missing requirements (macOS)
brew install jq

# Install missing requirements (Linux)
sudo apt-get install jq  # Debian/Ubuntu
sudo yum install jq      # RHEL/CentOS
```

### Quick Install Script

Save and run this script:

```bash
#!/bin/bash
# save as: install-commit-intelligence.sh

set -e

echo "╔════════════════════════════════════════════╗"
echo "║  Claude Code Commit Intelligence Installer  ║"
echo "╚════════════════════════════════════════════╝"
echo

# Create directory structure
echo "Creating directories..."
mkdir -p ~/.claude/{hooks,commands,cache}
mkdir -p .claude

# Download or create the main hook script
cat > ~/.claude/hooks/intelligent-intent-tracker.py << 'EOF'
#!/usr/bin/env python3
"""
Intelligent Intent Tracker with Performance Optimizations
Version: 2.1.0
"""

import json
import sys
import os
import subprocess
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
import re
import traceback
from typing import Dict, List, Optional, Tuple, Any
import time

# Load configuration
CONFIG_FILE = Path.home() / ".claude/intent-config.json"

def load_config():
    """Load configuration with defaults"""
    defaults = {
        'model': 'claude-3-5-haiku-latest',
        'max_lookback': 500,
        'target_tokens': 2000,
        'max_tokens': 3000,
        'cache_duration': 30,
        'git_cache_duration': 5,
        'batch_boundary_interval': 300,  # 5 minutes
        'commit_formats': {
            'conventional': True,
            'linear': True,
            'emoji': False
        },
        'relevance_weights': {
            'task_delegation': 10,
            'user_prompt': 9,
            'git_command': 8,
            'file_operation': 7,
            'todo_management': 7,
            'summary': 6,
            'decision': 5,
            'error': 3,
            'tool_result': 2,
            'acknowledgment': 1,
            'verbose_output': 0
        },
        'bloat_thresholds': {
            'files': 10,
            'additions': 300,
            'deletions': 200,
            'categories': 3
        }
    }
    
    if CONFIG_FILE.exists():
        try:
            user_config = json.loads(CONFIG_FILE.read_text())
            # Deep merge
            for key, value in user_config.items():
                if isinstance(value, dict) and key in defaults:
                    defaults[key].update(value)
                else:
                    defaults[key] = value
        except Exception as e:
            debug_log(f"Config load error: {e}")
    
    return defaults

CONFIG = load_config()

# File paths
INTENT_FILE = ".git/CLAUDE_INTENT"
INTENT_CACHE_FILE = ".git/CLAUDE_INTENT_CACHE"
GIT_CACHE_FILE = Path.home() / ".claude/cache/git_cache.json"
BOUNDARY_MARKER_FILE = ".git/CLAUDE_LAST_BOUNDARY"
SESSION_LOG = ".claude/SESSION_LOG.md"
INTENT_HISTORY = ".git/CLAUDE_INTENT_HISTORY"
CONFIDENCE_FILE = ".git/CLAUDE_INTENT_CONFIDENCE"
DEBUG_LOG = Path.home() / ".claude/debug.log"

# Boundary marker
BOUNDARY_MARKER = "===INTENT_BOUNDARY==="

def debug_log(message: str):
    """Debug logging"""
    if os.environ.get('CLAUDE_DEBUG', '').lower() == 'true':
        DEBUG_LOG.parent.mkdir(exist_ok=True, parents=True)
        with open(DEBUG_LOG, 'a') as f:
            f.write(f"{datetime.now().isoformat()}: {message}\n")

def get_project_root() -> Path:
    """Find git project root"""
    cwd = Path(os.getcwd())
    for parent in [cwd] + list(cwd.parents):
        if (parent / ".git").exists():
            return parent
    return cwd

def get_session_id(transcript_path: str) -> str:
    """Generate session-specific ID for parallel support"""
    return hashlib.md5(transcript_path.encode()).hexdigest()[:8]

class GitCache:
    """Cache git operations for performance"""
    
    def __init__(self):
        self.cache_file = GIT_CACHE_FILE
        self.cache_file.parent.mkdir(exist_ok=True, parents=True)
        self.cache = self.load_cache()
    
    def load_cache(self) -> Dict:
        if self.cache_file.exists():
            try:
                return json.loads(self.cache_file.read_text())
            except:
                return {}
        return {}
    
    def save_cache(self):
        self.cache_file.write_text(json.dumps(self.cache, indent=2))
    
    def get(self, key: str, compute_func, ttl: int = None):
        """Get cached value or compute"""
        ttl = ttl or CONFIG['git_cache_duration']
        
        if key in self.cache:
            entry = self.cache[key]
            age = time.time() - entry['timestamp']
            if age < ttl:
                debug_log(f"Cache hit: {key}")
                return entry['value']
        
        debug_log(f"Cache miss: {key}")
        value = compute_func()
        self.cache[key] = {
            'timestamp': time.time(),
            'value': value
        }
        self.save_cache()
        return value

def detect_commit_format(project_root: Path) -> str:
    """Detect preferred commit format from git history"""
    try:
        recent_commits = subprocess.run(
            ["git", "log", "--oneline", "-50"],
            capture_output=True, text=True, cwd=project_root
        ).stdout.lower()
        
        # Check patterns
        patterns = {
            'linear': r'\b[a-z]{3,4}-\d+\b',  # ENG-123, PROD-456
            'conventional': r'\b(feat|fix|docs|style|refactor|test|chore|perf|ci|build):',
            'emoji': r'[✨🔧📝🚀💄♻️✅🎨]',
            'gitmoji': r':[a-z_]+:',  # :sparkles:, :bug:
        }
        
        scores = {}
        for format_name, pattern in patterns.items():
            if CONFIG['commit_formats'].get(format_name, False):
                scores[format_name] = len(re.findall(pattern, recent_commits))
        
        if scores:
            return max(scores, key=scores.get)
        
        return 'conventional'  # Default
    except:
        return 'conventional'

def calculate_confidence(context_items: List, git_summary: Dict) -> int:
    """Calculate confidence score for generated intent (0-100)"""
    score = 0
    
    # Context quality
    if context_items:
        score += min(len(context_items) * 5, 30)
    
    # Git scope
    files = git_summary.get('total_files', 0)
    if files > 0 and files <= 5:
        score += 25
    elif files <= 10:
        score += 15
    else:
        score += 5
    
    # Directory focus
    if git_summary.get('primary_directory'):
        score += 20
    
    # Change cohesion
    categories = len(set(f.split('/')[0] for f in git_summary.get('changes', {}).get('modified', [])))
    if categories == 1:
        score += 25
    elif categories <= 3:
        score += 15
    
    return min(score, 100)

def find_boundaries(lines: List[str]) -> Tuple[int, str]:
    """Find the most appropriate boundary with batching support"""
    
    # Check if we should inject a new boundary
    last_boundary_time = None
    if Path(BOUNDARY_MARKER_FILE).exists():
        try:
            last_boundary_time = float(Path(BOUNDARY_MARKER_FILE).read_text())
        except:
            pass
    
    current_time = time.time()
    should_inject = False
    
    if last_boundary_time:
        if current_time - last_boundary_time > CONFIG['batch_boundary_interval']:
            should_inject = True
    else:
        should_inject = True
    
    # Find existing boundaries
    for i, line in enumerate(reversed(lines)):
        try:
            data = json.loads(line.strip())
            if data.get('type') == 'assistant':
                content = data.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            if BOUNDARY_MARKER in item.get('text', ''):
                                return len(lines) - i - 1, "boundary_marker"
        except:
            continue
    
    # Check for git commit
    for i, line in enumerate(reversed(lines)):
        try:
            data = json.loads(line.strip())
            if data.get('type') == 'assistant':
                content = data.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if item.get('type') == 'tool_use' and item.get('name') == 'Bash':
                            command = item.get('input', {}).get('command', '')
                            if 'git commit' in command and '-m' in command:
                                return len(lines) - i - 1, "git_commit"
        except:
            continue
    
    # Default fallback
    return max(0, len(lines) - 100), "fallback"

def get_git_changes_summary() -> Dict[str, Any]:
    """Get git changes using --name-status for performance"""
    git_cache = GitCache()
    
    def compute_changes():
        try:
            # Use --name-status for speed
            name_status = subprocess.run(
                ["git", "diff", "--name-status", "HEAD"],
                capture_output=True, text=True
            )
            
            # Overall statistics (cached separately)
            shortstat = subprocess.run(
                ["git", "diff", "--shortstat", "HEAD"],
                capture_output=True, text=True
            )
            
            changes = {'added': [], 'modified': [], 'deleted': []}
            if name_status.stdout:
                for line in name_status.stdout.strip().split('\n'):
                    parts = line.split('\t')
                    if len(parts) == 2:
                        status, file = parts
                        if status == 'A':
                            changes['added'].append(file)
                        elif status == 'M':
                            changes['modified'].append(file)
                        elif status == 'D':
                            changes['deleted'].append(file)
            
            # Analyze directories
            directories = {}
            for files_list in changes.values():
                for file in files_list:
                    dir_name = os.path.dirname(file) or 'root'
                    directories[dir_name] = directories.get(dir_name, 0) + 1
            
            primary_dir = max(directories.items(), key=lambda x: x[1])[0] if directories else None
            
            return {
                'changes': changes,
                'stats': shortstat.stdout.strip() if shortstat.stdout else "",
                'primary_directory': primary_dir,
                'total_files': sum(len(v) for v in changes.values())
            }
        except Exception as e:
            debug_log(f"Git summary error: {e}")
            return {'changes': {}, 'stats': '', 'primary_directory': None, 'total_files': 0}
    
    return git_cache.get('git_changes', compute_changes)

def classify_content(data: Dict[str, Any]) -> Tuple[str, Dict[str, Any], int]:
    """Classify transcript content with configurable weights"""
    entry_type = data.get('type', '')
    weights = CONFIG['relevance_weights']
    
    if entry_type == 'human':
        content = data.get('content', '')
        if isinstance(content, list) and content:
            text = content[0].get('text', '') if isinstance(content[0], dict) else str(content[0])
            if len(text) > 200:
                text = text[:197] + "..."
            return 'user_prompt', {'text': text}, weights['user_prompt']
    
    elif entry_type == 'assistant':
        content = data.get('content', [])
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    if item.get('type') == 'tool_use':
                        tool_name = item.get('name', '')
                        input_data = item.get('input', {})
                        
                        if tool_name == 'Task':
                            subagent = input_data.get('subagent_type', 'unknown')
                            description = input_data.get('description', '')
                            prompt = input_data.get('prompt', '')[:200]
                            return 'task_delegation', {
                                'subagent': subagent,
                                'description': description,
                                'prompt': prompt
                            }, weights['task_delegation']
                        
                        elif tool_name in ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']:
                            file_path = input_data.get('file_path', '') or input_data.get('notebook_path', '')
                            if file_path:
                                return 'file_operation', {
                                    'action': tool_name.lower(),
                                    'file': file_path
                                }, weights['file_operation']
                        
                        elif tool_name == 'TodoWrite':
                            todos = input_data.get('todos', [])
                            return 'todo_management', {
                                'action': 'todo_update',
                                'count': len(todos)
                            }, weights['todo_management']
                        
                        elif tool_name == 'Bash':
                            command = input_data.get('command', '')
                            if 'git' in command:
                                clean_cmd = re.sub(r'-m\s+"[^"]*"', '-m "[message]"', command)
                                return 'git_command', {'command': clean_cmd[:100]}, weights['git_command']
                    
                    elif item.get('type') == 'text':
                        text = item.get('text', '')
                        if len(text) < 50 and any(word in text.lower() for word in ['sure', 'ok', 'will']):
                            return 'acknowledgment', {}, weights['acknowledgment']
                        
                        if any(keyword in text.lower() for keyword in ['decided', 'completed', 'finished']):
                            summary = text.split('.')[0] if '.' in text else text[:150]
                            return 'summary', {'text': summary}, weights['summary']
    
    elif entry_type == 'tool_result':
        content = data.get('content', '')
        if isinstance(content, list) and content:
            result_text = str(content[0])
            if 'error' in result_text.lower() or 'failed' in result_text.lower():
                error_line = result_text.split('\n')[0][:100]
                return 'error', {'message': error_line}, weights['error']
    
    return 'other', {}, 0

def extract_intelligent_context(lines: List[str], start_idx: int) -> List[Dict[str, Any]]:
    """Extract context with performance optimizations"""
    context_items = []
    seen_files = set()
    seen_prompts = set()
    total_tokens = 0
    
    for line in lines[start_idx:]:
        try:
            data = json.loads(line.strip())
            content_type, extracted, relevance = classify_content(data)
            
            if relevance < 2:
                continue
            
            # Deduplication
            if content_type == 'file_operation':
                file_path = extracted.get('file')
                if file_path in seen_files:
                    continue
                seen_files.add(file_path)
            
            elif content_type == 'user_prompt':
                prompt_hash = hashlib.md5(extracted.get('text', '').encode()).hexdigest()[:8]
                if prompt_hash in seen_prompts:
                    continue
                seen_prompts.add(prompt_hash)
            
            item_tokens = int(len(json.dumps(extracted)) / 3.5)
            
            if total_tokens + item_tokens > CONFIG['target_tokens']:
                if relevance >= 8 and total_tokens + item_tokens <= CONFIG['max_tokens']:
                    context_items.append({
                        'type': content_type,
                        'data': extracted,
                        'relevance': relevance
                    })
                    total_tokens += item_tokens
                break
            
            context_items.append({
                'type': content_type,
                'data': extracted,
                'relevance': relevance
            })
            total_tokens += item_tokens
            
        except Exception as e:
            debug_log(f"Context extraction error: {e}")
            continue
    
    return context_items

def format_commit_message(type: str, scope: str, description: str, format_style: str) -> str:
    """Format commit message based on detected style"""
    if format_style == 'linear':
        # Linear style: ENG-123: Description
        ticket = f"{scope.upper()[:3]}-{hashlib.md5(description.encode()).hexdigest()[:3].upper()}"
        return f"{ticket}: {description}"
    
    elif format_style == 'emoji':
        # Emoji style
        emoji_map = {
            'feat': '✨',
            'fix': '🐛',
            'docs': '📝',
            'style': '💄',
            'refactor': '♻️',
            'test': '✅',
            'chore': '🔧',
            'perf': '⚡',
            'ci': '👷'
        }
        emoji = emoji_map.get(type, '📦')
        return f"{emoji} {description}"
    
    else:
        # Conventional (default)
        if scope:
            return f"{type}({scope}): {description}"
        return f"{type}: {description}"

def build_optimized_prompt(context_items: List[Dict], git_summary: Dict, commit_format: str) -> str:
    """Build prompt with format awareness"""
    sections = []
    
    # Group context
    user_prompts = [item['data']['text'] for item in context_items if item['type'] == 'user_prompt']
    task_delegations = [item['data'] for item in context_items if item['type'] == 'task_delegation']
    file_ops = [item['data'] for item in context_items if item['type'] == 'file_operation']
    
    if user_prompts:
        unique_prompts = list(dict.fromkeys(user_prompts))[-3:]
        sections.append("User requests:\n" + "\n".join(f"- {p}" for p in unique_prompts))
    
    if task_delegations:
        task_summary = []
        for task in task_delegations[:3]:
            task_summary.append(f"- {task['subagent']}: {task['description']}")
        sections.append("Sub-agent tasks:\n" + "\n".join(task_summary))
    
    if git_summary['total_files'] > 0:
        change_summary = []
        if git_summary['changes']['added']:
            change_summary.append(f"Added: {', '.join(git_summary['changes']['added'][:5])}")
        if git_summary['changes']['modified']:
            change_summary.append(f"Modified: {', '.join(git_summary['changes']['modified'][:5])}")
        sections.append("Git changes:\n" + "\n".join(change_summary))
    
    context = "\n\n".join(sections)
    
    format_instructions = {
        'conventional': "Use conventional format: type(scope): description\nTypes: feat, fix, docs, style, refactor, test, chore, perf, ci",
        'linear': "Use Linear ticket format: AREA-###: description\nAreas: ENG, PROD, DOCS, TEST, INFRA",
        'emoji': "Start with emoji: ✨ for features, 🐛 for fixes, 📝 for docs, ♻️ for refactor"
    }
    
    prompt = f"""Generate a commit message for these changes.

CONTEXT:
{context}

FORMAT: {commit_format}
{format_instructions.get(commit_format, format_instructions['conventional'])}

Rules:
- Maximum 72 characters
- Be specific about WHAT changed
- Use present tense

Output ONLY the commit message:"""
    
    return prompt

def call_claude_for_intent(prompt: str) -> str:
    """Call Claude with fallback"""
    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--model", CONFIG['model']],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0 and result.stdout:
            message = result.stdout.strip().strip('"\'')
            if len(message) > 72:
                if ' ' in message[:69]:
                    message = message[:69].rsplit(' ', 1)[0] + "..."
                else:
                    message = message[:69] + "..."
            return message
    except subprocess.TimeoutExpired:
        debug_log("Claude call timeout")
    except Exception as e:
        debug_log(f"Claude call error: {e}")
    
    return "chore: Update project files"

def save_intent_history(project_root: Path, intent: str, confidence: int):
    """Save intent history for learning"""
    history_file = project_root / INTENT_HISTORY
    
    entry = {
        'timestamp': datetime.now().isoformat(),
        'intent': intent,
        'confidence': confidence,
        'format': detect_commit_format(project_root)
    }
    
    history = []
    if history_file.exists():
        try:
            history = json.loads(history_file.read_text())
        except:
            pass
    
    history.append(entry)
    history = history[-50:]  # Keep last 50
    
    history_file.write_text(json.dumps(history, indent=2))

def update_session_log(project_root: Path, intent: str, git_summary: Dict, confidence: int):
    """Update comprehensive session log"""
    log_file = project_root / SESSION_LOG
    log_file.parent.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    if not log_file.exists():
        log_file.write_text("""# Claude Code Session Log

## Overview
Tracking all Claude Code sessions with intelligent commit generation.

---

""")
    
    with open(log_file, 'a') as f:
        f.write(f"\n### {timestamp}\n")
        f.write(f"**Suggested commit:** `{intent}` (confidence: {confidence}%)\n")
        f.write(f"**Files affected:** {git_summary['total_files']}\n")
        if git_summary.get('primary_directory'):
            f.write(f"**Primary directory:** `{git_summary['primary_directory']}`\n")
        f.write(f"**Stats:** {git_summary.get('stats', 'N/A')}\n")
        f.write("\n")

def inject_boundary_marker():
    """Inject boundary marker with batching"""
    current_time = time.time()
    Path(BOUNDARY_MARKER_FILE).write_text(str(current_time))
    print(f"\n{BOUNDARY_MARKER} {datetime.now().isoformat()}\n")
    sys.stdout.flush()

def should_update_intent(project_root: Path, context_hash: str, git_changes: Dict) -> bool:
    """Smart cache invalidation"""
    cache_file = project_root / INTENT_CACHE_FILE
    
    if cache_file.exists():
        try:
            cache_data = json.loads(cache_file.read_text())
            last_hash = cache_data.get('context_hash', '')
            last_time = cache_data.get('last_update', 0)
            current_time = datetime.now().timestamp()
            
            # Content-based invalidation
            if last_hash != context_hash:
                return True
            
            # Git changes invalidation
            if git_changes['total_files'] > 0:
                last_git_hash = cache_data.get('git_hash', '')
                current_git_hash = hashlib.md5(
                    json.dumps(git_changes).encode()
                ).hexdigest()
                if last_git_hash != current_git_hash:
                    return True
            
            # Time-based invalidation
            if current_time - last_time > CONFIG['cache_duration']:
                return True
            
            return False
        except:
            return True
    
    return True

def update_intent_cache(project_root: Path, context_hash: str, git_changes: Dict):
    """Update cache with smart invalidation"""
    cache_file = project_root / INTENT_CACHE_FILE
    cache_data = {
        'last_update': datetime.now().timestamp(),
        'context_hash': context_hash,
        'git_hash': hashlib.md5(json.dumps(git_changes).encode()).hexdigest()
    }
    cache_file.write_text(json.dumps(cache_data))

def main():
    """Main hook handler with all improvements"""
    try:
        input_data = json.load(sys.stdin)
        hook_event = input_data.get("hook_event_name", "")
        
        if hook_event not in ["Stop", "SubagentStop"]:
            sys.exit(0)
        
        project_root = get_project_root()
        git_dir = project_root / ".git"
        
        if not git_dir.exists():
            sys.exit(0)
        
        transcript_path = input_data.get("transcript_path", "")
        if not transcript_path or not Path(transcript_path).exists():
            sys.exit(0)
        
        session_id = get_session_id(transcript_path)
        debug_log(f"Processing session {session_id}")
        
        # Read transcript
        with open(transcript_path, 'r') as f:
            lines = f.readlines()
        
        if len(lines) < 5:
            sys.exit(0)
        
        # Find boundary
        boundary_idx, boundary_type = find_boundaries(lines)
        debug_log(f"Boundary: {boundary_type} at {boundary_idx}")
        
        # Extract context
        context_items = extract_intelligent_context(lines, boundary_idx)
        
        # Get git changes with caching
        git_summary = get_git_changes_summary()
        
        if git_summary['total_files'] == 0 and len(context_items) < 2:
            sys.exit(0)
        
        # Detect commit format
        commit_format = detect_commit_format(project_root)
        
        # Build prompt
        prompt = build_optimized_prompt(context_items, git_summary, commit_format)
        
        # Check cache
        context_hash = hashlib.md5(prompt.encode()).hexdigest()
        if not should_update_intent(project_root, context_hash, git_summary):
            debug_log("Using cached intent")
            sys.exit(0)
        
        # Generate intent
        intent = call_claude_for_intent(prompt)
        
        # Calculate confidence
        confidence = calculate_confidence(context_items, git_summary)
        
        # Write outputs
        intent_file = project_root / f"{INTENT_FILE}_{session_id}"
        intent_file.write_text(intent)
        
        # Also write to main file for backward compatibility
        (project_root / INTENT_FILE).write_text(intent)
        
        # Write confidence
        (project_root / CONFIDENCE_FILE).write_text(str(confidence))
        
        # Update logs
        save_intent_history(project_root, intent, confidence)
        update_session_log(project_root, intent, git_summary, confidence)
        
        # Update cache
        update_intent_cache(project_root, context_hash, git_summary)
        
        # Inject boundary if needed
        last_boundary_time = None
        if Path(BOUNDARY_MARKER_FILE).exists():
            try:
                last_boundary_time = float(Path(BOUNDARY_MARKER_FILE).read_text())
            except:
                pass
        
        if not last_boundary_time or (time.time() - last_boundary_time > CONFIG['batch_boundary_interval']):
            inject_boundary_marker()
        
        debug_log(f"Intent generated: {intent} (confidence: {confidence}%)")
        sys.exit(0)
        
    except Exception as e:
        error_log = Path.home() / ".claude/hook-errors.log"
        error_log.parent.mkdir(exist_ok=True)
        
        error_context = {
            'timestamp': datetime.now().isoformat(),
            'error': str(e),
            'hook_event': input_data.get('hook_event_name', 'unknown'),
            'traceback': traceback.format_exc()
        }
        
        with open(error_log, 'a') as f:
            f.write(json.dumps(error_context) + '\n')
        
        # Fallback
        project_root = get_project_root()
        if project_root:
            (project_root / INTENT_FILE).write_text("chore: Update project files")
        
        sys.exit(0)

if __name__ == "__main__":
    main()
EOF

# Create status line scripts
echo "Creating status line scripts..."

# Minimal status line
cat > ~/.claude/statusline-minimal.sh << 'EOF'
#!/bin/bash
input=$(cat)
MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')

if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    FILES=$(git diff --name-only HEAD 2>/dev/null | wc -l | tr -d ' ')
    STATS=$(git diff --shortstat HEAD 2>/dev/null)
    ADD=$(echo "$STATS" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
    DEL=$(echo "$STATS" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")
    
    ICON="📝"
    [ "$FILES" -eq 0 ] && ICON="✅"
    [ "$DEL" -gt "$ADD" ] && ICON="🧹"
    
    echo "[$MODEL] 🌿 $BRANCH | $ICON $FILES files +$ADD/-$DEL"
else
    echo "[$MODEL] 📁 ${DIR##*/}"
fi
EOF

# Intent status line with confidence
cat > ~/.claude/statusline-intent.sh << 'EOF'
#!/bin/bash
input=$(cat)
MODEL=$(echo "$input" | jq -r '.model.display_name')

if [ -f ".git/CLAUDE_INTENT" ]; then
    INTENT=$(cat .git/CLAUDE_INTENT)
    CONFIDENCE=""
    if [ -f ".git/CLAUDE_INTENT_CONFIDENCE" ]; then
        CONF=$(cat .git/CLAUDE_INTENT_CONFIDENCE)
        if [ "$CONF" -ge 80 ]; then
            CONFIDENCE=" ✅"
        elif [ "$CONF" -ge 50 ]; then
            CONFIDENCE=" ⚠️"
        else
            CONFIDENCE=" ❓"
        fi
    fi
    echo "[$MODEL] 💡 $INTENT$CONFIDENCE"
else
    BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
    echo "[$MODEL] 🌿 $BRANCH"
fi
EOF

# Adaptive performance status line
cat > ~/.claude/statusline-adaptive.py << 'EOF'
#!/usr/bin/env python3
"""
Adaptive performance status line with intelligent caching
"""

import json
import sys
import subprocess
import os
from pathlib import Path
import time

# Adaptive cache configuration
CACHE_FILE = Path.home() / ".claude/cache/statusline_cache.json"
MIN_CACHE_TTL = 3   # Minimum 3 seconds for fast repos
MAX_CACHE_TTL = 10  # Maximum 10 seconds for slow repos
TARGET_OPERATION_TIME = 50  # Target 50ms for git operations

class AdaptiveGitCache:
    """Adaptive caching that adjusts TTL based on repository performance"""
    
    def __init__(self):
        CACHE_FILE.parent.mkdir(exist_ok=True, parents=True)
        self.cache = self.load_cache()
        self.performance_stats = self.cache.get('_performance', {})
    
    def load_cache(self):
        if CACHE_FILE.exists():
            try:
                return json.loads(CACHE_FILE.read_text())
            except:
                pass
        return {}
    
    def save_cache(self):
        try:
            CACHE_FILE.write_text(json.dumps(self.cache))
        except:
            pass  # Don't fail on cache write errors
    
    def get_adaptive_ttl(self):
        """Calculate TTL based on recent performance"""
        if not self.performance_stats:
            return MIN_CACHE_TTL
        
        # Get average operation time from last 10 operations
        recent_times = self.performance_stats.get('recent_times', [])
        if recent_times:
            avg_time = sum(recent_times) / len(recent_times)
            
            # Scale TTL based on operation time
            # Fast ops (< 50ms): 3 second TTL
            # Slow ops (> 200ms): 10 second TTL
            # Linear scale in between
            if avg_time < TARGET_OPERATION_TIME:
                return MIN_CACHE_TTL
            elif avg_time > 200:
                return MAX_CACHE_TTL
            else:
                # Linear interpolation
                ratio = (avg_time - TARGET_OPERATION_TIME) / (200 - TARGET_OPERATION_TIME)
                return MIN_CACHE_TTL + (MAX_CACHE_TTL - MIN_CACHE_TTL) * ratio
        
        return MIN_CACHE_TTL
    
    def record_performance(self, operation_time):
        """Record operation performance for adaptive TTL"""
        recent = self.performance_stats.get('recent_times', [])
        recent.append(operation_time * 1000)  # Convert to ms
        recent = recent[-10:]  # Keep last 10
        
        self.performance_stats['recent_times'] = recent
        self.performance_stats['last_update'] = time.time()
        self.cache['_performance'] = self.performance_stats
    
    def get(self, key, compute_func):
        """Get cached value or compute with performance tracking"""
        ttl = self.get_adaptive_ttl()
        
        # Check cache
        if key in self.cache:
            entry = self.cache[key]
            age = time.time() - entry['time']
            if age < ttl:
                return entry['value']
        
        # Compute with timing
        start_time = time.time()
        value = compute_func()
        operation_time = time.time() - start_time
        
        # Record performance
        self.record_performance(operation_time)
        
        # Cache result
        self.cache[key] = {
            'time': time.time(),
            'value': value,
            'operation_time': operation_time
        }
        
        self.save_cache()
        return value

def get_git_info_cached(cache):
    """Get git information with adaptive caching"""
    def compute():
        info = {
            'branch': 'main',
            'files': 0,
            'adds': 0,
            'dels': 0,
            'is_git': False
        }
        
        try:
            # Check if we're in a git repo first (very fast)
            check = subprocess.run(
                ["git", "rev-parse", "--git-dir"],
                capture_output=True,
                stderr=subprocess.DEVNULL
            )
            
            if check.returncode != 0:
                return info
            
            info['is_git'] = True
            
            # Get branch (usually fast)
            result = subprocess.run(
                ["git", "symbolic-ref", "--short", "HEAD"],
                capture_output=True,
                text=True,
                stderr=subprocess.DEVNULL
            )
            if result.returncode == 0:
                info['branch'] = result.stdout.strip()
            else:
                # Detached HEAD
                result = subprocess.run(
                    ["git", "rev-parse", "--short", "HEAD"],
                    capture_output=True,
                    text=True
                )
                if result.returncode == 0:
                    info['branch'] = result.stdout.strip()[:7]
            
            # Get changes (can be slow on large repos)
            result = subprocess.run(
                ["git", "diff", "--numstat", "HEAD"],
                capture_output=True,
                text=True,
                stderr=subprocess.DEVNULL
            )
            
            if result.returncode == 0 and result.stdout:
                for line in result.stdout.strip().split('\n'):
                    parts = line.split('\t')
                    if len(parts) >= 3:
                        info['files'] += 1
                        if parts[0] != '-':
                            info['adds'] += int(parts[0])
                        if parts[1] != '-':
                            info['dels'] += int(parts[1])
        except Exception:
            pass
        
        return info
    
    return cache.get('git_info', compute)

def get_intent_info():
    """Get intent and confidence (not cached - these files are tiny)"""
    intent = None
    confidence = None
    
    intent_file = Path(".git/CLAUDE_INTENT")
    if intent_file.exists():
        try:
            intent = intent_file.read_text().strip()
            # Truncate long intents for status line
            if len(intent) > 50:
                intent = intent[:47] + "..."
        except:
            pass
    
    conf_file = Path(".git/CLAUDE_INTENT_CONFIDENCE")
    if conf_file.exists():
        try:
            confidence = int(conf_file.read_text())
        except:
            pass
    
    return intent, confidence

def main():
    try:
        input_data = json.load(sys.stdin)
        model = input_data['model']['display_name']
        
        # Initialize adaptive cache
        cache = AdaptiveGitCache()
        
        # Get intent (not cached - tiny files)
        intent, confidence = get_intent_info()
        
        if intent:
            # Show intent with confidence
            if confidence is not None:
                if confidence >= 80:
                    intent += " ✅"
                elif confidence >= 50:
                    intent += " ⚠️"
                else:
                    intent += " ❓"
            
            print(f"[{model}] 💡 {intent}")
        else:
            # Get git info with adaptive caching
            git = get_git_info_cached(cache)
            
            if not git['is_git']:
                # Not a git repo
                dir_name = os.path.basename(os.getcwd())
                print(f"[{model}] 📁 {dir_name}")
            else:
                # Show git status
                icon = "📝"
                if git['files'] == 0:
                    icon = "✅"
                elif git['dels'] > git['adds']:
                    icon = "🧹"
                elif git['files'] > 10:
                    icon = "⚠️"  # Possible bloat
                
                status = f"[{model}] 🌿 {git['branch']}"
                
                if git['files'] > 0:
                    status += f" | {icon} {git['files']} +{git['adds']}/-{git['dels']}"
                else:
                    status += " ✅"
                
                # Add cache performance indicator in debug mode
                if os.environ.get('CLAUDE_DEBUG') == 'true':
                    ttl = cache.get_adaptive_ttl()
                    status += f" | ⚡{ttl:.1f}s"
                
                print(status)
    
    except Exception as e:
        # Never fail the status line
        print(f"[{input_data.get('model', {}).get('display_name', 'Claude')}] ❌ {str(e)[:30]}")

if __name__ == "__main__":
    main()
EOF

# Create slash commands
echo "Creating slash commands..."

# Commit command
cat > ~/.claude/commands/commit.md << 'EOF'
---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*)
description: Create a focused, high-quality commit
model: claude-3-5-sonnet-latest
---

## Current Status
!`git status --short`

## Changes Summary
!`git diff HEAD --stat`

## Your Task

Analyze the changes and create a well-structured commit:

1. **Check for bloat**: If changes touch multiple unrelated features, advise splitting
2. **Generate message**: Use the format from `.git/CLAUDE_INTENT` if it exists
3. **Execute commit**: Stage and commit appropriately

Guidelines:
- Conventional format preferred
- Include body for complex changes
- Reference issues if applicable

Execute the commit with appropriate git commands.
EOF

# Quick commit command
cat > ~/.claude/commands/qc.md << 'EOF'
---
allowed-tools: Bash(git add:*), Bash(git commit:*)
description: Quick commit using generated intent
---

Use the generated intent from `.git/CLAUDE_INTENT` to commit.
Stage all changes and commit with that message.
If no intent exists, generate one based on current changes.
EOF

# Status command
cat > ~/.claude/commands/git-status.md << 'EOF'
---
allowed-tools: Bash(git status:*), Bash(git diff:*)
description: Show detailed git status with intent
---

Show:
1. Current git status
2. Generated commit intent (if available)
3. Confidence score
4. Suggestions for next steps

!`git status`
!`[ -f .git/CLAUDE_INTENT ] && echo "Intent: $(cat .git/CLAUDE_INTENT)"`
!`[ -f .git/CLAUDE_INTENT_CONFIDENCE ] && echo "Confidence: $(cat .git/CLAUDE_INTENT_CONFIDENCE)%"`
EOF

# Create configuration file
echo "Creating configuration..."

cat > ~/.claude/intent-config.json << 'EOF'
{
  "model": "claude-3-5-haiku-latest",
  "max_lookback": 500,
  "target_tokens": 2000,
  "max_tokens": 3000,
  "cache_duration": 30,
  "git_cache_duration": 5,
  "batch_boundary_interval": 300,
  "commit_formats": {
    "conventional": true,
    "linear": true,
    "emoji": false
  },
  "relevance_weights": {
    "task_delegation": 10,
    "user_prompt": 9,
    "git_command": 8,
    "file_operation": 7,
    "todo_management": 7,
    "summary": 6,
    "decision": 5,
    "error": 3,
    "tool_result": 2,
    "acknowledgment": 1,
    "verbose_output": 0
  },
  "bloat_thresholds": {
    "files": 10,
    "additions": 300,
    "deletions": 200,
    "categories": 3
  },
  "statusline_cache": {
    "min_ttl": 3,
    "max_ttl": 10,
    "target_operation_time": 50
  }
}
EOF

# Create bloat detector
cat > ~/.claude/hooks/bloat-detector.py << 'EOF'
#!/usr/bin/env python3
"""
Bloat Detector - Warns when commits are getting too large
"""

import json
import sys
import subprocess
from pathlib import Path

CONFIG_FILE = Path.home() / ".claude/intent-config.json"

def load_config():
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {'bloat_thresholds': {'files': 10, 'additions': 300, 'categories': 3}}

def check_bloat():
    config = load_config()
    thresholds = config['bloat_thresholds']
    
    try:
        diff = subprocess.run(
            ["git", "diff", "--numstat", "HEAD"],
            capture_output=True, text=True
        )
        
        if not diff.stdout:
            return None
        
        files = []
        additions = 0
        categories = set()
        
        for line in diff.stdout.strip().split('\n'):
            parts = line.split('\t')
            if len(parts) >= 3:
                files.append(parts[2])
                if parts[0] != '-':
                    additions += int(parts[0])
                
                # Categorize
                path = parts[2]
                if '/' in path:
                    categories.add(path.split('/')[0])
        
        warnings = []
        if len(files) > thresholds['files']:
            warnings.append(f"⚠️ {len(files)} files (limit: {thresholds['files']})")
        if additions > thresholds['additions']:
            warnings.append(f"⚠️ {additions} lines added (limit: {thresholds['additions']})")
        if len(categories) > thresholds['categories']:
            warnings.append(f"⚠️ {len(categories)} categories (limit: {thresholds['categories']})")
        
        if warnings:
            return {'warnings': warnings, 'stats': {'files': len(files)}}
        
        return None
    except:
        return None

def main():
    input_data = json.load(sys.stdin)
    
    if input_data.get("hook_event_name") != "PostToolUse":
        sys.exit(0)
    
    if input_data.get("tool_name") not in ["Write", "Edit", "MultiEdit"]:
        sys.exit(0)
    
    result = check_bloat()
    if result:
        Path(".git/BLOAT_WARNING").write_text(json.dumps(result))
        print("\n".join(result['warnings']))
    else:
        # Clear warning if no bloat
        warning_file = Path(".git/BLOAT_WARNING")
        if warning_file.exists():
            warning_file.unlink()
    
    sys.exit(0)

if __name__ == "__main__":
    main()
EOF

# Make everything executable
chmod +x ~/.claude/hooks/*.py
chmod +x ~/.claude/statusline-*.sh
chmod +x ~/.claude/statusline-*.py

echo
echo "✅ Installation complete!"
echo
echo "Choose your variant:"
echo "1. Minimal (no LLM):     statusline-minimal.sh"
echo "2. Intent-based:         statusline-intent.sh"
echo "3. Adaptive (Python):    statusline-adaptive.py"
echo
echo "Next steps:"
echo "1. Update .claude/settings.json with your chosen configuration"
echo "2. Customize ~/.claude/intent-config.json"
echo "3. Run /hooks in Claude Code to verify"
echo "4. Use /commit for high-quality commits"
echo "5. Use /qc for quick commits with generated messages"
EOF

chmod +x install-commit-intelligence.sh
echo "✅ Installer created: install-commit-intelligence.sh"
```

## Configuration

### Settings File Structure

Add to `.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline-adaptive.py"
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/intelligent-intent-tracker.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/bloat-detector.py"
          }
        ]
      }
    ]
  }
}
```

### Customization Options

Edit `~/.claude/intent-config.json`:

```json
{
  "model": "claude-3-5-haiku-latest",
  "commit_formats": {
    "conventional": true,
    "linear": true,
    "emoji": false
  },
  "bloat_thresholds": {
    "files": 10,
    "additions": 300,
    "deletions": 200,
    "categories": 3
  },
  "statusline_cache": {
    "min_ttl": 3,
    "max_ttl": 10,
    "target_operation_time": 50
  }
}
```

## Variants

### Variant 1: Minimal (No LLM)
Pure git statistics without any Claude API calls.

**Use when**: You want performance and don't need AI-generated messages.

**Status line shows**: `[Opus] 🌿 main | 📝 3 files +45/-12`

### Variant 2: Basic Intent
Generates commit messages using Claude, displays in status line.

**Use when**: You want suggestions but maintain full control.

**Status line shows**: `[Opus] 💡 feat: Add user authentication ✅`

### Variant 3: Adaptive Performance
Automatically adjusts caching based on repository performance.

**Use when**: Working with repositories of varying sizes or on different systems.

**Features**:
- Measures actual git operation time
- Fast repos (<50ms): 3 second cache
- Slow repos (>200ms): 10 second cache
- Linear scaling in between

### Variant 4: Anti-Bloat
Actively prevents commit bloat with warnings and specialized commands.

**Use when**: You tend to make commits too large.

**Status line shows**: `[Opus] ⚠️ BLOAT: 15 files | Use /commit`

### Variant 5: Session Logger
Comprehensive logging of all work to `SESSION_LOG.md`.

**Use when**: You need detailed documentation of your work.

**Log includes**:
- All commit suggestions with confidence scores
- Files modified with timestamps
- Subagents invoked
- Web searches performed
- Session metrics

## Performance Optimizations

### Adaptive Caching System

The system automatically adjusts cache TTL based on your repository's performance:

| Repository Size | Min Cache TTL | Max Cache TTL | Typical Performance |
|-----------------|---------------|---------------|---------------------|
| Small (<1K files) | 3 seconds | 5 seconds | Fast operations |
| Medium (1-10K files) | 5 seconds | 10 seconds | Moderate speed |
| Large (>10K files) | 10 seconds | 30 seconds | Slower operations |
| Network/WSL | 10 seconds | 60 seconds | Very slow operations |

### Performance Metrics

| Cache Strategy | Git ops/minute | CPU time/minute (fast) | CPU time/minute (slow) |
|----------------|----------------|------------------------|------------------------|
| Fixed 2s | 30 | ~0.3 seconds | ~3-6 seconds |
| Adaptive | 6-20 | ~0.06-0.2 seconds | ~0.6-1.2 seconds |

### Optimization Techniques

1. **Efficient Git Commands**:
   - Uses `git symbolic-ref` instead of `git branch --show-current`
   - Uses `--name-status` instead of `--stat`
   - Checks git repo existence before expensive operations

2. **Smart Caching**:
   - Content-based cache invalidation
   - Performance-aware TTL adjustment
   - Separate caching for different operations

3. **Batch Processing**:
   - Boundary markers injected every 5 minutes
   - Grouped git operations
   - Deferred updates when possible

## Customization

### Commit Format Examples

**Conventional**:
```
feat(auth): Add JWT token validation
fix(api): Resolve timeout in user endpoint
docs: Update README with new examples
```

**Linear Style** (auto-generates ticket numbers):
```
ENG-A3F: Implement user authentication
PROD-B7C: Fix production deployment script
DOCS-9E2: Update API documentation
```

**Emoji Style**:
```
✨ Add user authentication
🐛 Fix timeout in API endpoint
📝 Update documentation
```

### Adjusting Relevance Weights

Edit `~/.claude/intent-config.json`:
```json
{
  "relevance_weights": {
    "task_delegation": 10,  // Subagent work is most important
    "user_prompt": 9,       // User requests are critical
    "git_command": 8,       // Git operations are important
    "file_operation": 7,    // File changes matter
    "todo_management": 7,   // Task tracking is relevant
    "summary": 6,           // Summaries provide context
    "error": 3,             // Errors are less relevant
    "acknowledgment": 1     // Skip most acknowledgments
  }
}
```

### Custom Bloat Thresholds

For smaller, more frequent commits:
```json
{
  "bloat_thresholds": {
    "files": 5,        // Warn at 5 files
    "additions": 100,  // Warn at 100 lines
    "deletions": 50,   // Warn at 50 deletions
    "categories": 2    // Warn if touching 2+ areas
  }
}
```

For larger, feature-based commits:
```json
{
  "bloat_thresholds": {
    "files": 20,
    "additions": 500,
    "deletions": 300,
    "categories": 5
  }
}
```

## Troubleshooting

### Debug Mode
Enable debug logging:
```bash
export CLAUDE_DEBUG=true
claude
# Check ~/.claude/debug.log
```

### Common Issues

**Status line not updating**:
```bash
# Test manually
echo '{"model":{"display_name":"Test"}}' | ~/.claude/statusline-adaptive.py

# Check permissions
ls -la ~/.claude/statusline-*.sh
chmod +x ~/.claude/statusline-*.py
```

**Hooks not firing**:
```bash
# In Claude Code
/hooks

# Check debug output
claude --debug 2>&1 | grep hook
```

**Performance issues**:
```bash
# Check cache performance
export CLAUDE_DEBUG=true
# Look for ⚡ indicator in status line

# Clear caches if needed
rm -rf ~/.claude/cache/*
rm .git/CLAUDE_INTENT_CACHE
```

### Manual Testing

Test adaptive caching:
```bash
# Monitor cache performance
while true; do
  time echo '{"model":{"display_name":"Test"}}' | ~/.claude/statusline-adaptive.py
  sleep 1
done
```

Test git operation speed:
```bash
# Time different git commands
time git symbolic-ref --short HEAD
time git diff --numstat HEAD
time git diff --name-status HEAD
```

## Best Practices

### 1. Start Simple
Begin with the minimal variant and add features as needed.

### 2. Monitor Cache Performance
In debug mode, the status line shows cache TTL:
```
[Opus] 🌿 main | 📝 3 +45/-12 | ⚡5.2s
```

### 3. Adjust for Your Repository
Small repos can use aggressive caching:
```json
{
  "statusline_cache": {
    "min_ttl": 2,
    "max_ttl": 5
  }
}
```

Large repos need conservative caching:
```json
{
  "statusline_cache": {
    "min_ttl": 10,
    "max_ttl": 30
  }
}
```

### 4. Clean Up Regularly
```bash
# Clean git cache files older than 7 days
find .git -name "CLAUDE_*" -mtime +7 -delete

# Clean session logs older than 30 days
find .claude -name "*.log" -mtime +30 -delete
```

### 5. Team Conventions
Share your configuration:
```bash
# Export settings
cp ~/.claude/intent-config.json ./team-intent-config.json
git add team-intent-config.json
git commit -m "chore: Share team commit conventions"
```

## Advanced Features

### Multi-Repository Support
The system automatically handles multiple repositories by using project-specific cache files in `.git/`.

### Parallel Session Support
Each Claude Code session gets a unique ID:
```python
session_id = hashlib.md5(transcript_path.encode()).hexdigest()[:8]
intent_file = f".git/CLAUDE_INTENT_{session_id}"
```

### Confidence Scoring
The system provides confidence scores (0-100) based on:
- Context availability (30 points)
- File scope (25 points)
- Directory focus (20 points)
- Change cohesion (25 points)

Icons indicate confidence:
- ✅ High confidence (80-100)
- ⚠️ Medium confidence (50-79)
- ❓ Low confidence (0-49)

### Intent History
View your commit message history:
```bash
cat .git/CLAUDE_INTENT_HISTORY | jq '.[].intent'
```

### Session Metrics
The session log tracks:
- Total messages exchanged
- Files modified
- Lines added/removed
- Time spent
- Subagents used
- Web searches performed

## Integration with Git Hooks

Optional: Connect to git's prepare-commit-msg:
```bash
cat > .git/hooks/prepare-commit-msg << 'EOF'
#!/bin/bash
# Use Claude's intent if available
if [ -f .git/CLAUDE_INTENT ] && [ "$2" != "commit" ]; then
    cat .git/CLAUDE_INTENT > "$1"
fi
EOF
chmod +x .git/hooks/prepare-commit-msg
```

## Uninstallation

Remove all components:
```bash
# Remove hooks
rm -f ~/.claude/hooks/intelligent-intent-tracker.py
rm -f ~/.claude/hooks/bloat-detector.py

# Remove status lines
rm -f ~/.claude/statusline-*.sh
rm -f ~/.claude/statusline-*.py

# Remove commands
rm -f ~/.claude/commands/commit.md
rm -f ~/.claude/commands/qc.md
rm -f ~/.claude/commands/git-status.md

# Remove config
rm -f ~/.claude/intent-config.json

# Remove cache
rm -rf ~/.claude/cache

# Clean git directory
rm -f .git/CLAUDE_*
rm -f .claude/SESSION_LOG.md
```

## Contributing

To share improvements:
1. Test thoroughly in your environment
2. Document any new configuration options
3. Include examples of the feature in action
4. Consider backward compatibility

## License

This system is provided as-is for the Claude Code community. Use at your own risk, especially any auto-commit features.

---

*Created by the Claude Code community*
*Version: 2.1.0*
*Last updated: 2024*

**Note**: The adaptive caching system automatically adjusts to your repository's performance characteristics, providing an optimal balance between responsiveness and efficiency.