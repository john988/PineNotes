// ── State ──
let notes = [];
let activeNoteId = null;
let currentFilter = 'all';
let isPreview = false;
let contextNoteId = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
let saveStatusTimer = null;
let activeQuickSearchIndex = 0;
let currentNotebook = 'all';
let sortMode = 'updated';
let appSettings = {
  theme: 'forest',
  editorFontSize: 14,
  previewFontSize: 15,
  editorFontFamily: 'Cascadia Code, Consolas, monospace',
  previewFontFamily: 'Georgia, Cambria, serif',
  uiDensity: 'comfortable'
};

const historySnapshotTimers = new Map();
const MAX_HISTORY_ENTRIES = 20;
const HISTORY_SNAPSHOT_DELAY = 1800;

// ── Elements ──
const $ = id => document.getElementById(id);
const editor = $('editor');
const editorToolbar = $('editorToolbar');
const editorContainer = $('editorContainer');
const emptyState = $('emptyState');
const editorWrite = $('editorWrite');
const editorPreview = $('editorPreview');
const noteListItems = $('noteListItems');
const searchInput = $('searchInput');
const saveStatus = $('saveStatus');
const wordCount = $('wordCount');
const btnPreview = $('btnPreview');
const btnStar = $('btnStar');
const starIcon = $('starIcon');
const contextMenu = $('contextMenu');
const imageInput = $('imageInput');
const noteMetaBar = $('noteMetaBar');
const tagList = $('tagList');
const tagInput = $('tagInput');
const btnExport = $('btnExport');
const btnRestore = $('btnRestore');
const btnPdf = $('btnPdf');
const btnPrint = $('btnPrint');
const btnExportAll = $('btnExportAll');
const btnBackup = $('btnBackup');
const btnImport = $('btnImport');
const btnHistory = $('btnHistory');
const btnQuickSearch = $('btnQuickSearch');
const btnPin = $('btnPin');
const btnMoveUp = $('btnMoveUp');
const btnMoveDown = $('btnMoveDown');
const btnSettings = $('btnSettings');
const notebookList = $('notebookList');
const btnNewNotebook = $('btnNewNotebook');
const notebookSelect = $('notebookSelect');
const lastOpenedLabel = $('lastOpenedLabel');
const historyModal = $('historyModal');
const historyList = $('historyList');
const historyEmpty = $('historyEmpty');
const quickSearchModal = $('quickSearchModal');
const quickSearchInput = $('quickSearchInput');
const quickSearchResults = $('quickSearchResults');
const quickSearchEmpty = $('quickSearchEmpty');
const settingsModal = $('settingsModal');
const themeSelect = $('themeSelect');
const editorFontSizeInput = $('editorFontSizeInput');
const previewFontSizeInput = $('previewFontSizeInput');
const editorFontFamilyInput = $('editorFontFamilyInput');
const previewFontFamilyInput = $('previewFontFamilyInput');
const uiDensitySelect = $('uiDensitySelect');

// ── Persistence ──
function cloneNotes() {
  return notes.map(note => ({
    ...note,
    tags: [...note.tags],
    history: note.history.map(entry => ({ ...entry }))
  }));
}

function getAppState() {
  return {
    notes: cloneNotes(),
    settings: { ...appSettings }
  };
}

function setSaveStatus(text = '', tone = '') {
  clearTimeout(saveStatusTimer);
  saveStatus.textContent = text;
  saveStatus.className = 'save-status';

  if (tone) saveStatus.classList.add(tone);

  if (tone === 'saved') {
    saveStatusTimer = setTimeout(() => {
      saveStatus.textContent = '';
      saveStatus.className = 'save-status';
    }, 1200);
  }
}

function loadLegacyNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem('pine-notes') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse legacy notes', error);
    return [];
  }
}

function clearLegacyNotes() {
  localStorage.removeItem('pine-notes');
}

function persistNotes() {
  if (!window.notesApi) {
    setSaveStatus('存储不可用', 'error');
    return Promise.resolve();
  }

  const payload = getAppState();
  setSaveStatus('保存中…');

  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await window.notesApi.saveNotes(payload);
    clearLegacyNotes();
    setSaveStatus('已保存', 'saved');
  }).catch(error => {
    console.error('Failed to save notes', error);
    setSaveStatus('保存失败', 'error');
  });

  return saveQueue;
}

function queueSave() {
  clearTimeout(saveTimer);
  setSaveStatus('待保存');
  saveTimer = setTimeout(() => {
    void persistNotes();
  }, 250);
}

