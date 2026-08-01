import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { Voice, initVoice } from './voice.js?v=18';

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
let verseMousePressCleanup = null;
let suppressVerseTapUntil = 0;
let stackCompareMode = false;
let activeStackCompareIdx = null;
let stackCompareSelectedRefs = [];
let bookOrderMode   = localStorage.getItem('book_order_mode') || 'traditional';
let activeTranslation = localStorage.getItem('active_translation') || 'kjv';
const TRANSLATIONS  = { kjv: 'KJV', bsb: 'BSB', web: 'WEB', akjv: 'AKJV', ukjv: 'UKJV', mkjv: 'MKJV', litv: 'LITV', cpdv: 'CPDV', darby: 'Darby', webster: 'Webster', dra: 'DRA', ylt: 'YLT', asv: 'ASV', bbe: 'BBE', nheb: 'NHEB', jubilee: 'Jubilee', leb: 'LEB', rotherham: 'Rotherham' };
const bookChapterCounts = new Map();
const pendingChapterCountLoads = new Set();
let expandedBookId = null;
const chromeScrollState = new WeakMap();
const STACKS_STORAGE_KEY = 'study_stacks';
const SCROLL_STATE_STORAGE_KEY = 'scripture_scroll_state';
const STACKS_SYNC_DEBOUNCE_MS = 500;
let stacksCache      = [];
let authSession      = null;
let authUser         = null;
let stackSyncState   = 'local';
let stackSyncTimer   = null;
let stackSyncPromise = null;
let stackSyncWarned  = false;
let lastScrollState  = null;
let scrollStateSaveTimer = null;
let chapterRequestId = 0;
let searchRequestId = 0;
let authReturnFocus = null;
const sheetCloseTimers = new WeakMap();
const sheetReturnFocus = new WeakMap();
// Migrate away from removed translations
if (!TRANSLATIONS[activeTranslation]) { activeTranslation = 'kjv'; localStorage.setItem('active_translation', 'kjv'); }
if (!['traditional', 'alphabetical'].includes(bookOrderMode)) bookOrderMode = 'traditional';

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

function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function openSheet(backdrop, { trigger = document.activeElement } = {}) {
  const closeTimer = sheetCloseTimers.get(backdrop);
  if (closeTimer) clearTimeout(closeTimer);
  sheetCloseTimers.delete(backdrop);
  if (trigger instanceof HTMLElement && !backdrop.contains(trigger)) {
    sheetReturnFocus.set(backdrop, trigger);
  }
  backdrop.setAttribute('aria-hidden', 'false');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => backdrop.classList.add('open'));
}

function closeSheet(backdrop, { restoreFocus = true } = {}) {
  if (backdrop.classList.contains('hidden') && !backdrop.classList.contains('open')) return;
  const existingTimer = sheetCloseTimers.get(backdrop);
  if (existingTimer) clearTimeout(existingTimer);
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
  const returnFocus = sheetReturnFocus.get(backdrop);
  const timer = setTimeout(() => {
    sheetCloseTimers.delete(backdrop);
    if (backdrop.classList.contains('open')) return;
    backdrop.classList.add('hidden');
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }, prefersReducedMotion() ? 0 : 380);
  sheetCloseTimers.set(backdrop, timer);
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

bibleContent.addEventListener('scroll', captureScrollState, { passive: true });
stacksContent.addEventListener('scroll', captureScrollState, { passive: true });
window.addEventListener('pagehide', () => captureScrollState({ immediate: true }));
window.addEventListener('pageshow', () => restoreSavedScrollState());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    captureScrollState({ immediate: true });
  } else {
    restoreSavedScrollState();
  }
});

function resetChromeScroll(container, pane) {
  const state = chromeScrollState.get(container);
  if (state) {
    state.lastTop = container.scrollTop;
    state.lastDirection = '';
    state.distance = 0;
  }
  showPaneChrome(pane);
}

