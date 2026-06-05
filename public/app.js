'use strict';

// ── Constants ─────────────────────────────────────────────────
const MIN_DAYS     = 1;
const MAX_DAYS     = 7;
const HISTORY_KEY  = 'mealplanner_history';
const MAX_HISTORY  = 10;

// ── State ─────────────────────────────────────────────────────
let currentDays      = 7;
let currentPlanData  = null;   // last generated plan (for AnyList / copy)
let anylistConfigured = false;
let anylistListName   = 'Groceries';

// ── DOM refs ──────────────────────────────────────────────────
const daysDisplay       = document.getElementById('days-display');
const daysInput         = document.getElementById('days-input');
const daysMinus         = document.getElementById('days-minus');
const daysPlus          = document.getElementById('days-plus');
const generateBtn       = document.getElementById('generate-btn');
const notesInput        = document.getElementById('notes-input');
const configSection     = document.getElementById('config-section');
const loadingSection    = document.getElementById('loading-section');
const loadingText       = document.getElementById('loading-text');
const errorSection      = document.getElementById('error-section');
const errorMessage      = document.getElementById('error-message');
const errorRetryBtn     = document.getElementById('error-retry-btn');
const resultsSection    = document.getElementById('results-section');
const mealPlanContainer = document.getElementById('meal-plan-container');
const summaryBar        = document.getElementById('summary-bar');
const shoppingGrid      = document.getElementById('shopping-grid');
const printBtn          = document.getElementById('print-btn');
const regenerateBtn     = document.getElementById('regenerate-btn');
const anylistBtn        = document.getElementById('anylist-btn');
const anylistListNameEl = document.getElementById('anylist-list-name');
const anylistNotConfigEl= document.getElementById('anylist-not-configured');
const copyListBtn       = document.getElementById('copy-list-btn');
const historyToggleBtn  = document.getElementById('history-toggle-btn');
const historyDrawer     = document.getElementById('history-drawer');
const historyList       = document.getElementById('history-list');
const historyCountLabel = document.getElementById('history-count-label');
const clearHistoryBtn   = document.getElementById('clear-history-btn');

// ── Days stepper ──────────────────────────────────────────────
function updateDays(delta) {
  currentDays = Math.min(MAX_DAYS, Math.max(MIN_DAYS, currentDays + delta));
  daysDisplay.textContent = currentDays;
  daysInput.value = currentDays;
  daysMinus.disabled = currentDays === MIN_DAYS;
  daysPlus.disabled  = currentDays === MAX_DAYS;
}
daysMinus.addEventListener('click', () => updateDays(-1));
daysPlus.addEventListener('click',  () => updateDays(+1));

// ── Batch sync ────────────────────────────────────────────────
document.querySelectorAll('input[name="meals"]').forEach(mealCb => {
  const batchRow   = document.getElementById(`batch-row-${mealCb.value}`);
  const batchInput = batchRow?.querySelector('input[name="batch"]');
  function syncBatch() {
    if (!batchRow || !batchInput) return;
    if (mealCb.checked) {
      batchRow.classList.remove('batch-toggle--disabled');
      batchInput.disabled = false;
    } else {
      batchRow.classList.add('batch-toggle--disabled');
      batchInput.disabled = true;
      batchInput.checked  = false;
    }
  }
  mealCb.addEventListener('change', syncBatch);
  syncBatch();
});

// ── Helpers ───────────────────────────────────────────────────
const show = el => { el.hidden = false; };
const hide = el => { el.hidden = true; };
const getSelectedMeals      = () => [...document.querySelectorAll('input[name="meals"]:checked')].map(e => e.value);
const getSelectedBatchMeals = () => [...document.querySelectorAll('input[name="batch"]:checked')].map(e => e.value);

const MEAL_ICONS       = { breakfast: '🍳', lunch: '🥙', dinner: '🍽️', snacks: '🍎' };
const CATEGORY_ICONS   = { produce: '🥦', proteins: '🥩', grains_and_legumes: '🌾', pantry_and_spices: '🫙', frozen: '❄️', other: '🛍️' };
const CATEGORY_LABELS  = { produce: 'Produce', proteins: 'Proteins', grains_and_legumes: 'Grains & Legumes', pantry_and_spices: 'Pantry & Spices', frozen: 'Frozen', other: 'Other' };
const MEAL_ORDER       = ['breakfast', 'lunch', 'dinner', 'snacks'];

