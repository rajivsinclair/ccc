import { describe, it, expect } from 'vitest';
import { pruneSessionLines, findLatestBackup, detectBoundaries, pruneToBoundary } from './index.js';
import { extractTimestamp } from './boundary-detector.js';

describe('pruneSessionLines', () => {
  const createMessage = (type: string, uuid: string, content: string = "test") => 
    JSON.stringify({ type, uuid, message: { content } });

  const createSummary = (content: string) => 
    JSON.stringify({ type: "user", isCompactSummary: true, message: { content } });

  it('should always preserve the first line', () => {
    const lines = [
      createSummary("Session summary"),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
    ];

    const result = pruneSessionLines(lines, 0);
    
    expect(result.outLines).toHaveLength(1);
    expect(result.outLines[0]).toBe(lines[0]);
  });

  it('should keep messages from last N assistant messages', () => {
    const lines = [
      createSummary("Session summary"),
      createMessage("user", "1"),
      createMessage("assistant", "2"), // assistant 1
      createMessage("user", "3"),
      createMessage("assistant", "4"), // assistant 2 (keep from here)
      createMessage("user", "5"),
      createMessage("assistant", "6"), // assistant 3
    ];

    const result = pruneSessionLines(lines, 2);
    
    expect(result.outLines).toHaveLength(4); // summary + 3 messages from assistant 2 onward
    expect(result.kept).toBe(3);
    expect(result.dropped).toBe(3);
    expect(result.assistantCount).toBe(3);
  });

  it('should keep all messages if assistant count <= keepN', () => {
    const lines = [
      createSummary("Session summary"),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
      createMessage("user", "3"),
      createMessage("assistant", "4"),
    ];

    const result = pruneSessionLines(lines, 5);
    
    expect(result.outLines).toHaveLength(5); // all lines
    expect(result.kept).toBe(4);
    expect(result.dropped).toBe(0);
    expect(result.assistantCount).toBe(2);
  });

  it('should preserve non-message lines (tool results, etc)', () => {
    const lines = [
      createSummary("Session summary"),
      createMessage("user", "1"),
      JSON.stringify({ type: "tool_result", content: "tool output" }),
      createMessage("assistant", "2"),
      "non-json line",
      createMessage("user", "3"),
    ];

    const result = pruneSessionLines(lines, 1);
    
    expect(result.outLines).toHaveLength(6); // summary + tool result + non-json + 2 messages from assistant
    expect(result.kept).toBe(3);
    expect(result.dropped).toBe(0);
    expect(result.assistantCount).toBe(1);
  });

  it('should handle empty lines array', () => {
    const result = pruneSessionLines([], 5);
    
    expect(result.outLines).toHaveLength(0);
    expect(result.kept).toBe(0);
    expect(result.dropped).toBe(0);
    expect(result.assistantCount).toBe(0);
  });

  it('should handle no assistant messages', () => {
    const lines = [
      createSummary("Session summary"),
      createMessage("user", "1"),
      createMessage("user", "2"),
      createMessage("system", "3"),
    ];

    const result = pruneSessionLines(lines, 2);
    
    expect(result.outLines).toHaveLength(4); // all lines since no assistant messages to cut from
    expect(result.kept).toBe(3);
    expect(result.dropped).toBe(0);
    expect(result.assistantCount).toBe(0);
  });

  it('should handle malformed JSON gracefully', () => {
    const lines = [
      createSummary("Session summary"),
      "invalid json",
      createMessage("user", "1"),
      createMessage("assistant", "2"),
      "{ invalid json",
    ];

    const result = pruneSessionLines(lines, 1);
    
    expect(result.outLines).toHaveLength(5); // summary + invalid json + 2 messages + invalid json
    expect(result.kept).toBe(2);
    expect(result.dropped).toBe(0);
    expect(result.assistantCount).toBe(1);
  });

  it('should handle keepN = 0', () => {
    const lines = [
      createSummary("Session summary"),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
      createMessage("user", "3"),
      createMessage("assistant", "4"),
    ];

    const result = pruneSessionLines(lines, 0);
    
    expect(result.outLines).toHaveLength(1); // only summary
    expect(result.kept).toBe(0);
    expect(result.dropped).toBe(4);
    expect(result.assistantCount).toBe(2);
  });

  it('should handle negative keepN', () => {
    const lines = [
      createSummary("Session summary"),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
    ];

    const result = pruneSessionLines(lines, -5);
    
    expect(result.outLines).toHaveLength(1); // only summary
    expect(result.kept).toBe(0);
    expect(result.dropped).toBe(2);
    expect(result.assistantCount).toBe(1);
  });
});

