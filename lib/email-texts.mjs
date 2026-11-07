// The texts of every automatic email, editable from the admin («Sito › Testi delle email»).
// The defaults live here, in code. The database only holds overrides (table email_texts): an override
// that no longer passes the checks below is ignored and the default is sent instead.
//
// A text has a subject, a body and, when the email has a main link, the label of its button.
// The body is rich text with bold and italic only ({ p: [[{ t, b?, i? }]] }, see richtext.mjs).
// Placeholders are written {nome}. With a capital letter ({Professionista}) the value starts with a capital.
// "Block" placeholders ({dettagli}, {tariffa}, {link}, {elenco}) stand alone in their paragraph.
// Rules from the decisions: neutral subjects ("… – Blooming", added here), no clinical information,
// one main link per email, prices only where they are today ({tariffa}).

import { cleanRich, escapeHtml } from './richtext.mjs';

export const VARS = {
  nome: 'Nome della persona',
  data: 'Data e ora',
  dettagli: 'Dettagli (quando, durata, con chi, modalità)',
  professionista: 'Nome della professionista',
  tipo: 'colloquio / appuntamento',
  tariffa: 'Tariffa',
  ore: 'Ore di preavviso per annullare',
  numero: 'Numero di appuntamenti',
  elenco: 'Elenco degli orari',
  link: 'Pulsante con il link',
};
const BLOCK = new Set(['dettagli', 'tariffa', 'link', 'elenco']);
const SUBJECT_VARS = new Set(['tipo']);
// Words that would reveal the kind of practice or a clinical matter: never in a subject.
const SUBJECT_FORBIDDEN = /psicolog|psicoterap|terapi|therap|psycholog|psychiatr|psichiatr|counsel|clinic|diagnos|ansia|anxiety|depress|sintom|symptom/i;

export const GROUPS = [
  { key: 'richiesta', label: 'Richiesta di primo colloquio dal sito' },
  { key: 'fissato', label: 'Appuntamento fissato o spostato' },
  { key: 'prima', label: 'Prima dell\'appuntamento' },
  { key: 'annullato', label: 'Annullamenti e orari liberati' },
  { key: 'studio', label: 'Avvisi alle professioniste' },
];

const P = ['nome', 'data', 'dettagli', 'professionista', 'tipo']; // every email to the person has these
const LINK_HINT = {
  manage: 'il link per gestire l\'appuntamento',
  cancel: 'il link per annullare la richiesta',
  confirm: 'il link per confermare la presenza',
  book: 'il link per scegliere un altro orario',
  admin: 'il link all\'agenda',
};

