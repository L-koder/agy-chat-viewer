/**
 * AGY Chat Viewer — Frontend Application
 */

// ── State ──
let allConversations = [];
let currentConvId = null;
let showThinking = true;

// ── DOM refs ──
const chatList = document.getElementById('chatList');
const searchInput = document.getElementById('searchInput');
const modelFilter = document.getElementById('modelFilter');
const sortFilter = document.getElementById('sortFilter');
const mainContent = document.getElementById('mainContent');
const emptyState = document.getElementById('emptyState');
const chatView = document.getElementById('chatView');
const chatTitle = document.getElementById('chatTitle');
const chatModel = document.getElementById('chatModel');
const chatDate = document.getElementById('chatDate');
const chatStats = document.getElementById('chatStats');
const messagesList = document.getElementById('messagesList');
const messagesLoading = document.getElementById('messagesLoading');
const messagesContainer = document.getElementById('messagesContainer');
const toggleFull = document.getElementById('toggleFull');
const toggleThinking = document.getElementById('toggleThinking');
const copyCommandBtn = document.getElementById('copyCommandBtn');
const chatWorkspace = document.getElementById('chatWorkspace');
const workspaceRow = document.getElementById('workspaceRow');
const copyWorkspaceBtn = document.getElementById('copyWorkspaceBtn');
const backBtn = document.getElementById('backBtn');
const sidebar = document.getElementById('sidebar');
const galleryBtn = document.getElementById('galleryBtn');
const galleryModal = document.getElementById('galleryModal');
const closeGalleryBtn = document.getElementById('closeGalleryBtn');
const galleryGrid = document.getElementById('galleryGrid');

// ── Initialization ──
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadConversations();
  await loadStats();
  bindEvents();
}

function bindEvents() {
  searchInput.addEventListener('input', debounce(renderChatList, 200));
  modelFilter.addEventListener('change', renderChatList);
  sortFilter.addEventListener('change', renderChatList);

  toggleFull.addEventListener('change', () => {
    if (currentConvId) loadMessages(currentConvId, toggleFull.checked);
  });

  toggleThinking.addEventListener('click', () => {
    showThinking = !showThinking;
    toggleThinking.classList.toggle('active', showThinking);
    document.querySelectorAll('.thinking-block').forEach((el) => {
      el.style.display = showThinking ? '' : 'none';
    });
  });
  toggleThinking.classList.add('active');

  galleryBtn.addEventListener('click', openGallery);
  closeGalleryBtn.addEventListener('click', () => galleryModal.classList.add('hidden'));
  galleryModal.addEventListener('click', (e) => {
    if (e.target === galleryModal) galleryModal.classList.add('hidden');
  });

  copyCommandBtn.addEventListener('click', async () => {
    if (!currentConvId) return;
    const cmd = `agy --conversation ${currentConvId}`;
    try {
      await navigator.clipboard.writeText(cmd);
      // Visual feedback
      const originalHtml = copyCommandBtn.innerHTML;
      copyCommandBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-emerald)"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        copyCommandBtn.innerHTML = originalHtml;
      }, 1500);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  });

  copyWorkspaceBtn.addEventListener('click', async () => {
    const ws = chatWorkspace.textContent;
    if (!ws || ws === '~') return;
    const cmd = `cd ${ws}`;
    try {
      await navigator.clipboard.writeText(cmd);
      const originalText = copyWorkspaceBtn.innerHTML;
      copyWorkspaceBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-emerald)"><polyline points="20 6 9 17 4 12"></polyline></svg> copied!`;
      setTimeout(() => {
        copyWorkspaceBtn.innerHTML = originalText;
      }, 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  });

  backBtn.addEventListener('click', () => {
    sidebar.classList.remove('hidden-mobile');
    chatView.classList.add('hidden');
    emptyState.style.display = '';
    currentConvId = null;
    document.querySelectorAll('.chat-item.active').forEach((el) =>
      el.classList.remove('active')
    );
  });
}

