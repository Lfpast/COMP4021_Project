const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const fsPromises = fs.promises;

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

// 游戏模式
const MODES = {
	simple: { w: 9, h: 9, m: 10 },
	classic: { w: 8, h: 8, m: 10 },
	medium: { w: 16, h: 16, m: 40 },
	expert: { w: 30, h: 16, m: 99 },
	// custom: placeholder - real values come from room.settings.customParams
	custom: { w: 8, h: 8, m: 10 },
};

// ==================== 数据存储初始化 ====================
function ensureDbAndFiles() {
	// 确保 db 目录存在
	if (!fs.existsSync("db")) {
		fs.mkdirSync("db");
	}
	// 初始化 users.json
	const usersPath = "db/users.json";
	// [前端注意] 数据结构变更：现在初始化为对象 {} 而不是数组 []
	if (
		!fs.existsSync(usersPath) ||
		fs.readFileSync(usersPath, "utf-8").trim() === ""
	) {
		fs.writeFileSync(usersPath, "{}");
	}
	// 初始化 lobbies.json
	const lobbiesPath = "db/lobbies.json";
	if (
		!fs.existsSync(lobbiesPath) ||
		fs.readFileSync(lobbiesPath, "utf-8").trim() === ""
	) {
		fs.writeFileSync(lobbiesPath, "{}");
	}
}

// 启动时保证数据文件存在并初始化
ensureDbAndFiles();

// 辅助函数：读取和写入
async function readUsers() {
	const data = await fsPromises.readFile("db/users.json", "utf-8");
	// [前端注意] 数据结构变更：返回对象 {}
	return JSON.parse(data || "{}");
}

async function writeUsers(users) {
	await fsPromises.writeFile("db/users.json", JSON.stringify(users, null, 2));
}

async function readLobbies() {
	const data = await fsPromises.readFile("db/lobbies.json", "utf-8");
	return JSON.parse(data || "{}");
}

async function writeLobbies(lobbies) {
	await fsPromises.writeFile(
		"db/lobbies.json",
		JSON.stringify(lobbies, null, 2),
	);
}

// ==================== REST API ====================

app.post("/register", async (req, res) => {
	// [Refactor] 新增 name 字段用于昵称
	const { username, password, name } = req.body;
	if (!username || !password || !name)
		return res.json({ success: false, msg: "Missing fields" });

	const users = await readUsers();

	// [前端注意] 数据结构变更：直接通过 key 查找用户
	if (users[username]) return res.json({ success: false, msg: "User exists" });

	const hash = await bcrypt.hash(password, 10);

	// [前端注意] 数据结构变更：使用 username 作为 key 存储
	users[username] = {
		name: name,
		password: hash,
		// Use null for bestTime to remain JSON safe and easy to check
		stats: Object.fromEntries(
			Object.keys(MODES).map((mode) => [
				mode,
				{ games: 0, wins: 0, bestTime: null },
			]),
		),
		// default UI settings for the user
		settings: {
			volume: 70,
			showTimer: true,
			enableAnimations: true,
			autoRevealBlank: true,
			// preference for which mode to display by default (stats panel)
			statsMode: "classic",
		},
	};

	await writeUsers(users);
	res.json({ success: true });
});

app.post("/login", async (req, res) => {
	const { username, password } = req.body;
	const users = await readUsers();
	// 直接通过 key 获取用户对象
	const user = users[username];
	if (!user || !(await bcrypt.compare(password, user.password))) {
		return res.json({ success: false, msg: "Invalid credentials" });
	}
	// 生成 Session Token
	const token = crypto.randomBytes(16).toString("hex");
	SESSIONS.set(token, username);
	// 返回昵称 name 字段
	res.json({ success: true, username, name: user.name, token });
});

app.post("/verify", (req, res) => {
	const { username, token } = req.body;
	if (SESSIONS.has(token) && SESSIONS.get(token) === username) {
		res.json({ success: true });
	} else {
		res.json({ success: false });
	}
});

app.get("/stats/:username", async (req, res) => {
	const users = await readUsers();
	// [前端注意] 数据结构变更：直接通过 key 获取
	const user = users[req.params.username];
	res.json(user?.stats || {});
});

