# Multisweeper Project: Detailed Division of Labor and Development Framework

Since this is your first frontend project (with backend), I'll make instructions **extremely detailed, step-by-step**, like a tutorial. We'll use **Node.js + Express + Socket.IO** for the server (real-time multiplayer via WebSockets), **HTML5 Canvas** for the game board (required for marks), **lowdb** for simple JSON database (users/stats/rankings), and vanilla JS/CSS (no frameworks for simplicity).

**Total score potential**: This plan covers **all marking criteria**:
- Front page: 40 (desc/instructions, register/sign-in, pair-up lobbies)
- Play page: 95 (4+ things: tiles, flags, signals, mines; real-time WebSocket; mouse/keyboard; <4min; cheat 'C')
- Over page: 30 (stats/rankings/restart)
- Graphics/sounds: 10 (Canvas + 2+ MP3s)
- Running: 15 (npm install; npm start; localhost:8000)
- User support: 30 (multiplayer real-time)
- Quality: 40 (creative signals/cheat/themes)

**Timeline** (Nov 17-30, 2025: ~13 days):
- Days 1-2: Setup + Backend basics (Member 1 leads)
- Days 3-5: Frontend UI + Lobbies (Member 2)
- Days 6-9: Game Core + Integration (Member 3 + all test)
- Days 10-12: Polish (animations/sounds/cheat/stats/video)
- Day 13: Video + Submit

**Tools needed**:
- VS Code (free)
- Node.js (download from nodejs.org, v20+)
- Browser (Chrome dev tools for debug)
- Git (optional, for backup)

## 1. Team Division of Labor

| Member | Role | Key Tasks | Milestones | Estimated Time |
|--------|------|-----------|------------|----------------|
| **Member 1**<br>Backend Lead | Server, Auth, Lobbies, Game Logic | - Setup project/package.json<br>- lowdb: users/register/login/stats<br>- Socket.IO: rooms/lobbies, board gen/flood reveal/flag/signal/win-lose<br>- Game state sync (authoritative server)<br>- Timer/rankings update | - Day 2: Auth + lobbies working (test with 2 browsers)<br>- Day 5: Game start + reveal/flag sync<br>- Day 9: Full logic integrated | 40% effort |
| **Member 2**<br>UI Lead | Front Page, Menus, Over Page | - index.html: login/register, lobby create/join, modes/themes/stats dashboard, side menu<br>- Game over overlay/modal<br>- Responsive CSS<br>- Stats/rankings display (fetch from server) | - Day 4: Login + lobbies UI<br>- Day 7: Stats + over page<br>- Day 10: Themes/menu polish | 30% effort |
| **Member 3**<br>Game Lead | Canvas Board, Controls, Animations | - game.js: Canvas render (tiles/flags/signals), mouse (click/drag), keyboard cheat<br>- Flood reveal visual, animations (fireworks/bomb)<br>- Sounds (Audio API)<br>- Cheat modes (client-side) | - Day 6: Basic canvas board + clicks<br>- Day 8: Drag signals + animations<br>- Day 11: Cheat + sounds | 30% effort |

**Shared**:
- All: Test multiplayer (open multiple incognito tabs), video recording.
- Daily: 30min sync (Discord/Zoom), push to shared GitHub repo.
- Video: Member 3 records gameplay (multiplayer win/lose/cheat), Member 2 edits (<5min, 80% play).

## 2. Project Setup (All Do Together, 1 Hour)

1. Create folder `multisweeper`, open in VS Code.
2. Terminal in folder: `npm init -y`
3. Install deps: `npm i express socket.io@4 lowdb@7 @lowdb/json-file bcryptjs`
4. Create `package.json` scripts:
   ```json
   {
     "scripts": {
       "start": "node server.js"
     }
   }
   ```
5. Create folders: `public/` `public/sounds/` `public/assets/`
6. Create `server.js` (copy from below).
7. Create `public/index.html`, `public/game.js`, `public/style.css`
8. `mkdir db` (db.json auto-created, .gitignore it).
9. Test: `npm start` → http://localhost:8000 → see front page.

