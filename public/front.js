// @ts-nocheck

// front.js - Adapted for server-game.js
console.info("front.js loaded");

// Global State
let currentUser = null;
let socket = null;


// Settings Defaults
let userSettings = {
	volume: 70,
};

document.addEventListener("DOMContentLoaded", () => {
	loadSettings();
	loadSideMenu();
	checkSession();
});

function loadSideMenu() {
	fetch("side-menu.html")
		.then((r) => r.text())
		.then((t) => {
			document.body.insertAdjacentHTML("beforeend", t);
			initSideMenu();
		});
}

function checkSession() {
	$.post("/verify")
		.done((data) => {
			if (data.success) {
				currentUser = data.user;
				initMainPage();
			} else {
				showLoginModal();
			}
		})
		.fail(() => showLoginModal());

	// Bind login buttons just in case
	setTimeout(ensureLoginBindings, 50);
}

function ensureLoginBindings() {
	$("#registerBtn").off("click").on("click", handleRegister);
	$("#loginBtn").off("click").on("click", handleLogin);
}

function showLoginModal() {
	$("#loginModal").css("display", "flex");
	$("#sideMenuToggle").hide();
	ensureLoginBindings();
}

function showMessage(text, color = "#f66") {
	const el = $("#loginMsg");
	el.text(text).css({ color: color, opacity: "1" });
	setTimeout(() => {
		el.css("opacity", "0");
	}, 4000);
}

function showToast(text, duration = 2000) {
	// Simple toast implementation
	let toast = $("#toast");
	if (toast.length === 0) {
		toast = $("<div></div>")
			.attr("id", "toast")
			.css({
				position: "fixed",
				bottom: "20px",
				left: "50%",
				transform: "translateX(-50%)",
				background: "rgba(0,0,0,0.7)",
				color: "white",
				padding: "10px 20px",
				borderRadius: "5px",
				zIndex: "10000",
				display: "none",
			})
			.appendTo("body");
	}
	toast.text(text).show();
	setTimeout(() => {
		toast.hide();
	}, duration);
}

async function handleRegister() {
	const u = $("#regUsername").val().trim();
	const n = $("#regNickname").val().trim() || u;
	const p = $("#regPassword").val();
	const cp = $("#regConfirmPassword").val();

	if (!u || !n || !p || !cp) return showMessage("Fill all fields");
	if (p !== cp) return showMessage("Passwords do not match");

	try {
		const res = await fetch("/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: u, password: p, name: n }),
		});
		const data = await res.json();
		if (data.success) {
			showMessage("Registered! Please login.", "#4f4");
		} else {
			showMessage(data.msg || "Registration failed");
		}
	} catch (_e) {
		showMessage("Error registering");
	}
}

async function handleLogin() {
	const u = $("#loginUsername").val().trim();
	const p = $("#loginPassword").val();
	if (!u || !p) return showMessage("Enter credentials");

	try {
		const res = await fetch("/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: u, password: p }),
		});
		const data = await res.json();
		if (data.success) {
			currentUser = data.user;
			initMainPage();
		} else {
			showMessage(data.msg || "Login failed");
		}
	} catch (_e) {
		showMessage("Error logging in");
	}
}

function loadSettings() {
	const saved = localStorage.getItem("multisweeper_settings");
	if (saved) {
		try {
			userSettings = { ...userSettings, ...JSON.parse(saved) };
		} catch (_e) {}
	}
}

function loadStats(mode = "simple") {
	if (!currentUser || !currentUser.stats) return;
	const stats = currentUser.stats[mode] || { games: 0, wins: 0, best: null };

	$("#statGamesPlayed").text(stats.games);
	$("#statGamesWon").text(stats.wins);
	$("#statWinRate").text(
		stats.games > 0 ? `${Math.round((stats.wins / stats.games) * 100)}%` : "0%",
	);
	$("#statBestTime").text(stats.best !== null ? `${stats.best}s` : "--");
}