// ── API ──
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    const renamed = JSON.parse(localStorage.getItem('agyRenamedChats') || '{}');
    allConversations = data.conversations.map(c => {
      if (renamed[c.id]) c.title = renamed[c.id];
      return c;
    });
    document.getElementById('chatCount').textContent =
      `${data.total} conversations`;
    populateModelFilter();
    renderChatList();
  } catch (err) {
    chatList.innerHTML = `
      <div class="no-results">
        <p>Failed to load conversations</p>
        <p style="font-size:0.75rem; color:var(--text-muted)">${err.message}</p>
      </div>`;
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('statTotal').textContent = data.totalConversations;
    document.getElementById('statMessages').textContent = formatNumber(
      data.totalMessages
    );
    document.getElementById('statModels').textContent = Object.keys(
      data.modelUsage
    ).length;
  } catch {
    // Silent fail for stats
  }
}

async function loadMessages(convId, full = false) {
  messagesLoading.classList.remove('hidden');
  messagesList.innerHTML = '';

  try {
    const res = await fetch(
      `/api/conversations/${convId}?full=${full}`
    );
    const data = await res.json();

    // Update header
    const renamed = JSON.parse(localStorage.getItem('agyRenamedChats') || '{}');
    chatTitle.textContent = renamed[convId] || data.meta.title;
    chatTitle.title = renamed[convId] || data.meta.title;
    const modelInfo = getModelInfo(data.meta.model);
    chatModel.textContent = data.meta.model;
    chatModel.className = `chat-meta-badge model-badge ${modelInfo.cssClass}`;
    chatDate.textContent = formatDate(data.meta.createdAt);
    chatStats.textContent = `${data.meta.userMessages} user · ${data.meta.agentMessages} agent · ${data.meta.totalSteps} steps`;

    // Show workspace
    if (data.meta.workspace && data.meta.workspace !== '~') {
      chatWorkspace.textContent = data.meta.workspace;
      workspaceRow.style.display = '';
    } else {
      workspaceRow.style.display = 'none';
    }

    // Render messages
    renderMessages(data.messages);
  } catch (err) {
    messagesList.innerHTML = `
      <div class="no-results">
        <p>Failed to load messages</p>
        <p style="font-size:0.75rem">${err.message}</p>
      </div>`;
  } finally {
    messagesLoading.classList.add('hidden');
  }
}

// ── Rendering ──
function populateModelFilter() {
  const models = new Set(allConversations.map((c) => c.model));
  const sorted = [...models].sort();
  modelFilter.innerHTML = '<option value="">All Models</option>';
  sorted.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelFilter.appendChild(opt);
  });
}

