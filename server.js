const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`Usuario conectado a Nox: ${socket.id}`);

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`Usuario ${socket.id} se unió a la sala: ${roomId}`);

        if (!rooms[roomId]) {
            rooms[roomId] = { 
                currentTime: 0, 
                isPlaying: false,
                mediaData: { 
                    type: 'video', 
                    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' 
                }
            };
        }

        socket.emit('sync-state', rooms[roomId]);
    });

    socket.on('chat-message', (data) => {
        io.to(data.roomId).emit('chat-message', data);
    });

    socket.on('video-action', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            room.currentTime = data.currentTime;
            room.isPlaying = data.action === 'play';
        }
        socket.to(data.roomId).emit('video-action', data);
    });

    socket.on('change-media', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            room.mediaData = data.mediaData;
            room.currentTime = 0;
            room.isPlaying = false;
        }
        io.to(data.roomId).emit('change-media', data.mediaData);
    });

    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de Nox corriendo en http://localhost:${PORT}`);
});
