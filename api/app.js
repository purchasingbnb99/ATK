/**
 * ATK Inventory - Vercel Serverless Proxy
 * File: api/app.js
 *
 * Browser -> /api/app -> Google Apps Script /exec
 *
 * Secrets:
 * - APPS_SCRIPT_URL
 * - APPS_SCRIPT_API_KEY
 *
 * Both values MUST be configured in Vercel Environment Variables.
 * Never hard-code or expose them to the browser.
 */

function jsonResponse(res, statusCode, payload) {
  res.status(statusCode);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(payload);
}

function getEnv(name) {
  var value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error('Environment variable ' + name + ' belum dikonfigurasi.');
  }
  return String(value).trim();
}

function sanitizeUpstreamText(text) {
  var value = String(text || '');
  if (value.length > 2000) {
    value = value.slice(0, 2000) + '...';
  }
  return value;
}

function buildProxyError(code, message, status) {
  return {
    ok: false,
    error: {
      code: code,
      message: message,
      status: status
    }
  };
}

function isPlainObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function parseRequestBody(req) {
  var body = req.body;

  if (Buffer.isBuffer(body)) {
    body = body.toString('utf8');
  }

  if (typeof body === 'string') {
    if (!body.trim()) {
      throw {
        code: 'INVALID_JSON',
        message: 'Request body kosong.',
        status: 400
      };
    }

    try {
      return JSON.parse(body);
    } catch (err) {
      throw {
        code: 'INVALID_JSON',
        message: 'Request body bukan JSON yang valid.',
        status: 400
      };
    }
  }

  return body;
}

function validateBody(body) {
  if (!isPlainObject(body)) {
    throw {
      code: 'INVALID_JSON',
      message: 'Request body harus berupa object JSON.',
      status: 400
    };
  }

  if (!body.action || typeof body.action !== 'string') {
    throw {
      code: 'VALIDATION_ERROR',
      message: 'Field action wajib diisi.',
      status: 400
    };
  }
}

async function readUpstreamResponse(response) {
  var text = await response.text();
  var contentType = response.headers.get('content-type') || '';
  var parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      parsed = null;
    }
  }

  return {
    text: text,
    contentType: contentType,
    parsed: parsed
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonResponse(
      res,
      405,
      buildProxyError(
        'METHOD_NOT_ALLOWED',
        'Method yang didukung hanya POST.',
        405
      )
    );
  }

  try {
    var appsScriptUrl = getEnv('APPS_SCRIPT_URL');
    var appsScriptApiKey = getEnv('APPS_SCRIPT_API_KEY');

    var body = parseRequestBody(req);
    validateBody(body);

    /*
     * The browser must never control the Apps Script API key.
     * Remove any client-supplied apiKey, then inject the server secret.
     */
    var payload = {};
    var bodyKeys = Object.keys(body);

    for (var i = 0; i < bodyKeys.length; i++) {
      var key = bodyKeys[i];

      if (key === 'apiKey') {
        continue;
      }

      payload[key] = body[key];
    }

    payload.apiKey = appsScriptApiKey;

    var upstreamResponse;

    try {
      upstreamResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (networkErr) {
      return jsonResponse(
        res,
        502,
        buildProxyError(
          'UPSTREAM_NETWORK_ERROR',
          'Proxy tidak dapat terhubung ke Google Apps Script.',
          502
        )
      );
    }

    var upstream = await readUpstreamResponse(upstreamResponse);

    /*
     * Never pass HTML/text upstream errors directly to the frontend.
     * The frontend must always receive JSON.
     */
    if (!upstream.parsed || typeof upstream.parsed !== 'object') {
      var safeText = sanitizeUpstreamText(upstream.text);

      console.error('Apps Script non-JSON response:', {
        status: upstreamResponse.status,
        contentType: upstream.contentType,
        bodyPreview: safeText
      });

      return jsonResponse(
        res,
        502,
        buildProxyError(
          'UPSTREAM_INVALID_JSON',
          'Google Apps Script mengembalikan respons yang bukan JSON valid.',
          502
        )
      );
    }

    var responseStatus = upstreamResponse.ok
      ? 200
      : (upstreamResponse.status >= 400 ? upstreamResponse.status : 502);

    /*
     * Preserve the Apps Script JSON envelope:
     * { ok: true, data: ... }
     * { ok: false, error: ... }
     */
    return jsonResponse(res, responseStatus, upstream.parsed);

  } catch (err) {
    if (err && err.code && err.message && err.status) {
      return jsonResponse(
        res,
        err.status,
        buildProxyError(err.code, err.message, err.status)
      );
    }

    console.error('Vercel proxy error:', err);

    return jsonResponse(
      res,
      500,
      buildProxyError(
        'PROXY_SERVER_ERROR',
        'Terjadi kesalahan pada Vercel proxy.',
        500
      )
    );
  }
};
