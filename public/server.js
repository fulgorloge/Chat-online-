const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

app.post('/api/auth/google', (req, res) => {
    const { token } = req.body;
    res.json({ success: true, user: { name: "Operador Google" } });
});

io.on('connection', (socket) => {
    console.log(`> Nodo conectado: ${socket.id}`);

    socket.on('create_room', (data) => {
        socket.join(data.roomName);
        console.log(`> Sala creada: ${data.roomName} [Plataforma: ${data.platform}] por ${data.user}`);
        socket.emit('room_joined', {
            roomName: data.roomName,
            platform: data.platform,
            mediaInput: data.mediaInput
        });
    });

    // Eventos de escritura en tiempo real ("Typing")
    socket.on('typing', (data) => {
        if (data.scope === 'room' && data.roomName) {
            socket.to(data.roomName).emit('display_typing', { user: data.user, scope: 'room' });
        } else if (data.scope === 'global') {
            socket.broadcast.emit('display_typing', { user: data.user, scope: 'global' });
        }
    });

    socket.on('stop_typing', (data) => {
        if (data.scope === 'room' && data.roomName) {
            socket.to(data.roomName).emit('clear_typing', { scope: 'room' });
        } else if (data.scope === 'global') {
            socket.broadcast.emit('clear_typing', { scope: 'global' });
        }
    });

    // Mensajería de sala
    socket.on('room_message', (data) => {
        io.to(data.roomName).emit('room_message', {
            user: data.user,
            text: data.text,
            time: data.time
        });
    });

    // Mensajería global
    socket.on('chat_message', (data) => {
        io.emit('chat_message', {
            user: data.user,
            text: data.text,
            time: data.time
        });
    });

    socket.on('disconnect', () => {
        console.log(`> Nodo desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`> Servidor GeoVibe activo en el puerto ${PORT}`);
});
