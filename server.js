require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const AnyList   = require('anylist');
const { Pool }  = require('pg');
const path      = require('path');
const os        = require('os');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Database ──────────────────────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDB() {
  if (!pool) {
    console.log('  No DATABASE_URL — recipes & history will not persist across sessions.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_recipes (
        id       TEXT PRIMARY KEY,
        saved_at BIGINT NOT NULL,
        type     TEXT   NOT NULL,
        data     JSONB  NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_history (
        id       TEXT PRIMARY KEY,
        saved_at BIGINT NOT NULL,
        config   JSONB  NOT NULL,
        summary  JSONB  NOT NULL,
        data     JSONB  NOT NULL
      );
    `);
    console.log('  Database ready ✓');
  } catch (err) {
    console.error('  Database init error:', err.message);
  }
}

// ── Recipes API ───────────────────────────────────────────────
app.get('/api/recipes', async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query('SELECT * FROM saved_recipes ORDER BY saved_at DESC');
    res.json(rows.map(r => ({ id: r.id, savedAt: Number(r.saved_at), type: r.type, ...r.data })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error: 'No database configured.' });
  const { id, savedAt, type, ...data } = req.body;
  try {
    await pool.query(
      `INSERT INTO saved_recipes (id, saved_at, type, data) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET saved_at=$2, type=$3, data=$4`,
      [id, savedAt, type, data]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/recipes/all', async (_req, res) => {
  if (!pool) return res.json({ success: false });
  try { await pool.query('DELETE FROM saved_recipes'); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/recipes/:id', async (req, res) => {
  if (!pool) return res.json({ success: false });
  try { await pool.query('DELETE FROM saved_recipes WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── History API ───────────────────────────────────────────────
app.get('/api/history', async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query('SELECT * FROM plan_history ORDER BY saved_at DESC LIMIT 10');
    res.json(rows.map(r => ({ id: r.id, savedAt: Number(r.saved_at), config: r.config, summary: r.summary, data: r.data })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/history', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error: 'No database configured.' });
  const { id, savedAt, config, summary, data } = req.body;
  try {
    await pool.query(
      `INSERT INTO plan_history (id, saved_at, config, summary, data) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET saved_at=$2, config=$3, summary=$4, data=$5`,
      [id, savedAt, config, summary, data]
    );
    // Prune to 10 most recent
    await pool.query(`
      DELETE FROM plan_history WHERE id NOT IN (
        SELECT id FROM plan_history ORDER BY saved_at DESC LIMIT 10
      )
    `);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/history/all', async (_req, res) => {
  if (!pool) return res.json({ success: false });
  try { await pool.query('DELETE FROM plan_history'); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/history/:id', async (req, res) => {
  if (!pool) return res.json({ success: false });
  try { await pool.query('DELETE FROM plan_history WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Debug endpoint ────────────────────────────────────────────
app.get('/api/debug', async (_req, res) => {
  const info = { dbConnected: !!pool, recipeCount: 0, historyCount: 0, error: null };
  if (pool) {
    try {
      const r = await pool.query('SELECT COUNT(*) FROM saved_recipes');
      const h = await pool.query('SELECT COUNT(*) FROM plan_history');
      info.recipeCount  = parseInt(r.rows[0].count, 10);
      info.historyCount = parseInt(h.rows[0].count, 10);
    } catch (err) { info.error = err.message; }
  }
  res.json(info);
});

// ── Prompt builder ────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a professional nutritionist and meal planner specializing in high-protein, dairy-free, kosher meal plans. You respond with valid JSON only — no markdown, no code fences, no explanation text outside the JSON object.`;

function buildPrompt(days, meals, notes, batchMeals) {
  const mealLabel = meals.join(', ');
  const hasBatch  = batchMeals && batchMeals.length > 0;

  const batchSection = hasBatch ? `
BATCH COOKING — the following meal types should be designed for batch prep (cook once, eat multiple days):
${batchMeals.map(m => `- ${m}`).join('\n')}

For each batch-cooked meal type:
- Design recipes that reheat well and store safely
- Scale the recipe to cover all ${days} days in one or two cooking sessions
- The same recipe may repeat across days — that is expected and intentional
- Include a "batch_info" object with: servings count, fridge storage duration, and reheating instructions
- Meals NOT in the batch list should be designed as fresh single-serving meals (no batch_info)
` : '';

  return `Create a ${days}-day meal plan. Each day includes: ${mealLabel}.

HARD DIETARY CONSTRAINTS — never violate these:
1. High-protein: aim for 35–50g protein per main meal, 150–200g+ total per day
2. Dairy-free: no milk, cheese, butter, cream, yogurt, ghee, or any dairy ingredient
3. Kosher: no pork or pork products, no shellfish or seafood without fins/scales, never mix meat and dairy
${batchSection}
Additional preferences from the user: ${notes && notes.trim() ? notes.trim() : 'None'}

Respond with this exact JSON structure. Include only the meal keys in the requested list (${mealLabel}). Every meal must include a full recipe with ingredients and step-by-step instructions:

{
  "meal_plan": [
    {
      "day": 1,
      "label": "Day 1",
      "meals": {
        "breakfast": {
          "name": "Meal name",
          "description": "One or two sentence description",
          "ingredients": ["6 oz salmon fillet", "2 tbsp olive oil", "1 tsp garlic powder"],
          "instructions": [
            "Preheat oven to 400°F.",
            "Pat salmon dry and brush with olive oil.",
            "Season with garlic powder, salt, and pepper.",
            "Bake 12–15 minutes until flakes easily."
          ],
          "batch_info": {
            "servings": 5,
            "storage": "Store in airtight containers in the fridge for up to 4 days.",
            "reheat": "Microwave covered for 90 seconds, or warm in a skillet over medium heat for 3 minutes."
          },
          "macros": { "calories": 480, "protein": 42, "carbs": 35, "fat": 16 }
        }
      },
      "daily_totals": { "calories": 2100, "protein": 165, "carbs": 180, "fat": 62 }
    }
  ],
  "shopping_list": {
    "produce": ["item (qty)"],
    "proteins": ["item (qty)"],
    "grains_and_legumes": ["item (qty)"],
    "pantry_and_spices": ["item (qty)"],
    "frozen": ["item (qty)"],
    "other": ["item (qty)"]
  },
  "plan_summary": {
    "avg_daily_calories": 2100,
    "avg_daily_protein": 165,
    "highlights": "One sentence about the nutritional highlights of this plan"
  }
}

Notes:
- Omit "batch_info" for meals that are NOT batch cooked
- Omit any shopping list category that would be empty
- Make meals varied, practical, and genuinely delicious
- Every ingredient must be dairy-free and kosher`;
}

// ── Generate meal plan ────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { days, meals, notes, batchMeals } = req.body;

  if (!days || !meals || meals.length === 0)
    return res.status(400).json({ success: false, error: 'Please provide days and at least one meal type.' });

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_api_key_here')
    return res.status(500).json({ success: false, error: 'API key not configured. Add your ANTHROPIC_API_KEY to the .env file.' });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(days, meals, notes, batchMeals || []) }],
    });

    const raw     = message.content[0].text.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let data;
    try   { data = JSON.parse(cleaned); }
    catch { return res.status(500).json({ success: false, error: 'The AI returned an unexpected format. Please try again.' }); }

    res.json({ success: true, data });
  } catch (err) {
    const msg = err?.message || 'Unknown error calling the AI API.';
    res.status(500).json({ success: false, error: msg });
  }
});

