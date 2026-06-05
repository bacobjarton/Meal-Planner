require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const AnyList  = require('anylist');
const path     = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  // Flatten all shopping list items across categories
  const allItems = [];
  for (const [category, items] of Object.entries(shoppingList || {})) {
    if (Array.isArray(items)) {
      for (const item of items) allItems.push(parseItem(String(item)));
    }
  }

  if (!allItems.length)
    return res.status(400).json({ success: false, error: 'No items to send.' });

  let al;
  try {
    al = new AnyList({ email: process.env.ANYLIST_EMAIL, password: process.env.ANYLIST_PASSWORD });
    await al.login();
    await al.getLists();

    const list = al.getListByName(listName);
    if (!list)
      return res.status(404).json({ success: false, error: `List "${listName}" not found in your AnyList account.` });

    // Add all items
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

// Parse "Chicken breast (2 lbs)" → { name, quantity }
function parseItem(str) {
  const match = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(str.trim());
  return match
    ? { name: match[1].trim(), quantity: match[2].trim() }
    : { name: str.trim(), quantity: '' };
}

// ── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Meal Planner running → http://localhost:${PORT}\n`);
});
