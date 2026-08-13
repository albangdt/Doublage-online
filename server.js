const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 }
});

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

// ---- Idées de scènes à doubler (texte seulement, jamais de vidéo ni de lien) ----
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
function pickSceneIdeas(n) {
  const pool = [...SCENE_IDEAS];
  const picked = [];
  while (picked.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

// ---- Etat des salons, en mémoire ----
const rooms = {};

function getRoom(id) {
  if (!rooms[id]) {
    rooms[id] = {
      players: [],
      maxPlayers: null,
      state: 'lobby',
      clip: null,
      uploadVersion: 0,   // ne repart JAMAIS à zéro, garantit un cache-buster toujours unique
      rounds: []
    };
  }
  return rooms[id];
}

function currentRound(r) {
  return r.rounds[r.rounds.length - 1];
}

function nameOf(r, id) {
  const p = r.players.find((pl) => pl.id === id);
  return p ? p.name : '?';
}

function publicRound(round) {
  return {
    type: round.type,
    participantIds: round.participantIds,
    scores: round.scores
  };
}

function computeTotals(r) {
  return r.players.map((p) => {
    const total = r.rounds.reduce((sum, rd) => sum + (rd.scores[p.id] || 0), 0);
    return { id: p.id, name: p.name, total: Math.round(total * 10) / 10 };
  }).sort((a, b) => b.total - a.total);
}

// ---- Upload / diffusion de l'extrait vidéo de la manche ----
app.post('/upload-clip/:room', upload.single('clip'), (req, res) => {
  const roomId = req.params.room;
  const room = getRoom(roomId);
  if (!req.file) return res.status(400).json({ error: 'no file' });

  room.clip = { buffer: req.file.buffer, mimetype: req.file.mimetype || 'video/mp4' };
  room.uploadVersion += 1;

  const mode = req.body.mode === 'group' ? 'group' : 'solo';
  let participantIds = [];
  if (mode === 'group') {
    try { participantIds = JSON.parse(req.body.participants || '[]'); } catch (e) { participantIds = []; }
    participantIds = participantIds.filter((id) => room.players.some((p) => p.id === id));
    if (participantIds.length < 2) participantIds = room.players.map((p) => p.id);
  } else {
    participantIds = room.players.map((p) => p.id);
  }

  const scores = {};
  room.players.forEach((p) => { scores[p.id] = null; });

  const round = {
    type: mode,
    participantIds,
    performOrder: mode === 'solo' ? room.players.map((p) => p.id) : null,
    currentPerformerIdx: 0,
    started: false,
    scores,
    pendingRatings: {}
  };
  room.rounds.push(round);
  room.state = 'ready';

  res.json({ ok: true, version: room.uploadVersion });
  io.to(roomId).emit('clip-ready', { version: room.uploadVersion, round: publicRound(round) });
});

app.get('/clip/:room', (req, res) => {
  const room = getRoom(req.params.room);
  if (!room.clip) return res.status(404).end();
  const { buffer, mimetype } = room.clip;
  res.setHeader('Cache-Control', 'no-store');
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Type': mimetype, 'Content-Length': buffer.length, 'Accept-Ranges': 'bytes' });
    return res.end(buffer);
  }
  const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : buffer.length - 1;
  const chunk = buffer.slice(start, end + 1);
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${buffer.length}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunk.length,
    'Content-Type': mimetype
  });
  res.end(chunk);
});

