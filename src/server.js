const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const BOARD_SIZE = 15;
const WIN_LENGTH = 5;

let nextClientId = 1;
let nextMatchId = 1;
const clients = new Map();
const queue = [];
const matches = new Map();

function send(ws, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function isBoardFull(board) {
  for (const row of board) {
    for (const cell of row) {
      if (cell === null) {
        return false;
      }
    }
  }
  return true;
}

function countDirection(board, row, col, deltaRow, deltaCol, symbol) {
  let count = 0;
  let currentRow = row + deltaRow;
  let currentCol = col + deltaCol;

  while (
    currentRow >= 0 &&
    currentRow < BOARD_SIZE &&
    currentCol >= 0 &&
    currentCol < BOARD_SIZE &&
    board[currentRow][currentCol] === symbol
  ) {
    count += 1;
    currentRow += deltaRow;
    currentCol += deltaCol;
  }

  return count;
}

function hasWinner(board, row, col, symbol) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  return directions.some(([deltaRow, deltaCol]) => {
    const total = 1 + countDirection(board, row, col, deltaRow, deltaCol, symbol) + countDirection(board, row, col, -deltaRow, -deltaCol, symbol);
    return total >= WIN_LENGTH;
  });
}

function getClient(clientId) {
  return clients.get(clientId) || null;
}

function removeFromQueue(clientId) {
  const index = queue.indexOf(clientId);
  if (index !== -1) {
    queue.splice(index, 1);
  }
}

function broadcastQueuePositions() {
  queue.forEach((clientId, index) => {
    const client = getClient(clientId);
    if (!client) {
      return;
    }

    send(client.ws, {
      type: 'queue',
      position: index + 1,
      size: queue.length
    });
  });
}

function syncClientIdle(client) {
  client.state = 'idle';
  client.matchId = null;
  client.symbol = null;
  send(client.ws, {
    type: 'status',
    status: 'idle'
  });
}

function endMatch(match, outcome) {
  if (!match || match.ended) {
    return;
  }

  match.ended = true;
  matches.delete(match.id);

  for (const playerId of match.players) {
    const client = getClient(playerId);
    if (!client) {
      continue;
    }

    const isWinner = outcome.type === 'win' && outcome.winnerId === playerId;
    const result = outcome.type === 'draw' ? 'draw' : isWinner ? 'win' : 'lose';

    send(client.ws, {
      type: 'gameOver',
      result,
      reason: outcome.reason || null,
      board: match.board,
      winnerSymbol: outcome.winnerSymbol || null
    });

    syncClientIdle(client);
  }
}

function startMatch(playerA, playerB) {
  const matchId = String(nextMatchId++);
  const board = createBoard();
  const match = {
    id: matchId,
    board,
    players: [playerA.id, playerB.id],
    symbols: {
      [playerA.id]: 'X',
      [playerB.id]: 'O'
    },
    turnId: playerA.id,
    ended: false
  };

  matches.set(matchId, match);

  [playerA, playerB].forEach((client) => {
    client.state = 'playing';
    client.matchId = matchId;
    client.symbol = match.symbols[client.id];

    send(client.ws, {
      type: 'match',
      matchId,
      board,
      symbol: client.symbol,
      turnSymbol: match.symbols[match.turnId],
      youStart: client.id === match.turnId
    });
  });

  return match;
}

function tryMatchmake() {
  while (queue.length >= 2) {
    const firstId = queue.shift();
    const secondId = queue.shift();
    const first = getClient(firstId);
    const second = getClient(secondId);

    if (!first || !second || first.state !== 'queued' || second.state !== 'queued') {
      continue;
    }

    startMatch(first, second);
  }

  broadcastQueuePositions();
}

function enqueueClient(client) {
  if (client.state !== 'idle') {
    return;
  }

  if (!queue.includes(client.id)) {
    queue.push(client.id);
  }

  client.state = 'queued';
  send(client.ws, {
    type: 'status',
    status: 'queued'
  });

  broadcastQueuePositions();
  tryMatchmake();
}

function leaveQueue(client) {
  if (client.state !== 'queued') {
    return;
  }

  removeFromQueue(client.id);
  syncClientIdle(client);
  broadcastQueuePositions();
}

function handleMove(client, row, col) {
  if (client.state !== 'playing' || client.matchId === null) {
    return;
  }

  const match = matches.get(client.matchId);
  if (!match || match.ended || match.turnId !== client.id) {
    return;
  }

  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return;
  }

  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    return;
  }

  if (match.board[row][col] !== null) {
    return;
  }

  const symbol = client.symbol;
  match.board[row][col] = symbol;

  if (hasWinner(match.board, row, col, symbol)) {
    endMatch(match, {
      type: 'win',
      winnerId: client.id,
      winnerSymbol: symbol
    });
    return;
  }

  if (isBoardFull(match.board)) {
    endMatch(match, { type: 'draw' });
    return;
  }

  match.turnId = match.players.find((playerId) => playerId !== client.id);

  for (const playerId of match.players) {
    const player = getClient(playerId);
    if (!player) {
      continue;
    }

    send(player.ws, {
      type: 'state',
      board: match.board,
      turnSymbol: match.symbols[match.turnId],
      youTurn: player.id === match.turnId
    });
  }
}

function handleDisconnect(client) {
  removeFromQueue(client.id);

  if (client.matchId !== null) {
    const match = matches.get(client.matchId);
    if (match) {
      const opponentId = match.players.find((playerId) => playerId !== client.id);
      endMatch(match, {
        type: 'win',
        winnerId: opponentId,
        winnerSymbol: opponentId ? match.symbols[opponentId] : null,
        reason: 'disconnect'
      });
    }
  }

  clients.delete(client.id);
  broadcastQueuePositions();
}

function serveFile(reqPath, res) {
  const resolvedPath = reqPath === '/' ? '/index.html' : reqPath;
  const safePath = path.normalize(resolvedPath).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  serveFile(requestUrl.pathname, res);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const client = {
    id: String(nextClientId++),
    ws,
    state: 'idle',
    matchId: null,
    symbol: null,
    name: 'Player'
  };

  clients.set(client.id, client);

  send(ws, {
    type: 'welcome',
    clientId: client.id,
    boardSize: BOARD_SIZE,
    winLength: WIN_LENGTH
  });

  ws.on('message', (rawMessage) => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch (error) {
      return;
    }

    if (!message || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'ready') {
      enqueueClient(client);
      return;
    }

    if (message.type === 'leaveQueue') {
      leaveQueue(client);
      return;
    }

    if (message.type === 'move') {
      handleMove(client, message.row, message.col);
      return;
    }

    if (message.type === 'rename' && typeof message.name === 'string') {
      client.name = message.name.trim().slice(0, 24) || client.name;
      return;
    }
  });

  ws.on('close', () => {
    handleDisconnect(client);
  });

  ws.on('error', () => {
    handleDisconnect(client);
  });
});

server.listen(PORT, () => {
  process.stdout.write(`Caro matchmaking server running at http://localhost:${PORT}\n`);
});