function renderChatList() {
  const query = searchInput.value.toLowerCase().trim();
  const searchWords = query ? query.split(/\s+/) : [];
  const model = modelFilter.value;
  const sort = sortFilter.value;

  const pinnedChats = JSON.parse(localStorage.getItem('agyPinnedChats') || '[]');
  const pinnedSet = new Set(pinnedChats);

  // Reset search scores on all items first
  allConversations.forEach(c => { c._searchScore = 0; c._allWordsMatch = false; });

  let filtered = allConversations.filter((c) => {
    const matchesModel = !model || c.model === model;
    if (!matchesModel) return false;
    
    if (searchWords.length === 0) return true;
    
    let score = 0;
    let matchCount = 0;
    const titleLower = c.title.toLowerCase();
    
    for (const word of searchWords) {
        let wordMatched = false;
        
        // Massive boost for title match
        if (titleLower.includes(word)) {
            score += 100;
            wordMatched = true;
        } 
        
        // Minor boost for content match
        if ((c.fullText || '').includes(word)) {
            score += 1;
            wordMatched = true;
        }
        
        if (c.id.includes(word)) {
            score += 1;
            wordMatched = true;
        }
        
        if (wordMatched) matchCount++;
    }
    
    c._searchScore = score;
    c._allWordsMatch = (matchCount === searchWords.length);
    c._searchSnippet = '';

    if (score > 0 && query.length > 2) {
      // Find the first matching word to generate a snippet
      for (const word of searchWords) {
        if (c.title.toLowerCase().includes(word)) continue; // title is already visible
        const fullText = c.fullText || '';
        const idx = fullText.indexOf(word);
        if (idx !== -1) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(fullText.length, idx + word.length + 40);
          let snippet = fullText.substring(start, end).replace(/\n/g, ' ');
          if (start > 0) snippet = '...' + snippet;
          if (end < fullText.length) snippet = snippet + '...';
          // Highlight the word
          const regex = new RegExp(`(${word})`, 'gi');
          snippet = escapeHtml(snippet).replace(regex, '<mark>$1</mark>');
          c._searchSnippet = snippet;
          break;
        }
      }
    }
    
    return score > 0;
  });

  // Sort
  filtered.sort((a, b) => {
    // 1. Pinned items first
    const aPinned = pinnedSet.has(a.id);
    const bPinned = pinnedSet.has(b.id);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    // 2. All search words match first
    if (searchWords.length > 0) {
        if (a._allWordsMatch && !b._allWordsMatch) return -1;
        if (!a._allWordsMatch && b._allWordsMatch) return 1;
        
        // 3. Search Score
        if (a._searchScore !== b._searchScore) {
            return b._searchScore - a._searchScore;
        }
    }

    // 4. Standard sort fallback
    const aDate = new Date(a.lastActivity || a.createdAt || 0);
    const bDate = new Date(b.lastActivity || b.createdAt || 0);
    if (sort === 'newest') return bDate - aDate;
    if (sort === 'oldest') return aDate - bDate;
    if (sort === 'most-messages') return b.totalSteps - a.totalSteps;
    return 0;
  });

  if (filtered.length === 0) {
    chatList.innerHTML = `
      <div class="no-results">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <p>No conversations found</p>
      </div>`;
    return;
  }

  chatList.innerHTML = '';
  filtered.forEach((conv) => {
    const item = document.createElement('div');
    item.className = `chat-item${conv.id === currentConvId ? ' active' : ''}`;
    item.dataset.id = conv.id;

    const modelInfo = getModelInfo(conv.model);
    const isPinned = pinnedSet.has(conv.id);

    item.innerHTML = `
      <div class="chat-item-header">
        <div class="chat-item-title">${escapeHtml(conv.title)}</div>
        <div class="chat-item-actions" style="display: flex; gap: 4px;">
          <button class="pin-btn ${isPinned ? 'active' : ''}" onclick="togglePin('${conv.id}', event)" title="${isPinned ? 'Unpin chat' : 'Pin chat'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.1 16.3l-5-5-2-6-1-1-1 1-2 6-5 5-2 2h21.2l-2.2-2z"/><path d="M12 18.3v5.7"/>
            </svg>
          </button>
          <button class="delete-btn" onclick="deleteChat('${conv.id}', event)" title="Delete chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="chat-item-meta">
        <span class="chat-item-model ${modelInfo.cssClass}">${escapeHtml(conv.model)}</span>
        <span class="chat-item-date">${formatDateShort(conv.createdAt)}</span>
        <span class="chat-item-steps">${conv.totalSteps} steps</span>
      </div>
      ${conv._searchSnippet ? `<div class="chat-item-snippet">${conv._searchSnippet}</div>` : ''}
    `;

    item.addEventListener('click', () => selectConversation(conv.id));
    chatList.appendChild(item);
  });
}

window.togglePin = function(id, event) {
    event.stopPropagation();
    let pinnedChats = JSON.parse(localStorage.getItem('agyPinnedChats') || '[]');
    if (pinnedChats.includes(id)) {
        pinnedChats = pinnedChats.filter(x => x !== id);
    } else {
        pinnedChats.push(id);
    }
    localStorage.setItem('agyPinnedChats', JSON.stringify(pinnedChats));
    renderChatList();
};

window.deleteChat = async function(id, event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to permanently delete this chat?')) return;
    try {
        const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (res.ok) {
            allConversations = allConversations.filter(c => c.id !== id);
            if (currentConvId === id) {
                currentConvId = null;
                chatView.classList.add('hidden');
                emptyState.style.display = 'flex';
            }
            renderChatList();
        } else {
            const data = await res.json();
            alert('Failed to delete chat: ' + data.error);
        }
    } catch (err) {
        alert('Failed to delete chat: ' + err.message);
    }
};;

