const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.use(cors());
app.use(express.json());

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Autenticación Google
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    
    res.status(200).json({ 
      success: true, 
      user: {
        name: payload.name,
        email: payload.email,
        picture: payload.picture
      } 
    });
  } catch (error) {
    console.error('Error al verificar el token de Google:', error);
    res.status(401).json({ success: false, message: 'Token de Google inválido' });
  }
});

// WebSockets (Salas y Chat Global)
io.on('connection', (socket) => {
  console.log(`Nuevo usuario conectado: ${socket.id}`);

  socket.on('chat_message', (data) => {
    io.emit('chat_message', data);
  });

  // Manejo de despliegue y conexión real a salas
  socket.on('create_room', (data) => {
    socket.join(data.roomName);
    socket.emit('room_joined', { roomName: data.roomName });
    console.log(`Operador ${data.user} entró a la sala: ${data.roomName}`);
  });

  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
