(() => {
'use strict';

// Ramp Control — standalone Canvas 2D turnaround game.
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);
const ui = {
  flightNo: $('flightNo'), route: $('route'), aircraft: $('aircraft'), timer: $('timer'),
  phase: $('phaseTag'), title: $('taskTitle'), detail: $('taskDetail'), progress: $('progress'),
  count: $('taskCount'), next: $('nextHint'), passengers: $('passengers'), bags: $('bags'),
  crew: $('crew'), money: $('money'), toast: $('toast'), objective: $('objectiveText'),
  interact: $('interactBtn'), interactLabel: $('interactLabel'), interactIcon: $('interactIcon'),
  pause: $('pauseOverlay'), complete: $('completeOverlay'), miniMap: $('miniMap')
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let W = 0, H = 0, DPR = 1, last = 0, elapsed = 0, paused = false, running = false, sprinting = false, muted = false;
let audio = null, toastTimer = 0, toastQueue = [];
const keys = Object.create(null), stick = { x: 0, y: 0, pointer: null };
let money = Number(localStorage.getItem('ramp-money')) || 2450;
let xp = Number(localStorage.getItem('ramp-xp')) || 0;
let operation = Number(localStorage.getItem('ramp-operation')) || 1;
const cam = { x: 760, y: 500 };
const player = { x: 530, y: 625, vx: 0, vy: 0, dir: 0, walk: 0 };
const phases = [
  { name: 'LLEGADA', title: 'Recibe la aeronave', detail: 'La aeronave se aproxima. Prepárate para asegurar el puesto.', next: 'Calzos' },
  { name: 'CALZOS', title: 'Inmoviliza el avión', detail: 'Acércate al tren delantero y coloca los calzos de seguridad.', next: 'Equipos de tierra' },
  { name: 'SERVICIO', title: 'Prepara el puesto', detail: 'La cuadrilla acerca la escalera y la cinta de equipaje.', next: 'Abrir bodegas' },
  { name: 'DESCARGA', title: 'Inicia la descarga', detail: 'Abre las bodegas para desembarcar pasajeros y equipaje.', next: 'Atender pasajeros' },
  { name: 'ASISTENCIA', title: 'Ayuda al pasajero', detail: 'Acércate al pasajero que necesita asistencia y confirma la ayuda.', next: 'Embarque' },
  { name: 'EMBARQUE', title: 'Completa el embarque', detail: 'La cuadrilla embarca a los pasajeros y carga el equipaje de salida.', next: 'Cerrar bodegas' },
  { name: 'CIERRE', title: 'Asegura la aeronave', detail: 'Cierra las bodegas cuando todos estén a bordo y la carga esté lista.', next: 'Retirar equipos' },
  { name: 'RETIRADA', title: 'Despeja la plataforma', detail: 'Los vehículos y la escalera regresan a su zona de espera.', next: 'Pushback' },
  { name: 'SALIDA', title: 'Autoriza la salida', detail: 'Acércate al tractor y autoriza el pushback.', next: 'Despegue' },
  { name: 'PUSHBACK', title: 'Pushback en curso', detail: 'Mantén despejada la plataforma mientras el avión inicia su salida.', next: 'Siguiente vuelo' }
];
let flight, world, bags = [], passengers = [], agents = [], chocks = [], inboundBags = [];
let stairs, belt, tug;

function newFlight() {
  const flights = [
    ['IB 4821', 'MADRID → BARCELONA', 'A320', 'IBERIA'],
    ['VY 2160', 'ROMA → MADRID', 'A321', 'VUELING'],
    ['UX 1034', 'PARÍS → MADRID', 'B737', 'AIR EUROPA'],
    ['FR 9182', 'LISBOA → MADRID', 'B738', 'RYANAIR'],
    ['IB 6705', 'SEVILLA → MADRID', 'A320', 'IBERIA']
  ];
  flight = flights[(operation - 1) % flights.length];
  world = {
    phase: 0, phaseTime: 0, plane: { x: -270, y: 430, scale: 1, angle: 0 }, doors: [false, false],
    unloaded: 0, loaded: 0, bagCount: rand(5, 7), paxOut: 0, paxIn: 0, assistDone: false,
    assistTriggered: false, boarding: false, pushStarted: false, pushConnectedTime: 0, finished: false, carried: null,
    stairReady: false, beltReady: false, unloadClock: 1.8, bonusPaid: false
  };
  bags = []; inboundBags = []; passengers = [];
  chocks = [{ x: 650, y: 462, placed: false }, { x: 650, y: 486, placed: false }];
  stairs = { x: 450, y: 560, tx: 738, ty: 513, w: 72, h: 48, state: 'park' };
  belt = { x: 420, y: 625, tx: 570, ty: 552, w: 84, h: 44, state: 'park' };
  tug = { x: 365, y: 740, tx: 585, ty: 623, w: 55, h: 40, state: 'park' };
  agents = [
    { x: 900, y: 576, color: '#d3a35b', name: 'JEFE', state: 'patrol', target: null },
    { x: 915, y: 620, color: '#79b5a2', name: 'RAMP', state: 'patrol', target: null },
    { x: 390, y: 672, color: '#c68463', name: 'ESC', state: 'standby', target: null },
    { x: 410, y: 704, color: '#7d9bb5', name: 'CINTA', state: 'standby', target: null },
    { x: 350, y: 765, color: '#d0b864', name: 'TRACTOR', state: 'standby', target: null },
    { x: 960, y: 568, color: '#a994c2', name: 'ASIST', state: 'standby', target: null }
  ];
  for (let i = 0; i < world.bagCount; i++) bags.push({
    id: i, x: 683 + (i % 3) * 13, y: 470 + Math.floor(i / 3) * 9,
    from: null, to: null, color: ['#d5785b', '#5999bb', '#dcbd55', '#80b997', '#a58ac9'][i % 5],
    size: rand(12, 17), state: 'hold', t: 0, weight: rand(8, 24), claimed: false
  });
  for (let i = 0; i < rand(6, 8); i++) passengers.push({
    x: 745 + (i % 3) * 12, y: 490 + Math.floor(i / 3) * 15, target: { x: 0, y: 0 },
    state: 'waiting', type: 'arrival', color: ['#c9a177', '#8da6ba', '#c58b77', '#dabd72'][i % 4],
    speed: 25 + Math.random() * 12, assist: i === 2, wait: 0, walk: 0
  });
  player.x = 530; player.y = 625; player.dir = 0; player.walk = 0;
  cam.x = 760; cam.y = 500; elapsed = 0;
  ui.flightNo.textContent = flight[0]; ui.route.textContent = flight[1]; ui.aircraft.textContent = flight[2];
  ui.passengers.textContent = String(rand(72, 118));
  ui.complete.classList.add('hidden'); ui.pause.classList.add('hidden'); paused = false;
  setPhase(0); announce('Operación de llegada iniciada');
}
function setPhase(n) {
  world.phase = n; world.phaseTime = 0;
  const p = phases[n]; ui.phase.textContent = p.name; ui.title.textContent = p.title;
  ui.detail.textContent = p.detail; ui.next.textContent = p.next;
  ui.progress.style.width = `${Math.min(100, n / 9 * 100)}%`;
  ui.count.textContent = `${n} / 9 tareas`; setObjective();
}
function setObjective() {
  const lines = [
    'Aeronave en aproximación a la posición 04',
    'Ve al tren delantero y coloca los calzos',
    'La cuadrilla acerca los equipos de servicio',
    'Acércate a la escalera y abre las bodegas',
    'Localiza al pasajero señalado y confirma asistencia',
    'Embarque y carga en curso · puedes ayudar a la cuadrilla',
    'Ve a la puerta de carga y cierra las bodegas',
    'Equipos regresando a la zona de espera',
    'Acércate al tractor y autoriza el pushback',
    'Pushback activo · la aeronave está saliendo'
  ];
  ui.objective.textContent = lines[world.phase] || '';
}
function announce(text, urgent = false) {
  ui.toast.textContent = `${urgent ? '⚠' : '✦'} ${text}`;
  ui.toast.classList.toggle('urgent', urgent);
  ui.toast.classList.add('show'); toastTimer = 4.5;
  if (urgent) beep(560, .12);
}
function note(text) { announce(text); }
function beep(freq = 520, duration = .1) {
  if (muted) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = freq; g.gain.value = .045;
    g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + duration);
  } catch (_) { /* audio is optional */ }
}
function targetForInteraction() {
  const targets = [];
  if (world.phase === 1 && !chocks.every(c => c.placed)) targets.push({ kind: 'chock', x: 650, y: 474, label: 'PONER CALZOS', icon: '▰' });
  if (world.phase === 3 && !world.doors[0]) targets.push({ kind: 'doorOpen', x: 714, y: 505, label: 'ABRIR BODEGAS', icon: '↗' });
  if (world.phase === 4 && world.assistTriggered && !world.assistDone) targets.push({ kind: 'assist', x: 830, y: 548, label: 'AYUDAR PASAJERO', icon: '♡' });
  if (world.phase === 6 && world.doors[0]) targets.push({ kind: 'doorClose', x: 714, y: 505, label: 'CERRAR BODEGAS', icon: '▣' });
  if (world.phase === 8) targets.push({ kind: 'push', x: tug.x, y: tug.y, label: 'AUTORIZAR SALIDA', icon: '➜' });
  if (world.carried) targets.push({ kind: 'drop', x: 460, y: 590, label: 'SOLTAR EQUIPAJE', icon: '↓' });
  let nearest = null, dmin = 76;
  for (const t of targets) { const d = dist(player, t); if (d < dmin) { nearest = t; dmin = d; } }
  if (world.phase === 3 || world.phase === 5) {
    const b = bags.find(b => b.state === 'cart' && !b.claimed && dist(player, b) < 44);
    if (b && (!nearest || dist(player, b) < dist(player, nearest))) nearest = { kind: 'bag', x: b.x, y: b.y, label: 'REVISAR EQUIPAJE', icon: '▣', bag: b };
  }
  return nearest;
}
function doInteract() {
  const hit = targetForInteraction();
  if (!hit) { note(world.carried ? 'Acércate al área de consolidación para dejar la maleta' : 'Acércate al punto señalado para interactuar'); return; }
  switch (hit.kind) {
    case 'chock':
      chocks.forEach(c => c.placed = true);
      setPhase(2); announce('Calzos instalados · escalera y cinta en aproximación');
      stairs.state = 'approach'; stairs.tx = 738; stairs.ty = 513;
      belt.state = 'approach'; belt.tx = 570; belt.ty = 552;
      agents[1].state = 'guide'; agents[1].target = { x: 900, y: 540 };
      agents[2].state = 'driveStairs'; agents[3].state = 'driveBelt';
      break;
    case 'doorOpen':
      world.doors = [true, true]; setPhase(3); world.unloadClock = .8;
      passengers.forEach((p, i) => { p.state = 'walking'; p.target = { x: 1110 + (i % 3) * 18, y: 270 + Math.floor(i / 3) * 24 }; });
      agents[1].state = 'unload'; agents[3].state = 'unload';
      announce('Bodegas abiertas · desembarque y descarga iniciados'); beep(610, .16);
      break;
    case 'assist':
      world.assistDone = true;
      const ap = passengers.find(p => p.assist);
      if (ap) { ap.state = 'assisted'; ap.target = { x: 1090, y: 320 }; }
      agents[5].state = 'assistDone'; announce('Asistencia confirmada · embarque preparado');
      setPhase(5); startBoarding(); break;
    case 'doorClose':
      world.doors = [false, false]; setPhase(7);
      stairs.state = 'return'; belt.state = 'return'; tug.state = 'return';
      agents[2].state = 'returnStairs'; agents[3].state = 'returnBelt'; agents[4].state = 'returnTug';
      announce('Bodegas aseguradas · retirada de equipos'); break;
    case 'push':
      world.pushStarted = true; setPhase(9); tug.state = 'pushApproach';
      agents.forEach((a, i) => { a.state = 'signal'; a.target = { x: 620 + i * 36, y: 570 + (i % 2) * 35 }; });
      announce('Pushback autorizado · tractor en aproximación'); break;
    case 'bag':
      hit.bag.claimed = true; world.carried = hit.bag; announce(`Maleta recogida · ${hit.bag.weight} kg`); break;
    case 'drop': dropBag(); break;
  }
}
function dropBag() {
  const b = world.carried; if (!b) return;
  world.carried = null; b.claimed = false; b.state = 'cart';
  b.x = 460 + Math.random() * 22; b.y = 590 + Math.random() * 15;
  announce('Maleta colocada en la zona de consolidación');
}
function startBoarding() {
  world.boarding = true; world.paxIn = 0;
  const count = rand(6, 8);
  for (let i = 0; i < count; i++) passengers.push({
    x: 1090 + (i % 4) * 18, y: 340 + Math.floor(i / 4) * 25,
    target: { x: 742 + (i % 3) * 5, y: 493 }, state: 'boarding', type: 'departure',
    color: ['#c9a177', '#8da6ba', '#c58b77', '#dabd72'][i % 4], speed: 23 + Math.random() * 13, wait: i * .42, walk: 0
  });
  for (let i = 0; i < world.bagCount; i++) inboundBags.push({
    id: i, x: 395 + (i % 4) * 17, y: 612, from: null, to: null,
    color: ['#d5785b', '#5999bb', '#dcbd55', '#80b997', '#a58ac9'][i % 5],
    size: rand(12, 17), state: 'cart', t: 0, weight: rand(8, 24), claimed: false
  });
  tug.state = 'deliver'; tug.tx = 420; tug.ty = 615;
  agents[4].state = 'deliver'; agents[4].target = { x: 420, y: 655 };
}
function update(dt) {
  if (paused || world.finished) return;
  elapsed += dt; world.phaseTime += dt;
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) ui.toast.classList.remove('show');
  let ix = (keys.arrowright || keys.d ? 1 : 0) - (keys.arrowleft || keys.a ? 1 : 0) + stick.x;
  let iy = (keys.arrowdown || keys.s ? 1 : 0) - (keys.arrowup || keys.w ? 1 : 0) + stick.y;
  let mag = Math.hypot(ix, iy); if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }
  const speed = (sprinting ? 205 : 130) * (world.carried ? .72 : 1);
  player.vx = ix * speed; player.vy = iy * speed;
  let nx = player.x + player.vx * dt, ny = player.y + player.vy * dt;
  const planeDX = nx - world.plane.x, planeDY = ny - world.plane.y;
  if ((planeDX * planeDX) / (205 * 205) + (planeDY * planeDY) / (68 * 68) > 1.12) {
    player.x = clamp(nx, 55, 1450); player.y = clamp(ny, 310, 930);
  }
  // Equipment has a soft collision boundary; walking around remains easy on touch screens.
  for (const e of [stairs, belt, tug]) {
    const r = e === stairs ? 23 : 21;
    if (dist(player, e) < r && dist({ x: nx, y: ny }, e) < dist(player, e)) { nx = player.x; ny = player.y; }
  }
  if (mag > .08) { player.dir = Math.atan2(iy, ix); player.walk += dt * speed * .12; } else player.walk *= .86;
  // Resolve movement after soft equipment boundaries.
  const proposed = { x: nx, y: ny };
  if (Math.hypot(proposed.x - player.x, proposed.y - player.y) > 0.5) {
    const dpx = proposed.x - world.plane.x, dpy = proposed.y - world.plane.y;
    if ((dpx * dpx) / (205 * 205) + (dpy * dpy) / (68 * 68) > 1.12) { player.x = proposed.x; player.y = proposed.y; }
  }
  if (world.phase === 0) {
    world.plane.x = Math.min(760, world.plane.x + 235 * dt); world.plane.y = 430;
    if (world.plane.x >= 760) { world.plane.x = 760; if (world.phaseTime > 2.5) { setPhase(1); announce('Aeronave estacionada · coloca los calzos'); } }
  }
  moveEquipment(dt); moveAgents(dt); movePassengers(dt); moveBags(dt);
  if (world.phase === 2 && world.stairReady && world.beltReady && world.phaseTime > .8) { setPhase(3); announce('Equipos estabilizados · abre las bodegas'); }
  if (world.phase === 3 && world.unloaded >= world.bagCount && world.paxOut >= passengers.filter(p => p.type === 'arrival').length && !world.assistTriggered) {
    world.assistTriggered = true; const ap = passengers.find(p => p.assist);
    if (ap) { ap.state = 'needsHelp'; ap.x = 830; ap.y = 548; ap.target = { x: 830, y: 548 }; }
    setPhase(4); announce('Se requiere asistencia para un pasajero', true);
  }
  if (world.phase === 5 && world.paxIn >= passengers.filter(p => p.type === 'departure').length && world.loaded >= inboundBags.length && world.phaseTime > 2.5) {
    setPhase(6); announce('Embarque y carga completos · cierra las bodegas');
  }
  if (world.phase === 7 && stairs.state === 'park' && belt.state === 'park' && tug.state === 'park' && world.phaseTime > 1.3) {
    setPhase(8); announce('Plataforma despejada · solicita autorización de salida');
  }
  if (world.phase === 9) updatePushback(dt);
  const follow = world.phase === 9 ? world.plane.x : player.x + 80;
  cam.x = lerp(cam.x, follow, .055); cam.y = lerp(cam.y, world.phase === 9 ? 490 : player.y - 5, .045);
  cam.x = clamp(cam.x, 450, 1060); cam.y = clamp(cam.y, 350, 650);
  const focus = targetForInteraction();
  ui.interactLabel.textContent = focus ? focus.label : (world.carried ? 'SOLTAR' : 'INTERACTUAR');
  ui.interactIcon.textContent = focus ? focus.icon : (world.carried ? '↓' : '↗');
  ui.interact.style.opacity = focus ? '1' : '.76';
  ui.timer.textContent = fmt(elapsed); ui.bags.textContent = `${world.phase < 5 ? world.unloaded : world.loaded} / ${world.bagCount}`;
  ui.crew.textContent = `${agents.filter(a => !['standby', 'patrol'].includes(a.state)).length} activos`;
  ui.money.textContent = '$' + money.toLocaleString('en-US');
}
function moveEquipment(dt) {
  for (const e of [stairs, belt, tug]) {
    if (!['approach', 'return', 'deliver', 'pushApproach'].includes(e.state)) continue;
    let tx = e.tx, ty = e.ty;
    if (e.state === 'return') {
      if (e === stairs) { tx = 450; ty = 560; }
      if (e === belt) { tx = 420; ty = 625; }
      if (e === tug) { tx = 365; ty = 740; }
    }
    const d = Math.hypot(tx - e.x, ty - e.y), v = e === tug ? 65 : 48;
    if (d > 2) { e.x += (tx - e.x) / d * Math.min(d, v * dt); e.y += (ty - e.y) / d * Math.min(d, v * dt); }
    else {
      e.x = tx; e.y = ty;
      if (e === stairs && e.state === 'approach') { e.state = 'park'; world.stairReady = true; }
      else if (e === belt && e.state === 'approach') { e.state = 'park'; world.beltReady = true; }
      else if (e.state === 'return') e.state = 'park';
      else if (e.state === 'deliver') e.state = 'park';
      else if (e.state === 'pushApproach') e.state = 'connected';
    }
  }
}
function moveAgents(dt) {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.state === 'patrol' && (!a.target || dist(a, a.target) < 10)) a.target = { x: rand(520, 960), y: rand(545, 670) };
    if (a.state === 'driveStairs') a.target = { x: stairs.x - 35, y: stairs.y + 24 };
    if (a.state === 'driveBelt') a.target = { x: belt.x - 40, y: belt.y + 24 };
    if (a.state === 'returnStairs') a.target = { x: stairs.x - 28, y: stairs.y + 25 };
    if (a.state === 'returnBelt') a.target = { x: belt.x - 36, y: belt.y + 25 };
    if (a.state === 'returnTug' || a.state === 'deliver') a.target = { x: tug.x - 24, y: tug.y + 22 };
    if (a.state === 'unload') a.target = { x: belt.x + 5, y: belt.y + 34 };
    if (a.state === 'signal') a.target = { x: 610 + i * 36, y: 570 + (i % 2) * 38 };
    if (a.target) {
      const dx = a.target.x - a.x, dy = a.target.y - a.y, d = Math.hypot(dx, dy);
      if (d > 5) { const v = a.state === 'signal' ? 28 : 42; a.x += dx / d * Math.min(d, v * dt); a.y += dy / d * Math.min(d, v * dt); a.dir = Math.atan2(dy, dx); a.walk = (a.walk || 0) + dt * 6; }
    }
    if (a.state === 'driveStairs' && world.stairReady) a.state = 'work';
    if (a.state === 'driveBelt' && world.beltReady) a.state = 'work';
    if (a.state === 'returnStairs' && stairs.state === 'park') a.state = 'standby';
    if (a.state === 'returnBelt' && belt.state === 'park') a.state = 'standby';
    if (a.state === 'returnTug' && tug.state === 'park') a.state = 'standby';
  }
}
function movePassengers(dt) {
  for (const p of passengers) {
    if (p.wait > 0) { p.wait -= dt; continue; }
    if (p.state === 'waiting' || p.state === 'needsHelp' || p.state === 'arrived' || p.state === 'assisted') continue;
    const d = Math.hypot(p.target.x - p.x, p.target.y - p.y);
    if (d > 4) {
      const v = p.speed || 27; p.x += (p.target.x - p.x) / d * Math.min(d, v * dt);
      p.y += (p.target.y - p.y) / d * Math.min(d, v * dt); p.walk = (p.walk || 0) + dt * 7;
    } else if (p.type === 'arrival' && p.state === 'walking') { p.state = 'arrived'; world.paxOut++; }
    else if (p.type === 'departure' && p.state === 'boarding') { p.state = 'arrived'; world.paxIn++; }
  }
}
function moveBags(dt) {
  if (world.phase === 3 && world.doors[0]) {
    world.unloadClock -= dt;
    if (world.unloadClock <= 0) {
      const b = bags.find(item => item.state === 'hold');
      if (b) { b.state = 'moving'; b.t = 0; b.from = { x: 683, y: 475 }; b.to = { x: 555 + (b.id % 3) * 16, y: 567 + (b.id % 2) * 11 }; }
      world.unloadClock = 1.4;
    }
  }
  for (const b of bags) if (b.state === 'moving') {
    b.t += dt / 1.15; const t = clamp(b.t, 0, 1);
    b.x = lerp(b.from.x, b.to.x, t); b.y = lerp(b.from.y, b.to.y, t) - Math.sin(t * Math.PI) * 11;
    if (t >= 1) { b.state = 'cart'; world.unloaded++; }
  }
  for (const b of inboundBags) {
    if (world.phase === 5 && b.state === 'cart') { b.state = 'loading'; b.t = 0; b.from = { x: b.x, y: b.y }; b.to = { x: 682 + (b.id % 4) * 9, y: 475 }; }
    if (b.state === 'loading') {
      b.t += dt / 1.55; const t = clamp(b.t, 0, 1);
      b.x = lerp(b.from.x, b.to.x, t); b.y = lerp(b.from.y, b.to.y, t) - Math.sin(t * Math.PI) * 12;
      if (t >= 1) { b.state = 'loaded'; world.loaded++; }
    }
  }
}
function updatePushback(dt) {
  // Hold the aircraft until the tug physically reaches its tow position.
  if (tug.state !== 'connected') {
    tug.state = 'pushApproach'; tug.tx = world.plane.x - 130; tug.ty = world.plane.y + 74;
    return;
  }

  world.pushConnectedTime += dt;
  const t = world.pushConnectedTime;
  if (t < 4.8) {
    world.plane.x += 20 * dt; world.plane.y -= 1.5 * dt;
  } else if (t < 7.3) {
    world.plane.x += 46 * dt; world.plane.y -= 4 * dt;
  } else {
    world.plane.x += 95 * dt; world.plane.y -= 25 * dt;
    world.plane.scale = 1 - clamp((t - 7.3) / 8, 0, .68);
    if (world.plane.x > 1530) { world.finished = true; finishFlight(); }
  }
  tug.x = world.plane.x - 130; tug.y = world.plane.y + 74;
}
function finishFlight() {
  if (world.bonusPaid) return;
  world.bonusPaid = true;
  const reward = 650 + Math.max(0, 180 - Math.floor(elapsed)) * 2;
  money += reward; xp += 100; operation++;
  localStorage.setItem('ramp-money', money); localStorage.setItem('ramp-xp', xp); localStorage.setItem('ramp-operation', operation);
  $('reward').textContent = '+$' + reward.toLocaleString('en-US');
  $('scoreText').textContent = `Salida segura · ${world.bagCount} maletas procesadas · escala de ${fmt(elapsed)}`;
  ui.complete.classList.remove('hidden'); beep(740, .2); setTimeout(() => beep(920, .28), 180);
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  W = rect.width; H = rect.height; DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
}
function rounded(x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}
function line(x1, y1, x2, y2, color, width = 2, dash = []) {
  ctx.beginPath(); ctx.setLineDash(dash); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]);
}
function drawGround() {
  const g = ctx.createLinearGradient(-100, 0, 1300, 1000);
  g.addColorStop(0, '#344747'); g.addColorStop(.48, '#263a3c'); g.addColorStop(1, '#1d3033');
  ctx.fillStyle = g; ctx.fillRect(-500, -500, 3000, 2200);
  // Subtle apron aggregate and drainage seams.
  for (let x = -400; x < 1900; x += 74) for (let y = -300; y < 1500; y += 71) {
    const n = Math.sin(x * 12.17 + y * 4.93) * 43758.5;
    ctx.fillStyle = `rgba(203,224,205,${.012 + (n - Math.floor(n)) * .018})`;
    ctx.fillRect(x + ((y / 71) % 2) * 17, y, 2, 2);
  }
  // Taxi lane and terminal apron.
  ctx.fillStyle = '#283b3e'; ctx.fillRect(-300, 235, 2300, 86);
  line(-250, 278, 1850, 278, '#d6c98a', 2, [25, 20]);
  ctx.fillStyle = '#3a4b4a'; ctx.fillRect(-300, 0, 2300, 205);
  line(-300, 201, 1900, 201, '#83908a', 3);
  // Terminal blocks and glass facade.
  rounded(-180, 34, 400, 137, 12, '#728179');
  rounded(-165, 46, 370, 111, 8, '#364b4b', '#a6b0a1');
  for (let x = -150; x < 190; x += 42) {
    ctx.fillStyle = x % 3 ? '#557577' : '#658687'; ctx.fillRect(x, 58, 31, 81);
    line(x + 33, 54, x + 33, 145, '#a7b6ac', 2);
  }
  rounded(250, 52, 420, 120, 10, '#65746e');
  rounded(263, 65, 394, 91, 6, '#33494a');
  for (let x = 274; x < 645; x += 46) ctx.fillStyle = '#587779', ctx.fillRect(x, 75, 34, 69);
  rounded(710, 32, 500, 137, 12, '#748177');
  rounded(724, 47, 470, 103, 8, '#364b4b');
  for (let x = 738; x < 1180; x += 50) { ctx.fillStyle = '#587678'; ctx.fillRect(x, 58, 38, 77); }
  // Terminal signage.
  ctx.font = '700 13px Manrope, sans-serif'; ctx.fillStyle = '#d4ded2'; ctx.fillText('MADRID · TERMINAL 4', 36, 31);
  // Stand safety box, centerline and ramp safety hatching.
  rounded(480, 340, 560, 245, 24, 'rgba(125,155,125,.025)', 'rgba(202,211,159,.35)');
  line(760, 326, 760, 680, 'rgba(221,210,145,.42)', 2, [17, 15]);
  line(488, 598, 1026, 598, 'rgba(220,225,199,.34)', 3);
  for (let i = 0; i < 13; i++) line(492 + i * 41, 598, 510 + i * 41, 583, 'rgba(222,198,112,.36)', 2);
  rounded(1040, 368, 220, 202, 14, 'rgba(21,31,31,.18)', 'rgba(236,185,101,.36)');
  ctx.save(); ctx.translate(1160, 467); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#d0b77d'; ctx.font = '700 12px DM Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText('ZONA SEGURA', 0, 0); ctx.restore();
  // Ground service road / equipment staging.
  ctx.fillStyle = '#25383a'; ctx.fillRect(-250, 725, 2050, 116);
  line(-250, 783, 1800, 783, 'rgba(209,204,154,.5)', 2, [24, 21]);
  for (let i = 0; i < 5; i++) {
    rounded(315 + i * 91, 685, 78, 49, 7, 'rgba(9,21,24,.12)', 'rgba(207,218,191,.18)');
    ctx.fillStyle = '#b0b99a'; ctx.font = '9px DM Mono'; ctx.fillText(`G-${i + 1}`, 325 + i * 91, 704);
  }
  ctx.fillStyle = 'rgba(199,213,192,.45)'; ctx.font = '10px DM Mono, monospace'; ctx.fillText('PLATAFORMA · PUESTO 04', 530, 339);
  // Drain lines.
  for (let y = 880; y < 1150; y += 26) line(-100, y, 1700, y, 'rgba(170,194,179,.055)', 1);
}
function drawPlane() {
  const p = world.plane;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle || 0); ctx.scale(p.scale || 1, p.scale || 1);
  // Ground shadow.
  ctx.fillStyle = 'rgba(4,13,16,.3)'; ctx.beginPath(); ctx.ellipse(6, 15, 235, 76, 0, 0, Math.PI * 2); ctx.fill();
  // Wings behind fuselage; plane points left.
  ctx.fillStyle = '#b7c8c8'; ctx.strokeStyle = '#7d9192'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-44, -15); ctx.lineTo(22, -142); ctx.lineTo(76, -147); ctx.lineTo(34, -12); ctx.lineTo(34, 12); ctx.lineTo(76, 147); ctx.lineTo(22, 142); ctx.lineTo(-44, 15); ctx.closePath(); ctx.fill(); ctx.stroke();
  // Wing markings and engines.
  for (const y of [-96, 96]) {
    ctx.fillStyle = '#536568'; ctx.beginPath(); ctx.ellipse(15, y, 26, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9babad'; ctx.beginPath(); ctx.ellipse(13, y, 19, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Tailplane.
  ctx.fillStyle = '#bccbca'; ctx.beginPath(); ctx.moveTo(143, -12); ctx.lineTo(206, -55); ctx.lineTo(222, -54); ctx.lineTo(195, -4); ctx.lineTo(195, 4); ctx.lineTo(222, 54); ctx.lineTo(206, 55); ctx.lineTo(143, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
  // Vertical fin.
  ctx.fillStyle = '#e0e5df'; ctx.beginPath(); ctx.moveTo(164, -8); ctx.lineTo(196, -47); ctx.lineTo(213, -47); ctx.lineTo(192, -5); ctx.lineTo(192, 5); ctx.lineTo(213, 47); ctx.lineTo(196, 47); ctx.lineTo(164, 8); ctx.closePath(); ctx.fill();
  // Fuselage.
  const body = ctx.createLinearGradient(0, -38, 0, 37); body.addColorStop(0, '#f2f3e8'); body.addColorStop(.5, '#d8e0db'); body.addColorStop(1, '#a7b7b6');
  ctx.fillStyle = body; ctx.strokeStyle = '#788b8d'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-220, 0); ctx.quadraticCurveTo(-207, -35, -165, -37); ctx.lineTo(158, -29); ctx.quadraticCurveTo(219, -24, 224, 0); ctx.quadraticCurveTo(219, 24, 158, 29); ctx.lineTo(-165, 37); ctx.quadraticCurveTo(-207, 35, -220, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  // Cockpit and cabin windows.
  ctx.fillStyle = '#31515a';
  ctx.beginPath(); ctx.moveTo(-205, -13); ctx.lineTo(-177, -25); ctx.lineTo(-155, -24); ctx.lineTo(-164, -10); ctx.closePath(); ctx.fill();
  for (let x = -145; x < 138; x += 18) {
    ctx.fillStyle = '#46656a'; ctx.beginPath(); ctx.roundRect(x, -19, 10, 5, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x, 14, 10, 5, 2); ctx.fill();
  }
  // Livery stripe.
  ctx.fillStyle = flight[3] === 'IBERIA' ? '#b54e4f' : flight[3] === 'VUELING' ? '#f0d54e' : '#4d8caa';
  ctx.beginPath(); ctx.moveTo(-158, 23); ctx.lineTo(172, 19); ctx.lineTo(188, 12); ctx.lineTo(-165, 15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#31444a'; ctx.font = '700 11px Manrope, sans-serif'; ctx.fillText(flight[3], 12, -3);
  // Landing gear.
  for (const x of [-120, 23, 155]) {
    line(x, 25, x, 42, '#465458', 4); ctx.fillStyle = '#192629'; ctx.beginPath(); ctx.arc(x, 43, 6, 0, Math.PI * 2); ctx.fill();
  }
  // Cargo doors open as raised panels.
  if (world.doors[0]) {
    ctx.fillStyle = '#758b8d'; ctx.strokeStyle = '#3c5357'; ctx.lineWidth = 2;
    ctx.fillRect(-80, 20, 77, 5); ctx.strokeRect(-80, 20, 77, 5);
    ctx.fillStyle = 'rgba(13,28,33,.75)'; ctx.fillRect(-80, 25, 77, 14);
  } else {
    ctx.strokeStyle = '#778b8d'; ctx.lineWidth = 1.5; ctx.strokeRect(-80, 20, 77, 8);
  }
  if (world.doors[1]) { ctx.fillStyle = 'rgba(13,28,33,.75)'; ctx.fillRect(53, 25, 64, 13); }
  ctx.restore();
  // Arrival beacon.
  if (world.phase === 0) {
    ctx.save(); ctx.globalAlpha = .65 + Math.sin(elapsed * 5) * .22; ctx.fillStyle = '#f2cf72'; ctx.beginPath(); ctx.arc(p.x - 205, p.y + 52, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
function drawEquipment(e, kind) {
  ctx.save(); ctx.translate(e.x, e.y);
  if (kind === 'stairs') {
    rounded(-39, -22, 75, 43, 7, '#c7d0c8', '#536568');
    rounded(13, -17, 35, 29, 5, '#667a79', '#34494b');
    ctx.fillStyle = '#d3b45e'; ctx.fillRect(-32, -19, 8, 37);
    for (let i = 0; i < 5; i++) line(-20 + i * 7, -13, -20 + i * 7, 13, '#889a95', 2);
    line(-31, -3, 10, -3, '#e2e8dd', 2); line(-31, 5, 10, 5, '#e2e8dd', 2);
  } else if (kind === 'belt') {
    rounded(-40, -21, 80, 31, 7, '#33484a', '#9aa9a0');
    ctx.fillStyle = '#8da29b'; ctx.fillRect(-33, -14, 66, 4);
    for (let i = 0; i < 7; i++) line(-29 + i * 10, -11, -29 + i * 10, 6, '#52686a', 2);
    rounded(25, 4, 17, 22, 4, '#a7b3a7', '#475a59');
  } else {
    rounded(-30, -20, 45, 37, 7, '#d0b353', '#554d32');
    rounded(7, -15, 27, 24, 5, '#40595a', '#bac1ac');
    ctx.fillStyle = '#f0d477'; ctx.fillRect(-24, -15, 10, 4);
    line(-30, 18, 30, 18, '#232f30', 4);
    if (kind === 'tug' && world.pushStarted) line(30, 0, 62, -5, '#e2c76a', 3);
  }
  ctx.fillStyle = '#172426';
  for (const x of [-23, 18]) { ctx.beginPath(); ctx.arc(x, 19, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#9baba2'; ctx.beginPath(); ctx.arc(x, 19, 2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#172426'; }
  ctx.restore();
}
function drawPerson(x, y, color, dir = 0, walk = 0, role = '') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(dir || 0);
  const stride = Math.sin(walk || 0) * 3;
  ctx.fillStyle = 'rgba(3,12,15,.3)'; ctx.beginPath(); ctx.ellipse(0, 3, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
  // legs and hi-vis torso
  line(-3, 8, -5 + stride, 17, '#263438', 4); line(3, 8, 5 - stride, 17, '#263438', 4);
  rounded(-7, -5, 14, 15, 4, color, '#263638');
  if (role) { ctx.fillStyle = '#f1d66f'; ctx.fillRect(-6, -1, 12, 3); }
  ctx.fillStyle = '#d8b99a'; ctx.beginPath(); ctx.arc(0, -10, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = role ? '#e5c55c' : '#35494b'; ctx.beginPath(); ctx.arc(0, -12, 6, Math.PI, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawBag(b) {
  ctx.save(); ctx.translate(b.x, b.y);
  rounded(-b.size / 2, -b.size * .42, b.size, b.size * .84, 3, b.color, 'rgba(20,33,34,.8)');
  ctx.strokeStyle = '#e5d7b6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, -b.size * .34, 3, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-b.size / 2 + 3, -b.size * .3, 2, b.size * .55);
  ctx.restore();
}
function drawWorld() {
  const scale = clamp(Math.min(W / 1000, H / 720), .36, 1.15);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#223638'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-cam.x, -cam.y);
  drawGround();
  // Aircraft shadows and service equipment
  drawPlane();
  drawEquipment(stairs, 'stairs'); drawEquipment(belt, 'belt'); drawEquipment(tug, 'tug');
  // Chocks become visible once installed.
  for (const c of chocks) if (c.placed) {
    ctx.fillStyle = '#e7bf52'; ctx.beginPath(); ctx.moveTo(c.x - 5, c.y - 5); ctx.lineTo(c.x + 5, c.y - 5); ctx.lineTo(c.x + 4, c.y + 5); ctx.lineTo(c.x - 4, c.y + 5); ctx.closePath(); ctx.fill();
  }
  for (const b of bags) if (b.state !== 'loaded' && b !== world.carried) drawBag(b);
  for (const b of inboundBags) if (b.state !== 'loaded') drawBag(b);
  for (const p of passengers) {
    if (p.state === 'arrived') continue;
    if (p.state === 'needsHelp') {
      ctx.save(); ctx.globalAlpha = .35 + Math.sin(elapsed * 4) * .12; ctx.fillStyle = '#f4c86e'; ctx.beginPath(); ctx.arc(p.x, p.y - 3, 19, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    drawPerson(p.x, p.y, p.color, Math.atan2(p.target.y - p.y, p.target.x - p.x), p.walk, '');
  }
  for (const a of agents) drawPerson(a.x, a.y, a.color, a.dir || 0, a.walk || 0, 'ramp');
  drawPerson(player.x, player.y, '#8be0bb', player.dir, player.walk, 'player');
  if (world.carried) { drawBag({ ...world.carried, x: player.x + Math.cos(player.dir) * 10, y: player.y - 13 }); }
  const target = targetForInteraction();
  if (target) {
    const pulse = 14 + Math.sin(elapsed * 5) * 3;
    ctx.save(); ctx.strokeStyle = '#8be0bb'; ctx.lineWidth = 2; ctx.globalAlpha = .8;
    ctx.beginPath(); ctx.arc(target.x, target.y, pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8be0bb'; ctx.beginPath(); ctx.arc(target.x, target.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.restore();
  drawMiniMap();
}
function drawMiniMap() {
  if (!ui.miniMap) return;
  const dots = [
    `<i class="map-plane" style="left:${clamp((world.plane.x + 270) / 1800 * 100, 4, 96)}%;top:48%"></i>`,
    `<i class="map-player" style="left:${clamp(player.x / 1500 * 100, 4, 96)}%;top:${clamp((player.y - 330) / 600 * 100, 10, 90)}%"></i>`,
    `<i class="map-target" style="left:${clamp((world.phase === 8 ? tug.x : world.phase === 1 ? 650 : 760) / 1500 * 100, 4, 96)}%;top:51%"></i>`
  ];
  ui.miniMap.innerHTML = dots.join('');
}
function frame(now) {
  if (!running) return;
  const dt = Math.min(.05, last ? (now - last) / 1000 : 0); last = now;
  update(dt); drawWorld(); requestAnimationFrame(frame);
}
function saveProgress() {
  localStorage.setItem('ramp-money', String(money));
  localStorage.setItem('ramp-xp', String(xp));
  localStorage.setItem('ramp-operation', String(operation));
  announce('Progreso guardado en este dispositivo');
}
function setPaused(value) {
  paused = value; ui.pause.classList.toggle('hidden', !paused);
  if (paused) { stick.x = 0; stick.y = 0; }
  last = 0;
}
function wireControls() {
  const stickZone = $('stickZone'), knob = $('stickKnob');
  const updateStick = event => {
    const r = stickZone.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const max = r.width * .32, dx = event.clientX - cx, dy = event.clientY - cy;
    const d = Math.hypot(dx, dy), m = Math.min(max, d), ratio = d ? m / d : 0;
    stick.x = dx * ratio / max; stick.y = dy * ratio / max;
    knob.style.transform = `translate(${stick.x * max}px,${stick.y * max}px)`;
  };
  stickZone.addEventListener('pointerdown', e => { e.preventDefault(); stick.pointer = e.pointerId; stickZone.setPointerCapture(e.pointerId); updateStick(e); });
  stickZone.addEventListener('pointermove', e => { if (stick.pointer === e.pointerId) updateStick(e); });
  const releaseStick = e => { if (stick.pointer === e.pointerId) { stick.pointer = null; stick.x = 0; stick.y = 0; knob.style.transform = ''; } };
  stickZone.addEventListener('pointerup', releaseStick); stickZone.addEventListener('pointercancel', releaseStick);
  $('interactBtn').addEventListener('pointerdown', e => { e.preventDefault(); doInteract(); });
  const runBtn = $('runBtn');
  runBtn.addEventListener('pointerdown', e => { e.preventDefault(); sprinting = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => runBtn.addEventListener(type, () => { sprinting = false; }));
  $('pauseBtn').addEventListener('click', () => setPaused(true));
  $('resumeBtn').addEventListener('click', () => setPaused(false));
  $('saveBtn').addEventListener('click', saveProgress);
  $('nextFlightBtn').addEventListener('click', newFlight);
  $('soundBtn').addEventListener('click', e => { muted = !muted; e.currentTarget.textContent = muted ? '×' : '♫'; e.currentTarget.setAttribute('aria-pressed', String(muted)); if (!muted) beep(660, .1); });
  $('volume').addEventListener('input', e => { muted = Number(e.target.value) === 0; });
  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'e' && !e.repeat) doInteract();
    if (e.key === 'Escape') setPaused(!paused);
    if (e.key === 'Shift') sprinting = true;
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if (e.key === 'Shift') sprinting = false; });
  window.addEventListener('blur', () => { sprinting = false; Object.keys(keys).forEach(k => keys[k] = false); });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && !world.finished) setPaused(true); });
}
resize(); wireControls(); newFlight(); running = true; requestAnimationFrame(frame);
})();
