const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

let activeRooms = {}; // Almacena salas activas

io.on('connection', (socket) => {
    socket.emit('update_room_list', activeRooms);

    socket.on('create_room', (data) => {
        socket.join(data.roomName);
        activeRooms[data.roomName] = { platform: data.platform, mediaInput: data.mediaInput, creator: data.user };
        io.emit('update_room_list', activeRooms);
        socket.emit('room_joined', { roomName: data.roomName, ...activeRooms[data.roomName] });
    });

    socket.on('join_room', (data) => {
        socket.join(data.roomName);
        socket.emit('room_joined', { roomName: data.roomName, ...activeRooms[data.roomName] });
    });

    socket.on('room_message', (data) => {
        io.to(data.roomName).emit('room_message', data);
    });

    socket.on('disconnect', () => console.log('Nodo desconectado'));
});

const PORT = 3000;
server.listen(PORT, () => console.log(`> GeoVibe activo en puerto ${PORT}`));