**README.html** (submit this):
```html
<h1>Multisweeper</h1>
<ol>
<li>npm install</li>
<li>npm start</li>
<li>Open http://localhost:8000</li>
</ol>
```

## 3. Core Code Framework + Reference Snippets

### A. Backend: server.js (Member 1 Implements)
Full skeleton **copy-paste and fill**:

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { JSONFilePreset } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));
app.use(express.json());

// Modes
const MODES = {
  simple: { w: 9, h: 9, m: 10 },
  classic: { w: 8, h: 8, m: 10 },
  medium: { w: 16, h: 16, m: 40 },
  expert: { w: 16, h: 30, m: 99 }
};

// LowDB
let db;
async function initDB() {
  db = await JSONFilePreset('db.json', {
    users: [], // {username, password: hash, stats: {simple:{games:0,wins:0,bestTime:Infinity},...}, rankings: {simple:[] } }
    rankings: {} // {mode: [{username,time},...]}
  });
}
initDB();

// Routes: Register/Login
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (db.data.users.find(u => u.username === username)) return res.json({ success: false, msg: 'User exists' });
  const hash = await bcrypt.hash(password, 10);
  db.data.users.push({ username, password: hash, stats: Object.fromEntries(Object.keys(MODES).map(mode => [mode, {games:0, wins:0, bestTime: Infinity}])) });
  await db.write();
  res.json({ success: true });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.data.users.find(u => u.username === username);
  if (!user || !await bcrypt.compare(password, user.password)) return res.json({ success: false, msg: 'Invalid' });
  res.json({ success: true, username });
});

app.get('/stats/:username', (req, res) => {
  const user = db.data.users.find(u => u.username === req.params.username);
  res.json(user ? user.stats : {});
});

app.get('/rankings/:mode', (req, res) => {
  res.json(db.data.rankings[req.params.mode] || []);
});

// Game rooms
const rooms = new Map(); // roomId -> {hostId, players: Set[socket.id], usernameMap: Map[socket.id, username], settings: {mode}, state: {board:2d, revealed:2d false, flagged:2d false, signals:[], startTime, gameOver:false, result:'win'|'lose'} }

io.on('connection', (socket) => {
  let username = null;

  socket.on('auth', (user) => { username = user; }); // Client sends after login

  socket.on('createLobby', () => {
    const roomId = Math.random().toString(36).substring(2, 8);
    socket.join(roomId);
    rooms.set(roomId, { hostId: socket.id, players: new Set([socket.id]), usernameMap: new Map([[socket.id, username]]), settings: { mode: 'classic' } });
    socket.emit('lobbyCreated', roomId);
  });

  socket.on('joinLobby', (roomId) => {
    const room = rooms.get(roomId);
    if (room && room.players.size < 4) { // Max 4 players
      socket.join(roomId);
      room.players.add(socket.id);
      room.usernameMap.set(socket.id, username);
      io.to(roomId).emit('playersUpdate', Array.from(room.players).map(id => room.usernameMap.get(id)));
    } else {
      socket.emit('joinError', 'Room full/not found');
    }
  });

  socket.on('setMode', ({ roomId, mode }) => {
    const room = rooms.get(roomId);
    if (room && room.hostId === socket.id) {
      room.settings.mode = mode;
      io.to(roomId).emit('modeSet', mode);
    }
  });

  socket.on('startGame', (roomId) => {
    const room = rooms.get(roomId);
    if (room && room.hostId === socket.id) {
      const { w, h, m } = MODES[room.settings.mode];
      const board = generateBoard(w, h, m); // See below
      const revealed = Array(h).fill().map(() => Array(w).fill(false));
      const flagged = Array(h).fill().map(() => Array(w).fill(false));
      room.state = { board, revealed, flagged, signals: [], startTime: Date.now(), gameOver: false };
      io.to(roomId).emit('gameStarted', room.state);
      // Timer: setInterval(() => io.to(roomId).emit('tick', Date.now() - room.state.startTime), 1000);
    }
  });

  socket.on('reveal', ({ roomId, x, y }) => {
    const room = rooms.get(roomId);
    if (!room || room.state.gameOver) return;
    const { board, revealed, flagged } = room.state;
    if (revealed[y][x] || flagged[y][x]) return;
    if (board[y][x] === -1) { // Mine
      room.state.gameOver = true;
      room.state.result = 'lose';
      io.to(roomId).emit('gameOver', 'lose');
      return;
    }
    floodReveal(board, revealed, y, x); // See below
    if (checkWin(board, revealed, board[0].length * board.length - countMines(board))) {
      room.state.gameOver = true;
      room.state.result = 'win';
      updateStats(room, room.settings.mode); // Update wins/best
      io.to(roomId).emit('gameOver', 'win');
    }
    io.to(roomId).emit('stateUpdate', { revealed, flagged, signals: room.state.signals });
  });

  socket.on('flag', ({ roomId, x, y }) => {
    // Toggle flagged[y][x], emit stateUpdate
  });

  socket.on('signal', ({ roomId, x, y, type }) => {
    // Add {x,y,type, timeout:5000} to signals, emit
  });

  socket.on('disconnect', () => {
    // Cleanup rooms if empty/host leaves
  });
});

