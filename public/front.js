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
	checkSession();
});

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

function loadStats(mode = "classic") {
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
		statModeSelect.val(localStorage.getItem("statsMode") || "classic");
		loadStats(statModeSelect.val());
		statModeSelect.on("change", (e) => {
			localStorage.setItem("statsMode", e.target.value);
			loadStats(e.target.value);
		});
	} else {
		loadStats("classic");
	}

	connectSocket();

	$("#logoutBtn").off("click").on("click", () => {
		location.reload();
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
			if (!h || h < 9) h = 9;
			if (!c || c < 1) c = 10;
		}

		socket.emit("create lobby", { name, w, h, c });
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

		const tileMin = 20;
		const maxGridWByViewport =
			Math.floor((window.innerWidth * 0.65) / tileMin) || 50;
		const maxGridHByViewport =
			Math.floor((window.innerHeight * 0.85) / tileMin) || 30;
		const maxGridW = Math.min(50, Math.max(5, maxGridWByViewport));
		const maxGridH = Math.min(30, Math.max(5, maxGridHByViewport));
		const maxM = Math.max(1, w * h - 1);

		const valid =
			Number.isInteger(w) &&
			w >= 5 &&
			w <= maxGridW &&
			Number.isInteger(h) &&
			h >= 5 &&
			h <= maxGridH &&
			Number.isInteger(m) &&
			m >= 1 &&
			m <= maxM;

		createBtn.prop("disabled", !valid);

		customW.toggleClass(
			"custom-invalid",
			!(Number.isInteger(w) && w >= 5 && w <= maxGridW),
		);
		customH.toggleClass(
			"custom-invalid",
			!(Number.isInteger(h) && h >= 5 && h <= maxGridH),
		);
		customM.toggleClass(
			"custom-invalid",
			!(Number.isInteger(m) && m >= 1 && m <= maxM),
		);

		if (valid) {
			customHint.text(`Mines max = ${maxM}`);
		} else {
			customHint.text(`Max W=${maxGridW}, H=${maxGridH}`);
		}
	}

	customW.off("input").on("input", validateCustomParams);
	customH.off("input").on("input", validateCustomParams);
	customM.off("input").on("input", validateCustomParams);
	$("#modeSelect").on("change", validateCustomParams);

	initSideMenu();
}

function initSideMenu() {
	const menu = $("#sideMenu");
	const toggle = $("#sideMenuToggle");
	const close = $("#closeSideMenu");
	const volSlider = $("#sideVolume");
	const volVal = $("#sideVolumeVal");
	const introToggle = $("#sideIntroToggle");
	const introContent = $("#sideIntro");

	if (toggle.length) {
		toggle.on("click", () => {
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
			!toggle.is(e.target)
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

	// Intro Toggle
	if (introToggle.length && introContent.length) {
		introToggle.on("click", () => {
			const visible = introContent.is(":visible");
			if (visible) {
				introContent.slideUp();
				introToggle.text("Read More");
			} else {
				introContent.slideDown();
				introToggle.text("Show Less");
			}
		});
	}
}

function connectSocket() {
	socket = io("/lobby", {
		query: { player: currentUser.username },
	});

	socket.on("connect", () => console.log("Connected to lobby"));

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
                    <span class="details">Players: ${room.players.length}/8 | ${room.w}x${room.h} | ${room.c} mines</span>
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
		}
	});

	socket.on("launch game", ({ game }) => {
		window.location.href = `game.html?room=${game}&user=${currentUser.username}`;
	});

	socket.on("error", ({ message }) => showToast(message));
}

function showLobbyUI(gameId, roomName, players) {
	$("#roomInfo").show();
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
}
