#!/usr/bin/env python3
"""
Minimal Intent Tracker - No LLM Version
Generates commit messages based purely on git statistics and file patterns.
Zero external dependencies, maximum performance.
"""

import json
import sys
import os
import subprocess
import hashlib
from pathlib import Path
from datetime import datetime
import re
from typing import Dict, List, Optional, Tuple, Any

# Configuration
INTENT_FILE = ".git/CLAUDE_INTENT"
INTENT_CACHE_FILE = ".git/CLAUDE_INTENT_CACHE_MINIMAL"
CACHE_DURATION_SECONDS = 10  # Shorter cache for minimal version

def get_project_root() -> Path:
    """Find the git project root from current directory."""
    cwd = Path(os.getcwd())
    for parent in [cwd] + list(cwd.parents):
        if (parent / ".git").exists():
            return parent
    return cwd

def get_git_changes() -> Dict[str, Any]:
    """Get detailed git changes with pattern analysis."""
    try:
        # Get file changes
        name_status = subprocess.run(
            ["git", "diff", "--name-status", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        # Get statistics
        shortstat = subprocess.run(
            ["git", "diff", "--shortstat", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        # Parse changes
        changes = {'added': [], 'modified': [], 'deleted': []}
        if name_status.stdout:
            for line in name_status.stdout.strip().split('\n'):
                if not line:
                    continue
                parts = line.split('\t')
                if len(parts) == 2:
                    status, file = parts
                    if status == 'A':
                        changes['added'].append(file)
                    elif status == 'M':
                        changes['modified'].append(file)
                    elif status == 'D':
                        changes['deleted'].append(file)
        
        # Analyze patterns
        file_types = {}
        directories = {}
        
        for file_list in changes.values():
            for file in file_list:
                # File type analysis
                ext = Path(file).suffix.lower()
                file_types[ext] = file_types.get(ext, 0) + 1
                
                # Directory analysis
                dir_name = os.path.dirname(file) or 'root'
                directories[dir_name] = directories.get(dir_name, 0) + 1
        
        # Find primary patterns
        primary_ext = max(file_types.items(), key=lambda x: x[1])[0] if file_types else None
        primary_dir = max(directories.items(), key=lambda x: x[1])[0] if directories else None
        
        # Parse statistics
        stats = {'additions': 0, 'deletions': 0}
        if shortstat.stdout:
            # Extract numbers from format: "3 files changed, 45 insertions(+), 12 deletions(-)"
            additions_match = re.search(r'(\d+) insertion', shortstat.stdout)
            deletions_match = re.search(r'(\d+) deletion', shortstat.stdout)
            if additions_match:
                stats['additions'] = int(additions_match.group(1))
            if deletions_match:
                stats['deletions'] = int(deletions_match.group(1))
        
        return {
            'changes': changes,
            'stats': stats,
            'primary_extension': primary_ext,
            'primary_directory': primary_dir,
            'total_files': sum(len(v) for v in changes.values()),
            'file_types': file_types,
            'directories': directories
        }
    except subprocess.TimeoutExpired:
        return {
            'changes': {'added': [], 'modified': [], 'deleted': []},
            'stats': {'additions': 0, 'deletions': 0},
            'total_files': 0
        }
    except Exception:
        return {
            'changes': {'added': [], 'modified': [], 'deleted': []},
            'stats': {'additions': 0, 'deletions': 0},
            'total_files': 0
        }

def detect_change_type(git_data: Dict[str, Any]) -> str:
    """Detect the type of change based on patterns."""
    changes = git_data['changes']
    primary_ext = git_data.get('primary_extension', '')
    primary_dir = git_data.get('primary_directory', '')
    
    # Test files
    if any('test' in f.lower() or 'spec' in f.lower() 
           for f in changes['added'] + changes['modified']):
        return 'test'
    
    # Documentation
    if primary_ext in ['.md', '.rst', '.txt'] or 'docs' in primary_dir.lower():
        return 'docs'
    
    # Configuration
    if primary_ext in ['.json', '.yml', '.yaml', '.toml', '.ini', '.cfg']:
        return 'chore'
    
    # CI/CD
    if any('.github' in f or '.gitlab' in f or 'ci' in f.lower() 
           for f in changes['added'] + changes['modified']):
        return 'ci'
    
    # Build files
    if any(f in ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml']
           for files in changes.values() for f in files):
        return 'build'
    
    # Style files
    if primary_ext in ['.css', '.scss', '.sass', '.less']:
        return 'style'
    
    # Performance optimization (heuristic based on deletions > additions)
    if git_data['stats']['deletions'] > git_data['stats']['additions'] * 1.5:
        return 'perf'
    
    # Refactoring (significant changes with similar line count)
    stats = git_data['stats']
    if stats['additions'] > 50 and abs(stats['additions'] - stats['deletions']) < 20:
        return 'refactor'
    
    # Bug fix (small targeted changes)
    if git_data['total_files'] <= 3 and stats['additions'] < 50:
        return 'fix'
    
    # New feature (default for additions)
    if changes['added']:
        return 'feat'
    
    # Default to chore for modifications
    return 'chore'

def extract_component_name(files: List[str]) -> Optional[str]:
    """Extract a meaningful component/module name from file list."""
    if not files:
        return None
    
    # Try to find common patterns
    for file in files[:3]:  # Check first 3 files
        path = Path(file)
        
        # Remove extension and common suffixes
        name = path.stem
        name = re.sub(r'[_\-\.]?(test|spec|impl|controller|service|component|module)$', '', name, flags=re.IGNORECASE)
        
        if name and name not in ['index', 'main', 'app', 'init']:
            return name
    
    # Fall back to directory name
    if files:
        dir_name = os.path.dirname(files[0])
        if dir_name and dir_name != '.':
            return os.path.basename(dir_name)
    
    return None

def generate_minimal_intent(git_data: Dict[str, Any]) -> str:
    """Generate commit message based on git data patterns only."""
    if git_data['total_files'] == 0:
        return "chore: Update project files"
    
    change_type = detect_change_type(git_data)
    changes = git_data['changes']
    
    # Build description based on change patterns
    descriptions = []
    
    # Handle file operations
    if changes['added']:
        component = extract_component_name(changes['added'])
        if component:
            if change_type == 'test':
                descriptions.append(f"Add tests for {component}")
            elif change_type == 'docs':
                descriptions.append(f"Add {component} documentation")
            else:
                descriptions.append(f"Add {component}")
        else:
            count = len(changes['added'])
            descriptions.append(f"Add {count} new file{'s' if count > 1 else ''}")
    
    if changes['modified']:
        component = extract_component_name(changes['modified'])
        if component:
            if change_type == 'fix':
                descriptions.append(f"Fix {component}")
            elif change_type == 'perf':
                descriptions.append(f"Optimize {component} performance")
            elif change_type == 'refactor':
                descriptions.append(f"Refactor {component}")
            else:
                descriptions.append(f"Update {component}")
        elif not descriptions:  # Only if we haven't added anything yet
            count = len(changes['modified'])
            descriptions.append(f"Update {count} file{'s' if count > 1 else ''}")
    
    if changes['deleted'] and not descriptions:
        component = extract_component_name(changes['deleted'])
        if component:
            descriptions.append(f"Remove {component}")
        else:
            count = len(changes['deleted'])
            descriptions.append(f"Remove {count} file{'s' if count > 1 else ''}")
    
    # Build final message
    if descriptions:
        description = descriptions[0]
        # Ensure it fits in 72 chars with type prefix
        max_desc_len = 72 - len(change_type) - 2  # Account for "type: "
        if len(description) > max_desc_len:
            description = description[:max_desc_len-3] + "..."
        
        return f"{change_type}: {description}"
    
    return f"{change_type}: Update project files"

def should_update_intent(project_root: Path, git_hash: str) -> bool:
    """Check if we should update intent based on cache."""
    cache_file = project_root / INTENT_CACHE_FILE
    
    if cache_file.exists():
        try:
            cache_data = json.loads(cache_file.read_text())
            last_hash = cache_data.get('git_hash', '')
            last_update = cache_data.get('last_update', 0)
            current_time = datetime.now().timestamp()
            
            # Skip if same changes
            if last_hash == git_hash:
                return False
            
            # Rate limit
            if current_time - last_update < CACHE_DURATION_SECONDS:
                return False
        except:
            pass
    
    return True

def update_cache(project_root: Path, git_hash: str):
    """Update cache with current git state."""
    cache_file = project_root / INTENT_CACHE_FILE
    cache_data = {
        'last_update': datetime.now().timestamp(),
        'git_hash': git_hash
    }
    cache_file.write_text(json.dumps(cache_data))

def main():
    """Main handler for minimal intent tracking."""
    try:
        input_data = json.load(sys.stdin)
        hook_event = input_data.get("hook_event_name", "")
        
        # Support multiple hook events
        if hook_event not in ["Stop", "SubagentStop", "PostToolUse"]:
            sys.exit(0)
        
        project_root = get_project_root()
        git_dir = project_root / ".git"
        
        if not git_dir.exists():
            sys.exit(0)
        
        # Get git changes
        git_data = get_git_changes()
        
        # Skip if no changes
        if git_data['total_files'] == 0:
            sys.exit(0)
        
        # Generate hash of current state
        git_hash = hashlib.md5(
            json.dumps(git_data, sort_keys=True).encode()
        ).hexdigest()
        
        # Check cache
        if not should_update_intent(project_root, git_hash):
            sys.exit(0)
        
        # Generate intent
        intent = generate_minimal_intent(git_data)
        
        # Write intent
        intent_file = project_root / INTENT_FILE
        intent_file.write_text(intent)
        
        # Update cache
        update_cache(project_root, git_hash)
        
        # Optional: Log for debugging (minimal logging)
        if os.environ.get('CLAUDE_DEBUG', '').lower() == 'true':
            debug_log = project_root / ".git" / "minimal_debug.log"
            with open(debug_log, 'a') as f:
                f.write(f"{datetime.now()}: Files: {git_data['total_files']}, Intent: {intent}\n")
        
        sys.exit(0)
        
    except Exception as e:
        # Silent failure - this is a minimal version
        if os.environ.get('CLAUDE_DEBUG', '').lower() == 'true':
            error_log = Path.home() / ".claude" / "minimal-errors.log"
            error_log.parent.mkdir(exist_ok=True)
            with open(error_log, 'a') as f:
                f.write(f"{datetime.now()}: {str(e)}\n")
        sys.exit(0)

if __name__ == "__main__":
    main()