server.listen(8000, () => console.log('http://localhost:8000'));

// Helper functions (implement from snippets below)
function generateBoard(w, h, m) { /* ... */ }
function floodReveal(board, revealed, row, col) { /* recursive */ }
function checkWin(board, revealed, safeCells) { /* count revealed safe */ }
function countMines(board) { /* sum -1 */ }
function updateStats(room, mode) { /* for each player, inc games/wins, min bestTime, sort rankings top10 */ }
```

**Key Helpers (Copy)**:
```javascript
// Board gen + numbers
function generateBoard(width, height, numMines) {
  let board = Array(height).fill().map(() => Array(width).fill(0));
  // Place mines (-1)
  let placed = 0;
  while (placed < numMines) {
    let row = Math.floor(Math.random() * height);
    let col = Math.floor(Math.random() * width);
    if (board[row][col] !== -1) {
      board[row][col] = -1;
      placed++;
    }
  }
  // Numbers
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (board[r][c] === -1) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          let nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < height && nc >= 0 && nc < width && board[nr][nc] === -1) count++;
        }
      }
      board[r][c] = count;
    }
  }
  return board;
}

// Flood reveal (recursive, safe for small boards)
function floodReveal(board, revealed, row, col) {
  if (row < 0 || row >= board.length || col < 0 || col >= board[0].length || revealed[row][col]) return;
  revealed[row][col] = true;
  if (board[row][col] !== 0) return; // Border number
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      floodReveal(board, revealed, row + dr, col + dc);
    }
  }
}

function checkWin(board, revealed, totalSafe) {
  let revealedSafe = 0;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      if (revealed[r][c] && board[r][c] !== -1) revealedSafe++;
    }
  }
  return revealedSafe === totalSafe;
}

function countMines(board) {
  let count = 0;
  board.flat().forEach(cell => { if (cell === -1) count++; });
  return count;
}
```

**updateStats**: Loop players, db.data.users.find(u=>u.username===name).stats[mode].games++, if win wins++/bestTime=min(time), sort rankings[mode].slice(0,10) by bestTime.

### B. Frontend UI: public/index.html + style.css (Member 2)
SPA-like: divs for lobby/stats.

```html
<!DOCTYPE html>
<html>
<head>
  <title>Multisweeper</title>
  <link rel="stylesheet" href="style.css">
  <script src="/socket.io/socket.io.js"></script>