describe('findLatestBackup', () => {
  it('should find the latest backup by timestamp', () => {
    const backupFiles = [
      'abc123.jsonl.1640995200000', // older
      'abc123.jsonl.1641081600000', // newest
      'abc123.jsonl.1640908800000', // oldest
      'def456.jsonl.1641000000000', // different session
    ];

    const result = findLatestBackup(backupFiles, 'abc123');

    expect(result).toEqual({
      name: 'abc123.jsonl.1641081600000',
      timestamp: 1641081600000
    });
  });

  it('should return null when no backups found for session', () => {
    const backupFiles = [
      'def456.jsonl.1640995200000',
      'xyz789.jsonl.1641081600000',
    ];

    const result = findLatestBackup(backupFiles, 'abc123');

    expect(result).toBeNull();
  });

  it('should handle empty backup files array', () => {
    const result = findLatestBackup([], 'abc123');

    expect(result).toBeNull();
  });

  it('should handle single backup file', () => {
    const backupFiles = ['abc123.jsonl.1640995200000'];

    const result = findLatestBackup(backupFiles, 'abc123');

    expect(result).toEqual({
      name: 'abc123.jsonl.1640995200000',
      timestamp: 1640995200000
    });
  });

  it('should filter out files that do not match session pattern', () => {
    const backupFiles = [
      'abc123.jsonl.1640995200000',
      'abc123.txt.1641081600000', // wrong extension
      'abc123.jsonl', // missing timestamp
      'abc123-other.jsonl.1641000000000', // different naming
    ];

    const result = findLatestBackup(backupFiles, 'abc123');

    expect(result).toEqual({
      name: 'abc123.jsonl.1640995200000',
      timestamp: 1640995200000
    });
  });

  it('should handle malformed timestamps gracefully', () => {
    const backupFiles = [
      'abc123.jsonl.invalid',
      'abc123.jsonl.1640995200000',
      'abc123.jsonl.abc',
    ];

    const result = findLatestBackup(backupFiles, 'abc123');

    expect(result).toEqual({
      name: 'abc123.jsonl.1640995200000',
      timestamp: 1640995200000
    });
  });

  it('should sort by timestamp correctly with multiple valid backups', () => {
    const backupFiles = [
      'abc123.jsonl.1000', // smallest
      'abc123.jsonl.3000', // largest
      'abc123.jsonl.2000', // middle
    ];

    const result = findLatestBackup(backupFiles, 'abc123');

    expect(result).toEqual({
      name: 'abc123.jsonl.3000',
      timestamp: 3000
    });
  });
});

