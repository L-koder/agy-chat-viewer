const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const app = express();
const PORT = 3777;

const BRAIN_DIR = path.join(
  process.env.HOME || '/home/akarsh',
  '.gemini',
  'antigravity-cli',
  'brain'
);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/media', express.static(BRAIN_DIR, { dotfiles: 'allow' }));

/**
 * Parse a single transcript line safely.
 */
function parseLine(line) {
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

/**
 * Extract user request text from content.
 */
function extractUserRequest(content) {
  if (!content) return null;
  const m = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return m ? m[1].trim() : null;
}

/**
 * Extract model name from content (settings change).
 */
function extractModel(content) {
  if (!content) return null;
  const m = content.match(/Model Selection.*?to\s+(.*?)[\.\s\n<]/);
  return m ? m[1].trim() : null;
}

/**
 * Generate a smart title from the first user message.
 */
function generateTitle(firstMsg) {
  if (!firstMsg) return 'Untitled Chat';
  // Clean up and truncate
  let title = firstMsg.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (title.length > 80) {
    title = title.substring(0, 77) + '...';
  }
  return title;
}

/**
 * Read conversation metadata (lightweight — first few lines only).
 */
async function getConversationMeta(convId) {
  const transcriptPath = path.join(
    BRAIN_DIR,
    convId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
  );

  if (!fs.existsSync(transcriptPath)) {
    return null;
  }

  const stat = fs.statSync(transcriptPath);

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(transcriptPath),
      crlfDelay: Infinity,
    });

    let firstUserMsg = null;
    let model = null;
    let createdAt = null;
    let stepCount = 0;
    let userMsgCount = 0;
    let agentMsgCount = 0;
    let lastTimestamp = null;
    let fullText = '';
    let workspace = null;
    const images = [];

    const imgRegex = new RegExp(BRAIN_DIR.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '[/a-zA-Z0-9_.-]+\\.(png|jpg|jpeg|gif|webp)', 'gi');

    rl.on('line', (line) => {
      const d = parseLine(line);
      if (!d) return;

      if (d.content) {
        let match;
        while ((match = imgRegex.exec(d.content)) !== null) {
          const relPath = match[0].substring(BRAIN_DIR.length).replace(/^\/+/, '');
          if (!images.includes(relPath)) {
            images.push(relPath);
          }
        }
      }

      stepCount++;

      if (!createdAt && d.created_at) {
        createdAt = d.created_at;
      }
      if (d.created_at) {
        lastTimestamp = d.created_at;
      }

      if (d.type === 'USER_INPUT') {
        userMsgCount++;
        const content = d.content || '';

        if (content) fullText += ' ' + content;

        if (!firstUserMsg) {
          firstUserMsg = extractUserRequest(content);
        }

        if (!model) {
          model = extractModel(content);
        }
      }

      if (d.type === 'PLANNER_RESPONSE') {
        agentMsgCount++;
        if (d.content) fullText += ' ' + d.content;
        // Also check for model changes mid-conversation
        if (!model && d.content) {
          model = extractModel(d.content);
        }
      }

      // Extract workspace from tool call Cwd or file paths
      if (!workspace) {
        const toolCalls = d.tool_calls || [];
        for (const tc of toolCalls) {
          const args = tc.args || {};
          // Check Cwd from run_command
          const cwd = (args.Cwd || '').replace(/^"|"$/g, '');
          if (cwd && cwd.startsWith('/') && !cwd.includes('.gemini')) {
            workspace = cwd;
            break;
          }
          // Check file paths from other tools
          for (const key of ['TargetFile', 'SearchPath', 'DirectoryPath', 'AbsolutePath']) {
            const p = (args[key] || '').replace(/^"|"$/g, '');
            if (p && p.startsWith('/home') && !p.includes('.gemini')) {
              workspace = path.dirname(p);
              break;
            }
          }
          if (workspace) break;
        }
      }
    });

    rl.on('close', () => {
      resolve({
        id: convId,
        title: generateTitle(firstUserMsg),
        firstMessage: firstUserMsg || '',
        model: model || 'Default',
        createdAt: createdAt || 'unknown',
        lastActivity: lastTimestamp || createdAt || 'unknown',
        totalSteps: stepCount,
        userMessages: userMsgCount,
        agentMessages: agentMsgCount,
        fileSize: stat.size,
        fullText: fullText.toLowerCase(),
        workspace: workspace || '~',
        images
      });
    });

    rl.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Read full conversation messages.
 */
