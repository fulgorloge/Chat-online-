const socket = io();

let roomId = prompt("Ingresa el nombre de la sala Nox a la que deseas unirte:") || "general";
document.getElementById('current-room-name').innerText = roomId;

let googleId = null;
let username = null;
let userAvatar = null;
let userCoins = 0;
let isVip = false;

const videoPlayer = document.getElementById('video-player');
const externalTarget = document.getElementById('external-player-target');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');

const openShopBtn = document.getElementById('open-shop-btn');
const openVipBtn = document.getElementById('open-vip-btn');
const paywallOverlay = document.getElementById('paywall-overlay');

let isRemoteAction = false;

window.onload = function () {
    google.accounts.id.initialize({
        client_id: "76525558845-s046srh597h8er8svsq1un6c8b95tmbo.apps.googleusercontent.com",
        callback: handleCredentialResponse
    });

    google.accounts.id.renderButton(
        document.getElementById("google-signin-container"),
        { theme: "outline", size: "medium", text: "signin_with", shape: "pill" }
    );
};

function handleCredentialResponse(response) {
    const responsePayload = parseJwt(response.credential);
    googleId = responsePayload.sub;
    username = responsePayload.name;
    userAvatar = responsePayload.picture;

    document.getElementById('google-signin-container').style.display = 'none';
    document.getElementById('user-profile-display').style.display = 'flex';
    document.getElementById('user-avatar-img').src = userAvatar;
    document.getElementById('user-name-display').innerText = username;

    // Conectar sesión al backend
    socket.emit('user-login', { googleId, name: username, avatar: userAvatar });
    socket.emit('join-room', { roomId, googleId });
}

// Sincronizar datos del usuario logueado desde el servidor
socket.on('sync-user', (userData) => {
    userCoins = userData.coins;
    isVip = userData.isVip;

    document.getElementById('user-wallet-balance').innerText = `🪙 ${userCoins} NoxCoins`;
    document.querySelector('.avatar-placeholder').innerHTML = `<img src="${userAvatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;

    chatInput.disabled = false;
    sendChatBtn.disabled = false;
    openShopBtn.disabled = false;
    openVipBtn.disabled = false;
    chatInput.placeholder = "Envía un mensaje a Nox...";
});

function parseJwt(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

function renderMedia(mediaData, hasAccess) {
    externalTarget.innerHTML = '';
    
    if (mediaData.isPPV && !hasAccess) {
        paywallOverlay.style.display = 'flex';
        videoPlayer.style.display = 'none';
        return;
    } else {
        paywallOverlay.style.display = 'none';
    }

    if (mediaData.type === 'video') {
        videoPlayer.style.display = 'block';
        videoPlayer.src = mediaData.url;
    } else {
        videoPlayer.style.display = 'none';
        videoPlayer.pause();
        if (mediaData.type === 'youtube') {
            const videoId = extractYouTubeId(mediaData.url);
            if (videoId) externalTarget.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1" allowfullscreen></iframe>`;
        } else if (mediaData.type === 'spotify') {
            const embedUri = getSpotifyEmbedUrl(mediaData.url);
            if (embedUri) externalTarget.innerHTML = `<iframe src="${embedUri}" width="100%" height="100%" frameborder="0" allow="encrypted-media"></iframe>`;
        }
    }
}

// Comprar pase PPV
document.getElementById('pay-ticket-btn').addEventListener('click', () => {
    if (!googleId) {
        alert("Debes iniciar sesión para comprar el pase.");
        return;
    }
    socket.emit('buy-ppv-ticket', { roomId, googleId });
});

socket.on('ppv-access-granted', () => {
    paywallOverlay.style.display = 'none';
    alert("¡Pase de acceso comprado con éxito!");
    socket.emit('join-room', { roomId, googleId }); // Recargar estado
});

socket.on('payment-error', (errorMsg) => {
    alert(errorMsg);
});

function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : url;
}

function getSpotifyEmbedUrl(url) {
    if (url.includes('spotify.com/')) return url.replace('spotify.com/', 'spotify.com/embed/');
    return `https://open.spotify.com/embed/track/${url}`;
}

videoPlayer.addEventListener('play', () => {
    if (isRemoteAction) return;
    socket.emit('video-action', { roomId, action: 'play', currentTime: videoPlayer.currentTime });
});

videoPlayer.addEventListener('pause', () => {
    if (isRemoteAction) return;
    socket.emit('video-action', { roomId, action: 'pause', currentTime: videoPlayer.currentTime });
});

socket.on('video-action', (data) => {
    isRemoteAction = true;
    videoPlayer.currentTime = data.currentTime;
    if (data.action === 'play') {
        videoPlayer.play().catch(e => {});
    } else {
        videoPlayer.pause();
    }
    setTimeout(() => { isRemoteAction = false; }, 300);
});

