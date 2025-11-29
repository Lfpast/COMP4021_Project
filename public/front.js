// front.js - Final, clean, English-only, zero null-safe version
console.info("front.js loaded");
// Helper shorthand for getElementById
const $ = (id) => document.getElementById(id);
// also expose on window for inline handlers or other scripts that expect window.$
window.$ = $;
// Client-side copy of MODE presets. Keep in sync with server.js (used for rendering/custom input validation)
const MODES = {
	simple: { w: 9, h: 9, m: 10 },
	classic: { w: 8, h: 8, m: 10 },
	medium: { w: 16, h: 16, m: 40 },
	expert: { w: 30, h: 16, m: 99 },
	custom: { w: 8, h: 8, m: 10 },
};
let gameState = {
	board: null,
	revealed: null,
	flagged: null,
	width: 0,
	height: 0,
	mines: 0,
	mode: "classic",
	startTime: null,
	timerInterval: null,
	tileSize: 32,
	// cheat removed - feature to be revisited later
	signals: [], // list of current signals shown, each { type, r, c, fromUser, expiresAt }
	chordEffectPositions: [],
	chordPulse: null,
};

const mineExplodeImg = new Image();
mineExplodeImg.src = "assets/mine2.svg";

// Mine assets and loading disabled
// NOTE: We intentionally do not use image-based mines. All image assets under public/assets remain untouched on disk.
// Try to load an SVG first (scales cleanly); fallback to PNG if not found
// Image-based mine rendering intentionally disabled; mines are drawn using vector or not drawn.

// Ensure we initialize by checking any stored session and either showing the main page or login
document.addEventListener("DOMContentLoaded", () => {
	const storedUser = localStorage.getItem("username");
	const storedToken = localStorage.getItem("token");
	const storedNick = localStorage.getItem("nickname");

	if (storedUser && storedToken) {
		fetch("/verify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: storedUser, token: storedToken }),
		})
			.then((r) => r.json())
			.then((data) => {
				if (data.success) {
					username = storedUser;
					nickname = storedNick || storedUser;
					initMainPage();
				} else {
					showLoginModal();
				}
			})
			.catch(() => showLoginModal());
	} else {
		showLoginModal();
	}
	// Ensure login/register buttons are bound even if showLoginModal didn't run or elements were re-rendered
	setTimeout(ensureLoginBindings, 50);
	startLoginBindingWatchdog();
	// Image-based mine rendering disabled: drawBoard no longer draws mine icons.
});

function setSideToggleVisible(v) {
	const t = $("sideMenuToggle");
	if (!t) return;
	t.style.display = v ? "block" : "none";
}

function showLoginModal() {
	localStorage.clear();
	const modal = $("loginModal");
	if (modal) modal.style.display = "flex";
	// Hide side menu toggle during login
	setSideToggleVisible(false);

	// Safe binding – only if elements exist
	const regBtn = $("registerBtn");
	const logBtn = $("loginBtn");
	if (regBtn) regBtn.onclick = handleRegister;
	if (logBtn) logBtn.onclick = handleLogin;
}

// Fallback: ensure login/register events are bound during initial load
function ensureLoginBindings() {
	const regBtn = $("registerBtn");
	const logBtn = $("loginBtn");
	if (regBtn && !regBtn._bound) {
		regBtn._bound = true;
		regBtn.addEventListener("click", handleRegister);
		console.info("ensureLoginBindings: registerBtn bound");
	}
	if (logBtn && !logBtn._bound) {
		logBtn._bound = true;
		logBtn.addEventListener("click", handleLogin);
		console.info("ensureLoginBindings: loginBtn bound");
	}
}

// A more robust binding loop: keep attempting to bind the login/register buttons until they exist
function startLoginBindingWatchdog() {
	let attempts = 0;
	const t = setInterval(() => {
		attempts++;
		ensureLoginBindings();
		const regBtn = $("registerBtn");
		const logBtn = $("loginBtn");
		if (regBtn && regBtn._bound && logBtn && logBtn._bound) clearInterval(t);
		if (attempts > 50) clearInterval(t); // stop trying after ~2.5 seconds
	}, 50);
}

function showMessage(text, color = "#f66") {
	const el = $("loginMsg");
	if (!el) return;
	el.textContent = text;
	el.style.color = color;
	el.style.opacity = "1";
	setTimeout(() => (el.style.opacity = "0"), 4000);
}

async function handleRegister() {
	console.info("handleRegister(): called");
	showToast("Registering...", 1200);
	const u = $("regUsername")?.value.trim();
	const n = $("regNickname")?.value.trim() || u;
	const p = $("regPassword")?.value;
	if (!u || !n || !p)
		return showMessage("Username/Nickname/Password are required");

	try {
		const res = await fetch("/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: u, password: p, name: n }),
		});
		const data = await res.json();
		console.info("handleRegister: response", data);
		showMessage(
			data.success ? "Registered! Please log in" : data.msg || "Failed",
			data.success ? "#6f6" : "#f66",
		);
	} catch (e) {
		showCenterToast("Network error: Failed to register", 2000);
		console.error("Register error", e);
	}
}

async function handleLogin() {
	console.info("handleLogin(): called");
	showToast("Logging in...", 1000);
	const u = $("loginUsername")?.value.trim();
	const p = $("loginPassword")?.value;
	if (!u || !p) return showMessage("Username and Password are required");

	try {
		const res = await fetch("/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: u, password: p }),
		});
		const data = await res.json();
		console.info("handleLogin: response", data);

		if (data.success) {
			username = u;
			nickname = data.name || u;
			localStorage.setItem("username", u);
			localStorage.setItem("token", data.token);
			localStorage.setItem("nickname", nickname);
			initMainPage();
		} else {
			showMessage(data.msg || "Login failed");
		}
	} catch (e) {
		showCenterToast("Network error: Failed to login", 2000);
		console.error("Login error", e);
	}
}

// [新增] 加载统计数据的函数
// Load stats for a given mode (classic/simple/medium/expert)
function loadStats(mode = "classic") {
	if (!username) return;
	fetch(`/stats/${username}`)
		.then((r) => r.json())
		.then((data) => {
			if (!data) data = {};
			const modeData = data[mode] || { games: 0, wins: 0, bestTime: null };

			$("statGamesPlayed").textContent = modeData.games || 0;
			$("statGamesWon").textContent = modeData.wins || 0;

			// 计算胜率
			const games = modeData.games || 0;
			const wins = modeData.wins || 0;
			const rate = games > 0 ? Math.round((wins / games) * 100) : 0;
			$("statWinRate").textContent = rate + "%";

			// 最佳时间
			const best = modeData.bestTime;
			$("statBestTime").textContent =
				best === null || best === Infinity
					? "--:--"
					: (best / 1000).toFixed(1) + "s";

			// Total Play Time removed - no display or update
		})
		.catch(console.error);
}

