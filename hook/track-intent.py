#!/usr/bin/env python3
"""
Claude Intent Tracker Hook - Advanced Version
Intelligently analyzes transcript and git changes to generate meaningful commit intent messages.
Uses smart boundary detection, content filtering, and marker injection for optimal performance.
"""

import json
import sys
import os
import subprocess
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
import re
from typing import Dict, List, Optional, Tuple, Any


# Configuration
INTENT_FILE = ".git/CLAUDE_INTENT"
INTENT_CACHE_FILE = ".git/CLAUDE_INTENT_CACHE"
BOUNDARY_MARKER_FILE = ".git/CLAUDE_LAST_BOUNDARY"
HAIKU_MODEL = "claude-3-5-haiku-latest"

# Smart limits
MAX_LOOKBACK_ENTRIES = 500  # Absolute maximum to scan
TARGET_CONTEXT_TOKENS = 2000  # Target ~2K tokens
MAX_CONTEXT_TOKENS = 3000  # Hard limit ~3K tokens
CACHE_DURATION_SECONDS = 30  # Rate limiting
BOUNDARY_MARKER = "===INTENT_BOUNDARY==="

# Content relevance scores
RELEVANCE_SCORES = {
    'user_prompt': 10,
    'task_delegation': 10,  # Sub-agent work is critical
    'git_command': 9,
    'file_operation': 8,
    'todo_management': 8,  # Task planning is important
    'summary': 7,
    'decision': 6,
    'error': 3,
    'tool_result': 2,
    'acknowledgment': 1,
    'verbose_output': 0
}

def get_project_root() -> Path:
    """Find the git project root from current directory."""
    cwd = Path(os.getcwd())
    for parent in [cwd] + list(cwd.parents):
        if (parent / ".git").exists():
            return parent
    return cwd

