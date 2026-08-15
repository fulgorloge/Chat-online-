const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

let activeRooms = {}; // Registro de salas activas

io.on('connection', (socket) => {
    // Enviar lista al entrar
    socket.emit('update_room_list', activeRooms);

    socket.on('create_room', (data) => {
        socket.join(data.roomName);
        activeRooms[data.roomName] = { 
            platform: data.platform, 
            mediaInput: data.mediaInput,
            creator: data.user 
        };
        io.emit('update_room_list', activeRooms);
        socket.emit('room_joined', data);
    });

    socket.on('join_room', (data) => {
        socket.join(data.roomName);
        const roomData = activeRooms[data.roomName];
        socket.emit('room_joined', { 
            roomName: data.roomName, 
            platform: roomData.platform, 
            mediaInput: roomData.mediaInput 
        });
    });

    // Eventos de chat y tipado (mantiene compatibilidad)
    socket.on('typing', (data) => {
        const dest = data.scope === 'room' ? data.roomName : 'global';
        socket.to(dest).emit('display_typing', { user: data.user, scope: data.scope });
    });

    socket.on('room_message', (data) => {
        io.to(data.roomName).emit('room_message', data);
    });

    socket.on('disconnect', () => {
        console.log(`> Desconectado: ${socket.id}`);
    });
});

server.listen(3000, () => console.log('> Servidor GeoVibe activo en :3000'));
