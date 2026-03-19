const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }
  // Leaderboard endpoint
  if (req.url === '/leaderboard') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const lb = Object.values(players)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 10)
      .map(p => ({ name: p.name, kills: p.kills, deaths: p.deaths }));
    res.end(JSON.stringify({ players: lb, online: Object.keys(players).length, totalKills }));
    return;
  }
  res.writeHead(200); res.end('URBAN WARFARE SERVER');
});

const wss = new WebSocketServer({ server });

const players = {};
let totalKills = 0;

function broadcast(data, excludeId) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client._playerId !== excludeId) {
      client.send(msg);
    }
  });
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  let myId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'join': {
        myId = msg.id;
        ws._playerId = myId;
        players[myId] = {
          id: myId, name: msg.name, x: 0, y: 1.7, z: 0,
          yaw: 0, health: 100, kills: 0, deaths: 0, weapon: 'ar'
        };
        // Send current players to newcomer
        ws.send(JSON.stringify({ type: 'init', players: Object.values(players).filter(p => p.id !== myId), totalKills }));
        // Announce to others
        broadcast({ type: 'playerJoined', player: players[myId] }, myId);
        break;
      }

      case 'pos': {
        if (!myId || !players[myId]) return;
        players[myId].x = msg.x; players[myId].y = msg.y; players[myId].z = msg.z;
        players[myId].yaw = msg.yaw; players[myId].pitch = msg.pitch;
        players[myId].health = msg.health; players[myId].weapon = msg.weapon;
        broadcast({ type: 'pos', id: myId, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch, health: msg.health, weapon: msg.weapon }, myId);
        break;
      }

      case 'hit': {
        const target = players[msg.target];
        if (!target) return;
        target.health = Math.max(0, target.health - msg.damage);
        // Forward hit to target
        wss.clients.forEach(c => {
          if (c._playerId === msg.target && c.readyState === 1) {
            c.send(JSON.stringify({ type: 'hit', damage: msg.damage, shooterId: myId, shooterName: msg.shooterName, weapon: msg.weapon, headshot: msg.headshot }));
          }
        });
        if (target.health <= 0) {
          target.health = 0;
          target.deaths++;
          if (players[myId]) players[myId].kills++;
          totalKills++;
          broadcastAll({ type: 'kill', killerId: myId, killerName: players[myId]?.name || '?', victimId: msg.target, victimName: target.name, weapon: msg.weapon, headshot: msg.headshot, totalKills });
          // Reset health after respawn delay
          setTimeout(() => {
            if (players[msg.target]) {
              players[msg.target].health = 100;
              wss.clients.forEach(c => {
                if (c._playerId === msg.target && c.readyState === 1) {
                  c.send(JSON.stringify({ type: 'respawn' }));
                }
              });
            }
          }, 5000);
        }
        break;
      }

      case 'grenade': {
        broadcast({ type: 'grenade', id: myId, grenadeType: msg.grenadeType, x: msg.x, y: msg.y, z: msg.z, dx: msg.dx, dy: msg.dy, dz: msg.dz }, myId);
        break;
      }

      case 'pickup': {
        broadcastAll({ type: 'pickup', pickupId: msg.pickupId, playerId: myId });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (myId && players[myId]) {
      broadcast({ type: 'playerLeft', id: myId }, myId);
      delete players[myId];
    }
  });

  ws.on('error', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`URBAN WARFARE server on :${PORT}`));
