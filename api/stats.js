import { storageToken, NO_STORAGE_MESSAGE, readJson, writeJson, storageErrorDetail, parseBody } from "./_storage.js";

// Compteurs de fréquentation du Lab, anonymes : on ne retient que des
// nombres par jour (visites du Lab, ouvertures de chaque application).
// Aucun nom, aucune adresse IP, aucun appareil n'est enregistré.
//
// Les compteurs sont rangés dans un petit fichier du stockage Vercel Blob
// du projet (Storage → Blob). Tant que ce stockage n'est pas créé, la
// page du Lab fonctionne normalement et n'affiche simplement pas de compteurs.
//
// L'accès à cette adresse est déjà réservé aux personnes entrées avec le
// code : middleware.js filtre toutes les requêtes avant celle-ci.

const FILE = "lab/stats.json";
const KEEP_DAYS = 400;
const MAX_APPS_PER_DAY = 20;

// Jour courant à l'heure de Paris, au format AAAA-MM-JJ.
export function parisDay(date = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(date);
}

function dayOffset(day, offset) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Ajoute un événement aux compteurs du jour.
//   { event: "visit" }               → une visite du Lab
//   { event: "open", app: "Reboot" } → une application ouverte depuis le Lab
export function applyEvent(data, body, today) {
  const days = data.days || (data.days = {});
  const day = days[today] || (days[today] = { visits: 0, apps: {} });
  if (body.event === "visit") {
    day.visits = (day.visits || 0) + 1;
  } else if (body.event === "open") {
    const app = String(body.app || "").trim().slice(0, 40);
    day.apps = day.apps || {};
    if (!app || (!(app in day.apps) && Object.keys(day.apps).length >= MAX_APPS_PER_DAY)) return false;
    day.apps[app] = (day.apps[app] || 0) + 1;
  } else {
    return false;
  }
  // On ne garde qu'un peu plus d'un an d'historique.
  const oldest = dayOffset(today, -KEEP_DAYS);
  for (const key of Object.keys(days)) if (key < oldest) delete days[key];
  return true;
}

// Résumé affiché en haut du Lab.
export function summarize(data, today) {
  const days = data.days || {};
  const since7 = dayOffset(today, -6);
  const since30 = dayOffset(today, -29);
  let visits7 = 0;
  let visits30 = 0;
  let visitsTotal = 0;
  const opens30 = {};
  for (const [key, day] of Object.entries(days)) {
    const visits = Number(day.visits) || 0;
    visitsTotal += visits;
    if (key >= since30 && key <= today) {
      visits30 += visits;
      if (key >= since7) visits7 += visits;
      for (const [app, count] of Object.entries(day.apps || {})) {
        opens30[app] = (opens30[app] || 0) + (Number(count) || 0);
      }
    }
  }
  const top = Object.entries(opens30).sort((a, b) => b[1] - a[1])[0];
  return {
    visitsToday: Number(days[today]?.visits) || 0,
    visits7,
    visits30,
    visitsTotal,
    topApp: top ? { name: top[0], opens: top[1] } : null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = storageToken();
  if (!token) {
    return res.status(503).json({ error: NO_STORAGE_MESSAGE });
  }
  try {
    const today = parisDay();
    const data = await readJson(FILE, token, { days: {} });
    if (req.method === "POST") {
      const body = parseBody(req);
      if (!applyEvent(data, body, today)) return res.status(400).json({ error: "Événement inconnu." });
      await writeJson(FILE, data, token);
    } else if (req.method !== "GET") {
      return res.status(405).json({ error: "Méthode non autorisée." });
    }
    return res.status(200).json(summarize(data, today));
  } catch (error) {
    console.error("Lab stats error:", error);
    // Le détail aide à dépanner ; il ne contient ni jeton ni donnée.
    return res.status(500).json({ error: `Le stockage a répondu par une erreur : ${storageErrorDetail(error)}` });
  }
}
