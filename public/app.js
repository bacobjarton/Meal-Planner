'use strict';

// ── Constants ─────────────────────────────────────────────────
const MIN_DAYS    = 1;
const MAX_DAYS    = 7;
const HISTORY_KEY = 'mealplanner_history';
const RECIPES_KEY = 'mealplanner_recipes';
const MAX_HISTORY = 10;

// ── State ─────────────────────────────────────────────────────
let currentDays       = 7;
let currentPlanData   = null;
let anylistConfigured = false;
let anylistListName   = 'Groceries';

// Temp map populated each render so star handlers can access meal data
const mealDataMap = new Map();

// ── DOM refs ──────────────────────────────────────────────────
const daysDisplay          = document.getElementById('days-display');
const daysInput            = document.getElementById('days-input');
const daysMinus            = document.getElementById('days-minus');
const daysPlus             = document.getElementById('days-plus');
const generateBtn          = document.getElementById('generate-btn');
const notesInput           = document.getElementById('notes-input');
const loadingSection       = document.getElementById('loading-section');
const loadingText          = document.getElementById('loading-text');
const errorSection         = document.getElementById('error-section');
const errorMessage         = document.getElementById('error-message');
const errorRetryBtn        = document.getElementById('error-retry-btn');
const resultsSection       = document.getElementById('results-section');
const planEmptyState       = document.getElementById('plan-empty-state');
const mealPlanContainer    = document.getElementById('meal-plan-container');
const summaryBar           = document.getElementById('summary-bar');
const shoppingGrid         = document.getElementById('shopping-grid');
const printBtn             = document.getElementById('print-btn');
const regenerateBtn        = document.getElementById('regenerate-btn');
const anylistBtn           = document.getElementById('anylist-btn');
const anylistListNameEl    = document.getElementById('anylist-list-name');
const anylistNotConfigEl   = document.getElementById('anylist-not-configured');
const copyListBtn          = document.getElementById('copy-list-btn');
// Recipe Book
const recipesList          = document.getElementById('recipes-list');
const recipesEmptyState    = document.getElementById('recipes-empty-state');
const recipesNavBadge      = document.getElementById('recipes-nav-badge');
const anylistAllRecipesBtn = document.getElementById('anylist-all-recipes-btn');
const clearRecipesBtn      = document.getElementById('clear-recipes-btn');
// History
const historyList          = document.getElementById('history-list');
const historyEmptyState    = document.getElementById('history-empty-state');
const historyNavBadge      = document.getElementById('history-nav-badge');
const clearHistoryBtn      = document.getElementById('clear-history-btn');
// Nav
const planNavBadge         = document.getElementById('plan-nav-badge');
const goPlannerBtn         = document.getElementById('go-planner-btn');

// ── Page Navigation ───────────────────────────────────────────
const PAGES = ['planner', 'plan', 'recipes', 'history'];

function showPage(name) {
  PAGES.forEach(p => {
    document.getElementById(`page-${p}`).hidden = (p !== name);
    document.getElementById(`nav-${p}`).classList.toggle('active', p === name);
  });
  window.scrollTo(0, 0);
}

document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

goPlannerBtn.addEventListener('click', () => showPage('planner'));

