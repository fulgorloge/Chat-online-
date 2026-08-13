// ==========================================
// MÓDULO BACKEND COMPLEMENTARIO (Node.js / Express / Socket.io / Stripe)
// ==========================================
/*
  Agrega este bloque en tu archivo principal de servidor (ej. server.js / app.js)
  para soportar la pasarela de pagos real con Stripe y la persistencia de los
  datos de la aplicación (usuarios, salas, transacciones y muro multimedia).
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Stripe = require('stripe');

// Inicializa Stripe con tu clave secreta (asegúrate de definir STRIPE_SECRET_KEY en tu entorno)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_tu_clave_secreta_aqui');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Base de datos en memoria (o conéctala a tu MongoDB/PostgreSQL)
const db = {
    users: {},     // { username: { username, password, avatar, wallet } }
    rooms: {},     // { roomId: { id, name, trackUri, isPrivate, entryCost, creator, host, members, playlist, igPosts, products } }
    locations: {}  // { socketId: { username, lat, lng } }
};

// 1. Endpoint para crear la sesión de pago real en Stripe
app.post('/api/create-stripe-session', async (req, res) => {
    try {
        const { username, zcAmount, priceUSD } = req.body;
        
        if (!username || !zcAmount || !priceUSD) {
            return res.status(400).json({ success: false, error: 'Datos incompletos para la pasarela.' });
        }

        // URL base de tu entorno (Render, localhost, etc.)
        const hostUrl = req.headers.origin || `http://${req.headers.host}`;

        // Crear sesión de Checkout en Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Paquete de ${zcAmount} Z-Coins`,
                        description: `Recarga de saldo digital para GeoVibe Enterprise Hub`,
                    },
                    unit_amount: Math.round(priceUSD * 100), // Stripe maneja centavos
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${hostUrl}/?payment=success&zc=${zcAmount}&user=${encodeURIComponent(username)}`,
            cancel_url: `${hostUrl}/?payment=cancelled`,
        });

        res.json({ success: true, url: session.url });
    } catch (error) {
        console.error('Error al crear la sesión de Stripe:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Endpoint para acreditar las Z-Coins tras confirmar el pago exitoso
app.post('/api/buy-coins', (req, res) => {
    const { username, zcAmount } = req.body;
    if (!username || !zcAmount) {
        return res.status(400).json({ success: false, error: 'Parámetros inválidos.' });
    }

    // Buscar o inicializar usuario en memoria
    if (!db.users[username]) {
        db.users[username] = { username, wallet: 100, avatar: '🎧' };
    }

    const added = parseInt(zcAmount, 10);
    db.users[username].wallet = (db.users[username].wallet || 0) + added;

    res.json({ success: true, newBalance: db.users[username].wallet });
});

// 3. Gestión de Sockets y Comunicación en Tiempo Real
io.on('connection', (socket) => {
    console.log(`[Socket] Nodo conectado: ${socket.id}`);

    // Autenticación / Registro de usuario en socket
    socket.on('login_user', (data) => {
        const { username, avatar, wallet } = data;
        if (!db.users[username]) {
            db.users[username] = { username, avatar: avatar || '🎧', wallet: wallet || 100 };
        }
        socket.data.username = username;
        emitRoomsList();
    });

    // Reclamar bono diario
    socket.on('claim_daily_reward', (data) => {
        const { username } = data;
        if (db.users[username]) {
            const reward = 25;
            db.users[username].wallet += reward;
            socket.emit('reward_claimed', { reward, newBalance: db.users[username].wallet });
        }
    });

    // Actualización de ubicación GPS
    socket.on('update_location', (data) => {
        db.locations[socket.id] = { username: data.username, lat: data.lat, lng: data.lng };
        broadcastRoomMembers(socket.data.currentRoomId);
    });

    // Crear sala privada o pública
    socket.on('create_room', (data) => {
        const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
        db.rooms[roomId] = {
            id: roomId,
            name: data.name,
            currentTrack: data.trackUri,
            isPrivate: data.isPrivate,
            entryCost: data.entryCost || 0,
            creator: data.creator,
            host: data.creator,
            playlist: [data.trackUri],
            igPosts: [],
            products: []
        };
        emitRoomsList();
        socket.emit('room_joined', db.rooms[roomId]);
    });

    // Pago de entrada a sala privada (Paywall ZC)
    socket.on('pay_room_entry', (data) => {
        const { roomId, cost, username, creator } = data;
        if (db.users[username] && db.users[username].wallet >= cost) {
            db.users[username].wallet -= cost;
            if (db.users[creator]) {
                db.users[creator].wallet += cost; // Comisión para el creador de la sala
            }
        }
    });

    // Unirse a una sala
    socket.on('join_room', (roomId) => {
        if (db.rooms[roomId]) {
            socket.leave(socket.data.currentRoomId);
            socket.join(roomId);
            socket.data.currentRoomId = roomId;
            socket.emit('room_joined', db.rooms[roomId]);
            socket.emit('ig_posts_feed', db.rooms[roomId].igPosts);
            broadcastRoomMembers(roomId);
        }
    });

    // Chat en salas y canal global
    socket.on('chat_msg', (data) => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.to(data.roomId).emit('new_msg', { user: data.user, msg: data.msg, time });
    });

    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('display_typing', { user: data.user, isTyping: data.isTyping });
    });

    // Muro Multimedia Estilo Instagram
    socket.on('publish_ig_post', (data) => {
        const { roomId, user, mediaType, mediaData, caption } = data;
        if (db.rooms[roomId]) {
            const newPost = {
                id: 'post_' + Math.random().toString(36).substring(2, 9),
                user,
                mediaType,
                mediaData,
                caption,
                likes: 0,
                likedBy: [],
                comments: [],
                time: 'Hace un momento'
            };
            db.rooms[roomId].igPosts.unshift(newPost);
            io.to(roomId).emit('new_ig_post', newPost);
        }
    });

    socket.on('toggle_ig_like', (data) => {
        const { roomId, postId, username } = data;
        if (db.rooms[roomId]) {
            const post = db.rooms[roomId].igPosts.find(p => p.id === postId);
            if (post) {
                if (!post.likedBy) post.likedBy = [];
                const index = post.likedBy.indexOf(username);
                if (index === -1) {
                    post.likedBy.push(username);
                    post.likes += 1;
                } else {
                    post.likedBy.splice(index, 1);
                    post.likes -= 1;
                }
                io.to(roomId).emit('ig_post_updated', post);
            }
        }
    });

    socket.on('add_ig_comment', (data) => {
        const { roomId, postId, user, text } = data;
        if (db.rooms[roomId]) {
            const post = db.rooms[roomId].igPosts.find(p => p.id === postId);
            if (post) {
                if (!post.comments) post.comments = [];
                post.comments.push({ user, text });
                io.to(roomId).emit('ig_post_updated', post);
            }
        }
    });

    // Spotify y Multimedia
    socket.on('add_song', (data) => {
        const room = db.rooms[data.roomId];
        if (room) {
            room.playlist.push(data.uri);
            room.currentTrack = data.uri;
            io.to(data.roomId).emit('play_now', data.uri);
            io.to(data.roomId).emit('playlist_updated', room.playlist);
        }
    });

    socket.on('skip_song', (roomId) => {
        const room = db.rooms[roomId];
        if (room && room.playlist.length > 0) {
            const nextUri = room.playlist.shift();
            room.currentTrack = nextUri;
            io.to(roomId).emit('play_now', nextUri);
            io.to(roomId).emit('playlist_updated', room.playlist);
        }
    });

    // Marketplace y Propinas
    socket.on('publish_product', (data) => {
        const room = db.rooms[data.roomId];
        if (room) {
            room.products.push(data);
            io.to(data.roomId).emit('incoming_product', data);
        }
    });

    socket.on('send_room_tip', (data) => {
        io.to(data.roomId).emit('incoming_tip', data);
    });

    socket.on('award_user_zc', (data) => {
        if (db.users[data.username]) {
            db.users[data.username].wallet += data.amount;
        }
    });

    socket.on('disconnect', () => {
        delete db.locations[socket.id];
        broadcastRoomMembers(socket.data.currentRoomId);
        console.log(`[Socket] Desconectado: ${socket.id}`);
    });
});

function emitRoomsList() {
    const roomsList = Object.values(db.rooms).map(r => ({
        id: r.id,
        name: r.name,
        count: Object.values(db.locations).filter(l => l.currentRoomId === r.id).length || 1,
        isPrivate: r.isPrivate,
        entryCost: r.entryCost,
        creator: r.creator
    }));
    io.emit('rooms_list', roomsList);
}

function broadcastRoomMembers(roomId) {
    if (!roomId) return;
    const members = Object.values(db.locations);
    io.to(roomId).emit('update_members_map', members);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[GeoVibe Core Server] Ejecutándose en el puerto ${PORT}`);
});
