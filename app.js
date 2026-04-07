import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ── Init ─────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DOM refs ─────────────────────────────────────────
const bookList     = document.getElementById('book-list');
const chapterBar   = document.getElementById('chapter-bar');
const verseArea    = document.getElementById('verse-area');
const greekPage    = document.getElementById('greek-page');
const searchInput  = document.getElementById('search-input');
const searchBtn    = document.getElementById('search-btn');
const otTab        = document.getElementById('tab-ot');
const ntTab        = document.getElementById('tab-nt');
const tabStacks    = document.getElementById('tab-stacks');
const newStackBtn  = document.getElementById('new-stack-btn');
const stackList    = document.getElementById('stack-list');
const stacksFooter = document.getElementById('stacks-footer');

// ── State ─────────────────────────────────────────────
let allBooks        = [];
let activeTestament = 'old';
let activeBook      = null;
let activeChapter   = null;
let greekByVerse    = {};
const defCache      = new Map();
let currentVerses   = [];
let appMode         = 'bible';
let activeStackId   = null;
let activePicker    = null;
let selectedVerses  = [];
let activeTranslation = localStorage.getItem('active_translation') || 'kjv';
const TRANSLATIONS  = { kjv: 'KJV', bsb: 'BSB', ylt: 'YLT', asv: 'ASV', bbe: 'BBE', nheb: 'NHEB', jubilee: 'Jubilee', leb: 'LEB', rotherham: 'Rotherham' };
// Migrate away from removed translations
if (!TRANSLATIONS[activeTranslation]) { activeTranslation = 'kjv'; localStorage.setItem('active_translation', 'kjv'); }
const cardTranslations = new Map(); // idx → translation override for stack cards

// ── Sidebar toggle ────────────────────────────────────
const appEl = document.querySelector('.app');

const backdrop = document.createElement('div');
backdrop.className = 'sidebar-backdrop';
appEl.appendChild(backdrop);

function openSidebar()  { appEl.classList.add('sidebar-open'); appEl.classList.remove('sidebar-hidden'); }
function closeSidebar() { appEl.classList.remove('sidebar-open'); appEl.classList.add('sidebar-hidden'); }

document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
document.getElementById('sidebar-open').addEventListener('click', openSidebar);
backdrop.addEventListener('click', closeSidebar);

// Close sidebar when tapping anywhere outside it
document.addEventListener('click', function(e) {
  if (!appEl.classList.contains('sidebar-open')) return;
  const sidebar = document.querySelector('.sidebar');
  const openBtn = document.getElementById('sidebar-open');
  if (!sidebar.contains(e.target) && !openBtn.contains(e.target)) {
    closeSidebar();
  }
});

// On mobile, start with sidebar closed
if (window.innerWidth <= 680) closeSidebar();

// ── Translation picker ────────────────────────────────
let activeTranslationPicker = null;

function openTranslationPicker(anchorEl, currentKey, onSelect) {
  closeTranslationPicker();
  const picker = document.createElement('div');
  picker.className = 'translation-picker';
  picker.innerHTML = `<div class="translation-picker-title">Select Translation</div>` +
    Object.entries(TRANSLATIONS).map(([key, label]) => `
    <div class="translation-picker-item${key === currentKey ? ' active' : ''}" data-key="${key}">${label}</div>
  `).join('');
  document.body.appendChild(picker);
  activeTranslationPicker = picker;

  // Center horizontally, position above bottom
  picker.style.position = 'fixed';
  picker.style.left = '50%';
  picker.style.transform = 'translateX(-50%)';
  picker.style.bottom = 'max(24px, calc(24px + env(safe-area-inset-bottom)))';
  picker.style.maxHeight = '60vh';
  picker.style.overflowY = 'auto';

  picker.querySelectorAll('.translation-picker-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      onSelect(item.dataset.key);
      closeTranslationPicker();
    });
  });

  setTimeout(() => document.addEventListener('click', closeTranslationPicker, { once: true }), 0);
}

function closeTranslationPicker() {
  activeTranslationPicker?.remove();
  activeTranslationPicker = null;
}

const translationLabel = document.getElementById('translation-label');
translationLabel.textContent = TRANSLATIONS[activeTranslation] || activeTranslation.toUpperCase();
translationLabel.addEventListener('click', e => {
  e.stopPropagation();
  openTranslationPicker(translationLabel, activeTranslation, key => {
    activeTranslation = key;
    localStorage.setItem('active_translation', key);
    translationLabel.textContent = TRANSLATIONS[key];
    document.title = `Scripture Search — ${TRANSLATIONS[key]} Bible`;
    if (activeBook && activeChapter) loadChapter(activeChapter);
    else if (appMode === 'bible') showWelcome();
  });
});

// ── Helpers ───────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Custom modal (replaces prompt/confirm) ────────────
const modalBackdrop = document.getElementById('modal-backdrop');
const modalTitle    = document.getElementById('modal-title');
const modalInput    = document.getElementById('modal-input');
const modalCancel   = document.getElementById('modal-cancel');
const modalConfirm  = document.getElementById('modal-confirm');

function showPrompt(title, placeholder = '') {
  return new Promise(resolve => {
    modalTitle.textContent = title;
    modalInput.placeholder = placeholder;
    modalInput.value = '';
    modalInput.style.display = 'block';
    modalConfirm.textContent = 'Create';
    modalBackdrop.classList.remove('hidden');
    setTimeout(() => modalInput.focus(), 50);

    function done(val) {
      modalBackdrop.classList.add('hidden');
      modalCancel.removeEventListener('click', cancel);
      modalConfirm.removeEventListener('click', confirm);
      modalInput.removeEventListener('keydown', keydown);
      resolve(val);
    }
    function confirm() { const v = modalInput.value.trim(); done(v || null); }
    function cancel()  { done(null); }
    function keydown(e) {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') cancel();
    }
    modalConfirm.addEventListener('click', confirm);
    modalCancel.addEventListener('click', cancel);
    modalInput.addEventListener('keydown', keydown);
  });
}

function showConfirm(title, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    modalTitle.textContent = title;
    modalInput.style.display = 'none';
    modalConfirm.textContent = confirmLabel;
    modalConfirm.classList.add('danger');
    modalBackdrop.classList.remove('hidden');

    function done(val) {
      modalBackdrop.classList.add('hidden');
      modalConfirm.classList.remove('danger');
      modalCancel.removeEventListener('click', cancel);
      modalConfirm.removeEventListener('click', confirm);
      document.removeEventListener('keydown', keydown);
      resolve(val);
    }
    function confirm() { done(true); }
    function cancel()  { done(false); }
    function keydown(e) {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter') confirm();
    }
    modalConfirm.addEventListener('click', confirm);
    modalCancel.addEventListener('click', cancel);
    document.addEventListener('keydown', keydown);
  });
}

// ── Boot ─────────────────────────────────────────────
async function init() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('id');

  if (error) {
    verseArea.innerHTML = `<div class="state-msg"><strong>Connection Error</strong>Check your credentials in config.js</div>`;
    return;
  }

  allBooks = data;
  await migrateOldPassages();
  renderBookList();
  showWelcome();
}

