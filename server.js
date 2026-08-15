// Importación de módulos necesarios de Node.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Inicialización de la aplicación Express y el servidor HTTP
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos desde la carpeta actual del proyecto
app.use(express.static(__dirname));

// Objeto para almacenar el estado actual de las salas activas en Nox
const rooms = {};

// Evento de conexión cuando un usuario entra a la plataforma
io.on('connection', (socket) => {
    console.log(`Usuario conectado a Nox: ${socket.id}`);

    // Unirse a una sala específica de Nox
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`Usuario ${socket.id} se unió a la sala Nox: ${roomId}`);

        // Si la sala no existe en memoria, se inicializa con valores por defecto
        if (!rooms[roomId]) {
            rooms[roomId] = { currentTime: 0, isPlaying: false };
        }

        // Enviar el estado actual del vídeo al usuario que acaba de entrar
        socket.emit('sync-state', rooms[roomId]);
    });

    // Manejar mensajes del chat en tiempo real dentro de la sala
    socket.on('chat-message', (data) => {
        // data contiene { roomId, user, message }
        io.to(data.roomId).emit('chat-message', data);
    });

    // Sincronización de reproducción: Play / Pause / Seek (Adelantar/Atrasar)
    socket.on('video-action', (data) => {
        // data contiene { roomId, action, currentTime }
        const room = rooms[data.roomId];
        if (room) {
            room.currentTime = data.currentTime;
            room.isPlaying = data.action === 'play';
        }
        // Reenviar la acción de vídeo a todos los demás usuarios en la misma sala
        socket.to(data.roomId).emit('video-action', data);
    });

    // Manejar la desconexión del usuario
    socket.on('disconnect', () => {
        console.log(`Usuario desconectado de Nox: ${socket.id}`);
    });
});

// Configuración del puerto del servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de Nox corriendo en http://localhost:${PORT}`);
});
