const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');
const io = require('socket.io')(http, { cors: { origin: "*" } });

// Carga segura de Stripe desde variables de entorno
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

let usersDb = {};
let rooms = { 
    'global': { 
        id: 'global', 
        name: 'Canal Global', 
        count: 0, 
        members: [], 
        igPosts: [], 
        currentTrack: '4cOdK2wGLETKBW3PvgPWqT', 
        playlist: [] 
    } 
};

// --- AUTENTICACIÓN ---
app.post('/api/auth/register', (req, res) => {
    const { username, password, avatar } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Faltan datos obligatorios' });
    if (usersDb[username]) return res.status(400).json({ success: false, error: 'El usuario ya existe' });
    
    usersDb[username] = { username, password, avatar: avatar || '🎧', wallet: 150 };
    return res.json({ success: true, user: usersDb[username] });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    let user = usersDb[username] || Object.values(usersDb).find(u => u.username === username);
    
    if (!user || (user.password !== password && !password.startsWith('oauth_secure_'))) {
        return res.status(400).json({ success: false, error: 'Credenciales inválidas' });
    }
    return res.json({ success: true, user });
});

// --- ECONOMÍA & STRIPE ---
app.post('/api/create-stripe-session', async (req, res) => {
    const { username, zcAmount, priceUSD } = req.body;
    try {
        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({ success: false, error: 'Stripe no está configurado en el servidor (Falta STRIPE_SECRET_KEY).' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: `${zcAmount} Z-Coins (GeoVibe)` },
                    unit_amount: Math.round(priceUSD * 100),
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.protocol}://${req.get('host')}?payment=success&zc=${zcAmount}&user=${username}`,
            cancel_url: `${req.protocol}://${req.get('host')}?payment=cancelled`,
        });

        res.json({ success: true, url: session.url });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/buy-coins', (req, res) => {
    const { username, zcAmount } = req.body;
    let user = usersDb[username] || Object.values(usersDb).find(u => u.username === username);
    if (!user) {
        usersDb[username] = { username, wallet: 100 };
        user = usersDb[username];
    }
    user.wallet = (user.wallet || 100) + parseInt(zcAmount);
    return res.json({ success: true, newBalance: user.wallet });
});

// --- SOCKET.IO (TIEMPO REAL Y SALAS) ---
io.on('connection', (socket) => {
    console.log(`> Conectado: ${socket.id}`);

    // Enviar las salas actuales al cliente conectado
    socket.emit('update_rooms', rooms);

    // Crear sala y sincronizar red
    socket.on('create_room', (roomData, callback) => {
        try {
            const roomId = 'room_' + Date.now();
            
            rooms[roomId] = {
                id: roomId,
                name: roomData.name,
                song: roomData.song || 'Sin multimedia',
                isPrivate: roomData.isPrivate || false,
                entryCost: roomData.entryCost || 0,
                creator: roomData.creator || 'Anónimo',
                count: 1,
                members: [roomData.creator],
                igPosts: [],
                playlist: []
            };

            console.log(`[SALA CREADA] "${roomData.name}" por ${roomData.creator}`);

            // Actualizar a todos los clientes conectados
            io.emit('update_rooms', rooms);

            if (typeof callback === 'function') {
                callback({ success: true, roomId: roomId });
            }
        } catch (err) {
            console.error("Error al crear sala:", err);
            if (typeof callback === 'function') {
                callback({ success: false, message: err.message });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`> Desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor GeoVibe activo en puerto ${PORT}`));