// ── Days stepper ──────────────────────────────────────────────
function updateDays(delta) {
  currentDays = Math.min(MAX_DAYS, Math.max(MIN_DAYS, currentDays + delta));
  daysDisplay.textContent = currentDays;
  daysInput.value         = currentDays;
  daysMinus.disabled      = currentDays === MIN_DAYS;
  daysPlus.disabled       = currentDays === MAX_DAYS;
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

// ── Utilities ─────────────────────────────────────────────────
const show = el => { el.hidden = false; };
const hide = el => { el.hidden = true; };
const getSelectedMeals      = () => [...document.querySelectorAll('input[name="meals"]:checked')].map(e => e.value);
const getSelectedBatchMeals = () => [...document.querySelectorAll('input[name="batch"]:checked')].map(e => e.value);
const capitalize  = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const escHtml     = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const recipeId    = (type, name) => `${type}_${(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;

const MEAL_ICONS      = { breakfast:'🍳', lunch:'🥙', dinner:'🍽️', snacks:'🍎' };
const CATEGORY_ICONS  = { produce:'🥦', proteins:'🥩', grains_and_legumes:'🌾', pantry_and_spices:'🫙', frozen:'❄️', other:'🛍️' };
const CATEGORY_LABELS = { produce:'Produce', proteins:'Proteins', grains_and_legumes:'Grains & Legumes', pantry_and_spices:'Pantry & Spices', frozen:'Frozen', other:'Other' };
const MEAL_ORDER      = ['breakfast', 'lunch', 'dinner', 'snacks'];
const LOADING_MSGS    = [
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

// ── Toast ─────────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');
function showToast(msg, type = 'success', duration = 3000) {
  const icons = { success:'✓', error:'⚠️', info:'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-msg">${escHtml(msg)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration + 400);
}

// ── AnyList ───────────────────────────────────────────────────
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
    show(anylistBtn); hide(anylistNotConfigEl);
    anylistListNameEl.textContent = anylistListName;
  } else {
    hide(anylistBtn); show(anylistNotConfigEl);
  }
}

// Send a flat array of ingredient strings to AnyList
async function sendIngredientsToAnyList(ingredients) {
  if (!anylistConfigured || !ingredients?.length) return false;
  try {
    const res  = await fetch('/api/send-to-anylist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shoppingList: { ingredients } }),
    });
    const json = await res.json();
    if (json.success) {
      showToast(`✓ ${json.count} ingredients added to "${json.listName}"!`, 'success');
      return true;
    } else {
      showToast(json.error || 'Failed to send to AnyList.', 'error');
      return false;
    }
  } catch (err) {
    showToast(err.message || 'Network error.', 'error');
    return false;
  }
}

// Send plan shopping list
anylistBtn.addEventListener('click', async () => {
  if (!currentPlanData?.shopping_list) return;
  anylistBtn.disabled = true;
  anylistBtn.querySelector('span:nth-child(2)').textContent = 'Sending…';
  try {
    const res  = await fetch('/api/send-to-anylist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shoppingList: currentPlanData.shopping_list }),
    });
    const json = await res.json();
    json.success
      ? showToast(`✓ ${json.count} items added to "${json.listName}"!`, 'success')
      : showToast(json.error || 'Failed to send to AnyList.', 'error');
  } catch (err) {
    showToast(err.message || 'Network error.', 'error');
  } finally {
    anylistBtn.disabled = false;
    anylistBtn.querySelector('span:nth-child(2)').textContent = 'Send to AnyList';
  }
});

// Send ALL saved recipe ingredients combined
anylistAllRecipesBtn.addEventListener('click', async () => {
  const saved = getSavedRecipes();
  const allIngredients = saved.flatMap(r => r.ingredients || []);
  if (!allIngredients.length) { showToast('No ingredients found in saved recipes.', 'info'); return; }
  anylistAllRecipesBtn.disabled = true;
  anylistAllRecipesBtn.querySelector('span:last-child').textContent = 'Sending…';
  await sendIngredientsToAnyList(allIngredients);
  anylistAllRecipesBtn.disabled = false;
  anylistAllRecipesBtn.querySelector('span:last-child').textContent = 'Send All to AnyList';
});

copyListBtn.addEventListener('click', () => {
  if (!currentPlanData?.shopping_list) return;
  const text = formatShoppingListAsText(currentPlanData.shopping_list);
  navigator.clipboard.writeText(text)
    .then(() => showToast('Shopping list copied to clipboard!', 'success'))
    .catch(() => showToast('Could not copy — try selecting manually.', 'error'));
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

// ── Recipe Book ───────────────────────────────────────────────
function getSavedRecipes() {
  try { return JSON.parse(localStorage.getItem(RECIPES_KEY)) || []; }
  catch { return []; }
}
function isRecipeSaved(id) { return getSavedRecipes().some(r => r.id === id); }

function saveRecipe(id, type, meal) {
  const saved = getSavedRecipes().filter(r => r.id !== id);
  saved.unshift({ id, savedAt: Date.now(), type, ...meal });
  localStorage.setItem(RECIPES_KEY, JSON.stringify(saved));
  renderRecipeBook();
}

function removeRecipe(id) {
  const saved = getSavedRecipes().filter(r => r.id !== id);
  localStorage.setItem(RECIPES_KEY, JSON.stringify(saved));
  renderRecipeBook();
  // Update any visible star buttons in the meal plan
  document.querySelectorAll(`[data-recipe-id="${CSS.escape(id)}"].btn-star`).forEach(btn => {
    btn.textContent = '☆';
    btn.classList.remove('starred');
    btn.title = 'Save to Recipe Book';
  });
}

function renderRecipeBook() {
  const saved = getSavedRecipes();

  // Nav badge
  if (saved.length > 0) {
    show(recipesNavBadge);
    recipesNavBadge.textContent = saved.length;
  } else {
    hide(recipesNavBadge);
  }

  // "Send All" button — only when AnyList is configured and there are recipes
  if (anylistConfigured && saved.length > 0) show(anylistAllRecipesBtn);
  else hide(anylistAllRecipesBtn);

  if (!saved.length) {
    show(recipesEmptyState);
    recipesList.innerHTML = '';
    return;
  }
  hide(recipesEmptyState);

  recipesList.innerHTML = saved.map(r => {
    const id     = escHtml(r.id);
    const type   = r.type || 'breakfast';
    const macros = r.macros || {};
    const macroPills = [
      macros.calories != null ? `<span class="macro-pill cal">${macros.calories} kcal</span>`   : '',
      macros.protein  != null ? `<span class="macro-pill pro">${macros.protein}g protein</span>` : '',
      macros.carbs    != null ? `<span class="macro-pill carbs">${macros.carbs}g carbs</span>`   : '',
      macros.fat      != null ? `<span class="macro-pill fat">${macros.fat}g fat</span>`         : '',
    ].filter(Boolean).join('');

    const anylistBtnHtml = anylistConfigured && (r.ingredients?.length > 0)
      ? `<button class="btn-anylist-recipe" data-recipe-id="${id}" title="Send ingredients to AnyList">📱</button>`
      : '';

    return `<div class="recipe-book-item">
      <div class="recipe-book-top">
        <div class="recipe-book-info">
          <span class="meal-type-badge ${type}">${MEAL_ICONS[type]||''} ${capitalize(type)}</span>
          <div class="recipe-book-name">${escHtml(r.name||'')}</div>
          ${macroPills ? `<div class="macro-pills" style="margin-top:6px">${macroPills}</div>` : ''}
        </div>
        <div class="recipe-book-actions">
          ${anylistBtnHtml}
          <button class="btn-print-recipe" data-recipe-id="${id}" title="Print recipe">🖨</button>
          <button class="btn-remove-recipe" data-recipe-id="${id}" title="Remove">✕</button>
        </div>
      </div>
      ${renderRecipeDetails(r)}
    </div>`;
  }).join('');

  // Attach event handlers
  recipesList.querySelectorAll('.btn-print-recipe').forEach(btn =>
    btn.addEventListener('click', () => printSingleRecipe(btn.dataset.recipeId))
  );
  recipesList.querySelectorAll('.btn-remove-recipe').forEach(btn =>
    btn.addEventListener('click', () => removeRecipe(btn.dataset.recipeId))
  );
  recipesList.querySelectorAll('.btn-anylist-recipe').forEach(btn => {
    btn.addEventListener('click', async () => {
      const recipe = getSavedRecipes().find(r => r.id === btn.dataset.recipeId);
      if (!recipe?.ingredients?.length) { showToast('No ingredients saved for this recipe.', 'info'); return; }
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '⏳';
      await sendIngredientsToAnyList(recipe.ingredients);
      btn.disabled = false;
      btn.textContent = orig;
    });
  });
}

clearRecipesBtn.addEventListener('click', () => {
  if (!confirm('Clear all saved recipes?')) return;
  localStorage.removeItem(RECIPES_KEY);
  renderRecipeBook();
});

function printSingleRecipe(id) {
  const recipe = getSavedRecipes().find(r => r.id === id);
  if (!recipe) return;
  const win = window.open('', '_blank', 'width=680,height=900');
  if (!win) { showToast('Pop-up blocked — allow pop-ups to print.', 'error'); return; }
  win.document.write(buildRecipePrintHTML(recipe));
  win.document.close();
  win.addEventListener('load', () => win.print());
}

function buildRecipePrintHTML(r) {
  const cap = capitalize, esc = escHtml, type = r.type || 'meal', macros = r.macros || {};
  const ingHtml  = (r.ingredients ||[]).map(i => `<li>${esc(i)}</li>`).join('');
  const instHtml = (r.instructions||[]).map(s => `<li>${esc(s)}</li>`).join('');
  const batchHtml = r.batch_info ? `
    <h3>Batch Cooking</h3>
    <p>${r.batch_info.servings ? `Makes <strong>${r.batch_info.servings} servings</strong>. ` : ''}
    ${esc(r.batch_info.storage||'')} ${esc(r.batch_info.reheat||'')}</p>` : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${esc(r.name||'Recipe')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 36px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
    header { border-bottom: 2px solid #2D6A4F; padding-bottom: 14px; margin-bottom: 20px; }
    .tag { display: inline-block; background: #D8F3DC; color: #1F5C3E; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; padding: 3px 9px; border-radius: 50px; margin-bottom: 8px; }
    h1 { font-size: 1.5rem; color: #1F5C3E; margin-bottom: 4px; }
    .meta { font-size: .82rem; color: #666; }
    .macros { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0; }
    .macro { background: #f3f3f3; border: 1px solid #ddd; padding: 4px 11px; border-radius: 50px; font-size: .78rem; font-weight: 600; }
    h3 { font-weight: 700; color: #2D6A4F; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: .4px; font-size: .8rem; }
    ul, ol { padding-left: 20px; }
    li { margin-bottom: 5px; font-size: .9rem; }
    .batch-box { background: #CCFBF1; border: 1px solid #99f6e4; border-radius: 8px; padding: 12px 14px; margin-top: 18px; font-size: .85rem; }
    .batch-box h3 { margin-top: 0; color: #0F766E; }
    footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #eee; font-size: .72rem; color: #999; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <header>
    <div class="tag">${esc(cap(type))}</div>
    <h1>${esc(r.name||'')}</h1>
    <p class="meta">High-Protein · Dairy-Free · Kosher</p>
  </header>
  <div class="macros">
    ${macros.calories != null ? `<span class="macro">${macros.calories} kcal</span>` : ''}
    ${macros.protein  != null ? `<span class="macro">${macros.protein}g protein</span>` : ''}
    ${macros.carbs    != null ? `<span class="macro">${macros.carbs}g carbs</span>` : ''}
    ${macros.fat      != null ? `<span class="macro">${macros.fat}g fat</span>` : ''}
  </div>
  ${ingHtml  ? `<h3>Ingredients</h3><ul>${ingHtml}</ul>`   : ''}
  ${instHtml ? `<h3>Instructions</h3><ol>${instHtml}</ol>` : ''}
  ${r.batch_info ? `<div class="batch-box">${batchHtml}</div>` : ''}
  <footer>Generated by AI Meal Planner · Verify nutritional info with a registered dietitian</footer>
</body>
</html>`;
}

