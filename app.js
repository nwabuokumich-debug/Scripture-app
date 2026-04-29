import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ── Init ─────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DOM refs ─────────────────────────────────────────
const biblePane          = document.getElementById('bible-pane');
const stacksPane         = document.getElementById('stacks-pane');
const bibleContent       = document.getElementById('bible-content');
const stacksContent      = document.getElementById('stacks-content');
const verseArea          = document.getElementById('verse-area');
const chapterBar         = document.getElementById('chapter-bar');
const bookList           = document.getElementById('book-list');
const stackList          = document.getElementById('stack-list');
const stackDetail        = document.getElementById('stack-detail');
const stacksSummary      = document.getElementById('stacks-summary');
const greekPage          = document.getElementById('greek-page');
const searchInput        = document.getElementById('search-input');
const searchBtn          = document.getElementById('search-btn');
const searchOpenBtn      = document.getElementById('search-open');
const searchCloseBtn     = document.getElementById('search-close');
const searchResults      = document.getElementById('search-results');
const accountBtn         = document.getElementById('account-btn');
const otTab              = document.getElementById('tab-ot');
const ntTab              = document.getElementById('tab-nt');
const navBible           = document.getElementById('nav-bible');
const navStacks          = document.getElementById('nav-stacks');
const bottomNav          = document.querySelector('.bottom-nav');
const newStackBtn        = document.getElementById('new-stack-btn');
const importStacksBtn    = document.getElementById('import-stacks-btn');
const exportStacksBtn    = document.getElementById('export-stacks-btn');
const importStacksFile   = document.getElementById('import-stacks-file');
const authOpenBtn        = document.getElementById('auth-open-btn');
const translationLabel   = document.getElementById('translation-label');
const bookPickerBtn      = document.getElementById('book-picker-btn');
const bookChipTitle      = document.getElementById('book-chip-title');
const bookChipSub        = document.getElementById('book-chip-sub');
const bookSheetBackdrop  = document.getElementById('book-sheet-backdrop');
const bookSheet          = document.getElementById('book-sheet');
const bookSheetClose     = document.getElementById('book-sheet-close');
const bookSheetDragZone  = document.getElementById('book-sheet-drag-zone');
const searchSheetBackdrop = document.getElementById('search-sheet-backdrop');
const authBackdrop       = document.getElementById('auth-backdrop');
const authCopy           = document.getElementById('auth-copy');
const authEmailInput     = document.getElementById('auth-email');
const authPasswordInput  = document.getElementById('auth-password');
const authFeedback       = document.getElementById('auth-feedback');
const authSignInBtn      = document.getElementById('auth-sign-in');
const authSignUpBtn      = document.getElementById('auth-sign-up');
const authSignOutBtn     = document.getElementById('auth-sign-out');
const authCloseBtn       = document.getElementById('auth-close');

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
let verseActionMode = false;
let activeActionVerseNum = null;
let verseActionPressCleanup = null;
let suppressVerseTapUntil = 0;
let stackCompareMode = false;
let activeStackCompareIdx = null;
let stackCompareSelectedRefs = [];
let bookOrderMode   = localStorage.getItem('book_order_mode') || 'traditional';
let activeTranslation = localStorage.getItem('active_translation') || 'kjv';
const TRANSLATIONS  = { kjv: 'KJV', bsb: 'BSB', web: 'WEB', akjv: 'AKJV', ukjv: 'UKJV', mkjv: 'MKJV', litv: 'LITV', cpdv: 'CPDV', darby: 'Darby', webster: 'Webster', dra: 'DRA', ylt: 'YLT', asv: 'ASV', bbe: 'BBE', nheb: 'NHEB', jubilee: 'Jubilee', leb: 'LEB', rotherham: 'Rotherham' };
const chromeScrollState = new WeakMap();
const STACKS_STORAGE_KEY = 'study_stacks';
const STACKS_SYNC_DEBOUNCE_MS = 500;
let stacksCache      = [];
let authSession      = null;
let authUser         = null;
let stackSyncState   = 'local';
let stackSyncTimer   = null;
let stackSyncPromise = null;
let stackSyncWarned  = false;
// Migrate away from removed translations
if (!TRANSLATIONS[activeTranslation]) { activeTranslation = 'kjv'; localStorage.setItem('active_translation', 'kjv'); }
if (!['traditional', 'alphabetical'].includes(bookOrderMode)) bookOrderMode = 'traditional';
const cardTranslations = new Map(); // idx → translation override for stack cards

function triggerHaptic(pattern = 16) {
  // Prefer native haptics when running inside a Capacitor shell (iOS/Android app).
  try {
    const haptics = window?.Capacitor?.Plugins?.Haptics;
    if (haptics?.impact) {
      haptics.impact({ style: 'MEDIUM' });
      return true;
    }
    if (haptics?.vibrate) {
      const duration = Array.isArray(pattern)
        ? pattern.reduce((sum, ms) => sum + (Number(ms) || 0), 0)
        : (Number(pattern) || 16);
      haptics.vibrate({ duration: Math.max(1, Math.min(500, duration)) });
      return true;
    }
  } catch {}

  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
      return true;
    }
  } catch {}
  return false;
}

function openSheet(backdrop) {
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => backdrop.classList.add('open'));
}

function closeSheet(backdrop) {
  backdrop.classList.remove('open');
  setTimeout(() => backdrop.classList.add('hidden'), 380);
}

function syncBottomNavChrome() {
  const collapsed = appMode === 'stacks'
    ? stacksPane.classList.contains('chrome-collapsed')
    : biblePane.classList.contains('chrome-collapsed');
  bottomNav.classList.toggle('chrome-collapsed', collapsed);
}

function measurePaneChrome(pane) {
  const topBar = pane.querySelector('.top-bar');
  const chapterRail = pane.querySelector('.chapter-bar');
  const topBarHeight = topBar?.offsetHeight ?? 0;
  const chromeHeight = topBarHeight + (chapterRail?.offsetHeight ?? 0);
  pane.style.setProperty('--pane-top-bar-h', `${topBarHeight}px`);
  pane.style.setProperty('--pane-top-chrome-h', `${chromeHeight}px`);
}

function measureAllPaneChrome() {
  measurePaneChrome(biblePane);
  measurePaneChrome(stacksPane);
}

function schedulePaneChromeMeasure() {
  requestAnimationFrame(measureAllPaneChrome);
}

if (typeof ResizeObserver !== 'undefined') {
  const chromeObserver = new ResizeObserver(schedulePaneChromeMeasure);
  [biblePane, stacksPane].forEach(pane => {
    const topBar = pane.querySelector('.top-bar');
    const chapterRail = pane.querySelector('.chapter-bar');
    if (topBar) chromeObserver.observe(topBar);
    if (chapterRail) chromeObserver.observe(chapterRail);
  });
}
window.addEventListener('resize', schedulePaneChromeMeasure, { passive: true });

function setPaneChromeCollapsed(pane, collapsed) {
  pane.classList.toggle('chrome-collapsed', collapsed);
  if ((pane === biblePane && appMode === 'bible') || (pane === stacksPane && appMode === 'stacks')) {
    syncBottomNavChrome();
  }
}

function showPaneChrome(pane) {
  setPaneChromeCollapsed(pane, false);
}

function showActivePaneChrome() {
  showPaneChrome(appMode === 'stacks' ? stacksPane : biblePane);
}

function resetChromeScroll(container, pane) {
  const state = chromeScrollState.get(container);
  if (state) {
    state.lastTop = container.scrollTop;
    state.lastDirection = '';
    state.distance = 0;
  }
  showPaneChrome(pane);
}

function bindPaneChromeScroll(
  container,
  pane,
  { minScrollTop = 72, hideDistance = 36, showDistance = 18, toggleCooldownMs = 260 } = {}
) {
  const state = { lastTop: 0, lastDirection: '', distance: 0, ticking: false, lastToggleAt: 0 };
  chromeScrollState.set(container, state);

  container.addEventListener('scroll', () => {
    if (state.ticking) return;
    state.ticking = true;

    requestAnimationFrame(() => {
      state.ticking = false;

      const top = container.scrollTop;
      const delta = top - state.lastTop;

      if (top <= 8) {
        state.lastTop = top;
        state.lastDirection = '';
        state.distance = 0;
        showPaneChrome(pane);
        return;
      }

      if (Math.abs(delta) < 2) {
        state.lastTop = top;
        return;
      }

      const direction = delta > 0 ? 'down' : 'up';
      if (direction !== state.lastDirection) {
        state.lastDirection = direction;
        state.distance = 0;
      }
      state.distance += Math.abs(delta);

      const now = Date.now();
      const canToggle = now - state.lastToggleAt >= toggleCooldownMs;

      if (direction === 'down' && top >= minScrollTop && state.distance >= hideDistance) {
        if (canToggle && !pane.classList.contains('chrome-collapsed')) {
          setPaneChromeCollapsed(pane, true);
          state.lastToggleAt = now;
        }
        state.distance = 0;
      } else if (direction === 'up' && state.distance >= showDistance) {
        if (canToggle && pane.classList.contains('chrome-collapsed')) {
          showPaneChrome(pane);
          state.lastToggleAt = now;
        }
        state.distance = 0;
      }

      state.lastTop = top;
    });
  }, { passive: true });
}

function openBookSheet() {
  showPaneChrome(biblePane);
  syncBookOrderTabs();
  renderBookList();
  resetBookSheetInlineMotion();
  bookSheet.classList.remove('dragging');
  openSheet(bookSheetBackdrop);
}

function closeBookSheet() {
  resetBookSheetInlineMotion();
  bookSheet.classList.remove('dragging');
  closeSheet(bookSheetBackdrop);
}

function openSearchSheet() {
  showPaneChrome(biblePane);
  openSheet(searchSheetBackdrop);
  setTimeout(() => searchInput.focus(), 60);
}

function closeSearchSheet() {
  closeSheet(searchSheetBackdrop);
}

const BOOK_SHEET_BACKDROP_OPACITY = 0.42;
const BOOK_SHEET_SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const BOOK_SHEET_MIN_SNAP_MS = 280;
const BOOK_SHEET_MAX_SNAP_MS = 500;

function getBookSheetTravel() {
  return Math.max(bookSheet.getBoundingClientRect().height || 0, 320);
}