function initMainPage() {
	// 确保所有模态框都隐藏
	$("loginModal").style.display = "none";
	$("overModal").style.display = "none";

	$("mainPage").style.display = "block";
	$("welcomeUser").textContent = nickname;
	// Ensure the side menu toggle is visible on the main page
	setSideToggleVisible(true);

	loadTheme();
	// Default stats mode is 'classic'
	const statModeSelect = $("statsModeSelect");
	if (statModeSelect) {
		statModeSelect.value = localStorage.getItem("statsMode") || "classic";
		loadStats(statModeSelect.value);
		statModeSelect.onchange = (e) => {
			const m = e.target.value;
			localStorage.setItem("statsMode", m);
			loadStats(m);
		};
	} else {
		loadStats("classic");
	}
	connectSocket();

	// All buttons in the lobby
	$("logoutBtn").onclick = () => {
		localStorage.clear();
		location.reload();
	};

	$("createLobbyBtn").onclick = () => {
		const inputName = $("roomNameInput").value.trim();
		// 如果输入为空，主动使用 Nickname 生成房间名
		const finalName = inputName || `${nickname}'s Room`;
		socket.emit("createLobby", finalName);
	};

	$("joinLobbyBtn").onclick = () => {
		const roomId = $("roomInput").value.trim();
		if (!roomId) return alert("Enter Room ID");
		// 修改处：事件名改为 joinLobby，且只传 ID（根据 server.js 的定义）
		socket.emit("joinLobby", roomId);
	};

	$("copyRoomBtn").onclick = () => {
		if (currentRoom) {
			navigator.clipboard.writeText(currentRoom);
			alert("Copied: " + currentRoom);
		}
	};

	// [新增] 游戏界面内的复制按钮逻辑
	const copyGameBtn = $("copyGameRoomBtn");
	if (copyGameBtn) {
		copyGameBtn.onclick = () => {
			if (currentRoom) {
				navigator.clipboard.writeText(currentRoom);
				// 可以加个简单的提示，或者只是 alert
				const originalText = copyGameBtn.textContent;
				copyGameBtn.textContent = "Copied!";
				setTimeout(() => (copyGameBtn.textContent = originalText), 1000);
			}
		};
	}

	$("modeSelect").onchange = (e) => {
		const mode = e.target.value;
		const customParamsDiv = $("customParams");
		if (mode === "custom") {
			if (customParamsDiv) customParamsDiv.style.display = "block";
			// If host and custom inputs have values, send them immediately
			if (isHost && $("customW") && $("customH") && $("customM")) {
				updateCustomParamsFromInputs();
			}
		} else {
			if (customParamsDiv) customParamsDiv.style.display = "none";
		}
		if (isHost) socket.emit("setMode", { roomId: currentRoom, mode });
	};

	// Custom parameter inputs (host only)
	const customW = $("customW");
	const customH = $("customH");
	const customM = $("customM");
	const customHint = $("customHint");
	// Keep a cached 'lastCustomSent' so we don't spam setCustomMode
	let lastCustomSent = null;
	function updateCustomParamsFromInputs() {
		if (!isHost || !currentRoom) return;
		const w = Number(customW.value || 8);
		const h = Number(customH.value || 8);
		let m = Number(customM.value || 10);
		if (!Number.isInteger(w) || w < 5) return;
		if (!Number.isInteger(h) || h < 5) return;
		const maxM = Math.max(1, w * h - 1);
		if (customM) customM.max = maxM;
		if (m < 1) m = 1;
		if (m > maxM) m = maxM;
		customM.value = m;
		const toSend = { roomId: currentRoom, w, h, m };
		// avoid sending the same object repeatedly
		const key = `${w}x${h}#${m}`;
		if (lastCustomSent === key) return; // throttle
		lastCustomSent = key;
		socket.emit("setCustomMode", toSend);
	}
	if (customW) customW.onchange = updateCustomParamsFromInputs;
	if (customH) customH.onchange = updateCustomParamsFromInputs;
	if (customM) customM.onchange = updateCustomParamsFromInputs;

	function validateCustomParams() {
		const startBtn = $("startGameBtn");
		if (!isHost || !currentRoom || !customW || !customH || !customM) return;
		const w = Number(customW.value || 0),
			h = Number(customH.value || 0),
			m = Number(customM.value || 0);
		// Determine client-side viewport-guided limits
		const tileMin = 20; // px
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
		if (startBtn) startBtn.disabled = !valid;
		const newGameBtn = $("startNewGameBtn");
		if (newGameBtn) newGameBtn.disabled = !valid;
		// Update invalid styles
		if (customW)
			customW.classList.toggle(
				"custom-invalid",
				!(Number.isInteger(w) && w >= 5 && w <= maxGridW),
			);
		if (customH)
			customH.classList.toggle(
				"custom-invalid",
				!(Number.isInteger(h) && h >= 5 && h <= maxGridH),
			);
		if (customM)
			customM.classList.toggle(
				"custom-invalid",
				!(Number.isInteger(m) && m >= 1 && m <= maxM),
			);
		if (valid) {
			// update hint text
			if (customHint) customHint.textContent = `Mines max = ${maxM}`;
		} else {
			if (customHint)
				customHint.textContent = `Mines max = W × H - 1. Max W=${maxGridW}, H=${maxGridH}`;
		}
		return valid;
	}
	// Expose for outer scope (socket handler) to validate and update start button state
	window.validateCustomParams = validateCustomParams;
	if (customW) customW.oninput = validateCustomParams;
	if (customH) customH.oninput = validateCustomParams;
	if (customM) customM.oninput = validateCustomParams;
	// initialize max values based on viewport
	(function setCustomInputMaxes() {
		const tileMin = 20;
		const maxGridWByViewport =
			Math.floor((window.innerWidth * 0.65) / tileMin) || 50;
		const maxGridHByViewport =
			Math.floor((window.innerHeight * 0.85) / tileMin) || 30;
		const maxGridW = Math.min(50, Math.max(5, maxGridWByViewport));
		const maxGridH = Math.min(30, Math.max(5, maxGridHByViewport));
		if (customW) {
			customW.max = maxGridW;
			customW.min = 5;
		}
		if (customH) {
			customH.max = maxGridH;
			customH.min = 5;
		}
		if (customM) {
			customM.min = 1;
		}
	})();

	$("startGameBtn").onclick = () => {
		if (isHost) socket.emit("startGame", currentRoom);
	};

	$("deleteRoomBtn").onclick = () => {
		if (isHost && confirm("Delete this room?")) {
			socket.emit("deleteRoom", currentRoom);
		}
	};

	// Volume control moved to the side menu; use side menu controls instead.
	const themeSelect = $("themeSelect");
	if (themeSelect) {
		themeSelect.onchange = () => {
			const newTheme = themeSelect.value;
			document.documentElement.setAttribute("data-theme", newTheme);
			localStorage.setItem("theme", newTheme);
		};
	}
	loadTheme();

	// NOTE: Checkbox settings moved to side-menu; specific controls are bound in connectSocket() after menu loads
}