// ── History ───────────────────────────────────────────────────
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveToHistory(data, config) {
  const history = getHistory();
  const entry = { id:`plan_${Date.now()}`, savedAt:Date.now(), config, summary:data.plan_summary||{}, data };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistoryPanel();
}

function deleteFromHistory(id) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(getHistory().filter(e => e.id !== id)));
  renderHistoryPanel();
}

function renderHistoryPanel() {
  const history = getHistory();

  // Nav badge
  if (history.length > 0) {
    show(historyNavBadge);
    historyNavBadge.textContent = history.length;
  } else {
    hide(historyNavBadge);
  }

  if (!history.length) {
    show(historyEmptyState);
    historyList.innerHTML = '';
    return;
  }
  hide(historyEmptyState);

  historyList.innerHTML = history.map(entry => {
    const d       = new Date(entry.savedAt);
    const dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const cfg     = entry.config || {};
    const meals   = (cfg.meals||[]).map(capitalize).join(', ');
    const batch   = (cfg.batch||[]).length ? ` · Batch: ${(cfg.batch||[]).map(capitalize).join(', ')}` : '';
    const cal     = entry.summary?.avg_daily_calories;
    const prot    = entry.summary?.avg_daily_protein;
    const statsStr= [cal ? `${cal} kcal` : null, prot ? `${prot}g protein` : null].filter(Boolean).join(' · ');
    return `<div class="history-item">
      <div class="history-meta">
        <div class="history-date">${escHtml(dateStr)}</div>
        <div class="history-desc">${cfg.days||'?'}-Day · ${escHtml(meals)}${escHtml(batch)}</div>
        ${statsStr ? `<div class="history-stats">Avg: ${escHtml(statsStr)}/day</div>` : ''}
      </div>
      <div class="history-actions">
        <button class="btn-load-plan"   data-id="${escHtml(entry.id)}">Load</button>
        <button class="btn-delete-plan" data-id="${escHtml(entry.id)}">✕</button>
      </div>
    </div>`;
  }).join('');

  historyList.querySelectorAll('.btn-load-plan').forEach(btn =>
    btn.addEventListener('click', () => {
      const entry = getHistory().find(e => e.id === btn.dataset.id);
      if (entry) loadPlanFromHistory(entry);
    })
  );
  historyList.querySelectorAll('.btn-delete-plan').forEach(btn =>
    btn.addEventListener('click', () => deleteFromHistory(btn.dataset.id))
  );
}