function renderMessages(messages) {
  messagesList.innerHTML = '';
  let lastDate = null;

  messages.forEach((msg, idx) => {
    // Date divider
    if (msg.timestamp) {
      const msgDate = new Date(msg.timestamp).toLocaleDateString();
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `<span>${formatDateFull(msg.timestamp)}</span>`;
        messagesList.appendChild(divider);
      }
    }

    const el = document.createElement('div');
    el.className = `message ${msg.role}`;
    el.style.animationDelay = `${Math.min(idx * 30, 500)}ms`;

    if (msg.role === 'user') {
      let imagesHtml = '';
      if (msg.images && msg.images.length > 0) {
        const imgs = msg.images.map(img => `<img src="/api/media/${img}" class="chat-image" alt="Uploaded Image" onclick="openLightbox('/api/media/${img}')" />`).join('');
        imagesHtml = `<div class="message-images-grid">${imgs}</div>`;
      }

      el.innerHTML = `
        <div class="message-avatar">U</div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-sender">You</span>
            <span class="message-time">${formatTime(msg.timestamp)}</span>
          </div>
          ${imagesHtml}
          <div class="message-content">${formatContent(msg.content)}</div>
        </div>
      `;
    } else {
      const modelInfo = getModelInfo(msg.model);
      let thinkingHtml = '';
      if (msg.thinking) {
        thinkingHtml = `
          <div class="thinking-block" style="${showThinking ? '' : 'display:none'}">
            <div class="thinking-header" onclick="toggleThinkingBlock(this)">
              <span class="thinking-icon">💭</span>
              <span class="thinking-label">Thinking</span>
              <svg class="thinking-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </div>
            <div class="thinking-content">${escapeHtml(msg.thinking)}</div>
          </div>
        `;
      }

      let toolCallsHtml = '';
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const callItems = msg.toolCalls
          .map(
            (tc, tcIdx) => `
          <div class="tool-call-wrapper">
            <div class="tool-call" onclick="toggleToolArgs(this, ${idx}_${tcIdx})">
              <svg class="tool-call-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
              <span class="tool-call-name">${escapeHtml(tc.name)}</span>
            </div>
            <div class="tool-call-args" id="tc-${idx}-${tcIdx}">${escapeHtml(formatToolArgs(tc.args))}</div>
          </div>
        `
          )
          .join('');
        toolCallsHtml = `<div class="tool-calls">${callItems}</div>`;
      }

      let truncatedHtml = '';
      if (msg.isTruncated) {
        truncatedHtml = `<div class="truncated-marker">⚠ Content truncated — enable "Full Transcript" to see complete output</div>`;
      }

      let imagesHtml = '';
      if (msg.images && msg.images.length > 0) {
        const imgs = msg.images.map(img => `<img src="/api/media/${img}" class="chat-image" alt="Generated Image" onclick="openLightbox('/api/media/${img}')" />`).join('');
        imagesHtml = `<div class="message-images-grid">${imgs}</div>`;
      }

      el.innerHTML = `
        <div class="message-avatar">✦</div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-sender">AGY</span>
            <span class="message-model-tag ${modelInfo.cssClass}">${escapeHtml(msg.model || 'Default')}</span>
            <span class="message-time">${formatTime(msg.timestamp)}</span>
          </div>
          ${thinkingHtml}
          ${imagesHtml}
          ${msg.content ? `<div class="message-content">${formatContent(msg.content)}</div>` : ''}
          ${truncatedHtml}
          ${toolCallsHtml}
        </div>
      `;
    }

    messagesList.appendChild(el);
  });

  // Scroll to top
  messagesContainer.scrollTop = 0;
}

// ── Interaction ──
function selectConversation(convId) {
  currentConvId = convId;

  // Update active state
  document.querySelectorAll('.chat-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === convId);
  });

  // Show chat view
  emptyState.style.display = 'none';
  chatView.classList.remove('hidden');

  // On mobile, hide sidebar
  if (window.innerWidth <= 900) {
    sidebar.classList.add('hidden-mobile');
  }

  // Reset toggle
  toggleFull.checked = false;

  // Load messages
  loadMessages(convId, false);
}

