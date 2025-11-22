const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const fsPromises = fs.promises;

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


// ==================== 数据存储初始化 ====================
function ensureDbAndFiles() {
    // 确保 db 目录存在
    if (!fs.existsSync('db')) {
        fs.mkdirSync('db');
    }
    // 初始化 users.json
    const usersPath = 'db/users.json';
    if (!fs.existsSync(usersPath) || fs.readFileSync(usersPath, 'utf-8').trim() === '') {
        fs.writeFileSync(usersPath, '[]');
    }
    // 初始化 lobbies.json
    const lobbiesPath = 'db/lobbies.json';
    if (!fs.existsSync(lobbiesPath) || fs.readFileSync(lobbiesPath, 'utf-8').trim() === '') {
        fs.writeFileSync(lobbiesPath, '{}');
    }
}

// 启动时保证数据文件存在并初始化
ensureDbAndFiles();

// 辅助函数：读取和写入
async function readUsers() {
    const data = await fsPromises.readFile('db/users.json', 'utf-8');
    return JSON.parse(data || '[]');
}

async function writeUsers(users) {
    await fsPromises.writeFile('db/users.json', JSON.stringify(users, null, 2));
}

async function readLobbies() {
    const data = await fsPromises.readFile('db/lobbies.json', 'utf-8');
    return JSON.parse(data || '{}');
}

async function writeLobbies(lobbies) {
    await fsPromises.writeFile('db/lobbies.json', JSON.stringify(lobbies, null, 2));
}

// ==================== REST API ====================

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, msg: 'Missing fields' });

    const users = await readUsers();
    const existing = users.find(u => u.username === username);
    if (existing) return res.json({ success: false, msg: 'User exists' });

    const hash = await bcrypt.hash(password, 10);
    users.push({
        username,
        password: hash,
        stats: Object.fromEntries(Object.keys(MODES).map(mode => [mode, { games: 0, wins: 0, bestTime: Infinity }]))
    });
    await writeUsers(users);
    res.json({ success: true });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = await readUsers();
    const user = users.find(u => u.username === username);
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.json({ success: false, msg: 'Invalid credentials' });
    }
    res.json({ success: true, username });
});

app.get('/stats/:username', async (req, res) => {
    const users = await readUsers();
    const user = users.find(u => u.username === req.params.username);
    res.json(user?.stats || {});
});

// ==================== Socket.IO ====================

// 内存中的房间状态 (用于实时游戏逻辑)
// 注意：持久化的 lobbies.json 主要用于大厅列表展示，实时状态存在内存中
const rooms = new Map();

// 启动时从 lobbies.json 加载房间到内存 (可选，如果需要重启后恢复房间)
// 目前逻辑是重启后房间清空，lobbies.json 仅作为持久化记录

