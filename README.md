# Studio de Doublage — En ligne

Jeu de soirée à 3 : chacun double un extrait vidéo devant sa propre caméra, les deux
autres le voient et l'entendent en direct (WebRTC), puis notent la prestation de 1 à 10.
Le classement se calcule tout seul sur plusieurs manches.

## Déployer sur Render (gratuit)

1. **Créer un dépôt GitHub**
   - Va sur github.com, crée un nouveau dépôt (ex. `doublage-online`).
   - Mets-y tout le contenu de ce dossier (`server.js`, `package.json`, `public/`).
   - Le plus simple si tu as `git` en local :
     ```
     cd doublage-online
     git init
     git add .
     git commit -m "premier commit"
     git branch -M main
     git remote add origin https://github.com/TON_PSEUDO/doublage-online.git
     git push -u origin main
     ```
   - Sinon, tu peux aussi glisser-déposer les fichiers directement dans l'interface GitHub
     (bouton "Add file" → "Upload files").

2. **Créer le service sur Render**
   - Va sur render.com, crée un compte (gratuit, via GitHub c'est le plus rapide).
   - "New" → "Web Service".
   - Connecte ton dépôt GitHub `doublage-online`.
   - Render détecte Node automatiquement. Vérifie :
     - Build Command : `npm install`
     - Start Command : `npm start`
     - Plan : Free
   - Clique "Create Web Service". Le premier déploiement prend 1 à 2 minutes.

3. **Récupérer le lien**
   - Une fois déployé, Render te donne une URL du style
     `https://doublage-online-xxxx.onrender.com`.
   - Ouvre-la une première fois toi-même : l'appli génère un code de salon
     automatiquement dans l'adresse (`?room=abc123`).
   - **Copie cette URL complète (avec le `?room=...`)** et envoie-la à tes deux potes.
     C'est ce lien exact qui vous met tous les trois dans la même session.

## À savoir

- **Démarrage à froid** : sur le plan gratuit de Render, le serveur s'endort après
  15 minutes d'inactivité. La première ouverture du lien peut prendre 30-50 secondes
  le temps qu'il se réveille — normal, pas un bug.
- **Réseau** : la vidéo/audio passe en direct entre vous (WebRTC), pas par le serveur.
  Ça marche bien sur la plupart des connexions domestiques. Sur un réseau très
  restrictif (proxy d'entreprise, certains campus), la connexion peut échouer — dans
  ce cas il faudrait un serveur relais (TURN), pas inclus ici pour rester simple/gratuit.
- **L'extrait vidéo** : n'importe quel joueur peut le charger (bouton d'upload), les
  deux autres le reçoivent automatiquement. Limite à 300 Mo.
- Rien n'est stocké de façon permanente : si le serveur redémarre (ou s'endort puis se
  réveille), les salons repartent à zéro.