// it/en: { s: subject (without "– Blooming"), b: paragraphs, btn: button label }.
const DEFS = [
  {
    key: 'richiesta-ricevuta', group: 'richiesta', label: 'Richiesta ricevuta', when: 'Subito dopo la richiesta di primo colloquio dal sito.',
    vars: [...P, 'link'], link: 'cancel', required: ['dettagli'], kind: 'primo', proFallback: { en: 'the psychologist' },
    it: { s: 'Richiesta ricevuta', btn: 'Annulla la richiesta', b: ['Gentile {nome},', 'abbiamo ricevuto la tua richiesta di primo colloquio.', '{dettagli}', 'L\'orario resta riservato per te finché la professionista risponde: ti scriviamo appena la accetta.', '{link}'] },
    en: { s: 'Request received', btn: 'Cancel the request', b: ['Dear {nome},', 'Thank you for your request for a free first meeting.', '{dettagli}', 'We\'re holding this time for you. {Professionista} will reply by 6 pm (Italian time) the day before at the latest, and we\'ll email you as soon as she accepts. If she hasn\'t by then, the request expires and we\'ll let you know.', 'If you can\'t find our next email, please check your spam folder.', 'Changed your mind? You can cancel the request here.', '{link}'] },
  },
  {
    key: 'richiesta-accettata', group: 'richiesta', label: 'Richiesta accettata', when: 'Quando la professionista accetta la richiesta.',
    vars: [...P, 'tariffa', 'ore', 'link'], link: 'manage', required: ['dettagli'], kind: 'primo', proFallback: { en: 'the psychologist' },
    it: { s: 'Richiesta accettata', btn: 'Gestisci l\'appuntamento', b: ['Gentile {nome},', 'la professionista ha accettato la tua richiesta: il primo colloquio è fissato.', '{dettagli}', '{tariffa}', 'Due giorni prima ti chiediamo di confermare la presenza.', 'Puoi annullare o spostare il colloquio dal link qui sotto fino a {ore} ore prima.', '{link}'] },
    en: { s: 'Request accepted', btn: 'Move or cancel', b: ['Dear {nome},', '{Professionista} has accepted your request. Your free first meeting is booked:', '{dettagli}', '{tariffa}', 'About two days before, we\'ll email you to ask you to confirm you\'re coming.', 'You can move or cancel the meeting here, up to {ore} hours before.', '{link}'] },
  },
  {
    key: 'richiesta-accettata-conferma', group: 'richiesta', label: 'Richiesta accettata a ridosso del colloquio', when: 'Quando la richiesta è accettata a meno di due giorni dal colloquio: chiede anche di confermare la presenza.',
    vars: [...P, 'tariffa', 'ore', 'link'], link: 'confirm', required: ['dettagli'], kind: 'primo', proFallback: { en: 'the psychologist' },
    it: { s: 'Richiesta accettata: conferma la presenza', btn: 'Confermo', b: ['Gentile {nome},', 'la professionista ha accettato la tua richiesta: il primo colloquio è fissato.', '{dettagli}', '{tariffa}', 'Ci sarai? Conferma la presenza con un clic. Se non riesci a venire, dalla stessa pagina puoi dircelo.', '{link}'] },
    en: { s: 'Request accepted: please confirm you\'re coming', btn: 'Confirm I\'m coming', b: ['Dear {nome},', '{Professionista} has accepted your request. Your free first meeting is booked:', '{dettagli}', '{tariffa}', 'As it\'s soon, please let us know now that you\'re coming.', 'The same page lets you move or cancel the meeting up to {ore} hours before, and after that has an "I can\'t make it" link.', '{link}'] },
  },
  {
    key: 'richiesta-rifiutata', group: 'richiesta', label: 'Richiesta non accettata', when: 'Quando la professionista non può in quell\'orario.',
    vars: [...P, 'link'], link: 'book', required: ['data'], kind: 'primo', proFallback: { en: 'the psychologist' },
    it: { s: 'Scegli un altro orario', btn: 'Scegli un altro orario', b: ['Gentile {nome},', 'la professionista non è disponibile nell\'orario che avevi chiesto.', 'Quando: {data}', 'Puoi sceglierne un altro dal sito.', '{link}'] },
    en: { s: 'About your request', btn: 'Choose another time', b: ['Dear {nome},', 'Thank you for your request. Unfortunately {professionista} can\'t make {data}.', 'You\'re welcome to choose another time:', '{link}'] },
  },
  {
    key: 'richiesta-scaduta', group: 'richiesta', label: 'Richiesta scaduta', when: 'Quando la professionista non risponde entro le 18 del giorno prima.',
    vars: [...P, 'link'], link: 'book', required: ['data'], kind: 'primo', proFallback: { en: 'the psychologist' },
    it: { s: 'Scegli un altro orario', btn: 'Scegli un altro orario', b: ['Gentile {nome},', 'la professionista non è riuscita a rispondere in tempo, quindi l\'orario non è più riservato.', 'Quando: {data}', 'Puoi sceglierne un altro dal sito.', '{link}'] },
    en: { s: 'About your request', btn: 'Choose another time', b: ['Dear {nome},', '{Professionista} wasn\'t able to reply to your request in time, so {data} is no longer held for you. Sorry about that.', 'You can choose another time here:', '{link}'] },
  },
  {
    key: 'fissato', group: 'fissato', label: 'Appuntamento fissato dalla professionista', when: 'Quando la professionista fissa un appuntamento dall\'agenda e la persona ha acconsentito a ricevere le email.',
    vars: [...P, 'tariffa', 'ore', 'link'], link: 'manage', required: ['dettagli'], kind: 'seduta',
    it: { s: 'Appuntamento fissato', btn: 'Gestisci l\'appuntamento', b: ['Gentile {nome},', 'la tua professionista ha fissato un {tipo}.', '{dettagli}', '{tariffa}', 'Puoi annullarlo dal link qui sotto fino a {ore} ore prima; per spostarlo scrivi alla tua professionista.', 'Due giorni prima ti chiediamo di confermare la presenza.', '{link}'] },
    en: { s: 'Your {tipo}', btn: 'Cancel', b: ['Dear {nome},', 'As you agreed, {professionista} has booked your next {tipo}:', '{dettagli}', '{tariffa}', 'If you need to cancel it, you can do it here. To move it to another time, please contact {professionista}.', 'About two days before, we\'ll email you to ask you to confirm you\'re coming.', '{link}'] },
  },
  {
    key: 'spostato-primo', group: 'fissato', label: 'Primo colloquio spostato', when: 'Quando il primo colloquio cambia orario (dalla persona o dalla professionista).',
    vars: [...P, 'ore', 'link'], link: 'manage', required: ['dettagli'], kind: 'primo',
    it: { s: 'Appuntamento spostato', btn: 'Gestisci l\'appuntamento', b: ['Gentile {nome},', 'il tuo appuntamento è stato spostato. Ecco il nuovo orario.', '{dettagli}', 'Il link qui sotto sostituisce quelli ricevuti prima.', '{link}'] },
    en: { s: 'Meeting moved', btn: 'Move or cancel', b: ['Dear {nome},', 'Your free first meeting has been moved to:', '{dettagli}', 'You can move or cancel it again here, up to {ore} hours before.', 'From now on, please use the link in this email: the links in our earlier emails no longer work.', '{link}'] },
  },
  {
    key: 'spostato-seduta', group: 'fissato', label: 'Appuntamento spostato', when: 'Quando un appuntamento dopo il primo colloquio cambia orario.',
    vars: [...P, 'ore', 'link'], link: 'manage', required: ['dettagli'], kind: 'seduta',
    it: { s: 'Appuntamento spostato', btn: 'Gestisci l\'appuntamento', b: ['Gentile {nome},', 'il tuo appuntamento è stato spostato. Ecco il nuovo orario.', '{dettagli}', 'Il link qui sotto sostituisce quelli ricevuti prima.', '{link}'] },
    en: { s: 'Session moved', btn: 'Cancel', b: ['Dear {nome},', 'Your session has been moved to:', '{dettagli}', 'From now on, please use the link in this email: the links in our earlier emails no longer work.', '{link}'] },
  },
  {
    key: 'conferma-48h', group: 'prima', label: 'Conferma la presenza (due giorni prima)', when: 'Circa 48 ore prima: chiede di confermare la presenza con un clic.',
    vars: [...P, 'ore', 'link'], link: 'confirm', required: ['dettagli'],
    it: { s: 'Conferma la presenza', btn: 'Confermo', b: ['Gentile {nome},', 'tra due giorni c\'è il nostro appuntamento: ci sarai? Basta un clic. Se non riesci a venire, dalla stessa pagina puoi dircelo.', '{dettagli}', 'Il link in questa email sostituisce quelli ricevuti prima.', '{link}'] },
    en: { s: 'Please confirm your {tipo}', btn: 'Confirm I\'m coming', b: ['Dear {nome},', 'Your {tipo} with {professionista} is coming up. Please let us know you\'re coming. One click on our website is enough.', '{dettagli}', 'If you can\'t make it, the same page has an "I can\'t make it" link, so the time can go to someone else.', 'From now on, please use the link in this email: the links in our earlier emails no longer work.', '{link}'] },
  },
  {
    key: 'conferma-24h', group: 'prima', label: 'Secondo invito a confermare (il giorno prima)', when: 'Il giorno prima, solo se la persona non ha ancora confermato.',
    vars: [...P, 'ore', 'link'], link: 'confirm', required: ['dettagli'],
    it: { s: 'Ci sarai?', btn: 'Confermo', b: ['Gentile {nome},', 'ti scriviamo di nuovo per sapere se domani ci sarai: basta un clic. Se non riesci a venire, dalla stessa pagina puoi dircelo.', '{dettagli}', 'Il link in questa email sostituisce quelli ricevuti prima.', '{link}'] },
    en: { s: 'Your {tipo} tomorrow', btn: 'Confirm I\'m coming', b: ['Dear {nome},', 'Just checking in: your {tipo} with {professionista} is tomorrow. If you\'re coming, a click here lets her know.', '{dettagli}', 'If your plans have changed, that\'s fine: use "I can\'t make it" on the same page.', 'From now on, please use the link in this email: the links in our earlier emails no longer work.', '{link}'] },
  },
  {
    key: 'promemoria', group: 'prima', label: 'Promemoria senza link', when: 'Circa 48 ore prima, per gli appuntamenti inseriti a mano senza email di gestione.',
    vars: [...P], link: null, required: ['dettagli'],
    it: { s: 'Promemoria', b: ['Gentile {nome},', 'ti ricordo il nostro appuntamento.', '{dettagli}', 'Se devi annullarlo, usa il link dell\'ultima email ricevuta oppure rispondi a questa email.'] },
    en: { s: 'Reminder', b: ['Dear {nome},', 'Just a reminder of your upcoming appointment.', '{dettagli}', 'If you need to cancel it, please use the link in our most recent email, or contact the practice.'] },
  },
  {
    key: 'promemoria-2h', group: 'prima', label: 'Promemoria poco prima', when: 'Un paio d\'ore prima di un appuntamento online. Solo informazioni, niente da cliccare.',
    vars: [...P], link: null, required: ['dettagli'],
    it: { s: 'Tra poco il tuo appuntamento', b: ['Gentile {nome},', 'ti ricordo che il nostro appuntamento è tra poco.', '{dettagli}', 'Se non riesci a esserci, rispondi a questa email o contatta lo studio.'] },
    en: { s: 'See you soon', b: ['Dear {nome},', 'Just a reminder that your {tipo} with {professionista} is today, online, by video call.', '{dettagli}', 'If you can\'t make it, please call or message us.'] },
  },
  {
    key: 'annullato-richiesta', group: 'annullato', label: 'Richiesta annullata dalla persona', when: 'Quando la persona annulla una richiesta non ancora accettata.',
    vars: [...P, 'link'], link: 'book', required: ['data'], kind: 'primo',
    it: { s: 'Appuntamento annullato', btn: 'Prenota un altro orario', b: ['Gentile {nome},', 'la tua richiesta di {data} è annullata, come ci hai chiesto.', 'Se vuoi, puoi prenotare un altro orario dal sito.', '{link}'] },
    en: { s: 'Your request', btn: 'Choose another time', b: ['Dear {nome},', 'You\'ve cancelled your request for {data}. The time is free again.', 'If you\'d like another time, you can choose one here:', '{link}'] },
  },
  {
    key: 'annullato-primo', group: 'annullato', label: 'Primo colloquio annullato dalla persona', when: 'Quando la persona annulla il primo colloquio dal link.',
    vars: [...P, 'link'], link: 'book', required: ['data'], kind: 'primo',
    it: { s: 'Appuntamento annullato', btn: 'Prenota un altro orario', b: ['Gentile {nome},', 'l\'appuntamento di {data} è annullato, come ci hai chiesto.', 'Se vuoi, puoi prenotare un altro orario dal sito.', '{link}'] },
    en: { s: 'Cancelled', btn: 'Choose another time', b: ['Dear {nome},', 'Your {tipo} on {data} has been cancelled, as you asked.', 'If you\'d like another time, you can choose one here:', '{link}'] },
  },
  {
    key: 'annullato-seduta', group: 'annullato', label: 'Appuntamento annullato dalla persona', when: 'Quando la persona annulla un appuntamento successivo dal link. Il pulsante per prenotare è facoltativo.',
    vars: [...P, 'link'], link: 'book', linkOptional: true, required: ['data'], kind: 'seduta',
    it: { s: 'Appuntamento annullato', btn: 'Prenota un altro orario', b: ['Gentile {nome},', 'l\'appuntamento di {data} è annullato, come ci hai chiesto.', 'Se vuoi, puoi prenotare un altro orario dal sito.', '{link}'] },
    en: { s: 'Cancelled', btn: 'Choose another time', b: ['Dear {nome},', 'Your {tipo} on {data} has been cancelled, as you asked.', 'For a new time, please contact {professionista}.'] },
  },
  {
    key: 'annullato-studio-primo', group: 'annullato', label: 'Primo colloquio annullato dalla professionista', when: 'Quando la professionista annulla il primo colloquio, con cosa fare dopo.',
    vars: [...P, 'link'], link: 'book', required: ['data'], kind: 'primo',
    it: { s: 'Appuntamento annullato', btn: 'Scegli un altro orario', b: ['Gentile {nome},', 'la professionista ha dovuto annullare l\'appuntamento di {data}. Ci dispiace.', 'Per fissare un altro orario rispondi a questa email o contatta lo studio. Se vuoi, puoi prenotare un altro orario dal sito.', '{link}'] },
    en: { s: 'About your {tipo}', btn: 'Choose another time', b: ['Dear {nome},', '{Professionista} has cancelled your {tipo} on {data}.', 'If you\'d like another time, you can choose one here:', '{link}'] },
  },
  {
    key: 'annullato-studio-seduta', group: 'annullato', label: 'Appuntamento annullato dalla professionista', when: 'Quando la professionista annulla un appuntamento successivo, con cosa fare dopo.',
    vars: [...P], link: null, required: ['data'], kind: 'seduta',
    it: { s: 'Appuntamento annullato', b: ['Gentile {nome},', 'la professionista ha dovuto annullare l\'appuntamento di {data}. Ci dispiace.', 'Per fissare un altro orario rispondi a questa email o contatta lo studio.'] },
    en: { s: 'About your {tipo}', b: ['Dear {nome},', '{Professionista} has cancelled your {tipo} on {data}.', 'Please contact {professionista} for a new time.'] },
  },
  {
    key: 'liberato-primo', group: 'annullato', label: 'Primo colloquio liberato (presenza non confermata)', when: 'Quando la professionista libera l\'orario perché la persona non ha confermato, con cosa fare se è un errore.',
    vars: [...P, 'link'], link: 'book', required: ['data'], kind: 'primo',
    it: { s: 'Appuntamento annullato', btn: 'Scegli un altro orario', b: ['Gentile {nome},', 'non avendo ricevuto la tua conferma, l\'orario di {data} è stato liberato.', 'Se non avevi confermato per errore e vuoi venire, rispondi a questa email o chiamaci: se l\'orario è ancora libero lo rimettiamo per te. Altrimenti puoi sceglierne un altro dal sito.', '{link}'] },
    en: { s: 'About your {tipo}', btn: 'Choose another time', b: ['Dear {nome},', 'We hadn\'t heard back from you about your {tipo} on {data}, so the time has been freed.', 'If that was a mistake and you\'d like to come, please call us: if the time is still free, we\'ll put it back for you. If it isn\'t, or you\'d rather change it, you can choose another time here:', '{link}'] },
  },
  {
    key: 'liberato-seduta', group: 'annullato', label: 'Appuntamento liberato (presenza non confermata)', when: 'Come sopra, per un appuntamento successivo al primo colloquio.',
    vars: [...P], link: null, required: ['data'], kind: 'seduta',
    it: { s: 'Appuntamento annullato', b: ['Gentile {nome},', 'non avendo ricevuto la tua conferma, l\'orario di {data} è stato liberato.', 'Se non avevi confermato per errore e vuoi venire, rispondi a questa email o scrivi alla tua professionista: se l\'orario è ancora libero lo rimette per te, altrimenti ne fissate un altro.'] },
    en: { s: 'About your {tipo}', b: ['Dear {nome},', 'We hadn\'t heard back from you about your {tipo} on {data}, so the time has been freed.', 'If that was a mistake and you\'d like to come, please call us: if the time is still free, we\'ll put it back for you. If it isn\'t, please contact {professionista} for a new time.'] },
  },
  // To the professionals: Italian only, no personal data, only day, time and a pointer to the protected agenda.
  ...[
    ['studio-richiesta', 'Nuova richiesta da accettare', 'Quando arriva una richiesta di primo colloquio per lei.', 'Nuova richiesta da accettare', ['C\'è una nuova richiesta di primo colloquio per {data}.', 'Accettala o rifiutala dall\'agenda entro le 18 del giorno prima: dopo decade da sola.']],
    ['studio-richiesta-assegnata', 'Nuova richiesta assegnata in automatico', 'Quando la persona ha scelto «Aiutami a scegliere» e la richiesta è stata assegnata a lei.', 'Nuova richiesta da accettare', ['C\'è una nuova richiesta di primo colloquio per {data}.', 'Accettala o rifiutala dall\'agenda entro le 18 del giorno prima: dopo decade da sola.', 'Ti è stata assegnata in automatico. Se è meglio la collega, usa «Passa alla collega».']],
    ['studio-passata', '«Passa alla collega»', 'Quando una collega le passa una richiesta.', 'Richiesta passata a te', ['La collega ti ha passato una richiesta di primo colloquio per {data}.', 'Accettala o rifiutala dall\'agenda entro le 18 del giorno prima.']],
    ['studio-scaduta', 'Richiesta decaduta', 'Quando una richiesta scade senza risposta.', 'Richiesta decaduta', ['La richiesta di primo colloquio per {data} è decaduta senza risposta: l\'orario è di nuovo libero e la persona ha ricevuto un\'email.']],
    ['studio-prenotato', 'Nuovo appuntamento dal sito', 'Quando un appuntamento è prenotato dal sito senza bisogno di accettarlo.', 'Nuovo appuntamento dal sito', ['C\'è un nuovo appuntamento per {data}.', 'I dettagli sono nell\'agenda.']],
    ['studio-confermato', 'Presenza confermata', 'Quando la persona conferma la presenza.', 'Un appuntamento è cambiato', ['Un appuntamento di {data} è stato confermato dalla persona.', 'I dettagli sono nell\'agenda.']],
    ['studio-annullato', 'Annullato dalla persona', 'Quando la persona annulla dal link.', 'Un appuntamento è cambiato', ['Un appuntamento di {data} è stato annullato dalla persona.', 'I dettagli sono nell\'agenda.']],
    ['studio-annullato-tardi', 'Annullato all\'ultimo momento', 'Quando la persona annulla dopo il termine per annullare («Non riesco a venire»).', 'Un appuntamento è cambiato', ['Un appuntamento di {data} è stato annullato all\'ultimo momento.', 'I dettagli sono nell\'agenda.']],
    ['studio-spostato', 'Spostato dalla persona', 'Quando la persona sposta il primo colloquio dal link.', 'Un appuntamento è cambiato', ['Un appuntamento di {data} è stato spostato dalla persona.', 'I dettagli sono nell\'agenda.']],
    ['studio-ricontatto', 'Nuova richiesta di ricontatto', 'Quando qualcuno chiede di essere ricontattato dal modulo dei contatti.', 'Nuova richiesta di ricontatto', ['C\'è una nuova richiesta di ricontatto.', 'I dettagli sono nell\'agenda.']],
  ].map(([key, label, when, s, b]) => ({
    key, group: 'studio', label, when, audience: 'studio', langs: ['it'],
    vars: key === 'studio-ricontatto' ? ['link'] : ['data', 'link'], link: 'admin', required: key === 'studio-ricontatto' ? [] : ['data'],
    it: { s, btn: 'Apri l\'agenda', b: [...b, '{link}'] },
  })),
  {
    key: 'studio-non-confermati', group: 'studio', label: 'Appuntamenti di domani non confermati', when: 'Alle 18 del giorno prima, se qualcuno non ha ancora confermato la presenza.',
    audience: 'studio', langs: ['it'], vars: ['numero', 'elenco', 'link'], link: 'admin', required: ['elenco'],
    it: { s: 'Appuntamenti di domani da confermare', btn: 'Apri l\'agenda', b: ['Per domani, appuntamenti per cui la persona non ha ancora confermato la presenza: {numero}.', '{elenco}', 'Dall\'agenda puoi scriverle o liberare l\'orario. Se lo liberi, la persona riceve un\'email che le dice cosa fare.', '{link}'] },
  },
];