function loadPlanFromHistory(entry) {
  const cfg = entry.config || {};
  if (cfg.days) { currentDays = cfg.days; updateDays(0); }
  document.querySelectorAll('input[name="meals"]').forEach(cb => {
    cb.checked = (cfg.meals||[]).includes(cb.value);
    cb.dispatchEvent(new Event('change'));
  });
  document.querySelectorAll('input[name="batch"]').forEach(cb => {
    cb.checked = (cfg.batch||[]).includes(cb.value);
  });
  if (cfg.notes !== undefined) notesInput.value = cfg.notes;
  currentPlanData = entry.data;
  renderResults(entry.data);
  hide(planEmptyState);
  hide(errorSection);
  show(resultsSection);
  show(planNavBadge);
  showPage('plan');
  showToast('Plan loaded from history.', 'info');
}

clearHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear all saved plans?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistoryPanel();
});

// ── Rendering ─────────────────────────────────────────────────
function renderMacroPills(macros) {
  if (!macros) return '';
  return `<div class="macro-pills">
    ${macros.calories!=null?`<span class="macro-pill cal">${macros.calories} kcal</span>`:''}
    ${macros.protein !=null?`<span class="macro-pill pro">${macros.protein}g protein</span>`:''}
    ${macros.carbs   !=null?`<span class="macro-pill carbs">${macros.carbs}g carbs</span>`:''}
    ${macros.fat     !=null?`<span class="macro-pill fat">${macros.fat}g fat</span>`:''}
  </div>`;
}

