/**
 * Vercel Serverless Function
 * Path: /api/app.js
 *
 * Required Vercel environment variables:
 *   APPS_SCRIPT_URL
 *   APPS_SCRIPT_API_KEY
 *
 * Frontend calls this file with JSON:
 *   { action, sessionToken, ... }
 */

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  const apiKey = process.env.APPS_SCRIPT_API_KEY;

  if (!appsScriptUrl || !apiKey) {
    return res.status(500).json({
      ok: false,
      error: "Server belum dikonfigurasi: APPS_SCRIPT_URL / APPS_SCRIPT_API_KEY"
    });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    payload.apiKey = apiKey;

    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        ok: false,
        error: "Apps Script mengembalikan respons yang bukan JSON.",
        raw: text.slice(0, 1000)
      });
    }

    return res.status(response.ok ? 200 : 502).json(data);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Proxy error"
    });
  }
}