// ── Note Model ──
function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  return {
    id: String(entry.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`),
    title: String(entry.title || '无标题笔记'),
    content: String(entry.content || ''),
    snapshotAt: Number(entry.snapshotAt || entry.updated || Date.now())
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return [...new Set(tags
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 12))];
}

function normalizeNote(note) {
  const now = Date.now();

  return {
    id: String(note.id || `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`),
    title: String(note.title || '无标题笔记'),
    content: String(note.content || ''),
    starred: Boolean(note.starred),
    pinned: Boolean(note.pinned),
    archived: Boolean(note.archived),
    notebook: String(note.notebook || '默认'),
    lastOpened: Number(note.lastOpened || note.updated || now),
    manualOrder: Number.isFinite(Number(note.manualOrder)) ? Number(note.manualOrder) : now,
    tags: normalizeTags(note.tags),
    history: Array.isArray(note.history)
      ? note.history.map(normalizeHistoryEntry).filter(Boolean).sort((a, b) => b.snapshotAt - a.snapshotAt).slice(0, MAX_HISTORY_ENTRIES)
      : [],
    created: Number(note.created || now),
    updated: Number(note.updated || now)
  };
}

function createNoteBase(overrides = {}) {
  const now = Date.now();
  return normalizeNote({
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: '无标题笔记',
    content: '',
    starred: false,
    pinned: false,
    archived: false,
    notebook: '默认',
    lastOpened: now,
    manualOrder: now,
    tags: [],
    history: [],
    created: now,
    updated: now,
    ...overrides
  });
}

function getActiveNote() {
  return notes.find(note => note.id === activeNoteId) || null;
}

function pushHistoryEntry(note, snapshot) {
  const entry = normalizeHistoryEntry(snapshot);
  if (!entry || !entry.content.trim()) return false;

  const latest = note.history[0];
  if (latest && latest.content === entry.content && latest.title === entry.title) return false;

  note.history.unshift(entry);
  note.history = note.history.slice(0, MAX_HISTORY_ENTRIES);
  return true;
}

function scheduleHistorySnapshot(noteId, previousTitle, previousContent) {
  if (!previousContent || !previousContent.trim()) return;

  clearTimeout(historySnapshotTimers.get(noteId));
  const timer = setTimeout(() => {
    const note = notes.find(item => item.id === noteId);
    if (!note) return;
    if (note.content === previousContent && note.title === previousTitle) return;

    const changed = pushHistoryEntry(note, {
      id: `hist-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      title: previousTitle || '无标题笔记',
      content: previousContent,
      snapshotAt: Date.now()
    });

    if (changed) {
      if (historyModal.classList.contains('show') && activeNoteId === noteId) renderHistoryModal();
      queueSave();
    }
  }, HISTORY_SNAPSHOT_DELAY);

  historySnapshotTimers.set(noteId, timer);
}

// ── Note CRUD ──
function createNote() {
  const note = createNoteBase({ notebook: currentNotebook === 'all' ? '默认' : currentNotebook });
  notes.unshift(note);
  reindexManualOrder();
  renderList();
  selectNote(note.id);
  void persistNotes();
  editor.focus();
}

function deleteNote(id) {
  notes = notes.filter(n => n.id !== id);
  reindexManualOrder();

  if (activeNoteId === id) {
    const nextVisible = getFilteredNotes()[0] || null;
    activeNoteId = nextVisible ? nextVisible.id : null;
  }

  renderList();
  if (activeNoteId) selectNote(activeNoteId);
  else showEmpty();
  void persistNotes();
}

function duplicateNote(id) {
  const src = notes.find(n => n.id === id);
  if (!src) return;

  const dup = createNoteBase({
    title: `${src.title} (副本)`,
    content: src.content,
    starred: src.starred,
    pinned: src.pinned,
    archived: false,
    notebook: src.notebook,
    tags: [...src.tags]
  });

  notes.unshift(dup);
  reindexManualOrder();
  renderList();
  selectNote(dup.id);
  void persistNotes();
}