function connectSocket() {
	socket = io();
	socket.on("connect", () => socket.emit("auth", username));

	// Insert side menu logic after socket connects
	// Delay binding to ensure DOM is loaded and the partial is inserted
	setTimeout(() => {
		const toggle = $("sideMenuToggle");
		const sideMenu = $("sideMenu");
		const closeBtn = $("closeSideMenu");
		if (toggle && sideMenu) {
			toggle.onclick = () => {
				sideMenu.classList.add("open");
				// Hide toggle while open, we'll rely on the close button
				toggle.style.display = "none";
			};
		}
		if (closeBtn && sideMenu)
			closeBtn.onclick = () => {
				sideMenu.classList.remove("open");
				// Show the toggle again after closing
				const toggle = $("sideMenuToggle");
				if (toggle) toggle.style.display = "block";
			};
		// Ensure toggle visible by default after binding
		if (toggle) toggle.style.display = "block";

		const sideVolume = $("sideVolume");
		const sideVolumeVal = $("sideVolumeVal");
		const sideShowTimer = $("sideShowTimer");
		const sideEnableAnimations = $("sideEnableAnimations");
		const sideAutoReveal = $("sideAutoReveal");

		async function loadAndApplySettings() {
			const t = localStorage.getItem("token");
			if (!username) return;
			// Try server first
			try {
				const res = await fetch(
					`/settings/${username}?token=${localStorage.getItem("token")}`,
				);
				if (res.ok) {
					const s = await res.json();
					if (sideVolume) {
						sideVolume.value = s.volume ?? 70;
						sideVolumeVal.textContent = (s.volume ?? 70) + "%";
					}
					if (sideShowTimer) sideShowTimer.checked = s.showTimer ?? true;
					if (sideEnableAnimations)
						sideEnableAnimations.checked = s.enableAnimations ?? true;
					if (sideAutoReveal)
						sideAutoReveal.checked = s.autoRevealBlank ?? true;
					// Apply settings
					applyLocalSettings(s);
					return;
				}
			} catch (e) {
				/* ignore */
			}
			// fallback to localStorage defaults
			const s = {
				volume: Number(localStorage.getItem("volume") || 70),
				showTimer: localStorage.getItem("showTimer") === "false" ? false : true,
				enableAnimations: localStorage.getItem("enableAnimations") !== "false",
				autoRevealBlank: localStorage.getItem("autoRevealBlank") !== "false",
			};
			if (sideVolume) {
				sideVolume.value = s.volume;
				sideVolumeVal.textContent = s.volume + "%";
			}
			if (sideShowTimer) sideShowTimer.checked = s.showTimer;
			if (sideEnableAnimations)
				sideEnableAnimations.checked = s.enableAnimations;
			if (sideAutoReveal) sideAutoReveal.checked = s.autoRevealBlank;
			applyLocalSettings(s);
		}

		function applyLocalSettings(s) {
			// Volume - just store; can connect to audio API if present
			localStorage.setItem("volume", s.volume);
			// Timer
			localStorage.setItem("showTimer", s.showTimer);
			if (s.showTimer) $("timerDisplay").style.display = "block";
			else $("timerDisplay").style.display = "none";
			// Animations
			localStorage.setItem("enableAnimations", s.enableAnimations);
			// Auto reveal blank toggling
			localStorage.setItem("autoRevealBlank", s.autoRevealBlank);
			// Update gameState default for new games
			gameState.autoRevealBlank = s.autoRevealBlank;
		}

		// Volume change
		if (sideVolume)
			sideVolume.oninput = () => {
				sideVolumeVal.textContent = sideVolume.value + "%";
				localStorage.setItem("volume", sideVolume.value);
				if (username && localStorage.getItem("token")) saveSettingsToServer();
			};

		// Toggles
		if (sideShowTimer)
			sideShowTimer.onchange = () => {
				const v = sideShowTimer.checked;
				localStorage.setItem("showTimer", v);
				if (v) $("timerDisplay").style.display = "block";
				else $("timerDisplay").style.display = "none";
				saveSettingsToServer();
			};
		if (sideEnableAnimations)
			sideEnableAnimations.onchange = () => {
				const v = !!sideEnableAnimations.checked;
				localStorage.setItem("enableAnimations", v);
				saveSettingsToServer();
			};
		if (sideAutoReveal)
			sideAutoReveal.onchange = () => {
				const v = !!sideAutoReveal.checked;
				localStorage.setItem("autoRevealBlank", v);
				gameState.autoRevealBlank = v;
				saveSettingsToServer();
			};

		// Gameplay Introduction 'Read More' toggle
		const sideIntroToggle = $("sideIntroToggle");
		const sideIntroEl = $("sideIntro");
		const sideIntroSummary = $("sideIntroSummary");
		if (sideIntroToggle && sideIntroEl) {
			sideIntroToggle.onclick = () => {
				const isShown = sideIntroEl.style.display !== "none";
				sideIntroEl.style.display = isShown ? "none" : "block";
				if (sideIntroSummary)
					sideIntroSummary.style.display = isShown ? "block" : "none";
				sideIntroToggle.textContent = isShown ? "Read More" : "Hide";
			};
		}

		async function saveSettingsToServer() {
			if (!username || !localStorage.getItem("token")) return;
			const payload = {
				username,
				token: localStorage.getItem("token"),
				settings: {
					volume: Number(
						sideVolume?.value || localStorage.getItem("volume") || 70,
					),
					showTimer:
						sideShowTimer?.checked ??
						localStorage.getItem("showTimer") !== "false",
					enableAnimations:
						sideEnableAnimations?.checked ??
						localStorage.getItem("enableAnimations") !== "false",
					autoRevealBlank:
						sideAutoReveal?.checked ??
						localStorage.getItem("autoRevealBlank") !== "false",
					statsMode: localStorage.getItem("statsMode") || "classic",
				},
			};
			try {
				const res = await fetch("/settings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				if (!res.ok) console.warn("Failed to save settings to server");
			} catch (e) {
				console.warn("Failed to save settings", e);
			}
		}

		// load initial settings
		loadAndApplySettings();
	}, 1200);

	socket.on("lobbyList", (lobbies) => {
		const container = $("lobbyListContainer");
		if (!container) return;
		container.innerHTML = "";

		if (!lobbies || lobbies.length === 0) {
			container.innerHTML =
				'<div class="lobby-item placeholder" style="cursor:default; color:#999; justify-content:center;">No rooms available</div>';
			return;
		}

		lobbies.forEach((room) => {
			const div = document.createElement("div");
			div.className = "lobby-item";
			div.innerHTML = `
            <div class="info">
                <span class="name">${room.name}</span>
                <span class="details">Host: ${room.host} | Mode: ${room.mode} | Players: ${room.players}/4</span>
            </div>
            <span class="status ${room.status.toLowerCase()}">${room.status}</span>
        `;
			div.onclick = () => {
				const input = $("roomInput");
				if (input) input.value = room.id;

				// [Modified] If I am the host, click to re-join/manage the room
				// Use hostUsername (login ID) for logic check, not the display name
				if (room.hostUsername === username) {
					socket.emit("joinLobby", room.id);
				}
			};
			container.appendChild(div);
		});
	});

	socket.on("lobbyCreated", ({ roomId, roomName }) => {
		currentRoom = roomId;
		isHost = true;
		$("hostControls").style.display = "block";
		$("roomInfo").style.display = "block";
		$("currentRoomName").textContent = roomName || `${nickname}'s Room`;
		$("currentRoomId").textContent = roomId;
	});

	socket.on("joinedLobby", ({ roomId, roomName }) => {
		currentRoom = roomId;
		$("roomInfo").style.display = "block";
		$("currentRoomName").textContent = roomName;
		$("currentRoomId").textContent = roomId;
		$("gameRoomName").textContent = roomName || `${nickname}'s Room`;
		$("gameRoomID").textContent = roomId;

		// 给用户一个反馈，比如按钮变灰或显示 "Waiting for game data..."
		$("joinLobbyBtn").textContent = "Joined! Waiting...";
	});

	socket.on("joinError", (msg) => {
		showCenterToast("Error joining room: " + (msg || ""), 2000);
	});

	socket.on("roomDeleted", () => {
		alert("Room deleted by host");
		currentRoom = null;
		isHost = false;
		currentRoomHost = null;
		$("gamePage").style.display = "none";
		$("mainPage").style.display = "block";
		$("hostControls").style.display = "none";
		$("roomInfo").style.display = "none";
		updateMainPageButtons();
	});

	socket.on("playersUpdate", (payload) => {
		// payload is array of { username, name, isHost }
		const players = Array.isArray(payload) ? payload : payload.players || [];

		// 按 username 去重
		const unique = Array.from(
			new Map(players.map((p) => [p.username, p])).values(),
		);

		// 渲染大厅/游戏玩家列表
		const renderList = (elementId) => {
			const list = document.getElementById(elementId);
			if (!list) return;
			list.innerHTML = "";
			unique.forEach((p) => {
				const li = document.createElement("li");
				let label = `${p.name}`;
				if (p.username === username) label += " (You)";
				if (p.isHost) label += " (Host)";
				li.textContent = label;
				if (p.username === username) li.classList.add("me");
				if (p.isHost) li.classList.add("host");
				list.appendChild(li);
			});
		};

		renderList("playersList");
		renderList("gamePlayersList");

		// 更新当前房主记录
		const host = unique.find((p) => p.isHost);
		currentRoomHost = host ? host.username : null;

		// [New] Update Host Controls Visibility based on real-time data
		if (currentRoomHost === username) {
			isHost = true;
			if ($("hostControls")) $("hostControls").style.display = "block";
		} else {
			isHost = false;
			if ($("hostControls")) $("hostControls").style.display = "none";
		}
	});

	socket.on("modeSet", (mode) => {
		// mode may be object { mode, customParams } or a string
		let modeVal = mode;
		let customParams = null;
		if (mode && typeof mode === "object") {
			modeVal = mode.mode;
			customParams = mode.customParams;
		}
		$("modeSelect").value = modeVal;
		gameState.mode = modeVal;
		const customDiv = $("customParams");
		if (modeVal === "custom") {
			if (customDiv) customDiv.style.display = "block";
			if (customParams && customParams.w) $("customW").value = customParams.w;
			if (customParams && customParams.h) $("customH").value = customParams.h;
			if (customParams && customParams.m) $("customM").value = customParams.m;
			// Validate custom params and set start button state
			if (typeof validateCustomParams === "function") validateCustomParams();
			// Ensure start btn enabled only if custom params valid
			if (modeVal === "custom") {
				const vb = validateCustomParams();
				const startBtn = $("startGameBtn");
				if (startBtn) startBtn.disabled = !vb;
			}
		} else {
			if (customDiv) customDiv.style.display = "none";
			const startBtn = $("startGameBtn");
			if (startBtn) startBtn.disabled = false;
		}
	});

	// Errors returned by the server for starting or mode setting
	socket.on("startError", (msg) => {
		showCenterToast(msg || "Failed to start the game", 2000);
	});
	socket.on("modeSetError", (msg) => {
		const customHintEl = $("customHint");
		if (customHintEl) {
			customHintEl.textContent = msg || "Invalid custom params";
		} else {
			showCenterToast(msg || "Invalid custom params", 2000);
		}
	});

	// [修改] 将 gameStarted 逻辑独立出来，不要嵌套其他 socket.on
	socket.on(
		"gameStarted",
		({ board, revealed, flagged, mode, startTime, w, h, m, signals }) => {
			// If server provided custom width/height/mines (custom mode), prefer it
			const cfg =
				mode === "custom" &&
				typeof w === "number" &&
				typeof h === "number" &&
				typeof m === "number"
					? { w: Number(w), h: Number(h), m: Number(m) }
					: MODES[mode] || MODES.classic;

			// 初始化游戏状态
			gameState = {
				...gameState, // 保留部分配置
				board,
				revealed,
				flagged,
				width: cfg.w,
				height: cfg.h,
				mines: cfg.m,
				mode,
				startTime: startTime || Date.now(),
				firstClick: true,
				gameOver: false, // 确保重置
				animating: false, // 确保重置
				// cheat feature removed
				timerInterval: null, // 先占位
				creationAnim: {
					active: true,
					radius: 0,
					max: Math.max(cfg.w, cfg.h) * 1.5,
				}, // [New] Animation state
			};

			// 清除旧定时器并开启新的
			if (gameState.timerInterval) clearInterval(gameState.timerInterval);
			gameState.timerInterval = setInterval(updateTimer, 1000);

			// UI 更新
			gameState.mines = cfg.m;
			updateMinesLeft();
			if (localStorage.getItem("showTimer") !== "false") {
				$("timerDisplay").style.display = "block";
			}

			// [重要] 这里必须调用，确保非房主加入时能跳转页面并初始化 Canvas
			showGamePage();
			initCanvas(); // 确保 Canvas 尺寸被重新计算
			// Hide side menu toggle when a game starts
			setSideToggleVisible(false);
			// If the menu is open, close it
			const s = $("sideMenu");
			if (s && s.classList.contains("open")) s.classList.remove("open");

			// Apply any initial signals if provided
			gameState.signals = signals || [];
			// Start creation animation
			const animStart = Date.now();
			const animDuration = 800; // 0.8 second
			const animLoop = () => {
				if (!gameState.creationAnim.active || gameState.gameOver) return;
				const now = Date.now();
				const progress = Math.min(1, (now - animStart) / animDuration);
				gameState.creationAnim.radius = progress * gameState.creationAnim.max;
				drawBoard();
				if (progress < 1) requestAnimationFrame(animLoop);
				else {
					gameState.creationAnim.active = false;
					drawBoard(); // Final draw
				}
			};
			requestAnimationFrame(animLoop);

			// [Fix] 确保游戏开始时关闭结算弹窗
			$("overModal").style.display = "none";

			// 更新信息栏
			$("gameRoomName").textContent =
				$("currentRoomName").textContent || "Room";
			$("gameRoomID").textContent = currentRoom;
			updateMinesLeft();
		},
	);

	// [修改] 将 gameRestarted 移到最外层！防止重复绑定
	socket.on("gameRestarted", ({ startTime, revealed, flagged }) => {
		gameState.gameOver = false;
		gameState.animating = false;
		// cheat removed

		gameState.startTime = startTime;
		gameState.revealed = revealed;
		gameState.flagged = flagged;
		gameState.firstClick = true;

		if (gameState.timerInterval) clearInterval(gameState.timerInterval);
		gameState.timerInterval = setInterval(updateTimer, 1000);
		$("gameTimer").textContent = "00:00";

		$("overModal").style.display = "none";

		drawBoard();
		updateMinesLeft();
		// Hide side menu toggle on restart too
		setSideToggleVisible(false);
	});

	// [修改] boardUpdate 保持不变
	socket.on("boardUpdate", ({ revealed, flagged }) => {
		// Compute newly revealed tiles for animation
		const prevRevealed = gameState.revealed
			? gameState.revealed.map((r) => r.slice())
			: null;
		// 直接覆盖本地状态
		gameState.revealed = revealed;
		gameState.flagged = flagged;
		if (prevRevealed) {
			const newly = [];
			for (let y = 0; y < gameState.height; y++) {
				for (let x = 0; x < gameState.width; x++) {
					if (!prevRevealed[y][x] && gameState.revealed[y][x])
						newly.push({ x, y });
				}
			}
			if (newly.length > 0) {
				// set positions to animate; drawBoard will render them with a highlight
				gameState.chordEffectPositions = newly;
				// clear after animation duration
				clearTimeout(gameState._chordEffectTimer);
				gameState._chordEffectTimer = setTimeout(() => {
					gameState.chordEffectPositions = [];
					drawBoard();
				}, 450);
			}
		}

		// 强制重绘
		drawBoard();

		// 更新剩余雷数显示
		updateMinesLeft();
	});

	// [修改] flagUpdate 保持不变
	socket.on("flagUpdate", ({ r, c, state }) => {
		gameState.flagged[r][c] = state;
		drawBoard();
		updateMinesLeft();
	});

	socket.on("minesLeftUpdate", (count) => {
		$("minesLeft").textContent = count;
	});

	socket.on("gameOver", (data) => {
		if (gameState.gameOver) return;
		gameState.gameOver = true;
		// cheat removed
		drawBoard(); // 重绘一次以去除作弊透视效果

		clearInterval(gameState.timerInterval);
		const modeSel = $("statsModeSelect");
		loadStats(modeSel ? modeSel.value : "classic"); // [新增] 游戏结束时刷新统计数据

		const enableAnimations =
			localStorage.getItem("enableAnimations") !== "false";
		if (data.winner) {
			if (enableAnimations) fireworksAnim(3000);
			setTimeout(() => {
				$("overTitle").textContent = "Win!";
				$("overMessage").textContent =
					`All mines cleared in ${$("gameTimer").textContent}!`;
				showOverModal(data);
				// Show side menu toggle again when game has ended
				setSideToggleVisible(true);
			}, 3000);
		} else {
			const startR =
				data.bomb && typeof data.bomb.r === "number"
					? data.bomb.r
					: Math.floor(gameState.height / 2);
			const startC =
				data.bomb && typeof data.bomb.c === "number"
					? data.bomb.c
					: Math.floor(gameState.width / 2);

			if (!gameState.animating) {
				gameState.animating = true;
				if (enableAnimations) {
					rippleExplosion(startC, startR, () => {
						$("overTitle").textContent = "Game Over!";
						$("overMessage").textContent = "You hit a mine!";
						showOverModal(data);
						gameState.animating = false;
						// Show side menu toggle again when game has ended
						setSideToggleVisible(true);
					});
				} else {
					// If animations disabled, show modal without ripple
					$("overTitle").textContent = "Game Over!";
					$("overMessage").textContent = "You hit a mine!";
					showOverModal(data);
					gameState.animating = false;
					// Show side menu toggle again when game has ended
					setSideToggleVisible(true);
				}
			}
		}
	});

	// Receive a signal object: { id, type, r, c, fromUser, expiresAt }
	socket.on("signalReceived", (sig) => {
		addSignal(sig);
	});

	// If we get a snapshot of signals when joining, set them up
	socket.on("signalsSnapshot", (sigs) => {
		if (!Array.isArray(sigs)) return;
		gameState.signals = (sigs || []).map((s) => ({ ...s }));
		drawBoard();
	});

	// Server informs signal expired by id
	socket.on("signalExpired", ({ id }) => {
		if (!id) return;
		gameState.signals = (gameState.signals || []).filter((s) => s.id !== id);
		drawBoard();
	});

	socket.on("chordFail", ({ r, c, reason }) => {
		// Show a centered toast for illegal operation
		const reasonText =
			reason === "flagMismatch"
				? "Flags do not match number"
				: reason || "Invalid chord";
		showCenterToast(reasonText, 2000);
	});

	socket.on("joinSuccess", (data) => {
		currentRoom = data.room;
		showGamePage();
		// 更新玩家列表等
	});
	socket.on("joinError", (msg) => {
		alert(msg); // 如'Room not found'
	});
}

function updatePlayers(players) {
	const list = $("gamePlayersList");
	list.innerHTML = "";
	players.forEach((p) => {
		const li = document.createElement("li");
		li.textContent = p.name;
		list.appendChild(li);
	});
}

// -------------------------- Game logic (client-side) --------------------------
// function getTile(e) {
//   const canvas = $('boardCanvas');
//   const rect = canvas.getBoundingClientRect();

//   // 更加精确的坐标计算
//   // e.clientX - rect.left 是鼠标在 Canvas 元素内的像素位置
//   // 不需要再乘比例系数，因为我们现在让 canvas.width 等于 style.width
//   const x = Math.floor((e.clientX - rect.left) / gameState.tileSize);
//   const y = Math.floor((e.clientY - rect.top)  / gameState.tileSize);
//   return {x, y};
// }

function bindCanvasEvents(canvas) {
	// 清除旧的事件监听 (虽然 canvas重建后没有旧的，但为了保险)
	canvas.onclick = null;
	canvas.oncontextmenu = null;
	canvas.onmousedown = null;
	canvas.onmouseup = null;
	canvas._suppressNextContextMenu = false;
	if (canvas._docMouseUpHandler) {
		document.removeEventListener("mouseup", canvas._docMouseUpHandler);
		canvas._docMouseUpHandler = null;
	}

	// 1. 左键点击：揭开
	canvas.onclick = (e) => {
		// 基础检查
		if (!gameState.board || gameState.gameOver) return;

		const { x, y } = getTile(e);

		// 越界检查
		if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) return;

		let flagVal = gameState.flagged?.[y]?.[x];
		// 把 false/undefined 视作 0
		if (flagVal === false || flagVal === undefined) flagVal = 0;
		if (gameState.revealed[y][x] || flagVal !== 0) return;

		// 发送揭开指令
		socket.emit("revealTile", { roomId: currentRoom, r: y, c: x });
	};

	// 1.5-click (chording) via double-click: reveal neighbors if flagged count equals the number
	canvas.ondblclick = (e) => {
		if (!gameState.board || gameState.gameOver) return;
		const { x, y } = getTile(e);
		if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) return;
		// Only chord on revealed number tiles
		if (!gameState.revealed[y][x] || gameState.board[y][x] <= 0) return;
		socket.emit("chordTile", { roomId: currentRoom, r: y, c: x });
		// animate a small chord pulse for quick feedback
		animateChordPulse(x, y);
	};

	// 2. 右键点击：插旗/问号
	canvas.oncontextmenu = (e) => {
		e.preventDefault();
		// If we just completed a right-drag that sent a signal, skip this context menu toggle
		if (canvas._suppressNextContextMenu) {
			canvas._suppressNextContextMenu = false;
			return;
		}
		if (!gameState.board || gameState.gameOver) return;

		const { x, y } = getTile(e);
		if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) return;
		if (gameState.revealed[y][x]) return; // 已揭开不能插旗

		const currentVal = gameState.flagged[y][x];
		const nextVal = (currentVal + 1) % 3; // 0->1->2->0 循环

		// [Fix] 检查剩余地雷数，如果已归零且尝试插旗(nextVal===1)，则阻止
		if (nextVal === 1) {
			const currentFlags = countFlags();
			if (currentFlags >= gameState.mines) {
				// 可选：提示用户
				// alert('No mines left to flag!');
				return;
			}
		}

		// 可以在这里加个简单的音效触发(如果未来需要)
		socket.emit("toggleFlag", {
			roomId: currentRoom,
			r: y,
			c: x,
			state: nextVal,
		});
	};

	// 3. 右键拖拽：发信号（改用右键拖拽替代中键），并保留右键快速点击插旗
	let isRightDragging = false;
	let rightDragStart = null;
	let rightDragMoved = false;

	canvas.onmousedown = (e) => {
		// If both left+right clicked together (buttons==3), treat as chord
		if (e.buttons === 3) {
			// chord click
			const { x, y } = getTile(e);
			if (
				!(x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) &&
				gameState.revealed[y][x] &&
				gameState.board[y][x] > 0
			) {
				socket.emit("chordTile", { roomId: currentRoom, r: y, c: x });
				animateChordPulse(x, y);
				return;
			}
		}
		// Start a right-button drag for sending signals
		if (e.button === 2) {
			// 右键
			e.preventDefault();
			isRightDragging = true;
			rightDragStart = getTile(e);
			rightDragMoved = false;
		}
	};

	canvas.onmouseup = (e) => {
		// Right-button drag ended: if user dragged more than tiny threshold, send a signal
		if (isRightDragging && e.button === 2) {
			e.preventDefault();
			const end = getTile(e);
			const dx = end.x - rightDragStart.x;
			const dy = end.y - rightDragStart.y;

			// Movement threshold: require at least 0.5 tile movement to be considered a drag
			const minMove = 0.5;
			if (Math.abs(dx) >= minMove || Math.abs(dy) >= minMove) {
				let type = "question";
				if (Math.abs(dx) > Math.abs(dy)) type = dx > 0 ? "onMyWay" : "help";
				else type = dy > 0 ? "question" : "avoid";

				// Emit the signal at the original tile (rightDragStart)
				socket.emit("sendSignal", {
					roomId: currentRoom,
					type,
					r: rightDragStart.y,
					c: rightDragStart.x,
				});
				// Provide small feedback locally that we sent a signal
				showCenterToast(`Signal: ${type}`, 700);
				// Prevent the subsequent contextmenu handler from toggling a flag
				canvas._suppressNextContextMenu = true;
			}
			isRightDragging = false;
		}
	};

	// Optional: detect movement for the right-drag to provide immediate UI feedback (no heavy drawing required)
	canvas.onmousemove = (e) => {
		if (isRightDragging) {
			const pos = getTile(e);
			const dx = pos.x - rightDragStart.x;
			const dy = pos.y - rightDragStart.y;
			// Use a threshold to avoid jitter
			rightDragMoved = Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5;
			// keep only local right-drag movement state; do not store into gameState to avoid overlay
			// (this prevents any visual overlay; arrow animation removed)
			// rightDragMoved updated above is sufficient for decision-making.
		}
	};

	// Cleanup in case mouseup happens outside of the canvas: reset the dragging state
	const _docMouseUp = (e) => {
		if (isRightDragging && e.button === 2) {
			isRightDragging = false;
		}
	};
	document.addEventListener("mouseup", _docMouseUp);
	canvas._docMouseUpHandler = _docMouseUp;
}

