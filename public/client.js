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
    { title: "Le Prince d'Égypte — la conf