// ── Migrate old single-blob passages into individual verses ──
async function migrateOldPassages() {
  const stacks = loadStacks();
  let changed = false;
  for (const stack of stacks) {
    for (const card of stack.verses) {
      const passages = card.passages ?? (card.ref ? [{ ref: card.ref, text: card.text }] : []);
      if (passages.length !== 1) continue;
      const p = passages[0];
      const m = p.ref.match(/^(.+?)\s+(\d+):(\d+)[–-](\d+)$/);
      if (!m) continue;
      const [, bookName, ch, vStart, vEnd] = m;
      const book = allBooks.find(b => b.name.toLowerCase() === bookName.toLowerCase());
      if (!book) continue;
      const { data } = await supabase
        .from('verses').select('verse, text')
        .eq('book_id', book.id).eq('chapter', parseInt(ch)).eq('translation', 'kjv')
        .gte('verse', parseInt(vStart)).lte('verse', parseInt(vEnd))
        .order('verse');
      if (!data || data.length <= 1) continue;
      card.passages = data.map(v => ({ ref: `${book.name} ${ch}:${v.verse}`, text: v.text }));
      changed = true;
    }
  }
  if (changed) saveStacks(stacks);
}

// ── Book list ─────────────────────────────────────────
function renderBookList() {
  bookList.innerHTML = '';
  const filtered = allBooks.filter(b => b.testament === activeTestament);
  filtered.forEach(book => {
    const div = document.createElement('div');
    div.className = 'book-item' + (activeBook?.id === book.id ? ' active' : '');
    div.textContent = book.name;
    div.addEventListener('click', () => selectBook(book));
    bookList.appendChild(div);
  });
}

// ── Select book ───────────────────────────────────────
async function selectBook(book) {
  activeBook = book;
  activeChapter = null;
  renderBookList();
  if (window.innerWidth <= 680) closeSidebar();

  const { data } = await supabase
    .from('verses')
    .select('chapter')
    .eq('book_id', book.id)
    .eq('translation', activeTranslation)
    .order('chapter', { ascending: false })
    .limit(1);

  const totalChapters = data?.[0]?.chapter ?? 1;
  renderChapterBar(totalChapters);
  selectChapter(1);
}

// ── Chapter bar ───────────────────────────────────────
function renderChapterBar(total) {
  chapterBar.innerHTML = `<span>Chapter</span>`;
  for (let i = 1; i <= total; i++) {
    const btn = document.createElement('button');
    btn.className = 'chapter-btn';
    btn.textContent = i;
    btn.addEventListener('click', () => selectChapter(i));
    chapterBar.appendChild(btn);
  }
}

// ── Select chapter ────────────────────────────────────
async function selectChapter(num) {
  activeChapter = num;

  chapterBar.querySelectorAll('.chapter-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i + 1 === num);
  });

  verseArea.innerHTML = `<div class="state-msg"><span class="spinner"></span> Loading…</div>`;

  const { data, error } = await supabase
    .from('verses')
    .select('verse, text')
    .eq('book_id', activeBook.id)
    .eq('chapter', num)
    .eq('translation', activeTranslation)
    .order('verse');

  if (error || !data?.length) {
    verseArea.innerHTML = `<div class="state-msg">No verses found.</div>`;
    return;
  }

  clearSelection();
  greekByVerse = {};
  if (activeBook.testament === 'new') {
    const { data: greek } = await supabase
      .from('nt_word_tags')
      .select('verse, position, word, transliteration, gloss, strongs')
      .eq('book_id', activeBook.id)
      .eq('chapter', num)
      .order('verse').order('position');
    (greek ?? []).forEach(w => {
      if (!greekByVerse[w.verse]) greekByVerse[w.verse] = [];
      greekByVerse[w.verse].push(w);
    });
  }

  renderVerses(data);
}

// ── Render verses ─────────────────────────────────────
function renderVerses(verses) {
  currentVerses = verses;
  const isNT = activeBook.testament === 'new';
  let html = `
    <div class="book-title">${escHtml(activeBook.name)}</div>
    <div class="chapter-title">Chapter ${activeChapter}</div>
  `;
  verses.forEach(v => {
    const greekWords = greekByVerse[v.verse] ?? [];
    const hasGreek = isNT && greekWords.length > 0;
    html += `
      <div class="verse-row${hasGreek ? ' has-greek' : ''}" ${hasGreek ? `data-verse="${v.verse}"` : ''} data-vnum="${v.verse}">
        <span class="verse-num">${v.verse}</span>
        <span class="verse-text">${escHtml(v.text)}</span>
        ${hasGreek ? '<span class="greek-hint">α</span>' : ''}
        <div class="verse-btns">
          <button class="compare-btn" data-vnum="${v.verse}" title="Compare translations">≡</button>
          <button class="add-btn" data-vnum="${v.verse}" title="Add to a Study Stack">+</button>
        </div>
      </div>
    `;
  });
  verseArea.innerHTML = html;

  verseArea.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const vnum = parseInt(btn.dataset.vnum);
      const verse = currentVerses.find(v => v.verse === vnum);
      if (!verse) return;
      toggleVerseSelection({
        ref: `${activeBook.name} ${activeChapter}:${vnum}`,
        book: activeBook.name,
        chapter: activeChapter,
        verse: vnum,
        text: verse.text
      }, btn.closest('.verse-row'), btn);
    });
  });

  verseArea.querySelectorAll('.compare-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const vnum = parseInt(btn.dataset.vnum);
      openCompare(`${activeBook.name} ${activeChapter}:${vnum}`, activeBook.id, activeChapter, vnum);
    });
  });

  verseArea.scrollTop = 0;
}

// ── Compare translations ───────────────────────────────
const compareBackdrop = document.getElementById('compare-backdrop');
const compareSheet    = document.getElementById('compare-sheet');
const compareRef      = document.getElementById('compare-ref');
const compareBody     = document.getElementById('compare-body');
function closeCompare() {
  compareBackdrop.classList.remove('open');
  setTimeout(() => compareBackdrop.classList.add('hidden'), 380);
}
document.getElementById('compare-close').addEventListener('click', closeCompare);
compareBackdrop.addEventListener('click', e => { if (e.target === compareBackdrop) closeCompare(); });

async function openCompare(ref, bookId, chapter, verse) {
  compareRef.textContent = ref;
  compareBody.innerHTML = '<div class="compare-loading"><span class="spinner"></span> Loading…</div>';
  compareBackdrop.classList.remove('hidden');
  requestAnimationFrame(() => compareBackdrop.classList.add('open'));

  const { data, error } = await supabase
    .from('verses').select('translation, text')
    .eq('book_id', bookId).eq('chapter', chapter).eq('verse', verse)
    .order('translation');

  if (error || !data?.length) {
    compareBody.innerHTML = '<div class="compare-loading">No data found.</div>';
    return;
  }

  // Build a map for quick lookup, then render in TRANSLATIONS order
  const byTranslation = Object.fromEntries(data.map(r => [r.translation, r.text]));
  compareBody.innerHTML = Object.entries(TRANSLATIONS).map(([key, label]) => {
    const text = byTranslation[key];
    if (!text) return '';
    return `
      <div class="compare-row">
        <div class="compare-label">${label}</div>
        <div class="compare-text">${escHtml(text)}</div>
      </div>`;
  }).join('');
}