function renderRecipeDetails(meal) {
  const ing  = meal.ingredients  || [];
  const inst = meal.instructions || [];
  const bi   = meal.batch_info;
  if (!ing.length && !inst.length && !bi) return '';
  const ingHtml  = ing.length  ? `<div><div class="recipe-section-title">Ingredients</div><ul class="ingredients-list">${ing.map(i=>`<li>${escHtml(String(i))}</li>`).join('')}</ul></div>` : '';
  const instHtml = inst.length ? `<div><div class="recipe-section-title">Instructions</div><ol class="instructions-list">${inst.map(s=>`<li>${escHtml(String(s))}</li>`).join('')}</ol></div>` : '';
  const batchHtml= bi ? `<div class="batch-info-box"><div class="batch-badge">↻ Batch Cook</div>${bi.servings?`<strong>Makes ${bi.servings} servings</strong><br>`:''}${bi.storage?`🧊 ${escHtml(bi.storage)}<br>`:''}${bi.reheat?`🔥 ${escHtml(bi.reheat)}`:''}</div>` : '';
  return `<details class="recipe-details"><summary>View Recipe</summary><div class="recipe-body">${ingHtml}${instHtml}${batchHtml}</div></details>`;
}

function renderMealCard(type, meal) {
  if (!meal) return '';
  const id    = recipeId(type, meal.name);
  const saved = isRecipeSaved(id);
  mealDataMap.set(id, { type, meal });
  return `<div class="meal-card">
    <div class="meal-card-top">
      <span class="meal-type-badge ${type}">${MEAL_ICONS[type]||''} ${capitalize(type)}</span>
      <button class="btn-star ${saved?'starred':''}" data-recipe-id="${escHtml(id)}" title="${saved?'Remove from Recipe Book':'Save to Recipe Book'}">${saved?'★':'☆'}</button>
    </div>
    <div class="meal-name">${escHtml(meal.name||'')}</div>
    <div class="meal-desc">${escHtml(meal.description||'')}</div>
    ${renderMacroPills(meal.macros)}
    ${renderRecipeDetails(meal)}
  </div>`;
}

