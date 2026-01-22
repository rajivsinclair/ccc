#!/bin/bash
# Claude Code Hook: Auto-prune sessions at natural boundaries
# This hook is triggered after certain Claude Code events

# Configuration
PRUNE_AFTER_COMMIT=true      # Prune after git commits
PRUNE_AFTER_PR=true          # Prune after PR creation
PRUNE_ON_CONTEXT_HIGH=true   # Prune when context usage is high
CONTEXT_THRESHOLD=70          # Context usage percentage threshold

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if we're in a Claude Code session
is_claude_session() {
    [ -n "$CLAUDE_SESSION_ID" ] || [ -f ".claude/session.json" ]
}

# Function to get current session ID
get_session_id() {
    if [ -n "$CLAUDE_SESSION_ID" ]; then
        echo "$CLAUDE_SESSION_ID"
    elif [ -f ".claude/session.json" ]; then
        # Extract session ID from local session file if it exists
        grep -o '"sessionId"[[:space:]]*:[[:space:]]*"[^"]*"' .claude/session.json | cut -d'"' -f4
    else
        # Try to find most recent session
        ccc --help >/dev/null 2>&1 && echo "$(ccc 2>/dev/null | grep -o 'Using most recent session: .*' | cut -d' ' -f5)"
    fi
}

# Function to check context usage (placeholder - would need actual implementation)
get_context_usage() {
    # This would need to parse the session file or use Claude Code API
    # For now, return a mock value
    echo "65"
}

# Function to create a boundary marker in the session
create_boundary_marker() {
    local intent="$1"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
    
    # This would append a boundary marker to the current session
    # Format: ===INTENT_BOUNDARY=== timestamp | intent
    echo -e "${BLUE}📍 Creating boundary marker: $intent${NC}"
}

# Main hook logic
main() {
    # Check if we're in a Claude Code session
    if ! is_claude_session; then
        exit 0  # Not in a Claude session, nothing to do
    fi
    
    local session_id=$(get_session_id)
    if [ -z "$session_id" ]; then
        echo -e "${YELLOW}⚠️  Could not determine session ID${NC}"
        exit 0
    fi
    
    local should_prune=false
    local prune_reason=""
    
    # Check different triggers
    case "$1" in
        "post-commit")
            if [ "$PRUNE_AFTER_COMMIT" = true ]; then
                should_prune=true
                prune_reason="Git commit completed"
                create_boundary_marker "Git commit: $(git log -1 --pretty=%B | head -1)"
            fi
            ;;
            
        "post-pr")
            if [ "$PRUNE_AFTER_PR" = true ]; then
                should_prune=true
                prune_reason="Pull request created"
                create_boundary_marker "PR created"
            fi
            ;;
            
        "context-check")
            local usage=$(get_context_usage)
            if [ "$PRUNE_ON_CONTEXT_HIGH" = true ] && [ "$usage" -ge "$CONTEXT_THRESHOLD" ]; then
                should_prune=true
                prune_reason="Context usage high ($usage%)"
            fi
            ;;
            
        "manual")
            should_prune=true
            prune_reason="Manual trigger"
            ;;
            
        *)
            # Unknown trigger, do nothing
            exit 0
            ;;
    esac
    
    # Execute pruning if needed
    if [ "$should_prune" = true ]; then
        echo -e "${BLUE}🔄 Auto-pruning session: $prune_reason${NC}"
        
        # Run ccc in automatic mode (boundary detection)
        if command -v ccc >/dev/null 2>&1; then
            # Use ccc without sessionId to auto-detect most recent
            # This will show the interactive boundary selection
            ccc
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Session pruned successfully${NC}"
            else
                echo -e "${RED}❌ Pruning failed or was cancelled${NC}"
            fi
        else
            echo -e "${RED}❌ ccc command not found. Install with: npm link in ccc directory${NC}"
        fi
    fi
}

# Handle script arguments
main "$@"