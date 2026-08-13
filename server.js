const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Stripe = require('stripe');
const path = require('path');

// Inicializa Stripe con tu clave secreta (usa variables de entorno en producción)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_tu_clave_secreta_aqui');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta raíz para servir la interfaz visual unificada y evitar errores 404
app.get('/', (req, res) => {
    res.send(HTML_CONTENT);
});

// Base de datos en memoria para el funcionamiento en tiempo real
const db = {
    users: {},     
    rooms: {},     
    locations: {}  
};

// 1. Endpoint para crear la sesión de pago real en Stripe
app.post('/api/create-stripe-session', async (req, res) => {
    try {
        const { username, zcAmount, priceUSD } = req.body;
        if (!username || !zcAmount || !priceUSD) {
            return res.status(400).json({ success: false, error: 'Datos incompletos.' });
        }

        const hostUrl = req.headers.origin || `http://${req.headers.host}`;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Paquete de ${zcAmount} Z-Coins`,
                        description: `Recarga de saldo digital para GeoVibe Enterprise Hub`,
                    },
                    unit_amount: Math.round(priceUSD * 100),
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${hostUrl}/?payment=success&zc=${zcAmount}&user=${encodeURIComponent(username)}`,
            cancel_url: `${hostUrl}/?payment=cancelled`,
        });

        res.json({ success: true, url: session.url });
    } catch (error) {
        console.error('Error en Stripe:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Endpoint para acreditar Z-Coins tras confirmar el pago exitoso
app.post('/api/buy-coins', (req, res) => {
    const { username, zcAmount } = req.body;
    if (!username || !zcAmount) return res.status(400).json({ success: false });

    if (!db.users[username]) {
        db.users[username] = { username, wallet: 100, avatar: '🎧' };
    }

    const added = parseInt(zcAmount, 10);
    db.users[username].wallet = (db.users[username].wallet || 0) + added;

    res.json({ success: true, newBalance: db.users[username].wallet });
});

// 3. Configuración de Socket.io para la comunicación en tiempo real
io.on('connection', (socket) => {
    console.log(`[Socket] Conectado: ${socket.id}`);

    socket.on('login_user', (data) => {
        const { username, avatar, wallet } = data;
        if (!db.users[username]) {
            db.users[username] = { username, avatar: avatar || '🎧', wallet: wallet || 100 };
        }
        socket.data.username = username;
        emitRoomsList();
    });

    socket.on('claim_daily_reward', (data) => {
        const { username } = data;
        if (db.users[username]) {
            const reward = 25;
            db.users[username].wallet += reward;
            socket.emit('reward_claimed', { reward, newBalance: db.users[username].wallet });
        }
    });

    socket.on('update_location', (data) => {
        db.locations[socket.id] = { username: data.username, lat: data.lat, lng: data.lng };
        broadcastRoomMembers(socket.data.currentRoomId);
    });

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

    socket.on('pay_room_entry', (data) => {
        const { roomId, cost, username, creator } = data;
        if (db.users[username] && db.users[username].wallet >= cost) {
            db.users[username].wallet -= cost;
            if (db.users[creator]) db.users[creator].wallet += cost;
        }
    });

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

    socket.on('chat_msg', (data) => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.to(data.roomId).emit('new_msg', { user: data.user, msg: data.msg, time });
    });

    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('display_typing', { user: data.user, isTyping: data.isTyping });
    });

    socket.on('publish_ig_post', (data) => {
        const { roomId, user, mediaType, mediaData, caption } = data;
        if (db.rooms[roomId]) {
            const newPost = {
                id: 'post_' + Math.random().toString(36).substring(2, 9),
                user, mediaType, mediaData, caption,
                likes: 0, likedBy: [], comments: [], time: 'Hace un momento'
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
                const idx = post.likedBy.indexOf(username);
                if (idx === -1) { post.likedBy.push(username); post.likes += 1; }
                else { post.likedBy.splice(idx, 1); post.likes -= 1; }
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
        if (db.users[data.username]) db.users[data.username].wallet += data.amount;
    });

    socket.on('disconnect', () => {
        delete db.locations[socket.id];
        broadcastRoomMembers(socket.data.currentRoomId);
    });
});

function emitRoomsList() {
    const roomsList = Object.values(db.rooms).map(r => ({
        id: r.id, name: r.name,
        count: Object.values(db.locations).filter(l => l.currentRoomId === r.id).length || 1,
        isPrivate: r.isPrivate, entryCost: r.entryCost, creator: r.creator
    }));
    io.emit('rooms_list', roomsList);
}

function broadcastRoomMembers(roomId) {
    if (!roomId) return;
    const members = Object.values(db.locations);
    io.to(roomId).emit('update_members_map', members);
}

// Interfaz Frontend Completa Embebida
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GeoVibe // Enterprise Hub & Social Engine</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        :root { 
            --pz-bg: #04060a; --pz-surface: #0b0f17; --pz-surface-glass: rgba(11, 15, 23, 0.92);
            --pz-border: #1a2336; --pz-border-glow: #25334d; --pz-primary: #2563eb;
            --pz-primary-glow: rgba(37, 99, 235, 0.4); --pz-accent: #059669; --pz-neon: #06b6d4;
            --pz-neon-glow: rgba(6, 182, 212, 0.25); --pz-pink: #db2777; --pz-amber: #d97706;
            --pz-sales: #8b5cf6; --pz-economy: #eab308;
            --pz-google: #ea4335; --pz-facebook: #1877f2; --pz-instagram: #e1306c;
            --pz-text: #f8fafc; --pz-muted: #64748b; --pz-danger: #dc2626;
        }
        * { box-sizing: border-box; }
        body { background: var(--pz-bg); color: var(--pz-text); font-family: 'Outfit', sans-serif; margin: 0; padding: 4px; display: flex; justify-content: center; min-height: 100vh; overflow-x: hidden; }
        #app { width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 6px; }
        .pz-card { background: var(--pz-surface-glass); backdrop-filter: blur(24px); border: 1px solid var(--pz-border); padding: 12px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.8); position: relative; overflow: hidden; }
        h2, h3 { margin: 0 0 8px 0; font-weight: 700; letter-spacing: -0.3px; }
        h2 { font-size: 1.05rem; color: var(--pz-neon); display: flex; align-items: center; gap: 8px; }
        label { font-size: 0.65rem; color: var(--pz-muted); font-weight: 600; text-transform: uppercase; }
        input, select, textarea { width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--pz-border); background: rgba(2, 4, 8, 0.7); color: white; margin: 4px 0; font-family: inherit; font-size: 0.8rem; }
        input:focus, select:focus { border-color: var(--pz-neon); outline: none; box-shadow: 0 0 12px var(--pz-neon-glow); }
        button { width: 100%; padding: 8px 12px; border-radius: 8px; border: none; background: var(--pz-primary); color: white; font-weight: 600; cursor: pointer; margin-top: 4px; font-family: inherit; font-size: 0.8rem; box-shadow: 0 4px 12px var(--pz-primary-glow); }
        button:hover { filter: brightness(1.15); }
        .pz-oauth-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--pz-border); font-weight: 600; cursor: pointer; font-size: 0.8rem; margin-top: 6px; background: rgba(255,255,255,0.04); color: white; }
        .pz-header { display: flex; justify-content: space-between; align-items: center; background: var(--pz-surface); padding: 8px 12px; border-radius: 10px; border: 1px solid var(--pz-border); }
        #map { height: 110px; border-radius: 8px; margin-bottom: 6px; border: 1px solid var(--pz-border); z-index: 1; }
        .pz-list-item { background: rgba(2, 4, 8, 0.5); border: 1px solid var(--pz-border); border-radius: 8px; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 0.75rem; }
        .pz-list-item button { width: auto; padding: 3px 8px; font-size: 0.65rem; margin: 0; }
        .ig-post-card { background: var(--pz-surface); border: 1px solid var(--pz-border); border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
        .ig-post-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .ig-post-media { width: 100%; max-height: 320px; object-fit: cover; background: #000; display: block; }
        .ig-post-actions { display: flex; gap: 12px; padding: 8px 10px; font-size: 1.1rem; }
        .ig-post-actions i { cursor: pointer; }
        .media-tabs { display: flex; gap: 3px; margin-bottom: 6px; overflow-x: auto; }
        .media-tab-btn { flex: 1; padding: 5px 2px; font-size: 0.58rem; background: rgba(255,255,255,0.04); border: 1px solid var(--pz-border); border-radius: 6px; color: var(--pz-muted); cursor: pointer; text-align: center; white-space: nowrap; }
        .media-tab-btn.active { background: var(--pz-surface); color: var(--pz-neon); border-color: var(--pz-neon); font-weight: 700; }
        .media-content-pane { display: none; }
        .media-content-pane.active { display: block; }
        #chat-box { height: 130px; overflow-y: auto; margin-bottom: 6px; display: flex; flex-direction: column; gap: 6px; }
        .msg-bubble { background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 8px; border-left: 2px solid var(--pz-neon); font-size: 0.8rem; }
        .msg-header { display: flex; justify-content: space-between; font-size: 0.6rem; color: var(--pz-muted); margin-bottom: 2px; }
        .pz-tab-content { display: none; flex-direction: column; gap: 8px; }
        .pz-tab-content.active { display: flex; }
    </style>
</head>
<body>
<div id="app">
    <div id="login-screen" class="pz-card" style="margin-top: 15px; text-align: center; padding: 16px;">
        <h2><i class="fa-solid fa-shield-halved"></i> GeoVibe // Core Security</h2>
        <p id="auth-subtitle" style="color: var(--pz-muted); font-size: 0.75rem; margin-bottom: 10px;">Inicia sesión o regístrate</p>
        <div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px;">
            <button class="pz-oauth-btn" onclick="socialAuth('Google', '🌐')"><i class="fa-brands fa-google" style="color: var(--pz-google);"></i> Google</button>
            <button class="pz-oauth-btn" onclick="socialAuth('Facebook', '💙')"><i class="fa-brands fa-facebook" style="color: var(--pz-facebook);"></i> Facebook</button>
            <button class="pz-oauth-btn" onclick="socialAuth('Instagram', '📸')"><i class="fa-brands fa-instagram" style="color: var(--pz-instagram);"></i> Instagram</button>
        </div>
        <input type="text" id="auth-user" placeholder="Correo electrónico o Usuario...">
        <input type="password" id="auth-pass" placeholder="Contraseña...">
        <div id="register-extra-fields" style="display: none;">
            <select id="auth-avatar">
                <option value="🎧">🎧 DJ / Audio</option>
                <option value="🚀">🚀 Campo</option>
                <option value="🔥">🔥 Raver</option>
                <option value="⚡">⚡ Cyberpunk</option>
            </select>
        </div>
        <button id="auth-action-btn" onclick="handleAuthSubmit()">Iniciar Sesión</button>
        <div style="text-align: center; margin-top: 8px; font-size: 0.7rem; color: var(--pz-muted);">
            <span id="auth-toggle-text" onclick="toggleAuthMode()" style="color: var(--pz-neon); cursor: pointer; text-decoration: underline;">¿No tienes cuenta? Regístrate</span>
        </div>
    </div>

    <div id="main-hud" style="display:none; flex-direction: column; gap: 8px;">
        <div class="pz-header">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span id="header-avatar">🎧</span>
                <div>
                    <span id="header-username" style="font-weight: 700; font-size: 0.8rem; display: block;">Operador</span>
                    <span style="font-size: 0.55rem; color: var(--pz-muted);"><span id="status-dot" style="width:6px; height:6px; background:var(--pz-accent); border-radius:50%; display:inline-block;"></span> Activo</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <div style="background: rgba(234, 179, 8, 0.15); border: 1px solid var(--pz-economy); padding: 2px 6px; border-radius: 6px;">
                    <i class="fa-solid fa-coins" style="color: var(--pz-economy);"></i> <span id="header-wallet" style="font-weight: 700; font-size: 0.7rem; color: var(--pz-economy);">100 ZC</span>
                </div>
                <button onclick="switchPzTab('rooms')" style="width: auto; padding: 4px 6px; font-size: 0.65rem;"><i class="fa-solid fa-tower-broadcast"></i></button>
                <button onclick="switchPzTab('economy')" style="width: auto; padding: 4px 6px; font-size: 0.65rem; color:var(--pz-economy);"><i class="fa-solid fa-wallet"></i></button>
                <button onclick="switchPzTab('global-chat')" style="width: auto; padding: 4px 6px; font-size: 0.65rem;"><i class="fa-solid fa-globe"></i></button>
                <button onclick="switchPzTab('profile')" style="width: auto; padding: 4px 6px; font-size: 0.65rem;"><i class="fa-solid fa-sliders"></i></button>
            </div>
        </div>

        <div id="pz-rooms" class="pz-tab-content active">
            <div class="pz-card">
                <h2><i class="fa-solid fa-satellite-dish"></i> Sincronización GPS</h2>
                <button id="btn-init" style="background:#064e3b; color:#34d399;" onclick="initRadar()"><i class="fa-solid fa-location-crosshairs"></i> Vincular Coordenadas</button>
            </div>
            <div class="pz-card">
                <h2><i class="fa-solid fa-circle-plus"></i> Desplegar Sala</h2>
                <input type="text" id="new-room-name" placeholder="Designación de Sala...">
                <input type="text" id="new-room-song" placeholder="ID Spotify o Enlace...">
                <div style="display: flex; gap: 6px; margin: 4px 0; align-items: center;">
                    <label><input type="checkbox" id="room-is-private" onchange="togglePrivateCost()" style="width:auto;"> Privada ZC</label>
                    <input type="number" id="room-entry-cost" value="10" disabled style="margin:0; padding:4px;">
                </div>
                <button onclick="createRoom()">Inicializar Red</button>
            </div>
            <div class="pz-card">
                <h2><i class="fa-solid fa-signal"></i> Redes Activas</h2>
                <div id="rooms-container" style="max-height: 150px; overflow-y: auto;"><p style="color: var(--pz-muted); font-size: 0.75rem;">Escaneando...</p></div>
            </div>
        </div>

        <div id="pz-economy" class="pz-tab-content">
            <div class="pz-card" style="border-color: var(--pz-economy);">
                <h2><i class="fa-solid fa-vault" style="color: var(--pz-economy);"></i> Banco Central ZC</h2>
                <div style="background: rgba(234,179,8,0.08); border: 1px solid var(--pz-economy); border-radius: 8px; padding: 10px; text-align: center; margin-bottom: 8px;">
                    <div id="economy-balance-display" style="font-size: 1.6rem; font-weight: 900; color: var(--pz-economy);">100 ZC</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                    <button onclick="claimDailyReward()" style="background:var(--pz-accent);"><i class="fa-solid fa-gift"></i> Bono Diario</button>
                    <button onclick="openBuyModal()"><i class="fa-solid fa-cart-shopping"></i> Comprar ZC</button>
                </div>
            </div>
        </div>

        <div id="pz-global-chat" class="pz-tab-content">
            <div class="pz-card">
                <h2><i class="fa-solid fa-globe"></i> Canal Global</h2>
                <div id="global-chat-box" style="height: 230px; overflow-y: auto; background:rgba(2, 4, 8, 0.6); border-radius:8px; padding:8px; margin-bottom:6px; font-size:0.8rem;"></div>
                <div style="display: flex; gap: 4px;">
                    <input type="text" id="global-msg-input" placeholder="Transmitir..." style="margin:0;" onkeypress="if(event.key==='Enter') sendGlobalMsg()">
                    <button onclick="sendGlobalMsg()" style="width: 45px; margin:0;"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
        </div>

        <div id="pz-room-active" class="pz-tab-content">
            <div class="pz-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span id="active-room-name" style="font-weight: 900; font-size: 0.9rem; color: var(--pz-neon);">Sala</span>
                    <button onclick="leaveRoom()" style="width: auto; padding: 2px 6px; background: var(--pz-danger);">Salir</button>
                </div>
                <div id="map"></div>
                <div class="media-tabs">
                    <button class="media-tab-btn active" onclick="switchMediaTab('instagram-feed')">Muro</button>
                    <button class="media-tab-btn" onclick="switchMediaTab('spotify')">Spotify</button>
                    <button class="media-tab-btn" onclick="switchMediaTab('arcade')">Juegos</button>
                    <button class="media-tab-btn" onclick="switchMediaTab('sales')">Ventas</button>
                </div>
                <div id="pane-instagram-feed" class="media-content-pane active">
                    <input type="file" id="ig-file-upload" accept="image/*,video/*" style="display:none;" onchange="previewIgUpload(event)">
                    <button onclick="document.getElementById('ig-file-upload').click()" style="background:rgba(255,255,255,0.05); font-size:0.65rem;"><i class="fa-solid fa-image"></i> Adjuntar Medios</button>
                    <div id="ig-preview-container" style="display:none; text-align:center; margin:4px 0;"></div>
                    <input type="text" id="ig-caption-input" placeholder="Pie de foto..." style="font-size:0.75rem;">
                    <button onclick="publishIgPost()" style="background:var(--pz-instagram);"><i class="fa-solid fa-paper-plane"></i> Publicar</button>
                    <div id="ig-posts-container" style="max-height: 180px; overflow-y: auto; margin-top:6px;"></div>
                </div>
                <div id="pane-spotify" class="media-content-pane">
                    <iframe id="spotify-player" src="" width="100%" height="52" frameborder="0" style="border-radius: 6px;"></iframe>
                    <div style="display: flex; gap: 4px; margin-top: 4px;">
                        <input type="text" id="song-input" placeholder="Spotify ID..." style="margin:0; font-size:0.7rem;">
                        <button onclick="addSong()" style="background:#1db954; width:55px; margin:0;"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
                <div id="pane-arcade" class="media-content-pane">
                    <button onclick="startTriviaGame()" style="background:var(--pz-amber); color:#000;"><i class="fa-solid fa-brain"></i> Trivia (+10 ZC)</button>
                    <div id="arcade-game-screen" style="text-align:center; margin-top:4px;"><span id="arcade-msg" style="font-size:0.7rem;">Gana ZC</span><div id="arcade-actions"></div></div>
                </div>
                <div id="pane-sales" class="media-content-pane">
                    <input type="text" id="sales-item-title" placeholder="Artículo..." style="font-size:0.7rem;">
                    <input type="text" id="sales-item-price" placeholder="Precio ZC..." style="font-size:0.7rem;">
                    <button onclick="publishProduct()" style="background:var(--pz-sales);"><i class="fa-solid fa-tag"></i> Publicar</button>
                    <div id="sales-products-list" style="max-height:80px; overflow-y:auto; margin-top:4px;"></div>
                </div>
            </div>
            <div class="pz-card">
                <div id="chat-box"></div>
                <div style="display: flex; gap: 3px;">
                    <input type="text" id="msg-input" placeholder="Mensaje..." style="margin:0;" onkeypress="if(event.key==='Enter') sendMsg()">
                    <button onclick="sendMsg()" style="width: 35px; margin:0;"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
        </div>

        <div id="pz-profile" class="pz-tab-content">
            <div class="pz-card" style="text-align: center;">
                <div id="profile-avatar-big" style="font-size: 2.4rem;">🎧</div>
                <h3 id="profile-name-big">Operador</h3>
                <button onclick="logoutSession()" style="background:var(--pz-danger);">Cerrar Sesión</button>
            </div>
        </div>
    </div>
</div>

<!-- Modales -->
<div id="paywall-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:3000; justify-content:center; align-items:center;">
    <div class="pz-card" style="width: 85%; max-width: 320px; text-align: center;">
        <h2>Acceso Privado ZC</h2>
        <p id="paywall-desc" style="font-size: 0.75rem; color: var(--pz-muted);"></p>
        <div id="paywall-price-tag" style="font-size: 1.2rem; font-weight: 900; color: var(--pz-economy);">50 ZC</div>
        <button onclick="confirmPaywallEntry()" style="background: var(--pz-economy); color: #000;">Pagar y Entrar</button>
        <button onclick="document.getElementById('paywall-modal').style.display='none'" style="background: rgba(255,255,255,0.05);">Cancelar</button>
    </div>
</div>

<div id="buy-coins-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:3000; justify-content:center; align-items:center;">
    <div class="pz-card" style="width: 90%; max-width: 320px;">
        <h2>Comprar Z-Coins</h2>
        <select id="buy-package-select" style="margin-bottom:6px;">
            <option value="100|10">100 ZC - $10.00 USD</option>
            <option value="500|45">500 ZC - $45.00 USD</option>
        </select>
        <button onclick="executeBackendCheckout()" style="background: var(--pz-primary);">Pagar con Stripe</button>
        <button onclick="document.getElementById('buy-coins-modal').style.display='none'" style="background: rgba(255,255,255,0.05);">Cerrar</button>
    </div>
</div>

<script>
    const socket = io();
    let currentRoomId = null, myProfile = null, tempIgMediaData = null, igPostsStore = [], isRegisterMode = false, map = null;
    let pendingRoomIdToJoin = null, pendingRoomCost = 0, pendingRoomCreator = null;

    window.addEventListener('DOMContentLoaded', () => {
        const activeSession = localStorage.getItem('geovibe_active_session');
        if (activeSession) {
            try {
                myProfile = JSON.parse(activeSession);
                if(myProfile && myProfile.username) {
                    activateUserHud(myProfile);
                    socket.emit('login_user', myProfile);
                }
            } catch(e) { localStorage.removeItem('geovibe_active_session'); }
        }

        const urlParams = new URLSearchParams(window.location.search);
        if(urlParams.get('payment') === 'success') {
            fetch('/api/buy-coins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: urlParams.get('user'), zcAmount: urlParams.get('zc') })
            }).then(res => res.json()).then(data => {
                if(data.success) { alert('¡Pago exitoso con Stripe!'); window.history.replaceState({}, '', '/'); }
            });
        }
    });

    function toggleAuthMode() {
        isRegisterMode = !isRegisterMode;
        document.getElementById('register-extra-fields').style.display = isRegisterMode ? 'block' : 'none';
        document.getElementById('auth-action-btn').innerText = isRegisterMode ? 'Registrar Cuenta' : 'Iniciar Sesión';
        document.getElementById('auth-toggle-text').innerText = isRegisterMode ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate';
    }

    function handleAuthSubmit() {
        const identifier = document.getElementById('auth-user').value.trim();
        const password = document.getElementById('auth-pass').value.trim();
        if(!identifier || !password) return alert('Completa los campos.');

        let users = JSON.parse(localStorage.getItem('geovibe_users_db') || '{}');
        if(isRegisterMode) {
            if(users[identifier]) return alert('Usuario ya existe.');
            const user = { username: identifier.split('@')[0], password, avatar: document.getElementById('auth-avatar').value, wallet: 150 };
            users[identifier] = user;
            localStorage.setItem('geovibe_users_db', JSON.stringify(users));
            completeLogin(user);
        } else {
            let user = users[identifier] || Object.values(users).find(u => u.username === identifier);
            if(!user || user.password !== password) return alert('Credenciales inválidas.');
            completeLogin(user);
        }
    }

    function socialAuth(provider, avatar) {
        let id = prompt('Correo/Usuario para ' + provider + ':');
        if(!id) return;
        let users = JSON.parse(localStorage.getItem('geovibe_users_db') || '{}');
        let user = users[id] || { username: id.split('@')[0], avatar, wallet: 200 };
        users[id] = user;
        localStorage.setItem('geovibe_users_db', JSON.stringify(users));
        completeLogin(user);
    }

    function completeLogin(user) {
        myProfile = user;
        localStorage.setItem('geovibe_active_session', JSON.stringify(myProfile));
        socket.emit('login_user', myProfile);
        activateUserHud(myProfile);
    }

    function activateUserHud(p) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-hud').style.display = 'flex';
        document.getElementById('header-avatar').innerText = p.avatar;
        document.getElementById('header-username').innerText = p.username;
        document.getElementById('profile-name-big').innerText = p.avatar + ' ' + p.username;
        updateWallet(p.wallet);
    }

    function updateWallet(w) {
        myProfile.wallet = w;
        localStorage.setItem('geovibe_active_session', JSON.stringify(myProfile));
        document.getElementById('header-wallet').innerText = w + ' ZC';
        document.getElementById('economy-balance-display').innerText = w + ' ZC';
    }

    function logoutSession() { localStorage.removeItem('geovibe_active_session'); location.reload(); }
    function switchPzTab(tab) {
        document.querySelectorAll('.pz-tab-content').forEach(e => e.classList.remove('active'));
        document.getElementById('pz-' + tab).classList.add('active');
    }
    function togglePrivateCost() { document.getElementById('room-entry-cost').disabled = !document.getElementById('room-is-private').checked; }
    function claimDailyReward() { socket.emit('claim_daily_reward', { username: myProfile.username }); }
    function openBuyModal() { document.getElementById('buy-coins-modal').style.display = 'flex'; }
    socket.on('reward_claimed', d => { updateWallet(d.newBalance); alert('¡Bono reclamado!'); });

    async function executeBackendCheckout() {
        const [zc, usd] = document.getElementById('buy-package-select').value.split('|');
        const res = await fetch('/api/create-stripe-session', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: myProfile.username, zcAmount: zc, priceUSD: usd })
        });
        const data = await res.json();
        if(data.success) window.location.href = data.url;
        else alert('Error en Stripe: ' + data.error);
    }

    function initRadar() {
        if(navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                socket.emit('update_location', { lat: pos.coords.latitude, lng: pos.coords.longitude, username: myProfile.username });
                document.getElementById('btn-init').innerText = "✓ Sincronizado";
            });
        }
    }

    socket.on('rooms_list', rooms => {
        document.getElementById('rooms-container').innerHTML = rooms.length === 0 ? '<p style="font-size:0.75rem; color:var(--pz-muted);">No hay redes.</p>' : rooms.map(r => `
            <div class="pz-list-item">
                <div><b>${r.name}</b> ${r.isPrivate ? '🔒' : ''}</div>
                <button onclick="tryJoinRoom('${r.id}', ${r.isPrivate ? r.entryCost : 0}, '${r.creator}')">Conectar</button>
            </div>
        `).join('');
    });

    function createRoom() {
        socket.emit('create_room', {
            name: document.getElementById('new-room-name').value || 'Sala',
            trackUri: document.getElementById('new-room-song').value || '4cOdK2wGLETKBW3PvgPWqT',
            isPrivate: document.getElementById('room-is-private').checked,
            entryCost: parseInt(document.getElementById('room-entry-cost').value) || 10,
            creator: myProfile.username
        });
    }

    function tryJoinRoom(id, cost, creator) {
        if(cost > 0 && creator !== myProfile.username) {
            pendingRoomIdToJoin = id; pendingRoomCost = cost; pendingRoomCreator = creator;
            document.getElementById('paywall-desc').innerText = 'Creado por ' + creator + '. Costo:';
            document.getElementById('paywall-price-tag').innerText = cost + ' ZC';
            document.getElementById('paywall-modal').style.display = 'flex';
        } else { socket.emit('join_room', id); }
    }

    function confirmPaywallEntry() {
        if(myProfile.wallet < pendingRoomCost) return alert('Saldo insuficiente.');
        socket.emit('pay_room_entry', { roomId: pendingRoomIdToJoin, cost: pendingRoomCost, username: myProfile.username, creator: pendingRoomCreator });
        document.getElementById('paywall-modal').style.display = 'none';
        socket.emit('join_room', pendingRoomIdToJoin);
    }

    socket.on('room_joined', room => {
        currentRoomId = room.id;
        switchPzTab('room-active');
        document.getElementById('active-room-name').innerText = room.name;
        document.getElementById('spotify-player').src = 'https://open.spotify.com/embed/track/' + room.currentTrack + '?utm_source=generator&theme=0';
        setTimeout(() => {
            if(!map) { map = L.map('map').setView([6.217, -75.567], 13); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map); }
            else map.invalidateSize();
        }, 300);
    });

    function leaveRoom() { location.reload(); }
    
    function previewIgUpload(e) {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            tempIgMediaData = { type: file.type, data: ev.target.result };
            document.getElementById('ig-preview-container').style.display = 'block';
            document.getElementById('ig-preview-container').innerHTML = '<img src="' + ev.target.result + '" style="max-height:80px; border-radius:4px;">';
        };
        reader.readAsDataURL(file);
    }

    function publishIgPost() {
        if(!tempIgMediaData) return alert('Selecciona un archivo multimedia.');
        socket.emit('publish_ig_post', {
            roomId: currentRoomId, user: myProfile.username,
            mediaType: tempIgMediaData.type, mediaData: tempIgMediaData.data,
            caption: document.getElementById('ig-caption-input').value
        });
        tempIgMediaData = null;
        document.getElementById('ig-preview-container').style.display = 'none';
        document.getElementById('ig-caption-input').value = '';
    }

    socket.on('ig_posts_feed', p => { igPostsStore = p || []; renderIg(); });
    socket.on('new_ig_post', p => { igPostsStore.unshift(p); renderIg(); });
    socket.on('ig_post_updated', up => {
        const i = igPostsStore.findIndex(p => p.id === up.id);
        if(i !== -1) { igPostsStore[i] = up; renderIg(); }
    });

    function renderIg() {
        document.getElementById('ig-posts-container').innerHTML = igPostsStore.map(p => `
            <div class="ig-post-card">
                <div class="ig-post-header"><b>${p.user}</b></div>
                <img src="${p.mediaData}" class="ig-post-media">
                <div class="ig-post-actions"><i class="fa-regular fa-heart" onclick="socket.emit('toggle_ig_like', {roomId: currentRoomId, postId: '${p.id}', username: myProfile.username})"></i> ${p.likes}</div>
                <div style="font-size:0.75rem; padding:4px 10px;">${p.caption || ''}</div>
            </div>
        `).join('');
    }

    function switchMediaTab(t) {
        document.querySelectorAll('.media-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.media-content-pane').forEach(p => p.classList.remove('active'));
        event.currentTarget.classList.add('active');
        document.getElementById('pane-' + t).classList.add('active');
    }

    function startTriviaGame() {
        document.getElementById('arcade-msg').innerText = "¿Protocolo raíz en Termux?";
        document.getElementById('arcade-actions').innerHTML = '<button onclick="socket.emit(\\'award_user_zc\\', {username: myProfile.username, amount: 10}); alert(\\'¡Correcto! +10 ZC\\');" style="background:var(--pz-accent); font-size:0.6rem;">su / tsu</button>';
    }

    function publishProduct() {
        socket.emit('publish_product', {
            roomId: currentRoomId,
            title: document.getElementById('sales-item-title').value,
            price: document.getElementById('sales-item-price').value,
            seller: myProfile.username
        });
    }

    socket.on('incoming_product', d => {
        document.getElementById('sales-products-list').innerHTML += '<div style="font-size:0.7rem;"><b>' + d.title + '</b> - ' + d.price + ' ZC (' + d.seller + ')</div>';
    });

    function addSong() {
        let uri = document.getElementById('song-input').value.trim();
        if(uri) socket.emit('add_song', { roomId: currentRoomId, uri });
    }
    socket.on('play_now', uri => {
        document.getElementById('spotify-player').src = 'https://open.spotify.com/embed/track/' + uri.replace('spotify:track:', '') + '?utm_source=generator&theme=0';
    });

    function sendMsg() {
        let msg = document.getElementById('msg-input').value.trim();
        if(msg) { socket.emit('chat_msg', { roomId: currentRoomId, msg, user: myProfile.username }); document.getElementById('msg-input').value = ''; }
    }
    function sendGlobalMsg() {
        let msg = document.getElementById('global-msg-input').value.trim();
        if(msg) { socket.emit('chat_msg', { roomId: 'global', msg, user: myProfile.username }); document.getElementById('global-msg-input').value = ''; }
    }
    socket.on('new_msg', d => {
        const box = d.roomId === 'global' ? document.getElementById('global-chat-box') : document.getElementById('chat-box');
        if(box) { box.innerHTML += '<div class="msg-bubble"><div class="msg-header"><span><b>' + d.user + '</b></span><span>' + d.time + '</span></div><div>' + d.msg + '</div></div>'; box.scrollTop = box.scrollHeight; }
    });
</script>
</body>
</html>`;

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[GeoVibe Core Server] Ejecutándose en puerto ${PORT}`);
});
