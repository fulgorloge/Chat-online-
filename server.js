const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

let rooms = {
    'global': { 
        name: 'Sala Global (Cercanos)', 
        members: {}, 
        playlist: ['4cOdK2wGLETKBW3PvgPWqT'], 
        currentTrackIndex: 0 
    }
};

let usersDb = {}; // Base de datos temporal de cuentas
let roomStats = {}; // Estadísticas de actividad para las gráficas

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

io.on('connection', (socket) => {
    socket.join('global');
    if(!roomStats['global']) roomStats['global'] = { activity: 0 };

    // Autenticación de usuario
    socket.on('login_user', (data) => {
        const { username, password, avatar } = data;
        if (!usersDb[username]) {
            usersDb[username] = { password, avatar };
        } else if (usersDb[username].password !== password) {
            socket.emit('login_error', 'Contraseña incorrecta');
            return;
        }
        socket.userProfile = { username, avatar };
        socket.emit('login_success', socket.userProfile);
    });

    // Actualización de ubicación y envío de lista de salas
    socket.on('update_location', (data) => {
        if (!socket.userProfile && data.username) {
            socket.userProfile = { username: data.username, avatar: data.avatar || '🎧' };
        }
        if (!socket.userProfile) return;

        socket.userData = { ...data, ...socket.userProfile };
        rooms['global'].members[socket.id] = socket.userData;

        // Enviar lista actualizada de salas al cliente
        socket.emit('rooms_list', Object.keys(rooms).map(id => ({ 
            id, 
            name: rooms[id].name, 
            count: Object.keys(rooms[id].members || {}).length 
        })));
    });

    // Crear Sala
    socket.on('create_room', (data) => {
        const roomId = Math.random().toString(36).substring(7);
        const initialTrack = data.trackUri || '4cOdK2wGLETKBW3PvgPWqT';
        
        rooms[roomId] = { 
            name: data.name, 
            members: { [socket.id]: socket.userData || { username: 'Anónimo' } }, 
            playlist: [initialTrack], 
            currentTrackIndex: 0 
        };
        roomStats[roomId] = { activity: 0 };
        
        socket.join(roomId);
        socket.emit('room_joined', { id: roomId, ...rooms[roomId], currentTrack: initialTrack });
        
        io.emit('rooms_list', Object.keys(rooms).map(id => ({ 
            id, 
            name: rooms[id].name, 
            count: Object.keys(rooms[id].members || {}).length 
        })));
    });

    // Unirse a Sala
    socket.on('join_room', (roomId) => {
        if (rooms[roomId]) {
            socket.join(roomId);
            if (socket.userData) {
                rooms[roomId].members[socket.id] = socket.userData;
            }
            const currentTrack = rooms[roomId].playlist[rooms[roomId].currentTrackIndex] || '4cOdK2wGLETKBW3PvgPWqT';
            socket.emit('room_joined', { id: roomId, ...rooms[roomId], currentTrack });
            socket.emit('playlist_updated', rooms[roomId].playlist);
            io.to(roomId).emit('update_members_map', Object.values(rooms[roomId].members));
        }
    });

    // Añadir canción a la cola
    socket.on('add_song', (data) => {
        const room = rooms[data.roomId];
        if (!room) return;
        
        room.playlist.push(data.uri);
        if (room.playlist.length === 1) {
            room.currentTrackIndex = 0;
            io.to(data.roomId).emit('play_now', data.uri);
        }
        io.to(data.roomId).emit('playlist_updated', room.playlist);
    });

    // Saltar canción
    socket.on('skip_song', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        
        if (room.currentTrackIndex < room.playlist.length - 1) {
            room.currentTrackIndex++;
        } else {
            room.currentTrackIndex = 0;
        }
        const nextTrack = room.playlist[room.currentTrackIndex];
        io.to(roomId).emit('play_now', nextTrack);
    });

    // Mensajería de Chat y Distancias
    socket.on('chat_msg', (data) => {
        const room = rooms[data.roomId];
        if(!room) return;

        if (roomStats[data.roomId]) roomStats[data.roomId].activity += 1;
        io.to(data.roomId).emit('update_stats', roomStats[data.roomId].activity);

        let distanceText = "Ubicación oculta";
        if (socket.userData && socket.userData.lat && socket.userData.lng) {
            const membersList = Object.values(room.members || {});
            if (membersList.length > 1) {
                const other = membersList.find(m => m.username !== data.user);
                if (other && other.lat && other.lng) {
                    const dist = getDistanceFromLatLonInMeters(socket.userData.lat, socket.userData.lng, other.lat, other.lng);
                    distanceText = dist < 1000 ? `${dist} m de ti` : `${(dist/1000).toFixed(1)} km de ti`;
                }
            }
        }

        io.to(data.roomId).emit('new_msg', { 
            id: Math.random().toString(36).substring(7),
            user: data.user, 
            msg: data.msg, 
            distance: distanceText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
    });

    // Notas de voz
    socket.on('send_voice', (data) => {
        io.to(data.roomId).emit('incoming_voice', {
            from: socket.userProfile ? socket.userProfile.username : 'Anónimo',
            audioBlob: data.audioBlob
        });
    });

    // Mensajería Privada (DM)
    socket.on('private_msg', (data) => {
        for (let sId of Object.keys(io.sockets.sockets)) {
            const s = io.sockets.sockets.get(sId);
            if (s && s.userProfile && s.userProfile.username === data.targetUser) {
                s.emit('incoming_dm', { from: socket.userProfile.username, msg: data.msg });
                break;
            }
        }
    });

    // Indicador de escritura
    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('display_typing', { user: data.user, isTyping: data.isTyping });
    });

    // Reacciones
    socket.on('react_msg', (data) => {
        io.to(data.roomId).emit('msg_reacted', data);
    });

    // Desconexión
    socket.on('disconnect', () => {
        for (let rId in rooms) {
            if (rooms[rId].members && rooms[rId].members[socket.id]) {
                delete rooms[rId].members[socket.id];
                io.to(rId).emit('update_members_map', Object.values(rooms[rId].members));
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor GeoVibe Supremo activo en puerto ${PORT}`);
});
