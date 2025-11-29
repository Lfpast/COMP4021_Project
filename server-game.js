import fs, { write } from "node:fs";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import { shuffle } from "es-toolkit";
import express from "express";
import session from "express-session";
import { Server } from "socket.io";
import { board } from "./core/board.js";
import { Game } from "./core/game.js";
import { TileFlag } from "./core/tile.js";

const app = express();
const httpServer = createServer(app);

// Configure Socket.IO with CORS settings if necessary
const io = new Server(httpServer, {
	cors: {
		origin: "*", // Adjust this to your client's URL in production
		methods: ["GET", "POST"],
	},
});

// Serve static files (optional, if serving client from same server)
app.use(express.static("public"));
app.use(express.json());
const userSession = session({
	secret: "user",
	resave: false,
	saveUninitialized: false,
	rolling: true,
	cookie: { maxAge: 300000 },
});
app.use(userSession);

// ============
// === Game ===
// ============

/**
 * @type {Map<string, Game>}
 */
const rooms = new Map();
/**
 * @type {Map<string, Map<string, number>>}
 */
const userIndices = new Map();
/**
 * @type {Map<string, number>}
 */
const gameEpoch = new Map();

io.on("connection", (socket) => {
	const user = socket.handshake.query.user;
	const room = socket.handshake.query.room;

	if (!user || typeof user !== "string") {
		console.log(`Connection rejected: No user for socket ${socket.id}`);
		socket.disconnect();
		return;
	}
	if (!room || typeof room !== "string") {
		console.log(`Connection rejected: No room for socket ${socket.id}`);
		socket.disconnect();
		return;
	}

	const game = rooms.get(room);
	if (!game) {
		console.log(
			`Connection rejected: Invalid room ${room} for socket ${socket.id}`,
		);
		socket.disconnect();
		return;
	}

	if (!userIndices.has(room)) {
		userIndices.set(room, new Map());
	}

	const indices = userIndices.get(room);
	if (!indices) {
		throw new Error("Unreachable");
	}

	if (!indices.has(user)) {
		indices.set(user, indices.size);
	}
	const userIndex = indices.get(user);
	if (userIndex === undefined) {
		throw new Error("Unreachable");
	}

	socket.emit("init board", { w: game.w, h: game.h, c: game.mines });
	socket.emit("update board", {
		b: game.board().toPlain(),
		cs: [...board(game.w, game.h)],
	});

	/**
	 * @type {NodeJS.Timeout | null}
	 */
	let updater = null;
	const update = () => {
		const epoch = gameEpoch.get(room);
		const time = epoch ? Math.floor((Date.now() - epoch) / 1000) : 0;
		const mine =
			game.mines -
			[...board(game.w, game.h)]
				.map(([x, y]) => game.apply(x, y))
				.filter((t) => t === TileFlag).length;
		io.to(room).emit("update status", {
			gameStatus: game.isGameOver(),
			timeDisplay: time,
			mineDisplay: mine,
		});
	};
	update();

	const unsubscribe = game.subscribe((b, cs) => {
		console.log(`[${socket.id}] Board update in room ${room}`);
		io.to(room).emit("update board", { b: b.toPlain(), cs });
		update();
		if (!gameEpoch.has(room)) {
			gameEpoch.set(room, Date.now());
			updater = setInterval(update, 1000);
		}
	});

	console.log(`[${socket.id}] User ${user} connect to room ${room}.`);

	socket.join(room);
	socket.to(room).emit("user join", socket.id);

	/**
	 * The event that a player reveals a tile.
	 */
	socket.on("reveal", ({ x, y }) => {
		console.log(
			`[${socket.id}] User ${user} reveals tile at (${x}, ${y}) in room ${room}.`,
		);
		game.reveal(x, y);
	});

	/**
	 * The event that a player flags a tile.
	 */
	socket.on("flag", ({ x, y }) => {
		console.log(
			`[${socket.id}] User ${user} flags tile at (${x}, ${y}) in room ${room}.`,
		);
		game.flag(x, y);
	});

	/**
	 * The player signal event.
	 */
	socket.on("signal", ({ type, x, y }) => {
		console.log(
			`[${socket.id}] User ${user} sends ${type} at (${x}, ${y}) in room ${room}.`,
		);
		io.to(room).emit("signal", { type, x, y });
	});

	/**
	 * The mouse move event of a player.
	 */
	socket.on("move", ({ x, y }) => {
		console.log(`[${socket.id}] User ${user} moves mouse in room ${room}:`, {
			x,
			y,
		});
		io.to(room).emit("move", { ui: userIndex, x, y });
	});

	// Handle disconnection
	socket.on("disconnect", (reason) => {
		console.log(
			`[${socket.id}] User ${user} disconnect from room ${room} (Reason: ${reason})`,
		);
		unsubscribe();
		if (updater !== null) {
			clearInterval(updater);
			updater = null;
		}
	});
});