const LOADING_MSGS = [
  'Crafting your personalized meal plan…',
  'Calculating macros and nutrients…',
  'Writing out full recipes…',
  'Scaling batch cook servings…',
  'Verifying kosher and dairy-free compliance…',
  'Building your shopping list…',
  'Almost ready — polishing the details…',
];

function cycleLoadingMessages() {
  let i = 0;
  return setInterval(() => { loadingText.textContent = LOADING_MSGS[++i % LOADING_MSGS.length]; }, 2800);
}

// ── Toast notifications ───────────────────────────────────────
const toastContainer = document.getElementById('toast-container');
function showToast(msg, type = 'success', duration = 3000) {
  const icons = { success: '✓', error: '⚠️', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-msg">${escHtml(msg)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration + 400);
}

// ── AnyList status ────────────────────────────────────────────
async function checkAnyListStatus() {
  try {
    const res  = await fetch('/api/anylist-status');
    const json = await res.json();
    anylistConfigured = json.configured;
    anylistListName   = json.listName || 'Groceries';
  } catch { anylistConfigured = false; }
}

function updateAnyListUI() {
  if (anylistConfigured) {
    show(anylistBtn);
    hide(anylistNotConfigEl);
    anylistListNameEl.textContent = anylistListName;
  } else {
    hide(anylistBtn);
    show(anylistNotConfigEl);
  }
}

anylistBtn.addEventListener('click', async () => {
  if (!currentPlanData?.shopping_list) return;
  anylistBtn.disabled = true;
  anylistBtn.querySelector('span:nth-child(2)').textContent = 'Sending…';
  try {
    const res  = await fetch('/api/send-to-anylist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shoppingList: currentPlanData.shopping_list }),
    });
    const json = await res.json();
    if (json.success) {
      showToast(`✓ ${json.count} items added to "${json.listName}"!`, 'success');
    } else {
      showToast(json.error || 'Failed to send to AnyList.', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Network error.', 'error');
  } finally {
    anylistBtn.disabled = false;
    anylistBtn.querySelector('span:nth-child(2)').textContent = 'Send to AnyList';
  }
});

// ── Copy list ─────────────────────────────────────────────────
copyListBtn.addEventListener('click', () => {
  if (!currentPlanData?.shopping_list) return;
  const text = formatShoppingListAsText(currentPlanData.shopping_list);
  navigator.clipboard.writeText(text).then(() => {
    showToast('Shopping list copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Could not copy — try selecting and copying manually.', 'error');
  });
});

function formatShoppingListAsText(list) {
  const lines = ['🛒 Shopping List\n'];
  for (const [key, items] of Object.entries(list)) {
    if (!items?.length) continue;
    const label = CATEGORY_LABELS[key] || key.replace(/_/g, ' ');
    lines.push(`\n== ${label.toUpperCase()} ==`);
    items.forEach(i => lines.push(`- ${i}`));
  }
  return lines.join('\n');
}

// ── History management ────────────────────────────────────────
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveToHistory(data, config) {
  const history = getHistory();
  const entry = {
    id:      `plan_${Date.now()}`,
    savedAt: Date.now(),
    config,
    summary: data.plan_summary || {},
    data,
  };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistoryPanel();
}

function deleteFromHistory(id) {
  const updated = getHistory().filter(e => e.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  renderHistoryPanel();
}

function renderHistoryPanel() {
  const history = getHistory();

  if (!history.length) {
    hide(historyToggleBtn);
    hide(historyDrawer);
    return;
  }

  show(historyToggleBtn);
  historyCountLabel.textContent = `Saved Plans (${history.length})`;

  historyList.innerHTML = history.map(entry => {
    const d        = new Date(entry.savedAt);
    const dateStr  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const cfg      = entry.config || {};
    const meals    = (cfg.meals || []).map(capitalize).join(', ');
    const batch    = (cfg.batch || []).length ? ` · Batch: ${cfg.batch.map(capitalize).join(', ')}` : '';
    const days     = cfg.days || '?';
    const cal      = entry.summary?.avg_daily_calories;
    const prot     = entry.summary?.avg_daily_protein;
    const statsStr = [cal ? `${cal} kcal` : null, prot ? `${prot}g protein` : null].filter(Boolean).join(' · ');

    return `<div class="history-item">
      <div class="history-meta">
        <div class="history-date">${escHtml(dateStr)}</div>
        <div class="history-desc">${days}-Day Plan · ${escHtml(meals)}${escHtml(batch)}</div>
        ${statsStr ? `<div class="history-stats">Avg: ${escHtml(statsStr)}/day</div>` : ''}
      </div>
      <div class="history-actions">
        <button class="btn-load-plan"  data-id="${escHtml(entry.id)}">Load</button>
        <button class="btn-delete-plan" data-id="${escHtml(entry.id)}">✕</button>
      </div>
    </div>`;
  }).join('');

  // Delegate events
  historyList.querySelectorAll('.btn-load-plan').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = getHistory().find(e => e.id === btn.dataset.id);
      if (!entry) return;
      loadPlanFromHistory(entry);
    });
  });
  historyList.querySelectorAll('.btn-delete-plan').forEach(btn => {
    btn.addEventListener('click', () => deleteFromHistory(btn.dataset.id));
  });
}