io.on('connection', (socket) => {
    let username = null;

    socket.on('auth', (user) => { username = user; });

    socket.on('createLobby', async (requestedRoomName) => {
        if (!username) return;

        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const roomName = requestedRoomName?.trim() || `${username}'s Room`;

        socket.join(roomId);
        
        // 1. 更新内存状态
        const roomData = {
            roomName,
            hostId: socket.id,
            players: new Set([socket.id]),
            usernameMap: new Map([[socket.id, username]]),
            settings: { mode: 'classic' }
        };
        rooms.set(roomId, roomData);

        // 2. 更新持久化存储 (lobbies.json)
        const lobbies = await readLobbies();
        lobbies[roomId] = {
            id: roomId,
            name: roomName,
            host: username,
            players: [username],
            settings: { mode: 'classic' },
            status: 'waiting'
        };
        await writeLobbies(lobbies);

        socket.emit('lobbyCreated', { roomId, roomName });
        io.to(roomId).emit('playersUpdate', [username]);
    });

    socket.on('joinLobby', async (roomId) => {
        if (!username) return;
        const upperId = roomId.toUpperCase();
        const room = rooms.get(upperId);

        if (!room || room.players.size >= 4) {
            return socket.emit('joinError', 'Room not found or full');
        }

        socket.join(upperId);
        room.players.add(socket.id);
        room.usernameMap.set(socket.id, username);

        // 更新持久化存储
        const lobbies = await readLobbies();
        if (lobbies[upperId]) {
            lobbies[upperId].players.push(username);
            await writeLobbies(lobbies);
        }

        io.to(upperId).emit('playersUpdate', Array.from(room.usernameMap.values()));
        socket.emit('joinedLobby', { roomId: upperId, roomName: room.roomName });
        socket.emit('modeSet', room.settings.mode);
    });

    socket.on('setMode', async ({ roomId, mode }) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id && MODES[mode]) {
            room.settings.mode = mode;
            
            // 更新持久化存储
            const lobbies = await readLobbies();
            if (lobbies[roomId]) {
                lobbies[roomId].settings.mode = mode;
                await writeLobbies(lobbies);
            }

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

    // =====================================================================================
    // [新增功能开发区] 待前端/全栈同学实现的交互逻辑
    // 目标：实现 README 中描述的实时协作、信号系统、自定义模式及胜负判定
    // =====================================================================================

    // 1. 处理点击翻开格子 (Gameplay - Reveal)
    // 前端调用: socket.emit('revealTile', { roomId, r, c })
    socket.on('revealTile', async ({ roomId, r, c }) => {
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver) return;

        // TODO 1: 获取 room.state.board[r][c] 的值
        // TODO 2: 如果是雷 (-1):
        //    - 设置 room.state.gameOver = true
        //    - 更新统计数据 (stats) 记录失败
        //    - 广播 'gameOver' 事件: io.to(roomId).emit('gameOver', { winner: false, bomb: {r, c} })
        
        // TODO 3: 如果是数字 (>0):
        //    - 仅更新 room.state.revealed[r][c] = true
        //    - 广播 'boardUpdate' 事件: io.to(roomId).emit('boardUpdate', { revealed: room.state.revealed })
        
        // TODO 4: 如果是空白 (0):
        //    - 执行 Flood Fill 算法，递归翻开周围所有空白及边缘数字
        //    - 更新 room.state.revealed
        //    - 广播 'boardUpdate'
        
        // TODO 5: 检查胜利条件 (所有非雷格子都已翻开)
        //    - 若胜利: 更新统计数据, 广播 'gameOver' { winner: true }
    });

    // 2. 处理插旗/标记 (Gameplay - Flag)
    // 前端调用: socket.emit('toggleFlag', { roomId, r, c })
    socket.on('toggleFlag', ({ roomId, r, c }) => {
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver) return;

        // TODO: 切换 room.state.flagged[r][c] 的状态
        // TODO: 广播 'flagUpdate' 事件: io.to(roomId).emit('flagUpdate', { r, c, isFlagged: ... })
    });

    // 3. 鼠标拖拽信号系统 (Gameplay - Signals)
    // 前端调用: socket.emit('sendSignal', { roomId, type, r, c })
    // type: 'help' (左), 'onMyWay' (右), 'avoid' (上), 'question' (下)
    socket.on('sendSignal', ({ roomId, type, r, c }) => {
        // 直接广播给房间内其他人，用于显示临时特效
        socket.to(roomId).emit('signalReceived', { 
            type, r, c, 
            fromUser: username 
        });
    });

    // 4. 自定义难度设置 (Lobby - Custom Mode)
    // 前端调用: socket.emit('setCustomMode', { roomId, w, h, m })
    socket.on('setCustomMode', ({ roomId, w, h, m }) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
            // TODO: 校验参数范围 (例如 w: 5-50, h: 5-30)
            // TODO: 更新 room.settings.mode = 'custom'
            // TODO: 更新 room.settings.customParams = { w, h, m }
            // TODO: 广播模式变更
        }
    });

    // 5. 作弊功能开关 (Cheating)
    // 前端调用: socket.emit('toggleCheat', { roomId, enable })
    socket.on('toggleCheat', ({ roomId, enable }) => {
        // TODO: 记录房间作弊状态，可能会影响最终统计 (如不计入排行榜)
    });

    // =====================================================================================
    // [新增功能开发区结束]
    // =====================================================================================

    socket.on('disconnect', async () => {
        console.log(`${username || 'Someone'} disconnected`);
        
        for (const [roomId, room] of rooms.entries()) {
            if (room.players.has(socket.id)) {
                // 1. 从内存移除
                room.players.delete(socket.id);
                room.usernameMap.delete(socket.id);

                // 2. 更新持久化存储
                const lobbies = await readLobbies();
                if (lobbies[roomId]) {
                    const idx = lobbies[roomId].players.indexOf(username);
                    if (idx !== -1) lobbies[roomId].players.splice(idx, 1);

                    if (room.players.size === 0) {
                        rooms.delete(roomId);
                        delete lobbies[roomId];
                        await writeLobbies(lobbies);
                        return;
                    } else {
                        await writeLobbies(lobbies);
                    }
                }

                // 3. 更新房间名单
                io.to(roomId).emit('playersUpdate', Array.from(room.usernameMap.values()));

                // 4. 房主离开处理
                if (room.hostId === socket.id) {
                    room.hostId = null; // 无法再开始游戏
                }
                break;
            }
        }
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
    console.log('Multisweeper 服务器启动成功! http://localhost:8000');
});