function initCanvas() {
	const canvas = $("boardCanvas");
	if (!canvas) return;

	// 我们希望 Canvas 最大占据屏幕宽度的 65% (留给右侧信息栏)，高度的 85%
	const maxW = window.innerWidth * 0.65;
	const maxH = window.innerHeight * 0.85;

	// 计算两种限制下的最大格子大小，取较小值，保证完全放入屏幕
	const tileW = Math.floor(maxW / gameState.width);
	const tileH = Math.floor(maxH / gameState.height);

	// 设置最小值(比如20px)防止太小看不清，设置最大值(比如60px)防止太大
	gameState.tileSize = Math.min(60, Math.max(20, Math.min(tileW, tileH)));

	// 关键：动态设置 canvas 像素尺寸（解决半个格子 + 点击偏移）
	canvas.width = gameState.width * gameState.tileSize;
	canvas.height = gameState.height * gameState.tileSize;

	// 可选：让 canvas 视觉上居中且不超大（推荐）
	canvas.style.maxWidth = "none";
	canvas.style.maxHeight = "none";
	canvas.style.width = `${canvas.width}px`;
	canvas.style.height = `${canvas.height}px`;

	// update global getTile so all handlers use the correct scaling
	window.getTile = (e) => {
		const rect = canvas.getBoundingClientRect();
		// map CSS coords to canvas pixel coords (handles CSS scaling/HiDPI)
		const px = (e.clientX - rect.left) * (canvas.width / rect.width);
		const py = (e.clientY - rect.top) * (canvas.height / rect.height);
		const x = Math.floor(px / gameState.tileSize);
		const y = Math.floor(py / gameState.tileSize);
		return { x, y };
	};

	bindCanvasEvents(canvas);
}

