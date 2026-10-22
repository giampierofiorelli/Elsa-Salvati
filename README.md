# Blooming – Studio di psicologia e coaching (Bologna)

Sito dello studio associato Blooming, con **agenda proprietaria** e **prenotazione online del primo colloquio** con conferma immediata.

Due servizi: **psicoterapia individuale** (sostegno alla genitorialità, ansia, depressione) e **business coaching e lavoro** (cambio di lavoro, difficoltà e stress sul lavoro, mobbing, consulenza per le imprese). Servizi, team e tariffe sono in `src/site.config.json`. Chi prenota sceglie il servizio; per ora l'agenda è unica per lo studio (agende separate per professionista: passo successivo).

- Sito statico, mobile-first, palette *Deep Teal & Mint*, ispirazione [Q Psychology](https://www.qpsychology.com.au/).
- Nessun cookie di profilazione, nessun tracciamento, font ospitati sul sito (nessun dato a Google).
- Agenda unica: prenotazioni dal sito, appuntamenti inseriti a mano, sedute ricorrenti, blocchi e ferie.
- Hosting gratuito su **Netlify**; database **Supabase** (PostgreSQL) in regione UE, piano gratuito.

## Cosa fa

| Per i pazienti | Per lo studio (`/admin/`) |
|---|---|
| Vede solo gli orari realmente liberi (studio / online) | Vista settimanale e a elenco, anche da telefono |
| Prenota in meno di un minuto: solo nome ed email | Aggiunge sedute, anche ricorrenti (ogni N settimane) |
| Riceve conferma e promemoria via email, senza dati clinici | Sposta o annulla un singolo incontro o la serie |
| Annulla o sposta da un link personale | Blocca ore, giornate o ferie |
| Se non trova un orario, chiede di essere ricontattato | Imposta le fasce orarie prenotabili online |
| | Riceve le richieste di ricontatto |
| | Calendario sul telefono (feed iCal con titoli neutri) |
| | Scarica una copia di sicurezza dell'agenda |

### Garanzie tecniche

- **Niente doppie prenotazioni**: il database rifiuta due appuntamenti sovrapposti anche se confermati nello stesso istante (vincolo di esclusione PostgreSQL + lock transazionale; testato con prenotazioni simultanee).
- La disponibilità viene **ricontrollata al momento della conferma**, non solo quando si mostra l'orario.
- Nome, email, telefono e note sono **cifrati** (AES-256-GCM) prima di essere salvati.
- Accesso all'agenda con **password + codice dell'app di autenticazione** (2FA), sessione di 8 ore, blocco dopo tentativi falliti.
- **Cancellazione automatica** dei recapiti dopo il periodo impostato (predefinito 24 mesi; richieste di ricontatto 6 mesi).
- Il sito non chiede mai il motivo della richiesta.

## Prima della pubblicazione

1. **Dati reali**: completa `src/site.config.json` (titolo esatto, Ordine e n. Albo, città, indirizzo, tariffe, contatti, formazione). `npm run build` elenca i segnaposto `[...]` rimasti.
2. **Testi**: le pagine in `src/pages/` contengono riquadri gialli “da completare”; vanno scritti con la dott.ssa e poi rimossi. Mantenere solo le aree di intervento realmente trattate.
3. **Fotografie**: ritratto e foto dello studio autentiche al posto delle illustrazioni.
4. **Privacy**: far verificare a un consulente l'informativa (`src/pages/privacy.html`), i contratti con i fornitori (Netlify, Supabase, provider email) ed eventualmente la DPIA.

## Messa online (circa 30 minuti, tutto gratuito)

1. **Database** – crea un progetto su [supabase.com](https://supabase.com) scegliendo una **regione UE** (es. Frankfurt). Da *Connect → Transaction pooler* copia la stringa di connessione. Poi nell'SQL editor incolla ed esegui `db/schema.sql` (oppure `DATABASE_URL=... npm run db:setup`).
2. **Segreti** – sul tuo computer: `npm install && npm run setup:secrets`. Scegli la password dell'agenda; lo script stampa le variabili e la chiave da aggiungere all'app di autenticazione (Google Authenticator, Aegis, 1Password…). **Conserva `DATA_KEY` in un gestore di password**: senza, i recapiti non sono più leggibili.
3. **Email** (facoltativo ma consigliato) – crea un account [Brevo](https://www.brevo.com) (server in Francia, 300 email/giorno gratis), verifica il dominio mittente e crea una chiave API.
4. **Netlify** – *Add new site → Import from GitHub* → questo repository. Il build è già configurato (`netlify.toml`). In *Site configuration → Environment variables* aggiungi:

   | Variabile | Valore |
   |---|---|
   | `DATABASE_URL` | stringa di Supabase (pooler, porta 6543) |
   | `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `SESSION_SECRET`, `DATA_KEY`, `ICAL_TOKEN` | dallo script del passo 2 |
   | `SITE_URL` | es. `https://www.elsasalvati.it` |
   | `NOTIFY_EMAIL` | email dove ricevere gli avvisi di nuove prenotazioni |
   | `EMAIL_PROVIDER` | `brevo` (oppure `resend`) |
   | `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | dal provider email |
   | `ICS_INCLUDE_INITIALS` | facoltativo: `true` per mostrare le iniziali nel calendario del telefono |

   Note pratiche:
   - sul piano gratuito di Netlify le variabili vanno create con ambito **“All scopes”** (l'ambito “solo funzioni” è a pagamento e non viene salvato);
   - l'indirizzo del pooler di Supabase va copiato esattamente dal pannello (*Connect*): per alcuni progetti è `aws-0-…`, per altri `aws-1-…`. Con quello sbagliato l'errore è “tenant/user not found”;
   - per una diagnosi temporanea si può impostare `DEBUG_ERRORS=true`: l'API mostra la causa tecnica degli errori. Va rimossa subito dopo.

5. Apri `https://<sito>/admin/`, accedi, imposta **Orari** (fasce prenotabili online) e **Impostazioni** (durate, anticipo minimo, cancellazione).
6. Su Google Business Profile collega il link `https://<sito>/prenota/`.

## Sviluppo

```bash
npm install
npm run build                         # genera dist/
npm test                              # richiede PostgreSQL locale (TEST_DATABASE_URL)
DATABASE_URL=postgres://... DATABASE_SSL=disable node scripts/dev-server.mjs --demo   # anteprima su http://localhost:8888
```

L'anteprima locale crea dati dimostrativi e stampa password e codice di accesso per provare l'agenda.

### Struttura

```
src/site.config.json   dati della professionista (unica fonte)
src/pages/             pagine del sito (HTML + front matter)
src/assets/            CSS, JS, font
src/admin/             agenda (area riservata)
lib/                   logica: orari, prenotazione, cifratura, API, email
netlify/functions/     API pubblica, API agenda, feed calendario, promemoria e pulizia programmati
db/schema.sql          tabelle PostgreSQL
tests/                 test (unità + flussi completi su database reale)
```

## Scelte fatte e motivazioni

- **Agenda proprietaria invece di Calendly**: i termini di Calendly escludono i dati di categorie particolari (salute); un sistema proprio permette di decidere quali dati raccogliere, dove e per quanto tempo.
- **Conferma immediata** del primo colloquio solo nelle fasce marcate come prenotabili online: il resto dell'agenda resta riservato ai pazienti già seguiti.
- **WhatsApp solo come link** per domande pratiche, senza automazioni né chatbot (prima versione).
- Annullamento/spostamento autonomo fino a N ore prima (predefinito 24) e sempre entro un'ora dalla prenotazione.
- I costi di hosting sono nulli, ma restano manutenzione, aggiornamenti e sicurezza.
