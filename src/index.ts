#!/usr/bin/env node
import { homedir } from "os";
import { join, basename } from "path";
import fs from "fs-extra";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@clack/prompts";
import inquirer from "inquirer";
import { detectBoundaries, pruneToBoundary, extractTimestamp, type Boundary } from "./boundary-detector.js";
import { promisify } from "util";
import { stat } from "fs";
const statAsync = promisify(stat);

// ---------- CLI Definition ----------
const program = new Command()
  .name("ccc")
  .description("Claude Code Commit Intelligence - Smart session pruning with boundary detection")
  .version("2.0.0");

program
  .command("prune")
  .description("Prune early messages from a session (legacy mode)")
  .argument("[sessionId]", "UUID of the session (without .jsonl) - uses most recent if not provided")
  .requiredOption("-k, --keep <number>", "number of *message* objects to keep", parseInt)
  .option("--dry-run", "show what would happen but don't write")
  .action(async (sessionId, opts) => {
    if (!sessionId) {
      sessionId = await findMostRecentSession();
      if (!sessionId) {
        console.error(chalk.red("❌ No sessions found in current project"));
        process.exit(1);
      }
      console.log(chalk.blue(`ℹ️  Using most recent session: ${sessionId}`));
    }
    await main(sessionId, opts);
  });

program
  .command("restore")
  .description("Restore a session from the latest backup")
  .argument("[sessionId]", "UUID of the session to restore (without .jsonl) - uses most recent if not provided")
  .option("--dry-run", "show what would be restored but don't write")
  .action(async (sessionId, opts) => {
    if (!sessionId) {
      sessionId = await findMostRecentSession();
      if (!sessionId) {
        console.error(chalk.red("❌ No sessions found in current project"));
        process.exit(1);
      }
      console.log(chalk.blue(`ℹ️  Using most recent session: ${sessionId}`));
    }
    await restore(sessionId, opts);
  });

// Boundary pruning is now the default behavior when no -k flag is provided

// Default command: boundary pruning when no -k flag, legacy pruning with -k flag
program
  .argument("[sessionId]", "UUID of the session (without .jsonl)")
  .option("-k, --keep <number>", "number of *message* objects to keep", parseInt)
  .option("--dry-run", "show what would happen but don't write")
  .action(async (sessionId, opts) => {
    // If no sessionId provided, find the most recent session
    if (!sessionId) {
      sessionId = await findMostRecentSession();
      if (!sessionId) {
        console.error(chalk.red("❌ No sessions found in current project"));
        process.exit(1);
      }
      console.log(chalk.blue(`ℹ️  Using most recent session: ${sessionId}`));
    }
    
    if (opts.keep) {
      // Legacy mode: use -k flag for message count pruning
      main(sessionId, opts);
    } else {
      // Default mode: boundary detection pruning
      boundaryPrune(sessionId, opts);
    }
  });

// Extract core logic for testing
export { detectBoundaries, pruneToBoundary } from "./boundary-detector.js";

