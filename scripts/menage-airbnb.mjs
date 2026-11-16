// Robot ménage — studio La Grande Motte
// Lit le calendrier iCal Airbnb (secret AIRBNB_ICAL_URL, jamais écrit dans le dépôt)
// et écrit data/menage.json : uniquement les dates de séjour (aucune donnée voyageur).
import fs from "node:fs";

const URL_ICAL = process.env.AIRBNB_ICAL_URL;
const OUT = "data/menage.json";
const OUT_ICS = "menage.ics";
const REFRESH_H = 6; // réécrit le fichier au moins toutes les 6 h (preuve que la synchro tourne)

export function parseIcs(txt) {
  const lines = txt.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = []; let ev = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT") { if (ev) events.push(ev); ev = null; }
    else if (ev) {
      const i = l.indexOf(":"); if (i < 0) continue;
      const key = l.slice(0, i).split(";")[0].toUpperCase(), val = l.slice(i + 1);
      if (key === "DTSTART" || key === "DTEND") { const m = val.match(/^(\d{4})(\d{2})(\d{2})/); if (m) ev[key] = `${m[1]}-${m[2]}-${m[3]}`; }
      else if (key === "SUMMARY") ev.SUMMARY = val.trim();
    }
  }
  return events;
}

const nights = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export function buildStays(events, todayIso) {
  const limit = new Date(Date.parse(todayIso) - 30 * 864e5).toISOString().slice(0, 10);
  return events
    .filter(e => e.DTSTART && e.DTEND && !/not available|indisponible|blocked|bloqu/i.test(e.SUMMARY || ""))
    .filter(e => e.DTEND >= limit)
    .map(e => ({ arrivee: e.DTSTART, depart: e.DTEND, nuits: nights(e.DTSTART, e.DTEND) }))
    .sort((a, b) => a.arrivee.localeCompare(b.arrivee));
}

// Flux agenda (abonnement téléphone) : un événement « ménage » par départ de voyageurs
const frDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const icsDay = iso => iso.replace(/-/g, "");
const nextDay = iso => new Date(Date.parse(iso + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
const esc = t => t.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\;").replace(/\n/g, "\\n");
const kitText = n => [["capsules de café", 2], ["madeleines", 2], ...(n >= 3 ? [["compotes", 2]] : []), ...(n >= 5 ? [["briques de jus (orange + pomme)", 2]] : []),
  ...(n >= 7 ? [["Coca petit format", 2], ["paquet de chips", 1]] : [])].map(([x, q]) => `${q} ${x}`).join(", ");
export function menageEvent(s, stays, stamp, alarm) {
  const next = stays.find(n => n.arrivee >= s.depart && n !== s);
  const same = next && next.arrivee === s.depart;
  const summary = same ? "🧹 Ménage studio LGM · arrivée 16h le jour même" : "🧹 Ménage studio La Grande Motte";
  const desc = `Départ des voyageurs après ${s.nuits} nuit${s.nuits > 1 ? "s" : ""}.\n` +
    (next ? (same ? "Nouveaux voyageurs le jour même : studio prêt pour 16h." : `Prochaine arrivée : ${frDate(next.arrivee)} à 16h.`) + `\nPanier d'accueil (${next.nuits} nuit${next.nuits > 1 ? "s" : ""}) : ${kitText(next.nuits)}.` : "Aucune arrivée prévue après pour l'instant.") +
    "\nPlanning : https://florianunac.github.io/menage-grande-motte/";
  return ["BEGIN:VEVENT", `UID:menage-${icsDay(s.arrivee)}-${icsDay(s.depart)}@menage-grande-motte`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDay(s.depart)}`, `DTEND;VALUE=DATE:${icsDay(nextDay(s.depart))}`,
    `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(desc)}`, "TRANSP:TRANSPARENT",
    ...(alarm ? ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Ménage demain", "TRIGGER:-PT6H", "END:VALARM"] : []),
    "END:VEVENT"];
}
export function buildIcs(stays) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//menage-grande-motte//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Ménage studio La Grande Motte", "X-WR-TIMEZONE:Europe/Paris", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ...stays.flatMap(s => menageEvent(s, stays, stamp, false)), "END:VCALENDAR"];
  return lines.map(l => l.length > 74 ? l.match(/.{1,73}/gu).join("\r\n ") : l).join("\r\n") + "\r\n";
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (!URL_ICAL) { console.log("Secret AIRBNB_ICAL_URL pas encore renseigné : rien à faire."); process.exit(0); }
  const res = await fetch(URL_ICAL, { headers: { "User-Agent": "Mozilla/5.0 (robot menage)" } });
  if (!res.ok) { console.error("Airbnb a répondu " + res.status); process.exit(1); }
  const txt = await res.text();
  if (!txt.includes("BEGIN:VCALENDAR")) { console.error("Réponse Airbnb inattendue (pas un calendrier)"); process.exit(1); }
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const sejours = buildStays(parseIcs(txt), today);

  let old = null; try { old = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  const same = old && JSON.stringify(old.sejours) === JSON.stringify(sejours);
  const fresh = old && Date.now() - Date.parse(old.verifie) < REFRESH_H * 3600e3;
  if (!fs.existsSync(OUT_ICS) || !same) fs.writeFileSync(OUT_ICS, buildIcs(sejours));
  if (same && fresh) { console.log("Aucun changement."); process.exit(0); }
  const now = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify({ verifie: now, modifie: same ? old.modifie : now, sejours }, null, 1) + "\n");
  console.log(`${sejours.length} séjour(s) écrits.`);
}