function getAllNotebooks() {
  return [...new Set(notes.map(note => note.notebook).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function reindexManualOrder() {
  notes.forEach((note, index) => {
    note.manualOrder = index + 1;
  });
}

function moveActiveNote(delta) {
  const filtered = getFilteredNotes();
  const currentIndex = filtered.findIndex(note => note.id === activeNoteId);
  if (currentIndex === -1) return;

  const targetIndex = currentIndex + delta;
  if (targetIndex < 0 || targetIndex >= filtered.length) return;

  const movingId = filtered[currentIndex].id;
  const targetId = filtered[targetIndex].id;
  const movingIndex = notes.findIndex(note => note.id === movingId);
  const destinationIndex = notes.findIndex(note => note.id === targetId);
  if (movingIndex === -1 || destinationIndex === -1) return;

  const [moving] = notes.splice(movingIndex, 1);
  notes.splice(destinationIndex, 0, moving);
  reindexManualOrder();
  sortMode = 'manual';
  $('sortToggle').textContent = '手动排序';
  renderList();
  selectNote(movingId);
  void persistNotes();
}

function syncActiveNoteAfterVisibilityChange(changedId) {
  if (activeNoteId !== changedId) return false;

  const activeNote = notes.find(n => n.id === changedId);
  if (activeNote && matchesCurrentFilter(activeNote)) return false;

  const nextVisible = getFilteredNotes().find(note => note.id !== changedId) || null;
  activeNoteId = nextVisible ? nextVisible.id : null;
  return true;
}

function syncActiveNoteToCurrentFilter() {
  if (!activeNoteId) return false;

  const activeNote = notes.find(note => note.id === activeNoteId);
  if (activeNote && matchesCurrentFilter(activeNote)) return false;

  const nextVisible = getFilteredNotes()[0] || null;
  activeNoteId = nextVisible ? nextVisible.id : null;
  return true;
}

function toggleStar(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  note.starred = !note.starred;
  const selectionChanged = syncActiveNoteAfterVisibilityChange(id);
  renderList();

  if (selectionChanged) {
    if (activeNoteId) selectNote(activeNoteId);
    else showEmpty();
  } else if (activeNoteId === id) {
    updateStarBtn();
  }

  void persistNotes();
}

function togglePin(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updated = Date.now();
  renderList();
  if (activeNoteId === id) updatePinBtn();
  void persistNotes();
}

function archiveNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  note.archived = !note.archived;
  const selectionChanged = syncActiveNoteAfterVisibilityChange(id);
  renderList();

  if (selectionChanged) {
    if (activeNoteId) selectNote(activeNoteId);
    else showEmpty();
  }

  void persistNotes();
}

function addTagToActiveNote(rawTag) {
  const note = getActiveNote();
  if (!note) return;

  const tag = String(rawTag || '').trim().replace(/^#/, '');
  if (!tag) return;

  note.tags = normalizeTags([...note.tags, tag]);
  note.updated = Date.now();
  renderList();
  renderTagList();
  queueSave();
}

function removeTagFromActiveNote(tag) {
  const note = getActiveNote();
  if (!note) return;

  note.tags = note.tags.filter(item => item !== tag);
  note.updated = Date.now();
  renderList();
  renderTagList();
  queueSave();
}

function changeActiveNotebook(notebook) {
  const note = getActiveNote();
  if (!note) return;
  note.notebook = notebook || '默认';
  note.updated = Date.now();
  renderNotebookList();
  renderNotebookSelect();
  renderList();
  queueSave();
}

function restoreHistoryEntry(historyId) {
  const note = getActiveNote();
  if (!note) return;

  const entry = note.history.find(item => item.id === historyId);
  if (!entry) return;

  pushHistoryEntry(note, {
    id: `hist-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: note.title,
    content: note.content,
    snapshotAt: Date.now()
  });

  note.content = entry.content;
  note.title = entry.title || note.title;
  note.updated = Date.now();
  selectNote(note.id);
  renderList();
  renderHistoryModal();
  void persistNotes();
}

// ── Select Note ──
function selectNote(id) {
  activeNoteId = id;
  const note = getActiveNote();
  if (!note) return showEmpty();

  note.lastOpened = Date.now();

  emptyState.style.display = 'none';
  editorToolbar.style.display = 'flex';
  noteMetaBar.style.display = 'flex';
  editorContainer.style.display = 'flex';

  editor.value = note.content;
  updateWordCount();
  updateStarBtn();
  updatePinBtn();
  tagInput.value = '';
  renderTagList();
  renderNotebookSelect();
  lastOpenedLabel.textContent = `最近打开 ${formatDate(note.lastOpened)}`;

  if (isPreview) renderPreview();

  document.querySelectorAll('.note-card').forEach(card => {
    card.classList.toggle('active', card.dataset.id === id);
  });

  queueSave();
}

function showEmpty() {
  emptyState.style.display = 'flex';
  editorToolbar.style.display = 'none';
  noteMetaBar.style.display = 'none';
  editorContainer.style.display = 'none';
  tagInput.value = '';
}

// ── Render List ──
function matchesCurrentFilter(note) {
  if (currentFilter === 'starred') return note.starred && !note.archived;
  if (currentFilter === 'archived') return note.archived;
  return !note.archived;
}

function noteMatchesQuery(note, query) {
  if (!query) return true;

  const haystack = [note.title, note.content, note.tags.join(' '), note.notebook].join('\n').toLowerCase();
  return haystack.includes(query);
}

function getFilteredNotes() {
  const query = searchInput.value.toLowerCase().trim();
  return notes
    .filter(matchesCurrentFilter)
    .filter(note => currentNotebook === 'all' || note.notebook === currentNotebook)
    .filter(note => noteMatchesQuery(note, query))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortMode === 'opened') return b.lastOpened - a.lastOpened;
      if (sortMode === 'manual') return a.manualOrder - b.manualOrder;
      return b.updated - a.updated;
    });
}

function getQuickSearchResults() {
  const query = quickSearchInput.value.toLowerCase().trim();
  const source = query ? notes.filter(note => noteMatchesQuery(note, query)) : notes.slice();
  return source.sort((a, b) => b.updated - a.updated).slice(0, 30);
}

function renderList() {
  const filtered = getFilteredNotes();
  noteListItems.innerHTML = filtered.map((note, index) => {
    const preview = note.content.replace(/[#*`>\[\]_~\-\|]/g, '').trim().slice(0, 100);
    const date = formatDate(note.updated);
    const tags = note.tags.slice(0, 2).map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('');
    return `
      <div class="note-card ${note.id === activeNoteId ? 'active' : ''}" data-id="${note.id}" style="animation-delay:${index * 30}ms"
           oncontextmenu="showContextMenu(event, '${note.id}')">
        <div class="note-card-title">${escapeHtml(note.title)}</div>
        <div class="note-card-preview">${escapeHtml(preview) || '空笔记'}</div>
        <div class="note-card-meta">
          ${note.pinned ? '<span class="tag">📌 置顶</span>' : ''}
          <span>${escapeHtml(note.notebook || '默认')}</span>
          <span>${date}</span>
          ${note.starred ? '<span class="tag">⭐ 收藏</span>' : ''}
          ${tags}
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', () => selectNote(card.dataset.id));
  });

  $('countAll').textContent = notes.filter(n => !n.archived).length;
  $('countStarred').textContent = notes.filter(n => n.starred && !n.archived).length;
  $('countArchived').textContent = notes.filter(n => n.archived).length;

  const titles = { all: '全部笔记', starred: '收藏', archived: '归档' };
  document.querySelector('.note-list-header h2').textContent = titles[currentFilter];
  renderNotebookList();
}

function renderTagList() {
  const note = getActiveNote();
  if (!note) {
    tagList.innerHTML = '';
    return;
  }

  tagList.innerHTML = note.tags.map(tag => `
    <span class="tag-chip">
      #${escapeHtml(tag)}
      <button type="button" data-tag="${escapeHtml(tag)}" aria-label="删除标签">×</button>
    </span>
  `).join('');

  tagList.querySelectorAll('button[data-tag]').forEach(button => {
    button.addEventListener('click', () => removeTagFromActiveNote(button.dataset.tag));
  });
}

function renderNotebookList() {
  const notebooks = getAllNotebooks();
  notebookList.innerHTML = [
    `<div class="notebook-item ${currentNotebook === 'all' ? 'active' : ''}" data-notebook="all"><span>全部笔记本</span><span class="count">${notes.length}</span></div>`,
    ...notebooks.map(notebook => {
      const count = notes.filter(note => note.notebook === notebook).length;
      return `<div class="notebook-item ${currentNotebook === notebook ? 'active' : ''}" data-notebook="${escapeHtml(notebook)}"><span>${escapeHtml(notebook)}</span><span class="count">${count}</span></div>`;
    })
  ].join('');

  notebookList.querySelectorAll('.notebook-item').forEach(item => {
    item.addEventListener('click', () => {
      currentNotebook = item.dataset.notebook;
      renderNotebookList();
      const selectionChanged = syncActiveNoteToCurrentFilter();
      renderList();
      if (selectionChanged) {
        if (activeNoteId) selectNote(activeNoteId);
        else showEmpty();
      }
    });
  });
}

function renderNotebookSelect() {
  const note = getActiveNote();
  const notebooks = getAllNotebooks();
  notebookSelect.innerHTML = notebooks.map(notebook => `<option value="${escapeHtml(notebook)}">${escapeHtml(notebook)}</option>`).join('');
  if (notebooks.length === 0) {
    notebookSelect.innerHTML = '<option value="默认">默认</option>';
  } else if (!notebooks.includes('默认')) {
    notebookSelect.insertAdjacentHTML('afterbegin', '<option value="默认">默认</option>');
  }
  if (note) notebookSelect.value = note.notebook || '默认';
}

function renderHistoryModal() {
  const note = getActiveNote();
  if (!note) return;

  const history = note.history;
  historyEmpty.style.display = history.length === 0 ? 'block' : 'none';
  historyList.innerHTML = history.map(entry => `
    <div class="history-item">
      <div class="history-item-header">
        <div class="history-item-title">${escapeHtml(entry.title || '无标题笔记')}</div>
        <div class="history-item-meta">${formatDateTime(entry.snapshotAt)}</div>
      </div>
      <div class="history-item-preview">${escapeHtml(entry.content.trim().slice(0, 220) || '空内容')}</div>
      <div class="history-item-actions">
        <button class="toolbar-chip-btn" data-history-id="${entry.id}">恢复这个版本</button>
      </div>
    </div>
  `).join('');

  historyList.querySelectorAll('button[data-history-id]').forEach(button => {
    button.addEventListener('click', () => restoreHistoryEntry(button.dataset.historyId));
  });
}

function renderQuickSearchResults() {
  const results = getQuickSearchResults();
  if (activeQuickSearchIndex >= results.length) activeQuickSearchIndex = 0;

  quickSearchEmpty.style.display = results.length === 0 ? 'block' : 'none';
  quickSearchResults.innerHTML = results.map((note, index) => `
    <div class="quick-result ${index === activeQuickSearchIndex ? 'active' : ''}" data-note-id="${note.id}" data-index="${index}">
      <div class="quick-result-header">
        <div class="quick-result-title">${escapeHtml(note.title)}</div>
        <div class="quick-result-meta">${note.archived ? '已归档 · ' : ''}${formatDate(note.updated)}</div>
      </div>
      <div class="quick-result-preview">${escapeHtml(note.content.trim().slice(0, 160) || '空笔记')}</div>
    </div>
  `).join('');

  quickSearchResults.querySelectorAll('.quick-result').forEach(result => {
    result.addEventListener('mouseenter', () => {
      activeQuickSearchIndex = Number(result.dataset.index || 0);
      renderQuickSearchResults();
    });
    result.addEventListener('click', () => openNoteFromQuickSearch(result.dataset.noteId));
  });
}

// ── Preview ──
function togglePreview() {
  isPreview = !isPreview;
  btnPreview.classList.toggle('active', isPreview);
  editorWrite.classList.toggle('hidden', isPreview);
  editorPreview.classList.toggle('visible', isPreview);
  if (isPreview) renderPreview();
}

function escapeRawHtml(markdown) {
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isSafeLinkUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;

  try {
    const url = new URL(trimmed, window.location.href);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isSafeImageUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) return true;

  try {
    const url = new URL(trimmed, window.location.href);
    return ['file:', 'http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeRenderedHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowedTags = new Set([
    'a', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody',
    'td', 'th', 'thead', 'tr', 'ul'
  ]);

  const sanitizeNode = parent => {
    Array.from(parent.childNodes).forEach(node => {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      if (!allowedTags.has(tag)) {
        node.replaceWith(document.createTextNode(node.outerHTML));
        return;
      }

      Array.from(node.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value;

        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
          return;
        }

        if (tag === 'a') {
          if (name === 'href' && isSafeLinkUrl(value)) return;
          if (name === 'title') return;
          node.removeAttribute(attr.name);
          return;
        }

        if (tag === 'img') {
          if (name === 'src' && isSafeImageUrl(value)) return;
          if (name === 'alt' || name === 'title') return;
          node.removeAttribute(attr.name);
          return;
        }

        if (tag === 'input') {
          if (name === 'type' && value === 'checkbox') return;
          if (name === 'checked') return;
          node.removeAttribute(attr.name);
          return;
        }

        node.removeAttribute(attr.name);
      });

      if (tag === 'a') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noreferrer noopener');
      }

      if (tag === 'input') {
        if (node.getAttribute('type') !== 'checkbox') {
          node.replaceWith(document.createTextNode(node.outerHTML));
          return;
        }
        node.setAttribute('disabled', 'disabled');
      }

      sanitizeNode(node);
    });
  };

  sanitizeNode(template.content);
  return template.innerHTML;
}

function renderPreview() {
  if (typeof marked === 'undefined') {
    editorPreview.textContent = 'Markdown 预览暂时不可用。';
    return;
  }

  const safeMarkdown = escapeRawHtml(editor.value || '*空笔记*');
  const rendered = marked.parse(safeMarkdown, { breaks: true, gfm: true });
  editorPreview.innerHTML = sanitizeRenderedHtml(rendered);
}

// ── Toolbar Actions ──
function insertMarkdown(action) {
  const ta = editor;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.substring(start, end);
  let before = '';
  let after = '';

  switch (action) {
    case 'bold': before = '**'; after = '**'; break;
    case 'italic': before = '*'; after = '*'; break;
    case 'code': before = sel.includes('\n') ? '```\n' : '`'; after = sel.includes('\n') ? '\n```' : '`'; break;
    case 'link': before = '['; after = '](url)'; break;
    case 'list': before = '- '; break;
    case 'todo': before = '- [ ] '; break;
    case 'heading': before = '## '; break;
    case 'quote': before = '> '; break;
  }

  const replacement = before + (sel || '文本') + after;
  ta.setRangeText(replacement, start, end, 'end');
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

// ── Export / Backup / Import ──
async function exportActiveNote() {
  const note = getActiveNote();
  if (!note || !window.notesApi?.exportNoteMarkdown) return;

  try {
    const filePath = await window.notesApi.exportNoteMarkdown(note);
    if (filePath) setSaveStatus('已导出', 'saved');
  } catch (error) {
    console.error('Failed to export note', error);
    setSaveStatus('导出失败', 'error');
  }
}

async function exportAllMarkdown() {
  if (!window.notesApi?.exportAllMarkdown) return;

  try {
    const result = await window.notesApi.exportAllMarkdown(cloneNotes());
    if (result?.exportedCount) {
      setSaveStatus(`已导出 ${result.exportedCount} 篇`, 'saved');
    }
  } catch (error) {
    console.error('Failed to export all markdown', error);
    setSaveStatus('批量导出失败', 'error');
  }
}

async function backupAllNotes() {
  if (!window.notesApi?.backupNotes) return;

  try {
    const backupPath = await window.notesApi.backupNotes(getAppState());
    if (backupPath) setSaveStatus('已备份', 'saved');
  } catch (error) {
    console.error('Failed to backup notes', error);
    setSaveStatus('备份失败', 'error');
  }
}

async function restoreBackup() {
  if (!window.notesApi?.restoreBackup) return;
  if (!confirm('还原备份会替换当前笔记与设置，确认继续？')) return;

  try {
    const restored = await window.notesApi.restoreBackup();
    if (!restored) return;
    notes = Array.isArray(restored.notes) ? restored.notes.map(normalizeNote) : [];
    appSettings = { ...appSettings, ...(restored.settings || {}) };
    reindexManualOrder();
    applySettings();
    renderList();
    if (notes.length > 0) selectNote(notes[0].id);
    else showEmpty();
    await persistNotes();
    setSaveStatus('已还原', 'saved');
  } catch (error) {
    console.error('Failed to restore backup', error);
    setSaveStatus('还原失败', 'error');
  }
}

async function importMarkdownFiles() {
  if (!window.notesApi?.importMarkdownFiles) return;

  try {
    const imported = await window.notesApi.importMarkdownFiles();
    if (!Array.isArray(imported) || imported.length === 0) return;

    const normalized = imported.map(normalizeNote);
    notes = [...normalized, ...notes];
    reindexManualOrder();
    renderList();
    selectNote(normalized[0].id);
    await persistNotes();
    setSaveStatus(`已导入 ${normalized.length} 篇`, 'saved');
  } catch (error) {
    console.error('Failed to import markdown', error);
    setSaveStatus('导入失败', 'error');
  }
}

async function exportActivePdf() {
  const note = getActiveNote();
  if (!note || !window.notesApi?.exportPdf) return;

  try {
    const previousPreviewState = isPreview;
    if (!isPreview) {
      isPreview = true;
      btnPreview.classList.add('active');
      editorWrite.classList.add('hidden');
      editorPreview.classList.add('visible');
    }
    renderPreview();
    const filePath = await window.notesApi.exportPdf({ title: note.title, html: editorPreview.innerHTML });
    if (!previousPreviewState) {
      isPreview = false;
      btnPreview.classList.remove('active');
      editorWrite.classList.remove('hidden');
      editorPreview.classList.remove('visible');
    }
    if (filePath) setSaveStatus('PDF 已导出', 'saved');
  } catch (error) {
    console.error('Failed to export PDF', error);
    setSaveStatus('PDF 导出失败', 'error');
  }
}

function printActiveNote() {
  if (!getActiveNote()) return;
  const previousPreviewState = isPreview;
  if (!isPreview) togglePreview();
  window.notesApi?.printCurrentWindow?.();
  if (!previousPreviewState) togglePreview();
}

// ── Quick Search ──
function openQuickSearch() {
  quickSearchModal.classList.add('show');
  activeQuickSearchIndex = 0;
  quickSearchInput.value = '';
  renderQuickSearchResults();
  setTimeout(() => quickSearchInput.focus(), 0);
}

function closeQuickSearch() {
  quickSearchModal.classList.remove('show');
}

function openNoteFromQuickSearch(noteId) {
  const note = notes.find(item => item.id === noteId);
  if (!note) return;

  currentFilter = note.archived ? 'archived' : 'all';
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.filter === currentFilter);
  });

  renderList();
  selectNote(note.id);
  closeQuickSearch();
}

function moveQuickSearchSelection(delta) {
  const results = getQuickSearchResults();
  if (results.length === 0) return;

  activeQuickSearchIndex = (activeQuickSearchIndex + delta + results.length) % results.length;
  renderQuickSearchResults();
}

function confirmQuickSearchSelection() {
  const results = getQuickSearchResults();
  const selected = results[activeQuickSearchIndex];
  if (selected) openNoteFromQuickSearch(selected.id);
}

// ── History Modal ──
function openHistoryModal() {
  if (!getActiveNote()) return;
  renderHistoryModal();
  historyModal.classList.add('show');
}

function closeHistoryModal() {
  historyModal.classList.remove('show');
}

// ── Context Menu ──
function showContextMenu(event, id) {
  event.preventDefault();
  contextNoteId = id;
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.add('show');
}

window.showContextMenu = showContextMenu;

// ── Image Handling ──
function readResizedImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Unsupported image file'));
      return;
    }

    const maxSize = 800;
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.onload = event => {
      const img = new Image();

      img.onerror = () => reject(new Error('Failed to decode image'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round(height * maxSize / width);
            width = maxSize;
          } else {
            width = Math.round(width * maxSize / height);
            height = maxSize;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };

      img.src = event.target.result;
    };

    reader.readAsDataURL(file);
  });
}

async function processImageFile(file) {
  try {
    const dataUrl = await readResizedImage(file);
    const storedUrl = await window.notesApi.saveImage(dataUrl);
    insertImageAtCursor(storedUrl);
  } catch (error) {
    console.error('Failed to process image', error);
    setSaveStatus('图片保存失败', 'error');
  }
}

function insertImageAtCursor(fileUrl) {
  const ta = editor;
  const start = ta.selectionStart;
  const markdown = `![图片](<${fileUrl}>)\n`;
  ta.setRangeText(markdown, start, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

// ── Helpers ──
function updateStarBtn() {
  const note = getActiveNote();
  if (note && note.starred) {
    starIcon.setAttribute('fill', 'currentColor');
    btnStar.classList.add('active');
  } else {
    starIcon.setAttribute('fill', 'none');
    btnStar.classList.remove('active');
  }
}

function updatePinBtn() {
  const note = getActiveNote();
  btnPin.classList.toggle('active', Boolean(note?.pinned));
  btnPin.textContent = note?.pinned ? '取消置顶' : '置顶';
}

function updateWordCount() {
  const text = editor.value.trim();
  wordCount.textContent = `${text.length} 字`;
}

function formatDate(ts) {
  const date = new Date(ts);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateTime(ts) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function createWelcomeNote() {
  return createNoteBase({
    id: 'welcome',
    title: '欢迎使用 Pine Notes 🌲',
    content: `# 欢迎使用 Pine Notes 🌲

一款极简的 Markdown 笔记应用。

## 已支持的实用功能

- **Markdown 支持**：实时编写，按 \`Ctrl+P\` 切换预览
- **收藏 / 归档**：整理重要笔记与历史内容
- **标签**：为笔记加上主题标签
- **版本历史**：查看并恢复之前的内容快照
- **快速搜索**：按 \`Ctrl+K\` 打开快速搜索
- **导出 / 备份**：导出单篇笔记，备份全部内容
- **Markdown 导入**：把现有 \`.md\` 文件批量导入

## 小提示

- 在标签输入框按 Enter 可以快速添加标签
- 点击“历史”可以恢复之前的内容
- 点击“导出”会将当前笔记保存为 Markdown 文件

    > 好的工具应该像空气一样，存在但不打扰。`,
    starred: true
  });
}

function getThemePalette(theme) {
  const palettes = {
    forest: {
      '--surface-0': '#080f0b',
      '--surface-1': '#0d1a12',
      '--surface-2': '#12231a',
      '--surface-3': '#182e22',
      '--surface-4': '#1e3a2c',
      '--text-primary': '#e8f0eb',
      '--text-secondary': '#9aafa1',
      '--text-tertiary': '#5e7568',
      '--text-accent': '#5ab87a',
      '--border': 'rgba(90, 184, 122, 0.1)',
      '--border-active': 'rgba(90, 184, 122, 0.25)'
    },
    paper: {
      '--surface-0': '#f5f1e8',
      '--surface-1': '#ece5d6',
      '--surface-2': '#e3dbc9',
      '--surface-3': '#d7cfbc',
      '--surface-4': '#c6bda8',
      '--text-primary': '#2f2a22',
      '--text-secondary': '#675d4b',
      '--text-tertiary': '#8b7f69',
      '--text-accent': '#8b5e34',
      '--border': 'rgba(104, 84, 56, 0.12)',
      '--border-active': 'rgba(139, 94, 52, 0.24)'
    },
    midnight: {
      '--surface-0': '#0a1020',
      '--surface-1': '#121a2d',
      '--surface-2': '#182238',
      '--surface-3': '#22304d',
      '--surface-4': '#2b3c5f',
      '--text-primary': '#edf2ff',
      '--text-secondary': '#a8b4d6',
      '--text-tertiary': '#7382ab',
      '--text-accent': '#7fa9ff',
      '--border': 'rgba(127, 169, 255, 0.12)',
      '--border-active': 'rgba(127, 169, 255, 0.28)'
    }
  };
  return palettes[theme] || palettes.forest;
}

function applySettings() {
  const root = document.documentElement;
  const palette = getThemePalette(appSettings.theme);
  Object.entries(palette).forEach(([key, value]) => root.style.setProperty(key, value));
  root.style.setProperty('--editor-font-family', appSettings.editorFontFamily);
  root.style.setProperty('--preview-font-family', appSettings.previewFontFamily);
  root.style.setProperty('--editor-font-size', `${appSettings.editorFontSize}px`);
  root.style.setProperty('--preview-font-size', `${appSettings.previewFontSize}px`);

  const densityMap = {
    compact: { card: '10px', editor: '20px 28px' },
    comfortable: { card: '14px', editor: '28px 48px' },
    airy: { card: '18px', editor: '34px 56px' }
  };
  const density = densityMap[appSettings.uiDensity] || densityMap.comfortable;
  root.style.setProperty('--note-card-padding', density.card);
  root.style.setProperty('--editor-padding', density.editor);
}

function syncSettingsControls() {
  themeSelect.value = appSettings.theme;
  editorFontSizeInput.value = appSettings.editorFontSize;
  previewFontSizeInput.value = appSettings.previewFontSize;
  editorFontFamilyInput.value = appSettings.editorFontFamily;
  previewFontFamilyInput.value = appSettings.previewFontFamily;
  uiDensitySelect.value = appSettings.uiDensity;
}

function openSettingsModal() {
  syncSettingsControls();
  settingsModal.classList.add('show');
}

function closeSettingsModal() {
  settingsModal.classList.remove('show');
}

// ── Events ──
editor.addEventListener('input', () => {
  const note = getActiveNote();
  if (!note) return;

  const previousContent = note.content;
  const previousTitle = note.title;

  note.content = editor.value;
  note.updated = Date.now();

  const firstLine = editor.value.split('\n')[0].replace(/^#+\s*/, '').trim();
  note.title = firstLine || '无标题笔记';

  updateWordCount();
  renderList();
  scheduleHistorySnapshot(note.id, previousTitle, previousContent);
  queueSave();

  if (isPreview) renderPreview();
});

document.querySelectorAll('.toolbar-btn[data-action]').forEach(btn => {
  btn.addEventListener('click', () => insertMarkdown(btn.dataset.action));
});

btnStar.addEventListener('click', () => { if (activeNoteId) toggleStar(activeNoteId); });
$('btnDelete').addEventListener('click', () => {
  if (activeNoteId && confirm('确认删除这篇笔记？')) deleteNote(activeNoteId);
});
btnPreview.addEventListener('click', togglePreview);
$('btnNew').addEventListener('click', createNote);
btnRestore.addEventListener('click', restoreBackup);
btnExport.addEventListener('click', exportActiveNote);
btnExportAll.addEventListener('click', exportAllMarkdown);
btnPdf.addEventListener('click', exportActivePdf);
btnPrint.addEventListener('click', printActiveNote);
btnBackup.addEventListener('click', backupAllNotes);
btnImport.addEventListener('click', importMarkdownFiles);
btnHistory.addEventListener('click', openHistoryModal);
btnQuickSearch.addEventListener('click', openQuickSearch);
btnPin.addEventListener('click', () => { if (activeNoteId) togglePin(activeNoteId); });
btnMoveUp.addEventListener('click', () => moveActiveNote(-1));
btnMoveDown.addEventListener('click', () => moveActiveNote(1));
btnSettings.addEventListener('click', openSettingsModal);

$('sortToggle').addEventListener('click', () => {
  const order = ['updated', 'opened', 'manual'];
  const labels = { updated: '最近修改', opened: '最近打开', manual: '手动排序' };
  const nextIndex = (order.indexOf(sortMode) + 1) % order.length;
  sortMode = order[nextIndex];
  $('sortToggle').textContent = labels[sortMode];
  renderList();
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');
    currentFilter = item.dataset.filter;
    const selectionChanged = syncActiveNoteToCurrentFilter();
    renderList();
    if (selectionChanged) {
      if (activeNoteId) selectNote(activeNoteId);
      else showEmpty();
    }
  });
});

