// Cloudflare Worker for Kembara Si PeTara.
// Set OPENAI_API_KEY as a Cloudflare Secret (never commit its value).
// Before public launch, enable Cloudflare rate limiting and a spending limit.
// Set ALLOWED_ORIGIN to the exact GitHub Pages origin.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const origin = request.headers.get("Origin");
    const permitted = Boolean(allowedOrigin && origin === allowedOrigin);
    const cors = permitted ? {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    } : {};
    const json = (value, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors }
    });

    if (url.pathname === "/health" && request.method === "GET") {
      return json({status: env.OPENAI_API_KEY ? "ready" : "missing_secret", service: "Kembara Si PeTara"});
    }
    if (url.pathname !== "/transcribe") return json({error: "Not found"}, 404);
    if (request.method === "OPTIONS") {
      return permitted ? new Response(null, {status: 204, headers: cors}) : json({error: "Origin not allowed"}, 403);
    }
    if (request.method !== "POST") return json({error: "Method not allowed"}, 405);
    if (!permitted) return json({error: "Origin not allowed"}, 403);
    if (!env.OPENAI_API_KEY) return json({error: "Server is not configured"}, 503);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 10 * 1024 * 1024) return json({error: "Audio too large"}, 413);
    const type = request.headers.get("Content-Type") || "";
    if (!type.includes("multipart/form-data")) return json({error: "Expected multipart form"}, 415);
    try {
      const form = await request.formData();
      const audio = form.get("audio");
      if (!(audio instanceof File) || !audio.size || audio.size > 10 * 1024 * 1024) {
        return json({error: "Invalid audio file"}, 400);
      }
      const accepted = ["audio/mp4", "audio/webm", "audio/mpeg", "audio/wav", "audio/x-m4a"];
      if (!accepted.some(t => audio.type.startsWith(t))) return json({error: "Unsupported audio format"}, 415);
      const outgoing = new FormData();
      outgoing.append("file", audio, audio.name || "voice.webm");
      outgoing.append("model", "gpt-4o-mini-transcribe");
      outgoing.append("language", "ms");
      const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {Authorization: "Bearer " + env.OPENAI_API_KEY},
        body: outgoing
      });
      if (!upstream.ok) {
        console.error("Transcription upstream status", upstream.status);
        return json({error: "Transcription service unavailable"}, 502);
      }
      const result = await upstream.json();
      return json({text: typeof result.text === "string" ? result.text : ""});
    } catch (error) {
      console.error("Transcription request failed", String(error));
      return json({error: "Unable to process audio"}, 500);
    }
  }
};
