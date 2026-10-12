// Code d'accès du Lab.
//
// Ce fichier s'exécute sur les serveurs de Vercel AVANT chaque page : sans
// le bon code, on ne reçoit que la page de saisie. Le code n'est écrit nulle
// part dans ce dépôt : il est lu dans la variable d'environnement
// LAB_ACCESS_CODE du projet Vercel (Settings → Environment Variables).
// Changer cette variable déconnecte tout le monde.

const COOKIE = "lab_session";
const SESSION_DAYS = 30;
const MAX_AGE = 60 * 60 * 24 * SESSION_DAYS;

// Ce qui reste visible sans code : la page de saisie et son logo.
const PUBLIC_PATHS = new Set(["/login.html", "/sygmatel-mark.svg", "/favicon.ico"]);

const encoder = new TextEncoder();

async function hmacHex(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparaison sans fuite de temps (les deux chaînes ont la même longueur).
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Jeton de session : « date d'expiration . signature », signé avec le code.
async function createToken(code) {
  const expires = Date.now() + MAX_AGE * 1000;
  return `${expires}.${await hmacHex(code, `lab-session:${expires}`)}`;
}

async function isValidToken(token, code) {
  const [expires, signature] = String(token || "").split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return sameString(signature, await hmacHex(code, `lab-session:${expires}`));
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

const redirect = (request, path, headers = {}) =>
  new Response(null, {
    status: 303,
    headers: { Location: new URL(path, request.url).toString(), "Cache-Control": "no-store", ...headers },
  });

// Laisse Vercel servir le fichier demandé.
const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });

const sessionCookie = (value, maxAge) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const code = (process.env.LAB_ACCESS_CODE || "").trim();

  // Vérification du code saisi.
  if (path === "/api/login") {
    if (request.method !== "POST") return json(405, { error: "Méthode non autorisée." });
    if (!code) return json(503, { error: "Le code d'accès n'est pas encore configuré sur Vercel." });
    let typed = "";
    try {
      typed = String((await request.json()).code || "").trim();
    } catch (e) {
      typed = "";
    }
    // On compare des empreintes : même durée quel que soit le code saisi.
    const ok = sameString(await hmacHex(code, `check:${typed}`), await hmacHex(code, `check:${code}`));
    if (!ok) {
      // Petite attente : ralentit les essais en série.
      await new Promise((resolve) => setTimeout(resolve, 700));
      return json(401, { error: "Code incorrect." });
    }
    return json(200, { success: true }, { "Set-Cookie": sessionCookie(await createToken(code), MAX_AGE) });
  }

  if (path === "/api/logout") {
    return redirect(request, "/login.html", { "Set-Cookie": sessionCookie("", 0) });
  }

  const loggedIn = !!code && (await isValidToken(readCookie(request, COOKIE), code));

  if (PUBLIC_PATHS.has(path)) {
    // Déjà entré : inutile de revoir la page de saisie.
    if (path === "/login.html" && loggedIn) return redirect(request, "/");
    return next();
  }

  return loggedIn ? next() : redirect(request, "/login.html");
}
