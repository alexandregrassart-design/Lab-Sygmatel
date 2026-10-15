import { randomUUID } from "crypto";
import { storageToken, NO_STORAGE_MESSAGE, readJson, writeJson, storageErrorDetail, parseBody } from "./_storage.js";

// Boîte à idées du Lab : suggestions d'amélioration d'une application
// existante, ou idées de nouveaux logiciels. Chacun peut proposer et
// soutenir une idée (« Moi aussi »). Réservé aux personnes entrées avec le
// code du Lab : middleware.js filtre toutes les requêtes avant celle-ci.

const FILE = "lab/ideas.json";
const MAX_IDEAS = 300;
const TYPES = ["amelioration", "nouveau"];

const clean = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanText = (value, max) => String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);

export function createIdea(list, body, nowIso, id) {
  const type = TYPES.includes(body.type) ? body.type : null;
  const title = clean(body.title, 120);
  const details = cleanText(body.details, 2000);
  const app = type === "amelioration" ? clean(body.app, 60) : "";
  const author = clean(body.author, 60);
  if (!type) return { error: "Choisissez le type : amélioration ou nouveau logiciel." };
  if (title.length < 3) return { error: "Donnez un titre à votre idée (3 caractères au moins)." };
  if (type === "amelioration" && !app) return { error: "Indiquez l'application concernée." };
  if (list.length >= MAX_IDEAS) return { error: "La boîte à idées est pleine : prévenez Alexandre." };
  const idea = { id, type, app, title, details, author, createdAt: nowIso, votes: 0 };
  list.unshift(idea);
  return { idea };
}

export function voteIdea(list, id) {
  const idea = list.find((i) => i.id === id);
  if (!idea) return { error: "Idée introuvable." };
  idea.votes = (Number(idea.votes) || 0) + 1;
  return { idea };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = storageToken();
  if (!token) return res.status(503).json({ error: NO_STORAGE_MESSAGE });

  try {
    const data = await readJson(FILE, token, { ideas: [] });
    const ideas = Array.isArray(data.ideas) ? data.ideas : [];

    if (req.method === "POST") {
      const body = parseBody(req);
      const outcome =
        body.action === "vote"
          ? voteIdea(ideas, String(body.id || ""))
          : createIdea(ideas, body, new Date().toISOString(), randomUUID());
      if (outcome.error) return res.status(400).json({ error: outcome.error });
      await writeJson(FILE, { ideas }, token);
    } else if (req.method !== "GET") {
      return res.status(405).json({ error: "Méthode non autorisée." });
    }
    return res.status(200).json({ ideas });
  } catch (error) {
    console.error("Lab ideas error:", error);
    return res.status(500).json({ error: `Le stockage a répondu par une erreur : ${storageErrorDetail(error)}` });
  }
}
