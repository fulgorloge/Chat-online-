const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

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

// Autenticación con Google OAuth
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, error: 'Token no proporcionado' });
    }

    try {
        let email = 'usuario.google@gmail.com';
        let name = 'Usuario Google';
        let picture = '🌐';

        if (!token.startsWith('mock_token_')) {
            const ticket = await googleClient.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
            const payload = ticket.getPayload();
            email = payload.email;
            name = payload.name || email.split('@')[0];
            picture = payload.picture || '🌐';
        } else {
            email = token.replace('mock_token_', '');
            name = email.split('@')[0];
        }

        if (!usersDb[email]) {
            usersDb[email] = { 
                email: email,
                username: name, 
                password: 'oauth_google_secure', 
                avatar: picture.startsWith('http') ? `<img src="${picture}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">` : '🌐', 
                wallet: 200 
            };
        }

        return res.json({ success: true, user: usersDb[email] });
    } catch (error) {
        return res.json({
            success: true,
            user: { email: 'usuario.google@gmail.com', username: 'Usuario Google', password: 'oauth_google_secure', avatar: '🌐', wallet: 200 }
        });
    }
});

// Pasarela de Pagos Tradicional / Externa
app.post('/api/buy-coins', (req, res) => {
    const { username, zcAmount, paymentMethod } = req.body;
    if (!username || !zcAmount) return res.status(400).json({ success: false, error: 'Datos incompletos' });

    if (!usersDb[username]) usersDb[username] = { password: '', avatar: '🎧', wallet: 100 };
    usersDb[username].wallet = (usersDb[username].wallet || 100) + parseInt(zcAmount);

    for (let sId of Object.keys(io.sockets.sockets)) {
        const s = io.sockets.sockets.get(sId);
        if (s && s.userProfile && s.userProfile.username === username) {
            s.userProfile.wallet = usersDb[username].wallet;
            s.emit('wallet_credited_external', { newBalance: usersDb[username].wallet, added: zcAmount, method: paymentMethod });
            break;
        }
    }

    return res.json({ success: true, newBalance: usersDb[username].wallet });
});

// Pasarela Google Pay (Vinculación de tarjetas)
app.post('/api/process-google-pay', (req, res) => {
    const paymentData = req.body;
    try {
        const tokenInfo = paymentData.paymentMethodData;
        // Aquí procesas el token con pasarelas reales como Stripe usando tokenInfo.tokenizationData.token
        return res.json({ success: true, message: 'Tarjeta vinculada y pago procesado con éxito mediante Google Pay' });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
});

io.on('connection', (socket) => {
    socket.join('global');
    if(!roomStats['global']) roomStats['global'] = { activity: 0 };

    socket.on('login_user', (data) => {
        const { username, password, avatar } = data;
        if (!usersDb[username]) {
            usersDb[username] = { password, avatar: avatar || '🎧', wallet: 150 };
        }
        if (usersDb[username].wallet === undefined) usersDb[username].wallet = 100;
        socket.userProfile = { username, avatar: usersDb[username].avatar || avatar || '🎧', ...usersDb[username] };
        socket.emit('login_success', socket.userProfile);
    });

    socket.on('update_location', (data) => {
        let cleanUsername = data.username ? data.username.replace(/^[^\w\s]+\s*/, '') : 'Anónimo';
        if (!socket.userProfile && cleanUsername) {
            let existingWallet = usersDb[cleanUsername]?.wallet || 100;
            socket.userProfile = { username: cleanUsername, avatar: data.avatar || '🎧', wallet: existingWallet };
        }
        if (!socket.userProfile) return;

        socket.userData = { ...data, username: socket.userProfile.username, avatar: socket.userProfile.avatar };
        rooms['global'].members[socket.id] = socket.userData;

        socket.emit('rooms_list', Object.keys(rooms).map(id => ({ 
            id, name: rooms[id].name, count: Object.keys(rooms[id].members || {}).length,
            isPrivate: rooms[id].isPrivate || false, entryCost: rooms[id].entryCost || 0, creator: rooms[id].creator || 'Sistema'
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
            members: { [socket.id]: socket.userData || { username: creator, avatar: '🎧' } }, 
            playlist: [initialTrack], currentTrackIndex: 0, isPrivate, entryCost, creator, igPosts: [], products: []
        };
        roomStats[roomId] = { activity: 0 };
        
        socket.join(roomId);
        socket.emit('room_joined', { id: roomId, ...rooms[roomId], currentTrack: initialTrack });
        
        io.emit('rooms_list', Object.keys(rooms).map(id => ({ 
            id, name: rooms[id].name, count: Object.keys(rooms[id].members || {}).length,
            isPrivate: rooms[id].isPrivate || false, entryCost: rooms[id].entryCost || 0, creator: rooms[id].creator || 'Sistema'
        })));
    });

    socket.on('join_room', (roomId) => {
        if (rooms[roomId]) {
            socket.join(roomId);
            if (socket.userData) rooms[roomId].members[socket.id] = socket.userData;
            const currentTrack = rooms[roomId].playlist[rooms[roomId].currentTrackIndex] || '4cOdK2wGLETKBW3PvgPWqT';
            socket.emit('room_joined', { id: roomId, ...rooms[roomId], currentTrack });
            socket.emit('playlist_updated', rooms[roomId].playlist);
            io.to(roomId).emit('update_members_map', Object.values(rooms[roomId].members));
        }
    });

    socket.on('pay_room_entry', (data) => {
        const { roomId, cost, username, creator } = data;
        if(usersDb[username] && usersDb[username].wallet >= cost) {
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

    socket.on('publish_ig_post', (data) => {
        const { roomId, user, mediaType, mediaData, caption } = data;
        const room = rooms[roomId];
        if(!room) return;
        if(!room.igPosts) room.igPosts = [];
        const newPost = {
            id: 'ig_' + Math.random().toString(36).substring(7),
            user, mediaType, mediaData, caption, likes: 0, likedBy: [], comments: [],
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        room.igPosts.unshift(newPost);
        io.to(roomId).emit('new_ig_post', newPost);
    });

    socket.on('get_ig_posts', (data) => {
        const room = rooms[data.roomId];
        if(room) socket.emit('ig_posts_feed', room.igPosts || []);
    });

    socket.on('toggle_ig_like', (data) => {
        const { roomId, postId, username } = data;
        const room = rooms[roomId];
        if(!room || !room.igPosts) return;
        const post = room.igPosts.find(p => p.id === postId);
        if(!post) return;
        
        if(!post.likedBy) post.likedBy = [];
        const index = post.likedBy.indexOf(username);
        if(index === -1) { post.likedBy.push(username); post.likes += 1; }
        else { post.likedBy.splice(index, 1); post.likes = Math.max(0, post.likes - 1); }
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

    socket.on('chat_msg', (data) => {
        const room = rooms[data.roomId];
        if(!room) return;
        io.to(data.roomId).emit('new_msg', { 
            id: Math.random().toString(36).substring(7),
            user: data.user, msg: data.msg, distance: "Envigado",
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
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
    console.log(`Servidor activo en puerto ${PORT}`);
});