// Get user settings (protected by token)
app.get("/settings/:username", async (req, res) => {
	const uname = req.params.username;
	const token = req.headers["x-session-token"] || req.query.token;
	if (!token || !SESSIONS.has(token) || SESSIONS.get(token) !== uname)
		return res.status(401).json({ success: false });
	const users = await readUsers();
	const user = users[uname];
	res.json(user?.settings || {});
});

// Update user settings (write-through, require token)
app.post("/settings", async (req, res) => {
	const { username, token, settings } = req.body || {};
	if (
		!username ||
		!token ||
		!settings ||
		!SESSIONS.has(token) ||
		SESSIONS.get(token) !== username
	) {
		return res.status(401).json({ success: false });
	}
	try {
		const users = await readUsers();
		if (!users[username]) return res.status(404).json({ success: false });
		// Basic validation and merge
		const userSettings = users[username].settings || {};
		users[username].settings = {
			...userSettings,
			volume: Math.max(
				0,
				Math.min(100, Number(settings.volume || userSettings.volume || 70)),
			),
			showTimer:
				settings.showTimer === undefined
					? (userSettings.showTimer ?? true)
					: !!settings.showTimer,
			enableAnimations:
				settings.enableAnimations === undefined
					? (userSettings.enableAnimations ?? true)
					: !!settings.enableAnimations,
			autoRevealBlank:
				settings.autoRevealBlank === undefined
					? (userSettings.autoRevealBlank ?? true)
					: !!settings.autoRevealBlank,
			statsMode: settings.statsMode || userSettings.statsMode || "classic",
		};
		await writeUsers(users);
		res.json({ success: true });
	} catch (e) {
		console.error("Error saving settings:", e);
		res.status(500).json({ success: false });
	}
});

// ==================== Socket.IO ====================

// 内存中的房间状态 (用于实时游戏逻辑)
// 注意：持久化的 lobbies.json 主要用于大厅列表展示，实时状态存在内存中
const rooms = new Map();
const SESSIONS = new Map(); // token -> username

// 启动时从 lobbies.json 加载房间到内存 (可选，如果需要重启后恢复房间)
// 目前逻辑是重启后房间清空，lobbies.json 仅作为持久化记录

function getLobbyList() {
	return Array.from(rooms.entries()).map(([id, r]) => ({
		id,
		name: r.roomName,
		host: r.playerInfo.get(r.hostId)?.name || "Unknown",
		hostUsername: r.playerInfo.get(r.hostId)?.username, // [Fix] Send username for logic checks
		players: r.players.size,
		mode:
			r.settings.mode === "custom" && r.settings.customParams
				? `custom (${r.settings.customParams.w}x${r.settings.customParams.h}, ${r.settings.customParams.m} mines)`
				: r.settings.mode,
		status: r.state && !r.state.gameOver ? "Playing" : "Waiting",
	}));
}

function broadcastLobbyList() {
	io.emit("lobbyList", getLobbyList());
}

