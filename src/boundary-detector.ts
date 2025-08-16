export interface Boundary {
  lineNumber: number;
  type: 'intent' | 'git_commit';
  description: string;
  timestamp?: string;
  retentionPercentage: number;
  characterCount: number;
  intent?: string;
}

export interface BoundaryAnalysis {
  boundaries: Boundary[];
  totalCharacters: number;
}

/**
 * Detects boundaries in a Claude Code session file.
 * Returns boundaries sorted by line number (newest first).
 */
export function detectBoundaries(lines: string[]): BoundaryAnalysis {
  const boundaries: Boundary[] = [];
  const totalCharacters = lines.join('\n').length;
  
  // Track line positions for character count calculation
  let currentPosition = 0;
  const linePositions: number[] = [];
  
  lines.forEach((line, index) => {
    linePositions.push(currentPosition);
    currentPosition += line.length + 1; // +1 for newline
  });

  // Detect ===INTENT_BOUNDARY=== markers
  lines.forEach((line, index) => {
    if (line.includes('===INTENT_BOUNDARY===')) {
      const charactersFromStart = linePositions[index];
      const retentionPercentage = Math.round(((totalCharacters - charactersFromStart) / totalCharacters) * 100);
      
      // Extract intent from boundary marker if present
      // Format: ===INTENT_BOUNDARY=== 2024-01-15T10:30:00 | feat: Add feature
      let description = 'Boundary marker';
      let intent: string | undefined;
      let timestamp: string | undefined;
      
      const boundaryMatch = line.match(/===INTENT_BOUNDARY=== ([^|]+)(?:\s*\|\s*(.+))?/);
      if (boundaryMatch) {
        timestamp = boundaryMatch[1].trim();
        if (boundaryMatch[2]) {
          intent = boundaryMatch[2].trim();
          description = intent; // Use intent as description
        }
      }
      
      boundaries.push({
        lineNumber: index,
        type: 'intent',
        description,
        timestamp,
        retentionPercentage,
        characterCount: totalCharacters - charactersFromStart,
        intent
      });
    }
  });

  // Detect git commit boundaries - only look at successful tool results
  lines.forEach((line, index) => {
    try {
      const obj = JSON.parse(line);
      
      // Check for successful git commit tool results
      if (obj.type === 'tool_result' && obj.tool_name === 'bash' && obj.content) {
        const content = obj.content;
        
        // Look for git commit success patterns
        if (content.includes('files changed') || content.includes('insertions') || content.includes('deletions')) {
          // Try to find the corresponding tool call to get commit message
          let commitMessage = 'Successful commit';
          
          // Look backwards for the corresponding git commit command
          for (let i = index - 1; i >= 0; i--) {
            try {
              const prevObj = JSON.parse(lines[i]);
              if (prevObj.type === 'tool_call' && prevObj.tool_name === 'bash') {
                const command = prevObj.parameters?.command || '';
                const gitCommitMatch = command.match(/git commit -m ["']([^"']+)["']/);
                if (gitCommitMatch) {
                  commitMessage = `Git commit: ${gitCommitMatch[1]}`;
                  break;
                }
              }
            } catch {
              // Skip non-JSON lines
            }
          }
          
          const charactersFromStart = linePositions[index];
          const retentionPercentage = Math.round(((totalCharacters - charactersFromStart) / totalCharacters) * 100);
          
          boundaries.push({
            lineNumber: index,
            type: 'git_commit',
            description: commitMessage,
            retentionPercentage,
            characterCount: totalCharacters - charactersFromStart
          });
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  });

  // Sort boundaries by line number (newest first - higher line numbers first)
  boundaries.sort((a, b) => b.lineNumber - a.lineNumber);

  return {
    boundaries,
    totalCharacters
  };
}

/**
 * Extract timestamp from a message line for display
 */
export function extractTimestamp(line: string): string | undefined {
  try {
    const obj = JSON.parse(line);
    if (obj.timestamp) {
      return new Date(obj.timestamp).toLocaleString();
    }
    if (obj.created_at) {
      return new Date(obj.created_at).toLocaleString();
    }
  } catch {
    // Not JSON or no timestamp
  }
  return undefined;
}

/**
 * Prune session lines based on a boundary line number
 */
export function pruneToBoundary(lines: string[], boundaryLineNumber: number): {
  outLines: string[];
  kept: number;
  dropped: number;
} {
  const MSG_TYPES = new Set(["user", "assistant", "system"]);
  const outLines: string[] = [];
  const keptToolUseIds = new Set<string>();
  let kept = 0;
  let dropped = 0;

  // Always include first line (session metadata)
  if (lines.length > 0) {
    outLines.push(lines[0]);
  }

  // First pass: identify kept tool_use_ids from assistant messages that will be kept
  lines.forEach((ln, idx) => {
    if (idx === 0) return;
    if (idx >= boundaryLineNumber) {
      try {
        const obj = JSON.parse(ln);
        if (obj.type === "assistant") {
          // Extract tool_use_ids from content array
          if (Array.isArray(obj.content)) {
            obj.content.forEach((item: any) => {
              if (item.type === "tool_use" && item.id) {
                keptToolUseIds.add(item.id);
              }
            });
          }
        }
      } catch { /* not JSON or no tool uses */ }
    }
  });

  // HACK: Zero out ONLY the last non-zero cache_read_input_tokens to trick UI percentage
  let lastNonZeroCacheLineIndex = -1;
  
  // Find the last non-zero cache line
  lines.forEach((ln, i) => {
    try {
      const obj = JSON.parse(ln);
      const usageObj = obj.usage || obj.message?.usage;
      if (usageObj?.cache_read_input_tokens && usageObj.cache_read_input_tokens > 0) {
        lastNonZeroCacheLineIndex = i;
      }
    } catch { /* not JSON, skip */ }
  });

  // Process lines and zero out only the last non-zero cache line
  const processedLines = lines.map((ln, i) => {
    if (i === lastNonZeroCacheLineIndex) {
      try {
        const obj = JSON.parse(ln);
        const usageObj = obj.usage || obj.message?.usage;
        usageObj.cache_read_input_tokens = 0;
        return JSON.stringify(obj);
      } catch { /* should not happen since we found it in first pass */ }
    }
    return ln;
  });

  // Include lines from boundary forward, filtering orphaned tool_results
  processedLines.forEach((ln, idx) => {
    if (idx === 0) return; // Already added above
    
    if (idx >= boundaryLineNumber) {
      const isMsg = MSG_TYPES.has((() => { 
        try { return JSON.parse(ln).type; } catch { return ""; } 
      })());
      
      if (isMsg) {
        outLines.push(ln);
        kept++;
      } else {
        // Check if this is a tool_result that references a kept tool_use_id
        let shouldKeep = true;
        try {
          const obj = JSON.parse(ln);
          if (obj.type === "tool_result" && obj.tool_use_id) {
            // Only keep if the corresponding tool_use was kept
            shouldKeep = keptToolUseIds.has(obj.tool_use_id);
          }
        } catch {
          // Not JSON or not a tool_result, keep as before
        }
        
        if (shouldKeep) {
          outLines.push(ln);
        }
      }
    } else {
      const isMsg = MSG_TYPES.has((() => { 
        try { return JSON.parse(ln).type; } catch { return ""; } 
      })());
      if (isMsg) {
        dropped++;
      }
    }
  });

  return { outLines, kept, dropped };
}