function setBookSheetOffset(offsetY) {
  const travel = getBookSheetTravel();
  const clamped = Math.max(0, offsetY);
  const progress = Math.min(clamped / travel, 1);
  bookSheet.style.transform = `translateY(${clamped}px)`;
  bookSheetBackdrop.style.background = `rgba(12,12,18,${BOOK_SHEET_BACKDROP_OPACITY * (1 - progress)})`;
}

function resetBookSheetInlineMotion() {
  bookSheet.style.transform = '';
  bookSheet.style.transition = '';
  bookSheetBackdrop.style.background = '';
  bookSheetBackdrop.style.transition = '';
}

function finishBookSheetCloseImmediately() {
  resetBookSheetInlineMotion();
  bookSheet.classList.remove('dragging');
  bookSheetBackdrop.classList.remove('open');
  bookSheetBackdrop.classList.add('hidden');
}

function snapBookSheetTo(offsetY, onComplete) {
  const currentOffset = Math.max(0, dragYForBookSheet());
  const distance = Math.abs(offsetY - currentOffset);
  const duration = Math.round(Math.max(
    BOOK_SHEET_MIN_SNAP_MS,
    Math.min(BOOK_SHEET_MAX_SNAP_MS, 280 + distance * 0.36)
  ));

  bookSheet.style.transition = `transform ${duration}ms ${BOOK_SHEET_SNAP_EASING}`;
  bookSheetBackdrop.style.transition = `background ${duration}ms ${BOOK_SHEET_SNAP_EASING}`;

  requestAnimationFrame(() => setBookSheetOffset(offsetY));

  return window.setTimeout(() => {
    onComplete?.();
  }, duration);
}

function dragYForBookSheet() {
  const match = bookSheet.style.transform.match(/translateY\(([-\d.]+)px\)/);
  return match ? Number(match[1]) : 0;
}

bookSheetClose?.addEventListener('click', closeBookSheet);
bookSheetBackdrop.addEventListener('click', e => {
  if (e.target === bookSheetBackdrop) closeBookSheet();
});
bookSheetBackdrop.addEventListener('touchend', e => {
  if (e.target === bookSheetBackdrop) closeBookSheet();
}, { passive: true });
searchCloseBtn.addEventListener('click', closeSearchSheet);
searchSheetBackdrop.addEventListener('click', e => {
  if (e.target === searchSheetBackdrop) closeSearchSheet();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeBookSheet();
    closeSearchSheet();
    closeAuthModal();
  }
});
bookPickerBtn.addEventListener('click', openBookSheet);
searchOpenBtn.addEventListener('click', openSearchSheet);
accountBtn.addEventListener('click', openAuthModal);
authOpenBtn.addEventListener('click', openAuthModal);
importStacksBtn.addEventListener('click', () => {
  setAuthFeedback('');
  importStacksFile.value = '';
  importStacksFile.click();
});
exportStacksBtn.addEventListener('click', downloadStacksExport);
authCloseBtn.addEventListener('click', closeAuthModal);
authBackdrop.addEventListener('click', e => {
  if (e.target === authBackdrop) closeAuthModal();
});
authSignInBtn.addEventListener('click', () => { void handleAuthSubmit('sign-in'); });
authSignUpBtn.addEventListener('click', () => { void handleAuthSubmit('sign-up'); });
authSignOutBtn.addEventListener('click', () => { void handleSignOut(); });
authPasswordInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !authUser) {
    e.preventDefault();
    void handleAuthSubmit('sign-in');
  }
});
importStacksFile.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importStacksFromText(text);
  } catch (error) {
    console.error('Stack import failed', error);
    showToast('Import failed while reading file');
  } finally {
    importStacksFile.value = '';
  }
});

// Native-feeling pull-down dismiss for the books sheet.
{
  let startY = 0;
  let dragY = 0;
  let dragging = false;
  let snapTimer = null;

  bookSheetDragZone.addEventListener('touchstart', e => {
    if (bookSheetBackdrop.classList.contains('hidden')) return;
    if (e.touches.length !== 1) return;
    if (snapTimer) {
      clearTimeout(snapTimer);
      snapTimer = null;
    }
    dragging = true;
    startY = e.touches[0].clientY;
    dragY = 0;
    bookSheet.style.transition = 'none';
    bookSheetBackdrop.style.transition = 'none';
    bookSheet.classList.add('dragging');
  }, { passive: true });

  bookSheetDragZone.addEventListener('touchmove', e => {
    if (!dragging) return;
    const touchY = e.touches[0].clientY;
    const rawY = Math.max(0, touchY - startY);
    const travel = getBookSheetTravel();
    const overshoot = Math.max(0, rawY - travel);
    const nextY = overshoot > 0 ? travel + overshoot * 0.18 : rawY;
    dragY = nextY;
    setBookSheetOffset(nextY);
  }, { passive: true });

  function finishBookSheetDrag(shouldClose) {
    if (!dragging) return;
    dragging = false;
    const travel = getBookSheetTravel();
    const openProgress = 1 - Math.min(dragY / travel, 1);
    const shouldSnapClosed = shouldClose && openProgress <= 0.5;

    if (snapTimer) clearTimeout(snapTimer);

    snapTimer = snapBookSheetTo(shouldSnapClosed ? travel : 0, () => {
      snapTimer = null;
      if (shouldSnapClosed) finishBookSheetCloseImmediately();
      else {
        resetBookSheetInlineMotion();
        bookSheet.classList.remove('dragging');
      }
    });
  }

  bookSheetDragZone.addEventListener('touchend', () => finishBookSheetDrag(true), { passive: true });
  bookSheetDragZone.addEventListener('touchcancel', () => finishBookSheetDrag(false), { passive: true });
}

// ── Translation picker ────────────────────────────────
let activeTranslationPicker = null;
let activeTranslationPickerAnchor = null;

function openTranslationPicker(anchorEl, currentKey, onSelect) {
  showPaneChrome(biblePane);
  if (activeTranslationPicker && activeTranslationPickerAnchor === anchorEl) {
    closeTranslationPicker();
    return;
  }
  closeTranslationPicker();
  const picker = document.createElement('div');
  picker.className = 'translation-picker';
  picker.style.cssText = ''; // positioning handled by CSS
  picker.innerHTML = `<div class="translation-picker-title">Select Translation</div>` +
    Object.entries(TRANSLATIONS).map(([key, label]) => `
    <div class="translation-picker-item${key === currentKey ? ' active' : ''}" data-key="${key}">${label}</div>
  `).join('');
  document.body.appendChild(picker);
  activeTranslationPicker = picker;
  activeTranslationPickerAnchor = anchorEl;
  requestAnimationFrame(() => picker.classList.add('open'));

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
  if (!activeTranslationPicker) return;
  const picker = activeTranslationPicker;
  activeTranslationPicker = null;
  activeTranslationPickerAnchor = null;
  picker.classList.remove('open');
  setTimeout(() => picker.remove(), 380);
}

