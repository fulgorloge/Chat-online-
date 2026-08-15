const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// Endpoint básico para autenticación con Google (si aplica)
app.post('/api/auth/google', (req, res) => {
    const { token } = req.body;
    // Aquí puedes validar tu token de Google si lo requieres
    res.json({ success: true, user: { name: "Operador Google" } });
});

io.on('connection', (socket) => {
    console.log(`> Nodo conectado: ${socket.id}`);

    // Crear y unirse a una sala de streaming
    socket.on('create_room', (data) => {
        socket.join(data.roomName);
        console.log(`> Sala creada/unida: ${data.roomName} por ${data.user}`);
        
        // Notificar al usuario que se unió exitosamente enviando los datos de la sala
        socket.emit('room_joined', {
            roomName: data.roomName,
            mediaUrl: data.mediaUrl
        });
    });

    // Manejar acciones de reproducción multimedia sincronizada (Play/Pause)
    socket.on('media_action', (data) => {
        io.to(data.roomName).emit('media_action_broadcast', {
            action: data.action,
            user: data.user
        });
    });

    // Mensajería dentro de una sala específica
    socket.on('room_message', (data) => {
        io.to(data.roomName).emit('room_message', {
            user: data.user,
            text: data.text
        });
    });

    // Mensajería global
    socket.on('chat_message', (data) => {
        io.emit('chat_message', {
            user: data.user,
            text: data.text
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