// =============
// === Lobby ===
// =============

const Modes = ["simple", "medium", "expert"];

/**
 * @type {Record<string, {
 * 	 name: string,
 *   game: string
 * 	 players: string[],
 *   w: number,
 *   h: number,
 *   c: number,
 * }>}
 */
const lobbies = {};

const randomCode = () => {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	const code = shuffle(chars.split(""));
	return code.slice(0, 6).join("");
};

io.of("/lobby").on("connection", (socket) => {
	const player = socket.handshake.query.player;
	if (!player || typeof player !== "string") {
		console.log(`[${socket.id}] Connection rejected: No player provided.`);
		socket.disconnect();
		return;
	}

	console.log(`[${socket.id}] Player ${player} connected.`);

	socket.emit("update lobbies", { lobbies });

	socket.on("disconnect", (reason) => {
		Object.entries(lobbies).forEach(([game, lobby]) => {
			if (lobby.players.includes(player)) {
				lobby.players = lobby.players.filter((p) => p !== player);
				io.to(game).emit("user leave", player);
				if (lobby.players.length === 0) {
					delete lobbies[game];
					console.log(
						`[${socket.id}] Lobby ${game} disappears due to no players.`,
					);
				}
			}
		});
		console.log(
			`[${socket.id}] Player ${player} disconnected (Reason: ${reason}).`,
		);
	});

	socket.on("create lobby", ({ name, w, h, c }) => {
		const game = randomCode();
		lobbies[game] = {
			name,
			game,
			players: [],
			w,
			h,
			c,
		};
		socket.emit("create lobby", { game });
		io.of("/lobby").emit("update lobbies", { lobbies });
		console.log(
			`[${socket.id}] Player ${player} create lobby ${game} (${name}).`,
		);
	});

	socket.on("join lobby", ({ game }) => {
		const lobby = lobbies[game];
		if (!lobby) {
			socket.emit("error", { message: "Lobby not found." });
			return;
		}

		if (!lobby.players.includes(player)) {
			if (lobby.players.length >= 8) {
				socket.emit("error", { message: "Lobby is full." });
				return;
			}
			lobby.players.push(player);
		}

		socket.join(game);
		io.of("/lobby").emit("update lobbies", { lobbies });
		io.of("/lobby").to(game).emit("user join", lobby);
		console.log(
			`[${socket.id}] Player ${player} join lobby ${game} (${lobby.name}).`,
		);
	});

	socket.on("launch game", ({ game }) => {
		const lobby = lobbies[game];
		if (!lobby) {
			socket.emit("error", { message: "Lobby not found." });
			return;
		}

		rooms.set(game, new Game(lobby.w, lobby.h, lobby.c));

		io.of("/lobby").to(game).emit("launch game", { game });
		console.log(
			`[${socket.id}] Player ${player} launch game in lobby ${game} (${lobby.name}).`,
		);
	});
});

// =============
// === Login ===
// =============

/**
 * @typedef {{
 *   name: string,
 *   password: string,
 *   stats: Record<string, { games: number; wins: number; best: number | null }>
 * }} User
 */

/**
 * @returns {Record<string, User>}
 */
function readUsers() {
	if (!fs.existsSync("users.json")) writeUsers({});
	const data = fs.readFileSync("users.json", "utf-8");
	return JSON.parse(data);
}

/**
 * @param {Record<string, User>} users
 */
function writeUsers(users) {
	fs.writeFileSync("users.json", JSON.stringify(users, null, 2), "utf-8");
}

app.post("/register", async (req, res) => {
	const { username, password, name } = req.body;
	if (!username || !password || !name) {
		return res.json({ success: false, msg: "Missing fields" });
	}

	const users = await readUsers();

	if (users[username]) {
		return res.json({ success: false, msg: "User already exists" });
	}

	const passwordHash = await bcrypt.hash(password, 10);

	users[username] = {
		name: name,
		password: passwordHash,
		stats: Object.fromEntries(
			Modes.map((mode) => [mode, { games: 0, wins: 0, best: null }]),
		),
	};

	await writeUsers(users);
	res.json({ success: true });
});

app.post("/login", (req, res) => {
	const { username, password } = req.body;
	const users = readUsers();

	const user = users[username];
	if (!user) {
		return res.json({ success: false, msg: "User does not exist" });
	}

	if (!bcrypt.compareSync(password, user.password)) {
		return res.json({ success: false, msg: "Incorrect username or password" });
	}

	// @ts-expect-error
	req.session.user = { ...user, username };

	res.json({ success: true, user: { ...user, username } });
});

app.post("/verify", (req, res) => {
	// @ts-expect-error
	const { user } = req.session;
	if (user) {
		return res.json({ success: true, user });
	} else {
		return res.json({ success: false });
	}
});

// ==============
// === Others ===
// ==============

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});