function loadPlanFromHistory(entry) {
  // Restore config controls
  const cfg = entry.config || {};
  if (cfg.days) { currentDays = cfg.days; updateDays(0); }

  document.querySelectorAll('input[name="meals"]').forEach(cb => {
    cb.checked = (cfg.meals || []).includes(cb.value);
    cb.dispatchEvent(new Event('change'));
  });
  document.querySelectorAll('input[name="batch"]').forEach(cb => {
    cb.checked = (cfg.batch || []).includes(cb.value);
  });
  if (cfg.notes !== undefined) notesInput.value = cfg.notes;

  // Render the saved plan
  currentPlanData = entry.data;
  renderResults(entry.data);
  hide(errorSection);
  show(resultsSection);
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast('Plan loaded from history.', 'info');
}

// History toggle
historyToggleBtn.addEventListener('click', () => {
  const isOpen = !historyDrawer.hidden;
  historyDrawer.hidden = isOpen;
  historyToggleBtn.classList.toggle('active', !isOpen);
});

clearHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear all saved plans?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistoryPanel();
});

// ── Rendering ─────────────────────────────────────────────────
function renderMacroPills(macros) {
  if (!macros) return '';
  return `<div class="macro-pills">
    ${macros.calories != null ? `<span class="macro-pill cal">${macros.calories} kcal</span>` : ''}
    ${macros.protein  != null ? `<span class="macro-pill pro">${macros.protein}g protein</span>` : ''}
    ${macros.carbs    != null ? `<span class="macro-pill carbs">${macros.carbs}g carbs</span>` : ''}
    ${macros.fat      != null ? `<span class="macro-pill fat">${macros.fat}g fat</span>` : ''}
  </div>`;
}

function renderRecipe(meal) {
  const ingredients  = meal.ingredients  || [];
  const instructions = meal.instructions || [];
  const batchInfo    = meal.batch_info;
  if (!ingredients.length && !instructions.length && !batchInfo) return '';

  const ingHtml = ingredients.length ? `<div>
    <div class="recipe-section-title">Ingredients</div>
    <ul class="ingredients-list">${ingredients.map(i => `<li>${escHtml(String(i))}</li>`).join('')}</ul>
  </div>` : '';

  const instHtml = instructions.length ? `<div>
    <div class="recipe-section-title">Instructions</div>
    <ol class="instructions-list">${instructions.map(s => `<li>${escHtml(String(s))}</li>`).join('')}</ol>
  </div>` : '';

  const batchHtml = batchInfo ? `<div class="batch-info-box">
    <div class="batch-badge">↻ Batch Cook</div>
    ${batchInfo.servings ? `<strong>Makes ${batchInfo.servings} servings</strong><br>` : ''}
    ${batchInfo.storage  ? `🧊 ${escHtml(batchInfo.storage)}<br>` : ''}
    ${batchInfo.reheat   ? `🔥 ${escHtml(batchInfo.reheat)}` : ''}
  </div>` : '';

  return `<details class="recipe-details">
    <summary>View Recipe</summary>
    <div class="recipe-body">${ingHtml}${instHtml}${batchHtml}</div>
  </details>`;
}

function renderMealCard(type, meal) {
  if (!meal) return '';
  return `<div class="meal-card">
    <span class="meal-type-badge ${type}">${MEAL_ICONS[type] || ''} ${capitalize(type)}</span>
    <div class="meal-name">${escHtml(meal.name || '')}</div>
    <div class="meal-desc">${escHtml(meal.description || '')}</div>
    ${renderMacroPills(meal.macros)}
    ${renderRecipe(meal)}
  </div>`;
}

