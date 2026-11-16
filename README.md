# Planning ménage · studio La Grande Motte

Page pour l'agent de ménage : prochain ménage, réservations à venir, calendrier sur 2 mois.

- `index.html` : la page (à ouvrir sur téléphone, installable sur l'écran d'accueil).
- `scripts/menage-airbnb.mjs` + `.github/workflows/menage.yml` : toutes les heures, le robot lit le calendrier iCal Airbnb et écrit `data/menage.json` (dates de séjour uniquement, aucune donnée voyageur).
- Le lien iCal Airbnb est stocké dans le secret `AIRBNB_ICAL_URL` du dépôt (Settings → Secrets and variables → Actions). Il n'apparaît ni dans le code ni dans la page.
