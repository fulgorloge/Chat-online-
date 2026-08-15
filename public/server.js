const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// Estado de la plataforma
let activeRooms = {}; 

io.on('connection', (socket) => {
    console.log('Nodo conectado: ' + socket.id);

    // Sincronización de Salas
    socket.on('create_room', (data) => {
        socket.join(data.roomName);
        activeRooms[data.roomName] = { 
            platform: data.platform, 
            media: data.media, 
            owner: data.user 
        };
        io.emit('update_room_list', activeRooms);
    });

    // Chat Global
    socket.on('global_message', (data) => {
        io.emit('global_message', data);
    });

    // Chat de Sala
    socket.on('room_message', (data) => {
        io.to(data.roomName).emit('room_message', data);
    });

    // Indicadores de escritura
    socket.on('typing', (data) => {
        socket.to(data.roomName || 'global').emit('display_typing', data);
    });

    socket.on('disconnect', () => console.log('Nodo desconectado'));
});

server.listen(3000, () => console.log('>>> GeoVibe Core: Online en puerto 3000'));
