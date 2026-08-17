(function () {
  "use strict";

  // ---------- Room from URL (only used in online mode) ----------
  const url = new URL(location.href);
  let room = url.searchParams.get('room');
  if (!room) {
    room = Math.random().toString(36).slice(2, 8);
    url.searchParams.set('room', room);
    history.replaceState({}, '', url);
  }

  const el = (id) => document.getElementById(id);
  el('roomLinkBox').textContent = location.href;
  el('roomLinkBox').addEventListener('click', () => {
    navigator.clipboard?.writeText(location.href);
    el('roomLinkBox').textContent = "Copié ! " + location.href;
  });

  const socket = io();
  const filmVideo = el('filmVideo');
  const localWebcamVideo = el('localWebcamVideo');
  const canvas = el('composeCanvas');
  const ctx = canvas.getContext('2d');
  const tally = el('tally');
  const tallyLabel = el('tallyLabel');
  const slateTake = el('slateTake');

  let appMode = null; // 'online' | 'local'
  function isLocal() { return appMode === 'local'; }

  let myId = null;
  let players = [];       // [{id, name, hasVideo}]
  let maxPlayers = 3;
  let localStream = null;
  let hasVideo = true;
  const peers = {};
  const remoteVideoEls = {};
  let animId = null;
  let currentPerformerIds = [];

  // ---- Etat propre au mode local (aucun serveur impliqué dans la logique de jeu) ----
  let localRounds = [];
  let localCurrentRaterIds = [];

  function nameById(id) {
    const p = players.find((pl) => pl.id === id);
    return p ? p.name : '?';
  }

  const screens = {
    mode: el('screen-mode'),
    localSetup: el('screen-local-setup'),
    join: el('screen-join'),
    lobby: el('screen-lobby'),
    ideasBanner: el('screen-ideas-banner'),
    clip: el('screen-clip'),
    perform: el('screen-perform'),
    rate: el('screen-rate'),
    recap: el('screen-recap'),
    final: el('screen-final')
  };
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
  }

  // ---------- Idées de scènes (copie locale, pas besoin du serveur en mode local) ----------
  const SCENE_IDEAS = [
    { title: "Harry Potter 4 — le discours de Dumbledore après le tournoi", type: "solo", tone: "grave, posé, très habité" },
    { title: "Star Wars III — Anakin affronte Obi-Wan sur Mustafar avant le duel", type: "duo", tone: "tension, trahison, théâtral" },
    { title: "Le Roi Lion — Scar retient Mufasa au bord de la falaise", type: "duo", tone: "dramatique, voix grave" },
    { title: "The Dark Knight — l'interrogatoire de Batman face au Joker", type: "duo", tone: "deux registres opposés" },
    { title: "Scarface — le monologue final de Tony Montana", type: "solo", tone: "excessif, à surjouer" },
    { title: "The Room — une scène de salon, n'importe laquelle", type: "groupe", tone: "comique malgré lui" },
    { title: "Matrix — Morpheus propose le choix des pilules à Neo", type: "duo", tone: "lent, solennel" },
    { title: "Titanic — la scène de la porte flottante à la fin", type: "duo", tone: "mélodrame" },
    { title: "Le Seigneur des Anneaux — le discours d'Aragorn devant la Porte Noire", type: "solo", tone: "épique" },
    { title: "Braveheart — le discours de William Wallace avant la bataille", type: "solo", tone: "motivant, criard" },
    { title: "Fast & Furious — le monologue sur la famille de Dom Toretto", type: "solo", tone: "voix rocailleuse" },
    { title: "Twilight — un dialogue intense entre Bella et Edward", type: "duo", tone: "monocorde à parodier" },
    { title: "Le Diable s'habille en Prada — Miranda Priestly remet quelqu'un à sa place", type: "solo", tone: "sec, cinglant" },
    { title: "Pirates des Caraïbes — Jack Sparrow négocie avec un équipage", type: "groupe", tone: "excentrique" },
    { title: "Game of Thrones — un discours devant une assemblée", type: "solo", tone: "autoritaire" },
    { title: "Les Tuche — une dispute familiale au dîner", type: "groupe", tone: "comique, ça parle fort" },
    { title: "OSS 117 — un dialogue entre espions", type: "duo", tone: "pince-sans-rire, décalé" },
    { title: "Kaamelott — une réunion de la table ronde", type: "groupe", tone: "absurde" },
    { title: "Intouchables — un échange tendu entre les deux personnages principaux", type: "duo", tone: "mélange drôle/sérieux" },
    { title: "Astérix — un banquet gaulois qui tourne à la dispute", type: "groupe", tone: "bruyant, exagéré" },
    { title: "Rocky — le discours de motivation avant le combat", type: "solo", tone: "essoufflé, habité" },
    { title: "Il faut sauver le soldat Ryan — un échange tendu avant une mission", type: "groupe", tone: "sérieux" },
    { title: "Cyrano de Bergerac — la tirade du nez", type: "solo", tone: "théâtral, rythmé" },
    { title: "Le Prince d'Égypte — la confrontation entre Moïse et Ramsès", type: "duo", tone: "dramatique" },
    { title: "Shrek — une dispute entre Shrek et l'Âne en pleine forêt", type: "duo", tone: "comique" }
  ];
  function pickLocalIdeas(n) {
    const pool = [...SCENE_IDEAS];
    const picked = [];
    while (picked.length < n && pool.length > 0) {
      const i = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(i, 1)[0]);
    }
    return picked;
  }
  function renderIdeas(container, ideas) {
    container.innerHTML = '';
    (ideas || []).forEach((idea) => {
      const card = document.createElement('div');
      card.className = 'idea-card';
      card.innerHTML = `
        <span class="idea-type">${idea.type === 'solo' ? '🎙️ Solo' : idea.type === 'duo' ? '👥 Duo' : '👥 Groupe'}</span>
        <div class="idea-title">${idea.title}</div>
        <div class="idea-tone">${idea.tone}</div>
      `;
      container.appendChild(card);
    });
  }

  // ---------- Choix du mode ----------
  el('btnModeOnline').addEventListener('click', () => {
    appMode = 'online';
    showScreen('join');
  });
  el('btnModeLocal').addEventListener('click', () => {
    appMode = 'local';
    buildLocalNameInputs();
    showScreen('localSetup');
  });

  function buildLocalNameInputs() {
    const count = parseInt(el('localSizeSelect').value, 10);
    const container = el('localNameInputs');
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const label = document.createElement('label');
      label.textContent = 'Joueur ' + (i + 1);
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Pseudo joueur ' + (i + 1);
      input.className = 'local-name-input';
      container.appendChild(label);
      container.appendChild(input);
    }
  }
  el('localSizeSelect').addEventListener('change', buildLocalNameInputs);

  let wantsVideo = true;
  function wireCamToggle(camBtn, noCamBtn) {
    camBtn.addEventListener('click', () => {
      wantsVideo = true;
      camBtn.classList.add('active');
      noCamBtn.classList.remove('active');
    });
    noCamBtn.addEventListener('click', () => {
      wantsVideo = false;
      noCamBtn.classList.add('active');
      camBtn.classList.remove('active');
    });
  }
  wireCamToggle(el('modeCamBtn'), el('modeNoCamBtn'));
  wireCamToggle(el('modeCamBtnLocal'), el('modeNoCamBtnLocal'));

  // ---------- Acquisition caméra/micro partagée entre les deux modes ----------
  async function acquireMedia(wantsVid) {
    if (wantsVid) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
        hasVideo = true;
      } catch (camErr) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        hasVideo = false;
        return 'fallback';
      }
    } else {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      hasVideo = false;
    }
    if (hasVideo) {
      localWebcamVideo.srcObject = localStream;
      await localWebcamVideo.play();
    }
    return 'ok';
  }

  // ---------- Join (mode en ligne) ----------
  el('btnJoin').addEventListener('click', async () => {
    const name = el('nameInput').value.trim();
    const sizeChoice = parseInt(el('sizeSelect').value, 10);
    el('btnJoin').disabled = true;
    el('joinStatus').textContent = wantsVideo ? "Activation caméra/micro..." : "Activation du micro...";
    let result;
    try {
      result = await acquireMedia(wantsVideo);
    } catch (e) {
      el('joinStatus').textContent = "Impossible d'accéder au micro : " + e.message;
      el('btnJoin').disabled = false;
      return;
    }
    if (result === 'fallback') el('joinStatus').textContent = "Pas de caméra détectée, on continue avec le micro seul...";
    socket.emit('join', { room, name, hasVideo, maxPlayers: sizeChoice });
  });

  socket.on('connect', () => { myId = socket.id; });

  socket.on('room-full', () => {
    el('joinStatus').textContent = "Ce salon est déjà complet. Demande un nouveau lien à ton hôte.";
    el('btnJoin').disabled = false;
  });

  socket.on('lobby-update', ({ players: p, maxPlayers: mp }) => {
    players = p;
    maxPlayers = mp;
    renderLobby();
  });

  socket.on('room-state', ({ players: p, maxPlayers: mp }) => {
    players = p;
    maxPlayers = mp;
  });

  function renderLobby() {
    slateTake.textContent = players.length + "/" + maxPlayers + " connectés";
    el('lobbyHint').textContent = "En attente que tout le monde soit connecté (" + players.length + "/" + maxPlayers + ").";
    const list = el('lobbyList');
    list.innerHTML = '';
    players.forEach((p) => {
      const li = document.createElement('li');
      const camTag = p.hasVideo === false ? '<span class="badge" style="border-color:var(--text-dim);color:var(--text-dim);margin-right:6px;">🎤 audio</span>' : '';
      li.innerHTML = `<span>${p.name}</span><span>${camTag}<span class="badge">${p.id === myId ? 'toi' : 'connecté'}</span></span>`;
      list.appendChild(li);
    });
    for (let i = players.length; i < maxPlayers; i++) {
      const li = document.createElement('li');
      li.style.opacity = '.4';
      li.innerHTML = `<span>En attente...</span><span class="badge">—</span>`;
      list.appendChild(li);
    }
    showScreen('lobby');
  }

  socket.on('room-ready', ({ players: p, ideas }) => {
    players = p;
    renderIdeas(el('ideaGrid'), ideas);
    showScreen('ideasBanner');
  });

  // ---------- Local setup ----------
  el('btnLocalStart').addEventListener('click', async () => {
    const inputs = [...document.querySelectorAll('#localNameInputs .local-name-input')];
    const names = inputs.map((inp, i) => inp.value.trim() || ('Joueur ' + (i + 1)));
    el('btnLocalStart').disabled = true;
    el('localStatus').textContent = wantsVideo ? "Activation caméra/micro..." : "Activation du micro...";
    let result;
    try {
      result = await acquireMedia(wantsVideo);
    } catch (e) {
      el('localStatus').textContent = "Impossible d'accéder au micro : " + e.message;
      el('btnLocalStart').disabled = false;
      return;
    }
    if (result === 'fallback') el('localStatus').textContent = "Pas de caméra détectée, on continue avec le micro seul...";
    players = names.map((name, i) => ({ id: 'local-' + i, name, hasVideo }));
    maxPlayers = players.length;
    renderIdeas(el('ideaGrid'), pickLocalIdeas(5));
    showScreen('ideasBanner');
  });

  el('btnIdeasContinue').addEventListener('click', () => {
    goToClipScreen("Choisir l'extrait");
  });

  // ---------- WebRTC mesh (mode en ligne uniquement) ----------
  function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc-ice', { to: peerId, candidate: e.candidate }); };
    pc.ontrack = (e) => {
      let v = remoteVideoEls[peerId];
      if (!v) {
        v = document.createElement('video');
        v.autoplay = true; v.playsInline = true;
        v.className = 'hidden-el';
        document.body.appendChild(v);
        remoteVideoEls[peerId] = v;
      }
      v.srcObject = e.streams[0];
      v.play().catch(() => {});
    };
    peers[peerId] = pc;
    return pc;
  }

  socket.on('existing-peers', async (others) => {
    for (const p of others) {
      const pc = createPeerConnection(p.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { to: p.id, sdp: offer });
    }
  });

  socket.on('webrtc-offer', async ({ from, sdp }) => {
    const pc = peers[from] || createPeerConnection(from);
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { to: from, sdp: answer });
  });

  socket.on('webrtc-answer', async ({ from, sdp }) => {
    const pc = peers[from];
    if (pc) await pc.setRemoteDescription(sdp);
  });

  socket.on('webrtc-ice', async ({ from, candidate }) => {
    const pc = peers[from];
    if (pc) { try { await pc.addIceCandidate(candidate); } catch (e) {} }
  });

  socket.on('player-left', ({ players: p }) => {
    players = p;
    if (!screens.lobby.classList.contains('hidden')) renderLobby();
  });

  // ---------- Clip screen (solo / groupe) — commun aux deux modes ----------
  let clipMode = 'solo';
  const modeSoloBtn = el('modeSoloBtn');
  const modeGroupBtn = el('modeGroupBtn');
  const groupParticipants = el('groupParticipants');
  let selectedParticipants = new Set();

  modeSoloBtn.addEventListener('click', () => {
    clipMode = 'solo';
    modeSoloBtn.classList.add('active');
    modeGroupBtn.classList.remove('active');
    groupParticipants.classList.add('hidden');
    checkUploadEnabled();
  });
  modeGroupBtn.addEventListener('click', () => {
    clipMode = 'group';
    modeGroupBtn.classList.add('active');
    modeSoloBtn.classList.remove('active');
    groupParticipants.classList.remove('hidden');
    renderParticipantChecks();
    checkUploadEnabled();
  });

  function renderParticipantChecks() {
    const container = el('participantChecks');
    container.innerHTML = '';
    selectedParticipants = new Set();
    players.forEach((p) => {
      const row = document.createElement('label');
      row.className = 'participant-check';
      row.innerHTML = `<input type="checkbox" value="${p.id}"> <span>${p.name}${p.id === myId ? ' (toi)' : ''}</span>`;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) { selectedParticipants.add(p.id); row.classList.add('checked'); }
        else { selectedParticipants.delete(p.id); row.classList.remove('checked'); }
        checkUploadEnabled();
      });
      container.appendChild(row);
    });
  }

  function goToClipScreen(title) {
    el('clipTitle').textContent = title;
    clipMode = 'solo';
    modeSoloBtn.classList.add('active');
    modeGroupBtn.classList.remove('active');
    groupParticipants.classList.add('hidden');
    clipFile = null;
    el('dropClipLabel').textContent = "Clique pour choisir un fichier vidéo (mp4, webm...)";
    dropClip.classList.remove('has-file');
    el('uploadStatus').textContent = '';
    checkUploadEnabled();
    showScreen('clip');
  }

  const dropClip = el('dropClip');
  const fileClip = el('fileClip');
  let clipFile = null;
  dropClip.addEventListener('click', () => fileClip.click());
  fileClip.addEventListener('change', () => {
    if (fileClip.files[0]) {
      clipFile = fileClip.files[0];
      el('dropClipLabel').textContent = "✓ " + clipFile.name;
      dropClip.classList.add('has-file');
    }
    checkUploadEnabled();
  });

  function checkUploadEnabled() {
    let ok = !!clipFile;
    if (clipMode === 'group') {
      const enough = selectedParticipants.size >= 2;
      el('groupWarning').textContent = enough ? '' : "Sélectionne au moins 2 joueurs pour une manche groupée.";
      ok = ok && enough;
    }
    el('btnUploadClip').disabled = !ok;
  }

  function buildLocalRound(mode, selectedSet) {
    let participantIds;
    if (mode === 'group') {
      participantIds = selectedSet.size >= 2 ? [...selectedSet] : players.map((p) => p.id);
    } else {
      participantIds = players.map((p) => p.id);
    }
    const scores = {};
    players.forEach((p) => { scores[p.id] = null; });
    return {
      type: mode,
      participantIds,
      performOrder: mode === 'solo' ? players.map((p) => p.id) : null,
      currentPerformerIdx: 0,
      scores
    };
  }
  function currentLocalRound() { return localRounds[localRounds.length - 1]; }

  el('btnUploadClip').addEventListener('click', async () => {
    if (!clipFile) return;
    el('btnUploadClip').disabled = true;

    if (isLocal()) {
      filmReady = false;
      const objUrl = URL.createObjectURL(clipFile);
      filmVideo.src = objUrl;
      filmVideo.load();
      const round = buildLocalRound(clipMode, selectedParticipants);
      localRounds.push(round);
      el('uploadStatus').textContent = '';
      goToReadyToPerform(round.type === 'solo' ? [round.performOrder[0]] : round.participantIds, round.type);
      return;
    }

    el('uploadStatus').textContent = "Envoi en cours...";
    const form = new FormData();
    form.append('clip', clipFile);
    form.append('mode', clipMode);
    if (clipMode === 'group') form.append('participants', JSON.stringify([...selectedParticipants]));
    try {
      await fetch('/upload-clip/' + room, { method: 'POST', body: form });
      el('uploadStatus').textContent = "Envoyé !";
    } catch (e) {
      el('uploadStatus').textContent = "Échec de l'envoi : " + e.message;
      el('btnUploadClip').disabled = false;
    }
  });

  // ---------- Clip ready → perform (mode en ligne) ----------
  let filmReady = false;

  socket.on('clip-ready', ({ version, round }) => {
    filmReady = false;
    filmVideo.src = '/clip/' + room + '?v=' + version;
    filmVideo.load();
    goToReadyToPerform(round.type === 'solo' ? [round.participantIds[0]] : round.participantIds, round.type);
  });

  filmVideo.addEventListener('canplaythrough', () => {
    filmReady = true;
    updateRecordButtonAvailability();
  });
  filmVideo.addEventListener('error', () => {
    el('performHint').textContent = "Erreur de chargement de l'extrait — essaie de le recharger depuis l'écran précédent.";
  });

  function updateRecordButtonAvailability() {
    const btn = el('btnRecord');
    if (btn.classList.contains('hidden')) return;
    btn.disabled = !filmReady;
    btn.textContent = filmReady ? "🎬 Lancer la prise" : "Chargement de l'extrait...";
  }

  // ---------- Perform ----------
  function goToReadyToPerform(performerIds) {
    currentPerformerIds = performerIds;
    const iAmPerformer = isLocal() ? true : performerIds.includes(myId);
    const names = performerIds.map(nameById);
    el('performTitle').textContent = "Au tour de " + names.join(', ');
    el('performHint').textContent = isLocal()
      ? "Mettez-vous devant la caméra, puis lancez la prise."
      : (iAmPerformer
          ? "Positionne-toi dans le cadre, puis lance la prise. Les autres te voient et t'entendent en direct."
          : "Regarde et écoute la performance en direct, tu la noteras juste après.");
    el('btnRecord').classList.toggle('hidden', !iAmPerformer);
    if (iAmPerformer) updateRecordButtonAvailability();
    setTally(false, "PRÊT");
    slateTake.textContent = "Manche en cours — " + names.join(', ');
    showScreen('perform');
    startDrawLoop();
  }

  function setTally(live, label) {
    tally.classList.toggle('live', live);
    tallyLabel.textContent = label;
  }

  el('btnRecord').addEventListener('click', () => {
    if (!filmReady) return;
    el('btnRecord').disabled = true;
    el('btnRecord').textContent = "Démarrage...";
    if (isLocal()) {
      setTally(true, "EN DIRECT");
      el('btnRecord').classList.add('hidden');
      filmVideo.currentTime = 0;
      filmVideo.play().catch(() => {});
      return;
    }
    socket.emit('start-performance', { room });
  });

  socket.on('performance-start', ({ performerIds, startAt }) => {
    currentPerformerIds = performerIds;
    const delay = Math.max(0, startAt - Date.now());
    setTally(true, "EN DIRECT");
    el('btnRecord').classList.add('hidden');
    setTimeout(() => {
      filmVideo.currentTime = 0;
      filmVideo.play().catch(() => {});
    }, delay);
  });

  filmVideo.addEventListener('ended', () => {
    setTally(false, "TERMINÉ");
    if (isLocal()) {
      localHandlePerformanceEnded();
      return;
    }
    if (currentPerformerIds.includes(myId)) {
      socket.emit('performance-ended', { room });
    }
  });

  // ---------- Compose canvas : film + une ou plusieurs PIP ----------
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function sourceFor(peerId) {
    if (isLocal()) return hasVideo ? localWebcamVideo : null;
    if (peerId === myId) return hasVideo ? localWebcamVideo : null;
    return remoteVideoEls[peerId] || null;
  }

  function drawPip(x, y, w, h, peerId, labelOverride) {
    const src = sourceFor(peerId);
    const hasFrame = src && src.videoWidth > 0;
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    if (hasFrame) {
      const vAR = src.videoWidth / src.videoHeight, boxAR = w / h;
      let sw, sh, sx, sy;
      if (vAR > boxAR) { sh = src.videoHeight; sw = sh * boxAR; sx = (src.videoWidth - sw) / 2; sy = 0; }
      else { sw = src.videoWidth; sh = sw / boxAR; sx = 0; sy = (src.videoHeight - sh) / 2; }
      ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
    } else {
      ctx.fillStyle = '#171310';
      ctx.fillRect(x, y, w, h);
      ctx.font = Math.max(20, Math.floor(h * 0.28)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎤', x + w / 2, y + h / 2 - h * 0.06);
      ctx.font = '600 ' + Math.max(11, Math.floor(h * 0.1)) + 'px Inter, sans-serif';
      ctx.fillStyle = '#F5F1E8';
      ctx.fillText(labelOverride || nameById(peerId), x + w / 2, y + h * 0.78);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.lineWidth = tally.classList.contains('live') ? 4 : 2;
    ctx.strokeStyle = tally.classList.contains('live') ? '#E5383B' : '#D4AF37';
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
  }

  function drawFrame() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (filmVideo.videoWidth) {
      const scale = Math.min(canvas.width / filmVideo.videoWidth, canvas.height / filmVideo.videoHeight);
      const w = filmVideo.videoWidth * scale, h = filmVideo.videoHeight * scale;
      const x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
      ctx.drawImage(filmVideo, x, y, w, h);
    }

    if (isLocal() && currentPerformerIds.length > 0) {
      const pipW = 230, pipH = 172;
      const label = currentPerformerIds.length > 1 ? currentPerformerIds.map(nameById).join(' & ') : null;
      drawPip(canvas.width - pipW - 26, canvas.height - pipH - 26, pipW, pipH, currentPerformerIds[0], label);
    } else if (currentPerformerIds.length === 1) {
      const pipW = 230, pipH = 172;
      drawPip(canvas.width - pipW - 26, canvas.height - pipH - 26, pipW, pipH, currentPerformerIds[0]);
    } else if (currentPerformerIds.length > 1) {
      const n = currentPerformerIds.length;
      const gap = 14;
      const pipW = Math.min(200, (canvas.width - gap * (n + 1)) / n);
      const pipH = pipW * 0.75;
      const totalW = pipW * n + gap * (n - 1);
      let startX = (canvas.width - totalW) / 2;
      const y = canvas.height - pipH - 22;
      currentPerformerIds.forEach((id, i) => {
        drawPip(startX + i * (pipW + gap), y, pipW, pipH, id);
      });
    }

    animId = requestAnimationFrame(drawFrame);
  }
  function startDrawLoop() {
    if (animId) cancelAnimationFrame(animId);
    drawFrame();
  }

  // ---------- Rating (mode en ligne : un joueur note à la fois) ----------
  socket.on('go-to-rating', ({ performerIds, performerNames }) => {
    currentPerformerIds = performerIds;
    const iAmPerformer = performerIds.includes(myId);
    el('rateContext').textContent = iAmPerformer
      ? "C'était votre prestation — en attente des notes des autres."
      : "Note la prestation de " + performerNames.join(', ') + " (1 à 10).";
    const panel = el('ratePanel');
    panel.innerHTML = '';
    el('rateBtnRow').classList.toggle('hidden', iAmPerformer);

    if (!iAmPerformer) {
      const row = document.createElement('div');
      row.className = 'rate-row';
      row.innerHTML = `
        <div class="rate-head"><b>Ta note</b><span class="val" id="myRateVal">5</span></div>
        <input type="range" min="1" max="10" step="1" value="5" id="myRateRange">
      `;
      panel.appendChild(row);
      const range = row.querySelector('#myRateRange');
      const val = row.querySelector('#myRateVal');
      range.addEventListener('input', () => { val.textContent = range.value; });
      el('btnConfirmRating').disabled = false;
      el('btnConfirmRating').textContent = "Envoyer ma note";
    }
    showScreen('rate');
  });

  // ---------- Rating (mode local : tous les noteurs sur le même écran) ----------
  function goToLocalRating(performerIds, raterIds) {
    localCurrentRaterIds = raterIds;
    const names = performerIds.map(nameById);
    el('rateContext').textContent = "Les autres joueurs notent la prestation de " + names.join(', ') + " (chacun donne sa note de 1 à 10, puis validez ensemble).";
    const panel = el('ratePanel');
    panel.innerHTML = '';
    raterIds.forEach((id) => {
      const row = document.createElement('div');
      row.className = 'rate-row';
      row.innerHTML = `
        <div class="rate-head"><b>Note de ${nameById(id)}</b><span class="val" id="val-local-${id}">5</span></div>
        <input type="range" min="1" max="10" step="1" value="5" id="local-range-${id}">
      `;
      panel.appendChild(row);
      const range = row.querySelector('#local-range-' + id);
      const val = row.querySelector('#val-local-' + id);
      range.addEventListener('input', () => { val.textContent = range.value; });
    });
    el('rateBtnRow').classList.remove('hidden');
    el('btnConfirmRating').disabled = false;
    el('btnConfirmRating').textContent = "Valider les notes";
    showScreen('rate');
  }

  function localHandlePerformanceEnded() {
    const round = currentLocalRound();
    const performerIds = currentPerformerIds;
    const raterIds = players.map((p) => p.id).filter((id) => !performerIds.includes(id));
    if (raterIds.length === 0) {
      performerIds.forEach((id) => { round.scores[id] = null; });
      localAdvanceRound(round);
      return;
    }
    goToLocalRating(performerIds, raterIds);
  }

  function computeLocalTotals() {
    return players.map((p) => {
      const total = localRounds.reduce((sum, rd) => sum + (rd.scores[p.id] || 0), 0);
      return { id: p.id, name: p.name, total: Math.round(total * 10) / 10 };
    }).sort((a, b) => b.total - a.total);
  }

  function localAdvanceRound(round) {
    if (round.type === 'solo') {
      round.currentPerformerIdx += 1;
      if (round.currentPerformerIdx < round.performOrder.length) {
        goToReadyToPerform([round.performOrder[round.currentPerformerIdx]]);
        return;
      }
    }
    showRoundComplete(
      { type: round.type, participantIds: round.participantIds, scores: round.scores },
      computeLocalTotals(),
      pickLocalIdeas(5)
    );
  }

  el('btnConfirmRating').addEventListener('click', () => {
    if (isLocal()) {
      const values = localCurrentRaterIds.map((id) => parseInt(el('local-range-' + id).value, 10));
      const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
      const round = currentLocalRound();
      currentPerformerIds.forEach((id) => { round.scores[id] = avg; });
      localAdvanceRound(round);
      return;
    }
    const range = el('myRateRange');
    if (!range) return;
    socket.emit('submit-rating', { room, value: parseInt(range.value, 10) });
    el('btnConfirmRating').disabled = true;
    el('btnConfirmRating').textContent = "Note envoyée — en attente des autres...";
  });

  socket.on('rating-progress', () => {});

  socket.on('next-performer', ({ performerId }) => {
    goToReadyToPerform([performerId]);
  });

  // ---------- Recap (fonction commune aux deux modes) ----------
  function showRoundComplete(round, totals, ideas) {
    el('recapTitle').textContent = round.type === 'group' ? "Résultats de la manche (groupe)" : "Résultats de la manche";
    const tbody = el('recapTable').querySelector('tbody');
    tbody.innerHTML = '';
    const totalsById = {};
    totals.forEach((t) => { totalsById[t.id] = t.total; });
    players.forEach((pl) => {
      const tr = document.createElement('tr');
      const score = round.scores[pl.id];
      const scoreCell = score != null
        ? `<td class="score">${score.toFixed(1)} / 10</td>`
        : `<td class="score unrated">${round.participantIds.includes(pl.id) ? 'non noté' : '—'}</td>`;
      tr.innerHTML = `<td>${pl.name}</td>${scoreCell}<td class="score">${(totalsById[pl.id] || 0).toFixed(1)}</td>`;
      tbody.appendChild(tr);
    });
    renderIdeas(el('ideaGridRecap'), ideas);
    showScreen('recap');
  }

  socket.on('round-complete', ({ players: p, round, totals, ideas }) => {
    players = p;
    showRoundComplete(round, totals, ideas);
  });

  el('btnGoUploadNext').addEventListener('click', () => {
    goToClipScreen("Choisir l'extrait suivant");
  });

  el('btnFinish').addEventListener('click', () => {
    if (isLocal()) {
      showFinalResults(computeLocalTotals());
      return;
    }
    socket.emit('request-final', { room });
  });

  // ---------- Final (fonction commune) ----------
  function showFinalResults(totals) {
    const podium = el('podium');
    podium.innerHTML = '';
    const top3 = totals.slice(0, 3);
    const maxTotal = Math.max(...totals.map((t) => t.total), 1);
    const medalClass = ['gold', 'silver', 'bronze'];
    const medalIcon = ['🥇', '🥈', '🥉'];
    const heightFor = (t) => 60 + (t.total / maxTotal) * 130;
    const displayOrder = [1, 0, 2].filter((i) => i < top3.length);
    displayOrder.forEach((rank) => {
      const t = top3[rank];
      if (!t) return;
      const col = document.createElement('div');
      col.className = 'col ' + medalClass[rank];
      col.innerHTML = `
        <div class="medal">${medalIcon[rank]}</div>
        <div class="bar" style="height:${heightFor(t)}px;">${t.total.toFixed(1)}</div>
        <div class="name">${t.name}</div>
      `;
      podium.appendChild(col);
    });
    const tbody = el('finalTable').querySelector('tbody');
    tbody.innerHTML = '';
    totals.forEach((t) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.name}</td><td class="score">${t.total.toFixed(1)}</td>`;
      tbody.appendChild(tr);
    });
    showScreen('final');
  }

  socket.on('final-results', ({ totals }) => showFinalResults(totals));

  el('btnRestart').addEventListener('click', () => {
    if (isLocal()) {
      localRounds = [];
      renderIdeas(el('ideaGrid'), pickLocalIdeas(5));
      showScreen('ideasBanner');
      return;
    }
    socket.emit('new-game', { room });
  });

  socket.on('game-reset', ({ players: p, ideas }) => {
    players = p;
    renderIdeas(el('ideaGrid'), ideas);
    showScreen('ideasBanner');
  });

})();