function initMainPage() {
	$("#loginModal").hide();
	$("#mainPage").show();
	$("#welcomeUser").text(currentUser.name);
	$("#sideMenuToggle").show();

	const statModeSelect = $("#statsModeSelect");
	if (statModeSelect.length) {
		statModeSelect.val(localStorage.getItem("statsMode") || "simple");
		loadStats(statModeSelect.val());
		statModeSelect.on("change", (e) => {
			localStorage.setItem("statsMode", e.target.value);
			loadStats(e.target.value);
		});
	} else {
		loadStats("simple");
	}

	connectSocket();

	$("#logoutBtn").off("click").on("click", async () => {
		// Clear session storage to prevent auto-rejoin
		sessionStorage.removeItem("currentLobbyId");
		
		try {
			await fetch("/logout", { method: "POST" });
			location.reload();
		} catch (e) {
			console.error("Logout failed", e);
			location.reload();
		}
	});

	$("#createLobbyBtn").off("click").on("click", () => {
		const name =
			$("#roomNameInput").val().trim() || `${currentUser.name}'s Room`;
		
		const mode = $("#modeSelect").val();
		let w = 9, h = 9, c = 10; // Default Simple

		if (mode === "medium") {
			w = 16; h = 16; c = 40;
		} else if (mode === "expert") {
			w = 30; h = 16; c = 99;
		} else if (mode === "custom") {
			w = Number($("#customW").val());
			h = Number($("#customH").val());
			c = Number($("#customM").val());
			
			// Basic validation fallback
			if (!w || w < 9) w = 9;
			if (w > 50) w = 50;
			if (!h || h < 9) h = 9;
			if (h > 30) h = 30;
			if (c === undefined || c === null || c < 0) c = 10;
		}

		socket.emit("create lobby", { name, w, h, c, mode });
	});

	$("#joinLobbyBtn").off("click").on("click", () => {
		const roomId = $("#roomInput").val().trim();
		if (roomId) socket.emit("join lobby", { game: roomId });
	});

	// --- Custom Mode & Room Management ---
	$("#modeSelect").off("change").on("change", (e) => {
		const mode = e.target.value;
		const customParamsDiv = $("#customParams");
		if (mode === "custom") {
			customParamsDiv.show();
		} else {
			customParamsDiv.hide();
		}
	});

	const customW = $("#customW");
	const customH = $("#customH");
	const customM = $("#customM");
	const customHint = $("#customHint");

	function validateCustomParams() {
		const createBtn = $("#createLobbyBtn");
		const mode = $("#modeSelect").val();
		
		if (mode !== "custom") {
			createBtn.prop("disabled", false);
			return;
		}

		const w = Number(customW.val() || 0);
		const h = Number(customH.val() || 0);
		const m = Number(customM.val() || 0);

		const maxM = Math.max(1, w * h - 9);

		const valid =
			Number.isInteger(w) &&
			w >= 9 &&
			w <= 50 &&
			Number.isInteger(h) &&
			h >= 9 &&
			h <= 30 &&
			Number.isInteger(m) &&
			m >= 0 &&
			m <= maxM;

		createBtn.prop("disabled", !valid);

		customW.toggleClass(
			"custom-invalid",
			!(Number.isInteger(w) && w >= 9 && w <= 50),
		);
		customH.toggleClass(
			"custom-invalid",
			!(Number.isInteger(h) && h >= 9 && h <= 30),
		);
		customM.toggleClass(
			"custom-invalid",
			!(Number.isInteger(m) && m >= 0 && m <= maxM),
		);

		if (valid) {
			customHint.text(`Mines max = ${maxM}`);
		} else {
			customHint.text(`W: 9-50, H: 9-30`);
		}
	}

	customW.off("input").on("input", validateCustomParams);
	customH.off("input").on("input", validateCustomParams);
	customM.off("input").on("input", validateCustomParams);
	$("#modeSelect").on("change", validateCustomParams);

	const lbModeSelect = $("#leaderboardModeSelect");
	if (lbModeSelect.length) {
		lbModeSelect.val("simple");
		lbModeSelect.on("change", () => {
			const mode = lbModeSelect.val();
			socket.emit("get leaderboard", { mode });
		});
	}
}

function initSideMenu() {
	const menu = $("#sideMenu");
	const toggle = $("#sideMenuToggle");
	const close = $("#closeSideMenu");
	const volSlider = $("#sideVolume");
	const volVal = $("#sideVolumeVal");
	const helpBtn = $("#loginHelpBtn");

	if (toggle.length) {
		toggle.on("click", () => {
			menu.addClass("open");
		});
	}

	if (helpBtn.length) {
		helpBtn.on("click", () => {
			menu.addClass("open");
		});
	}

	if (close.length) {
		close.on("click", () => {
			menu.removeClass("open");
		});
	}

	// Close when clicking outside
	$(document).on("click", (e) => {
		if (
			menu.hasClass("open") &&
			!menu.is(e.target) &&
			menu.has(e.target).length === 0 &&
			!toggle.is(e.target) &&
			!helpBtn.is(e.target)
		) {
			menu.removeClass("open");
		}
	});

	// Volume
	if (volSlider.length) {
		volSlider.val(userSettings.volume);
		volVal.text(`${userSettings.volume}%`);

		volSlider.on("input", (e) => {
			const v = e.target.value;
			userSettings.volume = v;
			volVal.text(`${v}%`);
			localStorage.setItem(
				"multisweeper_settings",
				JSON.stringify(userSettings),
			);
		});
	}
}