// Find the most recent session in the current project
export async function findMostRecentSession(): Promise<string | null> {
  const cwdProject = process.cwd().replace(/\//g, '-');
  const projectDir = join(homedir(), ".claude", "projects", cwdProject);
  
  if (!(await fs.pathExists(projectDir))) {
    return null;
  }
  
  try {
    const files = await fs.readdir(projectDir);
    const sessionFiles = files
      .filter(f => f.endsWith('.jsonl') && !f.includes('.jsonl.')) // Exclude backups
      .map(f => f.replace('.jsonl', ''));
    
    if (sessionFiles.length === 0) {
      return null;
    }
    
    // Get modification times for each session file
    const sessionStats = await Promise.all(
      sessionFiles.map(async (sessionId) => {
        const filePath = join(projectDir, `${sessionId}.jsonl`);
        try {
          const stats = await statAsync(filePath);
          return { sessionId, mtime: stats.mtime };
        } catch {
          return null;
        }
      })
    );
    
    // Filter out failed stats and sort by modification time (newest first)
    const validSessions = sessionStats
      .filter((stat): stat is { sessionId: string; mtime: Date } => stat !== null)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    return validSessions.length > 0 ? validSessions[0].sessionId : null;
  } catch {
    return null;
  }
}

export function pruneSessionLines(lines: string[], keepN: number): { outLines: string[], kept: number, dropped: number, assistantCount: number } {
  const MSG_TYPES = new Set(["user", "assistant", "system"]);
  const msgIndexes: number[] = [];
  const assistantIndexes: number[] = [];
  const keptToolUseIds = new Set<string>();

  // Pass 1 – locate message objects (skip first line entirely)
  lines.forEach((ln, i) => {
    if (i === 0) return; // Always preserve first item
    try {
      const { type } = JSON.parse(ln);
      if (MSG_TYPES.has(type)) {
        msgIndexes.push(i);
        if (type === "assistant") {
          assistantIndexes.push(i);
        }
      }
    } catch { /* non-JSON diagnostic line – keep as-is */ }
  });

  const total = msgIndexes.length;
  const keepNSafe = Math.max(0, keepN);
  
  // Find the cutoff point based on last N assistant messages
  let cutFrom = 0;
  if (assistantIndexes.length > keepNSafe) {
    cutFrom = assistantIndexes[assistantIndexes.length - keepNSafe];
  }

  // Pass 2 – identify kept tool_use_ids from assistant messages that will be kept
  lines.forEach((ln, idx) => {
    if (idx === 0) return;
    
    try {
      const obj = JSON.parse(ln);
      if (obj.type === "assistant" && idx >= cutFrom) {
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
  });

  // Pass 3 – build pruned output
  const outLines: string[] = [];
  let kept = 0;
  let dropped = 0;

  // Always include first line
  if (lines.length > 0) {
    outLines.push(lines[0]);
  }

  // HACK: Zero out ONLY the last non-zero cache_read_input_tokens to trick UI percentage
  let lastNonZeroCacheLineIndex = -1;
  let lastNonZeroCacheValue = 0;
  
  // First pass: find the last non-zero cache line
  lines.forEach((ln, i) => {
    try {
      const obj = JSON.parse(ln);
      const usageObj = obj.usage || obj.message?.usage;
      if (usageObj?.cache_read_input_tokens && usageObj.cache_read_input_tokens > 0) {
        lastNonZeroCacheLineIndex = i;
        lastNonZeroCacheValue = usageObj.cache_read_input_tokens;
      }
    } catch { /* not JSON, skip */ }
  });

  // Second pass: process lines and zero out only the last non-zero cache line
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

  processedLines.forEach((ln, idx) => {
    if (idx === 0) return; // Already added above
    
    const isMsg = MSG_TYPES.has((() => { try { return JSON.parse(ln).type; } catch { return ""; } })());
    if (isMsg) {
      if (idx >= cutFrom) { 
        kept++; 
        outLines.push(ln); 
      } else { 
        dropped++; 
      }
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
  });

  return { outLines, kept, dropped, assistantCount: assistantIndexes.length };
}

// Only run CLI if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  program.parse();
}

// ---------- Main ----------
async function main(sessionId: string, opts: { keep: number; dryRun?: boolean }) {
  const cwdProject = process.cwd().replace(/\//g, '-');
  const file = join(homedir(), ".claude", "projects", cwdProject, `${sessionId}.jsonl`);

  if (!(await fs.pathExists(file))) {
    console.error(chalk.red(`❌ No transcript at ${file}`));
    process.exit(1);
  }

  // Dry-run confirmation via clack if user forgot --dry-run flag
  if (!opts.dryRun && process.stdin.isTTY) {
    const ok = await confirm({ message: chalk.yellow("Overwrite original file?"), initialValue: true });
    if (!ok) process.exit(0);
  }

  const spinner = ora(`Reading ${file}`).start();
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const { outLines, kept, dropped, assistantCount } = pruneSessionLines(lines, opts.keep);

  spinner.succeed(`${chalk.green("Scanned")} ${lines.length} lines (${kept} kept, ${dropped} dropped) - ${assistantCount} assistant messages found`);

  if (opts.dryRun) {
    console.log(chalk.cyan("Dry-run only ➜ no files written."));
    return;
  }

  const backupDir = join(homedir(), ".claude", "projects", cwdProject, "prune-backup");
  await fs.ensureDir(backupDir);
  const backup = join(backupDir, `${sessionId}.jsonl.${Date.now()}`);
  await fs.copyFile(file, backup);
  await fs.writeFile(file, outLines.join("\n") + "\n");

  console.log(chalk.bold.green("✅ Done:"), chalk.white(`${file}`));
  console.log(chalk.dim(`Backup at ${backup}`));
}

// Extract restore logic for testing
export function findLatestBackup(backupFiles: string[], sessionId: string): { name: string, timestamp: number } | null {
  const sessionBackups = backupFiles
    .filter(f => f.startsWith(`${sessionId}.jsonl.`))
    .map(f => ({
      name: f,
      timestamp: parseInt(f.split('.').pop() || '0')
    }))
    .filter(backup => !isNaN(backup.timestamp)) // Filter out invalid timestamps
    .sort((a, b) => b.timestamp - a.timestamp);

  return sessionBackups.length > 0 ? sessionBackups[0] : null;
}

// ---------- Restore ----------
async function restore(sessionId: string, opts: { dryRun?: boolean }) {
  const cwdProject = process.cwd().replace(/\//g, '-');
  const file = join(homedir(), ".claude", "projects", cwdProject, `${sessionId}.jsonl`);
  const backupDir = join(homedir(), ".claude", "projects", cwdProject, "prune-backup");

  if (!(await fs.pathExists(backupDir))) {
    console.error(chalk.red(`❌ No backup directory found at ${backupDir}`));
    process.exit(1);
  }

  const spinner = ora(`Finding latest backup for ${sessionId}`).start();
  
  try {
    const backupFiles = await fs.readdir(backupDir);
    const latestBackup = findLatestBackup(backupFiles, sessionId);

    if (!latestBackup) {
      spinner.fail(chalk.red(`No backups found for session ${sessionId}`));
      process.exit(1);
    }

    const backupPath = join(backupDir, latestBackup.name);
    const backupDate = new Date(latestBackup.timestamp).toLocaleString();
    
    spinner.succeed(`Found latest backup from ${backupDate}`);

    if (opts.dryRun) {
      console.log(chalk.cyan(`Would restore from: ${backupPath}`));
      console.log(chalk.cyan(`Would restore to: ${file}`));
      return;
    }

    // Confirm restoration
    if (process.stdin.isTTY) {
      const ok = await confirm({ 
        message: chalk.yellow(`Restore session from backup (${backupDate})?`), 
        initialValue: false 
      });
      if (!ok) process.exit(0);
    }

    await fs.copyFile(backupPath, file);
    
    console.log(chalk.bold.green("✅ Restored:"), chalk.white(`${file}`));
    console.log(chalk.dim(`From backup: ${backupPath}`));

  } catch (error) {
    spinner.fail(chalk.red(`Error: ${error}`));
    process.exit(1);
  }
}

// ---------- Boundary Prune ----------
async function boundaryPrune(sessionId: string, opts: { dryRun?: boolean }) {
  const cwdProject = process.cwd().replace(/\//g, '-');
  const file = join(homedir(), ".claude", "projects", cwdProject, `${sessionId}.jsonl`);

  if (!(await fs.pathExists(file))) {
    console.error(chalk.red(`❌ No transcript at ${file}`));
    process.exit(1);
  }

  const spinner = ora(`Analyzing boundaries in ${file}`).start();
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const { boundaries, totalCharacters } = detectBoundaries(lines);
  
  spinner.succeed(`Found ${boundaries.length} boundaries in ${lines.length} lines`);

  if (boundaries.length === 0) {
    console.log(chalk.yellow("No boundaries found in session file."));
    return;
  }

  // Create choices for inquirer
  const choices = boundaries.map((boundary, index) => {
    const timestamp = extractTimestamp(lines[boundary.lineNumber]) || 'Unknown time';
    const retentionDisplay = `${boundary.retentionPercentage}%`;
    
    return {
      name: `[${timestamp}] ${boundary.description}\n    Retention: ${retentionDisplay}`,
      value: boundary,
      short: boundary.description
    };
  });

  // Add option to cancel
  choices.push({
    name: chalk.red('Cancel - do not prune'),
    value: null,
    short: 'Cancel'
  });

  console.log(chalk.bold('\nSelect pruning boundary (↑/↓ to navigate, Enter to confirm):\n'));
  
  const { selectedBoundary } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedBoundary',
      message: 'Choose boundary:',
      choices,
      pageSize: 10
    }
  ]);

  if (!selectedBoundary) {
    console.log(chalk.yellow('Cancelled.'));
    return;
  }

  // Confirm the action if not dry run
  if (!opts.dryRun && process.stdin.isTTY) {
    const ok = await confirm({ 
      message: chalk.yellow(`Prune to selected boundary (${selectedBoundary.retentionPercentage}% retention)?`), 
      initialValue: true 
    });
    if (!ok) {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }
  }

  const pruneSpinner = ora('Pruning session...').start();
  const { outLines, kept, dropped } = pruneToBoundary(lines, selectedBoundary.lineNumber);

  pruneSpinner.succeed(`${chalk.green("Pruned")} to boundary (${kept} kept, ${dropped} dropped messages)`);

  if (opts.dryRun) {
    console.log(chalk.cyan("Dry-run only ➜ no files written."));
    return;
  }

  const backupDir = join(homedir(), ".claude", "projects", cwdProject, "prune-backup");
  await fs.ensureDir(backupDir);
  const backup = join(backupDir, `${sessionId}.jsonl.${Date.now()}`);
  await fs.copyFile(file, backup);
  await fs.writeFile(file, outLines.join("\n") + "\n");

  console.log(chalk.bold.green("✅ Done:"), chalk.white(`${file}`));
  console.log(chalk.dim(`Backup at ${backup}`));
}