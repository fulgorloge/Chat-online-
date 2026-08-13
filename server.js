const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

// Middleware para procesar cuerpos JSON y formularios URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let rooms = {
    'global': { 
        name: 'Sala Global (Cercanos)', 
        members: {}, 
        playlist: ['4cOdK2wGLETKBW3PvgPWqT'], 
        currentTrackIndex: 0,
        isPrivate: false,
        entryCost: 0,
        creator: 'Sistema',
        igPosts: [],
        products: []
    }
};

let usersDb = {}; 
let roomStats = {}; 

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

// --- ENDPOINT REST PARA PASARELA DE PAGO / RECARGA DE MONEDAS ---
app.post('/api/buy-coins', (req, res) => {
    const { username, zcAmount, paymentMethod } = req.body;
    
    if (!username || !zcAmount) {
        return res.status(400).json({ success: false, error: 'Datos de pago incompletos' });
    }

    if (!usersDb[username]) {
        usersDb[username] = { password: '', avatar: '🎧', bio: '', genre: '', wallet: 100 };
    }

    // Acreditar las monedas
    usersDb[username].wallet = (usersDb[username].wallet || 100) + parseInt(zcAmount);

    // Notificar al cliente vía WebSocket si está conectado activamente
    for (let sId of Object.keys(io.sockets.sockets)) {
        const s = io.sockets.sockets.get(sId);
        if (s && s.userProfile && s.userProfile.username === username) {
            s.userProfile.wallet = usersDb[username].wallet;
            s.emit('wallet_credited_external', { 
                newBalance: usersDb[username].wallet, 
                added: zcAmount,
                method: paymentMethod || 'Tarjeta / Pasarela'
            });
            break;
        }
    }

    return res.json({ 
        success: true, 
        message: `Compra de ${zcAmount} ZC procesada correctamente`, 
        newBalance: usersDb[username].wallet 
    });
});