function performReveal(r, c) {
	if (gameState.board[r][c] === -1) {
		gameState.revealed.forEach((row) => row.fill(true));
		drawBoard();
		endGame(false);
		return;
	}

	const stack = [[c, r]];
	while (stack.length) {
		const [x, y] = stack.pop();
		if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height)
			continue;
		if (gameState.revealed[y][x]) continue;
		gameState.revealed[y][x] = true;
		if (gameState.board[y][x] === 0) {
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (dx === 0 && dy === 0) continue;
					stack.push([x + dx, y + dy]);
				}
			}
		}
	}
	drawBoard();
	if (checkWin()) endGame(true);
}

function countFlags() {
	let n = 0;
	for (const row of gameState.flagged) for (const f of row) if (f === 1) n++;
	return n;
}

function checkWin() {
	for (let y = 0; y < gameState.height; y++) {
		for (let x = 0; x < gameState.width; x++) {
			if (gameState.board[y][x] !== -1 && !gameState.revealed[y][x])
				return false;
		}
	}
	return true;
}

function endGame(won) {
	clearInterval(gameState.timerInterval);
	$("overModal").style.display = "flex";
	$("overTitle").textContent = won ? "Victory!" : "Game Over!";
	$("overMessage").textContent = won
		? `Time: ${$("gameTimer").textContent}`
		: "You hit a mine";

	$("overBackToLobbyBtn").onclick = () => location.reload();
}