translationLabel.textContent = TRANSLATIONS[activeTranslation] || activeTranslation.toUpperCase();
translationLabel.addEventListener('click', e => {
  e.stopPropagation();
  openTranslationPicker(translationLabel, activeTranslation, key => {
    activeTranslation = key;
    localStorage.setItem('active_translation', key);
    translationLabel.textContent = TRANSLATIONS[key];
    document.title = `Scripture Search — ${TRANSLATIONS[key]} Bible`;
    updateBibleChrome();
    if (activeBook && activeChapter) selectChapter(activeChapter);
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
function getCurrentVerseData(vnum) {
  const verse = currentVerses.find(v => v.verse === vnum);
  if (!verse || !activeBook || !activeChapter) return null;
  return {
    ref: `${activeBook.name} ${activeChapter}:${vnum}`,
    book: activeBook.name,
    chapter: activeChapter,
    verse: vnum,
    text: verse.text
  };
}

function getTestamentLabel(testament = activeTestament) {
  return testament === 'new' ? 'New Testament' : 'Old Testament';
}

function updateBibleChrome() {
  translationLabel.textContent = TRANSLATIONS[activeTranslation] || activeTranslation.toUpperCase();
  bookChipTitle.textContent = activeBook?.name || 'Choose Book';
  if (activeBook && activeChapter) {
    bookChipSub.textContent = `Chapter ${activeChapter} • ${getTestamentLabel(activeBook.testament)}`;
  } else {
    bookChipSub.textContent = getTestamentLabel(activeBook?.testament || activeTestament);
  }
}

function syncBookOrderTabs() {
  otTab.classList.toggle('active', bookOrderMode === 'traditional');
  ntTab.classList.toggle('active', bookOrderMode === 'alphabetical');
}

function setBookOrderMode(mode) {
  if (bookOrderMode === mode) return;
  bookOrderMode = mode;
  localStorage.setItem('book_order_mode', mode);
  syncBookOrderTabs();
  renderBookList();
}

function getOrderedBooks() {
  const books = [...allBooks];
  if (bookOrderMode === 'alphabetical') {
    return books.sort((a, b) => a.name.localeCompare(b.name));
  }
  return books;
}

function updateNavState() {
  const onBible = appMode === 'bible';
  biblePane.classList.toggle('is-active', onBible);
  stacksPane.classList.toggle('is-active', !onBible);
  biblePane.setAttribute('aria-hidden', String(!onBible));
  stacksPane.setAttribute('aria-hidden', String(onBible));
  navBible.classList.toggle('active', onBible);
  navStacks.classList.toggle('active', !onBible);
  navBible.setAttribute('aria-current', onBible ? 'page' : 'false');
  navStacks.setAttribute('aria-current', onBible ? 'false' : 'page');
}

function updateSearchEmptyState(message = 'Search within the selected translation or jump to a passage reference.') {
  searchResults.innerHTML = `<div class="search-empty">${escHtml(message)}</div>`;
}

function focusVerseRow(verseNum) {
  const row = verseArea.querySelector(`.verse-row[data-vnum="${verseNum}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('verse-focus');
  setTimeout(() => row.classList.remove('verse-focus'), 1400);
}

function focusVerseRange(startVerse, endVerse = startVerse) {
  focusVerseRow(startVerse);
  for (let verseNum = startVerse; verseNum <= endVerse; verseNum += 1) {
    const row = verseArea.querySelector(`.verse-row[data-vnum="${verseNum}"]`);
    if (!row) continue;
    row.classList.add('verse-focus');
    setTimeout(() => row.classList.remove('verse-focus'), 1400);
  }
}

function countStackPassages(stack) {
  return (stack?.verses || []).reduce((sum, card) => {
    const passages = card.passages ?? [{ ref: card.ref, text: card.text }];
    return sum + passages.length;
  }, 0);
}

function renderStacksSummary() {
  const stacks = loadStacks();
  const totalCards = stacks.reduce((sum, stack) => sum + stack.verses.length, 0);
  const totalPassages = stacks.reduce((sum, stack) => sum + countStackPassages(stack), 0);
  const activeStack = stacks.find(stack => stack.id === activeStackId);
  const syncMeta = getStackSyncMeta();
  const signedOutCta = !authUser
    ? `<button class="summary-inline-cta" type="button" id="summary-sign-in-btn">Set up sync</button>`
    : '';

  if (!stacks.length) {
    stacksSummary.innerHTML = `
      <div class="stacks-summary-card empty">
        <div class="stacks-summary-kicker">Collections</div>
        <h2>Build your first stack.</h2>
        <p>Save verses from the reader, collect grouped passages, and keep notes together.${authUser ? ' Your account is ready to sync them.' : ' Sign in when you want them on every device.'}</p>
        <button class="summary-cta" type="button" id="summary-new-stack-btn">Create Stack</button>
      </div>
    `;
    stacksSummary.querySelector('#summary-new-stack-btn')?.addEventListener('click', () => newStackBtn.click());
    return;
  }

  stacksSummary.innerHTML = `
    <div class="stacks-summary-card compact">
      <div class="stacks-summary-copy">
        <div class="stacks-summary-kicker">Collections</div>
        <h2>${totalPassages} saved passage${totalPassages !== 1 ? 's' : ''}</h2>
        <p>${totalCards} card${totalCards !== 1 ? 's' : ''} across ${stacks.length} stack${stacks.length !== 1 ? 's' : ''}${activeStack ? ` · Open: ${escHtml(activeStack.title)}` : ''}${authUser ? ` · ${escHtml(authUser.email)}` : ''}.</p>
        ${signedOutCta}
      </div>
      <div class="stacks-summary-meta">
        <span class="summary-meta-pill">${stacks.length} stack${stacks.length !== 1 ? 's' : ''}</span>
        <span class="summary-meta-pill">${totalCards} card${totalCards !== 1 ? 's' : ''}</span>
        <span class="summary-meta-pill ${syncMeta.className}">${syncMeta.label}</span>
        ${activeStack ? `<span class="summary-meta-pill is-active">Open now</span>` : ''}
      </div>
    </div>
  `;

  stacksSummary.querySelector('#summary-sign-in-btn')?.addEventListener('click', openAuthModal);
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
async function initAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error('Auth session lookup failed', error);

  await applyAuthSession(data?.session ?? null);

  supabase.auth.onAuthStateChange((_event, session) => {
    void applyAuthSession(session);
  });
}

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
  await initAuth();
  await migrateOldPassages();
  syncBookOrderTabs();
  updateBibleChrome();
  refreshAuthUi();
  renderBookList();
  renderStacksSummary();
  renderStacksList();
  updateNavState();
  updateSearchEmptyState();
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
  const ordered = getOrderedBooks();
  if (!ordered.length) {
    bookList.innerHTML = `<div class="book-empty">No books available.</div>`;
    return;
  }

  ordered.forEach(book => {
    const button = document.createElement('button');
    button.className = 'book-item' + (activeBook?.id === book.id ? ' active' : '');
    button.type = 'button';
    button.innerHTML = `<span class="book-item-label">${escHtml(book.name)}</span>`;
    button.addEventListener('click', () => selectBook(book));
    bookList.appendChild(button);
  });

  const activeRow = bookList.querySelector('.book-item.active');
  if (activeRow) {
    requestAnimationFrame(() => activeRow.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
}

// ── Select book ───────────────────────────────────────
async function selectBook(book) {
  appMode = 'bible';
  updateNavState();
  activeTestament = book.testament;
  activeBook = book;
  activeChapter = null;
  updateBibleChrome();
  renderBookList();
  closeBookSheet();

  const { data } = await supabase
    .from('verses')
    .select('chapter')
    .eq('book_id', book.id)
    .eq('translation', activeTranslation)
    .order('chapter', { ascending: false })
    .limit(1);

  const totalChapters = data?.[0]?.chapter ?? 1;
  renderChapterBar(totalChapters);
  await selectChapter(1);
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
  schedulePaneChromeMeasure();
}

// ── Select chapter ────────────────────────────────────
async function selectChapter(num) {
  if (!activeBook) return;
  activeChapter = num;
  updateBibleChrome();

  chapterBar.querySelectorAll('.chapter-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i + 1 === num);
    if (i + 1 === num) {
      btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
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
  if (selectedVerses.length) clearSelection();
  currentVerses = verses;
  const isNT = activeBook.testament === 'new';
  const hasGreekChapter = Object.keys(greekByVerse).length > 0;
  let html = `
    <section class="reader-hero">
      <div class="reader-kicker">${getTestamentLabel(activeBook.testament)}</div>
      <div class="book-title">${escHtml(activeBook.name)}</div>
      <div class="reader-meta">
        <span class="reader-meta-pill">Chapter ${activeChapter}</span>
        <span class="reader-meta-pill">${TRANSLATIONS[activeTranslation]}</span>
        ${hasGreekChapter ? '<span class="reader-meta-pill">Greek Study Ready</span>' : ''}
      </div>
    </section>
    <section class="scripture-card">
  `;
  verses.forEach(v => {
    const greekWords = greekByVerse[v.verse] ?? [];
    const hasGreek = isNT && greekWords.length > 0;
    html += `
      <div class="verse-row${hasGreek ? ' has-greek' : ''}" ${hasGreek ? `data-verse="${v.verse}"` : ''} data-vnum="${v.verse}">
        <span class="verse-num">${v.verse}</span>
        <span class="verse-text">${escHtml(v.text)}</span>
      </div>
    `;
  });
  html += `</section>`;
  verseArea.innerHTML = html;

  bibleContent.scrollTop = 0;
  resetChromeScroll(bibleContent, biblePane);
}

// ── Compare translations ───────────────────────────────
const compareBackdrop = document.getElementById('compare-backdrop');
const compareSheet    = document.getElementById('compare-sheet');
const compareRef      = document.getElementById('compare-ref');
const compareBody     = document.getElementById('compare-body');

function sortVersesForCompare(verses) {
  return [...verses].sort((a, b) => {
    if (a.book !== b.book) return a.book.localeCompare(b.book);
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
  });
}

function renderCompareTranslationRows(byTranslation) {
  return Object.entries(TRANSLATIONS).map(([key, label]) => {
    const text = byTranslation[key];
    if (!text) return '';
    return `
      <div class="compare-row">
        <div class="compare-label">${label}</div>
        <div class="compare-text">${escHtml(text)}</div>
      </div>`;
  }).join('');
}

function formatComparePassageMarker(verseRow, anchor) {
  if (!anchor || verseRow.book !== anchor.book) return verseRow.ref;
  if (verseRow.chapter !== anchor.chapter) return `${verseRow.chapter}:${verseRow.verse}`;
  return String(verseRow.verse);
}

function renderComparePassageRows(rows, anchor) {
  return rows.map(row => `
    <div class="compare-passage-verse">
      <div class="compare-passage-marker">${escHtml(formatComparePassageMarker(row, anchor))}</div>
      <div class="compare-passage-text">${escHtml(row.text)}</div>
    </div>
  `).join('');
}

function closeCompare() {
  compareBackdrop.classList.remove('open');
  setTimeout(() => compareBackdrop.classList.add('hidden'), 380);
  if (stackCompareMode) clearStackCompareMode();
  else dismissStackCompareBar();
  if (verseActionMode) clearSelection();
  else dismissSelectionBar();
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

  const byTranslation = Object.fromEntries(data.map(r => [r.translation, r.text]));
  compareBody.innerHTML = renderCompareTranslationRows(byTranslation);
}

async function openCompareSelectedVerses(verses) {
  const sorted = sortVersesForCompare(verses);
  if (!sorted.length) return;

  compareRef.textContent = buildCombinedVerseData(sorted).ref;
  compareBody.innerHTML = '<div class="compare-loading"><span class="spinner"></span> Loading…</div>';
  compareBackdrop.classList.remove('hidden');
  requestAnimationFrame(() => compareBackdrop.classList.add('open'));

  const sections = await Promise.all(sorted.map(async verse => {
    const book = allBooks.find(b => b.name === verse.book) ?? activeBook;
    if (!book) {
      return null;
    }

    const { data, error } = await supabase
      .from('verses')
      .select('translation, text')
      .eq('book_id', book.id)
      .eq('chapter', verse.chapter)
      .eq('verse', verse.verse)
      .order('translation');

    if (error || !data?.length) {
      return null;
    }

    return {
      verse,
      rows: data.map(r => ({ translation: r.translation, text: r.text }))
    };
  }));

  const grouped = new Map();
  sections.filter(Boolean).forEach(section => {
    section.rows.forEach(row => {
      if (!grouped.has(row.translation)) grouped.set(row.translation, []);
      grouped.get(row.translation).push({
        ref: section.verse.ref,
        book: section.verse.book,
        chapter: section.verse.chapter,
        verse: section.verse.verse,
        text: row.text
      });
    });
  });

  if (grouped.size === 0) {
    compareBody.innerHTML = '<div class="compare-loading">No data found.</div>';
    return;
  }

  compareBody.innerHTML = Object.entries(TRANSLATIONS).map(([key, label]) => {
    const rows = grouped.get(key);
    if (!rows?.length) return '';
    return `
      <section class="compare-section">
        <div class="compare-section-ref">${label}</div>
        <div class="compare-passage">
          ${renderComparePassageRows(rows, sorted[0])}
        </div>
      </section>`;
  }).join('');
}

function parsePassageRef(ref) {
  const m = String(ref ?? '').match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!m) return null;
  const [, bookName, chapter, verse] = m;
  const book = allBooks.find(b => b.name.toLowerCase() === bookName.toLowerCase());
  if (!book) return null;
  return {
    ref: String(ref),
    book: book.name,
    chapter: parseInt(chapter),
    verse: parseInt(verse)
  };
}

function getActiveStackCard() {
  if (!stackCompareMode || activeStackCompareIdx == null || activeStackId == null) return null;
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === activeStackId);
  const card = stack?.verses?.[activeStackCompareIdx];
  if (!stack || !card) return null;
  return { stack, card, idx: activeStackCompareIdx };
}

function getActiveStackComparePassages() {
  const active = getActiveStackCard();
  if (!active) return [];
  const passages = active.card.passages ?? [{ ref: active.card.ref, text: active.card.text }];
  const selected = stackCompareSelectedRefs.length
    ? passages.filter(p => stackCompareSelectedRefs.includes(p.ref))
    : passages;
  return selected
    .map(p => {
      const parsed = parsePassageRef(p.ref);
      if (!parsed) return null;
      return { ...parsed, text: p.text };
    })
    .filter(Boolean);
}

function syncStackCompareRows() {
  stackDetail.querySelectorAll('.stack-verse-card.action-active').forEach(card => card.classList.remove('action-active'));
  stackDetail.querySelectorAll('.stack-verse-row.stack-selected').forEach(row => row.classList.remove('stack-selected'));

  const active = getActiveStackCard();
  if (!active) return;

  const passages = active.card.passages ?? [{ ref: active.card.ref, text: active.card.text }];
  const validRefs = new Set(passages.map(p => p.ref));
  if (stackCompareSelectedRefs.length) {
    stackCompareSelectedRefs = stackCompareSelectedRefs.filter(ref => validRefs.has(ref));
  }

  const card = stackDetail.querySelector(`.stack-verse-card[data-idx="${active.idx}"]`);
  if (!card) return;
  card.classList.add('action-active');

  if (!stackCompareSelectedRefs.length) return;
  const selected = new Set(stackCompareSelectedRefs);
  card.querySelectorAll('.stack-verse-row').forEach(row => {
    if (selected.has(row.dataset.passageRef)) {
      row.classList.add('stack-selected');
    }
  });
}

function dismissStackCompareBar() {
  const bar = document.getElementById('stack-selection-bar');
  if (!bar) return;
  bar.dataset.dismissed = 'true';
  bar.classList.remove('open');
  setTimeout(() => {
    if (bar.dataset.dismissed === 'true') bar.remove();
  }, 400);
}

function clearStackCompareMode() {
  stackCompareMode = false;
  activeStackCompareIdx = null;
  stackCompareSelectedRefs = [];
  syncStackCompareRows();
  dismissStackCompareBar();
}

function startStackCompareMode(cardIdx) {
  const nextIdx = parseInt(cardIdx);
  if (Number.isNaN(nextIdx)) return;
  clearSelection();
  if (activeStackCompareIdx !== nextIdx) {
    stackCompareSelectedRefs = [];
  }
  stackCompareMode = true;
  activeStackCompareIdx = nextIdx;
  syncStackCompareRows();
  updateStackCompareBar();
}

function toggleStackComparePassage(cardIdx, passageRef) {
  if (!stackCompareMode || activeStackCompareIdx !== parseInt(cardIdx)) return;
  const ref = String(passageRef ?? '');
  if (!ref) return;
  const idx = stackCompareSelectedRefs.indexOf(ref);
  if (idx === -1) {
    stackCompareSelectedRefs.push(ref);
  } else {
    stackCompareSelectedRefs.splice(idx, 1);
  }
  syncStackCompareRows();
  updateStackCompareBar();
}

async function openActiveStackCompare() {
  const verses = getActiveStackComparePassages();
  if (!verses.length) return;
  dismissStackCompareBar();
  await openCompareSelectedVerses(verses);
}

function updateStackCompareBar() {
  let bar = document.getElementById('stack-selection-bar');
  const active = getActiveStackCard();
  if (!active) {
    dismissStackCompareBar();
    return;
  }

  const passages = active.card.passages ?? [{ ref: active.card.ref, text: active.card.text }];
  const selectedCount = stackCompareSelectedRefs.length;
  const countLabel = selectedCount
    ? `${selectedCount} verse${selectedCount !== 1 ? 's' : ''} selected`
    : `${passages.length} verse${passages.length !== 1 ? 's' : ''} in block`;

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'stack-selection-bar';
    bar.className = 'selection-bar stack-compare-bar';
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('open'));
  }

  bar.dataset.dismissed = 'false';
  bar.className = 'selection-bar stack-compare-bar open';
  bar.innerHTML = `
    <div class="sel-head">
      <span class="sel-count">${countLabel}</span>
      <button class="sel-done-btn" title="Done">Done</button>
    </div>
    <div class="sel-actions">
      <button class="sel-secondary-btn">Compare</button>
    </div>
  `;

  bar.querySelector('.sel-done-btn').addEventListener('click', e => {
    e.stopPropagation();
    clearStackCompareMode();
  });
  bar.querySelector('.sel-secondary-btn').addEventListener('click', e => {
    e.stopPropagation();
    openActiveStackCompare();
  });
}

// ── Stack compare selection ───────────────────────────
stackDetail.addEventListener('click', e => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const row = target.closest('.stack-verse-row');
  if (!row || appMode !== 'stacks' || !stackCompareMode) return;
  const card = row.closest('.stack-verse-card');
  if (!card || parseInt(card.dataset.idx) !== activeStackCompareIdx) return;
  toggleStackComparePassage(card.dataset.idx, row.dataset.passageRef);
});

// ── Verse click → action mode ─────────────────────────
verseArea.addEventListener('click', e => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const row = target.closest('.verse-row');
  if (!row || appMode !== 'bible') return;
  if (Date.now() < suppressVerseTapUntil) return;
  if (!verseActionMode) return;

  const verseData = getCurrentVerseData(parseInt(row.dataset.vnum));
  if (!verseData) return;

  const isSelected = row.classList.contains('selected');
  if (!isSelected) {
    toggleVerseSelection(verseData, row, null);
    setActiveBibleVerse(verseData.verse);
    return;
  }

  if (activeActionVerseNum !== verseData.verse) {
    setActiveBibleVerse(verseData.verse);
    return;
  }

  if (selectedVerses.length > 1) {
    toggleVerseSelection(verseData, row, null);
    if (activeActionVerseNum === verseData.verse) {
      const fallback = selectedVerses[selectedVerses.length - 1];
      setActiveBibleVerse(fallback?.verse ?? null);
    } else {
      syncBibleActionRows();
      updateSelectionBar();
    }
    return;
  }

  setActiveBibleVerse(verseData.verse);
});

verseArea.addEventListener('touchstart', e => {
  if (appMode !== 'bible') return;
  const row = e.target.closest('.verse-row');
  if (!row) return;

  if (verseActionPressCleanup) verseActionPressCleanup();

  const touch = e.touches[0];
  const startX = touch.clientX;
  const startY = touch.clientY;

  const clearPress = () => {
    clearTimeout(timer);
    verseArea.removeEventListener('touchmove', onMove);
    verseArea.removeEventListener('touchend', onEnd);
    verseArea.removeEventListener('touchcancel', onEnd);
    if (verseActionPressCleanup === clearPress) verseActionPressCleanup = null;
  };

  const onMove = evt => {
    const t = evt.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
      clearPress();
    }
  };

  const onEnd = () => {
    clearPress();
  };

  const timer = setTimeout(() => {
    const verseData = getCurrentVerseData(parseInt(row.dataset.vnum));
    if (!verseData) {
      clearPress();
      return;
    }
    startVerseActionMode(verseData, row);
    suppressVerseTapUntil = Date.now() + 450;
    triggerHaptic([14, 22, 14]);
    clearPress();
  }, 380);

  verseActionPressCleanup = clearPress;
  verseArea.addEventListener('touchmove', onMove, { passive: true });
  verseArea.addEventListener('touchend', onEnd, { passive: true });
  verseArea.addEventListener('touchcancel', onEnd, { passive: true });
}, { passive: true });

verseArea.addEventListener('contextmenu', e => {
  if (appMode !== 'bible') return;
  const row = e.target instanceof Element ? e.target.closest('.verse-row') : null;
  if (!row) return;
  e.preventDefault();
});

verseArea.addEventListener('selectstart', e => {
  if (appMode !== 'bible') return;
  const row = e.target instanceof Element ? e.target.closest('.verse-row') : null;
  if (!row) return;
  e.preventDefault();
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

async function openBibleLocation(book, chapter) {
  appMode = 'bible';
  updateNavState();
  activeTestament = book.testament;
  activeBook = book;
  activeChapter = null;
  updateBibleChrome();
  renderBookList();

  const { data } = await supabase
    .from('verses')
    .select('chapter')
    .eq('book_id', book.id)
    .eq('translation', activeTranslation)
    .order('chapter', { ascending: false })
    .limit(1);

  renderChapterBar(data?.[0]?.chapter ?? 1);
  await selectChapter(chapter);
}

// ── Search ────────────────────────────────────────────
async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    updateSearchEmptyState();
    return;
  }
  searchBtn.disabled = true;
  searchBtn.textContent = '...';
  try {
    searchResults.innerHTML = `<div class="search-empty"><span class="spinner"></span> Searching...</div>`;

    const ref = parseReference(query);
    if (ref) {
      clearSelection();
      closeSearchSheet();
      await openBibleLocation(ref.book, ref.chapter);
      if (ref.verseStart) {
        focusVerseRange(ref.verseStart, ref.verseEnd ?? ref.verseStart);
      }
      return;
    }

    const { data, error } = await supabase
      .from('verses')
      .select('verse, chapter, text, book_id, books(name)')
      .eq('translation', activeTranslation)
      .ilike('text', `%${query}%`)
      .limit(100);

    if (error) {
      updateSearchEmptyState(`Search error: ${error.message}`);
      return;
    }

    if (!data?.length) {
      updateSearchEmptyState(`No results for "${query}"`);
      return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');

    let html = `<div class="result-count">${data.length} result${data.length !== 1 ? 's' : ''} for "${escHtml(query)}"</div>`;
    data.forEach((v, idx) => {
      const refLabel = `${v.books.name} ${v.chapter}:${v.verse}`;
      const highlighted = escHtml(v.text).replace(regex, '<mark>$1</mark>');
      html += `
        <div class="result-item" data-idx="${idx}">
          <div class="result-item-header">
            <div class="result-ref">${escHtml(refLabel)}</div>
            <button class="add-btn" data-idx="${idx}" title="Add to a Study Stack">+</button>
          </div>
          <div class="result-text">${highlighted}</div>
        </div>
      `;
    });

    searchResults.innerHTML = html;

    searchResults.querySelectorAll('.result-item').forEach(item => {
      item.addEventListener('click', async e => {
        if (e.target.closest('.add-btn')) return;
        const v = data[parseInt(item.dataset.idx)];
        const book = allBooks.find(entry => entry.id === v.book_id);
        if (!book) return;
        closeSearchSheet();
        await openBibleLocation(book, v.chapter);
        focusVerseRow(v.verse);
      });
    });

    searchResults.querySelectorAll('.add-btn').forEach(btn => {
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
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

// ── Welcome screen ────────────────────────────────────
function showWelcome() {
  verseArea.innerHTML = `
    <section class="welcome-shell">
      <div class="welcome-card">
        <div class="welcome-kicker">Bible</div>
        <strong>Read with room to breathe.</strong>
        <p>Choose a book to begin reading or search within the ${escHtml(TRANSLATIONS[activeTranslation])} text.</p>
        <div class="welcome-actions">
          <button class="welcome-btn welcome-btn-primary" id="welcome-book-btn" type="button">Browse Books</button>
          <button class="welcome-btn" id="welcome-search-btn" type="button">Search Scripture</button>
        </div>
      </div>
    </section>
  `;
  verseArea.querySelector('#welcome-book-btn')?.addEventListener('click', openBookSheet);
  verseArea.querySelector('#welcome-search-btn')?.addEventListener('click', openSearchSheet);
  bibleContent.scrollTop = 0;
  resetChromeScroll(bibleContent, biblePane);
}

// ── Book order tabs ───────────────────────────────────
otTab.addEventListener('click', () => setBookOrderMode('traditional'));
ntTab.addEventListener('click', () => setBookOrderMode('alphabetical'));

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
  if (e.key === 'ArrowDown') { e.preventDefault(); bibleContent.scrollBy({ top: 120, behavior: 'smooth' }); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); bibleContent.scrollBy({ top: -120, behavior: 'smooth' }); }
});


// ══════════════════════════════════════════════════════
//  STUDY STACKS
// ══════════════════════════════════════════════════════

// ── Storage ───────────────────────────────────────────
function nowTs() {
  return Date.now();
}

function normalizePassage(passage) {
  if (!passage) return null;
  const ref = String(passage.ref || '').trim();
  const text = String(passage.text || '').trim();
  if (!ref || !text) return null;
  return { ref, text };
}

function normalizeStackCard(card) {
  const passages = Array.isArray(card?.passages)
    ? card.passages.map(normalizePassage).filter(Boolean)
    : normalizePassage(card?.ref ? { ref: card.ref, text: card.text } : null)
      ? [normalizePassage({ ref: card.ref, text: card.text })]
      : [];
  if (!passages.length) return null;
  return {
    passages,
    note: String(card?.note || ''),
    addedAt: Number(card?.addedAt) || nowTs()
  };
}

function normalizeStack(stack, idx = 0) {
  const createdAt = Number(stack?.createdAt) || Number(stack?.updatedAt) || nowTs();
  const verses = Array.isArray(stack?.verses)
    ? stack.verses.map(normalizeStackCard).filter(Boolean)
    : [];
  return {
    id: String(stack?.id || genId()),
    title: String(stack?.title || `Stack ${idx + 1}`),
    verses,
    createdAt,
    updatedAt: Number(stack?.updatedAt) || createdAt
  };
}

function normalizeStacks(rawStacks) {
  if (!Array.isArray(rawStacks)) return [];
  return rawStacks.map((stack, idx) => normalizeStack(stack, idx));
}

function readLocalStacks() {
  try { return normalizeStacks(JSON.parse(localStorage.getItem(STACKS_STORAGE_KEY) || '[]')); }
  catch { return []; }
}

function writeLocalStacks(stacks) {
  localStorage.setItem(STACKS_STORAGE_KEY, JSON.stringify(normalizeStacks(stacks)));
}

function serializeStacks(stacks) {
  return JSON.stringify(normalizeStacks(stacks));
}

function pickPreferredStack(current, incoming) {
  if (!current) return incoming;
  const currentUpdatedAt = Number(current.updatedAt) || 0;
  const incomingUpdatedAt = Number(incoming.updatedAt) || 0;
  if (incomingUpdatedAt !== currentUpdatedAt) {
    return incomingUpdatedAt > currentUpdatedAt ? incoming : current;
  }
  return (incoming.verses?.length || 0) > (current.verses?.length || 0) ? incoming : current;
}

function mergeStacks(primaryStacks, secondaryStacks) {
  const merged = [];
  const byId = new Map();

  function upsert(stack) {
    if (!stack?.id) return;
    const existingIdx = byId.get(stack.id);
    if (existingIdx == null) {
      byId.set(stack.id, merged.length);
      merged.push(stack);
      return;
    }
    merged[existingIdx] = pickPreferredStack(merged[existingIdx], stack);
  }

  normalizeStacks(primaryStacks).forEach(upsert);
  normalizeStacks(secondaryStacks).forEach(upsert);
  return merged;
}

function touchStack(stack) {
  if (!stack) return stack;
  stack.updatedAt = nowTs();
  return stack;
}

function setStackSyncState(next) {
  stackSyncState = next;
  refreshAuthUi();
  if (typeof renderStacksSummary === 'function') renderStacksSummary();
}

stacksCache = readLocalStacks();

function loadStacks() {
  return stacksCache;
}

function saveStacks(stacks, { remote = true } = {}) {
  stacksCache = normalizeStacks(stacks);
  writeLocalStacks(stacksCache);
  if (remote) scheduleStackSync();
  else refreshAuthUi();
}

function getStackSyncMeta() {
  if (!authUser) return { label: 'Local only', className: 'is-warning' };
  if (stackSyncState === 'error') return { label: 'Sync issue', className: 'is-warning' };
  if (stackSyncState === 'syncing') return { label: 'Syncing', className: 'is-warning' };
  return { label: 'Synced', className: 'is-sync' };
}

function getAuthLabel() {
  if (!authUser?.email) return 'Account';
  const [name] = authUser.email.split('@');
  return name.length > 12 ? `${name.slice(0, 12)}…` : name;
}

function setAuthFeedback(message = '', tone = '') {
  authFeedback.textContent = message;
  authFeedback.classList.toggle('hidden', !message);
  authFeedback.classList.remove('is-error', 'is-success');
  if (tone) authFeedback.classList.add(tone === 'error' ? 'is-error' : 'is-success');
}

function setAuthBusy(isBusy) {
  [authEmailInput, authPasswordInput, authSignInBtn, authSignUpBtn, authSignOutBtn, authCloseBtn].forEach(el => {
    if (!el || el.classList.contains('hidden')) return;
    el.disabled = isBusy;
  });
}

function refreshAuthUi() {
  const signedIn = !!authUser;
  const syncMeta = getStackSyncMeta();

  authOpenBtn.textContent = signedIn ? getAuthLabel() : 'Account';
  authOpenBtn.classList.toggle('is-signed-in', signedIn);
  accountBtn.classList.toggle('account-signed-in', signedIn);

  authCopy.textContent = signedIn
    ? `${authUser.email} is signed in. ${syncMeta.label === 'Synced' ? 'Stacks sync automatically.' : 'Stack sync is still settling.'}`
    : 'Sign in if you already have an account, or create one here to sync your stacks across phone and laptop.';

  authEmailInput.classList.toggle('hidden', signedIn);
  authPasswordInput.classList.toggle('hidden', signedIn);
  authSignInBtn.classList.toggle('hidden', signedIn);
  authSignUpBtn.classList.toggle('hidden', signedIn);
  authSignOutBtn.classList.toggle('hidden', !signedIn);

  if (signedIn) {
    authEmailInput.value = authUser.email || '';
    authPasswordInput.value = '';
  }
}

function downloadStacksExport() {
  const payload = serializeStacks(loadStacks());
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `scripture-stacks-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast('Stacks exported');
}

async function importStacksFromText(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    showToast('Import failed: invalid JSON');
    return;
  }

  const importedStacks = normalizeStacks(parsed);
  if (!Array.isArray(parsed) || importedStacks.length === 0) {
    showToast('Import failed: no valid stacks');
    return;
  }

  const ok = await showConfirm(`Import ${importedStacks.length} stack${importedStacks.length !== 1 ? 's' : ''}? This merges with your current stacks.`, 'Import');
  if (!ok) return;

  const merged = mergeStacks(loadStacks(), importedStacks);
  saveStacks(merged);
  refreshStacksUi({ preserveView: true });
  showToast(`Imported ${importedStacks.length} stack${importedStacks.length !== 1 ? 's' : ''}`);
}

function openAuthModal() {
  refreshAuthUi();
  authBackdrop.classList.remove('hidden');
  if (!authUser) setTimeout(() => authEmailInput.focus(), 50);
}

function closeAuthModal() {
  authBackdrop.classList.add('hidden');
  authPasswordInput.value = '';
  setAuthFeedback('');
}

async function flushStackSync() {
  clearTimeout(stackSyncTimer);
  stackSyncTimer = null;
  if (!authUser) {
    setStackSyncState('local');
    return false;
  }
  if (stackSyncPromise) return stackSyncPromise;

  const payload = normalizeStacks(stacksCache);
  stackSyncPromise = (async () => {
    setStackSyncState('syncing');
    const { error } = await supabase
      .from('user_stack_state')
      .upsert({
        user_id: authUser.id,
        stacks: payload,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('Stack sync failed', error);
      setStackSyncState('error');
      if (!stackSyncWarned) {
        stackSyncWarned = true;
        showToast('Cloud sync unavailable');
      }
      return false;
    }

    stackSyncWarned = false;
    setStackSyncState('synced');
    return true;
  })().finally(() => {
    stackSyncPromise = null;
  });

  return stackSyncPromise;
}

function scheduleStackSync() {
  if (!authUser) {
    setStackSyncState('local');
    return;
  }
  clearTimeout(stackSyncTimer);
  setStackSyncState('syncing');
  stackSyncTimer = setTimeout(() => {
    void flushStackSync();
  }, STACKS_SYNC_DEBOUNCE_MS);
}

async function hydrateStacksFromCloud() {
  const localStacks = readLocalStacks();
  if (!authUser) {
    stacksCache = localStacks;
    setStackSyncState('local');
    refreshStacksUi();
    return;
  }

  setStackSyncState('syncing');
  const { data, error } = await supabase
    .from('user_stack_state')
    .select('stacks')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to load cloud stacks', error);
    stacksCache = localStacks;
    setStackSyncState('error');
    refreshStacksUi();
    return;
  }

  const remoteStacks = normalizeStacks(data?.stacks || []);
  const nextStacks = remoteStacks.length ? mergeStacks(remoteStacks, localStacks) : localStacks;
  const shouldPushMergedCopy = serializeStacks(remoteStacks) !== serializeStacks(nextStacks);

  saveStacks(nextStacks, { remote: false });
  setStackSyncState('synced');
  refreshStacksUi();

  if (shouldPushMergedCopy) await flushStackSync();
}

async function applyAuthSession(session) {
  authSession = session;
  authUser = session?.user ?? null;
  refreshAuthUi();
  await hydrateStacksFromCloud();
}

async function handleAuthSubmit(mode) {
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) {
    setAuthFeedback('Enter both email and password.', 'error');
    return;
  }

  setAuthBusy(true);
  setAuthFeedback('');

  const action = mode === 'sign-up'
    ? supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
    : supabase.auth.signInWithPassword({ email, password });

  const { data, error } = await action;
  setAuthBusy(false);

  if (error) {
    setAuthFeedback(error.message, 'error');
    return;
  }

  if (mode === 'sign-up' && !data?.session) {
    setAuthFeedback('Account created. If confirmation email is enabled, finish that step, then sign in.', 'success');
    authPasswordInput.value = '';
    return;
  }

  closeAuthModal();
  showToast(mode === 'sign-up' ? 'Account ready' : 'Signed in');
}

async function handleSignOut() {
  setAuthBusy(true);
  const { error } = await supabase.auth.signOut();
  setAuthBusy(false);
  if (error) {
    setAuthFeedback(error.message, 'error');
    return;
  }
  closeAuthModal();
  showToast('Signed out');
}

// ── Mode toggle ───────────────────────────────────────
function setMode(mode) {
  appMode = mode;
  closeBookSheet();
  closeSearchSheet();
  closeTranslationPicker();
  updateNavState();
  syncBottomNavChrome();

  if (mode === 'stacks') {
    resetChromeScroll(stacksContent, stacksPane);
    clearSelection();
    renderStacksSummary();
    renderStacksList();
    const stacks = loadStacks();
    if (stacks.length > 0) {
      const target = stacks.find(s => s.id === activeStackId) ? activeStackId : stacks[0].id;
      openStack(target);
    } else {
      activeStackId = null;
      showStacksWelcome();
    }
    return;
  }

  resetChromeScroll(bibleContent, biblePane);
  clearStackCompareMode();
  updateBibleChrome();
  renderBookList();
  if (!activeBook || !activeChapter) {
    showWelcome();
  }
}

function refreshStacksUi({ preserveView = false } = {}) {
  const stacks = loadStacks();
  renderStacksSummary();
  renderStacksList();

  if (appMode !== 'stacks') return;
  if (!stacks.length) {
    activeStackId = null;
    clearStackCompareMode();
    showStacksWelcome();
    return;
  }

  const target = stacks.find(s => s.id === activeStackId)?.id || stacks[0].id;
  if (preserveView && target === activeStackId) {
    renderStackView(target, { preserveScroll: true });
    return;
  }
  openStack(target);
}

navBible.addEventListener('click', () => setMode('bible'));
navStacks.addEventListener('click', () => setMode('stacks'));

// ── Render stacks rail ────────────────────────────────
function renderStacksList() {
  const stacks = loadStacks();
  stackList.innerHTML = '';
  renderStacksSummary();
  if (!stacks.length) return;

  const activeStack = stacks.find(stack => stack.id === activeStackId) || stacks[0];
  stackList.innerHTML = `
    <button class="stack-switcher-btn" id="stack-switcher-btn" type="button" aria-expanded="false">
      <span class="stack-switcher-copy">
        <span class="stack-switcher-label">Current stack</span>
        <span class="stack-switcher-title">${escHtml(activeStack.title)}</span>
      </span>
      <span class="stack-switcher-meta">${stacks.length} stack${stacks.length !== 1 ? 's' : ''}</span>
      <span class="stack-switcher-chevron" aria-hidden="true">›</span>
    </button>
  `;

  stackList.querySelector('#stack-switcher-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    openStackSwitcher();
  });
}

// ── Open a stack ──────────────────────────────────────
function openStack(id) {
  if (activeStackId !== id) {
    clearStackCompareMode();
  }
  activeStackId = id;
  resetChromeScroll(stacksContent, stacksPane);
  renderStacksSummary();
  renderStacksList();
  renderStackView(id, { resetScroll: true });
}

// ── Render stack in main area ─────────────────────────
function renderStackView(id, { preserveScroll = false, resetScroll = false } = {}) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === id);
  if (!stack) {
    stackDetail.innerHTML = '';
    return;
  }
  const scrollTop = preserveScroll ? stacksContent.scrollTop : 0;

  let html = `
    <div class="stack-panel">
    <div class="stack-view">
      <div class="stack-view-header">
        <input class="stack-title-input" id="stack-title-input"
          value="${escHtml(stack.title)}" maxlength="60" placeholder="Stack title…" />
        <button class="delete-stack-btn" id="delete-stack-btn">Delete Stack</button>
      </div>
      <div class="stack-verse-count">${countStackPassages(stack)} saved passage${countStackPassages(stack) !== 1 ? 's' : ''} across ${stack.verses.length} card${stack.verses.length !== 1 ? 's' : ''}</div>
      <div class="stack-add-bar">
        <input class="stack-add-input" id="stack-add-input" placeholder="Search to add a verse…" autocomplete="off" />
        <button class="stack-add-search-btn" id="stack-add-search-btn">Add</button>
      </div>
      <div class="stack-add-results" id="stack-add-results"></div>
  `;

  if (stack.verses.length === 0) {
    html += `<div class="state-msg stack-empty-state"><strong>No saved cards yet.</strong>Long-press verses in the Bible reader to add them here, then expand each card with notes or comparison tools.</div>`;
  } else {
    stack.verses.forEach((v, idx) => {
      const passages = v.passages ?? [{ ref: v.ref, text: v.text }];
      const hasNote = v.note && v.note.trim();
      const isActiveCard = stackCompareMode && idx === activeStackCompareIdx;
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
            const isSelectedPassage = isActiveCard && stackCompareSelectedRefs.includes(p.ref);
            return `
            <div class="stack-verse-row${passages.length > 1 ? '' : ' single'}${isSelectedPassage ? ' stack-selected' : ''}"
                 data-passage-idx="${pi}"
                 data-passage-ref="${escHtml(p.ref)}">
              ${verseNum && passages.length > 1 ? `<span class="stack-verse-num">${verseNum}</span>` : ''}
              <div class="stack-verse-text">${escHtml(p.text)}</div>
              ${pi > 0 ? `<button class="remove-passage-btn" data-cardidx="${idx}" data-pi="${pi}" title="Remove">×</button>` : ''}
            </div>`;
      }).join('');
      html += `
        <div class="stack-verse-card${isActiveCard ? ' action-active' : ''}" data-idx="${idx}">
          <div class="stack-verse-card-header">
            <span class="stack-verse-ref">${escHtml(cardRef)}</span>
            <button class="remove-verse-btn" data-idx="${idx}" title="Remove card">×</button>
          </div>
          ${passagesHtml}
          <div class="stack-card-actions">
            <button class="add-passage-btn" data-idx="${idx}" title="Add scripture">
              <svg class="stack-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
              <span class="stack-action-label">Add</span>
            </button>
            <button class="note-toggle" data-idx="${idx}" title="Note">
              <svg class="stack-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M6 14.2 5 15l.8-2.6L13 5.2a1.6 1.6 0 0 1 2.2 0l.6.6a1.6 1.6 0 0 1 0 2.2L8.6 15.2l-2.6.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              </svg>
              <span class="stack-action-label">Note</span>
            </button>
            <button class="compare-card-btn" data-idx="${idx}" title="Compare translations">
              <svg class="stack-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.8 7.2h12.4M12.8 4.4l3.4 2.8-3.4 2.8M16.2 12.8H3.8M7.2 15.6l-3.4-2.8L7.2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="stack-action-label">Compare</span>
            </button>
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

  html += `</div></div>`;
  stackDetail.innerHTML = html;
  syncStackCompareRows();
  updateStackCompareBar();
  if (preserveScroll) {
    const restoreScroll = () => { stacksContent.scrollTop = scrollTop; };
    requestAnimationFrame(() => {
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    });
  } else if (resetScroll) {
    requestAnimationFrame(() => {
      stacksContent.scrollTop = Math.max(0, stackDetail.offsetTop - 12);
    });
  }

  stackDetail.querySelector('#stack-title-input')?.addEventListener('input', e => {
    updateStackTitle(id, e.target.value);
  });

  stackDetail.querySelector('#delete-stack-btn')?.addEventListener('click', async () => {
    const ok = await showConfirm(`Delete "${stack.title}"?`);
    if (ok) deleteStack(id);
  });

  stackDetail.querySelectorAll('.remove-verse-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('Remove this verse?', 'Remove');
      if (ok) removeVerseFromStack(id, parseInt(btn.dataset.idx));
    });
  });

  stackDetail.querySelectorAll('.add-passage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const area = btn.closest('.stack-verse-card').querySelector('.add-passage-area');
      area.classList.toggle('hidden');
      if (!area.classList.contains('hidden')) area.querySelector('.add-passage-input').focus();
    });
  });

  stackDetail.querySelectorAll('.remove-passage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      removePassageFromCard(id, parseInt(btn.dataset.cardidx), parseInt(btn.dataset.pi));
    });
  });

  stackDetail.querySelectorAll('.add-passage-input').forEach(input => {
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

  stackDetail.querySelectorAll('.compare-card-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      if (stackCompareMode && activeStackCompareIdx === idx) {
        clearStackCompareMode();
      } else {
        startStackCompareMode(idx);
      }
    });
  });

  stackDetail.querySelectorAll('.note-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = btn.closest('.stack-verse-card').querySelector('.stack-note');
      const opening = ta.classList.contains('hidden');
      ta.classList.toggle('hidden', !opening);
      if (opening) ta.focus();
    });
  });

  stackDetail.querySelectorAll('.stack-note').forEach(ta => {
    ta.addEventListener('input', () => {
      updateVerseNote(id, parseInt(ta.dataset.idx), ta.value);
    });
  });

  stackDetail.querySelectorAll('.card-translation-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const current = cardTranslations.get(idx) || 'kjv';
      openTranslationPicker(btn, current, async next => {
        const card = btn.closest('.stack-verse-card');
        if (!card) return;

        btn.disabled = true;
        card.classList.add('is-switching');

        try {
          const stacks = loadStacks();
          const stack = stacks.find(s => s.id === id);
          const v = stack?.verses[idx];
          if (!v) return;

          const passages = v.passages ?? [{ ref: v.ref, text: v.text }];

          // Re-fetch each passage in the new translation.
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

          // Update just the verse rows in this card.
          const rows = card.querySelectorAll('.stack-verse-row');
          fetched.forEach((p, pi) => {
            const textEl = rows[pi]?.querySelector('.stack-verse-text');
            if (textEl) textEl.textContent = p.text;
          });

          cardTranslations.set(idx, next);
          btn.textContent = TRANSLATIONS[next];
        } finally {
          requestAnimationFrame(() => {
            const card = btn.closest('.stack-verse-card');
            if (card) card.classList.remove('is-switching');
            btn.disabled = false;
          });
        }
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
  renderStacksSummary();
  stackList.innerHTML = '';
  stackDetail.innerHTML = `
    <div class="empty-stacks">
      <div class="empty-stacks-icon">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4 4.5 8 12 12 19.5 8 12 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M4.5 12 12 16l7.5-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M4.5 16 12 20l7.5-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2>No stacks yet</h2>
      <p>Create a stack to collect verses, keep passage groups together, and attach notes for study.</p>
    </div>
  `;
}

// ── Create stack ──────────────────────────────────────
newStackBtn.addEventListener('click', async () => {
  const title = await showPrompt('Name your stack', 'e.g. Healing, Faith, Promises…');
  if (!title) return;
  const stacks = loadStacks();
  const stamp = nowTs();
  const newStack = { id: genId(), title, verses: [], createdAt: stamp, updatedAt: stamp };
  stacks.push(newStack);
  saveStacks(stacks);
  setMode('stacks');
  openStack(newStack.id);
});

// ── CRUD ──────────────────────────────────────────────
function updateStackTitle(id, title) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === id);
  if (stack) {
    stack.title = title;
    touchStack(stack);
    saveStacks(stacks);
    renderStacksSummary();
    renderStacksList();
  }
}

function deleteStack(id) {
  const stacks = loadStacks().filter(s => s.id !== id);
  saveStacks(stacks);
  activeStackId = null;
  clearStackCompareMode();
  renderStacksSummary();
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
  touchStack(stack);
  saveStacks(stacks);
  clearStackCompareMode();
  renderStacksSummary();
  renderStackView(stackId, { preserveScroll: true });
  renderStacksList();
}

function updateVerseNote(stackId, idx, note) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === stackId);
  if (!stack?.verses[idx]) return;
  stack.verses[idx].note = note;
  touchStack(stack);
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
  touchStack(stack);
  saveStacks(stacks);
  renderStacksSummary();
  renderStackView(stackId, { preserveScroll: true });
}

function removePassageFromCard(stackId, cardIdx, passageIdx) {
  const stacks = loadStacks();
  const stack = stacks.find(s => s.id === stackId);
  if (!stack?.verses[cardIdx]) return;
  const card = stack.verses[cardIdx];
  if (!card.passages) card.passages = [{ ref: card.ref, text: card.text }];
  card.passages.splice(passageIdx, 1);
  touchStack(stack);
  saveStacks(stacks);
  renderStacksSummary();
  renderStackView(stackId, { preserveScroll: true });
}

// ── Drag-to-reorder (single global listener set) ─────
{
  let dragCard = null, longPressTimer = null, startY = 0, offsetY = 0;
  let placeholder = null, scrollInterval = null, isDragging = false;

  stackDetail.addEventListener('touchstart', e => {
    if (isDragging) return;
    const card = e.target.closest('.stack-verse-card');
    if (!card || e.target.closest('input, button, textarea, a')) return;
    if (appMode !== 'stacks' || !activeStackId || stackCompareMode) return;
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

      stackDetail.querySelectorAll('.stack-verse-card:not(.dragging)').forEach(c => {
        c.style.transition = 'transform 0.25s ease, opacity 0.2s';
        c.style.opacity = '0.6';
      });

      triggerHaptic(20);
    }, 400);
  }, { passive: true });

  stackDetail.addEventListener('touchmove', e => {
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
    const areaRect = stacksContent.getBoundingClientRect();
    const edgeZone = 60;
    if (y < areaRect.top + edgeZone) {
      scrollInterval = setInterval(() => { stacksContent.scrollTop -= 8; }, 16);
    } else if (y > areaRect.bottom - edgeZone) {
      scrollInterval = setInterval(() => { stacksContent.scrollTop += 8; }, 16);
    }

    const siblings = [...stackDetail.querySelectorAll('.stack-verse-card:not(.dragging)')];
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
    stackDetail.querySelectorAll('.stack-verse-card').forEach(c => {
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

    stackDetail.querySelectorAll('.stack-verse-card:not(.dragging)').forEach(c => {
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

      const newOrder = [...stackDetail.querySelectorAll('.stack-verse-card')].map(c => parseInt(c.dataset.idx));
      const stacks = loadStacks();
      const st = stacks.find(s => s.id === finishStackId);
      if (st) {
        const valid = newOrder.length === st.verses.length
          && newOrder.every(i => Number.isInteger(i) && i >= 0 && i < st.verses.length)
          && new Set(newOrder).size === newOrder.length;
        if (valid) {
          st.verses = newOrder.map(i => st.verses[i]);
          touchStack(st);
          saveStacks(stacks);
        }
        renderStacksSummary();
        renderStackView(finishStackId, { preserveScroll: true });
      }
    }, 200);
  }

  stackDetail.addEventListener('touchend', endDrag);
  stackDetail.addEventListener('touchcancel', cancelDrag);
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
  touchStack(stack);
  saveStacks(stacks);
  renderStacksSummary();
  showToast(`Added to "${stack.title}"`);
  if (appMode === 'stacks' && activeStackId === stackId) {
    renderStackView(stackId, { preserveScroll: true });
    renderStacksList();
  } else {
    renderStacksSummary();
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
function syncBibleActionRows() {
  verseArea.querySelectorAll('.verse-row.action-active').forEach(row => row.classList.remove('action-active'));
  if (!verseActionMode || activeActionVerseNum == null) return;
  verseArea.querySelector(`.verse-row[data-vnum="${activeActionVerseNum}"]`)?.classList.add('action-active');
}

function setActiveBibleVerse(vnum) {
  activeActionVerseNum = vnum;
  syncBibleActionRows();
  updateSelectionBar();
}

function getActiveBibleVerseData() {
  if (!verseActionMode || activeActionVerseNum == null) return null;
  return getCurrentVerseData(activeActionVerseNum);
}

function startVerseActionMode(verseData, rowEl) {
  if (!verseActionMode) clearSelection();
  verseActionMode = true;

  if (!selectedVerses.some(v => v.ref === verseData.ref)) {
    selectedVerses.push(verseData);
    rowEl?.classList.add('selected');
  }

  activeActionVerseNum = verseData.verse;
  syncBibleActionRows();
  updateSelectionBar();
}

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
    verseActionMode = false;
    activeActionVerseNum = null;
    syncBibleActionRows();
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
  bar.dataset.dismissed = 'false';

  if (verseActionMode && appMode === 'bible') {
    const activeVerse = getActiveBibleVerseData();
    const hasGreek = !!(activeVerse && (greekByVerse[activeVerse.verse] ?? []).length);
    bar.className = 'selection-bar verse-action-bar open';
    bar.innerHTML = `
      <div class="sel-head">
        <span class="sel-count">${selectedVerses.length} verse${selectedVerses.length !== 1 ? 's' : ''} selected</span>
        <button class="sel-done-btn" title="Done">Done</button>
      </div>
      <div class="sel-actions">
        <button class="sel-secondary-btn" ${hasGreek ? '' : 'disabled'}>Greek</button>
        <button class="sel-secondary-btn" ${activeVerse ? '' : 'disabled'}>Compare</button>
        <button class="sel-add-btn">Add to Stack</button>
      </div>
    `;

    bar.querySelector('.sel-done-btn').addEventListener('click', e => {
      e.stopPropagation();
      clearSelection();
    });
    bar.querySelector('.sel-add-btn').addEventListener('click', e => {
      e.stopPropagation();
      openStackPicker();
    });
    bar.querySelectorAll('.sel-secondary-btn')[0].addEventListener('click', e => {
      e.stopPropagation();
      if (!activeVerse || !hasGreek) return;
      showGreekPage(activeVerse.verse, activeVerse.text, greekByVerse[activeVerse.verse] ?? []);
    });
    bar.querySelectorAll('.sel-secondary-btn')[1].addEventListener('click', e => {
      e.stopPropagation();
      if (selectedVerses.length > 1) {
        openCompareSelectedVerses(selectedVerses);
        return;
      }
      if (!activeVerse) return;
      openCompare(`${activeVerse.book} ${activeVerse.chapter}:${activeVerse.verse}`, activeBook.id, activeVerse.chapter, activeVerse.verse);
    });
    return;
  }

  bar.className = 'selection-bar open';
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
  bar.dataset.dismissed = 'true';
  bar.classList.remove('open');
  setTimeout(() => {
    if (bar.dataset.dismissed === 'true') bar.remove();
  }, 400);
}

function clearSelection() {
  closeStackPicker();
  selectedVerses = [];
  verseActionMode = false;
  activeActionVerseNum = null;
  document.querySelectorAll('.verse-row.selected, .result-item.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.verse-row.action-active').forEach(el => el.classList.remove('action-active'));
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

  // Position above the current selection/action bar
  const barHeight = document.getElementById('selection-bar')?.offsetHeight ?? 72;
  picker.style.position = 'fixed';
  picker.style.bottom = `calc(${barHeight + 16}px + env(safe-area-inset-bottom))`;
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
    const stamp = nowTs();
    const newStack = { id: genId(), title, verses: [], createdAt: stamp, updatedAt: stamp };
    stks.push(newStack);
    saveStacks(stks);
    addVerseToStack(newStack.id, buildCombinedVerseData(versesToAdd));
    clearSelection();
  });

  setTimeout(() => {
    document.addEventListener('click', closeStackPicker, { once: true });
  }, 0);
}

function openStackSwitcher() {
  if (activePicker?.dataset.role === 'stack-switcher') {
    closeStackPicker();
    return;
  }

  closeStackPicker();
  const stacks = loadStacks();
  if (!stacks.length) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'stack-switcher-backdrop';
  backdrop.dataset.role = 'stack-switcher';
  backdrop.innerHTML = `
    <div class="stack-picker stack-picker-list">
      <div class="stack-picker-title">Your Stacks</div>
      ${stacks.map(stack => `
        <button class="stack-picker-item stack-picker-stack-item${stack.id === activeStackId ? ' active' : ''}" data-id="${escHtml(stack.id)}" type="button">
          <span class="stack-picker-stack-copy">
            <span class="stack-picker-stack-title">${escHtml(stack.title)}</span>
            <span class="stack-picker-stack-meta">${countStackPassages(stack)} saved passage${countStackPassages(stack) !== 1 ? 's' : ''}</span>
          </span>
          ${stack.id === activeStackId ? '<span class="stack-picker-check" aria-hidden="true">✓</span>' : ''}
        </button>
      `).join('')}
      <div class="stack-picker-divider"></div>
      <button class="stack-picker-new" type="button">+ New Stack</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  activePicker = backdrop;

  const picker = backdrop.querySelector('.stack-picker-list');
  picker?.addEventListener('click', e => e.stopPropagation());
  backdrop.addEventListener('click', closeStackPicker);

  requestAnimationFrame(() => { backdrop.classList.add('open'); picker.scrollTop = 0; });

  backdrop.querySelectorAll('.stack-picker-stack-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      openStack(item.dataset.id);
      closeStackPicker();
    });
  });

  backdrop.querySelector('.stack-picker-new')?.addEventListener('click', async e => {
    e.stopPropagation();
    closeStackPicker();
    const title = await showPrompt('Name your stack', 'e.g. Healing, Faith, Promises…');
    if (!title) return;
    const stks = loadStacks();
    const stamp = nowTs();
    const newStack = { id: genId(), title, verses: [], createdAt: stamp, updatedAt: stamp };
    stks.push(newStack);
    saveStacks(stks);
    setMode('stacks');
    openStack(newStack.id);
  });
}