// ── Swap a single meal ────────────────────────────────────────
app.post('/api/swap-meal', async (req, res) => {
  const { day, mealType, currentMealName, days, notes, batchMeals } = req.body;

  if (!mealType)
    return res.status(400).json({ success: false, error: 'Missing meal type.' });

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_api_key_here')
    return res.status(500).json({ success: false, error: 'API key not configured. Add your ANTHROPIC_API_KEY to the .env file.' });

  const isBatch = Array.isArray(batchMeals) && batchMeals.includes(mealType);
  const notesLine = notes && notes.trim() ? ` User preferences: ${notes.trim()}.` : '';
  const batchLine = isBatch
    ? ` This is a batch-cooked meal — include a "batch_info" object (servings, storage, reheat) scaled to cover ${days || 7} days.`
    : '';

  const prompt = `Suggest ONE alternative ${mealType} meal. Must be high-protein, dairy-free, kosher. Current meal to replace: ${currentMealName || 'none'}.${notesLine}${batchLine} Return JSON only with the same meal object schema: { "name", "description", "ingredients": [...], "instructions": [...], "macros": { "calories", "protein", "carbs", "fat" }${isBatch ? ', "batch_info": { "servings", "storage", "reheat" }' : ''} }. No markdown, no code fences — just the JSON object.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw     = message.content[0].text.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let meal;
    try   { meal = JSON.parse(cleaned); }
    catch { return res.status(500).json({ success: false, error: 'The AI returned an unexpected format. Please try again.' }); }

    res.json({ success: true, meal });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || 'Unknown error calling the AI API.' });
  }
});

// ── AnyList status ────────────────────────────────────────────
app.get('/api/anylist-status', (_req, res) => {
  const configured = !!(
    process.env.ANYLIST_EMAIL &&
    process.env.ANYLIST_EMAIL !== 'your_anylist_email@example.com' &&
    process.env.ANYLIST_PASSWORD &&
    process.env.ANYLIST_PASSWORD !== 'your_anylist_password'
  );
  res.json({ configured, listName: process.env.ANYLIST_LIST_NAME || 'Groceries' });
});

// ── Send to AnyList ───────────────────────────────────────────
app.post('/api/send-to-anylist', async (req, res) => {
  const { shoppingList } = req.body;

  if (!process.env.ANYLIST_EMAIL || process.env.ANYLIST_EMAIL === 'your_anylist_email@example.com')
    return res.status(400).json({ success: false, error: 'AnyList credentials not configured in .env file.' });

  const listName = process.env.ANYLIST_LIST_NAME || 'Groceries';
  const allItems = [];
  for (const [, items] of Object.entries(shoppingList || {})) {
    if (Array.isArray(items)) items.forEach(item => allItems.push(parseItem(String(item))));
  }

  if (!allItems.length)
    return res.status(400).json({ success: false, error: 'No items to send.' });

  let al;
  try {
    al = new AnyList({ email: process.env.ANYLIST_EMAIL, password: process.env.ANYLIST_PASSWORD });
    await al.login();
    await al.getLists();
    const list = al.getListByName(listName);
    if (!list) return res.status(404).json({ success: false, error: `List "${listName}" not found in your AnyList account.` });
    for (const { name, quantity } of allItems) {
      const item = al.createItem({ name, quantity });
      await list.addItem(item);
    }
    res.json({ success: true, count: allItems.length, listName });
  } catch (err) {
    console.error('AnyList error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to connect to AnyList.' });
  } finally {
    try { if (al) await al.teardown(); } catch {}
  }
});

function parseItem(str) {
  const match = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(str.trim());
  return match ? { name: match[1].trim(), quantity: match[2].trim() } : { name: str.trim(), quantity: '' };
}

// ── Serve PNG icons ───────────────────────────────────────────
app.get('/icon-:size.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'icon.svg'));
});

// ── Start server ──────────────────────────────────────────────
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const iface of ifaces)
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  return null;
}

const PORT     = process.env.PORT || 3000;
const HOSTNAME = os.hostname();
app.listen(PORT, '0.0.0.0', async () => {
  const localIP = getLocalIP();
  console.log(`\n  Meal Planner running:`);
  console.log(`  Local   → http://localhost:${PORT}`);
  if (localIP) console.log(`  Network → http://${localIP}:${PORT}`);
  console.log(`  Mobile  → http://${HOSTNAME}.local:${PORT}`);
  console.log();
  await initDB();
  console.log();
});
