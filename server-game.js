import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
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
app.use(express.static("core"));
app.use(express.json());

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

app.post("/create-room", (req, res) => {
	const { w, h, c } = req.body;
	if (!w || !h || !c) {
		return res.status(400).json({ error: "Missing w, h, or c." });
	}
	const room = randomUUID();
	rooms.set(room, new Game(w, h, c));
	res.json({ room });
});

// Socket.IO connection handler
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
		const mine = game.mines - [...board(game.w, game.h)].map(([x, y]) => game.apply(x, y)).filter(t => t === TileFlag).length;
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
			`[${socket.id}] User ${user} sends ${type} at (${x}, ${y}) in room ${room}.`
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

// Start the server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});