io.on("connection", (socket) => {
	let username = null;

	socket.emit("lobbyList", getLobbyList());

	socket.on("auth", (user) => {
		username = user;
	});

	socket.on("createLobby", async (requestedRoomName) => {
		if (!username) return;

		const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
		const roomName = requestedRoomName?.trim() || `${username}'s Room`;

		socket.join(roomId);

		// 1. 更新内存状态
		// [Refactor] 获取用户昵称
		const users = await readUsers();
		const nickname = users[username]?.name || username;

		const roomData = {
			roomName,
			hostId: socket.id,
			players: new Set([socket.id]),
			playerInfo: new Map([[socket.id, { username, name: nickname }]]), // Store full info
			settings: { mode: "classic", customParams: null },
		};
		rooms.set(roomId, roomData);

		// 2. 更新持久化存储 (lobbies.json)
		const lobbies = await readLobbies();
		lobbies[roomId] = {
			id: roomId,
			name: roomName,
			host: username,
			players: [username], // Keep simple list for persistence or update if needed
			settings: { mode: "classic", customParams: null },
			status: "waiting",
		};
		await writeLobbies(lobbies);

		socket.emit("lobbyCreated", { roomId, roomName });

		// [Refactor] Send players with host info
		const playersList = Array.from(roomData.playerInfo.entries()).map(
			([sid, p]) => ({
				...p,
				isHost: sid === roomData.hostId,
			}),
		);
		io.to(roomId).emit("playersUpdate", playersList);
		broadcastLobbyList();
	});

	socket.on("joinLobby", async (roomId) => {
		if (!username) return;
		const upperId = roomId.toUpperCase();
		const room = rooms.get(upperId);

		if (!room || room.players.size >= 4) {
			return socket.emit("joinError", "Room not found or full");
		}

		// [Refactor] 获取用户昵称
		const users = await readUsers();
		const nickname = users[username]?.name || username;

		// Check if this user is the original host (from persistence)
		const lobbiesCheck = await readLobbies();
		const lobby = lobbiesCheck[upperId];
		if (lobby && lobby.host === username) {
			room.hostId = socket.id; // Reclaim host status
		}

		// 在 socket.join(upperId) 之前，清理房间中可能已存在的相同 username（比如刷新重连的旧 socket）
		for (const [sid, info] of room.playerInfo.entries()) {
			if (info.username === username) {
				room.playerInfo.delete(sid);
				room.players.delete(sid);
				// （也可以尝试通知旧 socket）但我们只清理数据结构即可
			}
		}

		socket.join(upperId);
		room.players.add(socket.id);
		room.playerInfo.set(socket.id, { username, name: nickname });

		// 更新持久化存储（仅在不存在时加入）
		const lobbies = await readLobbies();
		if (lobbies[upperId]) {
			if (!lobbies[upperId].players.includes(username)) {
				lobbies[upperId].players.push(username);
				await writeLobbies(lobbies);
			}
		}

		io.to(upperId).emit(
			"playersUpdate",
			Array.from(room.playerInfo.entries()).map(([sid, p]) => ({
				...p,
				isHost: sid === room.hostId,
			})),
		);
		socket.emit("joinedLobby", { roomId: upperId, roomName: room.roomName });
		socket.emit("modeSet", {
			mode: room.settings.mode,
			customParams: room.settings.customParams || null,
		});

		// If there are active signals in this room, send a snapshot to the joining client
		if (room.state && room.state.signals && room.state.signals.length) {
			socket.emit("signalsSnapshot", room.state.signals);
		}

		// [Modified] Only send game state if the game is actively playing.
		// If the game is over, new joiners should wait in the lobby for the next game.
		if (room.state && room.state.board && !room.state.gameOver) {
			// 发送游戏开始信号（带上当前的棋盘和揭开状态）
			socket.emit("gameStarted", {
				board: room.state.board,
				revealed: room.state.revealed,
				flagged: room.state.flagged,
				roomId: upperId,
				mode: room.settings.mode,
				startTime: room.state.startTime,
			});
		}
		broadcastLobbyList();
	});

	socket.on("setMode", async ({ roomId, mode }) => {
		const room = rooms.get(roomId);
		if (room && room.hostId === socket.id && MODES[mode]) {
			room.settings.mode = mode;

			// 更新持久化存储
			const lobbies = await readLobbies();
			if (lobbies[roomId]) {
				// Keep previous customParams if present
				if (mode === "custom") {
					lobbies[roomId].settings = {
						mode: "custom",
						customParams: room.settings.customParams || null,
					};
				} else {
					lobbies[roomId].settings = { mode };
				}
				await writeLobbies(lobbies);
			}

			io.to(roomId).emit("modeSet", {
				mode,
				customParams: room.settings.customParams || null,
			});
		}
	});

	socket.on("startGame", (roomId) => {
		const room = rooms.get(roomId);
		if (room && room.hostId === socket.id) {
			let w, h, m;
			if (room.settings.mode === "custom" && room.settings.customParams) {
				w = Number(room.settings.customParams.w);
				h = Number(room.settings.customParams.h);
				m = Number(room.settings.customParams.m);
			} else {
				({ w, h, m } = MODES[room.settings.mode]);
			}
			// Validate values
			if (!w || !h || !m || w < 1 || h < 1 || m < 1 || m > w * h - 1) {
				// If custom mode but no valid params, notify host and do not start
				if (
					room.settings.mode === "custom" &&
					(!room.settings.customParams || !room.settings.customParams.w)
				) {
					socket.emit(
						"startError",
						"Invalid custom parameters. Please set width/height/mines before starting.",
					);
					return;
				}
				// Otherwise fallback to classic
				({ w, h, m } = MODES.classic);
			}
			const board = generateBoard(w, h, m);
			const revealed = Array(h)
				.fill()
				.map(() => Array(w).fill(false));
			const flagged = Array(h)
				.fill()
				.map(() => Array(w).fill(0));

			room.state = {
				board,
				revealed,
				flagged,
				signals: [],
				startTime: Date.now(),
				gameOver: false,
				mines: m, // Store mines count for updates
			};

			io.to(roomId).emit("gameStarted", {
				board,
				revealed,
				flagged,
				roomId,
				mode: room.settings.mode,
				startTime: room.state.startTime,
				w,
				h,
				m,
				signals: room.state.signals || [],
			});
			broadcastLobbyList();
		}
	});

	socket.on("restartGame", (roomId) => {
		const room = rooms.get(roomId);
		// 只有房主可以重置，或者允许任何人重置(看你需求，这里暂定房主)
		// 为了方便测试，暂时允许房间内任何人触发，或者你可以加上 && room.hostId === socket.id
		if (room) {
			// 关键：重置服务器端的游戏结束状态
			room.state.gameOver = false;
			room.state.winner = null;

			// 重置盘面状态 (清空已翻开和旗子，但保留 board 炸弹位置不变)
			const h = room.state.board.length;
			const w = room.state.board[0].length;
			room.state.revealed = Array(h)
				.fill()
				.map(() => Array(w).fill(false));
			room.state.flagged = Array(h)
				.fill()
				.map(() => Array(w).fill(0));
			// Clear any signals on restart
			room.state.signals = [];
			room.state.startTime = Date.now();

			// 通知所有客户端游戏已重置
			io.to(roomId).emit("gameRestarted", {
				startTime: room.state.startTime,
				revealed: room.state.revealed,
				flagged: room.state.flagged,
			});
			broadcastLobbyList(); // [Fix] Update lobby status to 'Playing'
		}
	});

	// =====================================================================================
	// [新增功能开发区] 待前端/全栈同学实现的交互逻辑
	// 目标：实现 README 中描述的实时协作、信号系统、自定义模式及胜负判定
	// =====================================================================================

	// 1. 处理点击翻开格子 (Gameplay - Reveal)
	// 前端调用: socket.emit('revealTile', { roomId, r, c })
	socket.on("revealTile", async ({ roomId, r, c }) => {
		const room = rooms.get(roomId);
		if (!room || !room.state || room.state.gameOver) return;

		const board = room.state.board;
		const revealed = room.state.revealed;
		const flagged = room.state.flagged;

		// TODO 1: 获取 room.state.board[r][c] 的值

		if (revealed[r][c] || flagged[r][c]) return;

		// TODO 2: 如果是雷 (-1):
		//    - 设置 room.state.gameOver = true
		//    - 更新统计数据 (stats) 记录失败
		//    - 广播 'gameOver' 事件: io.to(roomId).emit('gameOver', { winner: false, bomb: {r, c} })

		if (board[r][c] === -1) {
			room.state.gameOver = true;
			room.state.winner = false;
			room.state.bombPos = { r, c };
			// Update Stats (Loss)
			await updateRoomStats(room, { winner: false });

			// Show all mines to all the players
			for (let y = 0; y < board.length; y++) {
				for (let x = 0; x < board[0].length; x++) {
					if (board[y][x] === -1) revealed[y][x] = true;
				}
			}

			io.to(roomId).emit("gameOver", {
				winner: false,
				bomb: { r, c },
				board: room.state.board,
				revealed: room.state.revealed,
			});
			broadcastLobbyList();
			return;
		}

		// TODO 3: 如果是数字 (>0):
		//    - 仅更新 room.state.revealed[r][c] = true
		//    - 广播 'boardUpdate' 事件: io.to(roomId).emit('boardUpdate', { revealed: room.state.revealed })

		// TODO 4: 如果是空白 (0):
		//    - 执行 Flood Fill 算法，递归翻开周围所有空白及边缘数字
		//    - 更新 room.state.revealed
		//    - 广播 'boardUpdate'

		// Read user autoReveal preference to decide whether to flood fill
		let userAutoReveal = true;
		try {
			const users = await readUsers();
			const user = users[username];
			if (
				user &&
				user.settings &&
				typeof user.settings.autoRevealBlank === "boolean"
			)
				userAutoReveal = !!user.settings.autoRevealBlank;
		} catch (e) {
			/* ignore, default true */
		}

		if (board[r][c] === 0 && userAutoReveal) {
			const stack = [[c, r]];
			while (stack.length) {
				const [x, y] = stack.pop();
				if (x < 0 || x >= board[0].length || y < 0 || y >= board.length)
					continue;
				if (revealed[y][x] || flagged[y][x]) continue;

				revealed[y][x] = true;

				if (board[y][x] === 0) {
					for (let dy = -1; dy <= 1; dy++) {
						for (let dx = -1; dx <= 1; dx++) {
							if (dx === 0 && dy === 0) continue;
							stack.push([x + dx, y + dy]);
						}
					}
				}
			}
		} else {
			revealed[r][c] = true;
		}

		// TODO 5: 检查胜利条件 (所有非雷格子都已翻开)
		//    - 若胜利: 更新统计数据, 广播 'gameOver' { winner: true }

		let win = true;
		for (let y = 0; y < board.length; y++) {
			for (let x = 0; x < board[y].length; x++) {
				if (board[y][x] !== -1 && !revealed[y][x]) {
					win = false;
					break;
				}
			}
			if (!win) break;
		}

		if (win) {
			room.state.gameOver = true;
			room.state.winner = true;
			const time = Date.now() - room.state.startTime;
			// Update Stats (Win)
			await updateRoomStats(room, { winner: true, time });

			io.to(roomId).emit("gameOver", {
				winner: true,
				time: time,
			});
			broadcastLobbyList();
		}

		// Broadcast the updated revealed state
		io.to(roomId).emit("boardUpdate", {
			revealed: room.state.revealed,
			flagged: room.state.flagged,
		});
	});

	// 2. 处理插旗/标记 (Gameplay - Flag)
	// 前端调用: socket.emit('toggleFlag', { roomId, r, c })
	socket.on("toggleFlag", ({ roomId, r, c, state }) => {
		const room = rooms.get(roomId);
		if (!room || !room.state || room.state.gameOver) return;

		// TODO: 切换 room.state.flagged[r][c] 的状态
		// TODO: 广播 'flagUpdate' 事件: io.to(roomId).emit('flagUpdate', { r, c, isFlagged: ... })

		room.state.flagged[r][c] = state;

		// 广播更新 (注意这里事件名改为了 flagSet，或者保持 flagUpdate 但带上具体值)
		io.to(roomId).emit("flagUpdate", {
			r,
			c,
			state: state, // 发送具体的 0, 1, 2
		});

		// 更新剩余雷数 (只统计状态为 1 的旗子)
		const flags = room.state.flagged.flat().filter((f) => f === 1).length;
		io.to(roomId).emit("minesLeftUpdate", room.state.mines - flags);
	});

	// 1.5-click / chord: reveal surrounding tiles if flagged count equals the number displayed
	// 前端调用: socket.emit('chordTile', { roomId, r, c })
	socket.on("chordTile", async ({ roomId, r, c }) => {
		const room = rooms.get(roomId);
		if (!room || !room.state || room.state.gameOver) return;

		const board = room.state.board;
		const revealed = room.state.revealed;
		const flagged = room.state.flagged;

		if (!revealed[r][c]) return; // only on already revealed tiles
		const val = board[r][c];
		if (val <= 0) return; // only numbers > 0 can be chording targets

		// Count adjacent flags
		let flagCount = 0;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dy === 0) continue;
				const ny = r + dy,
					nx = c + dx;
				if (ny >= 0 && ny < board.length && nx >= 0 && nx < board[0].length) {
					if (flagged[ny][nx] === 1) flagCount++;
				}
			}
		}

		if (flagCount !== val) {
			// If mismatch, we don't perform chord - send back a small hint to requester
			try {
				socket.emit("chordFail", { r, c, reason: "flagMismatch" });
			} catch (e) {}
			return;
		}

		// Perform reveal for all adjacent unopened, unflagged tiles
		let userAutoReveal = true;
		try {
			const users = await readUsers();
			const u = users[username] || {};
			if (u && u.settings && typeof u.settings.autoRevealBlank === "boolean")
				userAutoReveal = !!u.settings.autoRevealBlank;
		} catch (e) {
			/* ignore default true */
		}

		const toRevealStack = [];
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dy === 0) continue;
				const ny = r + dy,
					nx = c + dx;
				if (ny >= 0 && ny < board.length && nx >= 0 && nx < board[0].length) {
					if (flagged[ny][nx] === 1 || revealed[ny][nx]) continue;
					toRevealStack.push([nx, ny]);
				}
			}
		}

		let exploded = false;
		// We'll iterate, and if any mine is revealed, handle game over
		const processStack = [];
		for (const [sx, sy] of toRevealStack) processStack.push([sx, sy]);

		while (processStack.length) {
			const [x, y] = processStack.pop();
			if (x < 0 || x >= board[0].length || y < 0 || y >= board.length) continue;
			if (revealed[y][x] || flagged[y][x] === 1) continue;
			if (board[y][x] === -1) {
				// A mine was accidentally revealed = game over
				revealed[y][x] = true;
				exploded = true;
				break;
			}
			// Reveal tile
			revealed[y][x] = true;
			// If it's a zero and autoReveal allowed, flood outwards
			if (board[y][x] === 0 && userAutoReveal) {
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						const ny = y + dy,
							nx = x + dx;
						if (
							ny >= 0 &&
							ny < board.length &&
							nx >= 0 &&
							nx < board[0].length
						) {
							if (!revealed[ny][nx] && flagged[ny][nx] !== 1) {
								processStack.push([nx, ny]);
							}
						}
					}
				}
			}
		}

		if (exploded) {
			room.state.gameOver = true;
			room.state.winner = false;
			// reveal all mines for display
			for (let y = 0; y < board.length; y++) {
				for (let x = 0; x < board[0].length; x++) {
					if (board[y][x] === -1) revealed[y][x] = true;
				}
			}
			await updateRoomStats(room, { winner: false });
			io.to(roomId).emit("gameOver", {
				winner: false,
				board: room.state.board,
				revealed: room.state.revealed,
			});
			broadcastLobbyList();
			return;
		}

		// After reveals, check victory condition
		let win = true;
		for (let y = 0; y < board.length; y++) {
			for (let x = 0; x < board[0].length; x++) {
				if (board[y][x] !== -1 && !revealed[y][x]) {
					win = false;
					break;
				}
			}
			if (!win) break;
		}

		if (win) {
			room.state.gameOver = true;
			room.state.winner = true;
			const time = Date.now() - room.state.startTime;
			await updateRoomStats(room, { winner: true, time });
			io.to(roomId).emit("gameOver", { winner: true, time });
			broadcastLobbyList();
			return;
		}

		// Otherwise broadcast the updated revealed/flagged map
		io.to(roomId).emit("boardUpdate", {
			revealed: room.state.revealed,
			flagged: room.state.flagged,
		});
	});

	// 3. 鼠标拖拽信号系统 (Gameplay - Signals)
	// 前端调用: socket.emit('sendSignal', { roomId, type, r, c })
	// type: 'help' (left), 'onMyWay' (right), 'avoid' (up), 'question' (down)
	socket.on("sendSignal", ({ roomId, type, r, c }) => {
		const room = rooms.get(roomId);
		if (!room || !room.state) return;
		const allowed = new Set(["help", "onMyWay", "avoid", "question"]);
		if (!allowed.has(type)) return;
		const board = room.state.board;
		if (!board || r < 0 || r >= board.length || c < 0 || c >= board[0].length)
			return;

		// Create a signal entry
		const id = Math.random().toString(36).substring(2, 9).toUpperCase();
		const ttl = 3000; // ms
		const signal = {
			id,
			type,
			r,
			c,
			fromUser: username,
			expiresAt: Date.now() + ttl,
		};

		// Ensure room state has signals array
		if (!room.state.signals) room.state.signals = [];
		room.state.signals.push(signal);

		// Broadcast to entire room (including sender)
		io.to(roomId).emit("signalReceived", signal);

		// Schedule removal after TTL
		setTimeout(() => {
			try {
				// Remove expired signal
				if (!room.state || !room.state.signals) return;
				room.state.signals = room.state.signals.filter((s) => s.id !== id);
				io.to(roomId).emit("signalExpired", { id });
			} catch (e) {
				/* ignore */
			}
		}, ttl);
	});

	// 4. 自定义难度设置 (Lobby - Custom Mode)
	// 前端调用: socket.emit('setCustomMode', { roomId, w, h, m })
	socket.on("setCustomMode", ({ roomId, w, h, m }) => {
		const room = rooms.get(roomId);
		if (room && room.hostId === socket.id) {
			// Validate ranges
			const minW = 5,
				maxW = 50,
				minH = 5,
				maxH = 30;
			w = Number(w);
			h = Number(h);
			m = Number(m);
			if (!Number.isInteger(w) || !Number.isInteger(h) || !Number.isInteger(m))
				return;
			if (w < minW || w > maxW || h < minH || h > maxH)
				return socket.emit("modeSetError", "Width/Height out of allowed range");
			if (m < 1 || m > w * h - 1)
				return socket.emit("modeSetError", "Mine count out of range");

			room.settings.mode = "custom";
			room.settings.customParams = { w, h, m };

			// Tell the requester explicitly it's accepted and broadcast to the room
			socket.emit("modeSet", {
				mode: "custom",
				customParams: room.settings.customParams,
			});

			// Update persistence
			(async () => {
				const lobbies = await readLobbies();
				if (lobbies[roomId]) {
					lobbies[roomId].settings = {
						mode: "custom",
						customParams: { w, h, m },
					};
					await writeLobbies(lobbies);
				}
			})();

			io.to(roomId).emit("modeSet", {
				mode: "custom",
				customParams: room.settings.customParams,
			});
		}
	});

	// 5. Cheating feature removed for redesign: toggleCheat handler removed

	// 6. 删除房间 (Host Only)
	socket.on("deleteRoom", async (roomId) => {
		const room = rooms.get(roomId);
		// Check if room exists and requester is host
		if (room && room.hostId === socket.id) {
			// Notify all players
			io.to(roomId).emit("roomDeleted");

			// Clear from memory
			rooms.delete(roomId);

			// Clear from persistence
			const lobbies = await readLobbies();
			if (lobbies[roomId]) {
				delete lobbies[roomId];
				await writeLobbies(lobbies);
			}

			// Broadcast update
			broadcastLobbyList();
		}
	});

	// =====================================================================================
	// [新增功能开发区结束]
	// =====================================================================================

	socket.on("leaveRoom", async ({ roomId }) => {
		const room = rooms.get(roomId);
		if (room && room.players.has(socket.id)) {
			// 1. Identify user
			const leavingUser = room.playerInfo.get(socket.id)?.username || username;

			// 2. Remove from memory
			room.players.delete(socket.id);
			room.playerInfo.delete(socket.id);

			// 3. Update persistence
			const lobbies = await readLobbies();
			if (lobbies[roomId]) {
				if (leavingUser) {
					lobbies[roomId].players = (lobbies[roomId].players || []).filter(
						(u) => u !== leavingUser,
					);
				}
				await writeLobbies(lobbies);
			}

			// 4. Update room players list
			if (room.players.size > 0) {
				io.to(roomId).emit(
					"playersUpdate",
					Array.from(room.playerInfo.entries()).map(([sid, p]) => ({
						...p,
						isHost: sid === room.hostId,
					})),
				);
			} else {
				// If no players left, game ends
				if (room.state) {
					room.state.gameOver = true;
				}
			}

			// 5. Broadcast update
			broadcastLobbyList();
		}
	});

	socket.on("disconnect", async () => {
		console.log(`${username || "Someone"} disconnected`);

		for (const [roomId, room] of rooms.entries()) {
			if (room.players.has(socket.id)) {
				// 1. Identify user
				const leavingUser =
					room.playerInfo.get(socket.id)?.username || username;

				// 2. Remove from memory
				room.players.delete(socket.id);
				room.playerInfo.delete(socket.id);

				// 3. Update persistence (Remove player from list, but KEEP ROOM)
				const lobbies = await readLobbies();
				if (lobbies[roomId]) {
					if (leavingUser) {
						lobbies[roomId].players = (lobbies[roomId].players || []).filter(
							(u) => u !== leavingUser,
						);
					}
					// Requirement 8: Do not destroy room even if empty
					await writeLobbies(lobbies);
				}

				// 4. Update room players list for remaining players
				if (room.players.size > 0) {
					io.to(roomId).emit(
						"playersUpdate",
						Array.from(room.playerInfo.entries()).map(([sid, p]) => ({
							...p,
							isHost: sid === room.hostId,
						})),
					);
				} else {
					// Requirement 10: If no players left, game ends
					if (room.state) {
						room.state.gameOver = true;
						// [New] If game was in progress, count as loss for stats?
						// Or just end it. For now, just end it.
					}
				}

				// 5. Host handling
				// We leave room.hostId as is (pointing to dead socket).
				// If host reconnects, joinLobby will restore their status based on lobbies.json

				broadcastLobbyList();
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
					const nr = r + dr,
						nc = c + dc;
					if (
						nr >= 0 &&
						nr < height &&
						nc >= 0 &&
						nc < width &&
						board[nr][nc] === -1
					)
						count++;
				}
			}
			board[r][c] = count;
		}
	}
	return board;
}

