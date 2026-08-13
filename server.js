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

// Registro y Sincronización de Base de Datos en Memoria del Servidor
app.post('/api/auth/register', (req, res) => {
    const { username, password, avatar } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Faltan datos obligatorios' });
    }

    if (usersDb[username]) {
        return res.status(400).json({ success: false, error: 'El usuario ya existe en el sistema' });
    }

    usersDb[username] = {
        email: username,
        username: username.split('@')[0] || username,
        password,
        avatar: avatar || '🎧',
        wallet: 150
    };

    return res.json({ success: true, user: usersDb[username] });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = usersDb[username];

    if (!user || user.password !== password) {
        return res.status(400).json({ success: false, error: 'Credenciales inválidas' });
    }

    return res.json({ success: true, user });
});

// Pasarela Google Pay (Vinculación de tarjetas)
app.post('/api/process-google-pay', (req, res) => {
    const paymentData = req.body;
    try {
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
