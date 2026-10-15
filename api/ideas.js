import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { storageToken, NO_STORAGE_MESSAGE, readJson, writeJson, storageErrorDetail, parseBody } from "./_storage.js";

// Boîte à idées du Lab : suggestions d'amélioration d'une application
// existante, ou idées de nouveaux logiciels. Chacun peut proposer et
// soutenir une idée (« Moi aussi »). Réservé aux personnes entrées avec le
// code du Lab : middleware.js filtre toutes les requêtes avant celle-ci.
//
// Suppression :
// - l'auteur d'une idée peut la supprimer depuis l'appareil où il l'a
//   proposée (clé remise à la création, gardée par son navigateur) ;
// - avec le code de modération (variable LAB_ADMIN_CODE du projet Vercel),
//   on peut supprimer n'importe quelle idée.

const FILE = "lab/ideas.json";
const MAX_IDEAS = 300;
const TYPES = ["amelioration", "nouveau"];

const clean = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanText = (value, max) => String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

function sameSecret(a, b) {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

export function isModerator(code) {
  const expected = String(process.env.LAB_ADMIN_CODE || "").trim();
  const given = String(code || "").trim();
  return !!expected && !!given && sameSecret(given, expected);
}

// Ce qui part vers les navigateurs : jamais l'empreinte de la clé.
export const publicIdeas = (list) => list.map(({ keyHash, ...idea }) => idea);

export function createIdea(list, body, nowIso, id, deleteKey) {
  const type = TYPES.includes(body.type) ? body.type : null;
  const title = clean(body.title, 120);
  const details = cleanText(body.details, 2000);
  const app = type === "amelioration" ? clean(body.app, 60) : "";
  const author = clean(body.author, 60);
  if (!type) return { error: "Choisissez le type : amélioration ou nouveau logiciel." };
  if (title.length < 3) return { error: "Donnez un titre à votre idée (3 caractères au moins)." };
  if (type === "amelioration" && !app) return { error: "Indiquez l'application concernée." };
  if (list.length >= MAX_IDEAS) return { error: "La boîte à idées est pleine : prévenez Alexandre." };
  const idea = { id, type, app, title, details, author, createdAt: nowIso, votes: 0, keyHash: sha256(deleteKey) };
  list.unshift(idea);
  return { idea };
}

export function voteIdea(list, id) {
  const idea = list.find((i) => i.id === id);
  if (!idea) return { error: "Idée introuvable." };
  idea.votes = (Number(idea.votes) || 0) + 1;
  return { idea };
}

export function deleteIdea(list, id, key, moderator) {
  const index = list.findIndex((i) => i.id === id);
  if (index < 0) return { error: "Idée introuvable (déjà supprimée ?).", status: 404 };
  const idea = list[index];
  const isAuthor = !!key && !!idea.keyHash && sameSecret(sha256(key), idea.keyHash);
  if (!isAuthor && !moderator) {
    return { error: "Seul l'auteur de l'idée, ou un modérateur, peut la supprimer.", status: 403 };
  }
  list.splice(index, 1);
  return {};
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = storageToken();
  if (!token) return res.status(503).json({ error: NO_STORAGE_MESSAGE });

  try {
    const body = req.method === "POST" ? parseBody(req) : {};

    // Vérification du code de modération (sans toucher aux idées).
    if (req.method === "POST" && body.action === "moderator") {
      if (!String(process.env.LAB_ADMIN_CODE || "").trim()) {
        return res.status(503).json({ error: "Aucun code de modération n'est réglé sur Vercel (variable LAB_ADMIN_CODE)." });
      }
      if (!isModerator(body.adminCode)) {
        await pause(700); // ralentit les essais en série
        return res.status(401).json({ error: "Code de modération incorrect." });
      }
      return res.status(200).json({ ok: true });
    }

    const data = await readJson(FILE, token, { ideas: [] });
    const ideas = Array.isArray(data.ideas) ? data.ideas : [];
    let created = null;

    if (req.method === "POST") {
      let outcome;
      if (body.action === "vote") {
        outcome = voteIdea(ideas, String(body.id || ""));
      } else if (body.action === "delete") {
        const moderator = isModerator(body.adminCode);
        if (body.adminCode && !moderator) await pause(700);
        outcome = deleteIdea(ideas, String(body.id || ""), body.key, moderator);
      } else {
        const deleteKey = randomUUID();
        outcome = createIdea(ideas, body, new Date().toISOString(), randomUUID(), deleteKey);
        if (!outcome.error) created = { id: outcome.idea.id, deleteKey };
      }
      if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
      await writeJson(FILE, { ideas }, token);
    } else if (req.method !== "GET") {
      return res.status(405).json({ error: "Méthode non autorisée." });
    }
    return res.status(200).json({ ideas: publicIdeas(ideas), ...(created ? { created } : {}) });
  } catch (error) {
    console.error("Lab ideas error:", error);
    return res.status(500).json({ error: `Le stockage a répondu par une erreur : ${storageErrorDetail(error)}` });
  }
}