// ── Global handlers ──
window.toggleThinkingBlock = function (headerEl) {
  const content = headerEl.nextElementSibling;
  const chevron = headerEl.querySelector('.thinking-chevron');
  content.classList.toggle('expanded');
  chevron.classList.toggle('expanded');
};

window.toggleToolArgs = function (callEl) {
  const wrapper = callEl.closest('.tool-call-wrapper');
  const argsEl = wrapper.querySelector('.tool-call-args');
  argsEl.classList.toggle('expanded');
};

// ── Helpers ──
function getModelInfo(model) {
  if (!model) return { cssClass: 'model-default' };
  const lower = model.toLowerCase();
  if (lower.includes('claude')) return { cssClass: 'model-claude' };
  if (lower.includes('gemini')) return { cssClass: 'model-gemini' };
  if (lower === 'default') return { cssClass: 'model-default' };
  return { cssClass: 'model-gemini' };
}

function formatDate(isoStr) {
  if (!isoStr || isoStr === 'unknown') return 'Unknown date';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateShort(isoStr) {
  if (!isoStr || isoStr === 'unknown') return '';
  const d = new Date(isoStr);
  const now = new Date();
  
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((nowDay - dDay) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateFull(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(num) {
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function formatContent(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Code blocks (```)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre><code class="language-$1">$2</code></pre>'
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function formatToolArgs(args) {
  if (!args) return '';
  if (typeof args === 'string') return args;
  try {
    // Parse string values that are JSON-encoded
    const cleaned = {};
    for (const [k, v] of Object.entries(args)) {
      try {
        cleaned[k] =
          typeof v === 'string' && (v.startsWith('"') || v.startsWith('{'))
            ? JSON.parse(v)
            : v;
      } catch {
        cleaned[k] = v;
      }
    }
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return JSON.stringify(args, null, 2);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function openGallery() {
  galleryGrid.innerHTML = '';
  let hasImages = false;
  allConversations.forEach(conv => {
    if (conv.images && conv.images.length > 0) {
      hasImages = true;
      conv.images.forEach(img => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.innerHTML = `<img src="/api/media/${img}" loading="lazy"><div class="gallery-item-title">${escapeHtml(conv.title)}</div>`;
        div.onclick = () => {
          galleryModal.classList.add('hidden');
          selectConversation(conv.id);
        };
        galleryGrid.appendChild(div);
      });
    }
  });
  if (!hasImages) {
    galleryGrid.innerHTML = '<div style="color:var(--text-muted); grid-column: 1/-1; text-align:center;">No media found in any chat</div>';
  }
  galleryModal.classList.remove('hidden');
}


let renamedChats = JSON.parse(localStorage.getItem('agyRenamedChats') || '{}');
const renameChatBtn = document.getElementById('renameChatBtn');

renameChatBtn.addEventListener('click', () => {
  if (!currentConvId) return;
  const currentTitle = chatTitle.innerText;
  const newTitle = prompt('Enter new chat title:', currentTitle);
  if (newTitle !== null && newTitle.trim() !== '') {
    renamedChats[currentConvId] = newTitle.trim();
    localStorage.setItem('agyRenamedChats', JSON.stringify(renamedChats));
    chatTitle.innerText = renamedChats[currentConvId];
    
    // Update it in allConversations and re-render the list
    const conv = allConversations.find(c => c.id === currentConvId);
    if (conv) {
      conv.title = renamedChats[currentConvId];
      renderChatList();
    }
  } else if (newTitle === '') {
    // Reset to default
    delete renamedChats[currentConvId];
    localStorage.setItem('agyRenamedChats', JSON.stringify(renamedChats));
    
    const conv = allConversations.find(c => c.id === currentConvId);
    if (conv) {
      conv.title = conv.firstMessage ? conv.firstMessage.substring(0, 30) + '...' : 'Empty Chat';
      chatTitle.innerText = conv.title;
      renderChatList();
    }
  }
});


const lightboxModal = document.getElementById('lightboxModal');
const lightboxImg = document.getElementById('lightboxImg');
window.openLightbox = function(src) {
  lightboxImg.src = src;
  lightboxModal.classList.remove('hidden');
};
lightboxModal.addEventListener('click', () => {
  lightboxModal.classList.add('hidden');
});