describe('detectBoundaries', () => {
  it('should detect intent boundary markers', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      "===INTENT_BOUNDARY===",
      JSON.stringify({ type: "assistant", message: { content: "hi" } }),
    ];

    const result = detectBoundaries(lines);
    
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].type).toBe('intent');
    expect(result.boundaries[0].lineNumber).toBe(2);
    expect(result.boundaries[0].description).toBe('Boundary marker');
    expect(result.boundaries[0].retentionPercentage).toBeGreaterThan(0);
    expect(result.boundaries[0].intent).toBeUndefined();
  });

  it('should extract intent from boundary markers with new format', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      "===INTENT_BOUNDARY=== 2024-01-15T10:30:00 | feat: Add user authentication",
      JSON.stringify({ type: "assistant", message: { content: "hi" } }),
    ];

    const result = detectBoundaries(lines);
    
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].type).toBe('intent');
    expect(result.boundaries[0].lineNumber).toBe(2);
    expect(result.boundaries[0].description).toBe('feat: Add user authentication');
    expect(result.boundaries[0].intent).toBe('feat: Add user authentication');
    expect(result.boundaries[0].timestamp).toBe('2024-01-15T10:30:00');
    expect(result.boundaries[0].retentionPercentage).toBeGreaterThan(0);
  });

  it('should handle boundary markers with timestamp but no intent', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      "===INTENT_BOUNDARY=== 2024-01-15T10:30:00",
      JSON.stringify({ type: "assistant", message: { content: "hi" } }),
    ];

    const result = detectBoundaries(lines);
    
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].type).toBe('intent');
    expect(result.boundaries[0].lineNumber).toBe(2);
    expect(result.boundaries[0].description).toBe('Boundary marker');
    expect(result.boundaries[0].intent).toBeUndefined();
    expect(result.boundaries[0].timestamp).toBe('2024-01-15T10:30:00');
  });

  it('should detect git commit boundaries', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ 
        type: "tool_call", 
        tool_name: "bash", 
        parameters: { command: 'git commit -m "feat: Add new feature"' }
      }),
      JSON.stringify({ 
        type: "tool_result", 
        tool_name: "bash", 
        content: "1 file changed, 5 insertions(+)"
      }),
    ];

    const result = detectBoundaries(lines);
    
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].type).toBe('git_commit');
    expect(result.boundaries[0].description).toBe('Git commit: feat: Add new feature');
  });

  it('should calculate retention percentages correctly', () => {
    const lines = [
      "line1", // 5 chars + 1 newline = 6
      "line2", // 5 chars + 1 newline = 6  
      "===INTENT_BOUNDARY===", // 21 chars + 1 newline = 22
      "line4"  // 5 chars (no newline at end) = 5
    ];
    // Total: 6 + 6 + 22 + 5 = 39 chars
    // From boundary (index 2): 22 + 5 = 27 chars
    // Retention: 27/39 = 69.23% -> rounds to 69%

    const result = detectBoundaries(lines);
    
    expect(result.boundaries[0].retentionPercentage).toBe(69);
    expect(result.totalCharacters).toBe(39);
  });

  it('should sort boundaries by line number (newest first)', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      "===INTENT_BOUNDARY===", // line 1
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      "===INTENT_BOUNDARY===", // line 3 (newer)
      JSON.stringify({ type: "assistant", message: { content: "hi" } }),
    ];

    const result = detectBoundaries(lines);
    
    expect(result.boundaries).toHaveLength(2);
    expect(result.boundaries[0].lineNumber).toBe(3); // newer first
    expect(result.boundaries[1].lineNumber).toBe(1); // older second
  });
});

describe('pruneToBoundary', () => {
  const createMessage = (type: string, uuid: string, content: string = "test") =>
    JSON.stringify({ type, uuid, message: { content } });

  it('should prune to boundary correctly', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
      createMessage("user", "3"),
      createMessage("assistant", "4"),
    ];

    const result = pruneToBoundary(lines, 3);

    expect(result.outLines).toHaveLength(3); // summary + lines 3,4
    expect(result.kept).toBe(2); // 2 messages kept
    expect(result.dropped).toBe(2); // 2 messages dropped
  });

  it('should always preserve first line', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
    ];

    const result = pruneToBoundary(lines, 2);

    expect(result.outLines[0]).toBe(lines[0]);
  });

  it('should filter orphaned tool_results when pruning', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      // Dropped section - assistant with tool_use that will be dropped
      JSON.stringify({
        type: "assistant",
        uuid: "1",
        content: [{ type: "tool_use", id: "tool-old-1" }]
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "tool-old-1", content: "old result" }),
      // Kept section
      JSON.stringify({
        type: "assistant",
        uuid: "2",
        content: [{ type: "tool_use", id: "tool-new-1" }]
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "tool-new-1", content: "new result" }),
    ];

    const result = pruneToBoundary(lines, 3);

    // Should keep: summary, assistant 2, tool_result for tool-new-1
    expect(result.outLines).toHaveLength(3);
    expect(result.outLines.some(l => l.includes('tool-old-1'))).toBe(false);
    expect(result.outLines.some(l => l.includes('tool-new-1'))).toBe(true);
  });

  it('should handle boundary at line 1', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
    ];

    const result = pruneToBoundary(lines, 1);

    expect(result.outLines).toHaveLength(3); // summary + all messages
    expect(result.dropped).toBe(0);
  });

  it('should handle boundary past end of array', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      createMessage("user", "1"),
      createMessage("assistant", "2"),
    ];

    const result = pruneToBoundary(lines, 10);

    expect(result.outLines).toHaveLength(1); // only summary
    expect(result.kept).toBe(0);
    expect(result.dropped).toBe(2);
  });

  it('should zero out cache_read_input_tokens', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", usage: { cache_read_input_tokens: 1000 } }),
      JSON.stringify({ type: "assistant", usage: { cache_read_input_tokens: 2000 } }),
    ];

    const result = pruneToBoundary(lines, 1);

    // Find the line with the assistant message and check cache is zeroed
    const assistantLine = result.outLines.find(l => l.includes('"assistant"'));
    expect(assistantLine).toBeDefined();
    const parsed = JSON.parse(assistantLine!);
    expect(parsed.usage.cache_read_input_tokens).toBe(0);
  });

  it('should preserve non-message lines after boundary', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      createMessage("user", "1"),
      "non-json diagnostic line",
      createMessage("assistant", "2"),
    ];

    const result = pruneToBoundary(lines, 2);

    expect(result.outLines).toContain("non-json diagnostic line");
  });
});

