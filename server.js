const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const activeUsers = new Map();
const activeRooms = new Map();

io.on('connection', (socket) => {
    socket.on('update_location', (data) => {
        activeUsers.set(socket.id, { ...data, id: socket.id });
        io.emit('rooms_list', Array.from(activeRooms.values()));
    });

    socket.on('create_room', (data) => {
        const roomId = 'room_' + Date.now();
        const room = { id: roomId, ...data, members: [socket.id] };
        activeRooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('room_created', room);
        io.emit('rooms_list', Array.from(activeRooms.values()));
    });

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        activeRooms.get(roomId).members.push(socket.id);
        socket.emit('room_joined', activeRooms.get(roomId));
    });

    socket.on('chat_msg', ({ roomId, msg, user }) => {
        io.to(roomId).emit('new_msg', { user, msg, time: new Date().toLocaleTimeString() });
    });

    socket.on('disconnect', () => {
        activeUsers.delete(socket.id);
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