socket.on('change-media', (mediaData) => { 
    socket.emit('join-room', { roomId, googleId }); // Revalida acceso al cambiar contenido
});

socket.on('sync-state', ({ roomState, hasAccess }) => {
    if (roomState.mediaData) renderMedia(roomState.mediaData, hasAccess);
    if (roomState.currentTime && videoPlayer.style.display !== 'none') {
        videoPlayer.currentTime = roomState.currentTime;
        if (roomState.isPlaying) videoPlayer.play().catch(e => {});
    }
});

// Modales y Tienda
const shopModal = document.getElementById('shop-modal');
openShopBtn.addEventListener('click', () => { shopModal.style.display = 'flex'; });
document.getElementById('close-shop-modal').addEventListener('click', () => { shopModal.style.display = 'none'; });

document.querySelectorAll('.shop-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const action = e.currentTarget.getAttribute('data-action');
        
        if (action === 'topup') {
            const amount = parseInt(e.currentTarget.getAttribute('data-amount'));
            socket.emit('topup-coins', { googleId, amount });
            shopModal.style.display = 'none';
            alert(`¡Recarga exitosa de +${amount} NoxCoins!`);
            return;
        }

        const cost = parseInt(e.currentTarget.getAttribute('data-cost'));
        const effect = e.currentTarget.getAttribute('data-effect');

        if (userCoins < cost) {
            alert("No tienes suficientes NoxCoins. Recarga más en la tienda.");
            return;
        }

        userCoins -= cost;
        document.getElementById('user-wallet-balance').innerText = `🪙 ${userCoins} NoxCoins`;
        shopModal.style.display = 'none';

        let msg = effect === 'fire' ? "envió 🪙 Lluvia de Fuego 🔥" : "activó 🪙 Alerta de Fiesta 🎉";
        socket.emit('chat-message', { roomId, user: username, avatar: userAvatar, message: msg, isEffect: true, isVip });
    });
});

const vipModal = document.getElementById('vip-modal');
openVipBtn.addEventListener('click', () => { vipModal.style.display = 'flex'; });
document.getElementById('close-vip-modal').addEventListener('click', () => { vipModal.style.display = 'none'; });

document.getElementById('confirm-vip-btn').addEventListener('click', () => {
    socket.emit('buy-vip', { googleId });
    vipModal.style.display = 'none';
    alert("¡Felicidades! Ahora eres suscriptor VIP de Nox.");
    socket.emit('chat-message', { roomId, user: username, avatar: userAvatar, message: "¡Se ha suscrito como VIP a la sala! ⭐", isVip: true, isEffect: true });
});

const hostModal = document.getElementById('host-modal');
document.getElementById('host-panel-btn').addEventListener('click', () => { hostModal.style.display = 'flex'; });
document.getElementById('close-modal-btn').addEventListener('click', () => { hostModal.style.display = 'none'; });

document.getElementById('load-media-btn').addEventListener('click', () => {
    const type = document.getElementById('platform-select').value;
    const url = document.getElementById('media-url-input').value.trim();
    const isPPV = document.getElementById('ppv-toggle').checked;
    
    if (!url) { alert("Ingresa un enlace válido."); return; }

    const mediaData = { type, url, isPPV };
    socket.emit('change-media', { roomId, mediaData });
    hostModal.style.display = 'none';
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!username) return;
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chat-message', { roomId, user: username, avatar: userAvatar, message, isVip });
        chatInput.value = '';
    }
});

socket.on('chat-message', (data) => {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message');
    
    const avatarHtml = data.avatar ? `<img src="${data.avatar}" class="chat-user-avatar">` : '';
    const vipCrown = data.isVip ? `<span class="vip-crown">👑 VIP</span>` : '';

    if (data.isEffect) {
        messageDiv.classList.add('effect');
        messageDiv.innerHTML = `${avatarHtml}${vipCrown}<span class="username">${escapeHtml(data.user)}</span> <span class="text">${escapeHtml(data.message)}</span>`;
    } else if (data.isVip) {
        messageDiv.classList.add('vip');
        messageDiv.innerHTML = `${avatarHtml}${vipCrown}<span class="username">${escapeHtml(data.user)}:</span> <span class="text">${escapeHtml(data.message)}</span>`;
    } else {
        messageDiv.innerHTML = `${avatarHtml}<span class="username">${escapeHtml(data.user)}:</span> <span class="text">${escapeHtml(data.message)}</span>`;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

document.getElementById('change-room-btn').addEventListener('click', () => { window.location.reload(); });

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}