function renderDay(dayObj) {
  const totals   = dayObj.daily_totals || {};
  const totalStr = [
    totals.calories!=null?`<strong>${totals.calories}</strong> kcal`:'',
    totals.protein !=null?`<strong>${totals.protein}g</strong> protein`:'',
    totals.carbs   !=null?`<strong>${totals.carbs}g</strong> carbs`:'',
    totals.fat     !=null?`<strong>${totals.fat}g</strong> fat`:'',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const meals     = dayObj.meals || {};
  const mealCards = MEAL_ORDER.filter(k=>meals[k]).map(k=>renderMealCard(k,meals[k])).join('');
  return `<div class="day-section">
    <div class="day-header">
      <span class="day-label">${escHtml(dayObj.label||`Day ${dayObj.day}`)}</span>
      ${totalStr?`<span class="day-totals">${totalStr}</span>`:''}
    </div>
    <div class="meals-grid">${mealCards||'<div class="meal-card"><em>No meals</em></div>'}</div>
  </div>`;
}

// Star button — event delegation on meal plan container
mealPlanContainer.addEventListener('click', e => {
  const btn = e.target.closest('.btn-star');
  if (!btn) return;
  const id = btn.dataset.recipeId;
  if (isRecipeSaved(id)) {
    removeRecipe(id);
    btn.textContent = '☆';
    btn.classList.remove('starred');
    btn.title = 'Save to Recipe Book';
    showToast('Removed from Recipe Book.', 'info');
  } else {
    const data = mealDataMap.get(id);
    if (data) saveRecipe(id, data.type, data.meal);
    btn.textContent = '★';
    btn.classList.add('starred');
    btn.title = 'Remove from Recipe Book';
    showToast('Saved to Recipe Book! ⭐', 'success');
  }
});

function renderSummaryBar(summary) {
  if (!summary) { summaryBar.innerHTML = ''; return; }
  summaryBar.innerHTML = `
    <div class="summary-stat">
      <div class="stat-value">${summary.avg_daily_calories??'—'}</div>
      <div class="stat-label">Avg daily kcal</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${summary.avg_daily_protein??'—'}g</div>
      <div class="stat-label">Avg daily protein</div>
    </div>
    ${summary.highlights?`<div class="summary-highlight">${escHtml(summary.highlights)}</div>`:''}`;
}

function renderShoppingList(list) {
  shoppingGrid.innerHTML = '';
  if (!list || typeof list !== 'object') return;
  const ORDER = ['produce','proteins','grains_and_legumes','pantry_and_spices','frozen','other'];
  const keys  = [...new Set([...ORDER,...Object.keys(list)])].filter(k=>list[k]?.length);
  if (!keys.length) { shoppingGrid.innerHTML='<p style="color:var(--text-muted)">No shopping list generated.</p>'; return; }
  keys.forEach(key => {
    const items = list[key];
    if (!items?.length) return;
    const div = document.createElement('div');
    div.className = 'shopping-category';
    div.innerHTML = `<div class="category-title">${CATEGORY_ICONS[key]||'📦'} ${CATEGORY_LABELS[key]||capitalize(key.replace(/_/g,' '))}</div>
      <ul>${items.map(i=>`<li>${escHtml(String(i))}</li>`).join('')}</ul>`;
    shoppingGrid.appendChild(div);
  });
}

function renderResults(data) {
  mealDataMap.clear();
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

  // Switch to Plan page and show loading state
  showPage('plan');
  hide(planEmptyState);
  hide(errorSection);
  hide(resultsSection);
  show(loadingSection);
  generateBtn.disabled    = true;
  loadingText.textContent = LOADING_MSGS[0];
  const msgTimer = cycleLoadingMessages();

  try {
    const res  = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days:currentDays, meals, notes:notesInput.value, batchMeals }),
    });
    const json = await res.json();
    clearInterval(msgTimer);
    if (!json.success) throw new Error(json.error || 'Unknown error');

    currentPlanData = json.data;
    saveToHistory(json.data, { days:currentDays, meals, batch:batchMeals, notes:notesInput.value });
    renderResults(json.data);
    hide(loadingSection);
    show(resultsSection);
    show(planNavBadge);

  } catch (err) {
    clearInterval(msgTimer);
    hide(loadingSection);
    errorMessage.textContent = err.message || 'Something went wrong. Please try again.';
    show(errorSection);
  } finally {
    generateBtn.disabled = false;
  }
}

// ── Events ────────────────────────────────────────────────────
generateBtn.addEventListener('click', generate);
errorRetryBtn.addEventListener('click', () => { hide(errorSection); generate(); });
regenerateBtn.addEventListener('click', () => showPage('planner'));
printBtn.addEventListener('click', () => window.print());

// ── Init ──────────────────────────────────────────────────────
async function init() {
  updateDays(0);
  await checkAnyListStatus();  // wait so recipe book AnyList buttons render correctly
  updateAnyListUI();
  renderHistoryPanel();
  renderRecipeBook();
}
init();