// 更新房间玩家的统计数据 (统一处理胜利/失败情况)
// - 对所有在房间内的玩家统计 games++
// - 如果是胜利: wins++ 并更新 bestTime 当本次时间更快
async function updateRoomStats(room, { winner = false, time = null } = {}) {
	try {
		const users = await readUsers();
		const mode = room?.settings?.mode;
		if (!users || !mode) return;

		for (const [sid, info] of room.playerInfo.entries()) {
			const username = info.username;
			if (!username) continue;
			const u = users[username];
			if (!u) continue;

			// Ensure stats structure exists
			if (!u.stats) u.stats = {};
			if (!u.stats[mode]) u.stats[mode] = { games: 0, wins: 0, bestTime: null };

			// Always increment games count for a finished round
			u.stats[mode].games = (u.stats[mode].games || 0) + 1;

			if (winner) {
				u.stats[mode].wins = (u.stats[mode].wins || 0) + 1;
				if (typeof time === "number" && Number.isFinite(time)) {
					const curBest = u.stats[mode].bestTime;
					// treat null/undefined/Infinity as not set
					if (!Number.isFinite(curBest) || curBest === null) {
						u.stats[mode].bestTime = time;
					} else if (time < curBest) {
						u.stats[mode].bestTime = time;
					}
				}
			}
		}

		await writeUsers(users);
	} catch (e) {
		console.error("Error updating stats:", e);
	}
}

// ==================== 启动服务器 ====================

server.listen(8000, () => {
	console.log("Multisweeper 服务器启动成功! http://localhost:8000");
});

// 优雅退出：清空房间数据
const cleanup = () => {
	console.log("\n正在关闭服务器，清理房间数据...");
	try {
		fs.writeFileSync("db/lobbies.json", "{}");
		console.log("Lobbies 已清空。");
	} catch (e) {
		console.error("清理失败:", e);
	}
	process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
