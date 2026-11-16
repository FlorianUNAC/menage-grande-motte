// Robot ménage — studio La Grande Motte
// Lit le calendrier iCal Airbnb (secret AIRBNB_ICAL_URL, jamais écrit dans le dépôt)
// et écrit data/menage.json : uniquement les dates de séjour (aucune donnée voyageur).
import fs from "node:fs";

const URL_ICAL = process.env.AIRBNB_ICAL_URL;
const OUT = "data/menage.json";
const OUT_ICS = "menage.ics";
const SHEET_CSV = "https://docs.google.com/spreadsheets/d/1yAR3ifZcAqqP0BBP0jMvT9ny2COKeOmRHIxKUhGb9eE/gviz/tq?tqx=out:csv&sheet=Demandes";
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

// Demandes voyageurs (Google Sheet de Florian)
export function parseCsv(txt) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && txt[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
export function normDem(rows) {
  const out = [];
  rows.slice(1).forEach(r => {
    let [dt, ty, hr, note] = r.map(x => (x || "").trim());
    let m = dt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/), iso = null;
    if (m) iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    else if ((m = dt.match(/^(\d{4})-(\d{2})-(\d{2})/))) iso = m[0];
    const t = /tard/i.test(ty) ? "tardif" : /anticip/i.test(ty) ? "anticipee" : /bagage/i.test(ty) ? "bagages" : null;
    if (!iso || !t) return;
    const hm = hr.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
    const heure = hm ? `${+hm[1]}h${hm[2] && hm[2] !== "00" ? hm[2] : ""}` : "";
    out.push({ date: iso, type: t, heure, note: note || "" });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
let DEM = [];
const demOn = (date, type) => DEM.find(x => x.date === date && x.type === type);
const arrHeure = s => { const a = s && demOn(s.arrivee, "anticipee"); return a && a.heure ? a.heure : "16h"; };
function demText(x) {
  const h = x.heure;
  const t = x.type === "tardif" ? (h ? `Départ tardif : voyageurs présents jusqu'à ${h}` : "Départ tardif accordé")
    : x.type === "anticipee" ? (h ? `Arrivée anticipée : studio prêt pour ${h}` : "Arrivée anticipée")
    : (h ? `Dépose bagages à ${h}` : "Dépose bagages");
  return t + (x.note ? ` (${x.note})` : "");
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
  const tard = demOn(s.depart, "tardif");
  const summary = same ? `🧹 Ménage studio LGM · arrivée ${arrHeure(next)} le jour même` : "🧹 Ménage studio La Grande Motte" + (tard && tard.heure ? ` · départ ${tard.heure}` : "");
  const desc = `Départ des voyageurs après ${s.nuits} nuit${s.nuits > 1 ? "s" : ""}.\n` +
    (next ? (same ? `Nouveaux voyageurs le jour même : studio prêt pour ${arrHeure(next)}.` : `Prochaine arrivée : ${frDate(next.arrivee)} à ${arrHeure(next)}.`) + `\nPanier d'accueil (${next.nuits} nuit${next.nuits > 1 ? "s" : ""}) : ${kitText(next.nuits)}.` : "Aucune arrivée prévue après pour l'instant.") +
    [tard, next && demOn(next.arrivee, "anticipee"), next && demOn(next.arrivee, "bagages")].filter(Boolean).map(x => "\n" + demText(x)).join("") +
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
  return lines.map(fold).join("\r\n") + "\r\n";
}
// Pliage RFC 5545 : 75 octets max par ligne, sans couper un caractère
function fold(l) {
  const out = []; let cur = "", n = 0, lim = 75;
  for (const ch of l) { const b = Buffer.byteLength(ch); if (n + b > lim) { out.push(cur); cur = ""; n = 0; lim = 74; } cur += ch; n += b; }
  out.push(cur); return out.join("\r\n ");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (!URL_ICAL) { console.log("Secret AIRBNB_ICAL_URL pas encore renseigné : rien à faire."); process.exit(0); }
  const res = await fetch(URL_ICAL, { headers: { "User-Agent": "Mozilla/5.0 (robot menage)" } });
  if (!res.ok) { console.error("Airbnb a répondu " + res.status); process.exit(1); }
  const txt = await res.text();
  if (!txt.includes("BEGIN:VCALENDAR")) { console.error("Réponse Airbnb inattendue (pas un calendrier)"); process.exit(1); }
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const sejours = buildStays(parseIcs(txt), today);
  try { const r2 = await fetch(SHEET_CSV + "&t=" + Date.now()); const c = await r2.text(); if (r2.ok && c.startsWith('"Date"')) DEM = normDem(parseCsv(c)).filter(x => x.date >= today); }
  catch (e) { console.log("Demandes voyageurs indisponibles : " + e.message); }

  let old = null; try { old = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  const same = old && JSON.stringify(old.sejours) === JSON.stringify(sejours) && JSON.stringify(old.demandes || []) === JSON.stringify(DEM);
  const fresh = old && Date.now() - Date.parse(old.verifie) < REFRESH_H * 3600e3;
  if (!fs.existsSync(OUT_ICS) || !same) fs.writeFileSync(OUT_ICS, buildIcs(sejours));
  if (same && fresh) { console.log("Aucun changement."); process.exit(0); }
  const now = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify({ verifie: now, modifie: same ? old.modifie : now, sejours, demandes: DEM }, null, 1) + "\n");
  console.log(`${sejours.length} séjour(s) écrits.`);
}