def find_last_boundary_marker(lines: List[str]) -> Optional[int]:
    """Find the most recent boundary marker in transcript."""
    for i, line in enumerate(reversed(lines)):
        try:
            data = json.loads(line.strip())
            
            # Handle new format with nested message
            if 'message' in data and isinstance(data['message'], dict):
                message = data['message']
                if message.get('role') == 'assistant':
                    content = message.get('content', [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                if BOUNDARY_MARKER in item.get('text', ''):
                                    return len(lines) - i - 1
            
            # Legacy format compatibility
            elif data.get('type') == 'assistant':
                content = data.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            if BOUNDARY_MARKER in item.get('text', ''):
                                return len(lines) - i - 1
        except:
            continue
    return None

def find_git_commit_boundary(lines: List[str]) -> Optional[int]:
    """Find the most recent successful git commit in transcript."""
    commit_command_idx = None
    
    for i, line in enumerate(reversed(lines)):
        try:
            data = json.loads(line.strip())
            
            # Handle new format with nested message
            message = data.get('message', data)  # Fallback to data for legacy
            
            # Look for git commit command execution
            if message.get('role') == 'assistant' or data.get('type') == 'assistant':
                content = message.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if item.get('type') == 'tool_use' and item.get('name') == 'Bash':
                            command = item.get('input', {}).get('command', '')
                            if 'git commit' in command and '-m' in command:
                                commit_command_idx = len(lines) - i - 1
                                # Look ahead for the result
                                if i > 0:  # Check next entry for success
                                    next_idx = len(lines) - i
                                    if next_idx < len(lines):
                                        try:
                                            next_data = json.loads(lines[next_idx].strip())
                                            next_message = next_data.get('message', next_data)
                                            if (next_message.get('role') == 'user' and 
                                                any('tool_result' in str(content) for content in next_message.get('content', []))):
                                                # This is a tool result, check if commit succeeded
                                                result_content = next_message.get('content', [])
                                                if isinstance(result_content, list):
                                                    for result_item in result_content:
                                                        if isinstance(result_item, dict) and result_item.get('type') == 'tool_result':
                                                            result_text = str(result_item.get('content', ''))
                                                            if '[' in result_text and ']' in result_text:
                                                                # Looks like a successful commit
                                                                return commit_command_idx
                                        except:
                                            pass
        except:
            continue
    
    return None

def find_session_boundary(lines: List[str]) -> Optional[int]:
    """Find session start or clear command in transcript."""
    for i, line in enumerate(reversed(lines)):
        try:
            data = json.loads(line.strip())
            
            # Handle new format with nested message
            message = data.get('message', data)  # Fallback to data for legacy
            
            # Look for session start indicators
            if message.get('role') == 'user' or data.get('type') == 'human':
                content = message.get('content', data.get('content', ''))
                if isinstance(content, list) and content:
                    # Check first content item
                    first_item = content[0]
                    if isinstance(first_item, dict):
                        text = first_item.get('text', '')
                    else:
                        text = str(first_item)
                    
                    if text.strip() in ['/clear', '/start', '/reset']:
                        return len(lines) - i - 1
        except:
            continue
    return None

def find_natural_boundary(lines: List[str]) -> Tuple[int, str]:
    """Find the most appropriate boundary point in the transcript."""
    # Priority order for boundaries
    
    # 1. Check for our own boundary marker
    marker_idx = find_last_boundary_marker(lines)
    if marker_idx is not None:
        return marker_idx, "boundary_marker"
    
    # 2. Check for successful git commit
    commit_idx = find_git_commit_boundary(lines)
    if commit_idx is not None:
        return commit_idx, "git_commit"
    
    # 3. Check for session boundaries
    session_idx = find_session_boundary(lines)
    if session_idx is not None:
        return session_idx, "session_start"
    
    # 4. Fallback to last 150 entries (increased for better context)
    return max(0, len(lines) - 150), "fallback_last_150"

def classify_content(data: Dict[str, Any]) -> Tuple[str, Dict[str, Any], int]:
    """Classify and extract relevant content from a transcript entry."""
    # Handle new transcript format where message is nested
    if 'message' in data and isinstance(data['message'], dict):
        message = data['message']
        entry_type = message.get('role', '')
        
        # Map new format to old format
        if entry_type == 'user':
            entry_type = 'human'
        elif entry_type == 'assistant':
            entry_type = 'assistant'
    else:
        # Old format compatibility
        entry_type = data.get('type', '')
        message = data
    
    if entry_type == 'human':
        # User prompts are high value
        content = message.get('content', '')
        if isinstance(content, list) and content:
            text = content[0].get('text', '') if isinstance(content[0], dict) else str(content[0])
            # Truncate very long prompts but keep the essence
            if len(text) > 200:
                text = text[:197] + "..."
            return 'user_prompt', {'text': text}, RELEVANCE_SCORES['user_prompt']
    
    elif entry_type == 'assistant':
        content = message.get('content', [])
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    # Tool use - extract key information
                    if item.get('type') == 'tool_use':
                        tool_name = item.get('name', '')
                        input_data = item.get('input', {})
                        
                        # Task delegation - MOST IMPORTANT
                        if tool_name == 'Task':
                            subagent = input_data.get('subagent_type', 'unknown')
                            description = input_data.get('description', '')
                            prompt = input_data.get('prompt', '')[:200]  # First 200 chars
                            return 'task_delegation', {
                                'subagent': subagent,
                                'description': description,
                                'prompt': prompt
                            }, RELEVANCE_SCORES['task_delegation']
                        
                        # File operations - just paths, not content
                        elif tool_name in ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']:
                            file_path = input_data.get('file_path', '') or input_data.get('notebook_path', '')
                            if file_path:
                                return 'file_operation', {
                                    'action': tool_name.lower(),
                                    'file': file_path
                                }, RELEVANCE_SCORES['file_operation']
                        
                        # Todo management
                        elif tool_name == 'TodoWrite':
                            todos = input_data.get('todos', [])
                            todo_count = len(todos)
                            return 'todo_management', {
                                'action': 'todo_update',
                                'count': todo_count
                            }, RELEVANCE_SCORES['todo_management']
                        
                        # Git commands
                        elif tool_name == 'Bash':
                            command = input_data.get('command', '')
                            if 'git' in command:
                                # Sanitize command (remove sensitive data)
                                clean_cmd = re.sub(r'-m\s+"[^"]*"', '-m "[message]"', command)
                                return 'git_command', {'command': clean_cmd[:100]}, RELEVANCE_SCORES['git_command']
                        
                        # Skip verbose tools
                        elif tool_name in ['Read', 'Grep', 'WebFetch', 'WebSearch']:
                            # These often have verbose output we don't need
                            return 'verbose_output', {}, RELEVANCE_SCORES['verbose_output']
                    
                    # Text responses - look for key information
                    elif item.get('type') == 'text':
                        text = item.get('text', '')
                        
                        # Skip acknowledgments
                        if len(text) < 50 and any(word in text.lower() for word in ['sure', 'ok', 'will', 'let me']):
                            return 'acknowledgment', {}, RELEVANCE_SCORES['acknowledgment']
                        
                        # Extract decisions and summaries
                        if any(keyword in text.lower() for keyword in ['decided', 'conclusion', 'summary', 'completed', 'finished', 'implemented']):
                            # Extract first sentence or 150 chars
                            summary = text.split('.')[0] if '.' in text else text[:150]
                            return 'summary', {'text': summary}, RELEVANCE_SCORES['summary']
    
    elif entry_type == 'tool_result' or 'toolResult' in data:
        # Handle tool results (might be in data directly for new format)
        tool_result = data.get('toolResult') if 'toolResult' in data else message
        content = tool_result.get('content', '') if tool_result else ''
        if isinstance(content, list) and content:
            result_text = str(content[0])
            if 'error' in result_text.lower() or 'failed' in result_text.lower():
                # Keep first line of error
                error_line = result_text.split('\n')[0][:100]
                return 'error', {'message': error_line}, RELEVANCE_SCORES['error']
    
    return 'other', {}, 0

def extract_intelligent_context(lines: List[str], start_idx: int) -> List[Dict[str, Any]]:
    """Extract and prioritize relevant context from transcript."""
    context_items = []
    seen_files = set()
    seen_prompts = set()
    total_tokens = 0
    
    # Process from boundary forward
    for line in lines[start_idx:]:
        try:
            data = json.loads(line.strip())
            content_type, extracted, relevance = classify_content(data)
            
            # Skip irrelevant content
            if relevance < 2:
                continue
            
            # Deduplicate
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
            
            # Estimate tokens (more accurate: 1 token ≈ 3.5 chars for JSON)
            # JSON has more punctuation, so slightly fewer chars per token
            item_tokens = int(len(json.dumps(extracted)) / 3.5)
            
            # Stop if we're approaching token limit
            if total_tokens + item_tokens > TARGET_CONTEXT_TOKENS:
                # But include if it's high priority and we're under hard limit
                if relevance >= 8 and total_tokens + item_tokens <= MAX_CONTEXT_TOKENS:
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
            continue
    
    # Sort by relevance if we have too much content
    if total_tokens > TARGET_CONTEXT_TOKENS:
        context_items.sort(key=lambda x: x['relevance'], reverse=True)
        # Trim to target
        trimmed_items = []
        current_tokens = 0
        for item in context_items:
            item_tokens = int(len(json.dumps(item['data'])) / 3.5)
            if current_tokens + item_tokens <= TARGET_CONTEXT_TOKENS:
                trimmed_items.append(item)
                current_tokens += item_tokens
        context_items = trimmed_items
    
    return context_items

def get_git_changes_summary() -> Dict[str, Any]:
    """Get a comprehensive summary of git changes."""
    try:
        # Get concise file change summary
        name_status = subprocess.run(
            ["git", "diff", "--name-status", "HEAD"],
            capture_output=True,
            text=True
        )
        
        # Get overall statistics
        shortstat = subprocess.run(
            ["git", "diff", "--shortstat", "HEAD"],
            capture_output=True,
            text=True
        )
        
        # Parse changes by type
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
        
        # Group by directory for pattern detection
        directories = {}
        for files_list in changes.values():
            for file in files_list:
                dir_name = os.path.dirname(file) or 'root'
                directories[dir_name] = directories.get(dir_name, 0) + 1
        
        # Find primary directory
        primary_dir = max(directories.items(), key=lambda x: x[1])[0] if directories else None
        
        return {
            'changes': changes,
            'stats': shortstat.stdout.strip() if shortstat.stdout else "",
            'primary_directory': primary_dir,
            'total_files': sum(len(v) for v in changes.values())
        }
    except:
        return {'changes': {}, 'stats': '', 'primary_directory': None, 'total_files': 0}

def build_optimized_prompt(context_items: List[Dict], git_summary: Dict) -> str:
    """Build an optimized prompt for Claude with structured context."""
    sections = []
    
    # Group context by type
    user_prompts = [item['data']['text'] for item in context_items if item['type'] == 'user_prompt']
    task_delegations = [item['data'] for item in context_items if item['type'] == 'task_delegation']
    file_ops = [item['data'] for item in context_items if item['type'] == 'file_operation']
    todo_updates = [item['data'] for item in context_items if item['type'] == 'todo_management']
    summaries = [item['data']['text'] for item in context_items if item['type'] == 'summary']
    git_commands = [item['data']['command'] for item in context_items if item['type'] == 'git_command']
    errors = [item['data']['message'] for item in context_items if item['type'] == 'error']
    
    # Build structured context
    if user_prompts:
        # Deduplicate and prioritize recent
        unique_prompts = list(dict.fromkeys(user_prompts))[-3:]
        sections.append("User requests:\n" + "\n".join(f"- {p}" for p in unique_prompts))
    
    # Task delegations are critical context
    if task_delegations:
        task_summary = []
        for task in task_delegations[:3]:  # First 3 tasks
            task_summary.append(f"- {task['subagent']}: {task['description']}")
        sections.append("Sub-agent tasks:\n" + "\n".join(task_summary))
    
    # Git changes are most important for commit messages
    if git_summary['total_files'] > 0:
        change_summary = []
        if git_summary['changes']['added']:
            change_summary.append(f"Added: {', '.join(git_summary['changes']['added'][:5])}")
        if git_summary['changes']['modified']:
            change_summary.append(f"Modified: {', '.join(git_summary['changes']['modified'][:5])}")
        if git_summary['changes']['deleted']:
            change_summary.append(f"Deleted: {', '.join(git_summary['changes']['deleted'][:5])}")
        
        sections.append("Git changes:\n" + "\n".join(change_summary))
        if git_summary['stats']:
            sections.append(f"Statistics: {git_summary['stats']}")
    
    # Todo management
    if todo_updates:
        total_todos = sum(update.get('count', 0) for update in todo_updates)
        sections.append(f"Task management: {total_todos} todos tracked")
    
    # File operations for context
    if file_ops:
        # Group by action
        by_action = {}
        for op in file_ops:
            action = op.get('action', 'unknown')
            by_action.setdefault(action, []).append(op.get('file', ''))
        
        ops_summary = []
        for action, files in by_action.items():
            unique_files = list(dict.fromkeys(files))[:5]
            ops_summary.append(f"{action.capitalize()}: {', '.join(unique_files)}")
        
        sections.append("File operations:\n" + "\n".join(ops_summary))
    
    # Work summaries
    if summaries:
        unique_summaries = list(dict.fromkeys(summaries))[:2]
        sections.append("Work completed:\n" + "\n".join(f"- {s}" for s in unique_summaries))
    
    # Errors if any
    if errors:
        sections.append("Issues encountered:\n" + "\n".join(f"- {e}" for e in errors[:2]))
    
    context = "\n\n".join(sections)
    
    # Build the prompt
    prompt = f"""Analyze this git repository work session and generate a commit message.

CONTEXT:
{context}

INSTRUCTIONS:
1. Generate a conventional commit message (type: description)
2. Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build
3. Focus on the primary change if multiple exist
4. Be specific about WHAT changed and WHY
5. Maximum 72 characters
6. Use present tense

Output ONLY the commit message, nothing else."""

    return prompt

def call_claude_cli(prompt: str, timeout_seconds: int = 300) -> str:
    """Call the correct Claude CLI binary with generous timeout."""
    try:
        # Try multiple possible Claude CLI locations in priority order
        possible_paths = [
            # Claude Code native binary locations
            Path.home() / ".claude" / "local" / "claude",  # Claude Code default
            Path.home() / ".claude" / "bin" / "claude",  # Alternative Claude Code location
            
            # npm global installations (user-specific)
            Path.home() / ".npm-global" / "bin" / "claude",  # Recommended npm global
            Path.home() / ".npm" / "bin" / "claude",  # Alternative npm location
            Path.home() / "node_modules" / ".bin" / "claude",  # Local npm
            
            # yarn/pnpm global installations
            Path.home() / ".yarn" / "bin" / "claude",  # Yarn global
            Path.home() / ".local" / "share" / "pnpm" / "claude",  # pnpm global
            
            # System-wide installations
            Path("/usr/local/bin/claude"),  # Common system install
            Path("/usr/bin/claude"),  # System package manager
            
            # Homebrew installations
            Path("/opt/homebrew/bin/claude"),  # Homebrew on Apple Silicon
            Path("/usr/local/Cellar/node") / "*" / "bin" / "claude",  # Homebrew node
            
            # Windows WSL paths
            Path("/mnt/c/Program Files/nodejs/claude"),  # Windows via WSL
            Path.home() / "AppData" / "Roaming" / "npm" / "claude",  # Windows npm
        ]
        
        # Find the first valid Claude binary
        claude_path = None
        for path in possible_paths:
            # Handle glob patterns (for version-specific paths)
            if "*" in str(path):
                import glob
                matches = glob.glob(str(path))
                if matches and Path(matches[0]).exists():
                    claude_path = Path(matches[0])
                    break
            elif path.exists() and path.is_file():
                claude_path = path
                break
        
        # If not found in known locations, try system PATH
        if not claude_path:
            claude_path = "claude"  # Fallback to PATH lookup
        
        result = subprocess.run(
            [str(claude_path), "-p", prompt, "--model", HAIKU_MODEL],
            capture_output=True,
            text=True,
            timeout=timeout_seconds  # Very generous timeout
        )
        
        if result.returncode == 0 and result.stdout:
            message = result.stdout.strip()
            # Clean up the response - it might have extra text
            lines = message.split('\n')
            # Take the first line that looks like a commit message
            for line in lines:
                line = line.strip()
                if line and ':' in line and len(line) < 100:
                    return line
            # If no proper format found, return first line
            if lines and lines[0]:
                return lines[0][:72]
        
    except subprocess.TimeoutExpired:
        # If 300s timeout fails, try once more with 600s
        if timeout_seconds == 300:
            return call_claude_cli(prompt, timeout_seconds=600)
    except Exception:
        pass  # Fail silently and fall back to smart generation
    
    return None

def generate_smart_fallback(prompt: str) -> str:
    """Generate a commit message based on context without LLM."""
    # Parse the prompt to extract key information
    lines = prompt.split('\n')
    
    # Look for file changes
    added_files = []
    modified_files = []
    deleted_files = []
    
    for line in lines:
        if 'Added:' in line:
            added_files = [f.strip() for f in line.split('Added:')[1].split(',')]
        elif 'Modified:' in line:
            modified_files = [f.strip() for f in line.split('Modified:')[1].split(',')]
        elif 'Deleted:' in line:
            deleted_files = [f.strip() for f in line.split('Deleted:')[1].split(',')]
    
    # Determine the primary action
    if added_files and any('test' in f.lower() for f in added_files):
        return "test: Add test files for intent tracking system"
    elif added_files and any('intent' in f.lower() for f in added_files):
        return "feat: Add intent tracking documentation"
    elif modified_files and any('hook' in f.lower() for f in modified_files):
        return "fix: Update intent tracking hook for better extraction"
    elif added_files and any('.md' in f for f in added_files):
        return f"docs: Add {added_files[0].split('/')[-1].replace('.md', '')} documentation"
    elif modified_files and any('.md' in f for f in modified_files):
        return "docs: Update project documentation"
    elif added_files:
        filename = added_files[0].split('/')[-1]
        return f"feat: Add {filename}"
    elif modified_files:
        filename = modified_files[0].split('/')[-1]
        return f"fix: Update {filename}"
    elif deleted_files:
        return "chore: Remove unnecessary files"
    
    # Default fallback
    return "chore: Update project files"

def call_claude_for_intent(prompt: str) -> str:
    """Generate a commit message using Claude CLI or smart fallback."""
    
    # Try Claude CLI first
    claude_message = call_claude_cli(prompt)
    if claude_message:
        return claude_message
    
    # Fallback to smart generation
    return generate_smart_fallback(prompt)

def should_update_intent(project_root: Path, context_hash: str) -> bool:
    """Check if we should update intent (rate limiting + deduplication)."""
    cache_file = project_root / INTENT_CACHE_FILE
    
    if cache_file.exists():
        try:
            cache_data = json.loads(cache_file.read_text())
            last_update = cache_data.get('last_update', 0)
            last_hash = cache_data.get('context_hash', '')
            current_time = datetime.now().timestamp()
            
            # Skip if same context
            if last_hash == context_hash:
                return False
            
            # Rate limit
            if current_time - last_update < CACHE_DURATION_SECONDS:
                return False
        except:
            pass
    
    return True

def update_intent_cache(project_root: Path, context_hash: str):
    """Update cache with hash for deduplication."""
    cache_file = project_root / INTENT_CACHE_FILE
    cache_data = {
        'last_update': datetime.now().timestamp(),
        'context_hash': context_hash
    }
    cache_file.write_text(json.dumps(cache_data))

def inject_boundary_marker(intent: str = None):
    """Output a boundary marker that will appear in the transcript."""
    # This will be captured in the transcript for future boundary detection
    if intent:
        print(f"{BOUNDARY_MARKER} {datetime.now().isoformat()} | {intent}")
    else:
        print(f"{BOUNDARY_MARKER} {datetime.now().isoformat()}")
    sys.stdout.flush()

def main():
    """Main hook handler."""
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
        
        # Read transcript
        with open(transcript_path, 'r') as f:
            lines = f.readlines()
        
        if len(lines) < 5:  # Too short to analyze
            sys.exit(0)
        
        # Find the best boundary point
        boundary_idx, boundary_type = find_natural_boundary(lines)
        
        # Extract intelligent context from boundary forward
        context_items = extract_intelligent_context(lines, boundary_idx)
        
        # Get git changes
        git_summary = get_git_changes_summary()
        
        # Skip if no changes and no meaningful context
        if git_summary['total_files'] == 0 and len(context_items) < 2:
            sys.exit(0)
        
        # Build optimized prompt
        prompt = build_optimized_prompt(context_items, git_summary)
        
        # Generate hash for deduplication
        context_hash = hashlib.md5(prompt.encode()).hexdigest()
        
        # Check if we should update
        if not should_update_intent(project_root, context_hash):
            sys.exit(0)
        
        # Call Claude for intent
        intent = call_claude_for_intent(prompt)
        
        # Write intent
        intent_file = project_root / INTENT_FILE
        intent_file.write_text(intent)
        
        # Update cache
        update_intent_cache(project_root, context_hash)
        
        # Inject boundary marker for next time with the generated intent
        inject_boundary_marker(intent)
        
        # Log boundary detection for debugging
        debug_log = project_root / ".git" / "intent_debug.log"
        with open(debug_log, 'a') as f:
            f.write(f"{datetime.now()}: Boundary type: {boundary_type}, Index: {boundary_idx}/{len(lines)}, Context items: {len(context_items)}, Git files: {git_summary['total_files']}, Intent: {intent}\n")
        
        sys.exit(0)
        
    except Exception as e:
        error_log = Path.home() / ".claude" / "hook-errors.log"
        error_log.parent.mkdir(exist_ok=True)
        with open(error_log, 'a') as f:
            f.write(f"{datetime.now()}: Advanced intent tracker error: {str(e)}\n")
        sys.exit(0)

if __name__ == "__main__":
    main()