searchInput.addEventListener('input', renderList);
notebookSelect.addEventListener('change', () => changeActiveNotebook(notebookSelect.value));

btnNewNotebook.addEventListener('click', () => {
  const name = prompt('新笔记本名称');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  currentNotebook = trimmed;
  const note = createNoteBase({ notebook: trimmed, title: `${trimmed} - 新笔记` });
  notes.unshift(note);
  reindexManualOrder();
  renderNotebookList();
  renderList();
  selectNote(note.id);
  void persistNotes();
});

tagInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTagToActiveNote(tagInput.value);
    tagInput.value = '';
  }
});

tagInput.addEventListener('blur', () => {
  if (tagInput.value.trim()) {
    addTagToActiveNote(tagInput.value);
    tagInput.value = '';
  }
});

document.addEventListener('click', event => {
  if (!contextMenu.contains(event.target)) {
    contextMenu.classList.remove('show');
  }
});

contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
  item.addEventListener('click', () => {
    if (!contextNoteId) return;

    switch (item.dataset.action) {
      case 'star': toggleStar(contextNoteId); break;
      case 'archive': archiveNote(contextNoteId); break;
      case 'duplicate': duplicateNote(contextNoteId); break;
      case 'delete':
        if (confirm('确认删除？')) deleteNote(contextNoteId);
        break;
    }

    contextMenu.classList.remove('show');
  });
});

