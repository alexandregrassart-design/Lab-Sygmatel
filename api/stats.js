import { put, get } from "@vercel/blob";

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

async function readStats() {
  const result = await get(FILE, { access: "private", useCache: false });
  if (!result) return { days: {} };
  if (result.statusCode !== 200 || !result.stream) throw new Error("Lecture des compteurs impossible.");
  const data = JSON.parse(await new Response(result.stream).text());
  return data && typeof data === "object" ? data : { days: {} };
}

async function writeStats(data) {
  await put(FILE, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    allowOverwrite: true,
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: "Le stockage des compteurs n'est pas encore créé sur Vercel." });
  }
  try {
    const today = parisDay();
    const data = await readStats();
    if (req.method === "POST") {
      // sendBeacon envoie le corps en texte : on accepte les deux formes.
      let body = req.body || {};
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (e) {
          body = {};
        }
      }
      if (!applyEvent(data, body, today)) return res.status(400).json({ error: "Événement inconnu." });
      await writeStats(data);
    } else if (req.method !== "GET") {
      return res.status(405).json({ error: "Méthode non autorisée." });
    }
    return res.status(200).json(summarize(data, today));
  } catch (error) {
    console.error("Lab stats error:", error);
    return res.status(500).json({ error: "Compteurs indisponibles." });
  }
}
