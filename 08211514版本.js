const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// index.html 与 server.js 同目录即可
app.use(express.static(__dirname));

const rooms = new Map();

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('createRoom', ({ name }, cb) => {
        let roomId;
        do {
            roomId = Math.random().toString(36).replace(/[^a-z0-9]/gi, '').substring(0, 5).toUpperCase();
        } while (rooms.has(roomId));
        currentRoom = roomId;
        rooms.set(roomId, { id: roomId, host: socket.id, phase: 'lobby', players: [{ id: socket.id, name }] });
        socket.join(roomId);
        cb({ ok: true, roomId });
    });

    socket.on('joinRoom', ({ roomId, name }, cb) => {
        const room = rooms.get(roomId);
        if (!room) return cb({ ok: false, err: '房间不存在' });
        if (room.phase !== 'lobby') return cb({ ok: false, err: '游戏已开始，无法加入' });
        if (room.players.length >= 8) return cb({ ok: false, err: '房间已满(8人)' });
        currentRoom = roomId;
        socket.join(roomId);
        room.players.push({ id: socket.id, name });
        io.to(roomId).emit('playerList', room.players);
        cb({ ok: true, roomId, players: room.players });
    });

    socket.on('setPhase', (phase) => { const r = rooms.get(currentRoom); if (r) r.phase = phase; });

    // 客户端 → 房主
    socket.on('toHost', (data) => {
        const r = rooms.get(currentRoom);
        if (r && r.host !== socket.id) io.to(r.host).emit('fromClient', { from: socket.id, ...data });
    });

    // 房主 → 房间内所有人（含自己）；非房主仅允许 chat 类型
    socket.on('toAll', (data) => {
        if (!currentRoom) return;
        const r = rooms.get(currentRoom);
        if (!r) return;
        if (r.host !== socket.id && data.type !== 'chat') return; // ★ 非房主只允许聊天
        io.to(currentRoom).emit('fromHost', data);
    });

    // 房主 → 指定玩家（仅限同房间内）
    socket.on('toPlayer', ({ target, data }) => {
        if (!currentRoom) return;
        const r = rooms.get(currentRoom);
        if (!r || r.host !== socket.id) return;           // ★ 仅房主可发
        if (!r.players.some(p => p.id === target)) return; // ★ 目标必须在同房间
        io.to(target).emit('fromHost', data);
    });

    socket.on('disconnect', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        const wasHost = room.host === socket.id;
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) { rooms.delete(currentRoom); return; }
        // ★ 先转移房主身份，再通知离开，确保新房主收到 playerLeft 时已是 host
        if (wasHost) {
            room.host = room.players[0].id;
            io.to(room.players[0].id).emit('newHost', room.players[0].id);
        }
        io.to(currentRoom).emit('playerList', room.players);
        io.to(currentRoom).emit('playerLeft', socket.id);
    });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 乱世·弈界 服务器 → http://localhost:${PORT}`));