// ── Verse click → Greek page ───────────────────────────
verseArea.addEventListener('click', e => {
  if (e.target.closest('.add-btn')) return;
  if (e.target.closest('.compare-btn')) return;
  const row = e.target.closest('.has-greek');
  if (!row) return;
  const verseNum = parseInt(row.dataset.verse);
  const verseText = row.querySelector('.verse-text').textContent;
  showGreekPage(verseNum, verseText, greekByVerse[verseNum] ?? []);
});

// ── Greek analysis page ────────────────────────────────
async function showGreekPage(verseNum, verseText, greekWords) {
  greekPage.innerHTML = `
    <div class="gp-header">
      <button class="gp-back" id="gp-back">&#8592; Back</button>
      <div class="gp-ref">${escHtml(activeBook.name)} ${activeChapter}:${verseNum}</div>
    </div>
    <div class="gp-scroll">
      <div class="gp-verse-text">${escHtml(verseText)}</div>
      <div class="gp-words" id="gp-words">
        <div class="state-msg" style="margin-top:40px"><span class="spinner"></span> Loading Greek data…</div>
      </div>
    </div>
  `;
  greekPage.classList.remove('hidden');
  document.getElementById('gp-back').addEventListener('click', closeGreekPage);

  const strongsNums = [...new Set(greekWords.map(w => w.strongs).filter(Boolean))];
  await Promise.all(strongsNums.map(async num => {
    if (defCache.has(num)) return;
    const { data } = await supabase
      .from('strongs_lexicon')
      .select('definition')
      .eq('number', num)
      .single();
    if (data) defCache.set(num, data);
  }));

  let html = '';
  greekWords.forEach(gw => {
    const lex = defCache.get(gw.strongs);
    const definition = lex?.definition ?? gw.gloss ?? '';
    html += `
      <div class="gp-entry">
        <div class="gp-gloss">${escHtml(gw.gloss ?? '')}</div>
        <div class="gp-greek">${escHtml(gw.word)}<span class="gp-translit"> (${escHtml(gw.transliteration ?? '')})</span></div>
        ${gw.strongs ? `<div class="gp-strongs-line"><span class="gp-strongs-num">Strong's ${escHtml(gw.strongs)}:</span> ${escHtml(definition)}</div>`
                     : definition ? `<div class="gp-strongs-line">${escHtml(definition)}</div>` : ''}
      </div>
    `;
  });
  document.getElementById('gp-words').innerHTML = html;
}

function closeGreekPage() {
  greekPage.classList.add('hidden');
  greekPage.innerHTML = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !greekPage.classList.contains('hidden')) {
    closeGreekPage();
  }
});

// ── Reference parser ("Psalm 1", "John 3:16", "Psalm 1:1-4") ─────────────
function parseReference(query) {
  const m = query.trim().match(/^((?:\d+\s+)?[a-z\s]+?)\s+(\d+)(?::(\d+)(?:\s*[-–-]\s*(\d+))?)?$/i);
  if (!m) return null;
  const nameGuess = m[1].trim().toLowerCase();
  const book = allBooks.find(b => {
    const bn = b.name.toLowerCase();
    return bn === nameGuess || bn.startsWith(nameGuess) || nameGuess.startsWith(bn);
  });
  if (!book) return null;
  return {
    book,
    chapter: parseInt(m[2]),
    verseStart: m[3] ? parseInt(m[3]) : null,
    verseEnd:   m[4] ? parseInt(m[4]) : null
  };
}

// ── Search ────────────────────────────────────────────
async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  searchBtn.disabled = true;
  searchBtn.textContent = '…';
  try {

  // ── Reference search: "Psalm 1", "John 3:16-18", etc. ────────────────
  const ref = parseReference(query);
  if (ref) {
    clearSelection();
    activeBook = ref.book;
    activeChapter = ref.chapter;
    chapterBar.innerHTML = '';
    renderBookList();
    verseArea.innerHTML = `<div class="state-msg">Loading…</div>`;

    const { data, error } = await supabase
      .from('verses').select('verse, text')
      .eq('book_id', ref.book.id).eq('chapter', ref.chapter).eq('translation', activeTranslation).order('verse');
    if (error || !data?.length) {
      verseArea.innerHTML = `<div class="state-msg">No verses found.</div>`;
      return;
    }

    greekByVerse = {};
    if (ref.book.testament === 'new') {
      const { data: greek } = await supabase
        .from('nt_word_tags')
        .select('verse, position, word, transliteration, gloss, strongs')
        .eq('book_id', ref.book.id).eq('chapter', ref.chapter)
        .order('verse').order('position');
      (greek ?? []).forEach(w => {
        if (!greekByVerse[w.verse]) greekByVerse[w.verse] = [];
        greekByVerse[w.verse].push(w);
      });
    }

    renderVerses(data);

    if (ref.verseStart) {
      const end = ref.verseEnd ?? ref.verseStart;
      currentVerses
        .filter(v => v.verse >= ref.verseStart && v.verse <= end)
        .forEach(v => {
          const row = verseArea.querySelector(`.verse-row[data-vnum="${v.verse}"]`);
          const btn = row?.querySelector('.add-btn');
          toggleVerseSelection(
            { ref: `${ref.book.name} ${ref.chapter}:${v.verse}`, book: ref.book.name, chapter: ref.chapter, verse: v.verse, text: v.text },
            row, btn
          );
        });
    }
    return;
  }

  verseArea.innerHTML = `<div class="state-msg"><span class="spinner"></span> Searching…</div>`;
  chapterBar.innerHTML = '';
  activeBook = null;
  activeChapter = null;
  renderBookList();

  const { data, error } = await supabase
    .from('verses')
    .select('verse, chapter, text, book_id, books(name)')
    .eq('translation', activeTranslation)
    .ilike('text', `%${query}%`)
    .limit(100);

  if (error) {
    verseArea.innerHTML = `<div class="state-msg">Search error: ${escHtml(error.message)}</div>`;
    return;
  }

  if (!data?.length) {
    verseArea.innerHTML = `<div class="state-msg"><strong>No results</strong>Try different keywords</div>`;
    return;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  let html = `<div class="result-count">${data.length} result${data.length !== 1 ? 's' : ''} for "${escHtml(query)}"</div>`;
  data.forEach((v, idx) => {
    const ref = `${v.books.name} ${v.chapter}:${v.verse}`;
    const highlighted = escHtml(v.text).replace(regex, '<mark>$1</mark>');
    html += `
      <div class="result-item">
        <div class="result-item-header">
          <div class="result-ref">${escHtml(ref)}</div>
          <button class="add-btn" data-idx="${idx}" title="Add to a Study Stack">+</button>
        </div>
        <div class="result-text">${highlighted}</div>
      </div>
    `;
  });

  verseArea.innerHTML = html;

  verseArea.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const v = data[parseInt(btn.dataset.idx)];
      toggleVerseSelection({
        ref: `${v.books.name} ${v.chapter}:${v.verse}`,
        book: v.books.name,
        chapter: v.chapter,
        verse: v.verse,
        text: v.text
      }, btn.closest('.result-item'), btn);
    });
  });

  verseArea.scrollTop = 0;

  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

// ── Welcome screen ────────────────────────────────────
function showWelcome() {
  verseArea.innerHTML = `
    <div class="state-msg">
      <strong>Scripture Search</strong>
      Select a book from the sidebar<br>or search for any keyword above
    </div>
  `;
}

// ── Testament tabs ────────────────────────────────────
otTab.addEventListener('click', () => {
  activeTestament = 'old';
  if (appMode === 'stacks') setMode('bible');
  otTab.classList.add('active');
  ntTab.classList.remove('active');
  renderBookList();
});

ntTab.addEventListener('click', () => {
  activeTestament = 'new';
  if (appMode === 'stacks') setMode('bible');
  ntTab.classList.add('active');
  otTab.classList.remove('active');
  renderBookList();
});

// ── Search events ─────────────────────────────────────
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

// ── Arrow key chapter navigation ──────────────────────
document.addEventListener('keydown', e => {
  if (e.target === searchInput) return;
  if (!greekPage.classList.contains('hidden')) return;
  if (!activeBook || !activeChapter) return;
  const maxChapter = chapterBar.querySelectorAll('.chapter-btn').length;
  if (e.key === 'ArrowRight') {
    if (activeChapter < maxChapter) {
      selectChapter(activeChapter + 1);
    } else {
      const nextBook = allBooks[allBooks.findIndex(b => b.id === activeBook.id) + 1];
      if (nextBook) selectBook(nextBook);
    }
  }
  if (e.key === 'ArrowLeft') {
    if (activeChapter > 1) {
      selectChapter(activeChapter - 1);
    } else {
      const prevBook = allBooks[allBooks.findIndex(b => b.id === activeBook.id) - 1];
      if (prevBook) selectBook(prevBook);
    }
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); verseArea.scrollBy({ top: 120, behavior: 'smooth' }); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); verseArea.scrollBy({ top: -120, behavior: 'smooth' }); }
});


// ══════════════════════════════════════════════════════
//  STUDY STACKS
// ══════════════════════════════════════════════════════

// ── Storage ───────────────────────────────────────────
function loadStacks() {
  try { return JSON.parse(localStorage.getItem('study_stacks') || '[]'); }
  catch { return []; }
}
function saveStacks(stacks) {
  localStorage.setItem('study_stacks', JSON.stringify(stacks));
}

// ── Mode toggle ───────────────────────────────────────
function setMode(mode) {
  appMode = mode;
  if (mode === 'stacks') {
    bookList.classList.add('hidden');
    stackList.classList.remove('hidden');
    stacksFooter.classList.remove('hidden');
    tabStacks.classList.add('active');
    otTab.classList.remove('active');
    ntTab.classList.remove('active');
    chapterBar.innerHTML = '';
    renderStacksList();
    const stacks = loadStacks();
    if (stacks.length > 0) {
      const target = stacks.find(s => s.id === activeStackId) ? activeStackId : stacks[0].id;
      openStack(target);
    } else {
      showStacksWelcome();
    }
  } else {
    bookList.classList.remove('hidden');
    stackList.classList.add('hidden');
    stacksFooter.classList.add('hidden');
    tabStacks.classList.remove('active');
    renderBookList();
    if (activeBook && activeChapter) {
      selectChapter(activeChapter);
    } else {
      showWelcome();
    }
  }
}

tabStacks.addEventListener('click', () => setMode('stacks'));

// ── Render stacks list in sidebar ─────────────────────
function renderStacksList() {
  const stacks = loadStacks();
  stackList.innerHTML = '';
  if (stacks.length === 0) {
    stackList.innerHTML = '<div class="stack-empty-hint">No stacks yet.<br>Click <strong>+</strong> to create one.</div>';
    return;
  }
  stacks.forEach(stack => {
    const div = document.createElement('div');
    div.className = 'stack-item' + (stack.id === activeStackId ? ' active' : '');
    div.innerHTML = `
      <span class="stack-item-name">${escHtml(stack.title)}</span>
      <span class="stack-item-count">${stack.verses.length}</span>
    `;
    div.addEventListener('click', () => openStack(stack.id));
    stackList.appendChild(div);
  });
}

// ── Open a stack ──────────────────────────────────────
function openStack(id) {
  activeStackId = id;
  renderStacksList();
  renderStackView(id);
  if (window.innerWidth <= 680) closeSidebar();
}

// ── Render stack in main area ─────────────────────────
function renderStackView(id) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === id);
  if (!stack) return;

  let html = `
    <div class="stack-view">
      <div class="stack-view-header">
        <input class="stack-title-input" id="stack-title-input"
          value="${escHtml(stack.title)}" maxlength="60" placeholder="Stack title…" />
        <button class="delete-stack-btn" id="delete-stack-btn">Delete Stack</button>
      </div>
      <div class="stack-verse-count">${stack.verses.length} verse${stack.verses.length !== 1 ? 's' : ''}</div>
      <div class="stack-add-bar">
        <input class="stack-add-input" id="stack-add-input" placeholder="Search to add a verse…" autocomplete="off" />
        <button class="stack-add-search-btn" id="stack-add-search-btn">Add</button>
      </div>
      <div class="stack-add-results" id="stack-add-results"></div>
  `;

  if (stack.verses.length === 0) {
    html += `<div class="state-msg" style="margin-top:60px">No verses yet.<br>Browse the Bible and click <strong style="color:var(--accent2)">+</strong> on any verse to add it here.</div>`;
  } else {
    stack.verses.forEach((v, idx) => {
      const passages = v.passages ?? [{ ref: v.ref, text: v.text }];
      const hasNote = v.note && v.note.trim();
      let cardRef;
      if (passages.length > 1 && passages.every(p => p.ref.replace(/:\d+$/, '') === passages[0].ref.replace(/:\d+$/, ''))) {
        const nums = passages.map(p => parseInt(p.ref.match(/:(\d+)$/)?.[1])).filter(n => !isNaN(n));
        const base = passages[0].ref.replace(/:\d+$/, '');
        const consecutive = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
        cardRef = consecutive ? `${base}:${nums[0]}–${nums[nums.length - 1]}` : `${base}:${nums.join(', ')}`;
      } else {
        cardRef = passages.map(p => p.ref).join(' · ');
      }
      const passagesHtml = passages.map((p, pi) => {
            const verseNum = p.ref.match(/:(\d+)/)?.[1] || '';
            return `
            <div class="stack-verse-row${passages.length > 1 ? '' : ' single'}">
              ${verseNum && passages.length > 1 ? `<span class="stack-verse-num">${verseNum}</span>` : ''}
              <div class="stack-verse-text">${escHtml(p.text)}</div>
              <div class="verse-btns">
                <button class="stack-compare-btn" data-ref="${escHtml(p.ref)}" title="Compare translations">≡</button>
                ${pi > 0 ? `<button class="remove-passage-btn" data-cardidx="${idx}" data-pi="${pi}" title="Remove">×</button>` : ''}
              </div>
            </div>`;
      }).join('');
      html += `
        <div class="stack-verse-card" data-idx="${idx}">
          <div class="stack-verse-card-header">
            <span class="stack-verse-ref">${escHtml(cardRef)}</span>
            <button class="remove-verse-btn" data-idx="${idx}" title="Remove card">×</button>
          </div>
          ${passagesHtml}
          <div class="stack-card-actions">
            <button class="add-passage-btn" data-idx="${idx}" title="Add scripture">＋</button>
            <button class="note-toggle" data-idx="${idx}" title="Note">✎</button>
            <button class="card-translation-btn" data-idx="${idx}" title="Switch translation">${TRANSLATIONS[cardTranslations.get(idx) || 'kjv']}</button>
          </div>
          <div class="add-passage-area hidden">
            <input class="add-passage-input" data-cardidx="${idx}" placeholder="Search and press Enter…" autocomplete="off" />
            <div class="add-passage-results"></div>
          </div>
          <textarea class="stack-note${hasNote ? '' : ' hidden'}" data-idx="${idx}" placeholder="Add a note…">${escHtml(v.note || '')}</textarea>
        </div>
      `;
    });
  }

  html += `</div>`;
  verseArea.innerHTML = html;
  verseArea.scrollTop = 0;

  document.getElementById('stack-title-input').addEventListener('input', e => {
    updateStackTitle(id, e.target.value);
  });

  document.getElementById('delete-stack-btn').addEventListener('click', async () => {
    const ok = await showConfirm(`Delete "${stack.title}"?`);
    if (ok) deleteStack(id);
  });

  verseArea.querySelectorAll('.remove-verse-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('Remove this verse?', 'Remove');
      if (ok) removeVerseFromStack(id, parseInt(btn.dataset.idx));
    });
  });

  verseArea.querySelectorAll('.add-passage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const area = btn.closest('.stack-verse-card').querySelector('.add-passage-area');
      area.classList.toggle('hidden');
      if (!area.classList.contains('hidden')) area.querySelector('.add-passage-input').focus();
    });
  });

  verseArea.querySelectorAll('.remove-passage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      removePassageFromCard(id, parseInt(btn.dataset.cardidx), parseInt(btn.dataset.pi));
    });
  });

  verseArea.querySelectorAll('.stack-compare-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const ref = btn.dataset.ref; // e.g. "Genesis 1:1"
      const m = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
      if (!m) return;
      const [, bookName, chapter, verse] = m;
      const book = allBooks.find(b => b.name.toLowerCase() === bookName.toLowerCase());
      if (!book) return;
      openCompare(ref, book.id, parseInt(chapter), parseInt(verse));
    });
  });

  verseArea.querySelectorAll('.add-passage-input').forEach(input => {
    const cardIdx = parseInt(input.dataset.cardidx);
    const resultsEl = input.nextElementSibling;

    async function searchAndShow() {
      const q = input.value.trim();
      if (!q) return;
      resultsEl.innerHTML = `<div class="add-passage-loading">Searching…</div>`;

      const ref = parseReference(q);
      if (ref && ref.chapter) {
        const { data, error } = await supabase
          .from('verses').select('verse, text')
          .eq('book_id', ref.book.id).eq('chapter', ref.chapter).eq('translation', activeTranslation).order('verse');
        if (error || !data?.length) { resultsEl.innerHTML = `<div class="add-passage-loading">No results.</div>`; return; }
        const verses = ref.verseStart
          ? data.filter(v => v.verse >= ref.verseStart && v.verse <= (ref.verseEnd ?? ref.verseStart))
          : data;
        resultsEl.innerHTML = verses.map((v, i) => `
          <div class="add-passage-result-row" data-idx="${i}">
            <div class="add-passage-result-ref">${escHtml(ref.book.name)} ${ref.chapter}:${v.verse}</div>
            <div class="add-passage-result-text">${escHtml(v.text.slice(0, 80))}…</div>
          </div>`).join('');
        resultsEl.querySelectorAll('.add-passage-result-row').forEach((row, i) => {
          row.addEventListener('click', () => {
            const v = verses[i];
            addPassageToCard(id, cardIdx, { ref: `${ref.book.name} ${ref.chapter}:${v.verse}`, text: v.text });
          });
        });
        return;
      }

      const { data, error } = await supabase
        .from('verses').select('verse, chapter, text, book_id, books(name)')
        .eq('translation', activeTranslation).ilike('text', `%${q}%`).limit(20);
      if (error || !data?.length) { resultsEl.innerHTML = `<div class="add-passage-loading">No results.</div>`; return; }
      resultsEl.innerHTML = data.map((rv, i) => `
        <div class="add-passage-result-row" data-idx="${i}">
          <div class="add-passage-result-ref">${escHtml(rv.books.name)} ${rv.chapter}:${rv.verse}</div>
          <div class="add-passage-result-text">${escHtml(rv.text.slice(0, 80))}…</div>
        </div>`).join('');
      resultsEl.querySelectorAll('.add-passage-result-row').forEach(row => {
        row.addEventListener('click', () => {
          const rv = data[parseInt(row.dataset.idx)];
          addPassageToCard(id, cardIdx, { ref: `${rv.books.name} ${rv.chapter}:${rv.verse}`, text: rv.text });
        });
      });
    }

    input.addEventListener('keydown', e => { if (e.key === 'Enter') searchAndShow(); });
  });

  verseArea.querySelectorAll('.note-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = btn.closest('.stack-verse-card').querySelector('.stack-note');
      const opening = ta.classList.contains('hidden');
      ta.classList.toggle('hidden', !opening);
      if (opening) ta.focus();
    });
  });

  verseArea.querySelectorAll('.stack-note').forEach(ta => {
    ta.addEventListener('input', () => {
      updateVerseNote(id, parseInt(ta.dataset.idx), ta.value);
    });
  });

  verseArea.querySelectorAll('.card-translation-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const current = cardTranslations.get(idx) || 'kjv';
      openTranslationPicker(btn, current, async next => {
      cardTranslations.set(idx, next);
      btn.textContent = TRANSLATIONS[next];
      btn.disabled = true;

      const card = btn.closest('.stack-verse-card');
      const stacks = loadStacks();
      const stack = stacks.find(s => s.id === id);
      const v = stack?.verses[idx];
      if (!v) { btn.disabled = false; return; }
      const passages = v.passages ?? [{ ref: v.ref, text: v.text }];

      // Re-fetch each passage in the new translation
      const fetched = await Promise.all(passages.map(async p => {
        const m = p.ref.match(/^(.+?)\s+(\d+):(\d+)$/);
        if (!m) return p;
        const [, bookName, ch, verse] = m;
        const book = allBooks.find(b => b.name.toLowerCase() === bookName.toLowerCase());
        if (!book) return p;
        const { data } = await supabase.from('verses').select('text')
          .eq('book_id', book.id).eq('chapter', parseInt(ch)).eq('verse', parseInt(verse)).eq('translation', next).single();
        return { ref: p.ref, text: data?.text ?? p.text };
      }));

      // Update just the verse rows in this card
      const rows = card.querySelectorAll('.stack-verse-row');
      fetched.forEach((p, pi) => {
        const textEl = rows[pi]?.querySelector('.stack-verse-text');
        if (textEl) textEl.textContent = p.text;
      });
      btn.disabled = false;
      }); // end openTranslationPicker callback
    });
  });

  const addInput = document.getElementById('stack-add-input');
  const addBtn   = document.getElementById('stack-add-search-btn');
  const addResults = document.getElementById('stack-add-results');

  async function doStackSearch() {
    const q = addInput.value.trim();
    if (!q) return;
    addResults.innerHTML = `<div class="stack-add-loading">Searching…</div>`;
    const { data, error } = await supabase
      .from('verses')
      .select('verse, chapter, text, book_id, books(name)')
      .eq('translation', activeTranslation)
      .ilike('text', `%${q}%`)
      .limit(30);
    if (error || !data?.length) {
      addResults.innerHTML = `<div class="stack-add-loading">No results.</div>`;
      return;
    }
    addResults.innerHTML = data.map((v, i) => `
      <div class="stack-add-result-row">
        <div class="stack-add-result-ref">${escHtml(v.books.name)} ${v.chapter}:${v.verse}</div>
        <div class="stack-add-result-text">${escHtml(v.text)}</div>
        <button class="stack-add-result-btn" data-idx="${i}">+ Add</button>
      </div>
    `).join('');
    addResults.querySelectorAll('.stack-add-result-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = data[parseInt(btn.dataset.idx)];
        addVerseToStack(id, {
          ref: `${v.books.name} ${v.chapter}:${v.verse}`,
          book: v.books.name,
          chapter: v.chapter,
          verse: v.verse,
          text: v.text
        });
        btn.textContent = '✓ Added';
        btn.disabled = true;
      });
    });
  }

  addBtn.addEventListener('click', doStackSearch);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doStackSearch(); });
}

// ── Welcome when no stacks ────────────────────────────
function showStacksWelcome() {
  verseArea.innerHTML = `
    <div class="state-msg">
      <strong>Study Stacks</strong>
      Click <strong>+</strong> in the sidebar to create your first stack.<br>
      Then browse the Bible and click <strong style="color:var(--accent2)">+</strong> on any verse.
    </div>
  `;
}

// ── Create stack ──────────────────────────────────────
newStackBtn.addEventListener('click', async () => {
  const title = await showPrompt('Name your stack', 'e.g. Healing, Faith, Promises…');
  if (!title) return;
  const stacks = loadStacks();
  const newStack = { id: genId(), title, verses: [], createdAt: Date.now() };
  stacks.push(newStack);
  saveStacks(stacks);
  setMode('stacks');
  openStack(newStack.id);
});

// ── CRUD ──────────────────────────────────────────────
function updateStackTitle(id, title) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === id);
  if (stack) { stack.title = title; saveStacks(stacks); renderStacksList(); }
}

function deleteStack(id) {
  const stacks = loadStacks().filter(s => s.id !== id);
  saveStacks(stacks);
  activeStackId = null;
  if (stacks.length > 0) {
    openStack(stacks[0].id);
  } else {
    renderStacksList();
    showStacksWelcome();
  }
}

function removeVerseFromStack(stackId, idx) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === stackId);
  if (!stack) return;
  stack.verses.splice(idx, 1);
  saveStacks(stacks);
  renderStackView(stackId);
  renderStacksList();
}

function updateVerseNote(stackId, idx, note) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === stackId);
  if (!stack?.verses[idx]) return;
  stack.verses[idx].note = note;
  saveStacks(stacks);
}

function addPassageToCard(stackId, cardIdx, passageData) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === stackId);
  if (!stack?.verses[cardIdx]) return;
  const card = stack.verses[cardIdx];
  if (!card.passages) card.passages = [{ ref: card.ref, text: card.text }];
  if (card.passages.some(p => p.ref === passageData.ref)) {
    showToast('Already on this card');
    return;
  }
  card.passages.push(passageData);
  saveStacks(stacks);
  renderStackView(stackId);
}

function removePassageFromCard(stackId, cardIdx, passageIdx) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === stackId);
  if (!stack?.verses[cardIdx]) return;
  const card = stack.verses[cardIdx];
  if (!card.passages) card.passages = [{ ref: card.ref, text: card.text }];
  card.passages.splice(passageIdx, 1);
  saveStacks(stacks);
  renderStackView(stackId);
}

// ── Drag-to-reorder (single global listener set) ─────
{
  let dragCard = null, longPressTimer = null, startY = 0, offsetY = 0;
  let placeholder = null, scrollInterval = null, isDragging = false;

  verseArea.addEventListener('touchstart', e => {
    if (isDragging) return;
    const card = e.target.closest('.stack-verse-card');
    if (!card || e.target.closest('input, button, textarea, a')) return;
    if (appMode !== 'stacks' || !activeStackId) return;
    const touch = e.touches[0];
    startY = touch.clientY;
    longPressTimer = setTimeout(() => {
      isDragging = true;
      dragCard = card;
      document.body.classList.add('is-dragging');
      window.getSelection()?.removeAllRanges();

      const rect = card.getBoundingClientRect();
      offsetY = startY - rect.top;

      placeholder = document.createElement('div');
      placeholder.className = 'drag-placeholder';
      placeholder.style.height = rect.height + 'px';
      card.parentNode.insertBefore(placeholder, card);

      card.classList.add('dragging');
      card.style.top = rect.top + 'px';
      card.style.left = rect.left + 'px';
      card.style.width = rect.width + 'px';

      verseArea.querySelectorAll('.stack-verse-card:not(.dragging)').forEach(c => {
        c.style.transition = 'transform 0.25s ease, opacity 0.2s';
        c.style.opacity = '0.6';
      });

      navigator.vibrate?.(20);
    }, 400);
  }, { passive: true });

  verseArea.addEventListener('touchmove', e => {
    if (!isDragging) {
      if (longPressTimer && Math.abs(e.touches[0].clientY - startY) > 8) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      return;
    }
    e.preventDefault();
    const y = e.touches[0].clientY;
    dragCard.style.top = (y - offsetY) + 'px';

    clearInterval(scrollInterval);
    const areaRect = verseArea.getBoundingClientRect();
    const edgeZone = 60;
    if (y < areaRect.top + edgeZone) {
      scrollInterval = setInterval(() => verseArea.scrollTop -= 8, 16);
    } else if (y > areaRect.bottom - edgeZone) {
      scrollInterval = setInterval(() => verseArea.scrollTop += 8, 16);
    }

    const siblings = [...verseArea.querySelectorAll('.stack-verse-card:not(.dragging)')];
    let inserted = false;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        if (placeholder.nextElementSibling !== sib) {
          sib.parentNode.insertBefore(placeholder, sib);
        }
        inserted = true;
        break;
      }
    }
    if (!inserted && siblings.length) {
      const last = siblings[siblings.length - 1];
      if (placeholder !== last.nextElementSibling) {
        last.parentNode.insertBefore(placeholder, last.nextSibling);
      }
    }
  }, { passive: false });

  function cancelDrag() {
    clearTimeout(longPressTimer);
    clearInterval(scrollInterval);
    longPressTimer = null;
    if (!isDragging) return;
    document.body.classList.remove('is-dragging');
    placeholder?.remove();
    dragCard.classList.remove('dragging');
    dragCard.removeAttribute('style');
    verseArea.querySelectorAll('.stack-verse-card').forEach(c => {
      c.style.opacity = ''; c.style.transition = ''; c.style.transform = '';
    });
    dragCard = null;
    isDragging = false;
  }

  function endDrag() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    clearInterval(scrollInterval);
    scrollInterval = null;
    if (!isDragging || !dragCard) { isDragging = false; document.body.classList.remove('is-dragging'); return; }

    const phRect = placeholder.getBoundingClientRect();
    dragCard.style.transition = 'top 0.2s ease, box-shadow 0.2s ease';
    dragCard.style.top = phRect.top + 'px';

    verseArea.querySelectorAll('.stack-verse-card:not(.dragging)').forEach(c => {
      c.style.opacity = ''; c.style.transition = ''; c.style.transform = '';
    });

    const finishCard = dragCard;
    const finishPlaceholder = placeholder;
    const finishStackId = activeStackId;
    dragCard = null;
    isDragging = false;
    document.body.classList.remove('is-dragging');

    setTimeout(() => {
      if (!finishPlaceholder.parentNode) return;
      finishPlaceholder.parentNode.insertBefore(finishCard, finishPlaceholder);
      finishPlaceholder.remove();
      finishCard.classList.remove('dragging');
      finishCard.removeAttribute('style');

      const newOrder = [...verseArea.querySelectorAll('.stack-verse-card')].map(c => parseInt(c.dataset.idx));
      const stacks = loadStacks();
      const st = stacks.find(s => s.id === finishStackId);
      if (st) {
        const valid = newOrder.length === st.verses.length
          && newOrder.every(i => Number.isInteger(i) && i >= 0 && i < st.verses.length)
          && new Set(newOrder).size === newOrder.length;
        if (valid) {
          st.verses = newOrder.map(i => st.verses[i]);
          saveStacks(stacks);
        }
        renderStackView(finishStackId);
      }
    }, 200);
  }

  verseArea.addEventListener('touchend', endDrag);
  verseArea.addEventListener('touchcancel', cancelDrag);
}

function addVerseToStack(stackId, verseData) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === stackId);
  if (!stack) return;
  if (stack.verses.some(v => (v.passages ? v.passages[0].ref : v.ref) === verseData.ref)) {
    showToast(`Already in "${stack.title}"`);
    return;
  }
  const passages = verseData.passages || [{ ref: verseData.ref, text: verseData.text }];
  stack.verses.push({ passages, note: '', addedAt: Date.now() });
  saveStacks(stacks);
  showToast(`Added to "${stack.title}"`);
  if (appMode === 'stacks' && activeStackId === stackId) {
    renderStackView(stackId);
    renderStacksList();
  } else {
    renderStacksList();
  }
}

// ── Toast ─────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

// ── Multi-select ──────────────────────────────────────
function toggleVerseSelection(verseData, rowEl, btn) {
  const idx = selectedVerses.findIndex(v => v.ref === verseData.ref);
  if (idx === -1) {
    selectedVerses.push(verseData);
    rowEl?.classList.add('selected');
    if (btn) btn.textContent = '✓';
  } else {
    selectedVerses.splice(idx, 1);
    rowEl?.classList.remove('selected');
    if (btn) btn.textContent = '+';
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  let bar = document.getElementById('selection-bar');
  if (selectedVerses.length === 0) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'selection-bar';
    bar.className = 'selection-bar';
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('open'));
  }
  bar.innerHTML = `
    <span class="sel-count">${selectedVerses.length} verse${selectedVerses.length !== 1 ? 's' : ''} selected</span>
    <button class="sel-add-btn">Add to Stack</button>
    <button class="sel-clear-btn" title="Clear selection">×</button>
  `;
  bar.querySelector('.sel-add-btn').addEventListener('click', e => {
    e.stopPropagation();
    openStackPicker();
  });
  bar.querySelector('.sel-clear-btn').addEventListener('click', clearSelection);
}

function dismissSelectionBar() {
  const bar = document.getElementById('selection-bar');
  if (!bar) return;
  bar.classList.remove('open');
  setTimeout(() => bar.remove(), 400);
}

function clearSelection() {
  selectedVerses = [];
  document.querySelectorAll('.verse-row.selected, .result-item.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.add-btn').forEach(btn => btn.textContent = '+');
  dismissSelectionBar();
}

// ── Combine selected verses into one card ─────────────
function buildCombinedVerseData(verses) {
  if (verses.length === 1) return verses[0];

  const sorted = [...verses].sort((a, b) => {
    if (a.book !== b.book) return a.book.localeCompare(b.book);
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
  });

  const sameChapter = sorted.every(v => v.book === sorted[0].book && v.chapter === sorted[0].chapter);
  let ref;
  if (sameChapter) {
    const nums = sorted.map(v => v.verse);
    const consecutive = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    ref = consecutive
      ? `${sorted[0].book} ${sorted[0].chapter}:${nums[0]}–${nums[nums.length - 1]}`
      : `${sorted[0].book} ${sorted[0].chapter}:${nums.join(', ')}`;
  } else {
    ref = sorted.map(v => v.ref).join('; ');
  }

  return {
    ref,
    book: sorted[0].book,
    chapter: sorted[0].chapter,
    verse: sorted[0].verse,
    text: sorted.map(v => v.text).join(' '),
    passages: sorted.map(v => ({ ref: v.ref, text: v.text }))
  };
}

// ── Stack picker popup ────────────────────────────────
function openStackPicker() {
  closeStackPicker();
  const stacks = loadStacks();
  const versesToAdd = [...selectedVerses];

  const picker = document.createElement('div');
  picker.className = 'stack-picker';

  if (stacks.length === 0) {
    picker.innerHTML = `
      <div class="stack-picker-empty">No stacks yet</div>
      <button class="stack-picker-new">+ New Stack</button>
    `;
  } else {
    picker.innerHTML =
      stacks.map(s => `<div class="stack-picker-item" data-id="${escHtml(s.id)}">${escHtml(s.title)}</div>`).join('') +
      `<div class="stack-picker-divider"></div>
       <button class="stack-picker-new">+ New Stack</button>`;
  }

  document.body.appendChild(picker);
  activePicker = picker;

  // Position above selection bar
  picker.style.position = 'fixed';
  picker.style.bottom = 'max(72px, calc(72px + env(safe-area-inset-bottom)))';
  picker.style.left = '50%';
  picker.style.transform = 'translateX(-50%)';

  picker.querySelectorAll('.stack-picker-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      addVerseToStack(item.dataset.id, buildCombinedVerseData(versesToAdd));
      closeStackPicker();
      clearSelection();
    });
  });

  picker.querySelector('.stack-picker-new').addEventListener('click', async e => {
    e.stopPropagation();
    closeStackPicker();
    const title = await showPrompt('Name your stack', 'e.g. Healing, Faith, Promises…');
    if (!title) return;
    const stks = loadStacks();
    const newStack = { id: genId(), title, verses: [], createdAt: Date.now() };
    stks.push(newStack);
    saveStacks(stks);
    addVerseToStack(newStack.id, buildCombinedVerseData(versesToAdd));
    clearSelection();
  });

  setTimeout(() => {
    document.addEventListener('click', closeStackPicker, { once: true });
  }, 0);
}

function closeStackPicker() {
  if (activePicker) { activePicker.remove(); activePicker = null; }
}

// ══════════════════════════════════════════════════════
//  READER SETTINGS
// ══════════════════════════════════════════════════════

const FONTS = [
  { name: 'Source Serif 4',    stack: "'Source Serif 4', Georgia, serif" },
  { name: 'Lora',              stack: "'Lora', Georgia, serif" },
  { name: 'Merriweather',      stack: "'Merriweather', Georgia, serif" },
  { name: 'Playfair Display',  stack: "'Playfair Display', Georgia, serif" },
  { name: 'EB Garamond',       stack: "'EB Garamond', Georgia, serif" },
  { name: 'Crimson Pro',       stack: "'Crimson Pro', Georgia, serif" },
  { name: 'Libre Baskerville', stack: "'Libre Baskerville', Georgia, serif" },
  { name: 'Cormorant Garamond',stack: "'Cormorant Garamond', Georgia, serif" },
  { name: 'Spectral',          stack: "'Spectral', Georgia, serif" },
  { name: 'Vollkorn',          stack: "'Vollkorn', Georgia, serif" },
  { name: 'Bitter',            stack: "'Bitter', Georgia, serif" },
  { name: 'PT Serif',          stack: "'PT Serif', Georgia, serif" },
  { name: 'Noto Serif',        stack: "'Noto Serif', Georgia, serif" },
  { name: 'Inter',             stack: "'Inter', system-ui, sans-serif" },
  { name: 'Roboto',            stack: "'Roboto', system-ui, sans-serif" },
  { name: 'Open Sans',         stack: "'Open Sans', system-ui, sans-serif" },
  { name: 'Lato',              stack: "'Lato', system-ui, sans-serif" },
  { name: 'Nunito',            stack: "'Nunito', system-ui, sans-serif" },
  { name: 'Raleway',           stack: "'Raleway', system-ui, sans-serif" },
  { name: 'Josefin Sans',      stack: "'Josefin Sans', system-ui, sans-serif" },
];

const settingsBtn   = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const spFontList    = document.getElementById('sp-font-list');

function closeSettings() {
  settingsPanel.classList.add('hidden');
  settingsBtn.classList.remove('active');
  settingsBackdrop.remove();
}
settingsClose.addEventListener('click', closeSettings);

// ── Load saved settings ───────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('reader_settings') || '{}'); }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem('reader_settings', JSON.stringify(s)); }

function applySettings(s) {
  // Theme
  document.body.classList.toggle('theme-dark', s.theme === 'dark');
  document.querySelector('meta[name="theme-color"]').content = s.theme === 'dark' ? '#0c0c10' : '#e74252';
  // Font
  const font = FONTS.find(f => f.name === s.font) || FONTS[0];
  document.documentElement.style.setProperty('--font-read', font.stack);
  // Size
  if (s.size) document.documentElement.style.setProperty('--reader-size', s.size);
  // Spacing
  if (s.spacing) document.documentElement.style.setProperty('--reader-spacing', s.spacing);
}

// ── Build font list ───────────────────────────────────
function buildFontList(currentFont) {
  spFontList.innerHTML = '';
  FONTS.forEach(f => {
    const div = document.createElement('div');
    div.className = 'sp-font-item' + (f.name === currentFont ? ' active' : '');
    div.style.fontFamily = f.stack;
    div.innerHTML = `<span>${escHtml(f.name)}</span><span class="sp-check">✓</span>`;
    div.addEventListener('click', () => {
      const s = loadSettings(); s.font = f.name; saveSettings(s); applySettings(s);
      spFontList.querySelectorAll('.sp-font-item').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
    });
    spFontList.appendChild(div);
  });
}

// ── Toggle panel (handled above near backdrop) ────────

// Backdrop to close settings
const settingsBackdrop = document.createElement('div');
settingsBackdrop.style.cssText = 'position:fixed;inset:0;z-index:499;';
settingsBackdrop.addEventListener('click', closeSettings);

settingsBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = !settingsPanel.classList.contains('hidden');
  if (isOpen) {
    settingsPanel.classList.add('hidden');
    settingsBtn.classList.remove('active');
    settingsBackdrop.remove();
  } else {
    const s = loadSettings();
    buildFontList(s.font || 'Source Serif 4');
    syncPanelUI(s);
    settingsPanel.classList.remove('hidden');
    settingsBtn.classList.add('active');
    document.body.appendChild(settingsBackdrop);
  }
});

function syncPanelUI(s) {
  document.querySelectorAll('.sp-theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === (s.theme || 'light'));
  });
  document.querySelectorAll('.sp-size-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === (s.size || '1.08rem'));
  });
  document.querySelectorAll('.sp-spacing-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.spacing === (s.spacing || '2.1'));
  });
}

// ── Theme buttons ─────────────────────────────────────
document.querySelectorAll('.sp-theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = loadSettings(); s.theme = btn.dataset.theme; saveSettings(s); applySettings(s);
    document.querySelectorAll('.sp-theme-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// ── Size buttons ──────────────────────────────────────
document.querySelectorAll('.sp-size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = loadSettings(); s.size = btn.dataset.size; saveSettings(s); applySettings(s);
    document.querySelectorAll('.sp-size-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// ── Spacing buttons ───────────────────────────────────
document.querySelectorAll('.sp-spacing-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = loadSettings(); s.spacing = btn.dataset.spacing; saveSettings(s); applySettings(s);
    document.querySelectorAll('.sp-spacing-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// ── Apply on boot ─────────────────────────────────────
applySettings(loadSettings());

// ── Start ─────────────────────────────────────────────
init();
