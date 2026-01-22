#!/bin/bash
# CCC Hook System Installer
# Modular installer for Claude Code Commit Intelligence system variants.
# Prevents duplicate executions and provides clear variant selection.

set -euo pipefail

# Configuration
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CONFIG_FILE="$CLAUDE_DIR/intent-config.json"
INSTALL_LOG="$CLAUDE_DIR/install.log"

# Ensure proper logging
exec 1> >(tee -a "$INSTALL_LOG")
exec 2> >(tee -a "$INSTALL_LOG" >&2)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Script directory (where the hook variants are located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Variant definitions with detailed information
# Format: key:value where value is pipe-separated fields
VARIANT_DATA="
original:track-intent.py|Advanced AI Integration|Intelligent context extraction, Claude CLI integration, smart fallback|Standard workflow with AI|Moderate (API calls)|Claude CLI required
minimal:variant-minimal.py|Pure Git Statistics|Git-only analysis, pattern-based messages, zero dependencies|Maximum performance, no external deps|Fastest (<50ms)|None
"

# Planned variants (coming soon)
PLANNED_VARIANT_DATA="
adaptive:variant-adaptive.py|Performance Optimized|Adaptive caching, performance monitoring, intelligent TTL|Large repos, varying performance|Optimized (adjusts to repo)|Claude CLI optional
bloat-detector:variant-bloat-detector.py|Commit Size Enforcement|Configurable thresholds, visual warnings, size analysis|Teams needing size limits|Fast with minimal overhead|None
session-logger:variant-session-logger.py|Comprehensive Tracking|Markdown logs, metrics tracking, audit trails|Detailed documentation needs|Moderate (additional I/O)|Claude CLI optional
multi-format:variant-multi-format.py|Multiple Message Formats|Auto-detects format, conventional/linear/emoji|Teams with different conventions|Moderate|Claude CLI required
"

# Dispatcher script content for preventing duplicates
read -r -d '' DISPATCHER_SCRIPT << 'EOF' || true
#!/usr/bin/env python3
"""
CCC Hook Dispatcher - Prevents duplicate hook executions
Coordinates multiple hook variants with lock file management.
"""

import json
import sys
import os
import subprocess
import psutil
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any

LOCK_FILE = ".git/CLAUDE_HOOK_LOCK"
CONFIG_FILE = ".git/CLAUDE_HOOK_CONFIG"
MAX_LOCK_AGE_SECONDS = 300  # 5 minutes

def get_project_root() -> Path:
    """Find git project root."""
    cwd = Path(os.getcwd())
    for parent in [cwd] + list(cwd.parents):
        if (parent / ".git").exists():
            return parent
    return cwd

def is_process_running(pid: int) -> bool:
    """Check if process is still running."""
    try:
        return psutil.pid_exists(pid)
    except:
        return False

def acquire_lock(variant_name: str, hook_event: str) -> bool:
    """Acquire execution lock to prevent duplicates."""
    project_root = get_project_root()
    lock_file = project_root / LOCK_FILE
    
    if lock_file.exists():
        try:
            lock_data = json.loads(lock_file.read_text())
            lock_age = time.time() - lock_data.get('timestamp', 0)
            
            # Check if lock is recent and process is running
            if (lock_age < MAX_LOCK_AGE_SECONDS and 
                is_process_running(lock_data.get('pid', 0))):
                return False  # Another hook is running
        except:
            pass  # Stale or invalid lock file
    
    # Acquire lock
    lock_data = {
        'variant': variant_name,
        'hook_event': hook_event,
        'pid': os.getpid(),
        'timestamp': time.time(),
        'iso_time': datetime.now().isoformat()
    }
    
    try:
        lock_file.write_text(json.dumps(lock_data, indent=2))
        return True
    except:
        return False

def release_lock():
    """Release execution lock."""
    project_root = get_project_root()
    lock_file = project_root / LOCK_FILE
    try:
        lock_file.unlink(missing_ok=True)
    except:
        pass

def get_active_variants() -> Dict[str, Any]:
    """Get configured hook variants."""
    project_root = get_project_root()
    config_file = project_root / CONFIG_FILE
    
    if config_file.exists():
        try:
            return json.loads(config_file.read_text())
        except:
            pass
    
    return {"variants": [], "priority": "original"}

def execute_hook(variant_script: str, input_data: Dict[str, Any]) -> bool:
    """Execute specific hook variant."""
    try:
        # Check if script exists
        if not Path(variant_script).exists():
            return False
        
        # Execute with input data
        process = subprocess.run(
            [variant_script],
            input=json.dumps(input_data),
            text=True,
            capture_output=True,
            timeout=30
        )
        
        return process.returncode == 0
    except:
        return False

def main():
    """Main dispatcher logic."""
    try:
        input_data = json.load(sys.stdin)
        hook_event = input_data.get("hook_event_name", "")
        
        # Get active variants
        config = get_active_variants()
        variants = config.get("variants", [])
        
        if not variants:
            sys.exit(0)  # No variants configured
        
        # Find the first variant to execute (priority-based)
        variant_to_run = None
        for variant in variants:
            if variant.get("enabled", True):
                # Check if this variant handles this hook event
                supported_events = variant.get("events", ["Stop", "SubagentStop"])
                if hook_event in supported_events:
                    variant_to_run = variant
                    break
        
        if not variant_to_run:
            sys.exit(0)  # No suitable variant found
        
        variant_name = variant_to_run["name"]
        variant_script = variant_to_run["script"]
        
        # Acquire lock
        if not acquire_lock(variant_name, hook_event):
            sys.exit(0)  # Another hook is running
        
        try:
            # Execute the variant
            success = execute_hook(variant_script, input_data)
            
            # Log execution for debugging
            if os.environ.get('CLAUDE_DEBUG', '').lower() == 'true':
                project_root = get_project_root()
                debug_log = project_root / ".git" / "dispatcher_debug.log"
                with open(debug_log, 'a') as f:
                    f.write(f"{datetime.now()}: Executed {variant_name} for {hook_event}, success: {success}\n")
        
        finally:
            release_lock()
        
        sys.exit(0)
        
    except Exception as e:
        release_lock()
        # Log error
        error_log = Path.home() / ".claude" / "dispatcher-errors.log"
        error_log.parent.mkdir(exist_ok=True)
        with open(error_log, 'a') as f:
            f.write(f"{datetime.now()}: Dispatcher error: {str(e)}\n")
        sys.exit(0)

if __name__ == "__main__":
    main()
EOF

# Function to print colored output
print_color() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

print_header() {
    echo
    print_color "$CYAN" "════════════════════════════════════════════════════════════════"
    print_color "$CYAN" "  $1"
    print_color "$CYAN" "════════════════════════════════════════════════════════════════"
    echo
}

get_variant_info() {
    local variant_key=$1
    local data_source=$2  # "available" or "planned"
    
    if [[ "$data_source" == "available" ]]; then
        echo "$VARIANT_DATA" | grep "^$variant_key:" | cut -d: -f2-
    else
        echo "$PLANNED_VARIANT_DATA" | grep "^$variant_key:" | cut -d: -f2-
    fi
}

get_all_variants() {
    local data_source=$1
    if [[ "$data_source" == "available" ]]; then
        echo "$VARIANT_DATA" | grep -v '^$' | cut -d: -f1
    else
        echo "$PLANNED_VARIANT_DATA" | grep -v '^$' | cut -d: -f1
    fi
}

print_variant_info() {
    local variant_key=$1
    local variant_info=$2
    
    IFS='|' read -r filename title features use_case performance deps <<< "$variant_info"
    
    print_color "$BOLD" "📦 $title ($variant_key)"
    print_color "$GREEN" "   File: $filename"
    print_color "$YELLOW" "   Use Case: $use_case"
    print_color "$BLUE" "   Performance: $performance"
    print_color "$PURPLE" "   Dependencies: $deps"
    print_color "$NC" "   Features: $features"
    echo
}

show_help() {
    cat << EOF
CCC Hook System Installer

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --variant <name>        Install specific variant (original, minimal, adaptive, etc.)
    --all                   Install all available variants
    --list                  List all available variants with details
    --interactive          Run interactive installation (default)
    --non-interactive      Install with defaults, no prompts
    --config <file>        Use custom configuration file
    --remove               Remove all CCC hooks
    --status               Show current installation status
    --help                 Show this help message

EXAMPLES:
    $0                              # Interactive installation
    $0 --variant minimal            # Install minimal variant only
    $0 --all                        # Install all variants
    $0 --list                       # Show available variants
    $0 --status                     # Check current setup

VARIANTS:
EOF

    while IFS= read -r variant_key; do
        [[ -n "$variant_key" ]] || continue
        local variant_info
        variant_info=$(get_variant_info "$variant_key" "available")
        print_variant_info "$variant_key" "$variant_info"
    done <<< "$(get_all_variants "available")"
    
    local planned_count
    planned_count=$(get_all_variants "planned" | grep -c . || echo 0)
    if [[ $planned_count -gt 0 ]]; then
        print_color "$YELLOW" "PLANNED VARIANTS (coming soon):"
        while IFS= read -r variant_key; do
            [[ -n "$variant_key" ]] || continue
            local variant_info
            variant_info=$(get_variant_info "$variant_key" "planned")
            print_variant_info "$variant_key" "$variant_info"
        done <<< "$(get_all_variants "planned")"
    fi
}

check_dependencies() {
    print_color "$BLUE" "🔍 Checking dependencies..."
    
    # Check Python 3
    if ! command -v python3 &> /dev/null; then
        print_color "$RED" "❌ Python 3 is required but not installed"
        exit 1
    fi
    
    # Check if we can install psutil for dispatcher
    if ! python3 -c "import psutil" 2>/dev/null; then
        print_color "$YELLOW" "⚠️  psutil not available - installing for hook dispatcher"
        if command -v pip3 &> /dev/null; then
            pip3 install psutil --user || {
                print_color "$YELLOW" "⚠️  Could not install psutil. Dispatcher will use basic process checking."
            }
        fi
    fi
    
    # Check Claude CLI (optional)
    if command -v claude &> /dev/null; then
        print_color "$GREEN" "✅ Claude CLI found - AI variants will work"
    else
        print_color "$YELLOW" "⚠️  Claude CLI not found - only minimal variant will work fully"
    fi
    
    print_color "$GREEN" "✅ Basic dependencies satisfied"
}

setup_directories() {
    print_color "$BLUE" "📁 Setting up directories..."
    
    mkdir -p "$CLAUDE_DIR"
    mkdir -p "$HOOKS_DIR"
    
    # Create hooks directory if it doesn't exist
    if [[ ! -d "$HOOKS_DIR" ]]; then
        mkdir -p "$HOOKS_DIR"
    fi
    
    print_color "$GREEN" "✅ Directories ready"
}

backup_existing_config() {
    if [[ -f "$SETTINGS_FILE" ]]; then
        local backup_file="${SETTINGS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$SETTINGS_FILE" "$backup_file"
        print_color "$YELLOW" "📋 Backed up existing settings to: $backup_file"
    fi
}

create_dispatcher() {
    local dispatcher_path="$HOOKS_DIR/ccc-dispatcher.py"
    
    print_color "$BLUE" "🔧 Creating hook dispatcher..."
    
    echo "$DISPATCHER_SCRIPT" > "$dispatcher_path"
    chmod +x "$dispatcher_path"
    
    print_color "$GREEN" "✅ Dispatcher created at: $dispatcher_path"
}

install_variant() {
    local variant_key=$1
    local variant_info
    variant_info=$(get_variant_info "$variant_key" "available")
    
    if [[ -z "$variant_info" ]]; then
        print_color "$RED" "❌ Unknown variant: $variant_key"
        return 1
    fi
    
    IFS='|' read -r filename title features use_case performance deps <<< "$variant_info"
    
    print_color "$BLUE" "📦 Installing $title..."
    
    # Check if source file exists
    local source_file="$SCRIPT_DIR/$filename"
    if [[ ! -f "$source_file" ]]; then
        print_color "$RED" "❌ Source file not found: $source_file"
        return 1
    fi
    
    # Copy to hooks directory
    local dest_file="$HOOKS_DIR/$filename"
    cp "$source_file" "$dest_file"
    chmod +x "$dest_file"
    
    print_color "$GREEN" "✅ Installed $title to: $dest_file"
}

create_hook_config() {
    local variants=("$@")
    
    print_color "$BLUE" "⚙️  Creating hook configuration..."
    
    local config_json='{"variants": ['
    local first=true
    
    for variant_key in "${variants[@]}"; do
        local variant_info
        variant_info=$(get_variant_info "$variant_key" "available")
        if [[ -n "$variant_info" ]]; then
            IFS='|' read -r filename title features use_case performance deps <<< "$variant_info"
            
            if [[ "$first" == true ]]; then
                first=false
            else
                config_json+=","
            fi
            
            config_json+='{
                "name": "'$variant_key'",
                "title": "'$title'",
                "script": "'$HOOKS_DIR/$filename'",
                "enabled": true,
                "events": ["Stop", "SubagentStop"],
                "priority": 10
            }'
        fi
    done
    
    config_json+='],
    "dispatcher": "'$HOOKS_DIR/ccc-dispatcher.py'",
    "installed_at": "'$(date -Iseconds)'",
    "version": "2.0.0"
}'
    
    echo "$config_json" | python3 -m json.tool > "$CONFIG_FILE"
    print_color "$GREEN" "✅ Hook configuration created"
}