// ---- Temps réel ----
io.on('connection', (socket) => {
  let joinedRoom = null;

  socket.on('join', ({ room, name, hasVideo, maxPlayers }) => {
    if (!room) return;
    const r = getRoom(room);
    if (r.players.length === 0) {
      r.maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, parseInt(maxPlayers, 10) || 3));
    }
    if (r.players.length >= r.maxPlayers) {
      socket.emit('room-full');
      return;
    }
    joinedRoom = room;
    socket.join(room);
    r.players.push({
      id: socket.id,
      name: (name || '').trim() || `Joueur ${r.players.length + 1}`,
      hasVideo: hasVideo !== false
    });

    const others = r.players.filter((p) => p.id !== socket.id);
    socket.emit('existing-peers', others);
    socket.emit('room-state', { players: r.players, maxPlayers: r.maxPlayers, state: r.state });

    io.to(room).emit('lobby-update', { players: r.players, maxPlayers: r.maxPlayers });
    if (r.players.length === r.maxPlayers) {
      io.to(room).emit('room-ready', { players: r.players, ideas: pickSceneIdeas(5) });
    }
  });

  socket.on('webrtc-offer', ({ to, sdp }) => io.to(to).emit('webrtc-offer', { from: socket.id, sdp }));
  socket.on('webrtc-answer', ({ to, sdp }) => io.to(to).emit('webrtc-answer', { from: socket.id, sdp }));
  socket.on('webrtc-ice', ({ to, candidate }) => io.to(to).emit('webrtc-ice', { from: socket.id, candidate }));

  socket.on('start-performance', ({ room }) => {
    const r = getRoom(room);
    const round = currentRound(r);
    if (!round || r.state !== 'ready') return;

    let performerIds;
    if (round.type === 'solo') {
      const performerId = round.performOrder[round.currentPerformerIdx];
      if (performerId !== socket.id) return;
      performerIds = [performerId];
    } else {
      if (!round.participantIds.includes(socket.id) || round.started) return;
      round.started = true;
      performerIds = round.participantIds;
    }
    r.state = 'performing';
    const startAt = Date.now() + 900;
    io.to(room).emit('performance-start', {
      mode: round.type,
      performerIds,
      performerNames: performerIds.map((id) => nameOf(r, id)),
      startAt
    });
  });

  socket.on('performance-ended', ({ room }) => {
    const r = getRoom(room);
    const round = currentRound(r);
    if (!round || r.state !== 'performing') return;
    const performerIds = round.type === 'solo' ? [round.performOrder[round.currentPerformerIdx]] : round.participantIds;
    if (!performerIds.includes(socket.id)) return;

    const raterIds = r.players.map((p) => p.id).filter((id) => !performerIds.includes(id));
    if (raterIds.length === 0) {
      // tout le monde jouait : pas de notation possible pour cette manche
      performerIds.forEach((id) => { round.scores[id] = null; });
      io.to(room).emit('round-score', { performerIds, score: null, unrated: true });
      advanceRound(room, r, round);
      return;
    }

    r.state = 'rating';
    round.pendingRatings = {};
    io.to(room).emit('go-to-rating', {
      mode: round.type,
      performerIds,
      performerNames: performerIds.map((id) => nameOf(r, id))
    });
  });

  socket.on('submit-rating', ({ room, value }) => {
    const r = getRoom(room);
    const round = currentRound(r);
    if (!round || r.state !== 'rating') return;
    const performerIds = round.type === 'solo' ? [round.performOrder[round.currentPerformerIdx]] : round.participantIds;
    if (performerIds.includes(socket.id)) return;

    const v = Math.max(1, Math.min(10, Number(value) || 5));
    round.pendingRatings[socket.id] = v;

    const raterIds = r.players.map((p) => p.id).filter((id) => !performerIds.includes(id));
    const collected = raterIds.filter((id) => round.pendingRatings[id] !== undefined);
    io.to(room).emit('rating-progress', { collected: collected.length, needed: raterIds.length });

    if (collected.length === raterIds.length) {
      const values = raterIds.map((id) => round.pendingRatings[id]);
      const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
      performerIds.forEach((id) => { round.scores[id] = avg; });
      io.to(room).emit('round-score', { performerIds, score: avg, unrated: false });
      advanceRound(room, r, round);
    }
  });

  function advanceRound(roomId, r, round) {
    if (round.type === 'solo') {
      round.currentPerformerIdx += 1;
      if (round.currentPerformerIdx < round.performOrder.length) {
        r.state = 'ready';
        io.to(roomId).emit('next-performer', { performerId: round.performOrder[round.currentPerformerIdx] });
        return;
      }
    }
    r.state = 'recap';
    io.to(roomId).emit('round-complete', {
      players: r.players,
      round: publicRound(round),
      totals: computeTotals(r),
      ideas: pickSceneIdeas(5)
    });
  }

  socket.on('request-final', ({ room }) => {
    const r = getRoom(room);
    r.state = 'final';
    io.to(room).emit('final-results', { totals: computeTotals(r) });
  });

  socket.on('new-game', ({ room }) => {
    const r = getRoom(room);
    r.state = 'lobby';
    r.clip = null;
    r.rounds = [];
    io.to(room).emit('game-reset', { players: r.players, ideas: pickSceneIdeas(5) });
  });

  socket.on('disconnect', () => {
    if (!joinedRoom) return;
    const r = getRoom(joinedRoom);
    r.players = r.players.filter((p) => p.id !== socket.id);
    io.to(joinedRoom).emit('player-left', { id: socket.id, players: r.players });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Studio de doublage en ligne — port', PORT));