function connectSocket() {
	socket = io("/lobby", {
		query: { player: currentUser.username },
	});

	socket.on("update lobbies", ({ lobbies }) => {
		const container = $("#lobbyListContainer");
		if (!container.length) return;
		container.empty();
		const list = Object.values(lobbies);

		if (list.length === 0) {
			container.html(
				'<div class="lobby-item placeholder">No rooms available</div>',
			);
			return;
		}

		list.forEach((room) => {
			const div = $("<div></div>")
				.addClass("lobby-item")
				.html(`
                <div class="info">
                    <span class="name">${room.name}</span>
                    <span class="details">Players: ${room.players.length}/4 | ${room.w}x${room.h} | ${room.c} mines</span>
                </div>
                <span class="status waiting">Join</span>
            `)
				.on("click", () => socket.emit("join lobby", { game: room.game }));
			container.append(div);
		});
	});

	socket.on("create lobby", ({ game }) => {
		// The server created the lobby, but we are not in it yet.
		// We must join it explicitly.
		socket.emit("join lobby", { game });
	});

	socket.on("user join", (lobby) => {
		showLobbyUI(lobby.game, lobby.name, lobby.players);
	});

	socket.on("user leave", (player) => {
		const list = $("#playersList");
		if (list.length) {
			list.children().each(function () {
				if ($(this).text() === player) $(this).remove();
			});
			
			// Re-evaluate host status
			const firstPlayer = list.children().first().text();
			const isHost = firstPlayer === currentUser.username;
			$("#startGameBtn").toggle(isHost);
		}
	});

	socket.on("launch game", ({ game, mode }) => {
		window.location.href = `game.html?room=${game}&user=${currentUser.username}&mode=${mode}`;
	});

	socket.on("leaderboard", ({ mode, leaderboard }) => {
		const select = $("#leaderboardModeSelect");
		if (select.val() !== mode) return;

		const container = $("#leaderboardList");
		container.empty();

		if (leaderboard.length === 0) {
			container.html('<div style="text-align: center; color: #888; padding: 10px;">No records yet</div>');
			return;
		}

		let lastBest = null;
		let rankDisplay = 0;

		leaderboard.forEach((entry, index) => {
			let rankStr = "--";
			if (entry.best !== null) {
				if (entry.best !== lastBest) {
					rankDisplay = index + 1;
					lastBest = entry.best;
				}
				rankStr = rankDisplay;
			}

			const winRate = entry.games > 0 ? Math.round((entry.wins / entry.games) * 100) + "%" : "0%";

			const row = $("<div></div>")
				.css({
					display: "grid",
					"grid-template-columns": "0.5fr 2fr 1fr 1fr 1fr 1fr",
					gap: "5px",
					padding: "4px 0",
					"border-bottom": "1px solid #eee"
				})
				.html(`
					<span style="text-align: center; font-weight: bold; color: #666;">${rankStr}</span>
					<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${entry.name}</span>
					<span style="text-align: center;">${entry.games}</span>
					<span style="text-align: center;">${entry.wins}</span>
					<span style="text-align: center;">${winRate}</span>
					<span style="text-align: right;">${entry.best !== null ? entry.best + "s" : "--"}</span>
				`);
			container.append(row);
		});
	});

	socket.on("leaderboard update", ({ mode }) => {
		const select = $("#leaderboardModeSelect");
		if (select.val() === mode) {
			socket.emit("get leaderboard", { mode });
		}
	});

	socket.on("connect", () => {
		const select = $("#leaderboardModeSelect");
		if (select.length) {
			socket.emit("get leaderboard", { mode: select.val() });
		}

		// Attempt to reconnect to previous lobby if exists
		const savedLobby = sessionStorage.getItem("currentLobbyId");
		if (savedLobby) {
			console.log("Attempting to reconnect to lobby:", savedLobby);
			socket.emit("join lobby", { game: savedLobby });
		}
	});

	socket.on("error", ({ message }) => {
		showToast(message);
		if (message === "Lobby not found." || message === "Lobby is full.") {
			// If reconnection failed, clear the saved ID and reset UI
			if (sessionStorage.getItem("currentLobbyId")) {
				sessionStorage.removeItem("currentLobbyId");
				$("#roomInfo").hide();
				$("#hostControls").hide();
				$("#lobbySelection").show();
			}
		}
	});
}

function showLobbyUI(gameId, roomName, players) {
	sessionStorage.setItem("currentLobbyId", gameId);
	$("#roomInfo").show();
	$("#lobbySelection").hide();
	$("#currentRoomName").text(roomName);
	$("#currentRoomId").text(gameId);

	const list = $("#playersList");
	list.empty();
	players.forEach((p) => {
		$("<li></li>").text(p).appendTo(list);
	});

	// Show host controls (now available to everyone)
	const hostControls = $("#hostControls");
	if (hostControls.length) {
		hostControls.css("display", "block");
		
		// Only host (first player) can start game
		const isHost = players.length > 0 && players[0] === currentUser.username;
		$("#startGameBtn").toggle(isHost);
	}

	// Bind start button
	const startBtn = $("#startGameBtn");
	if (startBtn.length) {
		startBtn.off("click").on("click", () => {
			socket.emit("launch game", { game: gameId });
		});
	}

	// Bind copy button
	const copyBtn = $("#copyRoomBtn");
	if (copyBtn.length) {
		copyBtn.off("click").on("click", () => {
			navigator.clipboard.writeText(gameId);
			showToast("Copied Room ID");
		});
	}

	// Bind leave button
	const leaveBtn = $("#leaveLobbyBtn");
	if (leaveBtn.length) {
		leaveBtn.off("click").on("click", () => {
			sessionStorage.removeItem("currentLobbyId");
			socket.emit("leave lobby", { game: gameId });
			$("#roomInfo").hide();
			$("#hostControls").hide();
			$("#lobbySelection").show();
			currentLobbyId = null;
		});
	}
}
