const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require("bcrypt");
const { Hash, hash } = require("crypto");
const session = require("express-session");

const app = express();
const server = createServer(app);
const io = new Server(server);

// ==========================================
// 1. 全局变量与工具函数
// ==========================================
// 初始化数据库文件
if (!fs.existsSync('db')) {
    fs.mkdirSync('db');
}

// 如果文件不存在，或者文件为空，写入空对象 {}
if (!fs.existsSync('db/users.json') || fs.readFileSync('db/users.json', 'utf-8').trim() === '') {
    fs.writeFileSync('db/users.json', '{}');
}

if (!fs.existsSync('db/lobby.json') || fs.readFileSync('db/lobby.json', 'utf-8').trim() === '') {
    fs.writeFileSync('db/lobby.json', '{}');
}

const gameSession = session({
    secret: "game",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 300000 }
});

app.use(gameSession);
app.use(express.json()); // 允许解析 JSON 请求体
app.use(express.static('public')); // 托管静态文件

function containWordCharsOnly(text) {
    return /^\w+$/.test(text);
}

// ==========================================
// 2. API Endpoints
// ==========================================

// --- 用户认证 (Auth) ---

// 注册
app.post('/user/register', (req, res) => {
    try {
        const users = JSON.parse(fs.readFileSync('db/users.json', 'utf-8'));
        const { username, password, name } = req.body;
        
        // 400 Bad Request: 参数缺失
        if (!username || !password || !name) {
            return res.status(400).json({ error: "Username, password, and name are required" });
        }

        // 400 Bad Request: 格式错误
        if (!containWordCharsOnly(username)) {
            return res.status(400).json({ error: "Username contains invalid characters" });
        }

        // 409 Conflict: 用户已存在
        if (username in users) {
            return res.status(409).json({ error: "User already exists" });
        }
        
        // 创建新用户
        const hashedPassword = bcrypt.hashSync(password, 10);
        users[username] = { password: hashedPassword, name: name };
        fs.writeFileSync('db/users.json', JSON.stringify(users, null, 2), 'utf-8');
        
        // 201 Created: 创建成功
        res.status(201).json({ message: "User created" });
    } 
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 登录
app.post('/user/login', (req, res) => {
    try {
        const users = JSON.parse(fs.readFileSync('db/users.json', 'utf-8'));
        const { username, password } = req.body;

        if (username in users) {
            const hashedPassword = users[username].password;
            if (bcrypt.compareSync(password, hashedPassword)) {
                const name = users[username].name;
                req.session.user = { username, name };
                return res.status(200).json({ message: 'User Login Successful' });
            }
            else {
                return res.status(401).json({ error: 'Wrong Password' });
            }
        }

        return res.status(404).json({ error: 'User Not Found!' });
    } 
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 登出
app.post('/user/logout', (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'User is Not Logged In' });
        }
    
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ error: 'Logout Failed' });
            }
            res.clearCookie('connect.sid'); // 清除客户端 Cookie
            res.status(200).json({ message: 'User Logged Out Successfully' });
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 验证
app.get('/user/validate', (req, res) => {
    try {
        if (req.session.user) {
            res.status(200).json({ user: req.session.user });
        }
        else {
            res.status(401).json({ error: "User Has Not Signed In" });
        }   
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 更新用户信息
app.put('/user/update/username/:username', (req, res) => {
    try {
        const username = req.params.username;
        const { name } = req.body;
        const users = JSON.parse(fs.readFileSync('db/users.json', 'utf-8'));

        users[username].name = name;
        if (req.session.user && req.session.user.username === username) {
             req.session.user.name = name;
        }
        fs.writeFileSync('db/users.json', JSON.stringify(users, null, 2), 'utf-8');

        res.status(200).json({ message: 'Name Changes Successfully' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.put('/user/update/password/:username', (req, res) => {
    try {
        const username = req.params.username;
        const { password } = req.body;
        const users = JSON.parse(fs.readFileSync('db/users.json', 'utf-8'));

        const hashedPassword = bcrypt.hashSync(password, 10);
        users[username].password = hashedPassword;
        fs.writeFileSync('db/users.json', JSON.stringify(users, null, 2), 'utf-8');

        res.status(200).json({ message: 'Password Changes Successfully' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 注销
app.delete('/user/delete/:username', (req, res) => {
    try {
        const username = req.params.username;
        const { password } = req.body;
        const users = JSON.parse(fs.readFileSync('db/users.json', 'utf-8'));
        
        if (bcrypt.compareSync(password, users[username].password)) {
            delete users[username];
            fs.writeFileSync('db/users.json', JSON.stringify(users, null, 2), 'utf-8');
            return res.status(200).json({ message: 'User Deleted Successfully' });
        }

        res.status(401).json({ error: 'Wrong Password' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- 游戏大厅 (Lobby) ---

// 获取房间列表
app.get('/api/v1/lobbies', (req, res) => {
    res.json(lobbies);
});

// 创建房间
app.post('/api/v1/lobbies', (req, res) => {
    const { name, settings, host } = req.body;
    const newLobby = {
        id: 'lobby_' + Date.now(),
        name: name || "New Game",
        host: host || "Anonymous",
        players: [], 
        settings: settings || { difficulty: "Classic" },
        status: 'waiting'
    };
    lobbies.push(newLobby);
    console.log(`Lobby created: ${newLobby.name} (${newLobby.id})`);
    res.status(201).json(newLobby);
});

// 获取特定房间信息
app.get('/api/v1/lobbies/:id', (req, res) => {
    const lobby = lobbies.find(l => l.id === req.params.id);
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    res.json(lobby);
});

// ==========================================
// 4. Socket.io 实时通信
// ==========================================
io.on('connect', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });

    // 示例：加入房间事件
    socket.on('join_lobby', (lobbyId) => {
        console.log(`Socket ${socket.id} joining lobby ${lobbyId}`);
        socket.join(lobbyId);
    });
});

// ==========================================
// 5. 启动服务器
// ==========================================
const PORT = 8000;
server.listen(PORT, () => {
    console.log(`LAN Game server running at http://localhost:${PORT}`);
});