io.on('connection', (socket) => {
    socket.join('global');
    if(!roomStats['global']) roomStats['global'] = { activity: 0 };

    socket.on('login_user', (data) => {
        const { username, password, avatar } = data;
        if (!usersDb[username]) {
            usersDb[username] = { password, avatar: avatar || '🎧', bio: '', genre: '', wallet: 150 };
        } else if (password && usersDb[username].password && usersDb[username].password !== password && !password.startsWith('oauth_secure_')) {
            socket.emit('login_error', 'Contraseña incorrecta');
            return;
        }
        if (usersDb[username].wallet === undefined) usersDb[username].wallet = 100;
        socket.userProfile = { username, avatar: usersDb[username].avatar || avatar || '🎧', ...usersDb[username] };
        socket.emit('login_success', socket.userProfile);
    });

    socket.on('update_profile', (data) => {
        if (usersDb[data.username]) {
            usersDb[data.username].bio = data.bio;
            usersDb[data.username].genre = data.genre;
            if (socket.userProfile) {
                socket.userProfile.bio = data.bio;
                socket.userProfile.genre = data.genre;
            }
        }
    });

    socket.on('update_location', (data) => {
        let cleanUsername = data.username ? data.username.replace(/^[^\w\s]+\s*/, '') : 'Anónimo';
        if (!socket.userProfile && cleanUsername) {
            let existingWallet = 100;
            if (usersDb[cleanUsername]) existingWallet = usersDb[cleanUsername].wallet || 100;
            socket.userProfile = { username: cleanUsername, avatar: data.avatar || '🎧', bio: '', genre: '', wallet: existingWallet };
        }
        if (!socket.userProfile) return;

        socket.userData = { ...data, username: socket.userProfile.username, avatar: socket.userProfile.avatar };
        rooms['global'].members[socket.id] = socket.userData;

        socket.emit('rooms_list', Object.keys(rooms).map(id => ({ 
            id, 
            name: rooms[id].name, 
            count: Object.keys(rooms[id].members || {}).length,
            isPrivate: rooms[id].isPrivate || false,
            entryCost: rooms[id].entryCost || 0,
            creator: rooms[id].creator || 'Sistema'
        })));
    });

    socket.on('create_room', (data) => {
        const roomId = Math.random().toString(36).substring(7);
        const initialTrack = data.trackUri || '4cOdK2wGLETKBW3PvgPWqT';
        const isPrivate = Boolean(data.isPrivate);
        const entryCost = parseInt(data.entryCost) || 0;
        const creator = data.creator || (socket.userProfile ? socket.userProfile.username : 'Anónimo');
        
        rooms[roomId] = { 
            name: data.name || 'Sala Operativa', 
            members: { [socket.id]: socket.userData || { username: creator, avatar: socket.userProfile ? socket.userProfile.avatar : '🎧' } }, 
            playlist: [initialTrack], 
            currentTrackIndex: 0,
            isPrivate,
            entryCost,
            creator,
            igPosts: [],
            products: []
        };
        roomStats[roomId] = { activity: 0 };
        
        socket.join(roomId);
        socket.emit('room_joined', { id: roomId, ...rooms[roomId], currentTrack: initialTrack });
        
        io.emit('rooms_list', Object.keys(rooms).map(id => ({ 
            id, 
            name: rooms[id].name, 
            count: Object.keys(rooms[id].members || {}).length,
            isPrivate: rooms[id].isPrivate || false,
            entryCost: rooms[id].entryCost || 0,
            creator: rooms[id].creator || 'Sistema'
        })));
    });

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

    socket.on('pay_room_entry', (data) => {
        const { roomId, cost, username, creator } = data;
        if(usersDb[username]) {
            if(usersDb[username].wallet >= cost) {
                usersDb[username].wallet -= cost;
                socket.emit('wallet_deducted', { newBalance: usersDb[username].wallet });
                if(socket.userProfile) socket.userProfile.wallet = usersDb[username].wallet;

                for(let sId of Object.keys(io.sockets.sockets)) {
                    const s = io.sockets.sockets.get(sId);
                    if(s && s.userProfile && s.userProfile.username === creator) {
                        usersDb[creator].wallet = (usersDb[creator].wallet || 100) + cost;
                        s.userProfile.wallet = usersDb[creator].wallet;
                        s.emit('wallet_credited', { amount: cost, newBalance: usersDb[creator].wallet });
                        break;
                    }
                }
            }
        }
    });

    socket.on('claim_daily_reward', (data) => {
        const { username } = data;
        const reward = 25;
        if(usersDb[username]) {
            usersDb[username].wallet = (usersDb[username].wallet || 100) + reward;
            if(socket.userProfile) socket.userProfile.wallet = usersDb[username].wallet;
            socket.emit('reward_claimed', { reward, newBalance: usersDb[username].wallet });
        }
    });

    socket.on('award_user_zc', (data) => {
        const { username, amount } = data;
        if(usersDb[username]) {
            usersDb[username].wallet = (usersDb[username].wallet || 100) + amount;
            if(socket.userProfile) socket.userProfile.wallet = usersDb[username].wallet;
            socket.emit('wallet_deducted', { newBalance: usersDb[username].wallet });
        }
    });

    socket.on('send_room_tip', (data) => {
        const { roomId, amount, fromUser } = data;
        const room = rooms[roomId];
        if(!room) return;
        const creator = room.creator;
        if(usersDb[creator]) {
            usersDb[creator].wallet = (usersDb[creator].wallet || 100) + amount;
            for(let sId of Object.keys(io.sockets.sockets)) {
                const s = io.sockets.sockets.get(sId);
                if(s && s.userProfile && s.userProfile.username === creator) {
                    s.userProfile.wallet = usersDb[creator].wallet;
                    s.emit('incoming_tip', { amount, fromUser });
                    break;
                }
            }
        }
    });

    socket.on('publish_ig_post', (data) => {
        const { roomId, user, mediaType, mediaData, caption } = data;
        const room = rooms[roomId];
        if(!room) return;
        if(!room.igPosts) room.igPosts = [];
        const newPost = {
            id: 'ig_' + Math.random().toString(36).substring(7),
            user,
            mediaType,
            mediaData,
            caption,
            likes: 0,
            likedBy: [],
            comments: [],
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        room.igPosts.unshift(newPost);
        io.to(roomId).emit('new_ig_post', newPost);
    });

    socket.on('get_ig_posts', (data) => {
        const room = rooms[data.roomId];
        if(room) {
            socket.emit('ig_posts_feed', room.igPosts || []);
        }
    });

    socket.on('toggle_ig_like', (data) => {
        const { roomId, postId, username } = data;
        const room = rooms[roomId];
        if(!room || !room.igPosts) return;
        const post = room.igPosts.find(p => p.id === postId);
        if(!post) return;
        
        if(!post.likedBy) post.likedBy = [];
        const index = post.likedBy.indexOf(username);
        if(index === -1) {
            post.likedBy.push(username);
            post.likes += 1;
        } else {
            post.likedBy.splice(index, 1);
            post.likes = Math.max(0, post.likes - 1);
        }
        io.to(roomId).emit('ig_post_updated', post);
    });

    socket.on('add_ig_comment', (data) => {
        const { roomId, postId, user, text } = data;
        const room = rooms[roomId];
        if(!room || !room.igPosts) return;
        const post = room.igPosts.find(p => p.id === postId);
        if(!post) return;

        if(!post.comments) post.comments = [];
        post.comments.push({ user, text });
        io.to(roomId).emit('ig_post_updated', post);
    });

    socket.on('publish_product', (data) => {
        const { roomId, title, price, seller } = data;
        const room = rooms[roomId];
        if(!room) return;
        const product = { title, price, seller };
        if(!room.products) room.products = [];
        room.products.push(product);
        io.to(roomId).emit('incoming_product', product);
    });

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

    socket.on('private_msg', (data) => {
        for (let sId of Object.keys(io.sockets.sockets)) {
            const s = io.sockets.sockets.get(sId);
            if (s && s.userProfile && s.userProfile.username === data.targetUser) {
                s.emit('incoming_dm', { from: socket.userProfile.username, msg: data.msg });
                break;
            }
        }
    });

    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('display_typing', { user: data.user, isTyping: data.isTyping });
    });

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
    console.log(`Servidor GeoVibe Supremo Pro activo en puerto ${PORT}`);
});
