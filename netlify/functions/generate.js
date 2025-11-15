const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize AI client if key is present
let genAI = null;
if (process.env.GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  } catch (e) {
    console.warn('Failed to init GoogleGenerativeAI in function:', e && e.message ? e.message : e);
    genAI = null;
  }
} else {
  console.warn('GEMINI_API_KEY not set in environment for Netlify function');
}

// Helper to extract JSON from model outputs
function extractJsonFromText(s) {
  if (!s || typeof s !== 'string') return null;
  const fencedJson = /```json\s*([\s\S]*?)\s*```/i.exec(s);
  if (fencedJson && fencedJson[1]) return fencedJson[1].trim();
  const fencedAny = /```\s*([\s\S]*?)\s*```/.exec(s);
  if (fencedAny && fencedAny[1]) return fencedAny[1].trim();
  const firstBrace = s.indexOf('{');
  if (firstBrace === -1) return null;
  let i = firstBrace, depth = 0, inString = false, lastChar = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && lastChar !== '\\') inString = !inString;
    if (!inString) {
      if (ch === '{') depth++; else if (ch === '}') depth--;
    }
    lastChar = ch;
    if (depth === 0 && i > firstBrace) return s.slice(firstBrace, i + 1).trim();
  }
  return null;
}

function sanitizeJsonString(s) {
  if (!s || typeof s !== 'string') return s;
  let out = s.trim();
  out = out.replace(/```\s*json/i, '```');
  out = out.replace(/```/g, '');
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:\\])\/\/.*/g, '$1');
  out = out.replace(/,\s*([}\]])/g, '$1');
  return out.trim();
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!genAI) {
    return { statusCode: 503, body: JSON.stringify({ error: 'AI service not configured. Set GEMINI_API_KEY.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { startCity, destination, dates, interests, style } = body;

    const prompt = `You are an expert travel planner. Generate a personalized, day-wise travel itinerary and a list of recommended places with addresses based on the following user preferences.\nStart City: ${startCity || 'Not specified'}\nDestination: ${destination}\nTravel Dates: ${dates}\nInterests: ${interests}\nTravel Style: ${style}\n\nOutput: Return a single valid JSON object with keys \"itinerary\" (Markdown string) and \"places\" (array of {name,address,short_description,image,rating,latitude,longitude}).`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Try direct parse, then extract and sanitize
    try {
      return { statusCode: 200, body: JSON.stringify(JSON.parse(text)) };
    } catch (e) {
      const maybe = extractJsonFromText(text);
      if (maybe) {
        const sanitized = sanitizeJsonString(maybe);
        try {
          return { statusCode: 200, body: JSON.stringify(JSON.parse(sanitized)) };
        } catch (e2) {
          const first = sanitized.indexOf('{');
          const last = sanitized.lastIndexOf('}');
          if (first !== -1 && last !== -1 && last > first) {
            const candidate = sanitized.slice(first, last + 1);
            try {
              return { statusCode: 200, body: JSON.stringify(JSON.parse(candidate)) };
            } catch (e3) {
              // fallthrough
            }
          }
        }
      }
      // Fallback: return itinerary only
      return { statusCode: 200, body: JSON.stringify({ itinerary: text, places: [] }) };
    }
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
