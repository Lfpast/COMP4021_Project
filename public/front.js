const socket = io();
let username = localStorage.getItem('username');
let currentRoom = null;
let isHost = false;

const $ = (id) => document.getElementById(id);

if (username) {
  document.addEventListener('DOMContentLoaded', showMain);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    $('registerBtn')?.addEventListener('click', handleRegister);
    $('loginBtn')?.addEventListener('click', handleLogin);
  });
}

// ================== Login and Registration ==================
async function handleRegister() {
  const u = $('username').value.trim();
  const p = $('password').value;
  if (!u || !p) return $('loginMsg').textContent = 'Please fill in username and password';

  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();
  $('loginMsg').textContent = data.success ? 'Registration successful! Please log in' : (data.msg || 'Registration failed');
  $('loginMsg').style.color = data.success ? '#6f6' : '#f66';
}

async function handleLogin() {
  const u = $('username').value.trim();
  const p = $('password').value;
  if (!u || !p) return $('loginMsg').textContent = 'Please fill in username and password';

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();

  if (data.success) {
    username = u;
    localStorage.setItem('username', u);
    socket.emit('auth', username);
    showMain();
  } else {
    $('loginMsg').textContent = data.msg || 'Incorrect username or password';
    $('loginMsg').style.color = '#f66';
  }
}

// ================== 主界面显示与所有事件绑定 ==================
function showMain() {
  $('loginModal').style.display = 'none';
  $('mainPage').style.display = 'block';
  $('welcomeUser').textContent = username;

  loadStats();
  loadTheme();
  initGameplaySettings();
  bindLobbyEvents();
  bindLogout(); // 新增：绑定登出
}

function bindLogout() {
  $('logoutBtn').onclick = () => {
    localStorage.removeItem('username');
    location.reload();
  };
}

// 所有大厅按钮事件绑定
function bindLobbyEvents() {
  $('createLobbyBtn').onclick = () => {
    const roomName = $('roomNameInput').value.trim();
    const finalName = roomName || `${username}'s Room`;
    socket.emit('createLobby', finalName);
  };

  $('joinLobbyBtn').onclick = () => {
    const id = $('roomInput').value.trim().toUpperCase();
    if (!id) return alert('Please enter Room ID');
    socket.emit('joinLobby', id);
  };

  $('copyRoomBtn').onclick = () => {
    navigator.clipboard.writeText($('currentRoomId').textContent);
    const btn = $('copyRoomBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy ID', 2000);
  };

  $('modeSelect').onchange = e => {
    if (isHost) socket.emit('setMode', { roomId: currentRoom, mode: e.target.value });
  };
}

// ================== Socket Events ==================
socket.on('lobbyCreated', (data) => {
  currentRoom = data.roomId;
  isHost = true;
  $('currentRoomName').textContent = data.roomName;
  enterRoom();
});

socket.on('joinedLobby', (data) => {
  currentRoom = data.roomId;
  $('currentRoomName').textContent = data.roomName;
  enterRoom();
});

socket.on('joinError', msg => alert('Join failed: ' + msg));

socket.on('playersUpdate', players => {
  const list = $('playersList');
  list.innerHTML = players.map(p => `<li>${p} ${p === username ? '<span style="color:#0af">(You)</span>' : ''}</li>`).join('');
});

socket.on('modeSet', mode => $('modeSelect').value = mode);

socket.on('gameStarted', () => {
  alert('Game started! Waiting for Member 3 to complete the game page...');
});

function enterRoom() {
  $('roomInfo').style.display = 'block';
  $('currentRoomId').textContent = currentRoom;
  $('hostControls').style.display = isHost ? 'block' : 'none';
}

// ================== Stats, Theme, Settings (不变) ==================
async function loadStats() {
  try {
    const res = await fetch(`/stats/${username}`);
    const stats = await res.json();
    const div = $('statsDashboard');
    let html = '<table><tr><th>Game Mode</th><th>Total Games</th><th>Wins</th><th>Win Rate</th><th>Fastest Time</th></tr>';
    for (const [mode, s] of Object.entries(stats)) {
      const rate = s.games ? (s.wins / s.games * 100).toFixed(1) : 0;
      const best = s.bestTime === Infinity ? '-' : (s.bestTime / 1000).toFixed(1) + 's';
      html += `<tr><td>${mode.charAt(0).toUpperCase() + mode.slice(1)}</td><td>${s.games}</td><td>${s.wins}</td><td>${rate}%</td><td>${best}</td></tr>`;
    }
    div.innerHTML = html + '</table>';
  } catch (e) {
    $('statsDashboard').textContent = 'No stats available';
  }
}

function loadTheme() {
  const saved = localStorage.getItem('theme') || 'classic';
  document.documentElement.setAttribute('data-theme', saved);
  const select = $('themeSelect');
  if (select) select.value = saved;
}

$('themeSelect')?.addEventListener('change', (e) => {
  const theme = e.target.value;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
});

function initGameplaySettings() {
  if (window.gameplaySettingsInitialized) return;
  window.gameplaySettingsInitialized = true;

  const autoReveal = localStorage.getItem('autoReveal') === 'true';
  const showTimer = localStorage.getItem('showTimer') === 'true';
  const volume = localStorage.getItem('volume') || '70';

  $('autoReveal').checked = autoReveal;
  $('showTimer').checked = showTimer;
  $('volumeSlider').value = volume;
  $('volumeValue').textContent = volume + '%';

  $('autoReveal').onchange = e => localStorage.setItem('autoReveal', e.target.checked);
  $('showTimer').onchange = e => localStorage.setItem('showTimer', e.target.checked);
  $('volumeSlider').oninput = e => {
    const val = e.target.value;
    $('volumeValue').textContent = val + '%';
    localStorage.setItem('volume', val);
  };
}