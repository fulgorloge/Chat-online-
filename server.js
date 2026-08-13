const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');
const io = require('socket.io')(http, { cors: { origin: "*" } });

// Lee la llave de forma segura desde las variables de entorno de Render
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

let usersDb = {};
let rooms = { 
    'global': { id: 'global', name: 'Canal Global', count: 0, members: [], igPosts: [], currentTrack: '4cOdK2wGLETKBW3PvgPWqT', playlist: [] } 
};

app.post('/api/auth/register', (req, res) => {
    const { username, password, avatar } = req.body;
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

app.post('/api/create-stripe-session', async (req, res) => {
    const { username, zcAmount, priceUSD } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${zcAmount} Z-Coins (GeoVibe)`,
                    },
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

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