describe('pruneSessionLines - orphaned tool_result handling', () => {
  it('should drop tool_results whose tool_use was pruned', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      // Old assistant with tool_use that will be dropped
      JSON.stringify({
        type: "assistant",
        uuid: "old-assistant",
        content: [{ type: "tool_use", id: "old-tool-id" }]
      }),
      // Orphaned tool_result - should be dropped
      JSON.stringify({ type: "tool_result", tool_use_id: "old-tool-id", content: "old" }),
      // New assistant with tool_use that will be kept
      JSON.stringify({
        type: "assistant",
        uuid: "new-assistant",
        content: [{ type: "tool_use", id: "new-tool-id" }]
      }),
      // Kept tool_result
      JSON.stringify({ type: "tool_result", tool_use_id: "new-tool-id", content: "new" }),
      JSON.stringify({ type: "user", uuid: "final" }),
    ];

    const result = pruneSessionLines(lines, 1);

    // Should NOT contain the old tool_result
    const hasOldToolResult = result.outLines.some(l => l.includes('old-tool-id') && l.includes('tool_result'));
    expect(hasOldToolResult).toBe(false);

    // Should contain the new tool_result
    const hasNewToolResult = result.outLines.some(l => l.includes('new-tool-id'));
    expect(hasNewToolResult).toBe(true);
  });

  it('should keep tool_results with matching tool_use in kept messages', () => {
    const assistantWithTool = JSON.stringify({
      type: "assistant",
      uuid: "1",
      content: [
        { type: "tool_use", id: "tool-123" },
        { type: "tool_use", id: "tool-456" }
      ]
    });
    const toolResult1 = JSON.stringify({ type: "tool_result", tool_use_id: "tool-123", content: "result1" });
    const toolResult2 = JSON.stringify({ type: "tool_result", tool_use_id: "tool-456", content: "result2" });

    const lines = [
      JSON.stringify({ type: "summary" }),
      assistantWithTool,
      toolResult1,
      toolResult2,
      JSON.stringify({ type: "user", uuid: "2" }),
    ];

    const result = pruneSessionLines(lines, 1);

    expect(result.outLines.some(l => l.includes('tool-123'))).toBe(true);
    expect(result.outLines.some(l => l.includes('tool-456'))).toBe(true);
  });
});

describe('pruneSessionLines - cache token hack', () => {
  it('should zero out the last non-zero cache_read_input_tokens', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", uuid: "1", usage: { cache_read_input_tokens: 500 } }),
      JSON.stringify({ type: "assistant", uuid: "2", usage: { cache_read_input_tokens: 1000 } }),
      JSON.stringify({ type: "user", uuid: "3", usage: { cache_read_input_tokens: 1500 } }), // Last non-zero
      JSON.stringify({ type: "assistant", uuid: "4", usage: { cache_read_input_tokens: 0 } }),
    ];

    const result = pruneSessionLines(lines, 10);

    // Line with uuid "3" should have cache_read_input_tokens zeroed
    const lineWith3 = result.outLines.find(l => l.includes('"3"'));
    expect(lineWith3).toBeDefined();
    const parsed = JSON.parse(lineWith3!);
    expect(parsed.usage.cache_read_input_tokens).toBe(0);

    // Other lines should keep their values (except already 0)
    const lineWith1 = result.outLines.find(l => l.includes('"1"'));
    expect(JSON.parse(lineWith1!).usage.cache_read_input_tokens).toBe(500);
  });

  it('should handle nested message.usage structure', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", uuid: "1", message: { usage: { cache_read_input_tokens: 1000 } } }),
    ];

    const result = pruneSessionLines(lines, 10);

    const userLine = result.outLines.find(l => l.includes('"1"'));
    const parsed = JSON.parse(userLine!);
    expect(parsed.message.usage.cache_read_input_tokens).toBe(0);
  });
});