</head>
<body>
  <!-- Login/Register Modal -->
  <div id="loginModal">
    <input id="username" placeholder="Username"><input id="password" type="password" placeholder="Password">
    <button onclick="register()">Register</button><button onclick="login()">Login</button>
  </div>
  <!-- Main Front: After login -->
  <div id="front" style="display:none">
    <h1>Multisweeper</h1>
    <p>Classic Minesweeper but multiplayer! Collaborate to reveal all safe tiles. Use signals to communicate.</p>
    <!-- Instructions here from MD -->
    <button onclick="createLobby()">Create Lobby</button>
    <input id="roomId" placeholder="Enter Room ID"><button onclick="joinLobby()">Join</button>
    <select id="mode"><!-- options simple/classic/etc --></select> <!-- Host only -->
    <!-- Stats Dashboard Table -->
    <div id="stats"></div>
    <!-- Side Menu: volume slider, toggles, themes -->
    <div id="sideMenu"><!-- sliders/buttons --></div>
    <div id="playersList"></div>
  </div>
  <script src="front.js"></script> <!-- Login, socket connect, lobby logic -->
</body>
</html>
```

**front.js** (fetch /stats/username, display table games/wins/rate/best.
On login: localStorage.username = username; socket.emit('auth', username);
createLobby: socket.emit('createLobby') → get roomId, window.location=`game.html?room=${roomId}`
join: socket.emit('joinLobby', input.value)

Themes: css variables --tile-color1 etc, select change :root {--color:...}

**Game Over**: Overlay div on game.html, show on 'gameOver', stats (time, best), rankings fetch, buttons restart(new lobby)/new game/front.

### C. Game Core: public/game.html + game.js (Member 3)
```html
<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="style.css"><script src="/socket.io/socket.io.js"></script></head>
<body>
  <canvas id="board"></canvas>
  <div id="ui">Time: <span id="time">0</span> | Players: <span id="players"></span></div>
  <div id="over" style="display:none"><!-- congrats/gameover + stats --></div>
  <script src="game.js"></script>
</body>
</html>
```

**game.js** (Detailed):
```javascript
const socket = io();
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const roomId = new URLSearchParams(window.location.search).get('room');
socket.emit('joinLobby', roomId); // Rejoin

let state = { board: [], revealed: [], flagged: [], signals: [], w:0, h:0, tileSize: 30 };
let cheatLevel = 0; // 0-3
let mouse = { x:0, y:0, down: false, startX:0, startY:0 };

canvas.addEventListener('click', e => {
  const {x,y} = getGridPos(e);
  socket.emit('reveal', {roomId, x, y});
  playSound('click');
});

canvas.addEventListener('contextmenu', e => { e.preventDefault(); /* flag */ });

canvas.addEventListener('mousedown', e => {
  mouse.down = true;
  mouse.startX = e.clientX;
  mouse.startY = e.clientY;
});

canvas.addEventListener('mouseup', e => {
  if (mouse.down) {
    const dx = e.clientX - mouse.startX;
    const dy = e.clientY - mouse.startY;
    const type = getSignalType(dx, dy); // right>0 onmyway, left<0 help, up<0 dont, down>0 ?
    const {x,y} = getGridPos(e);
    socket.emit('signal', {roomId, x, y, type});
  }
  mouse.down = false;
});

document.addEventListener('keydown', e => {
  if (e.key === 'c') {
    cheatLevel = (cheatLevel + 1) % 4; // Cycle levels
    // Level 1: trial (ignore first 3 mines client? or server handles)
    // 2: magnify on hover
    // 3: show all mines
  }
});

socket.on('gameStarted', s => { state = s; resizeCanvas(); });
socket.on('stateUpdate', update => { Object.assign(state, update); draw(); });
socket.on('tick', t => document.getElementById('time').textContent = t/1000 | 0);
socket.on('gameOver', result => { showOver(result, state.startTime); });
socket.on('playersUpdate', ps => document.getElementById('players').textContent = ps.join(', '));