function closeStackPicker() {
  if (!activePicker) return;
  const picker = activePicker;
  activePicker = null;

  if (picker.dataset.role === 'stack-switcher') {
    picker.classList.remove('open');
    setTimeout(() => picker.remove(), 220);
    return;
  }

  picker.remove();
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
  { name: 'San Francisco',     stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif" },
  { name: 'Inter',             stack: "'Inter', system-ui, sans-serif" },
  { name: 'Roboto',            stack: "'Roboto', system-ui, sans-serif" },
  { name: 'Open Sans',         stack: "'Open Sans', system-ui, sans-serif" },
  { name: 'Lato',              stack: "'Lato', system-ui, sans-serif" },
  { name: 'Nunito',            stack: "'Nunito', system-ui, sans-serif" },
  { name: 'Raleway',           stack: "'Raleway', system-ui, sans-serif" },
  { name: 'Josefin Sans',      stack: "'Josefin Sans', system-ui, sans-serif" },
];

const DEFAULT_READER_SETTINGS = {
  theme: 'light',
  size: '1.08rem',
  spacing: '2.1',
  font: 'Source Serif 4',
};
const READER_SIZE_MIN = 0.88;
const READER_SIZE_MAX = 1.9;
const READER_SIZE_STEP = 0.06;

const settingsBtn     = document.getElementById('settings-btn');
const settingsSheetBackdrop = document.getElementById('settings-sheet-backdrop');
const settingsPanel   = document.getElementById('settings-panel');
const spFontList      = document.getElementById('sp-font-list');
const spFontSummary   = document.getElementById('sp-font-summary');
const spFontCurrent   = document.getElementById('sp-font-current');
const spFontToggle    = document.getElementById('sp-font-toggle');
const spSizeDownBtn   = document.getElementById('sp-size-down');
const spSizeUpBtn     = document.getElementById('sp-size-up');

function closeSettings() {
  setFontListOpen(false);
  closeSheet(settingsSheetBackdrop);
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsBtn.classList.remove('active');
}

// ── Load saved settings ───────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('reader_settings') || '{}'); }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem('reader_settings', JSON.stringify(s)); }

function getEffectiveSettings(settings = loadSettings()) {
  return { ...DEFAULT_READER_SETTINGS, ...settings };
}

function clampReaderSize(value) {
  return Math.min(READER_SIZE_MAX, Math.max(READER_SIZE_MIN, value));
}

function getReaderSizeValue(settings = loadSettings()) {
  const value = parseFloat(getEffectiveSettings(settings).size);
  return Number.isFinite(value) ? clampReaderSize(value) : parseFloat(DEFAULT_READER_SETTINGS.size);
}

function formatReaderSize(value) {
  return `${parseFloat(clampReaderSize(value).toFixed(2))}rem`;
}

function applySettings(s) {
  const settings = getEffectiveSettings(s);
  // Theme
  document.body.classList.toggle('theme-dark', settings.theme === 'dark');
  document.querySelector('meta[name="theme-color"]').content = settings.theme === 'dark' ? '#0c0c10' : '#e74252';
  // Font
  const font = FONTS.find(f => f.name === settings.font) || FONTS[0];
  document.documentElement.style.setProperty('--font-read', font.stack);
  // Size
  document.documentElement.style.setProperty('--reader-size', formatReaderSize(getReaderSizeValue(settings)));
  // Spacing
  document.documentElement.style.setProperty('--reader-spacing', settings.spacing);
}

// ── Build font list ───────────────────────────────────
function buildFontList(currentFont) {
  spFontCurrent.textContent = currentFont;
  spFontList.innerHTML = '';
  FONTS.forEach(f => {
    const div = document.createElement('div');
    div.className = 'sp-font-item' + (f.name === currentFont ? ' active' : '');
    div.style.fontFamily = f.stack;
    div.innerHTML = `<span>${escHtml(f.name)}</span><span class="sp-check">✓</span>`;
    div.addEventListener('click', () => {
      const s = loadSettings();
      s.font = f.name;
      saveSettings(s);
      applySettings(s);
      syncPanelUI(s);
      setFontListOpen(false);
    });
    spFontList.appendChild(div);
  });
}

function setFontListOpen(isOpen) {
  spFontList.classList.toggle('hidden', !isOpen);
  spFontSummary.classList.toggle('active', isOpen);
  spFontSummary.setAttribute('aria-expanded', String(isOpen));
  spFontToggle.setAttribute('aria-expanded', String(isOpen));
}

function toggleFontList(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : spFontList.classList.contains('hidden');
  setFontListOpen(shouldOpen);
}

function stepReaderSize(delta) {
  const s = loadSettings();
  s.size = formatReaderSize(getReaderSizeValue(s) + delta);
  saveSettings(s);
  applySettings(s);
  syncPanelUI(s);
}

// ── Toggle panel (handled above near backdrop) ────────

settingsSheetBackdrop.addEventListener('click', e => {
  if (e.target === settingsSheetBackdrop) closeSettings();
});

settingsBtn.addEventListener('click', e => {
  e.stopPropagation();
  showPaneChrome(biblePane);
  const isOpen = settingsSheetBackdrop.classList.contains('open');
  if (isOpen) {
    closeSettings();
  } else {
    const s = getEffectiveSettings(loadSettings());
    buildFontList(s.font);
    syncPanelUI(s);
    setFontListOpen(false);
    settingsPanel.setAttribute('aria-hidden', 'false');
    settingsBtn.classList.add('active');
    openSheet(settingsSheetBackdrop);
  }
});

function syncPanelUI(s) {
  const settings = getEffectiveSettings(s);
  document.querySelectorAll('.sp-theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
  });
  document.querySelectorAll('.sp-spacing-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.spacing === settings.spacing);
  });
  spFontCurrent.textContent = settings.font;
  spSizeDownBtn.disabled = getReaderSizeValue(settings) <= READER_SIZE_MIN + 0.001;
  spSizeUpBtn.disabled = getReaderSizeValue(settings) >= READER_SIZE_MAX - 0.001;
  spFontList.querySelectorAll('.sp-font-item').forEach(item => {
    item.classList.toggle('active', item.firstElementChild?.textContent === settings.font);
  });
}