describe('detectBoundaries - additional edge cases', () => {
  it('should return empty boundaries for empty input', () => {
    const result = detectBoundaries([]);

    expect(result.boundaries).toHaveLength(0);
    expect(result.totalCharacters).toBe(0);
  });

  it('should return empty boundaries when no markers found', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      JSON.stringify({ type: "assistant", message: { content: "hi" } }),
    ];

    const result = detectBoundaries(lines);

    expect(result.boundaries).toHaveLength(0);
  });

  it('should handle multiple git commits in sequence', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({
        type: "tool_call",
        tool_name: "bash",
        parameters: { command: 'git commit -m "feat: First commit"' }
      }),
      JSON.stringify({
        type: "tool_result",
        tool_name: "bash",
        content: "1 file changed, 5 insertions(+)"
      }),
      JSON.stringify({
        type: "tool_call",
        tool_name: "bash",
        parameters: { command: 'git commit -m "feat: Second commit"' }
      }),
      JSON.stringify({
        type: "tool_result",
        tool_name: "bash",
        content: "2 files changed, 10 insertions(+)"
      }),
    ];

    const result = detectBoundaries(lines);

    expect(result.boundaries).toHaveLength(2);
    expect(result.boundaries[0].description).toBe('Git commit: feat: Second commit'); // newest first
    expect(result.boundaries[1].description).toBe('Git commit: feat: First commit');
  });

  it('should handle git commit tool_result without matching tool_call', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      // No tool_call for this commit
      JSON.stringify({
        type: "tool_result",
        tool_name: "bash",
        content: "3 files changed, 15 insertions(+), 2 deletions(-)"
      }),
    ];

    const result = detectBoundaries(lines);

    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].description).toBe('Successful commit'); // default description
  });

  it('should detect boundaries with both intent markers and git commits', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      "===INTENT_BOUNDARY=== 2024-01-15T10:00:00 | Start feature",
      JSON.stringify({ type: "user", message: { content: "implement auth" } }),
      JSON.stringify({
        type: "tool_call",
        tool_name: "bash",
        parameters: { command: 'git commit -m "feat: Add auth"' }
      }),
      JSON.stringify({
        type: "tool_result",
        tool_name: "bash",
        content: "1 file changed, 50 insertions(+)"
      }),
      "===INTENT_BOUNDARY=== 2024-01-15T11:00:00 | Continue work",
    ];

    const result = detectBoundaries(lines);

    expect(result.boundaries).toHaveLength(3);
    // Sorted by line number (newest first)
    expect(result.boundaries[0].type).toBe('intent');
    expect(result.boundaries[0].intent).toBe('Continue work');
    expect(result.boundaries[1].type).toBe('git_commit');
    expect(result.boundaries[2].type).toBe('intent');
    expect(result.boundaries[2].intent).toBe('Start feature');
  });

  it('should not detect failed git commits', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({
        type: "tool_call",
        tool_name: "bash",
        parameters: { command: 'git commit -m "feat: Failed commit"' }
      }),
      JSON.stringify({
        type: "tool_result",
        tool_name: "bash",
        content: "nothing to commit, working tree clean"
      }),
    ];

    const result = detectBoundaries(lines);

    expect(result.boundaries).toHaveLength(0);
  });

  it('should handle boundary marker embedded in JSON content', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({
        type: "assistant",
        content: "Look for ===INTENT_BOUNDARY=== markers in the file"
      }),
    ];

    const result = detectBoundaries(lines);

    // Should detect the boundary even though it's inside JSON content
    expect(result.boundaries).toHaveLength(1);
  });
});

