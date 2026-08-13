const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

let rooms = {
    'global': { name: 'Sala Global', members: {}, playlist: ['4cOdK2wGLETKBW3PvgPWqT'], currentTrackIndex: 0 }
};
let usersDb = {};
let roomStats = {}; 

io.on('connection', (socket) => {
    socket.on('login_user', (data) => {
        usersDb[data.username] = { password: data.password, avatar: data.avatar };
        socket.userProfile = { username: data.username, avatar: data.avatar };
        socket.emit('login_success', socket.userProfile);
    });

    socket.on('update_location', (data) => {
        socket.userData = { ...data, ...socket.userProfile };
        rooms['global'].members[socket.id] = socket.userData;
    });

    socket.on('create_room', (data) => {
        const roomId = Math.random().toString(36).substring(7);
        rooms[roomId] = { name: data.name, members: { [socket.id]: socket.userData }, playlist: [data.trackUri], currentTrackIndex: 0 };
        roomStats[roomId] = { activity: 0, votes: {} };
        socket.join(roomId);
        socket.emit('room_joined', { id: roomId, ...rooms[roomId] });
    });

    socket.on('join_room', (roomId) => {
        if (rooms[roomId]) {
            socket.join(roomId);
            rooms[roomId].members[socket.id] = socket.userData;
            socket.emit('room_joined', { id: roomId, ...rooms[roomId] });
        }
    });

    socket.on('chat_msg', (data) => {
        if (roomStats[data.roomId]) roomStats[data.roomId].activity += 1;
        io.to(data.roomId).emit('new_msg', { ...data, time: new Date().toLocaleTimeString() });
        io.to(data.roomId).emit('update_stats', roomStats[data.roomId].activity);
    });

    socket.on('vote_song', (data) => {
        roomStats[data.roomId].votes[data.trackUri] = (roomStats[data.roomId].votes[data.trackUri] || 0) + 1;
        io.to(data.roomId).emit('update_votes', roomStats[data.roomId].votes);
    });

    socket.on('send_voice', (data) => io.to(data.roomId).emit('incoming_voice', { from: socket.userProfile.username, audioBlob: data.audioBlob }));
    
    socket.on('disconnect', () => {
        for (let rId in rooms) delete rooms[rId].members[socket.id];
    });
});

http.listen(process.env.PORT || 3000, () => console.log("Servidor GeoVibe Activo"));