update_claude_settings() {
    print_color "$BLUE" "⚙️  Updating Claude Code settings..."
    
    local dispatcher_path="$HOOKS_DIR/ccc-dispatcher.py"
    
    # Create or update settings.json
    if [[ -f "$SETTINGS_FILE" ]]; then
        # Merge with existing settings
        local temp_file=$(mktemp)
        python3 << EOF > "$temp_file"
import json
import sys

settings_file = "$SETTINGS_FILE"
dispatcher_path = "$dispatcher_path"

try:
    with open(settings_file, 'r') as f:
        settings = json.load(f)
except:
    settings = {}

# Ensure hooks section exists
if 'hooks' not in settings:
    settings['hooks'] = {}

# Update Stop and SubagentStop hooks to use dispatcher
settings['hooks']['Stop'] = [{
    "type": "command",
    "command": dispatcher_path
}]

settings['hooks']['SubagentStop'] = [{
    "type": "command", 
    "command": dispatcher_path
}]

# Add metadata
if 'ccc' not in settings:
    settings['ccc'] = {}

settings['ccc']['version'] = '2.0.0'
settings['ccc']['installer'] = 'modular'
settings['ccc']['updated'] = '$(date -Iseconds)'

print(json.dumps(settings, indent=2))
EOF
        mv "$temp_file" "$SETTINGS_FILE"
    else
        # Create new settings file
        cat > "$SETTINGS_FILE" << EOF
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "$dispatcher_path"
      }
    ],
    "SubagentStop": [
      {
        "type": "command",
        "command": "$dispatcher_path"
      }
    ]
  },
  "ccc": {
    "version": "2.0.0",
    "installer": "modular",
    "updated": "$(date -Iseconds)"
  }
}
EOF
    fi
    
    print_color "$GREEN" "✅ Claude Code settings updated"
}