describe('extractTimestamp', () => {
  it('should extract timestamp field', () => {
    const line = JSON.stringify({ type: "user", timestamp: "2024-01-15T10:30:00Z" });

    const result = extractTimestamp(line);

    expect(result).toBeDefined();
    expect(result).toContain('2024'); // Contains the year
  });

  it('should extract created_at field', () => {
    const line = JSON.stringify({ type: "user", created_at: "2024-01-15T10:30:00Z" });

    const result = extractTimestamp(line);

    expect(result).toBeDefined();
    expect(result).toContain('2024');
  });

  it('should prefer timestamp over created_at', () => {
    const line = JSON.stringify({
      type: "user",
      timestamp: "2024-01-15T10:30:00Z",
      created_at: "2023-01-01T00:00:00Z"
    });

    const result = extractTimestamp(line);

    expect(result).toBeDefined();
    expect(result).toContain('2024'); // Uses timestamp, not created_at
  });

  it('should return undefined for non-JSON lines', () => {
    const result = extractTimestamp("not json");

    expect(result).toBeUndefined();
  });

  it('should return undefined when no timestamp present', () => {
    const line = JSON.stringify({ type: "user", uuid: "123" });

    const result = extractTimestamp(line);

    expect(result).toBeUndefined();
  });

  it('should handle malformed JSON gracefully', () => {
    const result = extractTimestamp("{ invalid json }");

    expect(result).toBeUndefined();
  });
});

describe('findMostRecentSession - edge cases', () => {
  // Note: These tests would require mocking the filesystem
  // For now, we test the exported helper functions
});

describe('integration tests', () => {
  it('should handle a realistic session pruning scenario', () => {
    const lines = [
      // Session summary
      JSON.stringify({ type: "user", isCompactSummary: true, message: { content: "Session about auth" } }),
      // First conversation round (will be dropped)
      JSON.stringify({ type: "user", uuid: "u1", message: { content: "How do I add auth?" } }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        content: [{ type: "tool_use", id: "tool-1" }],
        message: { content: "Let me check..." }
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "tool-1", content: "Found auth module" }),
      // Second conversation round (will be kept)
      JSON.stringify({ type: "user", uuid: "u2", message: { content: "Can you implement it?" } }),
      JSON.stringify({
        type: "assistant",
        uuid: "a2",
        content: [{ type: "tool_use", id: "tool-2" }],
        message: { content: "Implementing now..." },
        usage: { cache_read_input_tokens: 5000 }
      }),
      JSON.stringify({ type: "tool_result", tool_use_id: "tool-2", content: "Auth implemented" }),
      JSON.stringify({ type: "user", uuid: "u3", message: { content: "Thanks!" } }),
    ];

    const result = pruneSessionLines(lines, 1);

    // With keepN=1 and 2 assistant messages, we keep from the last assistant (a2)
    // Summary + a2 + tool-2 + u3 = 4 lines
    expect(result.outLines).toHaveLength(4);
    expect(result.dropped).toBe(3); // u1, a1, u2 dropped as messages
    expect(result.kept).toBe(2); // a2, u3 kept

    // tool-1 should be dropped (orphaned - its assistant was dropped)
    expect(result.outLines.some(l => l.includes('tool-1'))).toBe(false);
    // tool-2 should be kept
    expect(result.outLines.some(l => l.includes('tool-2'))).toBe(true);

    // Cache token should be zeroed on the last non-zero line
    const a2Line = result.outLines.find(l => l.includes('"a2"'));
    expect(JSON.parse(a2Line!).usage.cache_read_input_tokens).toBe(0);
  });

  it('should handle boundary detection and pruning together', () => {
    const lines = [
      JSON.stringify({ type: "summary" }),
      JSON.stringify({ type: "user", message: { content: "start" } }),
      "===INTENT_BOUNDARY=== 2024-01-15T10:00:00 | Initial work",
      JSON.stringify({ type: "assistant", message: { content: "working" } }),
      JSON.stringify({ type: "user", message: { content: "continue" } }),
      "===INTENT_BOUNDARY=== 2024-01-15T11:00:00 | Second phase",
      JSON.stringify({ type: "assistant", message: { content: "more work" } }),
    ];

    // Detect boundaries
    const { boundaries } = detectBoundaries(lines);
    expect(boundaries).toHaveLength(2);

    // Prune to the newer boundary (line 5)
    const newerBoundary = boundaries[0];
    expect(newerBoundary.lineNumber).toBe(5);

    const result = pruneToBoundary(lines, newerBoundary.lineNumber);

    // Should have: summary + boundary line + assistant message
    expect(result.outLines).toHaveLength(3);
    expect(result.kept).toBe(1); // assistant "more work"
    expect(result.dropped).toBe(3); // user "start", assistant "working", user "continue"
  });
});