function readSavedScrollState() {
  if (lastScrollState) return lastScrollState;
  try {
    return JSON.parse(localStorage.getItem(SCROLL_STATE_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeSavedScrollState(state) {
  localStorage.setItem(SCROLL_STATE_STORAGE_KEY, JSON.stringify(state));
}

function captureScrollState({ immediate = false } = {}) {
  const state = {
    mode: appMode,
    bible: {
      top: bibleContent.scrollTop,
      bookId: activeBook?.id ?? null,
      chapter: activeChapter,
      translation: activeTranslation
    },
    stacks: {
      top: stacksContent.scrollTop,
      activeStackId
    },
    savedAt: Date.now()
  };
  lastScrollState = state;
  if (immediate) {
    clearTimeout(scrollStateSaveTimer);
    scrollStateSaveTimer = null;
    writeSavedScrollState(state);
  } else if (!scrollStateSaveTimer) {
    scrollStateSaveTimer = setTimeout(() => {
      scrollStateSaveTimer = null;
      if (lastScrollState) writeSavedScrollState(lastScrollState);
    }, 250);
  }
  return state;
}

function restoreScrollTop(container, top) {
  const nextTop = Math.max(0, Number(top) || 0);
  requestAnimationFrame(() => {
    container.scrollTop = nextTop;
    requestAnimationFrame(() => {
      container.scrollTop = nextTop;
    });
  });
}

function restoreSavedScrollState(saved = readSavedScrollState()) {
  if (!saved) return;

  if (appMode === 'stacks') {
    if (!saved.stacks || saved.stacks.activeStackId !== activeStackId) return;
    restoreScrollTop(stacksContent, saved.stacks.top);
    return;
  }

  if (!saved.bible) return;
  const sameBibleView =
    saved.bible.bookId === (activeBook?.id ?? null) &&
    saved.bible.chapter === activeChapter &&
    saved.bible.translation === activeTranslation;
  if (sameBibleView) restoreScrollTop(bibleContent, saved.bible.top);
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
  expandedBookId = activeBook?.id ?? expandedBookId;
  renderBookList();
  resetBookSheetInlineMotion();
  bookSheet.classList.remove('dragging');
  bookPickerBtn.setAttribute('aria-expanded', 'true');
  openSheet(bookSheetBackdrop);
  setTimeout(() => bookSheet.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 60);
}

function closeBookSheet() {
  resetBookSheetInlineMotion();
  bookSheet.classList.remove('dragging');
  bookPickerBtn.setAttribute('aria-expanded', 'false');
  closeSheet(bookSheetBackdrop);
}

function openSearchSheet() {
  showPaneChrome(biblePane);
  searchRequestId += 1;
  searchBtn.disabled = false;
  searchBtn.textContent = 'Search';
  searchResults.setAttribute('aria-busy', 'false');
  searchOpenBtn.setAttribute('aria-expanded', 'true');
  openSheet(searchSheetBackdrop);
  setTimeout(() => searchInput.focus(), prefersReducedMotion() ? 0 : 60);
  // Start warming the embedding model in the background so the first query is fast.
  preloadEmbedder().catch(() => {});
}

function closeSearchSheet() {
  searchOpenBtn.setAttribute('aria-expanded', 'false');
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
  bookSheetBackdrop.setAttribute('aria-hidden', 'true');
  bookPickerBtn.setAttribute('aria-expanded', 'false');
  const returnFocus = sheetReturnFocus.get(bookSheetBackdrop);
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
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
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (!modalBackdrop.classList.contains('hidden') || !greekPage.classList.contains('hidden')) return;
  if (activePicker) { e.preventDefault(); closeStackPicker(); return; }
  if (activeTranslationPicker) { e.preventDefault(); closeTranslationPicker(); return; }
  if (!compareBackdrop.classList.contains('hidden')) { e.preventDefault(); closeCompare(); return; }
  if (!settingsSheetBackdrop.classList.contains('hidden')) { e.preventDefault(); closeSettings(); return; }
  if (!authBackdrop.classList.contains('hidden')) { e.preventDefault(); closeAuthModal(); return; }
  if (!searchSheetBackdrop.classList.contains('hidden')) { e.preventDefault(); closeSearchSheet(); return; }
  if (!bookSheetBackdrop.classList.contains('hidden')) { e.preventDefault(); closeBookSheet(); }
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
authEmailInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || authUser) return;
  e.preventDefault();
  authPasswordInput.focus();
});
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
  const backdrop = document.createElement('div');
  backdrop.className = 'translation-picker-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="translation-picker" role="dialog" aria-modal="true" aria-labelledby="translation-picker-title" tabindex="-1">
      <div class="translation-picker-head">
        <div>
          <h2 class="translation-picker-title" id="translation-picker-title">Choose a translation</h2>
          <p class="translation-picker-subtitle">Updates the reader and future searches</p>
        </div>
        <button class="translation-picker-close" type="button" aria-label="Close translation picker">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="translation-picker-list">
        ${Object.entries(TRANSLATIONS).map(([key, label]) => `
          <button class="translation-picker-item${key === currentKey ? ' active' : ''}" data-key="${key}" type="button" aria-pressed="${key === currentKey}">
            <span>${label}</span>
            <span class="translation-picker-check" aria-hidden="true">${key === currentKey ? '✓' : ''}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
  backdrop.returnFocusElement = anchorEl;
  document.body.appendChild(backdrop);
  activeTranslationPicker = backdrop;
  activeTranslationPickerAnchor = anchorEl;
  anchorEl?.setAttribute('aria-expanded', 'true');

  const picker = backdrop.querySelector('.translation-picker');
  picker.addEventListener('click', e => e.stopPropagation());
  backdrop.addEventListener('click', closeTranslationPicker);
  backdrop.querySelector('.translation-picker-close').addEventListener('click', e => {
    e.stopPropagation();
    closeTranslationPicker();
  });
  backdrop.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeTranslationPicker();
  });

  backdrop.querySelectorAll('.translation-picker-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      onSelect(item.dataset.key);
      closeTranslationPicker();
    });
  });

  requestAnimationFrame(() => {
    if (activeTranslationPicker !== backdrop) return;
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    picker.focus({ preventScroll: true });
  });
}

function closeTranslationPicker({ restoreFocus = true } = {}) {
  if (!activeTranslationPicker) return;
  const backdrop = activeTranslationPicker;
  const anchor = activeTranslationPickerAnchor;
  activeTranslationPicker = null;
  activeTranslationPickerAnchor = null;
  anchor?.setAttribute('aria-expanded', 'false');
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    backdrop.remove();
    const returnFocus = backdrop.returnFocusElement;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }, prefersReducedMotion() ? 0 : 220);
}

translationLabel.textContent = TRANSLATIONS[activeTranslation] || activeTranslation.toUpperCase();
translationLabel.addEventListener('click', e => {
  e.stopPropagation();
  openTranslationPicker(translationLabel, activeTranslation, key => {
    activeTranslation = key;
    localStorage.setItem('active_translation', key);
    bookChapterCounts.clear();
    pendingChapterCountLoads.clear();
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
function debounce(fn, wait = 200) {
  let timer = null;
  let latestArgs = [];
  const wrapped = (...args) => {
    latestArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...latestArgs);
    }, wait);
  };
  wrapped.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    fn(...latestArgs);
  };
  return wrapped;
}
function getCurrentVerseData(vnum) {
  const verse = currentVerses.find(v => v.verse === vnum);
  if (!verse || !activeBook || !activeChapter) return null;
  return {
    ref: `${activeBook.name} ${activeChapter}:${vnum}`,
    book: activeBook.name,
    chapter: activeChapter,
    verse: vnum,
    text: verse.text,
    translation: activeTranslation
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
  const isTraditional = bookOrderMode === 'traditional';
  otTab.classList.toggle('active', isTraditional);
  ntTab.classList.toggle('active', !isTraditional);
  otTab.setAttribute('aria-pressed', String(isTraditional));
  ntTab.setAttribute('aria-pressed', String(!isTraditional));
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

async function getBookChapterCount(book) {
  if (!book) return 1;
  const translation = activeTranslation;
  const cacheKey = `${translation}:${book.id}`;
  if (bookChapterCounts.has(cacheKey)) return bookChapterCounts.get(cacheKey);

  const { data } = await supabase
    .from('verses')
    .select('chapter')
    .eq('book_id', book.id)
    .eq('translation', translation)
    .order('chapter', { ascending: false })
    .limit(1);

  const total = data?.[0]?.chapter ?? 1;
  bookChapterCounts.set(cacheKey, total);
  return total;
}

function updateNavState() {
  const onBible = appMode === 'bible';
  biblePane.classList.toggle('is-active', onBible);
  stacksPane.classList.toggle('is-active', !onBible);
  biblePane.setAttribute('aria-hidden', String(!onBible));
  stacksPane.setAttribute('aria-hidden', String(onBible));
  navBible.classList.toggle('active', onBible);
  navStacks.classList.toggle('active', !onBible);
  if (onBible) {
    navBible.setAttribute('aria-current', 'page');
    navStacks.removeAttribute('aria-current');
  } else {
    navBible.removeAttribute('aria-current');
    navStacks.setAttribute('aria-current', 'page');
  }
}

function updateSearchEmptyState(message = 'Search within the selected translation or jump to a passage reference.') {
  searchResults.innerHTML = `<div class="search-empty">${escHtml(message)}</div>`;
}

function focusVerseRow(verseNum) {
  const row = verseArea.querySelector(`.verse-row[data-vnum="${verseNum}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
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
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let settled = false;
    modalTitle.textContent = title;
    modalInput.placeholder = placeholder;
    modalInput.value = '';
    modalInput.style.display = 'block';
    modalConfirm.textContent = 'Create';
    modalBackdrop.setAttribute('aria-hidden', 'false');
    modalBackdrop.classList.remove('hidden');
    setTimeout(() => modalInput.focus(), prefersReducedMotion() ? 0 : 50);

    function done(val) {
      if (settled) return;
      settled = true;
      modalBackdrop.classList.add('hidden');
      modalBackdrop.setAttribute('aria-hidden', 'true');
      modalCancel.removeEventListener('click', cancel);
      modalConfirm.removeEventListener('click', confirm);
      modalInput.removeEventListener('keydown', keydown);
      modalBackdrop.removeEventListener('click', backdropClick);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      resolve(val);
    }
    function confirm() { const v = modalInput.value.trim(); done(v || null); }
    function cancel()  { done(null); }
    function keydown(e) {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') cancel();
    }
    function backdropClick(e) { if (e.target === modalBackdrop) cancel(); }
    modalConfirm.addEventListener('click', confirm);
    modalCancel.addEventListener('click', cancel);
    modalInput.addEventListener('keydown', keydown);
    modalBackdrop.addEventListener('click', backdropClick);
  });
}

function showConfirm(title, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let settled = false;
    modalTitle.textContent = title;
    modalInput.style.display = 'none';
    modalConfirm.textContent = confirmLabel;
    modalConfirm.classList.add('danger');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    modalBackdrop.classList.remove('hidden');
    setTimeout(() => modalCancel.focus(), prefersReducedMotion() ? 0 : 50);

    function done(val) {
      if (settled) return;
      settled = true;
      modalBackdrop.classList.add('hidden');
      modalBackdrop.setAttribute('aria-hidden', 'true');
      modalConfirm.classList.remove('danger');
      modalCancel.removeEventListener('click', cancel);
      modalConfirm.removeEventListener('click', confirm);
      document.removeEventListener('keydown', keydown);
      modalBackdrop.removeEventListener('click', backdropClick);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      resolve(val);
    }
    function confirm() { done(true); }
    function cancel()  { done(false); }
    function keydown(e) {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter') confirm();
    }
    function backdropClick(e) { if (e.target === modalBackdrop) cancel(); }
    modalConfirm.addEventListener('click', confirm);
    modalCancel.addEventListener('click', cancel);
    document.addEventListener('keydown', keydown);
    modalBackdrop.addEventListener('click', backdropClick);
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

async function restoreInitialView() {
  const saved = readSavedScrollState();
  if (!saved) return false;

  if (saved.mode === 'stacks') {
    const stacks = loadStacks();
    if (!stacks.length) return false;
    const target = stacks.find(stack => stack.id === saved.stacks?.activeStackId)?.id || stacks[0].id;
    appMode = 'stacks';
    activeStackId = target;
    updateNavState();
    renderStacksSummary();
    renderStacksList();
    renderStackView(target, { preserveScroll: true });
    restoreSavedScrollState(saved);
    return true;
  }

  if (saved.mode === 'bible' && saved.bible?.bookId && saved.bible?.chapter) {
    const book = allBooks.find(entry => entry.id === saved.bible.bookId);
    if (!book) return false;
    appMode = 'bible';
    activeTestament = book.testament;
    activeBook = book;
    activeChapter = null;
    updateNavState();
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
    await selectChapter(saved.bible.chapter);
    restoreSavedScrollState(saved);
    return true;
  }

  return false;
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
  const restored = await restoreInitialView();
  if (!restored) showWelcome();
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
    const item = document.createElement('div');
    const isExpanded = expandedBookId === book.id;
    const chapterCacheKey = `${activeTranslation}:${book.id}`;
    const chapterGridId = `book-chapters-${String(book.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    item.className = 'book-item-wrap' + (isExpanded ? ' expanded' : '');

    const button = document.createElement('button');
    button.className = 'book-item' + (activeBook?.id === book.id ? ' active' : '');
    button.type = 'button';
    button.setAttribute('aria-expanded', String(isExpanded));
    button.setAttribute('aria-controls', chapterGridId);
    button.innerHTML = `
      <span class="book-item-label">${escHtml(book.name)}</span>
      <span class="book-item-caret" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    `;
    button.addEventListener('click', () => {
      expandedBookId = isExpanded ? null : book.id;
      renderBookList();
      if (!isExpanded && !bookChapterCounts.has(chapterCacheKey) && !pendingChapterCountLoads.has(chapterCacheKey)) {
        pendingChapterCountLoads.add(chapterCacheKey);
        getBookChapterCount(book).finally(() => {
          pendingChapterCountLoads.delete(chapterCacheKey);
          if (expandedBookId === book.id) renderBookList();
        });
      }
    });
    item.appendChild(button);

    if (isExpanded) {
      const grid = document.createElement('div');
      grid.className = 'book-chapter-grid';
      grid.id = chapterGridId;

      const total = bookChapterCounts.get(chapterCacheKey);
      if (!total) {
        grid.innerHTML = `<div class="book-chapter-loading">Loading chapters...</div>`;
        if (!pendingChapterCountLoads.has(chapterCacheKey)) {
          pendingChapterCountLoads.add(chapterCacheKey);
          getBookChapterCount(book).finally(() => {
            pendingChapterCountLoads.delete(chapterCacheKey);
            if (expandedBookId === book.id) renderBookList();
          });
        }
      } else {
        for (let i = 1; i <= total; i += 1) {
          const chapterBtn = document.createElement('button');
          chapterBtn.className = 'book-chapter-btn' + (activeBook?.id === book.id && activeChapter === i ? ' active' : '');
          chapterBtn.type = 'button';
          chapterBtn.textContent = i;
          chapterBtn.setAttribute('aria-label', `${book.name} chapter ${i}`);
          if (activeBook?.id === book.id && activeChapter === i) chapterBtn.setAttribute('aria-current', 'page');
          chapterBtn.addEventListener('click', () => selectBookChapter(book, i));
          grid.appendChild(chapterBtn);
        }
      }

      item.appendChild(grid);
    }

    bookList.appendChild(item);
  });

  const activeRow = bookList.querySelector('.book-item-wrap.expanded') || bookList.querySelector('.book-item.active');
  if (activeRow) {
    requestAnimationFrame(() => activeRow.scrollIntoView({ block: 'nearest', behavior: 'auto' }));
  }
}

// ── Select book ───────────────────────────────────────
async function selectBook(book) {
  await selectBookChapter(book, 1);
}

async function selectBookChapter(book, chapter) {
  appMode = 'bible';
  updateNavState();
  activeTestament = book.testament;
  activeBook = book;
  activeChapter = chapter;
  expandedBookId = book.id;
  updateBibleChrome();
  closeBookSheet();
  const chapterCountPromise = getBookChapterCount(book);
  await selectChapter(chapter);
  const totalChapters = await chapterCountPromise;
  if (activeBook?.id === book.id && activeChapter === chapter) renderChapterBar(totalChapters);
}

// ── Chapter bar ───────────────────────────────────────
function renderChapterBar(total) {
  chapterBar.dataset.totalChapters = String(total ?? 0);
  chapterBar.innerHTML = '';
  schedulePaneChromeMeasure();
}

// ── Select chapter ────────────────────────────────────
async function selectChapter(num) {
  if (!activeBook) return;
  const requestId = ++chapterRequestId;
  const book = activeBook;
  const translation = activeTranslation;
  const isCurrentRequest = () => requestId === chapterRequestId
    && activeBook?.id === book.id
    && activeChapter === num
    && activeTranslation === translation;

  Voice.stopScripture();
  activeChapter = num;
  updateBibleChrome();
  renderBookList();
  clearSelection();
  currentVerses = [];
  greekByVerse = {};

  verseArea.innerHTML = `<div class="state-msg"><span class="spinner"></span> Loading…</div>`;

  const { data, error } = await supabase
    .from('verses')
    .select('verse, text')
    .eq('book_id', book.id)
    .eq('chapter', num)
    .eq('translation', translation)
    .order('verse');

  if (!isCurrentRequest()) return;
  if (error || !data?.length) {
    verseArea.innerHTML = `<div class="state-msg">No verses found.</div>`;
    return;
  }

  const nextGreekByVerse = {};
  if (book.testament === 'new') {
    const { data: greek } = await supabase
      .from('nt_word_tags')
      .select('verse, position, word, transliteration, gloss, strongs')
      .eq('book_id', book.id)
      .eq('chapter', num)
      .order('verse').order('position');
    if (!isCurrentRequest()) return;
    (greek ?? []).forEach(w => {
      if (!nextGreekByVerse[w.verse]) nextGreekByVerse[w.verse] = [];
      nextGreekByVerse[w.verse].push(w);
    });
  }

  if (!isCurrentRequest()) return;
  greekByVerse = nextGreekByVerse;
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
      <button class="book-title book-title-btn" type="button">${escHtml(activeBook.name)}</button>
      <div class="reader-meta">
        <span class="reader-meta-pill">Chapter ${activeChapter}</span>
        <span class="reader-meta-pill">${TRANSLATIONS[activeTranslation]}</span>
        ${hasGreekChapter ? '<span class="reader-meta-pill">Greek Study Ready</span>' : ''}
        ${Voice.isSupported ? `<button class="reader-play-btn" type="button" aria-label="Listen to this chapter">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 4.5l9 5.5-9 5.5z" fill="currentColor"/></svg>
          <span>Listen</span>
        </button>` : ''}
      </div>
    </section>
    <section class="scripture-card">
  `;
  verses.forEach(v => {
    const greekWords = greekByVerse[v.verse] ?? [];
    const hasGreek = isNT && greekWords.length > 0;
    html += `
      <button class="verse-row${hasGreek ? ' has-greek' : ''}" type="button" aria-pressed="false" aria-label="Select ${escHtml(activeBook.name)} ${activeChapter}:${v.verse}" ${hasGreek ? `data-verse="${v.verse}"` : ''} data-vnum="${v.verse}">
        <span class="verse-num">${v.verse}</span>
        <span class="verse-text">${escHtml(v.text)}</span>
      </button>
    `;
  });
  html += `</section>`;
  verseArea.innerHTML = html;
  verseArea.querySelector('.book-title-btn')?.addEventListener('click', openBookSheet);
  verseArea.querySelector('.reader-play-btn')?.addEventListener('click', playCurrentChapter);

  bibleContent.scrollTop = 0;
  resetChromeScroll(bibleContent, biblePane);
}

// ── Voice Mode integration ────────────────────────────
function chapterVoiceItems() {
  if (!activeBook || !activeChapter) return [];
  return currentVerses.map(v => ({
    ref: `${activeBook.name} ${activeChapter}:${v.verse}`,
    text: v.text,
    vnum: v.verse,
  }));
}
function playCurrentChapter() {
  if (!Voice.isSupported) return;
  const items = chapterVoiceItems();
  if (items.length) Voice.playScripture(items);
}
function clearVoiceHighlight() {
  document.querySelectorAll('.verse-row.verse-speaking').forEach(r => r.classList.remove('verse-speaking'));
}
function highlightSpokenVerse(item) {
  clearVoiceHighlight();
  if (!item || item.vnum == null || appMode !== 'bible') return;
  const row = verseArea.querySelector(`.verse-row[data-vnum="${item.vnum}"]`);
  if (!row) return;
  row.classList.add('verse-speaking');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
}
initVoice({
  onItemStart: highlightSpokenVerse,
  onStateChange: state => { if (state === 'idle') clearVoiceHighlight(); },
});

// ── Compare translations ───────────────────────────────
const compareBackdrop = document.getElementById('compare-backdrop');
const compareSheet    = document.getElementById('compare-sheet');
const compareRef      = document.getElementById('compare-ref');
const compareBody     = document.getElementById('compare-body');
let compareRequestId  = 0;

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
  if (compareBackdrop.classList.contains('hidden')) return;
  compareRequestId += 1;
  closeSheet(compareBackdrop);
}
document.getElementById('compare-close').addEventListener('click', closeCompare);
compareBackdrop.addEventListener('click', e => { if (e.target === compareBackdrop) closeCompare(); });

async function openCompare(ref, bookId, chapter, verse) {
  const requestId = ++compareRequestId;
  compareRef.textContent = ref;
  compareBody.innerHTML = '<div class="compare-loading"><span class="spinner"></span> Loading…</div>';
  openSheet(compareBackdrop);
  setTimeout(() => compareSheet.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 60);

  const { data, error } = await supabase
    .from('verses').select('translation, text')
    .eq('book_id', bookId).eq('chapter', chapter).eq('verse', verse)
    .order('translation');

  if (requestId !== compareRequestId) return;
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

  const requestId = ++compareRequestId;
  compareRef.textContent = buildCombinedVerseData(sorted).ref;
  compareBody.innerHTML = '<div class="compare-loading"><span class="spinner"></span> Loading…</div>';
  openSheet(compareBackdrop);
  setTimeout(() => compareSheet.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 60);

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

  if (requestId !== compareRequestId) return;
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
  stackDetail.querySelectorAll('.stack-verse-row').forEach(row => {
    row.classList.remove('stack-selected');
    row.removeAttribute('role');
    row.removeAttribute('tabindex');
    row.removeAttribute('aria-checked');
  });
  stackDetail.querySelectorAll('.compare-card-btn').forEach(btn => btn.setAttribute('aria-pressed', 'false'));

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
  card.querySelector('.compare-card-btn')?.setAttribute('aria-pressed', 'true');

  const selected = new Set(stackCompareSelectedRefs);
  card.querySelectorAll('.stack-verse-row').forEach(row => {
    row.setAttribute('role', 'checkbox');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-checked', String(selected.has(row.dataset.passageRef)));
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
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Translation comparison selection');
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('open'));
  }

  bar.dataset.dismissed = 'false';
  bar.className = 'selection-bar stack-compare-bar open';
  bar.innerHTML = `
    <div class="sel-head">
      <span class="sel-count">${countLabel}</span>
      <button class="sel-done-btn" type="button" title="Done">Done</button>
    </div>
    <div class="sel-actions">
      <button class="sel-secondary-btn" type="button">Compare</button>
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
  if (target.closest('button, input, textarea, select, a')) return;
  const row = target.closest('.stack-verse-row');
  if (!row || appMode !== 'stacks' || !stackCompareMode) return;
  const card = row.closest('.stack-verse-card');
  if (!card || parseInt(card.dataset.idx) !== activeStackCompareIdx) return;
  toggleStackComparePassage(card.dataset.idx, row.dataset.passageRef);
});

stackDetail.addEventListener('keydown', e => {
  if (!['Enter', ' '].includes(e.key) || appMode !== 'stacks' || !stackCompareMode) return;
  const row = e.target instanceof Element ? e.target.closest('.stack-verse-row') : null;
  if (!row) return;
  const card = row.closest('.stack-verse-card');
  if (!card || parseInt(card.dataset.idx) !== activeStackCompareIdx) return;
  e.preventDefault();
  toggleStackComparePassage(card.dataset.idx, row.dataset.passageRef);
});

// ── Verse click → action mode ─────────────────────────
function startVerseActionFromRow(row) {
  const verseData = getCurrentVerseData(parseInt(row.dataset.vnum));
  if (!verseData) return false;
  startVerseActionMode(verseData, row);
  return true;
}

function selectVerseRange(fromVerse, toVerse) {
  if (fromVerse == null || toVerse == null) return false;
  const start = Math.min(fromVerse, toVerse);
  const end = Math.max(fromVerse, toVerse);
  let changed = false;

  for (let verseNum = start; verseNum <= end; verseNum += 1) {
    const verseData = getCurrentVerseData(verseNum);
    const row = verseArea.querySelector(`.verse-row[data-vnum="${verseNum}"]`);
    if (!verseData || !row || selectedVerses.some(v => v.ref === verseData.ref)) continue;
    selectedVerses.push(verseData);
    row.classList.add('selected');
    row.setAttribute('aria-pressed', 'true');
    changed = true;
  }

  if (changed) syncBibleActionRows();
  updateSelectionBar();
  return changed;
}

verseArea.addEventListener('click', e => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const row = target.closest('.verse-row');
  if (!row || appMode !== 'bible') return;
  if (Date.now() < suppressVerseTapUntil) return;

  const verseData = getCurrentVerseData(parseInt(row.dataset.vnum));
  if (!verseData) return;

  if (!verseActionMode) {
    startVerseActionMode(verseData, row);
    triggerHaptic(12);
    return;
  }

  if (e.shiftKey && activeActionVerseNum != null) {
    selectVerseRange(activeActionVerseNum, verseData.verse);
    setActiveBibleVerse(verseData.verse);
    return;
  }

  const isSelected = row.classList.contains('selected');
  if (isSelected) {
    toggleVerseSelection(verseData, row, null);
    if (selectedVerses.length) {
      const fallback = selectedVerses[selectedVerses.length - 1];
      setActiveBibleVerse(fallback?.verse ?? null);
    }
    return;
  }

  toggleVerseSelection(verseData, row, null);
  setActiveBibleVerse(verseData.verse);
});

verseArea.addEventListener('dblclick', e => {
  if (appMode !== 'bible') return;
  const row = e.target instanceof Element ? e.target.closest('.verse-row') : null;
  if (!row) return;
  if (startVerseActionFromRow(row)) {
    suppressVerseTapUntil = Date.now() + 450;
  }
});

verseArea.addEventListener('mousedown', e => {
  if (appMode !== 'bible' || e.button !== 0) return;
  const row = e.target instanceof Element ? e.target.closest('.verse-row') : null;
  if (!row) return;

  if (verseMousePressCleanup) verseMousePressCleanup();

  const startX = e.clientX;
  const startY = e.clientY;

  const clearPress = () => {
    clearTimeout(timer);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
    window.removeEventListener('blur', onEnd);
    if (verseMousePressCleanup === clearPress) verseMousePressCleanup = null;
  };

  const onMove = evt => {
    if (Math.abs(evt.clientX - startX) > 10 || Math.abs(evt.clientY - startY) > 10) {
      clearPress();
    }
  };

  const onEnd = () => {
    clearPress();
  };

  const timer = setTimeout(() => {
    if (startVerseActionFromRow(row)) {
      suppressVerseTapUntil = Date.now() + 450;
    }
    clearPress();
  }, 380);

  verseMousePressCleanup = clearPress;
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('blur', onEnd);
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
    if (!startVerseActionFromRow(row)) {
      clearPress();
      return;
    }
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
  startVerseActionFromRow(row);
  suppressVerseTapUntil = Date.now() + 450;
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
      <button class="gp-back" id="gp-back" type="button">&#8592; Back</button>
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
  Voice.stopScripture();
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
// Semantic search via Transformers.js (browser-side query embedding) +
// Supabase pgvector (pre-computed verse embeddings across available translations).
const EMBED_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
const EMBED_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
let _embedder = null;
let _embedderPromise = null;

function preloadEmbedder() {
  if (_embedder) return Promise.resolve(_embedder);
  if (_embedderPromise) return _embedderPromise;
  _embedderPromise = (async () => {
    const mod = await import(EMBED_MODEL_URL);
    mod.env.allowLocalModels = false;
    _embedder = await mod.pipeline('feature-extraction', EMBED_MODEL_NAME, { quantized: true });
    return _embedder;
  })();
  return _embedderPromise;
}

async function embedQueryVector(text) {
  const embedder = await preloadEmbedder();
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'he',
  'her', 'him', 'his', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not',
  'now', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'thou', 'thy', 'to', 'unto', 'us',
  'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'ye',
  'you', 'your'
]);

function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getSearchTerms(query) {
  const seen = new Set();
  return normalizeSearchText(query).split(/\s+/)
    .filter(term => term.length >= 3 && !SEARCH_STOPWORDS.has(term))
    .filter(term => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    })
    .slice(0, 8);
}

function levenshteinWithin(a, b, maxDistance = 1) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

function scoreKeywordMatch(query, verseText) {
  const terms = getSearchTerms(query);
  if (!terms.length) return 0;
  const normalizedText = normalizeSearchText(verseText);
  const words = normalizedText.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (normalizedText.includes(term)) {
      score += term.length >= 6 ? 4 : 3;
      continue;
    }
    const matched = words.some(word => {
      if (word.startsWith(term) || term.startsWith(word)) return true;
      if (term.length < 5 || word.length < 5) return false;
      return levenshteinWithin(term, word, 1) <= 1;
    });
    if (matched) score += term.length >= 5 ? 2.5 : 2;
  }
  const phrase = normalizeSearchText(query);
  if (phrase.length >= 8 && normalizedText.includes(phrase)) score += 8;
  return score / terms.length;
}

function normalizeSearchResult(row, source = 'semantic') {
  return {
    book_id: row.book_id,
    book_name: row.book_name || row.books?.name || '',
    chapter: row.chapter,
    verse: row.verse,
    text: row.text,
    similarity: Number(row.similarity) || 0,
    sources: new Set([source])
  };
}

async function fetchKeywordCandidates(query) {
  const terms = getSearchTerms(query).filter(term => term.length >= 4);
  const candidateTerms = terms.length ? terms.slice(0, 5) : [normalizeSearchText(query)].filter(Boolean);
  const queryWords = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const phraseTerms = [];
  for (const size of [4, 3]) {
    for (let i = 0; i <= queryWords.length - size; i++) {
      const phrase = queryWords.slice(i, i + size).join(' ');
      if (phrase.length >= 8 && !phraseTerms.includes(phrase)) phraseTerms.push(phrase);
    }
  }
  if (!candidateTerms.length && !phraseTerms.length) return [];

  const phraseResponses = await Promise.all(phraseTerms.slice(0, 8).map(phrase =>
    supabase
      .from('verses')
      .select('verse, chapter, text, book_id, books(name)')
      .eq('translation', activeTranslation)
      .ilike('text', `%${phrase}%`)
      .limit(20)
  ));

  const responses = await Promise.all(candidateTerms.map(term =>
    supabase
      .from('verses')
      .select('verse, chapter, text, book_id, books(name)')
      .eq('translation', activeTranslation)
      .ilike('text', `%${term}%`)
      .limit(80)
  ));

  const rows = [];
  phraseResponses.forEach(({ data, error }) => {
    if (!error && data?.length) rows.push(...data);
  });
  responses.forEach(({ data, error }) => {
    if (!error && data?.length) rows.push(...data);
  });
  return rows.map(row => normalizeSearchResult(row, 'keyword'));
}

function mergeAndRankSearchResults(query, semanticRows = [], keywordRows = []) {
  const normalizePhraseText = text => String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const scorePhraseMatch = verseText => {
    const normalizedQuery = normalizePhraseText(query);
    const normalizedVerse = normalizePhraseText(verseText);
    if (!normalizedQuery || !normalizedVerse) return 0;
    if (normalizedVerse.includes(normalizedQuery)) return 5;

    const queryWords = normalizedQuery.split(' ').filter(Boolean);
    const verseWords = normalizedVerse.split(' ').filter(Boolean);
    let score = 0;

    if (queryWords.length >= 3) {
      for (let i = 0; i <= queryWords.length - 3; i++) {
        const phrase = queryWords.slice(i, i + 3).join(' ');
        if (normalizedVerse.includes(phrase)) {
          score = Math.max(score, 2);
          break;
        }
      }
    }

    const importantWords = queryWords.filter(word => word.length >= 4 && !SEARCH_STOPWORDS.has(word));
    if (importantWords.length >= 2) {
      const positions = [];
      verseWords.forEach((word, idx) => {
        if (importantWords.includes(word)) positions.push(idx);
      });
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          if (positions[j] - positions[i] <= 8) {
            score = Math.max(score, 1);
            break;
          }
        }
        if (score >= 1) break;
      }
    }

    return score;
  };
  const byRef = new Map();
  [...semanticRows.map(row => normalizeSearchResult(row, 'semantic')), ...keywordRows].forEach(row => {
    const key = `${row.book_id}:${row.chapter}:${row.verse}`;
    const existing = byRef.get(key);
    if (!existing) {
      byRef.set(key, row);
      return;
    }
    existing.similarity = Math.max(existing.similarity, row.similarity || 0);
    row.sources.forEach(source => existing.sources.add(source));
  });

  return [...byRef.values()]
    .map(row => {
      const keywordScore = scoreKeywordMatch(query, row.text);
      const semanticScore = Math.max(0, row.similarity || 0);
      const hybridBonus = row.sources.has('keyword') && row.sources.has('semantic') ? 1.25 : 0;
      const phraseScore = scorePhraseMatch(row.text);
      const semanticBoost = semanticScore >= 0.74 ? 14 : semanticScore >= 0.70 ? 5 : semanticScore >= 0.66 ? 2 : 0;
      return {
        ...row,
        _rank: keywordScore * 5 + semanticScore * 8 + semanticBoost + hybridBonus + phraseScore
      };
    })
    .filter(row => row._rank > 0.4)
    .sort((a, b) => b._rank - a._rank)
    .slice(0, 30);
}

async function doSearch() {
  if (searchBtn.disabled) return;
  const query = searchInput.value.trim();
  if (!query) {
    updateSearchEmptyState();
    return;
  }
  const requestId = ++searchRequestId;
  const isCurrentRequest = () => requestId === searchRequestId;
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching…';
  searchResults.setAttribute('aria-busy', 'true');
  try {
    // Reference parser still wins for direct lookups like "John 3:16"
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

    const loadingMsg = _embedder
      ? 'Searching...'
      : 'Preparing smart search (one-time ~25 MB download)...';
    searchResults.innerHTML = `<div class="search-empty"><span class="spinner"></span> ${escHtml(loadingMsg)}</div>`;

    const keywordPromise = fetchKeywordCandidates(query);
    let keywordRows = [];
    try {
      keywordRows = await keywordPromise;
    } catch {}
    if (!isCurrentRequest()) return;

    let queryVec;
    let semanticRows = [];
    try {
      queryVec = await embedQueryVector(query);
      // Send pgvector input as a stable vector literal instead of relying on JS array casting.
      const queryVectorLiteral = `[${queryVec.map((value) => Number(value).toFixed(8)).join(',')}]`;
      const { data, error } = await supabase.rpc('search_verses_semantic', {
        query_embedding: queryVectorLiteral,
        match_count: 120,
        target_translation: activeTranslation,
      });
      if (!isCurrentRequest()) return;
      if (error) {
        if (!keywordRows.length) {
          console.error('Semantic search failed', error);
          updateSearchEmptyState('Search is temporarily unavailable. Please try again.');
          return;
        }
      } else {
        semanticRows = data || [];
      }
    } catch (err) {
      if (!keywordRows.length) {
        console.error('Search model failed to load', err);
        updateSearchEmptyState('Smart search could not start. Check your connection and try again.');
        return;
      }
    }

    if (!isCurrentRequest()) return;
    const data = mergeAndRankSearchResults(query, semanticRows, keywordRows);
    if (!data?.length) {
      updateSearchEmptyState(`No results for "${query}"`);
      return;
    }

    let html = `<div class="result-count">${data.length} result${data.length !== 1 ? 's' : ''} for "${escHtml(query)}"</div>`;
    data.forEach((v, idx) => {
      const refLabel = `${v.book_name} ${v.chapter}:${v.verse}`;
      html += `
        <div class="result-item" data-idx="${idx}" role="group" tabindex="0" aria-label="Open ${escHtml(refLabel)}">
          <div class="result-item-header">
            <div class="result-ref">${escHtml(refLabel)}</div>
            <div class="result-actions">
              ${Voice.isSupported ? `<button class="result-play-btn" data-idx="${idx}" type="button" title="Listen" aria-label="Listen to this verse">▶</button>` : ''}
              <button class="add-btn" data-idx="${idx}" type="button" title="Select verse" aria-label="Select verse" aria-pressed="false">+</button>
            </div>
          </div>
          <div class="result-text">${escHtml(v.text)}</div>
        </div>
      `;
    });

    searchResults.innerHTML = html;

    searchResults.querySelectorAll('.result-item').forEach(item => {
      const openResult = async e => {
        if (e.target.closest('.add-btn, .result-play-btn')) return;
        const v = data[parseInt(item.dataset.idx)];
        const book = allBooks.find(entry => entry.id === v.book_id);
        if (!book) return;
        clearSelection();
        closeSearchSheet();
        await openBibleLocation(book, v.chapter);
        focusVerseRow(v.verse);
      };
      item.addEventListener('click', openResult);
      item.addEventListener('keydown', e => {
        if (e.target !== item || !['Enter', ' '].includes(e.key)) return;
        e.preventDefault();
        void openResult(e);
      });
    });

    searchResults.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const v = data[parseInt(btn.dataset.idx)];
        toggleVerseSelection({
          ref: `${v.book_name} ${v.chapter}:${v.verse}`,
          book: v.book_name,
          chapter: v.chapter,
          verse: v.verse,
          text: v.text,
          translation: activeTranslation
        }, btn.closest('.result-item'), btn);
      });
    });

    searchResults.querySelectorAll('.result-play-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const v = data[parseInt(btn.dataset.idx)];
        Voice.playScripture([{ ref: `${v.book_name} ${v.chapter}:${v.verse}`, text: v.text }]);
      });
    });
  } finally {
    if (isCurrentRequest()) {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search';
      searchResults.setAttribute('aria-busy', 'false');
    }
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
  if (e.key === 'Enter') {
    e.preventDefault();
    void doSearch();
  }
});

// ── Arrow key chapter navigation ──────────────────────
document.addEventListener('keydown', e => {
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
  if (appMode !== 'bible') return;
  if (!greekPage.classList.contains('hidden')) return;
  if (document.querySelector('.sheet-backdrop:not(.hidden), .modal-backdrop:not(.hidden), .compare-backdrop:not(.hidden), .translation-picker-backdrop, .stack-add-backdrop, .stack-switcher-backdrop')) return;
  if (!activeBook || !activeChapter) return;
  const maxChapter = Number(chapterBar.dataset.totalChapters || bookChapterCounts.get(`${activeTranslation}:${activeBook.id}`) || activeChapter);
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
  if (e.key === 'ArrowDown') { e.preventDefault(); bibleContent.scrollBy({ top: 120, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); bibleContent.scrollBy({ top: -120, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); }
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
    addedAt: Number(card?.addedAt) || nowTs(),
    translation: TRANSLATIONS[card?.translation] ? card.translation : 'kjv'
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
  authReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  refreshAuthUi();
  authBackdrop.setAttribute('aria-hidden', 'false');
  authBackdrop.classList.remove('hidden');
  accountBtn.setAttribute('aria-expanded', 'true');
  authOpenBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => {
    if (authBackdrop.classList.contains('hidden')) return;
    if (!authUser) authEmailInput.focus();
    else authBackdrop.querySelector('.auth-modal')?.focus({ preventScroll: true });
  }, prefersReducedMotion() ? 0 : 50);
}

function closeAuthModal() {
  if (authBackdrop.classList.contains('hidden')) return;
  authBackdrop.classList.add('hidden');
  authBackdrop.setAttribute('aria-hidden', 'true');
  accountBtn.setAttribute('aria-expanded', 'false');
  authOpenBtn.setAttribute('aria-expanded', 'false');
  authPasswordInput.value = '';
  setAuthFeedback('');
  if (authReturnFocus?.isConnected) authReturnFocus.focus({ preventScroll: true });
  authReturnFocus = null;
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
    refreshStacksUi({ preserveView: true });
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
    refreshStacksUi({ preserveView: true });
    return;
  }

  const remoteStacks = normalizeStacks(data?.stacks || []);
  const nextStacks = remoteStacks.length ? mergeStacks(remoteStacks, localStacks) : localStacks;
  const shouldPushMergedCopy = serializeStacks(remoteStacks) !== serializeStacks(nextStacks);

  saveStacks(nextStacks, { remote: false });
  setStackSyncState('synced');
  refreshStacksUi({ preserveView: true });

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
  if (appMode !== mode) Voice.stopScripture();
  const alreadyActive = appMode === mode;
  const persisted = readSavedScrollState();
  const currentState = captureScrollState({ immediate: true });
  const saved = (alreadyActive && persisted) ? persisted : currentState;
  appMode = mode;
  closeBookSheet();
  closeSearchSheet();
  closeTranslationPicker();
  updateNavState();
  syncBottomNavChrome();

  if (alreadyActive) {
    showActivePaneChrome();
    restoreSavedScrollState(saved);
    return;
  }

  if (mode === 'stacks') {
    clearSelection();
    const stacks = loadStacks();
    if (stacks.length > 0) {
      const target = stacks.find(s => s.id === activeStackId) ? activeStackId : stacks[0].id;
      activeStackId = target;
      renderStacksSummary();
      renderStacksList();
      renderStackView(target, { preserveScroll: true });
      restoreSavedScrollState(saved);
    } else {
      activeStackId = null;
      showStacksWelcome();
    }
    return;
  }

  clearStackCompareMode();
  updateBibleChrome();
  renderBookList();
  if (!activeBook || !activeChapter) {
    showWelcome();
  } else {
    restoreSavedScrollState(saved);
  }
}

function refreshStacksUi({ preserveView = false } = {}) {
  const saved = preserveView ? readSavedScrollState() : null;
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

  const savedStackId = preserveView ? saved?.stacks?.activeStackId : null;
  const target =
    stacks.find(s => s.id === activeStackId)?.id ||
    stacks.find(s => s.id === savedStackId)?.id ||
    stacks[0].id;
  if (preserveView && target === activeStackId) {
    renderStackView(target, { preserveScroll: true });
    restoreSavedScrollState(saved);
    return;
  }
  openStack(target);
  if (preserveView) restoreSavedScrollState(saved);
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
    Voice.stopScripture();
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
          value="${escHtml(stack.title)}" maxlength="60" placeholder="Stack title…" aria-label="Stack title" />
        <button class="delete-stack-btn" id="delete-stack-btn" type="button">Delete Stack</button>
      </div>
      <div class="stack-verse-count">${countStackPassages(stack)} saved passage${countStackPassages(stack) !== 1 ? 's' : ''} across ${stack.verses.length} card${stack.verses.length !== 1 ? 's' : ''}</div>
      <div class="stack-add-bar">
        <input class="stack-add-input" id="stack-add-input" type="search" placeholder="Search words or enter a reference…" autocomplete="off" enterkeyhint="search" aria-label="Find a verse to add" />
        <button class="stack-add-search-btn" id="stack-add-search-btn" type="button">Search</button>
      </div>
      <div class="stack-add-results" id="stack-add-results" aria-live="polite"></div>
  `;

  if (stack.verses.length === 0) {
    html += `<div class="state-msg stack-empty-state"><strong>No saved cards yet.</strong>Tap a verse in the Bible reader, then choose Add to Stack. You can also search above.</div>`;
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
              ${pi > 0 ? `<button class="remove-passage-btn" data-cardidx="${idx}" data-pi="${pi}" type="button" title="Remove passage" aria-label="Remove ${escHtml(p.ref)}">×</button>` : ''}
            </div>`;
      }).join('');
      html += `
        <div class="stack-verse-card${isActiveCard ? ' action-active' : ''}" data-idx="${idx}">
          <div class="stack-verse-card-header">
            <span class="stack-verse-ref">${escHtml(cardRef)}</span>
            <button class="remove-verse-btn" data-idx="${idx}" type="button" title="Remove card" aria-label="Remove saved card">×</button>
          </div>
          ${passagesHtml}
          <div class="stack-card-actions">
            <button class="add-passage-btn" data-idx="${idx}" type="button" title="Add scripture" aria-label="Add scripture to this card" aria-expanded="false">
              <svg class="stack-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
              <span class="stack-action-label">Add</span>
            </button>
            <button class="note-toggle" data-idx="${idx}" type="button" title="Note" aria-label="${hasNote ? 'Edit' : 'Add'} note" aria-expanded="${!!hasNote}">
              <svg class="stack-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M6 14.2 5 15l.8-2.6L13 5.2a1.6 1.6 0 0 1 2.2 0l.6.6a1.6 1.6 0 0 1 0 2.2L8.6 15.2l-2.6.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              </svg>
              <span class="stack-action-label">Note</span>
            </button>
            <button class="compare-card-btn" data-idx="${idx}" type="button" title="Compare translations" aria-pressed="${isActiveCard}">
              <svg class="stack-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.8 7.2h12.4M12.8 4.4l3.4 2.8-3.4 2.8M16.2 12.8H3.8M7.2 15.6l-3.4-2.8L7.2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="stack-action-label">Compare</span>
            </button>
            ${Voice.isSupported ? `<button class="listen-card-btn" data-idx="${idx}" type="button" title="Listen to this card">
              <svg class="stack-action-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M6 4.5 15 10l-9 5.5z" fill="currentColor"/>
              </svg>
              <span class="stack-action-label">Listen</span>
            </button>` : ''}
            <button class="card-translation-btn" data-idx="${idx}" type="button" title="Switch translation" aria-label="Switch card translation">${TRANSLATIONS[v.translation || 'kjv']}</button>
          </div>
          <div class="add-passage-area hidden">
            <div class="add-passage-search-row">
              <input class="add-passage-input" data-cardidx="${idx}" type="search" placeholder="Words or reference…" autocomplete="off" enterkeyhint="search" aria-label="Find scripture to add to this card" />
              <button class="add-passage-search-btn" type="button">Search</button>
            </div>
            <div class="add-passage-results" aria-live="polite"></div>
          </div>
          <textarea class="stack-note${hasNote ? '' : ' hidden'}" data-idx="${idx}" placeholder="Add a note…" aria-label="Note for ${escHtml(cardRef)}">${escHtml(v.note || '')}</textarea>
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

  const titleInput = stackDetail.querySelector('#stack-title-input');
  if (titleInput) {
    const commitTitle = debounce(value => updateStackTitle(id, value), 180);
    titleInput.addEventListener('input', e => commitTitle(e.target.value));
    titleInput.addEventListener('blur', commitTitle.flush);
    titleInput.addEventListener('change', commitTitle.flush);
  }

  stackDetail.querySelector('#delete-stack-btn')?.addEventListener('click', async () => {
    const ok = await showConfirm(`Delete "${stack.title}"?`);
    if (ok) deleteStack(id);
  });

  stackDetail.querySelectorAll('.remove-verse-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('Remove this saved card?', 'Remove');
      if (ok) removeVerseFromStack(id, parseInt(btn.dataset.idx));
    });
  });

  stackDetail.querySelectorAll('.add-passage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const area = btn.closest('.stack-verse-card').querySelector('.add-passage-area');
      const opening = area.classList.contains('hidden');
      area.classList.toggle('hidden', !opening);
      btn.setAttribute('aria-expanded', String(opening));
      if (opening) area.querySelector('.add-passage-input').focus();
    });
  });

  stackDetail.querySelectorAll('.listen-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.stack-verse-card');
      const items = Array.from(card.querySelectorAll('.stack-verse-row')).map(row => ({
        ref: row.dataset.passageRef,
        text: row.querySelector('.stack-verse-text')?.textContent || '',
      })).filter(it => it.text.trim());
      if (items.length) Voice.playScripture(items);
    });
  });

  stackDetail.querySelectorAll('.remove-passage-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('Remove this passage from the card?', 'Remove');
      if (ok) removePassageFromCard(id, parseInt(btn.dataset.cardidx), parseInt(btn.dataset.pi));
    });
  });

  stackDetail.querySelectorAll('.add-passage-input').forEach(input => {
    const cardIdx = parseInt(input.dataset.cardidx);
    const area = input.closest('.add-passage-area');
    const resultsEl = area.querySelector('.add-passage-results');
    const searchButton = area.querySelector('.add-passage-search-btn');
    let passageSearchId = 0;

    function renderPassageResults(passages) {
      resultsEl.innerHTML = passages.map((passage, i) => `
        <button class="add-passage-result-row" data-idx="${i}" type="button" aria-label="Add ${escHtml(passage.ref)}">
          <span class="add-passage-result-copy">
            <span class="add-passage-result-ref">${escHtml(passage.ref)}</span>
            <span class="add-passage-result-text">${escHtml(passage.text)}</span>
          </span>
          <span class="add-passage-result-action" aria-hidden="true">Add</span>
        </button>`).join('');
      resultsEl.querySelectorAll('.add-passage-result-row').forEach(row => {
        row.addEventListener('click', () => {
          const passage = passages[parseInt(row.dataset.idx)];
          if (passage) addPassageToCard(id, cardIdx, passage);
        });
      });
    }

    async function searchAndShow() {
      if (searchButton.disabled) return;
      const q = input.value.trim();
      if (!q) return;
      const requestId = ++passageSearchId;
      const cardData = stack.verses[cardIdx];
      const translation = cardData?.translation || activeTranslation;
      searchButton.disabled = true;
      searchButton.textContent = 'Searching…';
      resultsEl.setAttribute('aria-busy', 'true');
      resultsEl.innerHTML = `<div class="add-passage-loading">Searching…</div>`;

      try {
        const ref = parseReference(q);
        let passages = [];
        let error = null;

        if (ref?.chapter) {
          const response = await supabase
            .from('verses').select('verse, text')
            .eq('book_id', ref.book.id).eq('chapter', ref.chapter).eq('translation', translation).order('verse');
          error = response.error;
          const verses = ref.verseStart
            ? (response.data ?? []).filter(v => v.verse >= ref.verseStart && v.verse <= (ref.verseEnd ?? ref.verseStart))
            : (response.data ?? []);
          passages = verses.map(v => ({ ref: `${ref.book.name} ${ref.chapter}:${v.verse}`, text: v.text }));
        } else {
          const response = await supabase
            .from('verses').select('verse, chapter, text, book_id, books(name)')
            .eq('translation', translation).ilike('text', `%${q}%`).limit(20);
          error = response.error;
          passages = (response.data ?? []).map(v => {
            const bookName = Array.isArray(v.books) ? v.books[0]?.name : v.books?.name;
            return { ref: `${bookName || 'Bible'} ${v.chapter}:${v.verse}`, text: v.text };
          });
        }

        if (requestId !== passageSearchId || !resultsEl.isConnected) return;
        if (error) console.error('Card passage search failed', error);
        if (error || !passages.length) {
          resultsEl.innerHTML = `<div class="add-passage-loading">No results found.</div>`;
          return;
        }
        renderPassageResults(passages);
      } finally {
        if (requestId === passageSearchId && searchButton.isConnected) {
          searchButton.disabled = false;
          searchButton.textContent = 'Search';
          resultsEl.setAttribute('aria-busy', 'false');
        }
      }
    }

    searchButton.addEventListener('click', () => { void searchAndShow(); });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      void searchAndShow();
    });
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
      btn.setAttribute('aria-expanded', String(opening));
      if (opening) ta.focus();
    });
  });

  stackDetail.querySelectorAll('.stack-note').forEach(ta => {
    const commitNote = debounce(value => updateVerseNote(id, parseInt(ta.dataset.idx), value), 240);
    ta.addEventListener('input', () => commitNote(ta.value));
    ta.addEventListener('blur', commitNote.flush);
  });

  stackDetail.querySelectorAll('.card-translation-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const current = stack.verses[idx]?.translation || 'kjv';
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
            if (!m) return null;
            const [, bookName, ch, verse] = m;
            const book = allBooks.find(b => b.name.toLowerCase() === bookName.toLowerCase());
            if (!book) return null;
            const { data } = await supabase.from('verses').select('text')
              .eq('book_id', book.id).eq('chapter', parseInt(ch)).eq('verse', parseInt(verse)).eq('translation', next).single();
            return data?.text ? { ref: p.ref, text: data.text } : null;
          }));

          if (fetched.some(p => !p)) {
            showToast(`${TRANSLATIONS[next]} is unavailable for part of this card`);
            return;
          }

          v.passages = fetched;
          v.translation = next;
          touchStack(stack);
          saveStacks(stacks);

          // Update just the verse rows in this card.
          const rows = card.querySelectorAll('.stack-verse-row');
          fetched.forEach((p, pi) => {
            const textEl = rows[pi]?.querySelector('.stack-verse-text');
            if (textEl) textEl.textContent = p.text;
          });

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
  let stackSearchId = 0;

  async function doStackSearch() {
    if (addBtn.disabled) return;
    const q = addInput.value.trim();
    if (!q) return;
    const requestId = ++stackSearchId;
    const translation = activeTranslation;
    addBtn.disabled = true;
    addBtn.textContent = 'Searching…';
    addResults.setAttribute('aria-busy', 'true');
    addResults.innerHTML = `<div class="stack-add-loading">Searching…</div>`;

    try {
      const ref = parseReference(q);
      let results = [];
      let error = null;

      if (ref?.chapter) {
        const response = await supabase
          .from('verses').select('verse, chapter, text, book_id')
          .eq('book_id', ref.book.id)
          .eq('chapter', ref.chapter)
          .eq('translation', translation)
          .order('verse');
        error = response.error;
        const verses = ref.verseStart
          ? (response.data ?? []).filter(v => v.verse >= ref.verseStart && v.verse <= (ref.verseEnd ?? ref.verseStart))
          : (response.data ?? []);
        results = verses.map(v => ({ ...v, bookName: ref.book.name }));
      } else {
        const response = await supabase
          .from('verses')
          .select('verse, chapter, text, book_id, books(name)')
          .eq('translation', translation)
          .ilike('text', `%${q}%`)
          .limit(30);
        error = response.error;
        results = (response.data ?? []).map(v => ({
          ...v,
          bookName: (Array.isArray(v.books) ? v.books[0]?.name : v.books?.name) || 'Bible'
        }));
      }

      if (requestId !== stackSearchId || !addResults.isConnected) return;
      if (error) console.error('Stack verse search failed', error);
      if (error || !results.length) {
        addResults.innerHTML = `<div class="stack-add-loading">No results found.</div>`;
        return;
      }

      addResults.innerHTML = results.map((v, i) => `
        <div class="stack-add-result-row">
          <div class="stack-add-result-copy">
            <div class="stack-add-result-ref">${escHtml(v.bookName)} ${v.chapter}:${v.verse}</div>
            <div class="stack-add-result-text">${escHtml(v.text)}</div>
          </div>
          <button class="stack-add-result-btn" data-idx="${i}" type="button" aria-label="Add ${escHtml(v.bookName)} ${v.chapter}:${v.verse} to this stack">+ Add</button>
        </div>
      `).join('');
      addResults.querySelectorAll('.stack-add-result-btn').forEach(resultBtn => {
        resultBtn.addEventListener('click', () => {
          const v = results[parseInt(resultBtn.dataset.idx)];
          addVerseToStack(id, {
            ref: `${v.bookName} ${v.chapter}:${v.verse}`,
            book: v.bookName,
            chapter: v.chapter,
            verse: v.verse,
            text: v.text,
            translation
          });
        });
      });
    } finally {
      if (requestId === stackSearchId && addBtn.isConnected) {
        addBtn.disabled = false;
        addBtn.textContent = 'Search';
        addResults.setAttribute('aria-busy', 'false');
      }
    }
  }

  addBtn.addEventListener('click', () => { void doStackSearch(); });
  addInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void doStackSearch();
  });
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
      <button id="empty-new-stack-btn" type="button">Create Stack</button>
    </div>
  `;
  stackDetail.querySelector('#empty-new-stack-btn')?.addEventListener('click', () => newStackBtn.click());
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
  let dragCard = null, longPressTimer = null, startX = 0, startY = 0, offsetY = 0;
  let placeholder = null, scrollInterval = null, isDragging = false;

  stackDetail.addEventListener('touchstart', e => {
    if (isDragging) return;
    const card = e.target.closest('.stack-verse-card');
    if (!card || e.target.closest('input, button, textarea, a')) return;
    if (appMode !== 'stacks' || !activeStackId || stackCompareMode) return;
    const touch = e.touches[0];
    startX = touch.clientX;
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
      if (longPressTimer && (
        Math.abs(e.touches[0].clientX - startX) > 8 ||
        Math.abs(e.touches[0].clientY - startY) > 8
      )) {
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
  const passages = verseData.passages || [{ ref: verseData.ref, text: verseData.text }];
  const existingRefs = new Set(stack.verses.flatMap(card => (
    card.passages || [{ ref: card.ref, text: card.text }]
  )).map(passage => passage.ref));
  if (passages.length && passages.every(passage => existingRefs.has(passage.ref))) {
    showToast(`Already in "${stack.title}"`);
    return;
  }
  stack.verses.push({
    passages,
    note: '',
    addedAt: Date.now(),
    translation: TRANSLATIONS[verseData.translation] ? verseData.translation : activeTranslation
  });
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
let activeToast = null;
let activeToastTimer = null;
let activeToastRemoveTimer = null;

function showToast(msg) {
  clearTimeout(activeToastTimer);
  clearTimeout(activeToastRemoveTimer);
  if (!activeToast?.isConnected) {
    activeToast = document.createElement('div');
    activeToast.className = 'toast';
    activeToast.setAttribute('role', 'status');
    activeToast.setAttribute('aria-live', 'polite');
    activeToast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(activeToast);
  }

  activeToast.textContent = msg;
  let obstructionTop = window.innerHeight;
  document.querySelectorAll('.bottom-nav, .selection-bar.open, .voice-bar.open').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > 0) obstructionTop = Math.min(obstructionTop, rect.top);
  });
  activeToast.style.setProperty('--toast-bottom', `${Math.max(16, window.innerHeight - obstructionTop + 12)}px`);
  requestAnimationFrame(() => activeToast?.classList.add('show'));
  activeToastTimer = setTimeout(() => {
    const toast = activeToast;
    toast?.classList.remove('show');
    activeToastRemoveTimer = setTimeout(() => {
      if (activeToast !== toast) return;
      toast?.remove();
      activeToast = null;
      activeToastRemoveTimer = null;
    }, prefersReducedMotion() ? 0 : 300);
  }, 2200);
}

// ── Multi-select ──────────────────────────────────────
function syncBibleActionRows() {
  verseArea.querySelectorAll('.verse-row.action-active, .verse-row.selected-start, .verse-row.selected-middle, .verse-row.selected-end').forEach(row => {
    row.classList.remove('action-active', 'selected-start', 'selected-middle', 'selected-end');
  });
  const selectedRows = Array.from(verseArea.querySelectorAll('.verse-row.selected'))
    .sort((a, b) => Number(a.dataset.vnum) - Number(b.dataset.vnum));
  verseArea.querySelectorAll('.verse-row').forEach(row => {
    const selected = row.classList.contains('selected');
    row.setAttribute('aria-pressed', String(selected));
    row.setAttribute('aria-label', `${selected ? 'Deselect' : 'Select'} ${activeBook?.name || 'verse'} ${activeChapter || ''}:${row.dataset.vnum}`);
  });
  selectedRows.forEach((row, idx) => {
    const prev = selectedRows[idx - 1];
    const next = selectedRows[idx + 1];
    const vnum = Number(row.dataset.vnum);
    const hasPrev = prev && Number(prev.dataset.vnum) === vnum - 1;
    const hasNext = next && Number(next.dataset.vnum) === vnum + 1;
    if (!hasPrev) row.classList.add('selected-start');
    if (hasPrev && hasNext) row.classList.add('selected-middle');
    if (!hasNext) row.classList.add('selected-end');
  });
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
    rowEl?.setAttribute('aria-pressed', 'true');
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
    rowEl?.setAttribute('aria-pressed', 'true');
    if (btn) {
      btn.textContent = '✓';
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', 'Deselect verse');
    }
  } else {
    selectedVerses.splice(idx, 1);
    rowEl?.classList.remove('selected');
    rowEl?.setAttribute('aria-pressed', 'false');
    if (btn) {
      btn.textContent = '+';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Select verse');
    }
  }
  syncBibleActionRows();
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
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Selected verse actions');
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
        <button class="sel-done-btn" type="button" title="Done">Done</button>
      </div>
      <div class="sel-actions${Voice.isSupported ? ' sel-actions-4' : ''}">
        <button class="sel-secondary-btn sel-greek-btn" type="button" ${hasGreek ? '' : 'disabled'}>Greek</button>
        <button class="sel-secondary-btn sel-compare-btn" type="button" ${activeVerse ? '' : 'disabled'}>Compare</button>
        ${Voice.isSupported ? '<button class="sel-secondary-btn sel-play-btn" type="button">Play</button>' : ''}
        <button class="sel-add-btn" type="button">Add to Stack</button>
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
    bar.querySelector('.sel-greek-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (!activeVerse || !hasGreek) return;
      showGreekPage(activeVerse.verse, activeVerse.text, greekByVerse[activeVerse.verse] ?? []);
    });
    bar.querySelector('.sel-compare-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (selectedVerses.length > 1) {
        openCompareSelectedVerses(selectedVerses);
        return;
      }
      if (!activeVerse) return;
      openCompare(`${activeVerse.book} ${activeVerse.chapter}:${activeVerse.verse}`, activeBook.id, activeVerse.chapter, activeVerse.verse);
    });
    bar.querySelector('.sel-play-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      const items = [...selectedVerses]
        .sort((a, b) => (a.chapter - b.chapter) || (a.verse - b.verse))
        .map(v => ({ ref: v.ref, text: v.text, vnum: (v.book === activeBook?.name && v.chapter === activeChapter) ? v.verse : undefined }));
      if (items.length) Voice.playScripture(items);
    });
    return;
  }

  bar.className = 'selection-bar open';
  bar.innerHTML = `
    <span class="sel-count">${selectedVerses.length} verse${selectedVerses.length !== 1 ? 's' : ''} selected</span>
    <button class="sel-add-btn" type="button">Add to Stack</button>
    <button class="sel-clear-btn" type="button" title="Clear selection" aria-label="Clear selection">×</button>
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
  document.querySelectorAll('.verse-row[aria-pressed="true"]').forEach(el => el.setAttribute('aria-pressed', 'false'));
  document.querySelectorAll('.verse-row.action-active').forEach(el => el.classList.remove('action-active'));
  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.textContent = '+';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Select verse');
  });
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
    passages: sorted.map(v => ({ ref: v.ref, text: v.text })),
    translation: sorted[0].translation || activeTranslation
  };
}

