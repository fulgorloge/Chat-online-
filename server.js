const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Simulación de base de datos en memoria (Escalar a MongoDB/PostgreSQL en producción)
const rooms = {};
const users = {}; // Almacena { googleId: { name, avatar, coins, isVip, paidRooms: [] } }

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Autenticación y sincronización de usuario
    socket.on('user-login', (userData) => {
        const { googleId, name, avatar } = userData;
        if (!users[googleId]) {
            users[googleId] = { 
                name, 
                avatar, 
                coins: 100, // Bono inicial de bienvenida
                isVip: false,
                paidRooms: [] 
            };
        } else {
            // Actualizar datos por si cambiaron
            users[googleId].name = name;
            users[googleId].avatar = avatar;
        }
        socket.emit('sync-user', users[googleId]);
    });

    // Unirse a sala
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

    // Procesar compra de Ticket PPV de forma segura en servidor
    socket.on('buy-ppv-ticket', ({ roomId, googleId }) => {
        const room = rooms[roomId];
        const user = users[googleId];

        if (!room || !user) {
            socket.emit('payment-error', 'Datos de sala o usuario inválidos.');
            return;
        }

        const ticketCost = 20; // Costo en NoxCoins del pase
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

    // Comprar Coins o VIP desde la tienda simulada / Stripe
    socket.on('topup-coins', ({ googleId, amount }) => {
        if (users[googleId]) {
            users[googleId].coins += amount;
            socket.emit('sync-user', users[googleId]);
        }
    });

    socket.on('buy-vip', ({ googleId }) => {
        if (users[googleId]) {
            users[googleId].isVip = true;
            socket.emit('sync-user', users[googleId]);
        }
    });

    // Chat y Sincronización de Multimedia
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
