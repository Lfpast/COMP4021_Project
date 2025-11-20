const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// 游戏模式
const MODES = {
  simple: { w: 9, h: 9, m: 10 },
  classic: { w: 8, h: 8, m: 10 },
  medium: { w: 16, h: 16, m: 40 },
  expert: { w: 30, h: 16, m: 99 }
};

// LowDB 初始化
let db;
async function initDB() {
  const { JSONFilePreset } = await import('lowdb/node');
  try {
    await fs.access('db/db.json');
  } catch {
    await fs.mkdir('db', { recursive: true });
    await fs.writeFile('db/db.json', JSON.stringify({ users: [], rankings: {} }, null, 2));
  }
  db = await JSONFilePreset('db/db.json', { users: [], rankings: {} });
}
initDB();

// ==================== REST API ====================

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, msg: 'Missing fields' });

  const existing = db.data.users.find(u => u.username === username);
  if (existing) return res.json({ success: false, msg: 'User exists' });

  const hash = await bcrypt.hash(password, 10);
  db.data.users.push({
    username,
    password: hash,
    stats: Object.fromEntries(Object.keys(MODES).map(mode => [mode, { games: 0, wins: 0, bestTime: Infinity }]))
  });
  await db.write();
  res.json({ success: true });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.data.users.find(u => u.username === username);
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.json({ success: false, msg: 'Invalid credentials' });
  }
  res.json({ success: true, username });
});

app.get('/stats/:username', async (req, res) => {
  await initDB();
  const user = db.data.users.find(u => u.username === req.params.username);
  res.json(user?.stats || {});
});

app.get('/rankings/:mode', async (req, res) => {
  await initDB();
  res.json(db.data.rankings[req.params.mode] || []);
});

// ==================== Socket.IO ====================

const rooms = new Map();

io.on('connection', (socket) => {
  let username = null;

  socket.on('auth', (user) => { username = user; });

  socket.on('createLobby', (requestedRoomName) => {
    if (!username) return;

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomName = requestedRoomName?.trim() || `${username}'s Room`;

    socket.join(roomId);
    rooms.set(roomId, {
      roomName,
      hostId: socket.id,
      players: new Set([socket.id]),
      usernameMap: new Map([[socket.id, username]]),
      settings: { mode: 'classic' }
    });

    socket.emit('lobbyCreated', { roomId, roomName });
    io.to(roomId).emit('playersUpdate', [username]);
  });

  socket.on('joinLobby', (roomId) => {
    if (!username) return;
    const upperId = roomId.toUpperCase();
    const room = rooms.get(upperId);

    if (!room || room.players.size >= 4) {
      return socket.emit('joinError', 'Room not found or full');
    }

    socket.join(upperId);
    room.players.add(socket.id);
    room.usernameMap.set(socket.id, username);

    io.to(upperId).emit('playersUpdate', Array.from(room.usernameMap.values()));
    socket.emit('joinedLobby', { roomId: upperId, roomName: room.roomName });
    socket.emit('modeSet', room.settings.mode);
  });

  socket.on('setMode', ({ roomId, mode }) => {
    const room = rooms.get(roomId);
    if (room && room.hostId === socket.id && MODES[mode]) {
      room.settings.mode = mode;
      io.to(roomId).emit('modeSet', mode);
    }
  });

  socket.on('startGame', (roomId) => {
    const room = rooms.get(roomId);
    if (room && room.hostId === socket.id) {
      const { w, h, m } = MODES[room.settings.mode];
      const board = generateBoard(w, h, m);
      const revealed = Array(h).fill().map(() => Array(w).fill(false));
      const flagged = Array(h).fill().map(() => Array(w).fill(false));

      room.state = {
        board,
        revealed,
        flagged,
        signals: [],
        startTime: Date.now(),
        gameOver: false
      };

      io.to(roomId).emit('gameStarted', {
        board,
        revealed,
        flagged,
        roomId,
        mode: room.settings.mode,
        startTime: room.state.startTime
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`${username || 'Someone'} disconnected`);
  });
});

// ==================== 工具函数 ====================

function generateBoard(width, height, numMines) {
  const board = Array.from({ length: height }, () => Array(width).fill(0));

  // 放雷
  let placed = 0;
  while (placed < numMines) {
    const r = Math.floor(Math.random() * height);
    const c = Math.floor(Math.random() * width);
    if (board[r][c] !== -1) {
      board[r][c] = -1;
      placed++;
    }
  }

  // 计算数字
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (board[r][c] === -1) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < height && nc >= 0 && nc < width && board[nr][nc] === -1) count++;
        }
      }
      board[r][c] = count;
    }
  }
  return board;
}

// ==================== 启动服务器 ====================

server.listen(8000, () => {
  console.log('Multisweeper 服务器启动成功！http://localhost:8000');
});