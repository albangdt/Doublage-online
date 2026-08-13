(function () {
  "use strict";

  // ---------- Room from URL ----------
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

  let myId = null;
  let players = [];       // [{id, name, hasVideo}]
  let maxPlayers = 3;
  let localStream = null;
  let hasVideo = true;
  const peers = {};
  const remoteVideoEls = {};
  let animId = null;
  let currentPerformerIds = [];
  let pendingIdeasForClipScreen = null;

  const screens = {
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

  // ---------- Join ----------
  let wantsVideo = true;
  const modeCamBtn = el('modeCamBtn');
  const modeNoCamBtn = el('modeNoCamBtn');
  modeCamBtn.addEventListener('click', () => {
    wantsVideo = true;
    modeCamBtn.classList.add('active');
    modeNoCamBtn.classList.remove('active');
  });
  modeNoCamBtn.addEventListener('click', () => {
    wantsVideo = false;
    modeNoCamBtn.classList.add('active');
    modeCamBtn.classList.remove('active');
  });

  el('btnJoin').addEventListener('click', async () => {
    const name = el('nameInput').value.trim();
    const sizeChoice = parseInt(el('sizeSelect').value, 10);
    el('btnJoin').disabled = true;
    el('joinStatus').textContent = wantsVideo ? "Activation caméra/micro..." : "Activation du micro...";
    try {
      if (wantsVideo) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
          hasVideo = true;
        } catch (camErr) {
          el('joinStatus').textContent = "Pas de caméra détectée, on continue avec le micro seul...";
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          hasVideo = false;
        }
      } else {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        hasVideo = false;
      }
      if (hasVideo) {
        localWebcamVideo.srcObject = localStream;
        await localWebcamVideo.play();
      }
    } catch (e) {
      el('joinStatus').textContent = "Impossible d'accéder au micro : " + e.message;
      el('btnJoin').disabled = false;
      return;
    }
    socket.emit('join', { room, name, hasVideo, maxPlayers: sizeChoice });
  });

  socket.on('connect', () => { myId = socket.id; });

  socket.on('room-full', () => {
    el('joinStatus').textContent = "Ce salon est déjà complet. Demande un nouveau lien à ton hôte.";
    el('btnJoin').disabled = false;
  });

  // ---------- Lobby ----------
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

  el('btnIdeasContinue').addEventListener('click', () => {
    goToClipScreen("Choisir l'extrait");
  });

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

  // ---------- WebRTC mesh ----------
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

  // ---------- Clip screen (solo / groupe) ----------
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

  el('btnUploadClip').addEventListener('click', async () => {
    if (!clipFile) return;
    el('btnUploadClip').disabled = true;
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

  // ---------- Clip ready → perform ----------
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
  function goToReadyToPerform(performerIds, mode) {
    currentPerformerIds = performerIds;
    const iAmPerformer = performerIds.includes(myId);
    const names = performerIds.map((id) => { const p = players.find((pl) => pl.id === id); return p ? p.name : '?'; });
    el('performTitle').textContent = "Au tour de " + names.join(', ');
    el('performHint').textContent = iAmPerformer
      ? "Positionne-toi dans le cadre, puis lance la prise. Les autres te voient et t'entendent en direct."
      : "Regarde et écoute la performance en direct, tu la noteras juste après.";
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
    if (peerId === myId) return hasVideo ? localWebcamVideo : null;
    return remoteVideoEls[peerId] || null;
  }

  function drawPip(x, y, w, h, peerId) {
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
      const p = players.find((pl) => pl.id === peerId);
      ctx.fillText(p ? p.name : '', x + w / 2, y + h * 0.78);
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

    if (currentPerformerIds.length === 1) {
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

  // ---------- Rating ----------
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

  el('btnConfirmRating').addEventListener('click', () => {
    const range = el('myRateRange');
    if (!range) return;
    socket.emit('submit-rating', { room, value: parseInt(range.value, 10) });
    el('btnConfirmRating').disabled = true;
    el('btnConfirmRating').textContent = "Note envoyée — en attente des autres...";
  });

  socket.on('rating-progress', () => {});

  socket.on('next-performer', ({ performerId }) => {
    goToReadyToPerform([performerId], 'solo');
  });

  // ---------- Recap ----------
  socket.on('round-complete', ({ players: p, round, totals, ideas }) => {
    players = p;
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
    pendingIdeasForClipScreen = ideas;
    showScreen('recap');
  });

  el('btnGoUploadNext').addEventListener('click', () => {
    goToClipScreen("Choisir l'extrait suivant");
  });

  el('btnFinish').addEventListener('click', () => {
    socket.emit('request-final', { room });
  });

  // ---------- Final ----------
  socket.on('final-results', ({ totals }) => {
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
  });

  el('btnRestart').addEventListener('click', () => {
    socket.emit('new-game', { room });
  });

  socket.on('game-reset', ({ players: p, ideas }) => {
    players = p;
    renderIdeas(el('ideaGrid'), ideas);
    showScreen('ideasBanner');
  });

})();
