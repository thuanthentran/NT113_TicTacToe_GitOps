const boardEl = document.getElementById('board');
const readyButton = document.getElementById('readyButton');
const resetNameButton = document.getElementById('resetNameButton');
const playerNameInput = document.getElementById('playerName');
const detailText = document.getElementById('detailText');
const connectionStateEl = document.getElementById('connectionState');
const matchStateEl = document.getElementById('matchState');
const queueStateEl = document.getElementById('queueState');
const turnStateEl = document.getElementById('turnState');
const matchBadgeEl = document.getElementById('matchBadge');

const BOARD_SIZE = 15;
const state = {
  socket: null,
  connected: false,
  status: 'connecting',
  queuePosition: null,
  board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)),
  matchId: null,
  symbol: null,
  turnSymbol: null,
  youTurn: false,
  lastResult: null
};

function getSavedName() {
  return localStorage.getItem('caro-player-name') || 'Player';
}

function saveName(name) {
  localStorage.setItem('caro-player-name', name);
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host || 'localhost:3000';
  const socket = new WebSocket(`${protocol}//${host}`);
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.connected = true;
    updateConnection();
    updateDetail('Da ket noi. Bam San sang de vao hang cho.');
    console.log('WS open');
    send({ type: 'rename', name: playerNameInput.value.trim() || 'Player' });
    updateReadyButton();
  });

  socket.addEventListener('close', () => {
    state.connected = false;
    state.status = 'offline';
    state.queuePosition = null;
    state.matchId = null;
    state.symbol = null;
    state.turnSymbol = null;
    state.youTurn = false;
    updateConnection();
    updateHeader();
    updateDetail('Mat ket noi server. Tu dong thu lai sau 2 giay...');
    renderBoard();
    setTimeout(() => {
      if (!state.connected) {
        connect();
      }
    }, 2000);
  });

  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    console.log('WS message', payload);

    if (payload.type === 'welcome') {
      updateDetail(`Server san sang. Board ${payload.boardSize}x${payload.boardSize}, muon thang can ${payload.winLength} o lien tiep.`);
      // ensure ready button reflects connection after welcome
      updateReadyButton();
      return;
    }

    if (payload.type === 'status') {
      state.status = payload.status;
      state.queuePosition = null;
      updateHeader();
      updateReadyButton();
      return;
    }

    if (payload.type === 'queue') {
      state.status = 'queued';
      state.queuePosition = payload.position;
      updateHeader();
      updateReadyButton();
      updateDetail(payload.position === 1 ? 'Ban dang o dau hang cho.' : `Ban dang o vi tri ${payload.position} trong hang cho.`);
      return;
    }

    if (payload.type === 'match') {
      state.status = 'playing';
      state.matchId = payload.matchId;
      state.board = payload.board;
      state.symbol = payload.symbol;
      state.turnSymbol = payload.turnSymbol;
      state.youTurn = Boolean(payload.youStart);
      state.queuePosition = null;
      state.lastResult = null;
      updateHeader();
      updateReadyButton();
      renderBoard();
      updateDetail(`Tran dau da bat dau. Ban la ${state.symbol}. ${state.youTurn ? 'Ban di truoc.' : 'Cho doi luot cua doi thu.'}`);
      return;
    }

    if (payload.type === 'state') {
      state.board = payload.board;
      state.turnSymbol = payload.turnSymbol;
      state.youTurn = Boolean(payload.youTurn);
      updateHeader();
      renderBoard();
      return;
    }

    if (payload.type === 'gameOver') {
      state.board = payload.board;
      state.lastResult = payload.result;
      state.status = 'idle';
      state.matchId = null;
      state.symbol = null;
      state.turnSymbol = null;
      state.youTurn = false;
      updateHeader();
      updateReadyButton();
      renderBoard();

      if (payload.result === 'win') {
        updateDetail(payload.reason === 'disconnect' ? 'Doi thu roi phong. Ban duoc tinh la thang.' : 'Ban da thang. Bam San sang neu muon vao tran tiep theo.');
      } else if (payload.result === 'lose') {
        updateDetail(payload.reason === 'disconnect' ? 'Ban thua vi doi thu da ngat ket noi.' : 'Ban da thua. Bam San sang neu muon cho tran moi.');
      } else {
        updateDetail('Tran hoa. Bam San sang de vao hang cho tran tiep theo.');
      }
      return;
    }
  });
}