function drawBoard() {
	const canvas = $("boardCanvas");
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	const ts = gameState.tileSize;

	// 动态设置 canvas 大小，避免出现“半个格子”
	canvas.width = gameState.width * ts;
	canvas.height = gameState.height * ts;

	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// 新增：提前判断是否胜利（修复 won 未定义）
	const isWon = checkWin(); // 使用你已有的 checkWin() 函数

	for (let y = 0; y < gameState.height; y++) {
		for (let x = 0; x < gameState.width; x++) {
			// [New] Animation check
			if (gameState.creationAnim && gameState.creationAnim.active) {
				const dist = Math.sqrt(x * x + y * y); // Distance from top-left
				if (dist > gameState.creationAnim.radius) continue; // Skip drawing
			}

			const v = gameState.board[y][x];
			const r = gameState.revealed[y][x];
			const f = gameState.flagged[y][x];

			// 绘制格子背景
			ctx.fillStyle = r ? "#ddd" : "#bbb";
			ctx.fillRect(x * ts, y * ts, ts, ts);
			ctx.strokeStyle = "#888";
			ctx.strokeRect(x * ts, y * ts, ts, ts);

			// Mine rendering removed here (previously drew image or vector spikes).
			// To keep the if-else chain syntactically valid, use a disabled branch here.
			if (false) {
				/* mine drawing removed */
			}
			// 绘制数字
			else if (r && v > 0) {
				ctx.save();
				const cols = [
					"",
					"blue",
					"green",
					"red",
					"navy",
					"maroon",
					"teal",
					"black",
					"gray",
				];
				ctx.fillStyle = cols[v] || "black";
				// use dynamic font size relative to tile size and center the text
				ctx.font = `bold ${Math.floor(ts * 0.6)}px Arial`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(String(v), x * ts + ts / 2, y * ts + ts / 2);
				ctx.restore();
			}
			// 绘制旗帜
			else if (f === 1) {
				// red flag
				ctx.save();
				// 微软扫雷风格：红色三角形旗帜 + 黑色旗杆
				const poleX = x * ts + ts * 0.55; // 旗杆位置
				const poleY = y * ts + ts * 0.2;
				const poleH = ts * 0.6;

				// 旗杆底座
				ctx.fillStyle = "#000";
				ctx.fillRect(x * ts + ts * 0.2, y * ts + ts * 0.75, ts * 0.6, ts * 0.1); // Base
				ctx.fillRect(x * ts + ts * 0.3, y * ts + ts * 0.7, ts * 0.4, ts * 0.05); // Base top

				// 旗杆
				ctx.beginPath();
				ctx.moveTo(poleX, poleY);
				ctx.lineTo(poleX, poleY + poleH);
				ctx.lineWidth = 2;
				ctx.strokeStyle = "#000";
				ctx.stroke();

				// 旗面 (红色三角形，指向左边)
				ctx.fillStyle = "#ff0000";
				ctx.beginPath();
				ctx.moveTo(poleX, poleY);
				ctx.lineTo(poleX - ts * 0.35, poleY + ts * 0.15);
				ctx.lineTo(poleX, poleY + ts * 0.3);
				ctx.closePath();
				ctx.fill();

				// 高光
				ctx.fillStyle = "rgba(255,255,255,0.3)";
				ctx.beginPath();
				ctx.moveTo(poleX, poleY);
				ctx.lineTo(poleX - ts * 0.35, poleY + ts * 0.15);
				ctx.lineTo(poleX, poleY + ts * 0.15);
				ctx.closePath();
				ctx.fill();

				ctx.restore();
			} else if (f === 2) {
				// 状态2：白色问号
				ctx.fillStyle = "#ffffff";
				ctx.font = "bold " + ts * 0.8 + "px Arial"; // 动态字体大小
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText("?", x * ts + ts / 2, y * ts + ts / 2);
				// 恢复对齐默认值，防止影响其他绘制
				ctx.textAlign = "left";
				ctx.textBaseline = "alphabetic";
			}

			// cheat visualization removed — feature will be redesigned later
		}
	}

	// 胜利烟花效果（只触发一次）
	// Draw active transient signals overlay
	if (gameState.signals && gameState.signals.length) {
		ctx.save();
		for (let i = gameState.signals.length - 1; i >= 0; i--) {
			const s = gameState.signals[i];
			// remove expired
			if (Date.now() > s.expiresAt) {
				gameState.signals.splice(i, 1);
				continue;
			}
			const labelMap = {
				help: "Help!",
				onMyWay: "OnWay",
				avoid: "Avoid",
				question: "?",
			};
			ctx.globalAlpha = 0.9;
			ctx.fillStyle = "rgba(255,235,59,0.9)";
			ctx.fillRect(s.c * ts, s.r * ts, ts, ts);
			ctx.fillStyle = "#000";
			ctx.font = "bold " + Math.floor(ts * 0.32) + "px Arial";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(
				labelMap[s.type] || "?",
				s.c * ts + ts / 2,
				s.r * ts + ts / 2,
			);
		}
		ctx.restore();
	}
	// Ensure mine icon is on top of overlays (draw any revealed mines on top)
	for (let y = 0; y < gameState.height; y++) {
		for (let x = 0; x < gameState.width; x++) {
			const v = gameState.board[y][x];
			const r = gameState.revealed[y][x];
			// Mine overlay rendering removed here (previously drew spikes)
			// Retaining a no-op block to keep structure valid
			if (false) {
				/* overlay mine rendering removed */
			}
		}
	}
	// NOTE: Arrow overlay removed as per UX preference; signals no longer show arrow while dragging
	if (isWon && !gameState.winEffectPlayed) {
		gameState.winEffectPlayed = true; // 防止重复播放
		// playSound('win');  // 等你加音效时再打开

		let particles = [];
		class Particle {
			constructor() {
				this.x = canvas.width / 2;
				this.y = canvas.height / 2;
				this.vx = Math.random() * 12 - 6;
				this.vy = Math.random() * 12 - 6;
				this.life = 100;
			}
			update() {
				this.x += this.vx;
				this.y += this.vy;
				this.life -= 1;
			}
			draw() {
				ctx.globalAlpha = this.life / 100;
				ctx.fillStyle = `hsl(${Math.random() * 360},100%,50%)`;
				ctx.fillRect(this.x - 3, this.y - 3, 6, 6);
			}
		}

		for (let i = 0; i < 150; i++) particles.push(new Particle());

		const anim = () => {
			ctx.fillStyle = "rgba(0,0,0,0.05)";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			particles = particles.filter((p) => p.life > 0);
			particles.forEach((p) => {
				p.update();
				p.draw();
			});
			if (particles.length > 0) requestAnimationFrame(anim);
		};
		anim();
	}
}

