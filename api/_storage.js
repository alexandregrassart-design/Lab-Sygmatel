import { put, get } from "@vercel/blob";

// Accès au stockage Vercel Blob du Lab, partagé par les compteurs de
// visites (stats.js) et la boîte à idées (ideas.js). Le nom commence par
// « _ » : Vercel n'en fait pas une adresse du site.

// Jeton du stockage : nom habituel, ou nom personnalisé choisi à la
// création du stockage sur Vercel (ex. LAB_STATS_READ_WRITE_TOKEN).
export function storageToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const name = Object.keys(process.env).find((key) => key.endsWith("_READ_WRITE_TOKEN") && process.env[key]);
  return name ? process.env[name] : "";
}

export const NO_STORAGE_MESSAGE =
  "Aucun stockage Blob n'est relié au projet sur Vercel (ou le projet n'a pas été redéployé depuis).";

// Un stockage Vercel Blob est créé « privé » ou « public » : on s'adapte à
// celui qui existe, en essayant d'abord privé.
let accessMode = null;
async function withAccess(run) {
  const modes = accessMode ? [accessMode] : ["private", "public"];
  let lastError;
  for (const mode of modes) {
    try {
      const result = await run(mode);
      accessMode = mode;
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Lit un fichier JSON du stockage ; `fallback` s'il n'existe pas encore.
export async function readJson(path, token, fallback) {
  const result = await withAccess((access) => get(path, { access, token, useCache: false }));
  if (!result) return fallback;
  if (result.statusCode !== 200 || !result.stream) throw new Error(`Lecture de ${path} impossible.`);
  const data = JSON.parse(await new Response(result.stream).text());
  return data && typeof data === "object" ? data : fallback;
}

export async function writeJson(path, data, token) {
  await withAccess((access) =>
    put(path, JSON.stringify(data), {
      access,
      token,
      addRandomSuffix: false,
      contentType: "application/json",
      allowOverwrite: true,
    }),
  );
}

// Message d'erreur lisible pour dépanner, sans jeton ni donnée.
export function storageErrorDetail(error) {
  return String(error?.message || error).replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, "[jeton]").slice(0, 200);
}

// Corps de requête : objet JSON, ou texte JSON (envoi par sendBeacon).
export function parseBody(req) {
  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  return body && typeof body === "object" ? body : {};
}