function send(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  state.socket.send(JSON.stringify(payload));
}

function updateConnection() {
  connectionStateEl.textContent = state.connected ? 'Da ket noi' : 'Mat ket noi';
  connectionStateEl.className = `status-pill ${state.connected ? 'ready' : ''}`.trim();
}

function updateHeader() {
  matchStateEl.textContent = state.status === 'playing' ? 'Dang choi' : state.status === 'queued' ? 'Trong hang cho' : state.status === 'offline' ? 'Offline' : 'Idle';
  queueStateEl.textContent = state.status === 'queued' && state.queuePosition ? `${state.queuePosition} nguoi truoc ban` : '0 nguoi';
  turnStateEl.textContent = state.status === 'playing' ? (state.youTurn ? 'Den luot ban' : `Den luot ${state.turnSymbol}`) : '-';
  matchBadgeEl.textContent = state.status === 'playing' ? `Dang choi ${state.symbol}` : state.status === 'queued' ? 'Dang hang cho' : state.lastResult === 'win' ? 'Tran dau ket thuc - thang' : state.lastResult === 'lose' ? 'Tran dau ket thuc - thua' : 'Chua vao tran';
  connectionStateEl.className = `status-pill ${state.status === 'queued' ? 'queued' : state.status === 'playing' ? 'playing' : state.connected ? 'ready' : ''}`.trim();
}

function updateReadyButton() {
  if (state.status === 'queued') {
    readyButton.textContent = 'Huy hang cho';
    readyButton.disabled = !state.connected;
    return;
  }

  if (state.status === 'playing') {
    readyButton.textContent = 'Dang choi';
    readyButton.disabled = true;
    return;
  }

  readyButton.textContent = 'San sang';
  readyButton.disabled = !state.connected;
}

function updateDetail(text) {
  detailText.textContent = text;
}

function renderBoard() {
  boardEl.innerHTML = '';

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement('button');
      const value = state.board[row][col];
      const empty = value === null;

      cell.type = 'button';
      cell.className = `cell ${empty ? 'empty' : value.toLowerCase()} ${state.youTurn && empty && state.status === 'playing' ? 'turn' : ''}`.trim();
      cell.textContent = value || '';
      cell.disabled = !empty || !state.youTurn || state.status !== 'playing';
      cell.setAttribute('aria-label', `O ${row + 1}, ${col + 1}`);

      cell.addEventListener('click', () => {
        if (!state.youTurn || state.status !== 'playing' || !empty) {
          return;
        }

        send({ type: 'move', row, col });
      });

      boardEl.appendChild(cell);
    }
  }
}

readyButton.addEventListener('click', () => {
  if (state.status === 'queued') {
    send({ type: 'leaveQueue' });
    state.status = 'idle';
    state.queuePosition = null;
    updateHeader();
    updateReadyButton();
    updateDetail('Da roi hang cho. Bam San sang neu muon quay lai.');
    return;
  }

  if (state.status === 'idle' || state.status === 'connecting') {
    send({ type: 'ready' });
    state.status = 'queued';
    updateHeader();
    updateReadyButton();
    updateDetail('Da vao hang cho. Dang doi doi thu tiep theo...');
  }
});

resetNameButton.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Player';
  saveName(name);
  send({ type: 'rename', name });
  updateDetail(`Da cap nhat ten thanh ${name}.`);
});

playerNameInput.addEventListener('change', () => {
  const name = playerNameInput.value.trim() || 'Player';
  saveName(name);
  send({ type: 'rename', name });
});

playerNameInput.value = getSavedName();
updateConnection();
updateHeader();
updateReadyButton();
renderBoard();
connect();
// expose internal state for debugging in browser console
window.__caroState = state;
