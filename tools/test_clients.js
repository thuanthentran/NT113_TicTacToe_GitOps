const WebSocket = require('ws');

function makeClient(name, readyDelay = 0) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:3000');

    ws.on('open', () => {
      console.log(`${name}: open`);
      ws.send(JSON.stringify({ type: 'rename', name }));
      setTimeout(() => {
        console.log(`${name}: sending ready`);
        ws.send(JSON.stringify({ type: 'ready' }));
      }, readyDelay);
    });

    ws.on('message', (raw) => {
      let payload = raw.toString();
      try {
        payload = JSON.parse(raw.toString());
      } catch (e) {}
      console.log(`${name}: recv`, payload);

      if (payload && payload.type === 'gameOver') {
        console.log(`${name}: received gameOver -> closing`);
        ws.close();
      }
    });

    ws.on('close', () => {
      console.log(`${name}: closed`);
      resolve();
    });

    ws.on('error', (err) => {
      console.log(`${name}: error`, err && err.message);
      resolve();
    });
  });
}

(async () => {
  await Promise.all([
    makeClient('ClientA', 200),
    makeClient('ClientB', 800)
  ]);
  console.log('Simulation finished');
  process.exit(0);
})();
