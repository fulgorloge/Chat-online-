// Inicializar la conexión con el servidor a través de Socket.io
const socket = io();

// Solicitar al usuario los datos iniciales al entrar a Nox
let roomId = prompt("Ingresa el nombre de la sala Nox a la que deseas unirte:") || "general";
let username = prompt("Ingresa tu nombre de usuario en Nox:") || `Usuario_${Math.floor(Math.random() * 1000)}`;

// Mostrar el nombre de la sala actual en la interfaz
document.getElementById('current-room-name').innerText = roomId;

// Enviar señal al servidor para unirse a la sala seleccionada
socket.emit('join-room', roomId);

// Referencias a elementos del DOM del reproductor y chat
const videoPlayer = document.getElementById('video-player');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

// Bandera para evitar bucles infinitos al procesar eventos remotos vs locales
let isRemoteAction = false;

// --- GESTIÓN DE SINCRONIZACIÓN DE VÍDEO ---

// Cuando el usuario local presiona "Play"
videoPlayer.addEventListener('play', () => {
    if (isRemoteAction) return;
    socket.emit('video-action', {
        roomId: roomId,
        action: 'play',
        currentTime: videoPlayer.currentTime
    });
});

// Cuando el usuario local presiona "Pause"
videoPlayer.addEventListener('pause', () => {
    if (isRemoteAction) return;
    socket.emit('video-action', {
        roomId: roomId,
        action: 'pause',
        currentTime: videoPlayer.currentTime
    });
});

// Escuchar acciones de reproducción enviadas por otros usuarios desde el servidor
socket.on('video-action', (data) => {
    isRemoteAction = true;
    videoPlayer.currentTime = data.currentTime;
    
    if (data.action === 'play') {
        videoPlayer.play().catch(e => console.log("Restricción de reproducción automática del navegador:", e));
    } else {
        videoPlayer.pause();
    }

    // Liberar la bandera de acción remota tras un breve lapso
    setTimeout(() => {
        isRemoteAction = false;
    }, 300);
});

// Sincronizar el estado actual al unirse por primera vez a una sala activa
socket.on('sync-state', (state) => {
    videoPlayer.currentTime = state.currentTime;
    if (state.isPlaying) {
        videoPlayer.play().catch(e => console.log("Restricción de reproducción automática del navegador:", e));
    }
});


// --- GESTIÓN DEL CHAT EN TIEMPO REAL ---

// Enviar un mensaje de chat al servidor
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    
    if (message) {
        socket.emit('chat-message', {
            roomId: roomId,
            user: username,
            message: message
        });
        chatInput.value = '';
    }
});

// Recibir mensajes de chat de la sala
socket.on('chat-message', (data) => {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message');
    
    // Construir estructura HTML segura para el mensaje
    messageDiv.innerHTML = `<span class="username">${escapeHtml(data.user)}:</span> <span class="text">${escapeHtml(data.message)}</span>`;
    
    chatMessages.appendChild(messageDiv);
    
    // Mantener el scroll automáticamente al fondo para ver los mensajes nuevos
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Botón para cambiar de sala limpiando la sesión actual
document.getElementById('change-room-btn').addEventListener('click', () => {
    const newRoom = prompt("Ingresa el nombre de la nueva sala Nox:");
    if (newRoom && newRoom !== roomId) {
        window.location.reload();
    }
});

// Función de seguridad básica para prevenir ataques XSS en el chat
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}
