const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');
const io = require('socket.io')(http, { cors: { origin: "*" } });
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (index.html)
app.use(express.static(__dirname));

let rooms = { 'global': { name: 'Sala Global', members: {}, igPosts: [] } };
let usersDb = {}; 

app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    // Lógica simplificada para prototipo
    const email = 'user@test.com';
    usersDb[email] = { username: 'UsuarioGoogle', avatar: '🌐', wallet: 200 };
    return res.json({ success: true, user: usersDb[email] });
});

app.post('/api/auth/register', (req, res) => {
    const { username, password, avatar } = req.body;
    if (usersDb[username]) return res.status(400).json({ success: false, error: 'Usuario existe' });
    usersDb[username] = { username, password, avatar: avatar || '🎧', wallet: 150 };
    return res.json({ success: true, user: usersDb[username] });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = usersDb[username];
    if (!user || user.password !== password) return res.status(400).json({ success: false, error: 'Error' });
    return res.json({ success: true, user });
});

io.on('connection', (socket) => {
    socket.on('chat_msg', (data) => {
        io.emit('new_msg', { user: data.user, msg: data.msg, time: new Date().toLocaleTimeString() });
    });
    // Otros eventos de socket (create_room, join_room, etc.) se mantienen igual
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