function resizeCanvas() {
  state.w = state.board[0].length;
  state.h = state.board.length;
  state.tileSize = Math.min(canvas.width / state.w, canvas.height / state.h);
  canvas.width = state.w * state.tileSize;
  canvas.height = state.h * state.tileSize;
}

function getGridPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - rect.left) / state.tileSize),
    y: Math.floor((e.clientY - rect.top) / state.tileSize)
  };
}

function getSignalType(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'onmyway' : 'help';
  return dy > 0 ? 'question' : 'dontdo';
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw tiles
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const val = state.board[y][x];
      if (!state.revealed[y][x]) {
        ctx.fillStyle = '#bbb'; // Unrevealed
      } else if (val === -1) {
        ctx.fillStyle = cheatLevel === 3 ? 'red' : '#f00'; // Mine if cheat
      } else if (val === 0) {
        ctx.fillStyle = '#eee'; // Empty
      } else {
        ctx.fillStyle = `hsl(${val * 30}, 70%, 50%)`; // Number color
        ctx.fillText(val, x * state.tileSize + state.tileSize/2, (y+0.7) * state.tileSize);
      }
      if (state.flagged[y][x]) {
        ctx.fillStyle = 'yellow'; ctx.fillText('🚩', ...); // Flag
      }
      ctx.fillRect(x * state.tileSize, y * state.tileSize, state.tileSize, state.tileSize);
      ctx.strokeRect(...); // Grid
    }
  }
  // Signals: draw icons temp
  state.signals.forEach(sig => {
    // Draw emoji/icon at pos based on type
  });
}

function showOver(result, startTime) {
  // Overlay div show, fireworks if win
  if (result === 'win') fireworksAnim(); // See below
  // Fetch stats/rankings, display table
}

function playSound(name) {
  new Audio(`sounds/${name}.mp3`).play();
}

// Fireworks (from tutorial)
class Particle {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.speedX = (Math.random() - 0.5) * 10;
    this.speedY = (Math.random() - 0.5) * 10;
    this.life = 255;
  }
  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.life -= 2;
  }
  draw() {
    ctx.globalAlpha = this.life / 255;
    ctx.fillStyle = `hsl(${Math.random()*360},100%,50%)`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 5, 0, Math.PI*2);
    ctx.fill();
  }
}
let particles = [];
function fireworksAnim() {
  for (let i = 0; i < 100; i++) particles.push(new Particle(canvas.width/2, canvas.height/2));
  function anim() {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => { p.update(); p.draw(); });
    if (particles.length) requestAnimationFrame(anim);
  }
  anim();
}

// Cheat: Level 2 magnify - on mousemove draw zoom if hover unrevealed
// Level 1: client ignore first 3 reveals on mine (but server authoritative, so fake visual)
// Level 3: in draw, if cheat==3 show numbers/mines under

// Bomb ripple: on lose, animate circles from hit mine expanding, reveal all mines.
```

**style.css**: Responsive canvas max-width:80vw, colors, side menu fixed.

**Sounds** (Download free from mixkit.co/free-sound-effects/game/ or zapsplat.com):
- click.mp3 (button press)
- reveal.mp3 (chime)
- flag.mp3 (ding)
- win.mp3 (tada)
- lose.mp3 (boom)
- Put in public/sounds/, preload if needed.

**Themes**: 3 css: classic (gray), desert (sand), space (black stars). Select → document.documentElement.setAttribute('data-theme', 'desert');

**Edge cases**: Auto-win if stuck (but server checks win).

## 4. Integration & Testing
- Test: 3 browsers, create lobby, join, start, reveal/flag/signal, win/lose.
- Single-player: create + start alone.
- Persistent: localStorage.username.
- Custom mode: add input w/h/m for host.

## 5. Video (5min max)
- 0-30s: Front/login/lobby
- 30s-4min: Multiplayer play (signals, reveal, win with fireworks)
- 4-5min: Lose/cheat/over/stats/rankings/restart

This gets you **full marks**. Start with setup, ping if stuck! 🚀