$('btnImage').addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', async () => {
  for (const file of Array.from(imageInput.files || [])) {
    await processImageFile(file);
  }
  imageInput.value = '';
});

editor.addEventListener('paste', event => {
  const items = event.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      void processImageFile(item.getAsFile());
      return;
    }
  }
});

editor.addEventListener('dragover', event => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

editor.addEventListener('drop', event => {
  const files = event.dataTransfer?.files;
  if (!files) return;

  for (const file of files) {
    if (file.type.startsWith('image/')) {
      event.preventDefault();
      void processImageFile(file);
    }
  }
});

$('btnCloseHistory').addEventListener('click', closeHistoryModal);
$('btnCloseQuickSearch').addEventListener('click', closeQuickSearch);
$('btnCloseSettings').addEventListener('click', closeSettingsModal);

historyModal.addEventListener('click', event => {
  if (event.target === historyModal) closeHistoryModal();
});

quickSearchModal.addEventListener('click', event => {
  if (event.target === quickSearchModal) closeQuickSearch();
});

settingsModal.addEventListener('click', event => {
  if (event.target === settingsModal) closeSettingsModal();
});

quickSearchInput.addEventListener('input', () => {
  activeQuickSearchIndex = 0;
  renderQuickSearchResults();
});

quickSearchInput.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveQuickSearchSelection(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveQuickSearchSelection(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    confirmQuickSearchSelection();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeQuickSearch();
  }
});

