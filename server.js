const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

let rooms = {}; // Estructura: { roomId: { name, members, playlist: [], currentTrack: null } }

io.on('connection', (socket) => {
    socket.on('update_location', (data) => {
        socket.userData = data;
        socket.join('global');
    });

    socket.on('create_room', (data) => {
        const roomId = Math.random().toString(36).substring(7);
        rooms[roomId] = { name: data.name, members: [socket.userData.username], playlist: [], currentTrack: null };
        socket.join(roomId);
        socket.emit('room_joined', { id: roomId, ...rooms[roomId] });
    });

    socket.on('add_song', (data) => {
        if (!rooms[data.roomId]) return;
        rooms[data.roomId].playlist.push(data.uri);
        if (!rooms[data.roomId].currentTrack) {
            rooms[data.roomId].currentTrack = data.uri;
            io.to(data.roomId).emit('play_now', data.uri);
        }
        io.to(data.roomId).emit('playlist_updated', rooms[data.roomId].playlist);
    });

    socket.on('chat_msg', (data) => {
        io.to(data.roomId).emit('new_msg', { user: data.user, msg: data.msg, time: new Date().toLocaleTimeString() });
    });
});

http.listen(process.env.PORT || 3000);