function drawSignal(type, x, y) {
	// This function is kept for backward compatibility but now uses gameState.signals
	addSignal({
		type,
		r: y,
		c: x,
		fromUser: null,
		id: Math.random().toString(36).substring(2, 9).toUpperCase(),
		expiresAt: Date.now() + 2000,
	});
}

function addSignal(signal) {
	// normalize fields
	const {
		id = Math.random().toString(36).substring(2, 9).toUpperCase(),
		type,
		r,
		c,
		fromUser = "",
		expiresAt,
	} = signal;
	const ttl = expiresAt ? expiresAt - Date.now() : 2000;
	const eAt = expiresAt || Date.now() + ttl;
	if (!gameState.signals) gameState.signals = [];
	gameState.signals.push({ id, type, r, c, fromUser, expiresAt: eAt });
	drawBoard();
}

function floodReveal(y, x) {
	const stack = [[x, y]];
	while (stack.length) {
		const [cx, cy] = stack.pop();
		if (cx < 0 || cx >= gameState.width || cy < 0 || cy >= gameState.height)
			continue;
		if (gameState.revealed[cy][cx]) continue;
		gameState.revealed[cy][cx] = true;

		const val = gameState.board[cy][cx];
		if (val === 0) {
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					if (dx === 0 && dy === 0) continue;
					stack.push([cx + dx, cy + dy]);
				}
			}
		}
	}
}

function updateTimer() {
	const sec = Math.floor((Date.now() - gameState.startTime) / 1000);
	const m = String(Math.floor(sec / 60)).padStart(2, "0");
	const s = String(sec % 60).padStart(2, "0");
	$("gameTimer").textContent = `${m}:${s}`;
}

function showGamePage() {
	loadTheme();
	$("mainPage").style.display = "none";
	$("gamePage").style.display = "block";
	// Hide side menu toggle once user enters the game page
	setSideToggleVisible(false);

	const canvas = $("boardCanvas");
	const ctx = canvas.getContext("2d");

	// 防止中键滚轮滚动页面
	canvas.onwheel = (e) => e.preventDefault();
	canvas.onmousedown = (e) => {
		if (e.button === 1) e.preventDefault();
	};

	// === 其他初始化 ===
	if (gameState.board) {
		initCanvas();
		drawBoard();
		loadTheme();
	}
}

function loadTheme() {
	const t = localStorage.getItem("theme") || "classic";
	document.documentElement.setAttribute("data-theme", t);
	if ($("themeSelect")) $("themeSelect").value = t;
	if ($("gamePage").style.display === "block") drawBoard();
}

// Cheat key removed; feature will be reimplemented later