document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    createNote();
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    if (activeNoteId) togglePreview();
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    insertMarkdown('bold');
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'i') {
    event.preventDefault();
    insertMarkdown('italic');
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openQuickSearch();
  }
  if (event.key === 'Escape') {
    if (quickSearchModal.classList.contains('show')) closeQuickSearch();
    if (historyModal.classList.contains('show')) closeHistoryModal();
    if (settingsModal.classList.contains('show')) closeSettingsModal();
  }
});

[themeSelect, editorFontSizeInput, previewFontSizeInput, editorFontFamilyInput, previewFontFamilyInput, uiDensitySelect]
  .forEach(control => {
    control.addEventListener('change', () => {
      appSettings = {
        ...appSettings,
        theme: themeSelect.value,
        editorFontSize: Number(editorFontSizeInput.value) || 14,
        previewFontSize: Number(previewFontSizeInput.value) || 15,
        editorFontFamily: editorFontFamilyInput.value.trim() || 'Cascadia Code, Consolas, monospace',
        previewFontFamily: previewFontFamilyInput.value.trim() || 'Georgia, Cambria, serif',
        uiDensity: uiDensitySelect.value
      };
      applySettings();
      queueSave();
    });
  });

// ── Init ──
async function init() {
  const legacyNotes = loadLegacyNotes();

  if (window.notesApi) {
    try {
      const loadedState = await window.notesApi.loadNotes();
      const storedNotes = Array.isArray(loadedState) ? loadedState : (loadedState.notes || []);
      const storedSettings = Array.isArray(loadedState) ? {} : (loadedState.settings || {});
      if (storedNotes.length > 0) {
        notes = storedNotes.map(normalizeNote);
        appSettings = { ...appSettings, ...storedSettings };
        clearLegacyNotes();
      } else if (legacyNotes.length > 0) {
        notes = legacyNotes.map(normalizeNote);
        await persistNotes();
      } else {
        notes = [createWelcomeNote()];
        await persistNotes();
      }
    } catch (error) {
      console.error('Failed to load notes', error);
      setSaveStatus('读取失败', 'error');
      notes = legacyNotes.length > 0 ? legacyNotes.map(normalizeNote) : [createWelcomeNote()];
    }
  } else {
    setSaveStatus('存储不可用', 'error');
    notes = legacyNotes.length > 0 ? legacyNotes.map(normalizeNote) : [createWelcomeNote()];
  }

  reindexManualOrder();
  applySettings();
  renderNotebookList();
  renderNotebookSelect();
  renderList();
  if (notes.length > 0) selectNote(notes[0].id);
}

void init();