const toRich = (paras) => ({ p: paras.map((t) => [{ t }]) });

export const EMAILS = DEFS.map((d) => ({
  audience: 'persona', langs: ['it', 'en'], ...d,
  required: [...(d.link && !d.linkOptional ? ['link'] : []), ...(d.required || [])],
  linkHint: d.link ? LINK_HINT[d.link] : null,
  defaults: Object.fromEntries((d.langs || ['it', 'en']).map((l) => [l, { subject: d[l].s, body: toRich(d[l].b), button: d[l].btn || '' }])),
}));
export const EMAIL_BY_KEY = Object.fromEntries(EMAILS.map((e) => [e.key, e]));

const TOKEN = /\{([A-Za-z_]+)\}/g;
const tokensIn = (s) => [...String(s).matchAll(TOKEN)].map((m) => m[1]);
const paraText = (para) => para.map((r) => r.t).join('');
const blockOf = (para) => { const m = paraText(para).trim().match(/^\{([a-z_]+)\}$/); return m && BLOCK.has(m[1]) ? m[1] : null; };

/**
 * Check a text against its email's rules. Returns the cleaned text { subject, body, button };
 * throws a RangeError with a message for the admin otherwise.
 */
export function checkText(def, lang, input = {}) {
  if (!def) throw new RangeError('Email sconosciuta');
  if (!def.langs.includes(lang)) throw new RangeError('Lingua non prevista per questa email');
  const allowed = new Set(def.vars);
  const label = (v) => `{${v}}`;
  const unknown = (v) => new RangeError(`Il segnaposto ${label(v)} non esiste per questa email: usa il menu «Inserisci»`);

  let subject = String(input.subject ?? '').replace(/\s+/g, ' ').trim().replace(/\s*[–-]\s*Blooming\s*$/i, '');
  if (!subject) throw new RangeError('L\'oggetto non può essere vuoto');
  if (subject.length > 100) throw new RangeError('Oggetto: massimo 100 caratteri');
  for (const v of tokensIn(subject)) {
    const name = v.toLowerCase();
    if (!allowed.has(name)) throw unknown(name);
    if (!SUBJECT_VARS.has(name)) throw new RangeError(`Nell'oggetto non si usano segnaposti come ${label(name)}: l'oggetto resta neutro`);
  }
  if (SUBJECT_FORBIDDEN.test(subject)) throw new RangeError('L\'oggetto resta neutro: niente parole che rivelino il tipo di studio o informazioni cliniche');

  let button = '';
  if (def.link) {
    button = String(input.button ?? '').replace(/\s+/g, ' ').trim();
    if (!button) throw new RangeError('Il testo del pulsante non può essere vuoto');
    if (button.length > 40) throw new RangeError('Pulsante: massimo 40 caratteri');
    if (tokensIn(button).length) throw new RangeError('Nel testo del pulsante non si usano segnaposti');
  }

  const body = cleanRich(input.body, { field: 'Testo', maxChars: 3000 });
  if (body.p.length > 30) throw new RangeError('Testo: troppi paragrafi');
  if (!body.p.length) throw new RangeError('Il testo non può essere vuoto');
  const seen = {};
  for (const para of body.p) {
    if (para.some((r) => r.href)) throw new RangeError('Nel testo delle email non si aggiungono link: c\'è un solo pulsante, {link}');
    const block = blockOf(para);
    for (const v of tokensIn(paraText(para))) {
      const name = v.toLowerCase();
      if (!allowed.has(name)) throw unknown(name);
      if (BLOCK.has(name) && !block) throw new RangeError(`${label(name)} va da solo, in un paragrafo a sé`);
      if (BLOCK.has(name) && v !== name) throw new RangeError(`Scrivi ${label(name)} in minuscolo`);
      seen[name] = (seen[name] || 0) + 1;
    }
  }
  for (const v of BLOCK) if (seen[v] > 1) throw new RangeError(`${label(v)} può comparire una sola volta`);
  for (const v of def.required) {
    if (!seen[v]) {
      throw new RangeError(v === 'link'
        ? `Manca il pulsante {link}: serve per ${def.linkHint}. Rimettilo dal menu «Inserisci»`
        : `Manca ${label(v)} (${VARS[v]}): serve perché si capisca di quale appuntamento si parla`);
    }
  }
  return { subject, body, button };
}

