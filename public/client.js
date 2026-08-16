const socket = io();

let roomId = prompt("Ingresa el nombre de la sala Nox a la que deseas unirte:") || "general";
let username = prompt("Ingresa tu nombre de usuario en Nox:") || `Usuario_${Math.floor(Math.random() * 1000)}`;

document.getElementById('current-room-name').innerText = roomId;
socket.emit('join-room', roomId);

const videoPlayer = document.getElementById('video-player');
const externalTarget = document.getElementById('external-player-target');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

let isRemoteAction = false;

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

// Eventos de vídeo HTML5 local
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
        videoPlayer.play().catch(e => console.log("Autoplay bloqueado por el navegador:", e));
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


// --- PANEL DE CONTROL DEL ANFITRIÓN ---
const hostModal = document.getElementById('host-modal');
document.getElementById('host-panel-btn').addEventListener('click', () => { hostModal.style.display = 'flex'; });
document.getElementById('close-modal-btn').addEventListener('click', () => { hostModal.style.display = 'none'; });

document.getElementById('load-media-btn').addEventListener('click', () => {
    const type = document.getElementById('platform-select').value;
    const url = document.getElementById('media-url-input').value.trim();
    
    if (!url) {
        alert("Por favor ingresa un enlace o identificador válido.");
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
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chat-message', { roomId, user: username, message });
        chatInput.value = '';
    }
});

socket.on('chat-message', (data) => {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message');
    messageDiv.innerHTML = `<span class="username">${escapeHtml(data.user)}:</span> <span class="text">${escapeHtml(data.message)}</span>`;
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
