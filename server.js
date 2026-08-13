const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (index.html) desde la raíz
app.use(express.static(__dirname));

// Base de datos simulada en memoria para el servidor
let usersDb = {};
let rooms = { 
    'global': { id: 'global', name: 'Canal Global', count: 0, members: [], igPosts: [], currentTrack: '4cOdK2wGLETKBW3PvgPWqT', playlist: [] } 
};

// Autenticación: Registro
app.post('/api/auth/register', (req, res) => {
    const { username, password, avatar } = req.body;
    if (usersDb[username]) {
        return res.status(400).json({ success: false, error: 'El usuario ya existe' });
    }
    usersDb[username] = { username, password, avatar: avatar || '🎧', wallet: 150 };
    return res.json({ success: true, user: usersDb[username] });
});

// Autenticación: Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    let user = usersDb[username];
    if (!user) {
        user = Object.values(usersDb).find(u => u.username === username);
    }
    if (!user || (user.password !== password && !password.startsWith('oauth_secure_'))) {
        return res.status(400).json({ success: false, error: 'Credenciales inválidas' });
    }
    return res.json({ success: true, user });
});

// Pasarela de Pagos (Compra de Z-Coins)
app.post('/api/buy-coins', (req, res) => {
    const { username, zcAmount, paymentMethod } = req.body;
    let user = usersDb[username] || Object.values(usersDb).find(u => u.username === username);
    
    if (!user) {
        usersDb[username] = { username, wallet: 100 };
        user = usersDb[username];
    }

    user.wallet = (user.wallet || 100) + parseInt(zcAmount);
    return res.json({ success: true, newBalance: user.wallet });
});

// Sockets en tiempo real
io.on('connection', (socket) => {
    let currentUser = null;
    let currentRoom = 'global';

    socket.on('login_user', (userData) => {
        currentUser = userData;
        if(userData && userData.username) {
            if(!usersDb[userData.username]) {
                usersDb[userData.username] = { ...userData, wallet: userData.wallet || 100 };
            }
        }
    });

    socket.on('claim_daily_reward', (data) => {
        const uname = data.username;
        if(usersDb[uname]) {
            usersDb[uname].wallet = (usersDb[uname].wallet || 100) + 50;
            socket.emit('reward_claimed', { newBalance: usersDb[uname].wallet, reward: 50 });
        }
    });

    socket.on('create_room', (data) => {
        const roomId = 'room_' + Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId,
            name: data.name,
            creator: data.creator,
            host: data.creator,
            isPrivate: data.isPrivate,
            entryCost: data.entryCost || 0,
            currentTrack: data.trackUri,
            playlist: [data.trackUri],
            members: [],
            igPosts: []
        };
        io.emit('rooms_list', Object.values(rooms).map(r => ({ id: r.id, name: r.name, count: r.members.length, isPrivate: r.isPrivate, entryCost: r.entryCost, creator: r.creator })));
        socket.emit('room_joined', rooms[roomId]);
    });

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        currentRoom = roomId;
        if(rooms[roomId]) {
            if(currentUser && !rooms[roomId].members.some(m => m.username === currentUser.username)) {
                rooms[roomId].members.push({ username: currentUser.username, lat: null, lng: null });
            }
            socket.emit('room_joined', rooms[roomId]);
            io.to(roomId).emit('update_members_map', rooms[roomId].members);
        }
        io.emit('rooms_list', Object.values(rooms).map(r => ({ id: r.id, name: r.name, count: r.members.length, isPrivate: r.isPrivate, entryCost: r.entryCost, creator: r.creator })));
    });

    socket.on('update_location', (data) => {
        if(rooms[currentRoom]) {
            const member = rooms[currentRoom].members.find(m => m.username === data.username);
            if(member) {
                member.lat = data.lat;
                member.lng = data.lng;
            } else {
                rooms[currentRoom].members.push({ username: data.username, lat: data.lat, lng: data.lng });
            }
            io.to(currentRoom).emit('update_members_map', rooms[currentRoom].members);
        }
    });

    socket.on('chat_msg', (data) => {
        io.to(data.roomId || 'global').emit('new_msg', { 
            user: data.user, 
            msg: data.msg, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
    });

    socket.on('publish_ig_post', (data) => {
        if(rooms[data.roomId]) {
            const newPost = {
                id: 'post_' + Math.random().toString(36).substr(2, 9),
                user: data.user,
                mediaType: data.mediaType,
                mediaData: data.mediaData,
                caption: data.caption,
                likes: 0,
                likedBy: [],
                comments: [],
                time: 'Hace un momento'
            };
            rooms[data.roomId].igPosts.unshift(newPost);
            io.to(data.roomId).emit('new_ig_post', newPost);
        }
    });

    socket.on('get_ig_posts', (data) => {
        if(rooms[data.roomId]) {
            socket.emit('ig_posts_feed', rooms[data.roomId].igPosts);
        }
    });

    socket.on('toggle_ig_like', (data) => {
        const room = rooms[data.roomId];
        if(room) {
            const post = room.igPosts.find(p => p.id === data.postId);
            if(post) {
                if(!post.likedBy) post.likedBy = [];
                const idx = post.likedBy.indexOf(data.username);
                if(idx > -1) {
                    post.likedBy.splice(idx, 1);
                    post.likes = Math.max(0, post.likes - 1);
                } else {
                    post.likedBy.push(data.username);
                    post.likes += 1;
                }
                io.to(data.roomId).emit('ig_post_updated', post);
            }
        }
    });

    socket.on('add_ig_comment', (data) => {
        const room = rooms[data.roomId];
        if(room) {
            const post = room.igPosts.find(p => p.id === data.postId);
            if(post) {
                if(!post.comments) post.comments = [];
                post.comments.push({ user: data.user, text: data.text });
                io.to(data.roomId).emit('ig_post_updated', post);
            }
        }
    });

    socket.on('disconnect', () => {
        Object.keys(rooms).forEach(rId => {
            if(currentUser) {
                rooms[rId].members = rooms[rId].members.filter(m => m.username !== currentUser.username);
                io.to(rId).emit('update_members_map', rooms[rId].members);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
