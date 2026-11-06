# Sito Blooming – istruzioni per Claude

Questo repository (pubblico) contiene il codice del sito di Blooming. **La memoria del progetto** (brief del cliente, ricerche, decisioni, piano, stato tecnico) sta nel repository privato `giampierofiorelli/blooming-progetto`: aggiungilo alla sessione e leggi il suo `CLAUDE.md` prima di qualsiasi lavoro. Le decisioni lì prevalgono su quello che trovi qui.

Regole:
- Si lavora solo sul ramo `staging`. Mai su `main` senza richiesta esplicita.
- Nessun deploy di produzione su Netlify senza richiesta esplicita (ogni deploy di produzione costa crediti del piano gratuito, condiviso con altri siti).
- Niente segreti nel codice o nei commit: valori solo nelle variabili di Netlify.
- Test: `npm test`. Build: `npm run build`. Anteprima locale: `node scripts/dev-server.mjs --demo`.
