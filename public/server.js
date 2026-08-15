// Configuración de WebSockets (Socket.io)
io.on('connection', (socket) => {
  console.log(`Nuevo usuario conectado: ${socket.id}`);

  // Canal de chat global existente
  socket.on('chat_message', (data) => {
    io.emit('chat_message', data);
  });

  // NUEVO: Manejo de despliegue y unión a salas interactivas
  socket.on('create_room', (data) => {
    // Une al socket a la sala específica solicitada por el usuario
    socket.join(data.roomName);
    
    // Confirma al cliente que se unió exitosamente
    socket.emit('room_joined', { roomName: data.roomName });
    
    // Opcional: Notifica a la misma sala o consola del servidor
    console.log(`Operador ${data.user} ha desplegado/entrado a la sala: ${data.roomName}`);
  });

  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.id}`);
  });
});