function renderDay(dayObj) {
  const totals   = dayObj.daily_totals || {};
  const totalStr = [
    totals.calories != null ? `<strong>${totals.calories}</strong> kcal` : '',
    totals.protein  != null ? `<strong>${totals.protein}g</strong> protein` : '',
    totals.carbs    != null ? `<strong>${totals.carbs}g</strong> carbs` : '',
    totals.fat      != null ? `<strong>${totals.fat}g</strong> fat` : '',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');

  const meals    = dayObj.meals || {};
  const mealCards = MEAL_ORDER.filter(k => meals[k]).map(k => renderMealCard(k, meals[k])).join('');

  return `<div class="day-section">
    <div class="day-header">
      <span class="day-label">${escHtml(dayObj.label || `Day ${dayObj.day}`)}</span>
      ${totalStr ? `<span class="day-totals">${totalStr}</span>` : ''}
    </div>
    <div class="meals-grid">${mealCards || '<div class="meal-card"><em>No meals</em></div>'}</div>
  </div>`;
}

function renderSummaryBar(summary) {
  if (!summary) { summaryBar.innerHTML = ''; return; }
  summaryBar.innerHTML = `
    <div class="summary-stat">
      <div class="stat-value">${summary.avg_daily_calories ?? '—'}</div>
      <div class="stat-label">Avg daily kcal</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${summary.avg_daily_protein ?? '—'}g</div>
      <div class="stat-label">Avg daily protein</div>
    </div>
    ${summary.highlights ? `<div class="summary-highlight">${escHtml(summary.highlights)}</div>` : ''}`;
}

function renderShoppingList(list) {
  shoppingGrid.innerHTML = '';
  if (!list || typeof list !== 'object') return;
  const ORDER = ['produce', 'proteins', 'grains_and_legumes', 'pantry_and_spices', 'frozen', 'other'];
  const keys  = [...new Set([...ORDER, ...Object.keys(list)])].filter(k => list[k]?.length);
  if (!keys.length) { shoppingGrid.innerHTML = '<p style="color:var(--text-muted)">No shopping list generated.</p>'; return; }
  keys.forEach(key => {
    const items = list[key];
    if (!items?.length) return;
    const div = document.createElement('div');
    div.className = 'shopping-category';
    div.innerHTML = `<div class="category-title">${CATEGORY_ICONS[key] || '📦'} ${CATEGORY_LABELS[key] || capitalize(key.replace(/_/g, ' '))}</div>
      <ul>${items.map(i => `<li>${escHtml(String(i))}</li>`).join('')}</ul>`;
    shoppingGrid.appendChild(div);
  });
}

function renderResults(data) {
  const plan = data.meal_plan || [];
  mealPlanContainer.innerHTML = plan.map(renderDay).join('');
  renderSummaryBar(data.plan_summary);
  renderShoppingList(data.shopping_list);

  const meals = getSelectedMeals();
  const batch = getSelectedBatchMeals();
  let title = `${plan.length}-Day Plan · ${meals.map(capitalize).join(', ')}`;
  if (batch.length) title += ` (Batch: ${batch.map(capitalize).join(', ')})`;
  document.getElementById('results-title').textContent = title;

  updateAnyListUI();
}

// ── Generate ──────────────────────────────────────────────────
async function generate() {
  const meals      = getSelectedMeals();
  const batchMeals = getSelectedBatchMeals();
  if (!meals.length) { alert('Please select at least one meal type.'); return; }

  hide(errorSection);
  hide(resultsSection);
  show(loadingSection);
  generateBtn.disabled    = true;
  loadingText.textContent = LOADING_MSGS[0];
  const msgTimer = cycleLoadingMessages();

  try {
    const res  = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: currentDays, meals, notes: notesInput.value, batchMeals }),
    });
    const json = await res.json();
    clearInterval(msgTimer);
    if (!json.success) throw new Error(json.error || 'Unknown error');

    currentPlanData = json.data;

    // Auto-save to history
    saveToHistory(json.data, { days: currentDays, meals, batch: batchMeals, notes: notesInput.value });

    renderResults(json.data);
    hide(loadingSection);
    show(resultsSection);
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    clearInterval(msgTimer);
    hide(loadingSection);
    errorMessage.textContent = err.message || 'Something went wrong. Please try again.';
    show(errorSection);
  } finally {
    generateBtn.disabled = false;
  }
}

// ── Event listeners ───────────────────────────────────────────
generateBtn.addEventListener('click', generate);
errorRetryBtn.addEventListener('click', () => { hide(errorSection); generate(); });
regenerateBtn.addEventListener('click', () => {
  hide(resultsSection);
  hide(errorSection);
  configSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
printBtn.addEventListener('click', () => window.print());

// ── Utilities ─────────────────────────────────────────────────
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────
updateDays(0);
checkAnyListStatus().then(updateAnyListUI);
renderHistoryPanel();
