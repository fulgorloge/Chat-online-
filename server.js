const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_tu_clave_secreta_aqui');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const rooms = {};
const users = {}; 

app.post('/create-checkout-session', async (req, res) => {
    const { type, googleId, amount } = req.body;

    try {
        let lineItems = [];
        let metadata = { googleId, type };

        if (type === 'topup') {
            const priceUSD = amount === 50 ? 1.99 : 4.99;
            lineItems.push({
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Paquete de ${amount} NoxCoins`,
                        description: 'Monedas virtuales para efectos y pases en Nox.',
                    },
                    unit_amount: Math.round(priceUSD * 100),
                },
                quantity: 1,
            });
            metadata.amount = amount;
        } else if (type === 'vip') {
            lineItems.push({
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Suscripción VIP Mensual - Nox',
                        description: 'Acceso total a salas exclusivas, corona dorada y ventajas.',
                    },
                    unit_amount: 499,
                },
                quantity: 1,
            });
        }

        const domain = process.env.DOMAIN || 'http://localhost:3000';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: type === 'vip' ? 'subscription' : 'payment',
            success_url: `${domain}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${domain}?payment=cancelled`,
            metadata: metadata
        });

        res.json({ id: session.id });
    } catch (error) {
        console.error("Error creando sesión de Stripe:", error);
        res.status(500).json({ error: error.message });
    }
});

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    socket.on('user-login', (userData) => {
        const { googleId, name, avatar } = userData;
        if (!users[googleId]) {
            users[googleId] = { 
                name, 
                avatar, 
                coins: 100, 
                isVip: false,
                paidRooms: [] 
            };
        } else {
            users[googleId].name = name;
            users[googleId].avatar = avatar;
        }
        socket.emit('sync-user', users[googleId]);
    });

    socket.on('join-room', ({ roomId, googleId }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = { 
                currentTime: 0, 
                isPlaying: false,
                mediaData: { 
                    type: 'video', 
                    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
                    isPPV: false 
                }
            };
        }

        const room = rooms[roomId];
        let hasAccess = !room.mediaData.isPPV;

        if (googleId && users[googleId]) {
            if (users[googleId].isVip || users[googleId].paidRooms.includes(roomId)) {
                hasAccess = true;
            }
        }

        socket.emit('sync-state', {
            roomState: room,
            hasAccess
        });
    });

    socket.on('buy-ppv-ticket', ({ roomId, googleId }) => {
        const room = rooms[roomId];
        const user = users[googleId];

        if (!room || !user) {
            socket.emit('payment-error', 'Datos de sala o usuario inválidos.');
            return;
        }

        const ticketCost = 20; 
        if (user.coins < ticketCost) {
            socket.emit('payment-error', 'No tienes suficientes NoxCoins para comprar este pase.');
            return;
        }

        user.coins -= ticketCost;
        if (!user.paidRooms.includes(roomId)) {
            user.paidRooms.push(roomId);
        }

        socket.emit('sync-user', user);
        socket.emit('ppv-access-granted');
        
        io.to(roomId).emit('chat-message', {
            user: user.name,
            avatar: user.avatar,
            message: '¡Compró su pase de acceso digital (PPV) para el evento! 🎟️',
            isEffect: true,
            isVip: user.isVip
        });
    });

    socket.on('grant-purchase-reward', ({ googleId, type, amount }) => {
        if (!users[googleId]) return;
        if (type === 'topup') {
            users[googleId].coins += amount;
        } else if (type === 'vip') {
            users[googleId].isVip = true;
        }
        socket.emit('sync-user', users[googleId]);
    });

    socket.on('chat-message', (data) => {
        io.to(data.roomId).emit('chat-message', data);
    });

    socket.on('video-action', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            room.currentTime = data.currentTime;
            room.isPlaying = data.action === 'play';
        }
        socket.to(data.roomId).emit('video-action', data);
    });

    socket.on('change-media', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            room.mediaData = data.mediaData;
            room.currentTime = 0;
            room.isPlaying = false;
        }
        io.to(data.roomId).emit('change-media', data.mediaData);
    });

    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de Nox corriendo en http://localhost:${PORT}`);
});