// ── Theme buttons ─────────────────────────────────────
document.querySelectorAll('.sp-theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = loadSettings();
    s.theme = btn.dataset.theme;
    saveSettings(s);
    applySettings(s);
    syncPanelUI(s);
  });
});

spSizeDownBtn.addEventListener('click', () => stepReaderSize(-READER_SIZE_STEP));
spSizeUpBtn.addEventListener('click', () => stepReaderSize(READER_SIZE_STEP));
spFontSummary.addEventListener('click', () => toggleFontList());
spFontToggle.addEventListener('click', () => toggleFontList());

// ── Spacing buttons ───────────────────────────────────
document.querySelectorAll('.sp-spacing-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = loadSettings();
    s.spacing = btn.dataset.spacing;
    saveSettings(s);
    applySettings(s);
    syncPanelUI(s);
  });
});

// ── Apply on boot ─────────────────────────────────────
applySettings(loadSettings());
measureAllPaneChrome();
bindPaneChromeScroll(bibleContent, biblePane, { minScrollTop: 168, hideDistance: 128, showDistance: 56, toggleCooldownMs: 420 });
bindPaneChromeScroll(stacksContent, stacksPane, { minScrollTop: 148, hideDistance: 120, showDistance: 56, toggleCooldownMs: 420 });
resetChromeScroll(bibleContent, biblePane);
resetChromeScroll(stacksContent, stacksPane);
syncBottomNavChrome();

// ── Start ─────────────────────────────────────────────
init();
