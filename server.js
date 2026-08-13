const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middlewares básicos
app.use(cors());
app.use(express.json());

// 1. Configurar archivos estáticos (Carpeta 'public' donde va tu frontend)
app.use(express.static(path.join(__dirname, 'public')));

// 2. Ruta raíz explicita (por si no usas archivos estáticos o para verificar el estado)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
  // Si prefieres devolver un mensaje de texto en lugar de un archivo, usa:
  // res.status(200).json({ status: 'online', message: 'GeoVibe API funcionando correctamente' });
});

// Configuración de WebSockets (Socket.io)
io.on('connection', (socket) => {
  console.log(`Nuevo usuario conectado: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.id}`);
  });
});

// Puerto dinámico asignado por Render o por defecto 3000 localmente
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
