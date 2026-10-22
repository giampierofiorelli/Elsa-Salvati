# Blooming – Studio di psicologia e coaching (Bologna)

Sito dello studio associato Blooming con **prenotazione online del primo colloquio** (conferma immediata) e **agenda per ogni professionista**.

## Come è organizzato

- **Tre aree**: Coaching, Psicologia, Psicoterapia. Ogni area contiene **servizi** (es. “Business coaching individuale”, “Sostegno alla genitorialità”, “Psicoterapia individuale”), ognuno con durata, tariffa e descrizione.
- **Professionisti**: ognuno offre uno o più servizi, e per ogni servizio sceglie se lavorare **in studio**, **online** o entrambi. Ha i propri orari e la propria agenda.
- **Prenotazione**: chi visita il sito sceglie area → servizio → professionista (se ce n'è uno solo è già selezionato, ma viene sempre mostrato chi è) → modalità disponibili per quel professionista → giorno e ora.
- **Area riservata** (`/admin/`):
  - **professionista**: vede e modifica solo la propria agenda, i propri orari, il proprio profilo e le modalità dei propri servizi;
  - **amministratore**: gestisce servizi, professionisti e account, e vede tutte le agende (filtro “Agenda di”).
- **Accesso**: email + password + codice di un'app di autenticazione. L'amministratore crea l'account e ottiene un **link di attivazione** (valido 7 giorni, utilizzabile una volta); chi lo apre sceglie la password e collega l'app **inquadrando un QR code** (o toccando “Aggiungi all'app” dal telefono).

Servizi e professionisti stanno nel database: le prenotazioni li usano subito; le pagine del sito (Servizi, Team) si rigenerano a ogni pubblicazione o con il pulsante “Aggiorna le pagine del sito” (richiede `BUILD_HOOK_URL`, un *build hook* creato su Netlify in *Site configuration → Build & deploy → Build hooks*).

### Garanzie tecniche

- **Niente doppie prenotazioni per lo stesso professionista**: il database rifiuta impegni sovrapposti dello stesso professionista anche se confermati nello stesso istante (vincolo di esclusione PostgreSQL con `btree_gist` + lock transazionale). Professionisti diversi possono avere appuntamenti alla stessa ora.
- La disponibilità viene **ricontrollata alla conferma**; la durata dello slot è quella del servizio.
- Nome, email, telefono e note dei pazienti sono **cifrati** (AES-256-GCM); anche il segreto dell'app di autenticazione è cifrato.
- Ogni codice dell'app vale una sola volta; blocco dopo tentativi falliti; sessione di 8 ore; un account disattivato perde subito l'accesso.
- **Cancellazione automatica** dei recapiti dopo il periodo impostato. Il sito non chiede mai il motivo della richiesta.

## Prima della pubblicazione

1. **Dati reali**: completa `src/site.config.json` (titolo esatto, Ordine e n. Albo, città, indirizzo, tariffe, contatti, formazione). `npm run build` elenca i segnaposto `[...]` rimasti.
2. **Testi**: le pagine in `src/pages/` contengono riquadri gialli “da completare”; vanno scritti con la dott.ssa e poi rimossi. Mantenere solo le aree di intervento realmente trattate.
3. **Fotografie**: ritratto e foto dello studio autentiche al posto delle illustrazioni.
4. **Privacy**: far verificare a un consulente l'informativa (`src/pages/privacy.html`), i contratti con i fornitori (Netlify, Supabase, provider email) ed eventualmente la DPIA.

## Messa online (circa 30 minuti, tutto gratuito)

1. **Database** – crea un progetto su [supabase.com](https://supabase.com) scegliendo una **regione UE** (es. Frankfurt). Da *Connect → Session pooler* copia la stringa di connessione (porta 5432). Poi nell'SQL editor incolla ed esegui `db/schema.sql` (oppure `DATABASE_URL=... npm run db:setup`).
2. **Segreti** – sul tuo computer: `npm install && npm run setup:secrets`. Scegli la password dell'agenda; lo script stampa le variabili e la chiave da aggiungere all'app di autenticazione (Google Authenticator, Aegis, 1Password…). **Conserva `DATA_KEY` in un gestore di password**: senza, i recapiti non sono più leggibili.
3. **Email** (facoltativo ma consigliato) – crea un account [Brevo](https://www.brevo.com) (server in Francia, 300 email/giorno gratis), verifica il dominio mittente e crea una chiave API.
4. **Netlify** – *Add new site → Import from GitHub* → questo repository. Il build è già configurato (`netlify.toml`). In *Site configuration → Environment variables* aggiungi:

   | Variabile | Valore |
   |---|---|
   | `DATABASE_URL` | stringa di Supabase (session pooler, porta 5432; con il transaction pooler, porta 6543, le richieste dalle funzioni Netlify restavano appese) |
   | `SESSION_SECRET`, `DATA_KEY` | dallo script del passo 2 |
   | `BUILD_HOOK_URL` | facoltativo: build hook di Netlify per il pulsante “Aggiorna le pagine del sito” |
   | `SITE_URL` | es. `https://www.elsasalvati.it` |
   | `NOTIFY_EMAIL` | email dove ricevere gli avvisi di nuove prenotazioni |
   | `EMAIL_PROVIDER` | `brevo` (oppure `resend`) |
   | `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | dal provider email |
   | `ICS_INCLUDE_INITIALS` | facoltativo: `true` per mostrare le iniziali nel calendario del telefono |

   Note pratiche:
   - sul piano gratuito di Netlify le variabili vanno create con ambito **“All scopes”** (l'ambito “solo funzioni” è a pagamento e non viene salvato);
   - l'indirizzo del pooler di Supabase va copiato esattamente dal pannello (*Connect*): per alcuni progetti è `aws-0-…`, per altri `aws-1-…`. Con quello sbagliato l'errore è “tenant/user not found”;
   - per una diagnosi temporanea si può impostare `DEBUG_ERRORS=true`: l'API mostra la causa tecnica degli errori. Va rimossa subito dopo.

5. Crea il primo amministratore: `DATABASE_URL=... SITE_URL=https://<sito> node scripts/create-admin.mjs email@esempio.it "Nome Cognome"` e apri il link stampato per attivare l'accesso.
6. Nell'area riservata: crea i **servizi**, i **professionisti** (con servizi e modalità) e i loro **account**; ogni professionista imposta i propri **orari**.
7. Su Google Business Profile collega il link `https://<sito>/prenota/`.

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