interactive_installation() {
    print_header "Interactive CCC Hook Installation"
    
    echo "This installer will set up the Claude Code Commit Intelligence system."
    echo "You can select one or more variants based on your needs."
    echo
    
    print_color "$CYAN" "Available variants:"
    echo
    
    # Show available variants
    while IFS= read -r variant_key; do
        [[ -n "$variant_key" ]] || continue
        local variant_info
        variant_info=$(get_variant_info "$variant_key" "available")
        print_variant_info "$variant_key" "$variant_info"
    done <<< "$(get_all_variants "available" | sort)"
    
    # Performance vs Features explanation
    print_color "$BOLD" "Architecture Overview:"
    print_color "$CYAN" "• Hooks inject boundary markers during Claude Code sessions"
    print_color "$CYAN" "• CCC CLI reads these boundaries when pruning sessions"
    print_color "$CYAN" "• The two systems work together for intelligent session management"
    echo
    print_color "$BOLD" "Performance vs Features Trade-offs:"
    print_color "$YELLOW" "• Original: Moderate speed (100-300ms), full AI integration, rich context (RECOMMENDED)"
    print_color "$GREEN" "• Minimal: Fastest startup (<50ms), no AI, pattern-based messages"
    echo
    
    # Get user selection
    echo "Which variants would you like to install?"
    echo "Enter variant names separated by spaces (e.g., 'minimal original'):"
    echo "Or press Enter for recommended setup (original with AI integration)"
    read -r -p "> " selection
    
    # Parse selection
    local selected_variants=()
    if [[ -z "$selection" ]]; then
        selected_variants=("original")
        print_color "$BLUE" "Using recommended setup: original variant (track-intent.py)"
    else
        for variant in $selection; do
            local variant_info
            variant_info=$(get_variant_info "$variant" "available")
            if [[ -n "$variant_info" ]]; then
                selected_variants+=("$variant")
            else
                print_color "$YELLOW" "⚠️  Unknown variant '$variant' - skipping"
            fi
        done
    fi
    
    if [[ ${#selected_variants[@]} -eq 0 ]]; then
        print_color "$RED" "❌ No valid variants selected"
        exit 1
    fi
    
    # Confirm installation
    echo
    print_color "$BLUE" "Selected variants: ${selected_variants[*]}"
    read -r -p "Continue with installation? (y/N): " confirm
    
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_color "$YELLOW" "Installation cancelled"
        exit 0
    fi
    
    # Proceed with installation
    perform_installation "${selected_variants[@]}"
}

perform_installation() {
    local variants=("$@")
    
    print_header "Installing CCC Hook System"
    
    check_dependencies
    setup_directories
    backup_existing_config
    
    # Install each variant
    for variant in "${variants[@]}"; do
        install_variant "$variant"
    done
    
    # Create dispatcher and configuration
    create_dispatcher
    create_hook_config "${variants[@]}"
    update_claude_settings
    
    print_header "Installation Complete!"
    
    print_color "$GREEN" "✅ CCC Hook System successfully installed"
    print_color "$BLUE" "📂 Installation directory: $HOOKS_DIR"
    print_color "$BLUE" "⚙️  Configuration: $CONFIG_FILE"
    print_color "$BLUE" "🔧 Claude settings: $SETTINGS_FILE"
    echo
    
    print_color "$CYAN" "Next steps:"
    print_color "$NC" "1. Start a new Claude Code session"
    print_color "$NC" "2. Make some changes to your project"
    print_color "$NC" "3. Check .git/CLAUDE_INTENT for generated commit messages"
    echo
    
    print_color "$YELLOW" "Debug mode: export CLAUDE_DEBUG=true"
    print_color "$YELLOW" "Check installation: $0 --status"
}

show_status() {
    print_header "CCC Hook System Status"
    
    # Check if installed
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print_color "$RED" "❌ CCC hooks not installed"
        echo "Run: $0 to install"
        exit 1
    fi
    
    # Show configuration
    print_color "$GREEN" "✅ CCC hooks installed"
    echo
    
    if [[ -f "$CONFIG_FILE" ]]; then
        print_color "$BLUE" "📋 Installed variants:"
        python3 << EOF
import json
try:
    with open("$CONFIG_FILE", 'r') as f:
        config = json.load(f)
    
    for variant in config.get('variants', []):
        status = "✅" if variant.get('enabled', True) else "❌"
        print(f"   {status} {variant['name']}: {variant['title']}")
        print(f"      Script: {variant['script']}")
        print(f"      Events: {', '.join(variant.get('events', []))}")
        print()
    
    print(f"Dispatcher: {config.get('dispatcher', 'Not configured')}")
    print(f"Version: {config.get('version', 'Unknown')}")
    print(f"Installed: {config.get('installed_at', 'Unknown')}")
    
except Exception as e:
    print(f"Error reading config: {e}")
EOF
    fi
    
    # Check Claude settings
    if [[ -f "$SETTINGS_FILE" ]]; then
        print_color "$BLUE" "⚙️  Claude Code settings:"
        python3 << EOF
import json
try:
    with open("$SETTINGS_FILE", 'r') as f:
        settings = json.load(f)
    
    hooks = settings.get('hooks', {})
    if 'Stop' in hooks:
        print("   ✅ Stop hook configured")
    else:
        print("   ❌ Stop hook not configured")
    
    if 'SubagentStop' in hooks:
        print("   ✅ SubagentStop hook configured")
    else:
        print("   ❌ SubagentStop hook not configured")
    
    ccc_info = settings.get('ccc', {})
    if ccc_info:
        print(f"   Version: {ccc_info.get('version', 'Unknown')}")
        print(f"   Updated: {ccc_info.get('updated', 'Unknown')}")
    
except Exception as e:
    print(f"Error reading settings: {e}")
EOF
    else
        print_color "$YELLOW" "⚠️  Claude settings file not found"
    fi
}

remove_installation() {
    print_header "Removing CCC Hook System"
    
    read -r -p "Are you sure you want to remove all CCC hooks? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_color "$YELLOW" "Removal cancelled"
        exit 0
    fi
    
    # Remove hook files
    if [[ -d "$HOOKS_DIR" ]]; then
        find "$HOOKS_DIR" -name "track-intent.py" -delete 2>/dev/null || true
        find "$HOOKS_DIR" -name "variant-*.py" -delete 2>/dev/null || true
        find "$HOOKS_DIR" -name "ccc-dispatcher.py" -delete 2>/dev/null || true
    fi
    
    # Remove configuration
    [[ -f "$CONFIG_FILE" ]] && rm -f "$CONFIG_FILE"
    
    # Update Claude settings
    if [[ -f "$SETTINGS_FILE" ]]; then
        backup_existing_config
        python3 << EOF
import json
try:
    with open("$SETTINGS_FILE", 'r') as f:
        settings = json.load(f)
    
    # Remove hook configurations
    if 'hooks' in settings:
        settings['hooks'].pop('Stop', None)
        settings['hooks'].pop('SubagentStop', None)
    
    # Remove CCC metadata
    settings.pop('ccc', None)
    
    with open("$SETTINGS_FILE", 'w') as f:
        json.dump(settings, f, indent=2)
    
    print("Settings updated")
except Exception as e:
    print(f"Error updating settings: {e}")
EOF
    fi
    
    print_color "$GREEN" "✅ CCC hooks removed"
}

list_variants() {
    print_header "Available CCC Hook Variants"
    
    print_color "$BOLD" "AVAILABLE NOW:"
    while IFS= read -r variant_key; do
        [[ -n "$variant_key" ]] || continue
        local variant_info
        variant_info=$(get_variant_info "$variant_key" "available")
        print_variant_info "$variant_key" "$variant_info"
    done <<< "$(get_all_variants "available")"
    
    local planned_count
    planned_count=$(get_all_variants "planned" | grep -c .)
    if [[ $planned_count -gt 0 ]]; then
        print_color "$BOLD" "COMING SOON:"
        while IFS= read -r variant_key; do
            [[ -n "$variant_key" ]] || continue
            local variant_info
            variant_info=$(get_variant_info "$variant_key" "planned")
            print_variant_info "$variant_key" "$variant_info"
        done <<< "$(get_all_variants "planned")"
    fi
}

# Main script logic
main() {
    # Log start
    echo "$(date -Iseconds): CCC Installer started with args: $*" >> "$INSTALL_LOG"
    
    case "${1:-}" in
        --help|-h)
            show_help
            ;;
        --list)
            list_variants
            ;;
        --status)
            show_status
            ;;
        --remove)
            remove_installation
            ;;
        --variant)
            if [[ -z "${2:-}" ]]; then
                print_color "$RED" "❌ Variant name required"
                exit 1
            fi
            perform_installation "$2"
            ;;
        --all)
            local all_variants
            all_variants=$(get_all_variants "available")
            # Convert to array
            local all_variants_array=()
            while IFS= read -r variant; do
                [[ -n "$variant" ]] && all_variants_array+=("$variant")
            done <<< "$all_variants"
            perform_installation "${all_variants_array[@]}"
            ;;
        --non-interactive)
            perform_installation "original"  # Default to original for non-interactive
            ;;
        --interactive|"")
            interactive_installation
            ;;
        *)
            print_color "$RED" "❌ Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
}

# Ensure cleanup on exit
trap 'echo "$(date -Iseconds): CCC Installer finished" >> "$INSTALL_LOG"' EXIT

# Run main function
main "$@"