// ── Stack picker popup ────────────────────────────────
function openStackPicker() {
  closeStackPicker({ restoreFocus: false });
  const stacks = loadStacks();
  const versesToAdd = [...selectedVerses];
  const selectedCount = versesToAdd.length;

  const backdrop = document.createElement('div');
  backdrop.className = 'stack-add-backdrop';
  backdrop.dataset.role = 'stack-add';
  backdrop.setAttribute('aria-hidden', 'true');

  // The header and create action stay pinned while only the stack rows scroll.
  const body = stacks.length === 0
    ? `
      <div class="stack-picker-empty">
        <span class="stack-picker-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 4 4.5 8 12 12 19.5 8 12 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M4.5 12 12 16l7.5-4M4.5 16 12 20l7.5-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="stack-picker-empty-title">No stacks yet</span>
        <span class="stack-picker-empty-copy">Create one below to save this ${selectedCount === 1 ? 'verse' : 'selection'}.</span>
      </div>
    `
    : stacks.map(stack => {
        const passageCount = countStackPassages(stack);
        return `
          <button class="stack-picker-item stack-add-item" data-id="${escHtml(stack.id)}" type="button">
            <span class="stack-picker-item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 4.25 4.75 8 12 11.75 19.25 8 12 4.25Z" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/>
                <path d="M5.25 12 12 15.5l6.75-3.5M5.25 15.75 12 19.25l6.75-3.5" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="stack-picker-item-copy">
              <span class="stack-picker-item-title">${escHtml(stack.title)}</span>
              <span class="stack-picker-item-meta">${passageCount} saved passage${passageCount !== 1 ? 's' : ''}</span>
            </span>
            <span class="stack-picker-chevron" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none"><path d="m7.5 5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </button>
        `;
      }).join('');

  backdrop.innerHTML = `
    <section class="stack-picker stack-add-picker" role="dialog" aria-modal="true" aria-labelledby="stack-add-title" tabindex="-1">
      <div class="stack-picker-head">
        <div class="stack-picker-head-copy">
          <h2 class="stack-add-title" id="stack-add-title">Choose a stack</h2>
          <p class="stack-picker-subtitle">Save ${selectedCount} selected verse${selectedCount !== 1 ? 's' : ''}</p>
        </div>
        <button class="stack-picker-close" type="button" aria-label="Close stack picker">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="stack-picker-scroll">${body}</div>
      <div class="stack-picker-footer">
        <button class="stack-picker-new" type="button">
          <span class="stack-picker-new-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </span>
          <span class="stack-picker-new-copy">
            <span class="stack-picker-new-title">Create a new stack</span>
            <span class="stack-picker-new-meta">Start a fresh collection</span>
          </span>
        </button>
      </div>
    </section>
  `;

  backdrop.returnFocusElement = document.activeElement;
  document.body.appendChild(backdrop);
  activePicker = backdrop;

  // Prefer to clear the entire selection bar, including its nav offset. Keep a
  // usable minimum sheet area if the expanded voice player leaves little room.
  const selectionBar = document.getElementById('selection-bar');
  const selectionBarTop = selectionBar?.getBoundingClientRect().top ?? (window.innerHeight - 96);
  const preferredBottomGap = Math.max(16, window.innerHeight - selectionBarTop + 12);
  const maxUsableBottomGap = Math.max(16, window.innerHeight - 300);
  const bottomGap = Math.min(preferredBottomGap, maxUsableBottomGap);
  backdrop.style.setProperty('--stack-picker-bottom', `${bottomGap}px`);

  const picker = backdrop.querySelector('.stack-add-picker');
  picker.addEventListener('click', e => e.stopPropagation());
  backdrop.addEventListener('click', closeStackPicker);
  backdrop.querySelector('.stack-picker-close').addEventListener('click', e => {
    e.stopPropagation();
    closeStackPicker();
  });
  backdrop.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeStackPicker();
  });

  backdrop.querySelectorAll('.stack-add-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      addVerseToStack(item.dataset.id, buildCombinedVerseData(versesToAdd));
      closeStackPicker();
      clearSelection();
    });
  });

  backdrop.querySelector('.stack-picker-new').addEventListener('click', async e => {
    e.stopPropagation();
    closeStackPicker({ restoreFocus: false });
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

  requestAnimationFrame(() => {
    if (activePicker !== backdrop) return;
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    picker.focus({ preventScroll: true });
  });
}

function openStackSwitcher() {
  if (activePicker?.dataset.role === 'stack-switcher') {
    closeStackPicker();
    return;
  }

  closeStackPicker({ restoreFocus: false });
  const stacks = loadStacks();
  if (!stacks.length) return;
  const trigger = document.getElementById('stack-switcher-btn');

  const backdrop = document.createElement('div');
  backdrop.className = 'stack-switcher-backdrop';
  backdrop.dataset.role = 'stack-switcher';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.returnFocusElement = trigger;
  backdrop.innerHTML = `
    <section class="stack-picker stack-picker-list stack-switcher-picker" role="dialog" aria-modal="true" aria-labelledby="stack-switcher-title" tabindex="-1">
      <div class="stack-picker-head">
        <div class="stack-picker-head-copy">
          <h2 class="stack-add-title" id="stack-switcher-title">Your stacks</h2>
          <p class="stack-picker-subtitle">Switch collections or start a new one</p>
        </div>
        <button class="stack-picker-close" type="button" aria-label="Close stack switcher">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="stack-picker-scroll">
        ${stacks.map(stack => `
          <button class="stack-picker-item stack-picker-stack-item${stack.id === activeStackId ? ' active' : ''}" data-id="${escHtml(stack.id)}" type="button" aria-pressed="${stack.id === activeStackId}">
            <span class="stack-picker-stack-copy">
              <span class="stack-picker-stack-title">${escHtml(stack.title)}</span>
              <span class="stack-picker-stack-meta">${countStackPassages(stack)} saved passage${countStackPassages(stack) !== 1 ? 's' : ''}</span>
            </span>
            ${stack.id === activeStackId ? '<span class="stack-picker-check" aria-hidden="true">✓</span>' : ''}
          </button>
        `).join('')}
      </div>
      <div class="stack-picker-footer">
        <button class="stack-picker-new" type="button">
          <span class="stack-picker-new-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </span>
          <span class="stack-picker-new-copy">
            <span class="stack-picker-new-title">Create a new stack</span>
            <span class="stack-picker-new-meta">Start a fresh collection</span>
          </span>
        </button>
      </div>
    </section>
  `;

  document.body.appendChild(backdrop);
  activePicker = backdrop;
  trigger?.setAttribute('aria-expanded', 'true');

  const picker = backdrop.querySelector('.stack-picker-list');
  picker?.addEventListener('click', e => e.stopPropagation());
  backdrop.addEventListener('click', closeStackPicker);
  backdrop.querySelector('.stack-picker-close')?.addEventListener('click', e => {
    e.stopPropagation();
    closeStackPicker();
  });
  backdrop.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeStackPicker();
  });

  requestAnimationFrame(() => {
    if (activePicker !== backdrop) return;
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    picker.focus({ preventScroll: true });
  });

  backdrop.querySelectorAll('.stack-picker-stack-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      openStack(item.dataset.id);
      closeStackPicker();
    });
  });

  backdrop.querySelector('.stack-picker-new')?.addEventListener('click', async e => {
    e.stopPropagation();
    closeStackPicker({ restoreFocus: false });
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

function closeStackPicker({ restoreFocus = true } = {}) {
  if (!activePicker) return;
  const picker = activePicker;
  activePicker = null;

  if (picker.dataset.role === 'stack-switcher') {
    document.getElementById('stack-switcher-btn')?.setAttribute('aria-expanded', 'false');
    const returnFocusElement = picker.returnFocusElement;
    picker.classList.remove('open');
    picker.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      picker.remove();
      if (restoreFocus && returnFocusElement?.isConnected) {
        returnFocusElement.focus({ preventScroll: true });
      }
    }, prefersReducedMotion() ? 0 : 220);
    return;
  }

  if (picker.dataset.role === 'stack-add') {
    const returnFocusElement = picker.returnFocusElement;
    picker.classList.remove('open');
    picker.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      picker.remove();
      if (restoreFocus && returnFocusElement?.isConnected) {
        returnFocusElement.focus({ preventScroll: true });
      }
    }, prefersReducedMotion() ? 0 : 220);
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
  settingsBtn.setAttribute('aria-expanded', 'false');
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sp-font-item' + (f.name === currentFont ? ' active' : '');
    button.style.fontFamily = f.stack;
    button.setAttribute('aria-pressed', String(f.name === currentFont));
    button.innerHTML = `<span>${escHtml(f.name)}</span><span class="sp-check" aria-hidden="true">✓</span>`;
    button.addEventListener('click', () => {
      const s = loadSettings();
      s.font = f.name;
      saveSettings(s);
      applySettings(s);
      syncPanelUI(s);
      setFontListOpen(false);
    });
    spFontList.appendChild(button);
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
    settingsBtn.setAttribute('aria-expanded', 'true');
    openSheet(settingsSheetBackdrop);
    setTimeout(() => settingsPanel.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 60);
  }
});

function syncPanelUI(s) {
  const settings = getEffectiveSettings(s);
  document.querySelectorAll('.sp-theme-btn').forEach(btn => {
    const active = btn.dataset.theme === settings.theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.sp-spacing-btn').forEach(btn => {
    const active = btn.dataset.spacing === settings.spacing;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  spFontCurrent.textContent = settings.font;
  spSizeDownBtn.disabled = getReaderSizeValue(settings) <= READER_SIZE_MIN + 0.001;
  spSizeUpBtn.disabled = getReaderSizeValue(settings) >= READER_SIZE_MAX - 0.001;
  spFontList.querySelectorAll('.sp-font-item').forEach(item => {
    const active = item.firstElementChild?.textContent === settings.font;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
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
