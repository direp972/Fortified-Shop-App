// Vercel function behind "Scan a Sketch" in the trim drawing tool (src/App.jsx).
//
// The app used to call the Anthropic API straight from the browser, which only worked
// inside the Claude.ai artifact sandbox that proxied those calls. Anywhere else —
// roofcoil.com, shop.roofcoil.com, fortifiedmetals.com — it failed with no API key, so
// every scan ended in "Couldn't read that sketch". The key now lives here, server-side.
//
// Environment (Vercel project settings for fortified-shop-app):
//   ANTHROPIC_API_KEY       required — until it is set the endpoint answers 503 with a
//                           plain-English message the app shows as a toast
//   ANTHROPIC_MODEL         optional — defaults to claude-opus-5
//   VITE_SUPABASE_URL,
//   VITE_SUPABASE_ANON_KEY  already set for the build; used here to check the caller's
//                           sign-in token so only members can spend the shop's credits
//
// The app is embedded same-origin on roofcoil.com and fortifiedmetals.com, but those
// sites proxy only the app's pages and assets to this host, not /api — so the browser
// calls this host directly from there and needs CORS.
import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 60 };

const DEFAULT_MODEL = "claude-opus-5";
const ALLOWED_ORIGINS = [
  "https://www.roofcoil.com", "https://roofcoil.com", "https://shop.roofcoil.com",
  "https://www.fortifiedmetals.com", "https://fortifiedmetals.com",
];
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_B64 = 6_000_000; // ~4.5 MB decoded — the app sends a ≤1200px JPEG, far under this

const PROMPT =
  "This is a photo of a hand-drawn sketch of a sheet metal trim/flashing cross-section " +
  "profile — a shape made of connected straight line segments. Read any handwritten " +
  "dimensions (lengths in inches or feet, angles in degrees) if present, and use them to " +
  "size each segment accurately; convert feet to inches. If a segment isn't labeled, " +
  "estimate its length proportionally relative to the labeled ones. Trace the profile as a " +
  "connected path of straight segments only (no curves), starting from one end, as a list " +
  "of [x, y] coordinate pairs in inches with y increasing downward. Return at least two " +
  "points.";

// Structured output keeps the model on a strict shape — no markdown fences to strip.
const POINTS_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      points: {
        type: "array",
        description: "Profile vertices in order, each [x, y] in inches",
        items: { type: "array", items: { type: "number" } },
      },
    },
    required: ["points"],
    additionalProperties: false,
  },
};

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ALLOWED_ORIGINS.includes(origin)
    || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)      // preview deployments
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin); // local dev
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

// The caller must be a signed-in member: the app sends its Supabase access token and
// we ask Supabase whether it is good. Fails closed — an unconfigured server does not
// hand out free model calls.
async function verifyMember(req, fetchImpl = fetch) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Sign in to scan a sketch." };
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, status: 503, error: "Sketch scanning isn't set up on this server yet — Supabase settings are missing." };
  try {
    const r = await fetchImpl(`${url.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!r.ok) return { ok: false, status: 401, error: "Your sign-in has expired — sign in again and retry the scan." };
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 502, error: "Couldn't confirm your sign-in — try again in a moment." };
  }
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

// Exported for tests: `deps` lets a test swap the model client and the token check.
export async function scanSketch(req, res, deps = {}) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Sketch scanning isn't set up on this server yet — add ANTHROPIC_API_KEY in the Vercel project settings." });
  }

  const member = await (deps.verifyMember || verifyMember)(req);
  if (!member.ok) return res.status(member.status).json({ error: member.error });

  const body = readBody(req);
  const image = typeof body.image === "string" ? body.image.replace(/^data:[^,]+,/, "").trim() : "";
  const mediaType = MEDIA_TYPES.includes(body.mediaType) ? body.mediaType : "image/jpeg";
  if (!image) return res.status(400).json({ error: "Attach a photo of the sketch first." });
  if (image.length > MAX_IMAGE_B64) return res.status(413).json({ error: "That photo is too large — try a smaller one." });

  // One attempt that fits inside maxDuration (a retry after a timeout could never finish
  // in the remaining budget — Vercel would kill the function and the browser would only
  // see a bare 504). Rate-limit and overload errors still come back as clean JSON below.
  const client = deps.client || new Anthropic({ timeout: 50_000, maxRetries: 0 });
  let message;
  try {
    message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
      output_config: { format: POINTS_FORMAT },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: "Sketch scanning isn't set up right — the server's ANTHROPIC_API_KEY was rejected." });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "The sketch reader is busy — try again in a minute." });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: "The sketch reader didn't answer — try again." });
    console.error("scan-sketch model call failed", e);
    return res.status(502).json({ error: "The sketch reader didn't answer — try again." });
  }

  if (message.stop_reason === "refusal") return res.status(422).json({ error: "Couldn't read that sketch — try a clearer photo, or draw it by hand instead." });
  if (message.stop_reason === "max_tokens") return res.status(502).json({ error: "The sketch reader ran out of room — try a simpler photo." });

  const text = (message.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let points;
  try { points = JSON.parse(text).points; } catch (e) { points = null; }
  const valid = Array.isArray(points) && points.length >= 2
    && points.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!valid) return res.status(422).json({ error: "Couldn't make sense of that sketch — try a clearer photo, or draw it by hand instead." });

  return res.status(200).json({ points: points.map((p) => [+p[0], +p[1]]) });
}

export default function handler(req, res) {
  return scanSketch(req, res);
}