// 如果没有initCanvasEvents，添加一个函数在showGamePage中调用，并在restart中调用
function initCanvasEvents() {
	const canvas = $("boardCanvas");
	canvas.onmousedown = handleMouseDown; // 假设您的鼠标处理函数
	canvas.oncontextmenu = (e) => e.preventDefault();
	// 其他事件
}

function explosionAnim(startX, startY) {
	const canvas = $("boardCanvas");
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	const ts = gameState.tileSize;
	let radius = 0;
	const anim = () => {
		drawBoard(); // 重绘板
		ctx.globalAlpha = 0.5;
		ctx.fillStyle = "orange";
		ctx.beginPath();
		ctx.arc(startX * ts + ts / 2, startY * ts + ts / 2, radius, 0, 2 * Math.PI);
		ctx.fill();
		radius += ts / 2; // 扩散速度
		if (radius < Math.max(gameState.width, gameState.height) * ts) {
			requestAnimationFrame(anim);
		} else {
			// 爆炸完显示所有雷
			gameState.revealed.forEach((row, y) =>
				row.forEach((_, x) => {
					if (gameState.board[y][x] === -1) gameState.revealed[y][x] = true;
				}),
			);
			drawBoard();
		}
	};
	anim();
}

// 封装 fireworksAnim
function fireworksAnim(duration = 3000) {
	// 默认3秒
	const canvas = $("boardCanvas");
	const ctx = canvas.getContext("2d");
	let particles = [];

	class Particle {
		constructor(x, y) {
			this.x = x;
			this.y = y;
			this.speedX = (Math.random() - 0.5) * 10;
			this.speedY = (Math.random() - 0.5) * 10;
			this.life = 255;
			this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
		}
		update() {
			this.x += this.speedX;
			this.y += this.speedY;
			this.life -= 2;
		}
		draw() {
			ctx.globalAlpha = this.life / 255;
			ctx.fillStyle = this.color;
			ctx.beginPath();
			ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// 初始化粒子
	for (let i = 0; i < 100; i++) {
		particles.push(new Particle(canvas.width / 2, canvas.height / 2));
	}

	const startTime = Date.now();
	function anim() {
		ctx.fillStyle = "rgba(0,0,0,0.1)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		particles = particles.filter((p) => p.life > 0);
		particles.forEach((p) => {
			p.update();
			p.draw();
		});
		if (Date.now() - startTime < duration && particles.length > 0) {
			requestAnimationFrame(anim);
		}
	}
	anim();
}

function updateMinesLeft() {
	const el = document.getElementById("minesLeft");
	if (!el || !gameState.flagged) return;

	let flags = 0;
	for (let y = 0; y < gameState.height; y++) {
		for (let x = 0; x < gameState.width; x++) {
			if (gameState.flagged[y][x] === 1) flags++;
		}
	}

	el.style.display = "inline";
	el.textContent = Math.max(0, gameState.mines - flags);
}

function updateMainPageButtons() {
	const startBtn = $("startGameBtn");

	if (currentRoom) {
		startBtn.textContent = "Continue Game";
		startBtn.style.background = "#e67e22";

		startBtn.onclick = () => {
			showGamePage();
		};
	} else {
		startBtn.textContent = "Start Game";
		startBtn.style.background = "";
		startBtn.onclick = () => {
			if (isHost) socket.emit("startGame", currentRoom);
		};
	}
}

function rippleExplosion(centerX, centerY, callback) {
	const canvas = $("boardCanvas");
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	const ts = gameState.tileSize;

	const maxRadius = Math.max(gameState.width, gameState.height) * 1.5;
	let radius = 0;
	const speed = 0.5;

	function anim() {
		if (!gameState.gameOver) return;

		radius += speed;

		drawBoard();

		for (let y = 0; y < gameState.height; y++) {
			for (let x = 0; x < gameState.width; x++) {
				if (gameState.board[y][x] === -1) {
					const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

					if (dist < radius) {
						ctx.fillStyle = "red";

						ctx.fillRect(x * ts, y * ts, ts, ts);

						if (mineExplodeImg.complete && mineExplodeImg.naturalWidth !== 0) {
							const padding = ts * 0.05;

							ctx.drawImage(
								mineExplodeImg,
								x * ts + padding,
								y * ts + padding,
								ts - padding * 2,
								ts - padding * 2,
							);
						} else {
							ctx.beginPath();
							ctx.arc(x * ts + ts / 2, y * ts + ts / 2, ts / 3, 0, Math.PI * 2);
							ctx.fillStyle = "black";
							ctx.fill();
							ctx.fillStyle = "red";
						}
					}
				}
			}
		}

		if (radius < maxRadius) {
			requestAnimationFrame(anim);
		} else {
			if (callback) callback();
		}
	}
	anim();
}

function showOverModal(data) {
	$("overModal").style.display = "flex";

	const newGameBtn = $("startNewGameBtn");
	const backBtn = $("overBackToLobbyBtn");

	// 只有房主显示 Start New Game
	if (isHost) {
		newGameBtn.style.display = "inline-block";
		backBtn.style.display = "inline-block"; // 房主也可以退出

		newGameBtn.onclick = () => {
			$("overModal").style.display = "none";
			// 发送 startGame 会生成新雷
			socket.emit("startGame", currentRoom);
		};
	} else {
		// 非房主只显示 Back to Lobby
		newGameBtn.style.display = "none";
		backBtn.style.display = "inline-block";
	}

	// [Fix] Ensure listener is attached every time modal is shown
	backBtn.onclick = () => {
		$("overModal").style.display = "none";
		location.reload();
	};
}

// Small toast helper for in-game info
function showToast(msg, duration = 2000) {
	let el = document.querySelector(".game-toast");
	if (!el) {
		el = document.createElement("div");
		el.className = "game-toast";
		document.body.appendChild(el);
	}
	el.textContent = msg;
	el.classList.add("show");
	clearTimeout(el._timer);
	el._timer = setTimeout(() => el.classList.remove("show"), duration);
}

// Center toast for illegal operations (e.g., invalid chord)
function showCenterToast(msg, duration = 1600) {
	let el = document.querySelector(".center-toast");
	if (!el) {
		el = document.createElement("div");
		el.className = "center-toast";
		document.body.appendChild(el);
	}
	el.textContent = msg;
	el.classList.add("show");
	clearTimeout(el._timer);
	el._timer = setTimeout(() => el.classList.remove("show"), duration);
}

function animateChordPulse(tileX, tileY) {
	const canvas = $("boardCanvas");
	if (!canvas) return;
	const ts = gameState.tileSize;
	const ctx = canvas.getContext("2d");
	let r = 0;
	const maxR = Math.max(
		2,
		Math.min(8, Math.max(gameState.width, gameState.height) * 0.15),
	);
	const step = maxR / 8;
	gameState.chordPulse = { x: tileX, y: tileY, r: 0 };
	const anim = () => {
		r += step;
		gameState.chordPulse.r = r;
		drawBoard();
		// draw the ring overlay last
		ctx.save();
		ctx.strokeStyle = "rgba(255,235,59,0.9)";
		ctx.lineWidth = Math.max(2, ts * 0.06);
		ctx.beginPath();
		ctx.arc(tileX * ts + ts / 2, tileY * ts + ts / 2, r * ts, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
		if (r < maxR) requestAnimationFrame(anim);
		else {
			gameState.chordPulse = null;
			drawBoard();
		}
	};
	anim();
}