const P_STYLE = 'margin:0 0 12px';
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Render a checked text. v: the values of the placeholders, in the email's language
 * ({ nome, data, dettagli: [lines], professionista|null, tipo, tariffa: line|'', ore, numero, elenco: [lines], link: url|null }).
 * footer: lines added at the end of every email to the person (emergency line, signature).
 * Throws if a placeholder cannot be resolved, so the caller can fall back to the default.
 */
export function renderText(def, lang, txt, v, { brand = 'Blooming', footer = [] } = {}) {
  const fallbackPro = (def.proFallback && def.proFallback[lang]) || (lang === 'en' ? 'your psychologist' : 'la tua professionista');
  const value = (tok) => {
    const name = tok.toLowerCase();
    if (!def.vars.includes(name) || BLOCK.has(name)) throw new Error(`segnaposto non risolto: {${tok}}`);
    let out = name === 'professionista' ? (v.professionista || fallbackPro) : v[name];
    if (out === undefined || out === null) throw new Error(`valore mancante: {${tok}}`);
    out = String(out);
    return tok === name ? out : capital(out);
  };
  const fill = (s) => String(s).replace(TOKEN, (_, tok) => value(tok));

  const html = [];
  const text = [];
  const line = (t) => { html.push(`<p style="${P_STYLE}">${escapeHtml(t)}</p>`); text.push(t); };
  for (const para of txt.body.p) {
    const block = blockOf(para);
    if (block === 'dettagli' || block === 'elenco') { for (const l of v[block] || []) line(l); continue; }
    if (block === 'tariffa') { if (v.tariffa) line(v.tariffa); continue; }
    if (block === 'link') {
      if (!v.link) continue;
      html.push(`<p style="margin:20px 0"><a href="${escapeHtml(v.link)}" style="background:#205A54;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">${escapeHtml(txt.button)}</a></p>`);
      text.push(`\n${txt.button}: ${v.link}`);
      continue;
    }
    const runs = para.map((r) => ({ ...r, t: fill(r.t) }));
    const plain = runs.map((r) => r.t).join('').trim();
    if (!plain) continue;
    html.push(`<p style="${P_STYLE}">${runs.map((r) => {
      let h = escapeHtml(r.t);
      if (r.i) h = `<em>${h}</em>`;
      if (r.b) h = `<strong>${h}</strong>`;
      return h;
    }).join('')}</p>`);
    text.push(plain);
  }
  for (const f of footer) if (f) line(f);
  const out = {
    subject: `${fill(txt.subject)} – ${brand}`,
    text: text.join('\n').trim(),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.55;color:#183B38;max-width:560px">\n${html.join('\n')}\n</div>`,
  };
  return out;
}
