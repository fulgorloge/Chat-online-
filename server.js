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

// Inicializar cliente de Google OAuth con la variable de entorno
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Middlewares básicos
app.use(cors());
app.use(express.json());

// 1. Configurar archivos estáticos (Carpeta 'public' donde va tu frontend)
app.use(express.static(path.join(__dirname, 'public')));

// 2. Ruta raíz explicita
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Endpoint de autenticación con Google
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

// Configuración de WebSockets (Socket.io)
io.on('connection', (socket) => {
  console.log(`Nuevo usuario conectado: ${socket.id}`);

  socket.on('chat_message', (data) => {
    io.emit('chat_message', data);
  });

  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.id}`);
  });
});

// Puerto dinámico asignado por Render o por defecto 3000 localmente
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