async function getConversationMessages(convId, useFullTranscript = false) {
  const filename = useFullTranscript
    ? 'transcript_full.jsonl'
    : 'transcript.jsonl';
  const transcriptPath = path.join(
    BRAIN_DIR,
    convId,
    '.system_generated',
    'logs',
    filename
  );

  if (!fs.existsSync(transcriptPath)) {
    return [];
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(transcriptPath),
      crlfDelay: Infinity,
    });

    const messages = [];
    let currentModel = 'Default';

    rl.on('line', (line) => {
      const d = parseLine(line);
      if (!d) return;

      // Track model changes
      if (d.type === 'USER_INPUT' && d.content) {
        const m = extractModel(d.content);
        if (m) currentModel = m;
      }

      const imgRegex = new RegExp(BRAIN_DIR.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '[/a-zA-Z0-9_.-]+\\.(png|jpg|jpeg|gif|webp)', 'gi');
      const getImages = (content) => {
        const imgs = [];
        let match;
        while ((match = imgRegex.exec(content || '')) !== null) {
          imgs.push(match[0].substring(BRAIN_DIR.length).replace(/^\/+/, ''));
        }
        return imgs;
      };

      if (d.type === 'USER_INPUT') {
        const userReq = extractUserRequest(d.content || '');
        if (userReq) {
          messages.push({
            role: 'user',
            content: userReq,
            timestamp: d.created_at,
            stepIndex: d.step_index,
            images: getImages(d.content)
          });
        }
      } else if (d.type === 'PLANNER_RESPONSE') {
        const content = d.content || '';
        const thinking = d.thinking || '';
        const toolCalls = d.tool_calls || [];

        if (content || thinking || toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: content,
            thinking: thinking,
            toolCalls: toolCalls.map((tc) => ({
              name: tc.name,
              args: tc.args,
            })),
            model: currentModel,
            timestamp: d.created_at,
            stepIndex: d.step_index,
            isTruncated: d.is_truncated || false,
            images: getImages(d.content)
          });
        }
      }
    });

    rl.on('close', () => resolve(messages));
    rl.on('error', () => resolve([]));
  });
}

// ── API Routes ──

/**
 * GET /api/conversations
 * List all conversations with metadata.
 */
app.get('/api/conversations', async (req, res) => {
  try {
    const entries = fs
      .readdirSync(BRAIN_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const conversations = [];
    for (const convId of entries) {
      const meta = await getConversationMeta(convId);
      if (meta) {
        conversations.push(meta);
      }
    }

    // Sort by creation date (newest first)
    conversations.sort((a, b) => {
      if (a.createdAt === 'unknown') return 1;
      if (b.createdAt === 'unknown') return -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    res.json({ conversations, total: conversations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations/:id
 * Get full messages for a conversation.
 */
app.get('/api/conversations/:id', async (req, res) => {
  try {
    const convId = req.params.id;
    const full = req.query.full === 'true';
    const meta = await getConversationMeta(convId);
    const messages = await getConversationMessages(convId, full);

    if (!meta) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ meta, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/conversations/:id
 * Deletes a conversation directory completely.
 */
app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const convId = req.params.id;
    const convDir = path.join(BRAIN_DIR, convId);
    if (!fs.existsSync(convDir)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    await fs.promises.rm(convDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations/:id/artifacts
 * List artifacts for a conversation.
 */
app.get('/api/conversations/:id/artifacts', async (req, res) => {
  try {
    const convId = req.params.id;
    const artifactsDir = path.join(BRAIN_DIR, convId);
    const artifacts = [];

    function scanDir(dir, prefix = '') {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          artifacts.push({
            name: entry.name,
            path: relPath,
            size: stat.size,
            modified: stat.mtime,
          });
        } else if (entry.isDirectory()) {
          scanDir(fullPath, relPath);
        }
      }
    }

    scanDir(artifactsDir);
    res.json({ artifacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats
 * Overall stats.
 */
app.get('/api/stats', async (req, res) => {
  try {
    const entries = fs
      .readdirSync(BRAIN_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    const modelCounts = {};
    let totalMessages = 0;

    for (const entry of entries) {
      const meta = await getConversationMeta(entry.name);
      if (meta) {
        const model = meta.model || 'Default';
        modelCounts[model] = (modelCounts[model] || 0) + 1;
        totalMessages += meta.userMessages + meta.agentMessages;
      }
    }

    res.json({
      totalConversations: entries.length,
      totalMessages,
      modelUsage: modelCounts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n  🚀 AGY Chat Viewer running at http://localhost:${PORT}\n`);
  console.log(`  📁 Reading from: ${BRAIN_DIR}`);
  console.log(`  📊 Press Ctrl+C to stop\n`);
});
