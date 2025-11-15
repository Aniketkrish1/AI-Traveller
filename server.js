// Import necessary packages
const express = require('express');
const cors = require('cors');
require('dotenv').config(); // Loads environment variables from .env
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Apply middleware
app.use(cors()); // Allows requests from your frontend
app.use(express.json()); // Parses incoming JSON requests
app.use(express.static('public')); // Serves your frontend files (HTML, CSS, JS)

// --- Configure Gemini API ---
let genAI = null;
if (process.env.GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  } catch (e) {
    console.warn('Warning: failed to initialize GoogleGenerativeAI client:', e && e.message ? e.message : e);
    genAI = null;
  }
} else {
  console.warn('Warning: GEMINI_API_KEY is not set. /generate endpoint will return a helpful error until configured.');
}

// Global error handlers to surface runtime errors instead of silent exits
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// --- Define the API Endpoint ---
app.post('/generate', async (req, res) => {
  try {
    // 1. Get user inputs from the request body
    const { startCity, destination, dates, interests, style } = req.body;

    // 2. Create a detailed prompt for the AI that asks for structured JSON
    if (!genAI) {
      // If the AI client is not configured, return a helpful error to the frontend
      return res.status(503).json({ error: 'AI service not configured. Please set GEMINI_API_KEY on the server.' });
    }
    const prompt = `
      You are an expert travel planner. Generate a personalized, day-wise travel itinerary and a list of recommended places with addresses based on the following user preferences.
      
      User Inputs:
      Start City: ${startCity || 'Not specified'}
      Destination: ${destination}
      Travel Dates: ${dates}
      Interests: ${interests}
      Travel Style: ${style}

      Your Task:
      1) Create a clear day-wise itinerary as Markdown in the field "itinerary". Use the start city in Day 0 or Day 1 travel notes or transit suggestions where appropriate.
      2) Produce a "places" array containing recommended attractions. Each place must include these fields: name (string), address (string), short_description (string), image (url or empty string), rating (number from 0 to 5 or null), latitude (number or null), longitude (number or null).

      Output Requirements:
      - RETURN ONLY a single valid JSON object, with exactly two keys: "itinerary" and "places".
      - "itinerary" should be a Markdown string (may contain headings, lists, tips).
      - "places" should be an array of objects as described above.
      - Do not include any extra commentary or text outside the JSON.
    `;

    // 3. Call the Gemini API
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 4. Try to parse the response as JSON. If parsing fails, send back the raw itinerary
    // Helper: attempt to extract a JSON substring from AI output
    function extractJsonFromText(s) {
      if (!s || typeof s !== 'string') return null;

      // 1) Look for a fenced code block labeled json ```json ... ```
      const fencedJson = /```json\s*([\s\S]*?)\s*```/i.exec(s);
      if (fencedJson && fencedJson[1]) return fencedJson[1].trim();

      // 2) Look for any fenced code block ``` ... ``` and try its contents
      const fencedAny = /```\s*([\s\S]*?)\s*```/.exec(s);
      if (fencedAny && fencedAny[1]) return fencedAny[1].trim();

      // 3) As a last resort try to find the first balanced JSON object starting at first '{'
      const firstBrace = s.indexOf('{');
      if (firstBrace === -1) return null;

      // Walk through characters counting braces, being careful inside strings
      let i = firstBrace;
      let depth = 0;
      let inString = false;
      let lastChar = null;
      for (; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"' && lastChar !== '\\') {
          inString = !inString;
        }
        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        lastChar = ch;
        if (depth === 0 && i > firstBrace) {
          const candidate = s.slice(firstBrace, i + 1).trim();
          return candidate;
        }
      }
      return null;
    }

    // Sanitization helper to repair common JSON issues (trailing commas, comments, fences)
    function sanitizeJsonString(s) {
      if (!s || typeof s !== 'string') return s;
      let out = s.trim();

      // Remove markdown fences and language hints
      out = out.replace(/```\s*json/i, '```');
      out = out.replace(/```/g, '');

      // Replace smart quotes
      out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

      // Remove JS-style comments
      out = out.replace(/\/\*[\s\S]*?\*\//g, '');
      out = out.replace(/(^|[^:\\])\/\/.*/g, '$1');

      // Remove trailing commas before } or ]
      out = out.replace(/,\s*([}\]])/g, '$1');

      return out.trim();
    }

    try {
      // First try raw parse
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (parseErr) {
      // Attempt to extract JSON-like snippets
      const maybe = extractJsonFromText(text);
      if (maybe) {
        const sanitized = sanitizeJsonString(maybe);
        try {
          const parsed2 = JSON.parse(sanitized);
          return res.json(parsed2);
        } catch (e2) {
          // Try extracting between first { and last } after sanitization
          const first = sanitized.indexOf('{');
          const last = sanitized.lastIndexOf('}');
          if (first !== -1 && last !== -1 && last > first) {
            const candidate = sanitized.slice(first, last + 1);
            try {
              const parsed3 = JSON.parse(candidate);
              return res.json(parsed3);
            } catch (e3) {
              // will fall through to logging
            }
          }

          // Log sanitized failure for debugging
          try {
            const logsDir = 'logs';
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
            const entry = `[${new Date().toISOString()}] Failed to parse extracted JSON.\n--- Original (first 2000 chars):\n${text.slice(0,2000)}\n--- Extracted (first 2000 chars):\n${maybe.slice(0,2000)}\n--- Sanitized (first 2000 chars):\n${sanitized.slice(0,2000)}\n\n`;
            fs.appendFileSync(`${logsDir}/ai_responses.log`, entry, 'utf8');
          } catch (logErr) {
            console.warn('Could not write AI parse failure to log file:', logErr && logErr.message ? logErr.message : logErr);
          }
        }
      }

      // Final fallback: log the parse error and return raw itinerary
      console.warn('Could not parse AI response as JSON, returning raw text. Error:', parseErr && parseErr.message ? parseErr.message : parseErr);
      try {
        const logsDir = 'logs';
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
        const entry = `[${new Date().toISOString()}] JSON parse error: ${parseErr && parseErr.message ? parseErr.message : parseErr}\nAI output (first 2000 chars):\n${text.slice(0,2000)}\n\n`;
        fs.appendFileSync(`${logsDir}/ai_responses.log`, entry, 'utf8');
      } catch (logErr) {
        console.warn('Could not write AI parse failure to log file:', logErr && logErr.message ? logErr.message : logErr);
      }

      return res.json({ itinerary: text, places: [] });
    }

  } catch (error) {
    console.error('Error generating itinerary:', error);
    res.status(500).json({ error: 'Failed to generate itinerary. Please try again.' });
  }
});

// Start the server with friendly error handling
const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try stopping the process using that port or set a different PORT environment variable.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});