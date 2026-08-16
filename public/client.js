const socket = io();

let roomId = prompt("Ingresa el nombre de la sala Nox a la que deseas unirte:") || "general";
document.getElementById('current-room-name').innerText = roomId;
socket.emit('join-room', roomId);

let username = null;
let userAvatar = null;

const videoPlayer = document.getElementById('video-player');
const externalTarget = document.getElementById('external-player-target');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');

let isRemoteAction = false;

// --- CONFIGURACIÓN DE GOOGLE SIGN-IN ---
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
    
    username = responsePayload.name;
    userAvatar = responsePayload.picture;

    // Actualizar interfaz superior
    document.getElementById('google-signin-container').style.display = 'none';
    document.getElementById('user-profile-display').style.display = 'flex';
    document.getElementById('user-avatar-img').src = userAvatar;
    document.getElementById('user-name-display').innerText = username;

    // Actualizar avatar del streamer local
    const avatarPlaceholder = document.querySelector('.avatar-placeholder');
    avatarPlaceholder.innerHTML = `<img src="${userAvatar}" alt="${username}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;

    // Habilitar chat
    chatInput.disabled = false;
    sendChatBtn.disabled = false;
    chatInput.placeholder = "Envía un mensaje a Nox...";
}

function parseJwt(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// --- GESTIÓN DE REPRODUCTOR MULTIMODAL ---
function renderMedia(mediaData) {
    externalTarget.innerHTML = '';
    
    if (mediaData.type === 'video') {
        videoPlayer.style.display = 'block';
        videoPlayer.src = mediaData.url;
    } else {
        videoPlayer.style.display = 'none';
        videoPlayer.pause();
        
        if (mediaData.type === 'youtube') {
            const videoId = extractYouTubeId(mediaData.url);
            if (videoId) {
                externalTarget.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
            }
        } else if (mediaData.type === 'spotify') {
            const embedUri = getSpotifyEmbedUrl(mediaData.url);
            if (embedUri) {
                externalTarget.innerHTML = `<iframe src="${embedUri}" width="100%" height="100%" frameborder="0" allowtransparency="true" allow="encrypted-media"></iframe>`;
            }
        }
    }
}

function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : url;
}

function getSpotifyEmbedUrl(url) {
    if (url.includes('spotify.com/')) {
        return url.replace('spotify.com/', 'spotify.com/embed/');
    }
    if (url.startsWith('spotify:')) {
        const parts = url.split(':');
        return `https://open.spotify.com/embed/${parts[1]}/${parts[2]}`;
    }
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
    renderMedia(mediaData);
});

socket.on('sync-state', (state) => {
    if (state.mediaData) {
        renderMedia(state.mediaData);
    }
    if (state.currentTime && videoPlayer.style.display !== 'none') {
        videoPlayer.currentTime = state.currentTime;
        if (state.isPlaying) videoPlayer.play().catch(e => {});
    }
});

// --- PANEL DE ANFITRIÓN ---
const hostModal = document.getElementById('host-modal');
document.getElementById('host-panel-btn').addEventListener('click', () => { hostModal.style.display = 'flex'; });
document.getElementById('close-modal-btn').addEventListener('click', () => { hostModal.style.display = 'none'; });

document.getElementById('load-media-btn').addEventListener('click', () => {
    const type = document.getElementById('platform-select').value;
    const url = document.getElementById('media-url-input').value.trim();
    
    if (!url) {
        alert("Por favor ingresa un enlace válido.");
        return;
    }

    const mediaData = { type, url };
    renderMedia(mediaData);
    socket.emit('change-media', { roomId, mediaData });
    hostModal.style.display = 'none';
});

// --- CHAT EN TIEMPO REAL ---
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!username) {
        alert("Debes iniciar sesión con Google para enviar mensajes.");
        return;
    }
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chat-message', { roomId, user: username, avatar: userAvatar, message });
        chatInput.value = '';
    }
});

socket.on('chat-message', (data) => {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message');
    
    const avatarHtml = data.avatar ? `<img src="${data.avatar}" class="chat-user-avatar">` : '';
    messageDiv.innerHTML = `${avatarHtml}<span class="username">${escapeHtml(data.user)}:</span> <span class="text">${escapeHtml(data.message)}</span>`;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

document.getElementById('change-room-btn').addEventListener('click', () => {
    window.location.reload();
});

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}
